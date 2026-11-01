"""Owned Linux process-group supervision; no networking, credentials or retry.

The deadline loop never reads log files or /proc. A separate bounded snapshot
child performs /proc reads. A separate writer receives best-effort nonblocking
events. Filesystem stalls and uninterruptible tasks cannot be made killable by
Python; an unconfirmed group is an explicit failure, never permission to retry.
"""
import argparse
import ctypes
import datetime
import errno
import json
import os
from pathlib import Path
import select
import signal
import subprocess
import sys
import time

# Keep owned, unconfirmed child handles alive instead of silently losing their
# identity to Popen.__del__. This is not cleanup or permission to signal again.
_pending_children = []


def utc():
    return datetime.datetime.now(datetime.timezone.utc).isoformat()


def _leader(command, cwd, directory, deadline, term_grace, kill_grace):
    # Popen(start_new_session=True) created this exclusive session/group.
    # This process-local Linux setting adopts orphaned fixture/npm descendants
    # so a completed main child cannot strand unreaped group members. No new
    # service, cgroup, credential, capability or persistent setting is created.
    if ctypes.CDLL(None, use_errno=True).prctl(36, 1, 0, 0, 0) != 0:
        print(json.dumps({'event': 'spawn-error', 'errno': ctypes.get_errno()}), flush=True)
        return 71
    signal.signal(signal.SIGTERM, lambda *_: None)
    parent_lost = False
    fallback_term_at = None

    def emit(record):
        nonlocal parent_lost
        try:
            print(json.dumps(record), flush=True)
        except (BrokenPipeError, OSError):
            parent_lost = True

    flags = os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW
    out_fd = os.open(Path(directory) / 'command.stdout.raw', flags, 0o600)
    err_fd = os.open(Path(directory) / 'command.stderr.raw', flags, 0o600)
    with os.fdopen(out_fd, 'wb') as out, os.fdopen(err_fd, 'wb') as err:
        try:
            child = subprocess.Popen(command, cwd=cwd, stdout=out, stderr=err)
        except OSError as error:
            emit({'event': 'spawn-error', 'errno': error.errno})
            return 71
        emit({'event': 'spawn', 'pid': child.pid, 'pgid': os.getpgrp(), 'utc': utc()})
        reported = False
        drained_reported = False
        while True:
            children_empty = False
            while True:
                try:
                    reaped, wait_status = os.waitpid(-1, os.WNOHANG)
                except ChildProcessError:
                    # ECHILD, not waitpid==0, proves there are no live adopted
                    # children. This includes descendants that called setsid().
                    children_empty = True
                    break
                if reaped == 0:
                    break
                if reaped == child.pid:
                    child.returncode = os.waitstatus_to_exitcode(wait_status)
            status = child.returncode
            if status is not None and not reported:
                emit({'event': 'command-exit', 'code': status, 'utc': utc()})
                reported = True
            if reported and children_empty and not drained_reported:
                emit({'event': 'descendants-drained', 'utc': utc()})
                drained_reported = True
            if parent_lost and children_empty:
                return 72
            now = time.monotonic()
            # Independent fallback survives an outer caller killing the
            # supervisor's group: this leader owns a distinct session. Lost
            # parent never means success or release of live work. In normal
            # operation the main supervisor owns the earlier deadline. A
            # stopped supervisor gets only this bounded fallback, not forever.
            fallback_due = parent_lost or now >= deadline + term_grace + kill_grace
            if fallback_due and fallback_term_at is None:
                fallback_term_at = now
                emit({'event': 'leader-fallback-term', 'parentLost': parent_lost, 'utc': utc()})
                os.killpg(os.getpgrp(), signal.SIGTERM)
            elif fallback_term_at is not None and now >= fallback_term_at + term_grace:
                # Only our fresh, still-live leader's own group. Escaped
                # descendants may remain: caller must retain UNCONFIRMED and
                # reconcile, never infer a whole-tree kill from this signal.
                os.killpg(os.getpgrp(), signal.SIGKILL)
            # Keep the group leader alive until the parent has checked the group.
            ready, _, _ = select.select([] if parent_lost else [sys.stdin], [], [], 0.05)
            if ready:
                value = os.read(0, 1)
                if value == b'R' and reported and children_empty:
                    return 0
                if not value:
                    parent_lost = True


def _snapshot(group):
    scan_started = time.monotonic()
    members = []
    unreadable = 0
    for path in Path('/proc').iterdir():
        if not path.name.isdecimal():
            continue
        try:
            # Do not read cmdline, environment, fd contents, keys or log files.
            parts = (path / 'stat').read_text().rsplit(') ', 1)[1].split()
            if int(parts[2]) == group:
                members.append({'pid': int(path.name), 'state': parts[0], 'startTicks': int(parts[19])})
        except OSError as error:
            # A process may disappear after /proc enumeration. Linux can
            # return either ENOENT or ESRCH for that same exit race; neither
            # represents an unreadable live process. Other errors stay unknown.
            if error.errno in (errno.ENOENT, errno.ESRCH):
                continue
            unreadable += 1
            continue
        except (ValueError, IndexError):
            unreadable += 1
            continue
    print(json.dumps({'event': 'group-snapshot', 'pgid': group, 'utc': utc(), 'members': members,
                      'scanStartedMonotonic': scan_started, 'complete': unreadable == 0, 'unreadable': unreadable}))


def _logger(path):
    fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL | os.O_NOFOLLOW, 0o600)
    with os.fdopen(fd, 'w', encoding='utf-8') as stream:
        for line in sys.stdin:
            stream.write(line)
            stream.flush()


def _sample_loop(group):
    while True:
        try:
            _snapshot(group)
            sys.stdout.flush()
        except BrokenPipeError:
            return
        time.sleep(0.25)


def _before_deadline(now, deadline):
    return now < deadline


def auth_command(phase, *, release=False, expected_commit=None, expected_tree=None):
    if phase not in ('build', 'verify'):
        raise ValueError('AUTH_SUPERVISOR_PHASE_REQUIRED')
    pins = (expected_commit, expected_tree)
    for value in pins:
        if value is not None and (not isinstance(value, str) or len(value) != 40 or
                                  any(c not in '0123456789abcdef' for c in value)):
            raise ValueError('AUTH_SUPERVISOR_SOURCE_PIN_REFUSED')
    if release and any(value is None for value in pins):
        raise ValueError('AUTH_SUPERVISOR_RELEASE_PINS_REQUIRED')
    command = (['node', 'scripts/package/build-auth.mjs', '--offline'] if phase == 'build' else
               ['node', 'scripts/package/verify-auth.mjs', '--manifest', 'dist/auth-package-manifest.json'])
    if release:
        command.append('--release')
    for flag, value in zip(('--expected-commit', '--expected-tree'), pins):
        if value is not None:
            command.extend((flag, value))
    return command


def supervise(command, *, cwd, directory, timeout=430, term_grace=5, kill_grace=5):
    if sys.platform != 'linux' or timeout <= 0 or term_grace <= 0 or kill_grace <= 0:
        raise ValueError('AUTH_SUPERVISOR_LINUX_BUDGET_REQUIRED')
    directory = Path(directory).resolve()
    directory.mkdir(mode=0o700, parents=False, exist_ok=False)
    os.chmod(directory, 0o700)
    script = str(Path(__file__).resolve())
    started = time.monotonic()
    deadline = started + timeout
    # Own every partially initialized handle before launching any child. A
    # later Popen/set_blocking failure must still close pipes, reap only owned
    # children where possible, and leave an explicit non-success receipt.
    writer = leader = snapshot = None
    group = None
    writer_ready = False
    initialization_complete = False
    initialization_phase = 'writer-spawn'
    initialization_error = None
    cleanup_errors = []
    lost_events = 0

    def note(event, **fields):
        nonlocal lost_events
        record = {'schema': 'wallet-auth-supervision/1', 'event': event, 'utc': utc(),
                  'elapsed': time.monotonic() - started, **fields}
        data = (json.dumps(record, separators=(',', ':')) + '\n').encode()
        # Every event is smaller than PIPE_BUF; no partial framed records.
        if len(data) > 4000 or not writer_ready or writer.stdin.closed:
            lost_events += 1
            return
        try:
            os.write(writer.stdin.fileno(), data)
        except (BlockingIOError, BrokenPipeError, OSError):
            lost_events += 1

    buffer = b''
    snapshot_data = b''
    command_exit = None
    descendants_drained = False
    spawned_pid = None
    terminal = None
    stage = 'running'
    stage_deadline = deadline
    group_empty = False
    leader_exit = None
    writer_exit = None
    sampler_exit = None
    required_snapshot_after = None

    def group_signal(value):
        observed = os.waitid(os.P_PID, group, os.WEXITED | os.WNOHANG | os.WNOWAIT)
        if observed is not None:
            note('signal-refused-leader-exited', signal=value.name)
            return False
        try:
            os.killpg(group, value)
            note('signal-requested', signal=value.name, pgid=group)
            return True
        except OSError as error:
            note('signal-request-failed', signal=value.name, errno=error.errno)
            return False

    try:
        try:
            writer = subprocess.Popen([sys.executable, '-I', '-B', script, '__logger', str(directory / 'events.jsonl')], stdin=subprocess.PIPE,
                                      stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            initialization_phase = 'writer-pipe'
            os.set_blocking(writer.stdin.fileno(), False)
            writer_ready = True
            initialization_phase = 'leader-spawn'
            leader = subprocess.Popen([sys.executable, '-I', '-B', script, '__leader', str(cwd), str(directory),
                                       str(deadline), str(term_grace), str(kill_grace), *command],
                                      stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            # Retain identity before the next fallible pipe-setup operation.
            # Never poll/wait and reap this PID while group signalling remains
            # possible; the unchanged loop uses WNOWAIT for that purpose.
            group = leader.pid
            initialization_phase = 'leader-pipe'
            os.set_blocking(leader.stdout.fileno(), False)
            note('supervisor-start', leaderPid=group, pgid=group, timeoutSeconds=timeout, deadlineMonotonic=deadline)
            initialization_phase = 'sampler-spawn'
            snapshot = subprocess.Popen([sys.executable, '-I', '-B', script, '__sample', str(group)],
                                        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL)
            initialization_phase = 'sampler-pipe'
            os.set_blocking(snapshot.stdout.fileno(), False)
            initialization_complete = True
        except Exception as error:
            # No command text, arguments, environment or exception message is
            # copied to evidence. A launched leader makes group state unknown.
            initialization_error = {'phase': initialization_phase, 'type': type(error).__name__,
                                    'errno': getattr(error, 'errno', None)}
            terminal = ('INITIALIZATION_FAILED_GROUP_UNCONFIRMED' if leader is not None
                        else 'INITIALIZATION_FAILED')
            note('initialization-failed', **initialization_error, leaderPid=group)
        while terminal is None:
            now = time.monotonic()
            # Budget decision comes BEFORE telemetry processing.
            if now >= stage_deadline:
                if stage == 'running':
                    note('deadline-expired')
                    group_signal(signal.SIGTERM)
                    required_snapshot_after = time.monotonic()
                    stage, stage_deadline = 'term-grace', now + term_grace
                elif stage == 'term-grace':
                    group_signal(signal.SIGKILL)
                    required_snapshot_after = time.monotonic()
                    stage, stage_deadline = 'kill-observe', now + kill_grace
                else:
                    terminal = 'TERMINATION_UNCONFIRMED'
                    break
            try:
                chunk = os.read(leader.stdout.fileno(), 16384)
            except BlockingIOError:
                chunk = b''
            buffer += chunk
            if len(buffer) > 65536:
                terminal = 'CONTROL_PROTOCOL_REFUSED'
                break
            while b'\n' in buffer:
                line, buffer = buffer.split(b'\n', 1)
                try:
                    record = json.loads(line)
                except (ValueError, TypeError):
                    note('control-protocol-invalid')
                    terminal = 'CONTROL_PROTOCOL_REFUSED'
                    break
                if record['event'] == 'spawn':
                    spawned_pid = record['pid']
                    note('command-spawn-observed', childPid=spawned_pid)
                elif record['event'] == 'command-exit':
                    command_exit = record['code']
                    required_snapshot_after = time.monotonic()
                    note('command-exit-observed', code=command_exit)
                elif record['event'] == 'descendants-drained':
                    descendants_drained = True
                    required_snapshot_after = time.monotonic()
                    note('descendants-drained-observed')
                elif record['event'] == 'spawn-error':
                    terminal = 'SPAWN_FAILED'
            if snapshot is not None:
                try:
                    snapshot_data += os.read(snapshot.stdout.fileno(), 65536)
                except BlockingIOError:
                    pass
                if len(snapshot_data) > 1048576:
                    snapshot_data = b''
                    note('snapshot-overflow')
                while b'\n' in snapshot_data:
                    line, snapshot_data = snapshot_data.split(b'\n', 1)
                    try:
                        record = json.loads(line)
                        others = [member for member in record['members'] if member['pid'] != group]
                        note('group-observed', pgid=group, count=len(others), states=sorted(set(x['state'] for x in others)))
                        # A main-command exit alone is never sufficient.
                        fresh = required_snapshot_after is not None and record.get('scanStartedMonotonic', -1) >= required_snapshot_after
                        if record.get('pgid') == group and fresh and record.get('complete') is True and not others and descendants_drained:
                            group_empty = True
                            terminal = ('SUCCEEDED' if command_exit == 0 else 'COMMAND_FAILED') if stage == 'running' else 'TIMED_OUT_GROUP_ENDED'
                            if terminal == 'SUCCEEDED' and not _before_deadline(time.monotonic(), deadline):
                                terminal = 'DEADLINE_EXPIRED'
                    except (ValueError, KeyError):
                        note('snapshot-invalid')
            observed = os.waitid(os.P_PID, group, os.WEXITED | os.WNOHANG | os.WNOWAIT)
            if observed is not None and stage == 'running' and command_exit is None:
                terminal = 'LEADER_LOST_GROUP_UNCONFIRMED'
                break
            time.sleep(0.02)
    finally:
        # Cleanup errors cannot skip later owned handles or fabricate success.
        # An unconfirmed handle is retained, not permission to signal it again.
        def retain(process):
            if process not in _pending_children:
                _pending_children.append(process)

        def cleanup_error(phase, error):
            record = {'phase': phase, 'type': type(error).__name__,
                      'errno': getattr(error, 'errno', None)}
            cleanup_errors.append(record)
            note('cleanup-error', **record)

        def close_stream(stream, phase):
            if stream is not None and not stream.closed:
                try:
                    stream.close()
                except OSError as error:
                    cleanup_error(phase, error)

        # Closing only this leader's parent pipe triggers its existing bounded
        # parent-loss fallback. No group signal is attempted after failed setup,
        # and neither a reaped leader nor fallback is evidence of an empty tree.
        if leader is not None and not initialization_complete:
            close_stream(leader.stdin, 'leader-parent-pipe')
        if snapshot is not None:
            try:
                # Only this owned sampler handle, never a name or group kill.
                if snapshot.poll() is None:
                    snapshot.terminate()
                sampler_exit = snapshot.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                note('snapshot-termination-unconfirmed', pid=snapshot.pid)
                retain(snapshot)
            except OSError as error:
                cleanup_error('sampler-reap', error)
                retain(snapshot)
            finally:
                close_stream(snapshot.stdout, 'sampler-stdout')
        if leader is not None:
            if group_empty:
                if terminal == 'SUCCEEDED' and not _before_deadline(time.monotonic(), deadline):
                    terminal = 'DEADLINE_EXPIRED'
                try:
                    leader.stdin.write(b'R')
                    leader.stdin.flush()
                except OSError as error:
                    cleanup_error('leader-release', error)
                try:
                    leader_exit = leader.wait(timeout=1)
                except subprocess.TimeoutExpired:
                    terminal = 'LEADER_RELEASE_UNCONFIRMED'
                    retain(leader)
                except OSError as error:
                    cleanup_error('leader-reap', error)
                    retain(leader)
            else:
                # Last signalling decision is over. Only reap our own child;
                # this never substitutes for fresh complete group observation.
                try:
                    leader_exit = leader.wait(timeout=0.2)
                except subprocess.TimeoutExpired:
                    retain(leader)
                    note('leader-reap-unconfirmed', pid=leader.pid)
                except OSError as error:
                    cleanup_error('leader-reap', error)
                    retain(leader)
            for name in ('stdin', 'stdout', 'stderr'):
                close_stream(getattr(leader, name), 'leader-' + name)
        note('decision', outcome=terminal, commandExit=command_exit, groupEmptyObserved=group_empty)
        if writer is not None:
            close_stream(writer.stdin, 'writer-stdin')
            try:
                writer_exit = writer.wait(timeout=0.2)
            except subprocess.TimeoutExpired:
                retain(writer)
            except OSError as error:
                cleanup_error('writer-reap', error)
                retain(writer)
    if terminal == 'SUCCEEDED' and not _before_deadline(time.monotonic(), deadline):
        terminal = 'DEADLINE_EXPIRED'
    diagnostics_complete = initialization_complete and writer_exit == 0 and lost_events == 0 and not cleanup_errors
    if terminal == 'SUCCEEDED' and not diagnostics_complete:
        terminal = 'DIAGNOSTICS_INCOMPLETE'
    result = {'schema': 'wallet-auth-supervision-result/1', 'utc': utc(), 'outcome': terminal,
              'success': terminal == 'SUCCEEDED' and group_empty and descendants_drained and leader_exit == 0 and diagnostics_complete and sampler_exit is not None,
              'leaderPid': group, 'commandPid': spawned_pid, 'commandExit': command_exit, 'leaderExit': leader_exit,
              'writerExit': writer_exit, 'diagnosticsComplete': diagnostics_complete,
              'samplerExit': sampler_exit,
              'initializationComplete': initialization_complete, 'initializationError': initialization_error,
              'cleanupErrors': cleanup_errors,
              'descendantsDrainedObserved': descendants_drained,
              'groupEmptyObserved': group_empty, 'elapsed': time.monotonic() - started,
              'timeoutSeconds': timeout, 'droppedEvents': lost_events, 'automaticRetryAllowed': False}
    # This final write is outside the deadline/signal decision, not a guarantee
    # against a stalled filesystem or a whole-host scheduler failure.
    (directory / 'result.json').write_text(json.dumps(result, indent=2) + '\n')
    return result


if __name__ == '__main__':
    if len(sys.argv) > 1 and sys.argv[1] == '__leader':
        raise SystemExit(_leader(sys.argv[7:], sys.argv[2], sys.argv[3], float(sys.argv[4]), float(sys.argv[5]), float(sys.argv[6])))
    if len(sys.argv) > 1 and sys.argv[1] == '__snapshot':
        _snapshot(int(sys.argv[2]))
        raise SystemExit(0)
    if len(sys.argv) > 1 and sys.argv[1] == '__sample':
        _sample_loop(int(sys.argv[2]))
        raise SystemExit(0)
    if len(sys.argv) > 1 and sys.argv[1] == '__logger':
        _logger(sys.argv[2])
        raise SystemExit(0)
    parser = argparse.ArgumentParser()
    parser.add_argument('--source', required=True)
    parser.add_argument('--evidence', required=True)
    parser.add_argument('--phase', choices=['build', 'verify'], required=True)
    parser.add_argument('--release', action='store_true')
    parser.add_argument('--expected-commit')
    parser.add_argument('--expected-tree')
    args = parser.parse_args()
    command = auth_command(args.phase, release=args.release,
                           expected_commit=args.expected_commit, expected_tree=args.expected_tree)
    result = supervise(command, cwd=Path(args.source).resolve(), directory=args.evidence, timeout=430 if args.phase == 'build' else 90)
    print(json.dumps(result))
    raise SystemExit(0 if result['success'] else 1)

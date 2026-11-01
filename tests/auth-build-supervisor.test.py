"""Synthetic Linux-only owned-process fixtures. No npm/network/credentials.
Run only on approved Linux execution (SIN or the exact-head GitHub CI).
No local/container/Windows syntax/import/test run.
"""
import importlib.util
import io
import json
import os
from pathlib import Path
import signal
import subprocess
import sys
import tempfile
import time
import unittest
from contextlib import redirect_stdout
from unittest.mock import patch

spec = importlib.util.spec_from_file_location('auth_supervisor', Path(__file__).resolve().parents[1] / 'scripts/package/supervise-auth.py')
supervisor = importlib.util.module_from_spec(spec)
spec.loader.exec_module(supervisor)


@unittest.skipUnless(sys.platform == 'linux', 'approved Linux only')
class SupervisorTests(unittest.TestCase):
    def snapshot_with_proc_entries(self, entries):
        output = io.StringIO()
        with patch.object(supervisor.Path, 'iterdir', return_value=iter(entries)), redirect_stdout(output):
            supervisor._snapshot(12345)
        return json.loads(output.getvalue())

    def proc_entry(self, pid, content):
        class ProcEntry:
            name = str(pid)

            def __truediv__(self, key):
                return self

            def read_text(self):
                if isinstance(content, OSError):
                    raise content
                return content

        return ProcEntry()

    def test_exited_proc_race_does_not_make_empty_snapshot_unknown(self):
        for error in (FileNotFoundError(2, 'gone'), ProcessLookupError(3, 'gone')):
            result = self.snapshot_with_proc_entries([self.proc_entry(123, error)])
            self.assertTrue(result['complete'])
            self.assertEqual(result['unreadable'], 0)
            self.assertEqual(result['members'], [])

    def test_exited_proc_race_preserves_live_group_member(self):
        stat = '456 (fixture) ' + ' '.join(['S', '1', '12345'] + ['0'] * 16 + ['99'])
        result = self.snapshot_with_proc_entries([
            self.proc_entry(123, ProcessLookupError(3, 'gone')),
            self.proc_entry(456, stat),
        ])
        self.assertTrue(result['complete'])
        self.assertEqual(result['members'], [{'pid': 456, 'state': 'S', 'startTicks': 99}])

    def test_unreadable_live_proc_remains_unknown(self):
        result = self.snapshot_with_proc_entries([self.proc_entry(123, PermissionError(13, 'denied'))])
        self.assertFalse(result['complete'])
        self.assertEqual(result['unreadable'], 1)

    def test_release_command_preserves_external_identity_for_both_phases(self):
        commit, tree = '1' * 40, '2' * 40
        for phase in ('build', 'verify'):
            command = supervisor.auth_command(phase, release=True,
                                               expected_commit=commit, expected_tree=tree)
            self.assertEqual(command[-5:], ['--release', '--expected-commit', commit,
                                           '--expected-tree', tree])
        self.assertEqual(supervisor.auth_command('build'),
                         ['node', 'scripts/package/build-auth.mjs', '--offline'])

    def test_release_command_rejects_missing_or_unresolved_pins(self):
        for options in ({'release': True}, {'release': True, 'expected_commit': '1' * 40},
                        {'expected_tree': 'main'}, {'expected_commit': 'A' * 40}):
            with self.assertRaises(ValueError):
                supervisor.auth_command('build', **options)

    def run_child(self, program, **budgets):
        with tempfile.TemporaryDirectory(prefix='wallet-supervisor-fixture-') as root:
            result = supervisor.supervise([sys.executable, '-I', '-B', '-c', program], cwd=root,
                                          directory=Path(root) / 'attempt', timeout=budgets.get('timeout', 3),
                                          term_grace=0.2, kill_grace=0.5)
            return result

    def assert_startup_failure(self, failed_phase):
        real_popen = subprocess.Popen
        real_set_blocking = os.set_blocking
        real_write = os.write
        children = []
        descriptors = {}
        failure = OSError(24, 'synthetic fixture failure')

        def launch(argv, **kwargs):
            role = next((name for token, name in (('__logger', 'writer'), ('__leader', 'leader'),
                                                 ('__sample', 'sampler')) if token in argv), None)
            if failed_phase == role + '-spawn':
                raise failure
            process = real_popen(argv, **kwargs)
            children.append((role, process))
            stream = process.stdin if role == 'writer' else process.stdout
            descriptors[stream.fileno()] = role + '-pipe'
            return process

        def configure(fd, blocking):
            if descriptors.get(fd) == failed_phase:
                raise failure
            return real_set_blocking(fd, blocking)

        with tempfile.TemporaryDirectory(prefix='wallet-supervisor-startup-') as root:
            attempt = Path(root) / 'attempt'
            try:
                # Finite, synthetic work only. A lost setup cannot launch npm
                # or require broad cleanup. The retained leader owns fallback.
                with patch.object(supervisor.subprocess, 'Popen', side_effect=launch), \
                     patch.object(supervisor.os, 'set_blocking', side_effect=configure), \
                     patch.object(supervisor.os, 'killpg') as group_signal, \
                     patch.object(supervisor.os, 'write', wraps=real_write) as event_write:
                    result = supervisor.supervise(
                        [sys.executable, '-I', '-B', '-c', 'import time;time.sleep(0.4)'],
                        cwd=root, directory=attempt, timeout=2, term_grace=0.2, kill_grace=0.5)
                    group_signal.assert_not_called()
                    if failed_phase.startswith('writer-'):
                        event_write.assert_not_called()
                self.assertEqual(json.loads((attempt / 'result.json').read_text()), result)
                self.assertFalse(result['success'])
                self.assertFalse(result['automaticRetryAllowed'])
                self.assertFalse(result['initializationComplete'])
                self.assertFalse(result['diagnosticsComplete'])
                self.assertFalse(result['groupEmptyObserved'])
                self.assertFalse(result['descendantsDrainedObserved'])
                self.assertEqual(result['initializationError'],
                                 {'phase': failed_phase, 'type': 'OSError', 'errno': 24})
                self.assertNotIn('synthetic fixture failure', json.dumps(result))
                expected_roles = {
                    'writer-spawn': [], 'writer-pipe': ['writer'],
                    'leader-spawn': ['writer'], 'leader-pipe': ['writer', 'leader'],
                    'sampler-spawn': ['writer', 'leader'],
                    'sampler-pipe': ['writer', 'leader', 'sampler']}
                self.assertEqual([role for role, _ in children], expected_roles[failed_phase])
                leaders = [p for role, p in children if role == 'leader']
                self.assertEqual(result['outcome'], 'INITIALIZATION_FAILED_GROUP_UNCONFIRMED'
                                 if leaders else 'INITIALIZATION_FAILED')
                self.assertEqual(result['leaderPid'], leaders[0].pid if leaders else None)
                self.assertLess(result['elapsed'], 3)
                for _, process in children:
                    # Before fixture teardown, the supervisor must either have
                    # reaped this child or retained its unresolved exact handle.
                    self.assertTrue(process.returncode is not None or
                                    process in supervisor._pending_children)
                    for stream in (process.stdin, process.stdout, process.stderr):
                        if stream is not None:
                            self.assertTrue(stream.closed)
                if failed_phase.startswith('writer-'):
                    self.assertFalse(result['diagnosticsComplete'])
                    self.assertGreater(result['droppedEvents'], 0)
                else:
                    self.assertEqual(result['writerExit'], 0)
                    events = [json.loads(line) for line in (attempt / 'events.jsonl').read_text().splitlines()]
                    self.assertEqual([e['event'] for e in events].count('initialization-failed'), 1)
                    self.assertEqual(events[-1]['event'], 'decision')
                    self.assertEqual(events[-1]['outcome'], result['outcome'])
                    self.assertEqual(result['droppedEvents'], 0)
            finally:
                # Only fixture-owned direct handles. Wait for the finite
                # command/leader fallback; never kill a numeric group here.
                for _, process in children:
                    try:
                        process.wait(timeout=3)
                    finally:
                        if process.returncode is not None and process in supervisor._pending_children:
                            supervisor._pending_children.remove(process)

    def test_writer_spawn_failure_returns_explicit_receipt(self):
        self.assert_startup_failure('writer-spawn')

    def test_writer_pipe_setup_failure_closes_owned_writer(self):
        self.assert_startup_failure('writer-pipe')

    def test_leader_spawn_failure_drains_event_writer(self):
        self.assert_startup_failure('leader-spawn')

    def test_leader_pipe_setup_failure_retains_unknown_group(self):
        self.assert_startup_failure('leader-pipe')

    def test_sampler_spawn_failure_retains_unknown_group(self):
        self.assert_startup_failure('sampler-spawn')

    def test_sampler_pipe_setup_failure_reaps_owned_sampler(self):
        self.assert_startup_failure('sampler-pipe')

    def test_success_requires_exit_and_empty_group(self):
        result = self.run_child('print("SYNTHETIC")')
        self.assertTrue(result['success'])
        self.assertEqual(result['commandExit'], 0)
        self.assertTrue(result['groupEmptyObserved'])
        self.assertEqual(result['leaderExit'], 0)
        self.assertTrue(result['diagnosticsComplete'])

    def test_nonzero_is_not_a_successful_package(self):
        result = self.run_child('raise SystemExit(17)')
        self.assertFalse(result['success'])
        self.assertEqual(result['commandExit'], 17)
        self.assertTrue(result['groupEmptyObserved'])

    def test_term_ignored_needs_kill_and_never_becomes_success(self):
        result = self.run_child('import signal,time; signal.signal(signal.SIGTERM,signal.SIG_IGN); time.sleep(60)', timeout=0.3)
        self.assertFalse(result['success'])
        self.assertFalse(result['automaticRetryAllowed'])
        self.assertIn(result['outcome'], ['TIMED_OUT_GROUP_ENDED', 'TERMINATION_UNCONFIRMED'])
        self.assertLess(result['elapsed'], 3)

    def test_command_exit_does_not_hide_live_group_member(self):
        program = ('import subprocess,sys,time; '
                   'subprocess.Popen([sys.executable,"-c","import time; time.sleep(0.8)"]); '
                   'raise SystemExit(0)')
        start = time.monotonic()
        result = self.run_child(program)
        self.assertGreater(time.monotonic() - start, 0.7)
        self.assertTrue(result['groupEmptyObserved'])
        self.assertTrue(result['success'])

    def test_setsid_descendant_must_be_drained_before_success(self):
        program = ('import subprocess,sys; '
                   'subprocess.Popen([sys.executable,"-c","import time; time.sleep(0.7)"],start_new_session=True); '
                   'raise SystemExit(0)')
        start = time.monotonic()
        result = self.run_child(program)
        self.assertGreater(time.monotonic() - start, 0.6)
        self.assertTrue(result['descendantsDrainedObserved'])
        self.assertTrue(result['success'])

    def test_live_setsid_descendant_never_becomes_group_only_success(self):
        # Finite owned fixture: no long-running escaped child is left behind.
        program = ('import subprocess,sys; '
                   'subprocess.Popen([sys.executable,"-c","import time; time.sleep(0.9)"],start_new_session=True); '
                   'raise SystemExit(0)')
        result = self.run_child(program, timeout=0.2)
        self.assertFalse(result['success'])
        self.assertFalse(result['descendantsDrainedObserved'])
        self.assertFalse(result['automaticRetryAllowed'])

    def test_parent_pipe_loss_does_not_release_live_command(self):
        with tempfile.TemporaryDirectory(prefix='wallet-supervisor-parent-loss-') as root:
            # This is a direct fixture-owned leader, not a production PID or
            # an existing process group. EOF simulates outer-wrapper loss.
            leader = subprocess.Popen([sys.executable, '-I', '-B', str(Path(supervisor.__file__).resolve()),
                '__leader', root, root, str(time.monotonic() + 3), '0.2', '0.5',
                sys.executable, '-I', '-c', 'import time;time.sleep(60)'],
                stdin=subprocess.PIPE, stdout=subprocess.PIPE, stderr=subprocess.PIPE, start_new_session=True)
            leader.stdin.close()
            leader.stdin = None
            out, err = leader.communicate(timeout=3)
            self.assertEqual(leader.returncode, 72, err)
            self.assertIn(b'leader-fallback-term', out)
            self.assertIn(b'descendants-drained', out)

    def test_success_rechecks_monotonic_deadline(self):
        self.assertFalse(supervisor._before_deadline(10, 10))
        self.assertFalse(supervisor._before_deadline(11, 10))
        self.assertTrue(supervisor._before_deadline(9, 10))
        with patch.object(supervisor, '_before_deadline', return_value=False):
            result = self.run_child('raise SystemExit(0)')
        self.assertFalse(result['success'])
        self.assertEqual(result['outcome'], 'DEADLINE_EXPIRED')

    def test_dropped_events_are_not_complete_diagnostics(self):
        with patch.object(supervisor.os, 'write', side_effect=BlockingIOError):
            result = self.run_child('raise SystemExit(0)')
        self.assertGreater(result['droppedEvents'], 0)
        self.assertFalse(result['diagnosticsComplete'])
        self.assertFalse(result['success'])
        self.assertEqual(result['outcome'], 'DIAGNOSTICS_INCOMPLETE')

    def test_unrelated_process_is_not_signalled(self):
        sentinel = subprocess.Popen([sys.executable, '-I', '-c', 'import time;time.sleep(60)'])
        try:
            self.run_child('import time;time.sleep(60)', timeout=0.2)
            self.assertIsNone(sentinel.poll())
        finally:
            sentinel.terminate()
            sentinel.wait(timeout=2)

    def test_blocked_snapshot_cannot_block_deadline_or_prove_cleanup(self):
        real_popen = subprocess.Popen
        samples = []

        def launch(argv, **kwargs):
            if '__sample' in argv:
                process = real_popen([sys.executable, '-I', '-c', 'import time;time.sleep(60)'], **kwargs)
                samples.append(process)
                return process
            return real_popen(argv, **kwargs)

        try:
            with patch.object(supervisor.subprocess, 'Popen', side_effect=launch):
                result = self.run_child('import time;time.sleep(60)', timeout=0.2)
            self.assertLess(result['elapsed'], 3)
            self.assertFalse(result['success'])
            self.assertFalse(result['groupEmptyObserved'])
            self.assertEqual(result['outcome'], 'TERMINATION_UNCONFIRMED')
        finally:
            # Only direct fixture-owned handles; never numeric stale group IDs.
            for process in samples:
                if process.poll() is None:
                    process.terminate()
                process.wait(timeout=2)


if __name__ == '__main__':
    unittest.main()

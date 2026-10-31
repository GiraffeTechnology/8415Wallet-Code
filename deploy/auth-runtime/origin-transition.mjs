/** Offline programmatic transition for an already-open original encrypted store.
 * No key arguments, state initialization, service stop/start, proxy rewrite or
 * authorization translation. Unsupported durable scopes refuse before writes. */
import { readFile, open, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { protect, protectedAncestors, exclusive, replace } from './install.mjs';
import { validateAuthConfig } from '../../server/config-validation.mjs';
import { validateOriginTransitionScope } from '../../server/origin-transition-state.mjs';
const sha = value => createHash('sha256').update(value).digest('hex');
const check = (ok, code = 'AUTH_ORIGIN_TRANSITION_REFUSED') => { if (!ok) throw Error(code); };
const present = async path => { try { await lstat(path); return true; } catch (e) { if (e.code === 'ENOENT') return false; throw e; } };
async function syncDirectory(path) { const d = await open(path, 'r'); try { await d.sync(); } finally { await d.close(); } }
async function privateText(path, uid) { await protect(path, { uid, privateMode: true }); return readFile(path, 'utf8'); }
/** Read-only outcome reconciliation by the original transition ID. Never resumes
 * writes, reads credentials, releases a lock or treats a missing record as failure. */
export async function inspectManagedOriginTransition({ target, transitionId, uid = 0 }) {
  check(typeof transitionId === 'string' && /^[a-f0-9]{64}$/.test(transitionId));
  for (const dir of [target.root, target.config]) { await protectedAncestors(dir, uid); await protect(dir, { uid, directory: true, privateMode: dir !== target.root }); }
  const archive = join(target.root, 'origin-transition-' + transitionId + '.json');
  const fence = join(target.config, 'migration-config.lock');
  let journal, completed = false;
  if (await present(archive)) {
    const saved = JSON.parse(await privateText(archive, uid)); completed = saved.completed === true;
    const { completed: _completed, ...original } = saved; journal = original;
    check(completed, 'AUTH_ORIGIN_JOURNAL_CHANGED');
  } else if (await present(fence)) journal = JSON.parse(await privateText(fence, uid));
  else return Object.freeze({ status: 'unknown', transitionId, replayAllowed: false, credentialStateRead: false });
  const { id, ...body } = journal;
  check(id === transitionId && id === sha(JSON.stringify(body)) && journal.schema === '8415wallet-origin-transition/1' &&
    journal.tenant === target.tenant, 'AUTH_ORIGIN_JOURNAL_CHANGED');
  validateOriginTransitionScope(journal);
  const config = await privateText(join(target.config, 'auth.json'), uid);
  const receipt = await privateText(join(target.root, 'installation.json'), uid);
  const after = config === journal.afterConfig && receipt === journal.afterReceipt;
  const before = config === journal.beforeConfig && receipt === journal.beforeReceipt;
  const partial = config === journal.afterConfig && receipt === journal.beforeReceipt;
  const transitionLocksPresent = await present(fence) || await present(join(target.root, 'operation.lock'));
  return Object.freeze({ status: completed && !transitionLocksPresent ? 'completed' : 'recovery-required', transitionId,
    filePair: after ? 'after' : before ? 'before' : partial ? 'partial' : 'changed',
    committedArchive: completed, transitionLocksPresent,
    fromOrigin: journal.fromOrigin, toOrigin: journal.toOrigin,
    sourceTree: JSON.parse(journal.afterReceipt).sourceTree, replayAllowed: false, credentialStateRead: false,
    // Archive completion is historical evidence, not a read of today's store.
    currentCredentialState: 'NOT_READ' });
}
export async function transitionManagedOrigin({ target, store, fromOrigin, toOrigin, uid = 0,
  run = (file, args) => execFileSync(file, args, { encoding: 'utf8' }), checkpoint = async () => {} }) {
  const scope = validateOriginTransitionScope({ tenant: target?.tenant, fromOrigin, toOrigin });
  check(store && typeof store.withOriginTransition === 'function' && typeof store.originTransitionBinding === 'function');
  let binding = store.originTransitionBinding();
  check(binding.statePath === join(target.state, 'credentials.enc') && binding.stateEstablished === true &&
    [1, 2, 3, 4].includes(binding.minimumGeneration), 'AUTH_ORIGIN_EXISTING_STATE_REQUIRED');
  const stopped = async () => {
    const lines = String(await run('systemctl', ['show', target.unitName, '--property=ActiveState,SubState,MainPID']));
    const values = Object.fromEntries(lines.trim().split('\n').map(line => { const i = line.indexOf('='); return [line.slice(0, i), line.slice(i + 1)]; }));
    check(values.ActiveState === 'inactive' && values.SubState === 'dead' && values.MainPID === '0', 'AUTH_ORIGIN_SERVICE_MUST_BE_STOPPED');
  };
  await stopped();
  for (const dir of [target.root, target.config, target.state]) { await protectedAncestors(dir, uid); await protect(dir, { uid, directory: true, privateMode: dir !== target.root }); }
  await protect(binding.statePath, { uid, privateMode: true });
  const configPath = join(target.config, 'auth.json'), receiptPath = join(target.root, 'installation.json');
  const fence = join(target.config, 'migration-config.lock'), operation = join(target.root, 'operation.lock');
  return store.withOriginTransition(scope, async proof => {
    // Admitted writes may have raised the durable floor while the gate drained.
    // Bind the journal to the actual held generation, never the earlier sample.
    const held = store.originTransitionBinding();
    check(held.statePath === binding.statePath && held.stateEstablished === true &&
      [1, 2, 3, 4].includes(held.minimumGeneration) && held.minimumGeneration >= binding.minimumGeneration);
    binding = held;
    let journal, createdOperation = false;
    const resuming = await present(fence);
    // A crash may occur after the fence was cleared but before its operation
    // lock was removed. Only the exact immutable completed journal can close it.
    if (!resuming && await present(operation)) {
      const lock = await privateText(operation, uid), match = /^origin-transition:([a-f0-9]{64})\n$/.exec(lock);
      check(match, 'AUTH_ORIGIN_EXISTING_OPERATION_REFUSED');
      const saved = JSON.parse(await privateText(join(target.root, 'origin-transition-' + match[1] + '.json'), uid));
      const { completed, id, ...body } = saved;
      check(completed === true && id === match[1] && id === sha(JSON.stringify(body)) &&
        saved.schema === '8415wallet-origin-transition/1' && saved.tenant === scope.tenant &&
        saved.fromOrigin === fromOrigin && saved.toOrigin === toOrigin && saved.stateSha256 === proof.stateSha256 &&
        saved.minimumGeneration === binding.minimumGeneration, 'AUTH_ORIGIN_RECOVERY_BINDING_REFUSED');
      check(await privateText(configPath, uid) === saved.afterConfig && await privateText(receiptPath, uid) === saved.afterReceipt,
        'AUTH_ORIGIN_RECOVERY_FILE_CHANGED');
      await stopped(); await unlink(operation); await syncDirectory(target.root);
      return Object.freeze({ status: 'origin-transition-complete', id, tenant: scope.tenant, fromOrigin, toOrigin,
        credentialStatePreserved: true, minimumGeneration: binding.minimumGeneration,
        sourceTree: JSON.parse(saved.afterReceipt).sourceTree, serviceStarted: false, proxyChanged: false, sessionRestored: false });
    }
    if (resuming) {
      journal = JSON.parse(await privateText(fence, uid));
      check(journal.schema === '8415wallet-origin-transition/1' && journal.tenant === scope.tenant &&
        journal.fromOrigin === fromOrigin && journal.toOrigin === toOrigin && journal.stateSha256 === proof.stateSha256 &&
        journal.minimumGeneration === binding.minimumGeneration, 'AUTH_ORIGIN_RECOVERY_BINDING_REFUSED');
      check(await privateText(operation, uid) === 'origin-transition:' + journal.id + '\n', 'AUTH_ORIGIN_RECOVERY_LOCK_REFUSED');
    } else {
      check(!await present(operation), 'AUTH_ORIGIN_EXISTING_OPERATION_REFUSED');
      const beforeConfig = await privateText(configPath, uid), beforeReceipt = await privateText(receiptPath, uid);
      const config = JSON.parse(beforeConfig), receipt = JSON.parse(beforeReceipt); validateAuthConfig(config);
      check(config.tenant === scope.tenant && config.origin === fromOrigin && receipt.origin === fromOrigin &&
        receipt.tenant === scope.tenant && receipt.schema === '8415wallet-auth-install/1' && /^[a-f0-9]{40}$/.test(receipt.sourceTree) &&
        config.statePath === binding.statePath && config.socketPath === join(target.socketDirectory, 'auth.sock') &&
        config.socketPath === receipt.socketPath && ['prepared-not-activated', 'proxy-enabled'].includes(receipt.status));
      // Do not carry a nested origin-bound feature across under a new identity.
      const rest = { ...config }; delete rest.origin;
      check(!JSON.stringify(rest).includes(fromOrigin), 'AUTH_ORIGIN_FEATURE_MIGRATION_REQUIRED');
      const nextConfig = { ...config, origin: toOrigin }; validateAuthConfig(nextConfig);
      const afterConfig = JSON.stringify(nextConfig, null, 2) + '\n', afterReceipt = JSON.stringify({ ...receipt, origin: toOrigin }, null, 2) + '\n';
      journal = { schema: '8415wallet-origin-transition/1', ...scope, stateSha256: proof.stateSha256,
        minimumGeneration: binding.minimumGeneration, beforeConfig, beforeReceipt, afterConfig, afterReceipt };
      journal.id = sha(JSON.stringify(journal));
      await exclusive(operation, 'origin-transition:' + journal.id + '\n'); createdOperation = true;
      try { await exclusive(fence, JSON.stringify(journal) + '\n'); await syncDirectory(target.config); await checkpoint('fenced'); }
      catch (error) { if (!await present(fence) && createdOperation) await unlink(operation); throw error; }
    }
    // Bind journal contents on every resume. Editing a journal is never recovery.
    const { id, ...body } = journal; check(id === sha(JSON.stringify(body)), 'AUTH_ORIGIN_JOURNAL_CHANGED');
    await stopped();
    for (const [path, before, after, stage] of [[configPath, journal.beforeConfig, journal.afterConfig, 'config-written'],
      [receiptPath, journal.beforeReceipt, journal.afterReceipt, 'receipt-written']]) {
      const current = await privateText(path, uid);
      check(current === before || current === after, 'AUTH_ORIGIN_RECOVERY_FILE_CHANGED');
      if (current !== after) await replace(path, after);
      await syncDirectory(path === configPath ? target.config : target.root); await checkpoint(stage);
    }
    const archive = join(target.root, 'origin-transition-' + id + '.json');
    const complete = JSON.stringify({ ...journal, completed: true }) + '\n';
    if (await present(archive)) check(await privateText(archive, uid) === complete, 'AUTH_ORIGIN_ARCHIVE_CHANGED');
    else { await exclusive(archive, complete); await syncDirectory(target.root); }
    await checkpoint('archived');
    await unlink(fence); await syncDirectory(target.config); await checkpoint('fence-cleared');
    await unlink(operation); await syncDirectory(target.root);
    return Object.freeze({ status: 'origin-transition-complete', id, tenant: scope.tenant, fromOrigin, toOrigin,
      credentialStatePreserved: true, minimumGeneration: binding.minimumGeneration, sourceTree: JSON.parse(journal.afterReceipt).sourceTree,
      serviceStarted: false, proxyChanged: false, sessionRestored: false });
  });
}

/** Synthetic transport/readback composition, not browser or production evidence. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { createAssetControlClient } from '../web/asset-control-client.mjs';
import { createAssetControlCatalog } from '../server/task-asset-control-catalog.mjs';
import { readAssetControlPolicy, assetControlRequest, assetControlChangeDigest, appendVerifiedAssetControlChange } from '../server/task-asset-control-state.mjs';
const scope = { origin: 'https://wallet.example.invalid', tenant: 'synthetic', username: 'owner',
  account: '0x' + '1'.repeat(40), chainId: '1', agentId: 'synthetic:agent' };
const scopeDigest = createHash('sha256').update(JSON.stringify(scope)).digest('hex');
const key = '8415wallet-asset-control-pending/1:' + scopeDigest;
const initial = readAssetControlPolicy(null, scope), now = 1800000000000;
const request = assetControlRequest({ schema: '8415-asset-control-change/1', scope, expectedRevision: '0',
  patch: { target: { kind: 'allow-agent' }, value: false, expectedFieldRevision: '0' },
  credentialRevision: 0, changeId: 'a'.repeat(43), nonce: 'b'.repeat(43), issuedAt: now, expiresAt: now + 300000 });
const saved = appendVerifiedAssetControlChange(initial, scope, request, ['password', 'verified-email'], now + 1);
const query = { changeId: request.changeId, changeDigest: assetControlChangeDigest(request), expectedRevision: '0' };
function status(state) {
  const { changes, ...base } = state;
  return { ...base, label: 'Agent and asset authorization controls', defaultValue: true, evaluation: 'NOT_EVALUATED',
    appliesTo: 'still-valid-in-scope-authorizations', grantsAuthority: false,
    factorsForOFF: ['password-or-bound-wallet', 'previously-verified-email'],
    factorsForEverySave: ['password-or-bound-wallet', 'previously-verified-email'],
    changeCount: changes.length, lastChange: changes.at(-1) ?? null, canSave: true, executionScope: 'supported-actual-task-bindings' };
}
function fixture(marker, race = false) {
  const data = new Map(marker ? [[key, JSON.stringify({ scopeDigest, ...marker })]] : []), calls = [];
  let reads = 0;
  const client = { async account() { return { ...scope }; }, async request(path) {
    calls.push(path);
    if (path.endsWith('/status')) return status(race && reads++ ? saved : initial);
    if (path.endsWith('/catalog')) return { ...createAssetControlCatalog(scope, []), inventoryComplete: false };
    if (path.endsWith('/reconcile')) return { schema: '8415-asset-control-reconciliation/1', scope, revision: '1', ...query,
      state: 'committed', automaticRetryAllowed: false, committedChange: saved.changes[0] };
    assert.fail('Read must not prepare, verify, confirm or cancel');
  } };
  const window = { crypto: webcrypto, sessionStorage: { getItem: k => data.get(k) ?? null,
    setItem: (k, v) => data.set(k, v), removeItem: k => data.delete(k) } };
  const walletLogin = { assert() { return { ...scope, serverId: 'synthetic-session' }; } };
  return { adapter: createAssetControlClient({ client, walletLogin, document: {}, window }), calls, data };
}
test('a newer reconciled commit is reread before editing is unlocked', async () => {
  const f = fixture({ phase: 'prepared', query }, true);
  const result = await f.adapter.read({ binding: {} });
  assert.equal(result.view.revision, '1'); assert.equal(result.view.entries[0].value, false);
  assert.equal(result.changeState, 'settled'); assert.equal(result.canChange, true);
  assert.equal(f.data.has(key), false);
  assert.equal(f.calls.filter(p => p.endsWith('/status')).length, 2);
});
test('abandoned pre-factor preparation clears no server state and never retries', async () => {
  const f = fixture({ phase: 'preparing' });
  const result = await f.adapter.read({ binding: {} });
  assert.equal(result.changeState, 'settled'); assert.equal(f.data.has(key), false);
  assert.deepEqual(f.calls, ['account/asset-controls/status', 'account/asset-controls/catalog']);
});

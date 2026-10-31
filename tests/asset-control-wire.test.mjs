import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createAssetControlWire } from '../web/asset-control-wire.mjs';
import { createAssetControlCatalog } from '../server/task-asset-control-catalog.mjs';
import { assetControlRequest, assetControlChangeDigest } from '../server/task-asset-control-state.mjs';
const scope = { origin: 'https://wallet.example.invalid', tenant: 'synthetic', username: 'owner',
  account: '0x' + '1'.repeat(40), chainId: '1', agentId: 'synthetic:agent' };
const session = { ...scope, serverId: 'synthetic-session' }, account = { ...scope };
const raw = () => ({ schema: '8415-asset-control-state/1', scope: { ...scope }, revision: '0', entries: [],
  label: 'Agent and asset authorization controls', defaultValue: true, evaluation: 'NOT_EVALUATED',
  appliesTo: 'still-valid-in-scope-authorizations', grantsAuthority: false,
  factorsForOFF: ['password-or-bound-wallet', 'previously-verified-email'],
  factorsForEverySave: ['password-or-bound-wallet', 'previously-verified-email'],
  changeCount: 0, lastChange: null, canSave: true, executionScope: 'supported-actual-task-bindings' });
const wire = createAssetControlWire({ crypto: webcrypto });
test('asset status binds the independent authenticated account and preserves default projection', async () => {
  const decoded = await wire.status(raw(), session, account);
  assert.equal(decoded.revision, '0'); assert.deepEqual(decoded.entries, []); assert.equal(decoded.grantsAuthority, false);
  for (const key of ['origin', 'tenant', 'username', 'account', 'chainId']) {
    const value = raw(); value.scope[key] = 'other'; await assert.rejects(wire.status(value, session, account));
  }
  await assert.rejects(wire.status({ ...raw(), approved: true }, session, account));
  await assert.rejects(wire.status({ ...raw(), entries: [{ target: { kind: 'allow-agent' }, value: false }] }, session, account));
});
test('catalog derives the same IDs as server and rejects a remapped leaf or claimed ownership', async () => {
  const view = await wire.status(raw(), session, account);
  const source = { ...createAssetControlCatalog(scope, [{ chainId: '1', standard: 'native', contract: null, tokenId: null }]), inventoryComplete: false };
  const decoded = await wire.catalog(source, view); assert.equal(decoded.inventoryComplete, false); assert.equal(decoded.ownershipVerified, false);
  const wrong = structuredClone(source); wrong.entries[0].path[3] = 'asset:' + 'f'.repeat(64);
  await assert.rejects(wire.catalog(wrong, view));
  await assert.rejects(wire.catalog({ ...source, ownershipVerified: true }, view));
});
test('prepared asset patch is exact and independently hashes the canonical server request', async () => {
  const reviewed = await wire.status(raw(), session, account), now = 1800000000000;
  const patch = { target: { kind: 'allow-agent' }, value: false, expectedFieldRevision: '0' };
  const request = assetControlRequest({ schema: '8415-asset-control-change/1', scope, patch,
    expectedRevision: '0', credentialRevision: 0, changeId: 'a'.repeat(43), nonce: 'b'.repeat(43), issuedAt: now, expiresAt: now + 300000 });
  const response = { request, changeDigest: assetControlChangeDigest(request), identityMethod: 'password', emailMasked: 'o***@example.invalid' };
  const context = { session, account, reviewed, patch, identityMethod: 'password', now };
  assert.equal((await wire.prepared(response, context)).request.patch.value, false);
  await assert.rejects(wire.prepared(response, { ...context, patch: { ...patch, value: true } }));
  await assert.rejects(wire.prepared({ ...response, changeDigest: '0'.repeat(64) }, context));
  await assert.rejects(wire.prepared(response, { ...context, now: now + 300000 }));
});

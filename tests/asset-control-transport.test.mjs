import test from 'node:test';
import assert from 'node:assert/strict';
import { assetControlBody, assetControlTarget, createAssetControlTransport } from '../web/asset-control-transport.mjs';

test('asset controls retain exact single-field bodies and reject extra authority flags', () => {
  const body = { expectedRevision: '2', identityMethod: 'password',
    patch: { target: { kind: 'allow-agent' }, value: false, expectedFieldRevision: '1' } };
  assert.deepEqual(assetControlBody('prepare', body), body);
  assert.throws(() => assetControlBody('prepare', { ...body, approved: true }));
  assert.throws(() => assetControlBody('status', { tenant: 'other' }));
  assert.throws(() => assetControlBody('enable', {}));
  assert.throws(() => assetControlTarget({ kind: 'asset', path: ['not-all'] }));
  let getters = 0;
  assert.throws(() => assetControlTarget({ get kind() { getters++; return 'allow-agent'; } }));
  assert.equal(getters, 0);
});

test('transport uses existing authenticated route and never retries or stores a factor', async () => {
  const calls = [], binding = {}, login = { assert(b) { assert.equal(b, binding); return { serverId: 'synthetic-session' }; } };
  const client = { async request(path, body) { calls.push({ path, body }); return { result: 'not-yet-decoded' }; } };
  const transport = createAssetControlTransport({ client, walletLogin: login });
  const input = { changeId: 'a'.repeat(43), changeDigest: 'b'.repeat(64), password: 'synthetic-password' };
  assert.deepEqual(await transport.request('verify', input, { binding }), { result: 'not-yet-decoded' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].path, 'account/asset-controls/verify');
  assert.equal(calls[0].body.password, '');
  const failing = createAssetControlTransport({ walletLogin: login, client: { async request() { throw Error('UNKNOWN'); } } });
  await assert.rejects(failing.request('confirm', { changeId: 'a'.repeat(43), changeDigest: 'b'.repeat(64), code: '12345678' }, { binding }), /UNKNOWN/);
});

test('transport discards responses after account switch and refuses unsigned context', async () => {
  const binding = {}; let valid = true, release;
  const walletLogin = { assert() { if (!valid) throw Error('LOGIN_CHANGED'); return { serverId: 'synthetic-session' }; } };
  const transport = createAssetControlTransport({ walletLogin, client: { request: () => new Promise(resolve => { release = resolve; }) } });
  const pending = transport.request('status', {}, { binding }); valid = false; release({ revision: '9' });
  await assert.rejects(pending, /LOGIN_CHANGED/);
  const unsigned = createAssetControlTransport({ walletLogin: { assert: () => ({}) }, client: { request() { assert.fail('No request allowed'); } } });
  await assert.rejects(unsigned.request('status', {}, { binding }), /ASSET_CONTROL_INPUT_REFUSED/);
});

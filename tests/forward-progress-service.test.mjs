/** Synthetic service/store source regressions. No real chain or installed reader. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createForwardProgressService } from '../server/forward-progress-service.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { TASK_RUNTIME_SOURCE_PATHS, sourcePathAllowed } from '../scripts/package/verify-auth.mjs';
const h = n => `0x${n.toString(16).padStart(64, '0')}`;
const a = n => `0x${(100 - n).toString(16).padStart(40, '0')}`;
function snapshot(owner = 20, holder = 6, revision = 2n, blockNumber = 10n) {
  const asset = { chainId: 560048n, contract: a(50), tokenId: 7n }, blockHash = h(Number(blockNumber));
  return {
    snapshot: { asset, sequenceId: h(1), revision, blockNumber, blockHash, initialOccurrenceId: h(100), initialHolder: a(0),
      legs: Array.from({ length: 20 }, (_, i) => ({ id: h(200 + i), predecessorId: i ? h(199 + i) : null,
        buyerOccurrenceId: h(101 + i), seller: a(i), buyer: a(i + 1), termsHash: h(300 + i),
        control: { controlId: h(400 + i), acceptanceHash: h(500 + i) }, outcome: 'active' })) },
    evidence: { kind: 'bound', asset, sequenceId: h(1), revision, blockNumber, blockHash,
      owner: { occurrenceId: h(100 + owner), account: a(owner) },
      admittedHolder: { occurrenceId: h(100 + holder), account: a(holder) }, protocolFinality: false },
  };
}
function fixture({ enabled = true } = {}) {
  const store = new MemoryCredentialStore({ 'synthetic:tester': { revision: 1 } });
  const session = { username: 'tester', account: a(6), chainId: '560048', revision: 1 };
  const state = { live: true, source: { ...snapshot(), ownOccurrenceId: h(106), historical: [] },
    canonical: true, reads: 0, validations: 0, beforeRead: null, beforeValidate: null };
  const body = { asset: { chainId: '560048', contract: a(50), tokenId: '7' }, sequenceId: h(1) };
  const reader = {
    async readForPrincipal(input) {
      state.reads++; assert.equal(input.principal.account, session.account);
      assert.equal(input.principal.tenant, 'synthetic'); assert.equal(input.principal.origin, 'https://wallet.example.invalid');
      assert.equal(input.principal.username, 'tester');
      if (state.beforeRead) await state.beforeRead(); return state.source;
    },
    async validateMilestone(input) {
      state.validations++; assert.equal(input.milestone.state, 'DONE');
      assert.equal(input.ownOccurrenceId, h(106));
      if (state.beforeValidate) await state.beforeValidate(); return state.canonical;
    },
  };
  const service = () => createForwardProgressService({ store, reader: enabled ? reader : null,
    origin: 'https://wallet.example.invalid', tenant: 'synthetic',
    assertSession(s, credential) {
      assert.equal(s, session); if (!state.live) throw Error('SYNTHETIC_SESSION_REVOKED');
      if (credential !== undefined) assert.equal(credential?.revision, s.revision);
    } });
  return { store, session, state, body, service };
}
test('trusted current DONE persists and a new service preserves frozen marker after holder moves on', async () => {
  const f = fixture(), first = await f.service().read(f.body, f.session);
  assert.equal(first.state, 'DONE'); assert.equal(first.frozen, true); assert.equal(first.recordRevision, '1');
  f.state.source = { ...snapshot(20, 7, 3n, 11n), ownOccurrenceId: h(106), historical: [] };
  const continued = await f.service().read(f.body, f.session);
  assert.deepEqual(continued, first); assert.equal(f.state.validations, 2);
  assert.deepEqual(continued.funds, { state: 'not-evaluated' }); assert.deepEqual(continued.rollback, { state: 'not-evaluated' });
});
test('missed refresh catches up only from canonical same-NFT/sequence/occurrence historical evidence', async () => {
  const f = fixture(); f.state.source = { ...snapshot(20, 7, 3n, 11n), ownOccurrenceId: h(106), historical: [snapshot()] };
  const view = await f.service().read(f.body, f.session);
  assert.equal(view.state, 'DONE'); assert.equal(view.holder.position, '6'); assert.equal(view.blockNumber, '10');
});
test('unverifiable frozen provenance never becomes optimistic DONE or silently erases its durable record', async () => {
  const f = fixture(), service = f.service(); await service.read(f.body, f.session);
  f.state.canonical = false;
  await assert.rejects(service.read(f.body, f.session), /MILESTONE_UNAVAILABLE/);
  f.state.canonical = true;
  assert.equal((await service.read(f.body, f.session)).recordRevision, '1');
});
test('unopened service is explicitly unavailable and client-supplied completion/occurrence fields are refused', async () => {
  const disabled = fixture({ enabled: false }); await assert.rejects(disabled.service().read(disabled.body, disabled.session), /NOT_ENABLED/);
  const f = fixture();
  for (const extra of [{ complete: true }, { ownOccurrenceId: h(107) }, { verified: true }])
    await assert.rejects(f.service().read({ ...f.body, ...extra }, f.session), /REQUEST_REFUSED/);
  assert.equal(f.state.reads, 0);
});
test('wrong chain, foreign historical asset and unavailable evidence cannot claim DONE', async () => {
  const f = fixture();
  await assert.rejects(f.service().read({ ...f.body, asset: { ...f.body.asset, chainId: '1' } }, f.session), /REQUEST_REFUSED/);
  const wrong = snapshot(); wrong.snapshot.asset = { ...wrong.snapshot.asset, tokenId: 8n };
  f.state.source.historical = [wrong]; await assert.rejects(f.service().read(f.body, f.session), /SOURCE_REFUSED/);
  f.state.source = { ...snapshot(), evidence: { kind: 'unavailable' }, ownOccurrenceId: h(106), historical: [] };
  const view = await f.service().read(f.body, f.session);
  assert.equal(view.state, 'UNAVAILABLE'); assert.equal(view.frozen, false); assert.equal(view.holder.position, null);
});
test('session revoked during the trusted read cannot commit progress', async () => {
  const f = fixture(); f.state.beforeRead = async () => { f.state.live = false; };
  await assert.rejects(f.service().read(f.body, f.session), /SESSION_REVOKED/);
  f.state.live = true; f.state.beforeRead = null;
  assert.equal((await f.service().read(f.body, f.session)).recordRevision, '1');
});
test('concurrent completion CAS admits one record and a fresh read resumes without duplicate state changes', async () => {
  const f = fixture(); let release; const gate = new Promise(resolve => { release = resolve; });
  f.state.beforeValidate = async () => { if (f.state.validations === 2) release(); await gate; };
  const service = f.service(), results = await Promise.allSettled([service.read(f.body, f.session), service.read(f.body, f.session)]);
  assert.equal(results.filter(result => result.status === 'fulfilled').length, 1);
  assert.match(results.find(result => result.status === 'rejected').reason.message, /REVISION_CHANGED/);
  f.state.beforeValidate = null;
  assert.equal((await service.read(f.body, f.session)).recordRevision, '1');
});
test('response and durable progress payload contain no neighboring party identities or source records', async () => {
  const f = fixture(), view = await f.service().read(f.body, f.session), text = JSON.stringify(view);
  for (let i = 0; i <= 20; i++) assert.equal(text.includes(a(i)), false);
  assert.equal(text.includes(h(106)), false); assert.equal(text.includes('tester'), false);
  assert.equal(view.canExecute, false);
});
test('auth package closure includes the new service and its actual runtime and typed projection imports', () => {
  for (const path of ['server/forward-progress-service.mjs', 'src/wallet/forwardProgress.ts',
    'src/wallet/linkedChainView.ts', 'src/sdk/types.ts']) {
    assert.equal(TASK_RUNTIME_SOURCE_PATHS.includes(path), true); assert.equal(sourcePathAllowed(path), true);
  }
  // The linked contract is source-packaged, not imported after type stripping.
  assert.equal(TASK_RUNTIME_SOURCE_PATHS.includes('src/sdk/linked.ts'), false);
  assert.equal(sourcePathAllowed('src/sdk/linked.ts'), true);
  assert.equal(sourcePathAllowed('src/wallet/neighbor-private-state.json'), false);
});

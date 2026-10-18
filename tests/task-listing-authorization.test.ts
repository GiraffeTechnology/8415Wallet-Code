import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { createTaskAuthorizationService, freezeNftValuationPolicy } from '../server/task-authorization.mjs';
import { MemoryCredentialStore, openEncryptedStore } from '../server/store.mjs';
import { createTaskBackgroundRunner } from '../server/task-background-runner.mjs';
import { base32, hotp, matchTotp } from '../server/crypto.mjs';
import { taskVerificationPolicyKey } from '../server/task-verification-state.mjs';
import { freezeNftListingChild, freezeTaskPolicy, normalizeNftListingAuthorizationReference, normalizeAuthorizationReference } from '../src/agent/taskContract.ts';

const a = (n: string) => `0x${n.repeat(40)}`, h = (n: string) => `0x${n.repeat(64)}`, d = (n: string) => n.repeat(64);
const epoch = 1_800_000_000_000, secret = base32(Buffer.alloc(20, 0x41)); // Synthetic local fixtures only.
const identity = { schema: '8415-task-executor/1', agentId: 'synthetic:listing', agentVersion: '1', adapterId: 'synthetic:seaport', adapterVersion: '1', implementationDigest: h('8') };
function policy(taskId = 'task:listing') {
  return { schema: '8415-agent-task/1', taskId, tenant: 'xiongan', origin: 'https://wallet.example.invalid', chainId: '1', actor: a('1'),
    expiresAt: String(epoch / 1000 + 7200), fees: { perOperationWei: '100', totalWei: '200' },
    intent: { kind: 'nft-sale', direction: 'sell', standard: 'ERC-1155', contract: a('2'), tokenId: '7', quantity: '3',
      minimumProceeds: { currency: 'USD', amountMinor: '50000', minorUnit: 2, comparison: 'gt', basis: 'net' }, marketAdapters: ['artfi:seaport'] } };
}
function valuation(priceAt = 'order-review') { return { source: 'synthetic:eth-usd', base: { chainId: '1', token: a('0'), decimals: 18 },
  quote: { currency: 'USD', decimals: 2 }, rateDecimals: 8, priceAt, validFrom: String(epoch / 1000 - 10), validUntil: String(epoch / 1000 + 3600), maxAgeSeconds: '60' }; }
function proposal(input: any, extra: any = {}) {
  return { schema: '8415-nft-listing-child/1', operationId: 'listing:1', taskDigest: input.task.digest, executorDigest: input.executor.digest,
    grantReference: input.authorization?.reference ?? input.grantReference, grantPolicyVersion: input.authorization?.grantPolicyVersion ?? input.grantPolicyVersion,
    chainId: '1', seller: a('1'), protocol: a('5'), nft: { standard: 'ERC-1155', contract: a('2'), tokenId: '7', quantity: '3' },
    adapterId: 'artfi:seaport', nativeOperationId: 'native:1', nativePlanId: 'plan:1', reviewDigest: d('6'), orderHash: h('7'), typedDataDigest: h('8'),
    counter: '0', salt: '9', expiresAt: String(epoch / 1000 + 1800), valuationPolicyDigest: input.valuationPolicy.digest, quoteEvidenceDigest: d('9'), fees: { maximumFeeWei: '0' }, ...extra };
}
function resultBinding(input: any) { return { taskDigest: input.task.digest, childDigest: input.child.digest, executorDigest: input.executor.digest,
  grantReference: input.grantReference, grantPolicyVersion: input.grantPolicyVersion, valuationPolicyDigest: input.valuationPolicy.digest,
  quoteEvidenceDigest: input.child.child.quoteEvidenceDigest, orderHash: input.child.child.orderHash, typedDataDigest: input.child.child.typedDataDigest }; }
function submission(input: any) { const c = input.child.child; return { kind: 'seaport-order', chainId: c.chainId, protocol: c.protocol, orderHash: c.orderHash }; }
function fixture(options: any = {}) {
  const state = options.state ?? { now: epoch }, store = options.store ?? new MemoryCredentialStore({ 'xiongan:tester': { secret, lastStep: -1, revision: 1 } });
  const session = { username: 'tester', account: a('1'), chainId: '1', id: 'session:synthetic', revision: 1, issuedAt: epoch, expiresAt: epoch + 900000 };
  const sessions = new Set([session]), calls = { plan: 0, verify: 0, send: 0, recover: 0, otp: 0 }, inputs: any[] = [];
  const assertSession = (s: any, c?: any) => { if (!sessions.has(s) || state.now >= s.expiresAt || c !== undefined && c?.revision !== s.revision) throw Error('AUTH_REFUSED'); };
  const listingExecution = options.noAdapter ? null : {
    async plan(input: any) { calls.plan++; return proposal(input, options.childOverride); },
    async verify(input: any) { calls.verify++; await options.onVerify?.(input);
      assert.equal(input.child.child.quoteEvidenceDigest, d('9'), 'SYNTHETIC_QUOTE_TAMPERED');
      assert.equal(input.child.child.reviewDigest, d('6'), 'SYNTHETIC_REVIEW_TAMPERED');
      assert.equal(freezeNftValuationPolicy(input.valuationPolicy.policy).digest, input.child.child.valuationPolicyDigest);
      return { ...resultBinding(input), capability: 'nft-listing-observable', ...options.verificationOverride };
    },
    async send(input: any) { calls.send++; inputs.push(input); await options.onSend?.(input); if (options.failSend) throw Error('SYNTHETIC_LOST_REPLY');
      return { ...resultBinding(input), submission: submission(input), ...options.submissionOverride }; },
    async recover(input: any) { calls.recover++; inputs.push(input); if (options.failRecover) throw Error('SYNTHETIC_EVIDENCE_UNAVAILABLE');
      return { ...resultBinding(input), state: 'submitted', submission: submission(input), ...options.recoveryOverride }; },
  };
  const service = createTaskAuthorizationService({ origin: policy().origin, tenant: 'xiongan', store, now: () => state.now,
    assertSession, async credentialFor(s: any) { const c = await store.read('xiongan:tester'); assertSession(s, c); return c; },
    assertPrincipal(p: any, c: any) { if (p.username !== 'tester' || p.account !== a('1') || p.chainId !== '1' || c !== undefined && !c?.secret) throw Error('AUTH_PRINCIPAL_REFUSED'); },
    consumeTotp(s: any, c: any, code: string) { assertSession(s, c); const step = matchTotp(c.secret, code, state.now, c.lastStep);
      if (step === null) throw Error('AUTH_REFUSED'); calls.otp++; return { ...c, lastStep: step }; },
    listingExecution, executorIdentity: listingExecution ? options.identity ?? identity : null, observationPolicy: listingExecution ? { minimumConfirmations: '2' } : null,
  });
  const call = (path: string, body: any) => service.handler(`tasks/${path}`, body, session);
  const approval = (p: any) => ({ challengeId: p.challengeId, taskDigest: p.task.digest, executorDigest: p.executor.digest,
    observationPolicyDigest: p.observationPolicy?.digest ?? null, ...(p.valuationPolicy ? { valuationPolicyDigest: p.valuationPolicy.digest, priceAt: p.valuationPolicy.policy.priceAt } : {}),
    code: p.approvalFactor === 'totp' ? hotp(secret, Math.floor(state.now / 30000)) : '' });
  const prepare = (p = policy(), v: any = valuation()) => call('prepare', { policy: p, ...(v === null ? {} : { valuationPolicy: v }) });
  const authorize = (p: any) => call('authorize', approval(p));
  // Synthetic persisted owner decision only for tests of the operational OTP gate.
  async function saveOwnerVerificationOn() {
    const scope = { origin: policy().origin, tenant: policy().tenant, username: session.username,
      account: session.account, chainId: session.chainId, agentId: (options.identity ?? identity).agentId };
    await store.transaction('xiongan:tester', (credential: any) => ({ ...credential, taskVerificationPolicies: {
      ...credential.taskVerificationPolicies,
      [taskVerificationPolicyKey(scope)]: { schema: '8415-task-human-verification/2', scope,
        mode: 'ON', revision: '1', enforcedFromRevision: '1', changes: [{ revision: '1', previousRevision: '0',
          mode: 'ON', changeId: 'A'.repeat(43), changeDigest: 'a'.repeat(64),
          scopeDigest: createHash('sha256').update(JSON.stringify(scope)).digest('hex'), credentialRevision: session.revision,
          verifiedFactors: ['password', 'verified-email'], changedAt: epoch - 1 }] } } }));
  }
  const grant = async (p = policy(), v: any = valuation()) => authorize(await prepare(p, v));
  const reserve = (g: any, c = proposal(g)) => call('reserve', { taskDigest: g.task.digest, child: c, expectedBudgetRevision: g.budget.revision });
  const operation = (g: any, c = proposal(g)) => ({ taskDigest: g.task.digest, operationId: c.operationId, childDigest: freezeNftListingChild(c).digest, expectedBudgetRevision: g.budget.revision });
  const runner = () => createTaskBackgroundRunner({ store, continuation: service.background, now: () => state.now });
  return { service, state, store, session, sessions, calls, inputs, listingExecution, call, prepare, authorize, approval, saveOwnerVerificationOn, grant, reserve, operation, runner };
}

test('valuation policy retains ArtFi sorted-key SHA256 and explicitly binds every price policy field', () => {
  const v = valuation(), f = freezeNftValuationPolicy(v);
  const sorted = (x: any): any => x && typeof x === 'object' ? Object.fromEntries(Object.keys(x).sort().map(k => [k, sorted(x[k])])) : x;
  assert.equal(f.digest, createHash('sha256').update(JSON.stringify(sorted(v))).digest('hex'));
  assert.equal(f.digest, 'c5166f9a1e5f6f447a8867a1a5339a34c94d21c434f82632123073294735e034'); // ArtFi PR161 kernel vector.
  assert.equal(f.digest.length, 64); assert.ok(Object.isFrozen(f.policy.base));
  assert.equal(freezeNftValuationPolicy(Object.fromEntries(Object.entries(v).reverse())).digest, f.digest);
  for (const change of [{ source: 'other' }, { base: { ...v.base, chainId: '8453' } }, { base: { ...v.base, token: a('a') } },
    { base: { ...v.base, decimals: 6 } }, { rateDecimals: 9 }, { priceAt: 'settlement' }, { validFrom: String(epoch / 1000) },
    { validUntil: String(epoch / 1000 + 3601) }, { maxAgeSeconds: '61' }]) assert.notEqual(freezeNftValuationPolicy({ ...v, ...change }).digest, f.digest);
  const { priceAt: _priceAt, ...missing } = v; assert.throws(() => freezeNftValuationPolicy(missing), /TASK_REQUEST_REFUSED/);
  assert.throws(() => freezeNftValuationPolicy({ ...v, priceAt: 'now' }), /TASK_VALUATION_POLICY_REFUSED/);
});

test('saved ON approval binds task, valuation digest and priceAt with one OTP; dispatch retains its own gate', async () => {
  const f = fixture(); await f.saveOwnerVerificationOn(); const p = await f.prepare();
  assert.equal(p.approvalFactor, 'totp');
  assert.equal(p.task.digest, freezeTaskPolicy(policy()).digest); assert.equal((await f.store.read('xiongan:tester')).lastStep, -1);
  for (const bad of [{ ...f.approval(p), valuationPolicyDigest: d('a') }, { ...f.approval(p), priceAt: 'settlement' },
    (({ valuationPolicyDigest: _v, priceAt: _p, ...old }) => old)(f.approval(p))])
    await assert.rejects(f.call('authorize', bad), /TASK_APPROVAL_CHALLENGE_REFUSED/);
  assert.equal(f.calls.otp, 0); assert.equal((await f.store.read('xiongan:tester')).lastStep, -1);
  const g = await f.authorize(p); assert.equal(g.valuationPolicy.digest, p.valuationPolicy.digest); assert.equal(g.budget.schema, '8415-task-budget/2');
  assert.deepEqual(normalizeNftListingAuthorizationReference(g.authorization), g.authorization);
  assert.throws(() => normalizeAuthorizationReference(g.authorization), /TASK_SCHEMA_REFUSED/);
  assert.equal(f.calls.otp, 1); await assert.rejects(f.authorize(p), /TASK_APPROVAL_CHALLENGE_REFUSED/);
  const r = await f.reserve(g);
  await assert.rejects(f.call('execute', f.operation(r)), /TASK_OPERATION_VERIFICATION_REQUIRED/);
  assert.equal((await f.call('status', { taskDigest: g.task.digest })).budget.reservations[0].status, 'reserved');
  assert.equal(f.calls.otp, 1); assert.equal(f.calls.send, 0);
});

test('initial ON listing approval and dispatch stay unlocked without consuming or inventing OTP evidence', async () => {
  const f = fixture(), credential = await f.store.read('xiongan:tester'), p = await f.prepare();
  const evaluation = { state: 'NOT_EVALUATED', reason: 'pre-operational-default-on', policyRevision: '0' };
  assert.equal(p.approvalFactor, 'preoperational-default-on'); assert.deepEqual(p.approvalEvaluation, evaluation);
  await assert.rejects(f.call('authorize', { ...f.approval(p), code: hotp(secret, Math.floor(f.state.now / 30000)) }), /TASK_APPROVAL_CODE_NOT_REQUIRED/);
  const g = await f.authorize(p), r = await f.reserve(g), sent = await f.call('execute', f.operation(r));
  assert.equal(sent.outcome, 'submitted'); assert.equal(f.calls.otp, 0); assert.equal(f.calls.send, 1);
  assert.deepEqual(await f.store.read('xiongan:tester'), credential);
  const grantKey = (await f.service.background.list()).entries[0], saved = await f.store.read(grantKey);
  assert.equal(saved.approvalFactor, 'preoperational-default-on'); assert.deepEqual(saved.approvalEvaluation, evaluation);
  const operationKey = `task-operation:${createHash('sha256').update(JSON.stringify(['1', a('1'), 'listing:1'])).digest('hex')}`;
  const operation = await f.store.read(operationKey);
  assert.equal(operation.humanVerification, undefined); assert.deepEqual(operation.humanVerificationEvaluation, evaluation);
});

test('old grant v1 is never silently upgraded and old nft-sale remains explicitly blocked', async () => {
  const f = fixture(), p = await f.prepare(policy(), null);
  await assert.rejects(f.prepare(policy(), valuation()), /TASK_VALUATION_POLICY_REAUTHORIZATION_REQUIRED/);
  const g = await f.authorize(p); assert.equal(g.valuationPolicy, undefined); assert.equal(g.budget.schema, '8415-task-budget/1');
  const blocked = await f.call('resume', { taskDigest: g.task.digest });
  assert.equal(blocked.continuation.code, 'TASK_VALUATION_POLICY_AUTHORIZATION_REQUIRED'); assert.equal(f.calls.plan, 0); assert.equal(f.calls.send, 0);
  await assert.rejects(f.reserve(g, proposal({ ...g, valuationPolicy: freezeNftValuationPolicy(valuation()) })), /TASK_VALUATION_POLICY_AUTHORIZATION_REQUIRED/);
  await assert.rejects(f.prepare(policy(), valuation()), /TASK_ALREADY_EXISTS/);
  const p2 = policy('task:other'); f.state.now += 30000;
  assert.equal((await f.grant(p2)).effectiveStatus, 'authorized');
});

test('pending valuation policy cannot drift, and mismatched task or source policy cannot borrow a challenge', async () => {
  const f = fixture(), p = await f.prepare();
  await assert.rejects(f.prepare(policy(), { ...valuation(), maxAgeSeconds: '600' }), /TASK_VALUATION_POLICY_REAUTHORIZATION_REQUIRED/);
  await assert.rejects(f.prepare(policy('task:bad-chain'), { ...valuation(), base: { ...valuation().base, chainId: '8453' } }), /TASK_VALUATION_POLICY_BINDING_REFUSED/);
  const second = await f.prepare(policy('task:second'), { ...valuation(), source: 'other' });
  await assert.rejects(f.call('authorize', { ...f.approval(p), taskDigest: second.task.digest, valuationPolicyDigest: second.valuationPolicy.digest }), /TASK_APPROVAL_CHALLENGE_REFUSED/);
  assert.equal(f.calls.otp, 0); assert.equal((await f.authorize(p)).effectiveStatus, 'authorized');
});

test('one TOTP cannot authorize two concurrent different valuation grants', async () => {
  const f = fixture(); await f.saveOwnerVerificationOn();
  const a = await f.prepare(), b = await f.prepare(policy('task:second'), { ...valuation(), priceAt: 'settlement' });
  assert.equal(a.approvalFactor, 'totp'); assert.equal(b.approvalFactor, 'totp');
  const result = await Promise.allSettled([f.authorize(a), f.authorize(b)]);
  assert.equal(result.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.calls.otp, 1);
  assert.equal(result.filter(r => r.status === 'rejected' && /AUTH_REFUSED/.test(r.reason.message)).length, 1);
});

test('settlement-time USD promise remains blocked and is not reinterpreted as order-review', async () => {
  const f = fixture(), g = await f.grant(policy(), valuation('settlement'));
  assert.equal(g.valuationPolicy.policy.priceAt, 'settlement');
  assert.equal((await f.call('resume', { taskDigest: g.task.digest })).continuation.code, 'TASK_FUTURE_USD_PRICE_NOT_GUARANTEED');
  await assert.rejects(f.reserve(g), /TASK_CHILD_OUTSIDE_SCOPE/); assert.equal(f.calls.plan, 0); assert.equal(f.calls.send, 0);
});

test('a policy-authorized task stays blocked when the native listing adapter is not connected', async () => {
  const f = fixture({ noAdapter: true }), g = await f.grant();
  assert.equal((await f.call('resume', { taskDigest: g.task.digest })).continuation.code, 'TASK_LISTING_ADAPTER_NOT_CONNECTED');
  assert.equal(g.capabilities.executable, false); assert.equal(f.calls.send, 0);
});

test('quote or native-review tampering never reaches signing, despite an in-scope quantity reservation', async () => {
  for (const extra of [{ quoteEvidenceDigest: d('a') }, { reviewDigest: d('b') }]) {
    const f = fixture(), g = await f.grant(), c = proposal(g, extra), r = await f.reserve(g, c);
    await assert.rejects(f.call('execute', f.operation(r, c)), /SYNTHETIC_.*_TAMPERED/);
    assert.equal(f.calls.send, 0); assert.equal((await f.call('status', { taskDigest: g.task.digest })).budget.reservations[0].status, 'reserved');
  }
});

test('verifier result must bind the same child, valuation, quote, order and grant version', async () => {
  for (const verificationOverride of [{ childDigest: h('a') }, { valuationPolicyDigest: d('a') }, { quoteEvidenceDigest: d('a') },
    { orderHash: h('a') }, { typedDataDigest: h('a') }, { grantReference: 'grant:other' }, { grantPolicyVersion: '2' }, { capability: 'exact-operation-observable' }]) {
    const f = fixture({ verificationOverride }), g = await f.grant(), r = await f.reserve(g);
    await assert.rejects(f.call('execute', f.operation(r)), /TASK_LISTING_VERIFICATION_REFUSED/); assert.equal(f.calls.send, 0);
  }
});

test('listing reserve uses shared CAS and exact task quantity, without borrowing a transfer nonce', async () => {
  const f = fixture(), g = await f.grant();
  for (const extra of [{ nft: { ...proposal(g).nft, quantity: '2' } }, { nft: { ...proposal(g).nft, quantity: '4' } },
    { fees: { maximumFeeWei: '101' } }, { valuationPolicyDigest: d('a') }, { executorDigest: h('a') }, { grantPolicyVersion: '2' }])
    await assert.rejects(f.reserve(g, proposal(g, extra)), /TASK_CHILD_OUTSIDE_SCOPE/);
  const results = await Promise.allSettled([f.reserve(g), f.reserve(g)]); assert.equal(results.filter(r => r.status === 'fulfilled').length, 1);
  const r = await f.call('status', { taskDigest: g.task.digest }); assert.equal(r.budget.reservations.length, 1); assert.equal(r.budget.reservations[0].units, '3');
  await assert.rejects(f.reserve(r, proposal(r, { operationId: 'listing:2', orderHash: h('a') })), /TASK_TOTAL_ASSET_LIMIT/);
  const calls = await Promise.allSettled([f.call('execute', f.operation(r)), f.call('execute', f.operation(r))]);
  assert.equal(calls.filter(r => r.status === 'fulfilled').length, 1); assert.equal(f.calls.send, 1);
});

test('lost listing signature/publication result never releases quota, retries send or replans', async () => {
  const f = fixture({ failSend: true, failRecover: true }), g = await f.grant();
  const unknown = await f.call('resume', { taskDigest: g.task.digest }); assert.equal(unknown.outcome, 'outcome-unknown');
  await assert.rejects(f.call('cancel-reservation', f.operation(unknown)), /TASK_UNCERTAIN_RESERVATION_CANNOT_RELEASE/);
  await assert.rejects(f.call('execute', f.operation(unknown)), /TASK_SEND_ATTEMPT_REFUSED/);
  for (let i = 0; i < 3; i++) await assert.rejects(f.call('resume', { taskDigest: g.task.digest }), /SYNTHETIC_EVIDENCE_UNAVAILABLE/);
  assert.equal(f.calls.plan, 1); assert.equal(f.calls.verify, 1); assert.equal(f.calls.send, 1); assert.equal(f.calls.recover, 3);
  assert.equal((await f.call('status', { taskDigest: g.task.digest })).budget.reservations[0].units, '3');
});

test('a fake transaction hash or mismatched order publication cannot become a listing submission', async () => {
  for (const submissionOverride of [{ transactionHash: h('a') }, { submission: { kind: 'seaport-order', chainId: '1', protocol: a('5'), orderHash: h('b') } },
    { submission: { kind: 'seaport-order', chainId: '1', protocol: a('5'), orderHash: h('7'), transactionHash: h('a') } }]) {
    const f = fixture({ submissionOverride }), g = await f.grant(), r = await f.reserve(g), result = await f.call('execute', f.operation(r));
    assert.equal(result.outcome, 'outcome-unknown'); assert.equal('transactionHash' in result.budget.reservations[0], false);
    assert.equal(f.calls.send, 1);
  }
});

test('published order remains listed-awaiting-evidence after revoke; no cancel, relist or quota release is implied', async () => {
  const f = fixture(), g = await f.grant(), published = await f.call('resume', { taskDigest: g.task.digest });
  assert.equal(published.completion.state, 'listed-awaiting-evidence'); assert.equal(published.completion.fresh, false);
  const revoked = await f.call('revoke', { taskDigest: g.task.digest, expectedGrantPolicyVersion: '1' });
  assert.equal(revoked.effectiveStatus, 'revoked'); assert.equal(revoked.listing.revocationCancelsPublishedOrder, false);
  assert.deepEqual(revoked.budget, published.budget); assert.equal(revoked.budget.reservations[0].submission.kind, 'seaport-order');
  assert.equal((await f.call('resume', { taskDigest: g.task.digest })).continuation.state, 'listed-awaiting-evidence');
  await assert.rejects(f.call('cancel-reservation', f.operation(revoked, proposal(g))), /TASK_UNCERTAIN_RESERVATION_CANNOT_RELEASE/);
  await assert.rejects(f.call('observe', f.operation(revoked, proposal(g))), /TASK_LISTING_OBSERVER_NOT_CONNECTED/);
  assert.equal(f.calls.send, 1); assert.equal(f.calls.plan, 1);
});

test('revocation and factor/policy expiry during verification block before the durable signing boundary', async () => {
  for (const reason of ['revoke', 'factor', 'policy-expiry']) {
    let f: ReturnType<typeof fixture>, g: any;
    f = fixture({ onVerify: async () => {
      if (reason === 'revoke') await f.call('revoke', { taskDigest: g.task.digest, expectedGrantPolicyVersion: '1' });
      else if (reason === 'factor') await f.store.transaction('xiongan:tester', (c: any) => ({ ...c, revision: 2 }));
      else { f.state.now += 3600001; f.session.expiresAt += 7200000; }
    } });
    g = await f.grant(); const r = await f.reserve(g);
    await assert.rejects(f.call('execute', f.operation(r)), /TASK_GRANT_REVOKED|AUTH_REFUSED|TASK_CHILD_OUTSIDE_SCOPE|TASK_VALUATION_POLICY_EXPIRED/);
    assert.equal(f.calls.send, 0);
  }
});

test('queued revoke after unknown persistence still wins before the sole send callback', async () => {
  let revoke: (() => Promise<any>) | null = null, pending: Promise<any> | null = null;
  class RevokeStore extends MemoryCredentialStore {
    constructor(data: any) { super(data); }
    async persist(data: any) {
      if (revoke && Object.values(data).some((v: any) => v?.schema === '8415-task-operation/2' && v.status === 'outcome-unknown')) {
        const action = revoke; revoke = null; pending = action();
      }
    }
  }
  const store = new RevokeStore({ 'xiongan:tester': { secret, lastStep: -1, revision: 1 } }), f = fixture({ store }), g = await f.grant(), r = await f.reserve(g);
  revoke = () => f.call('revoke', { taskDigest: g.task.digest, expectedGrantPolicyVersion: '1' });
  await assert.rejects(f.call('execute', f.operation(r)), /TASK_GRANT_REVOKED/); await pending;
  assert.equal(f.calls.send, 0); const current = await f.call('status', { taskDigest: g.task.digest });
  assert.equal(current.budget.reservations[0].status, 'outcome-unknown');
  await assert.rejects(f.call('cancel-reservation', f.operation(current, proposal(g))), /TASK_UNCERTAIN_RESERVATION_CANNOT_RELEASE/);
});

test('read-only recovery after revocation uses the recorded attempt version, never the new revocation version', async () => {
  const f = fixture({ failSend: true }), g = await f.grant(), unknown = await f.call('resume', { taskDigest: g.task.digest });
  const revoked = await f.call('revoke', { taskDigest: g.task.digest, expectedGrantPolicyVersion: '1' });
  const recovered = await f.call('recover', f.operation(revoked, proposal(g)));
  assert.equal(recovered.effectiveStatus, 'revoked'); assert.equal(recovered.authorization.grantPolicyVersion, '2');
  assert.equal(f.inputs.at(-1).grantPolicyVersion, '1'); assert.equal(recovered.outcome, 'submitted');
  assert.equal(recovered.budget.reservations[0].units, unknown.budget.reservations[0].units); assert.equal(f.calls.send, 1);
});

test('unattempted cancellation keeps its operation tombstone and is safe after revocation', async () => {
  const f = fixture(), g = await f.grant(), r = await f.reserve(g);
  await f.call('revoke', { taskDigest: g.task.digest, expectedGrantPolicyVersion: '1' });
  const cancelled = await f.call('cancel-reservation', f.operation(r));
  assert.equal(cancelled.budget.reservations[0].status, 'cancelled'); assert.equal(cancelled.budget.reservations[0].submission, null); assert.equal(f.calls.send, 0);
});

test('shared background runner continues approved listing after logout without a second user authorization', async () => {
  const f = fixture(), credential = await f.store.read('xiongan:tester'), g = await f.grant(), runner = f.runner(); f.sessions.clear();
  assert.equal(g.humanVerification.mode, 'ON'); assert.equal(g.humanVerification.revision, '0');
  assert.equal((await runner.tick()).results[0].state, 'submitted'); f.state.now += 5000;
  assert.equal((await runner.tick()).results[0].state, 'listed-awaiting-evidence');
  f.state.now += 600000; await runner.tick(); assert.equal(f.calls.send, 1); assert.equal(f.calls.plan, 1); assert.equal(f.calls.otp, 0);
  assert.deepEqual(await f.store.read('xiongan:tester'), credential);
  f.sessions.add(f.session); assert.equal((await f.call('status', { taskDigest: g.task.digest })).budget.reservations.length, 1); await runner.stop();
});

test('encrypted restart retains unknown listing and recovers read-only under the original grant/executor', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'wallet-listing-')), path = join(directory, 'state.enc'), key = Buffer.alloc(32, 0x39);
  let store: any;
  try {
    store = await openEncryptedStore(path, key); await store.transaction('xiongan:tester', () => ({ secret, lastStep: -1, revision: 1 }));
    const f = fixture({ store, failSend: true }), g = await f.grant(); await f.call('resume', { taskDigest: g.task.digest });
    await f.call('revoke', { taskDigest: g.task.digest, expectedGrantPolicyVersion: '1' }); await store.close(); store = await openEncryptedStore(path, key);
    const restored = fixture({ store }), runner = restored.runner(); restored.sessions.clear();
    assert.equal((await runner.tick()).results[0].state, 'submitted');
    assert.equal(restored.calls.send, 0); assert.equal(restored.calls.plan, 0); assert.equal(restored.calls.recover, 1);
    assert.equal(restored.inputs[0].grantPolicyVersion, '1'); await runner.stop();
  } finally { if (store) await store.close(); await rm(directory, { recursive: true, force: true }); }
});


test('a revoke while publication is in flight is shown on an unknown response without releasing the order', async () => {
  let f: ReturnType<typeof fixture>, g: any;
  f = fixture({ failSend: true, onSend: async () => { await f.call('revoke', { taskDigest: g.task.digest, expectedGrantPolicyVersion: '1' }); } });
  g = await f.grant(); const progress = await f.call('resume', { taskDigest: g.task.digest });
  assert.equal(progress.outcome, 'outcome-unknown'); assert.equal(progress.effectiveStatus, 'revoked');
  assert.equal(progress.authorization.grantPolicyVersion, '2'); assert.equal(progress.budget.reservations[0].units, '3'); assert.equal(f.calls.send, 1);
});

test('captured listing methods cannot be replaced under the reviewed executor identity', async () => {
  const f = fixture(), g = await f.grant();
  for (const method of ['plan', 'verify', 'send', 'recover']) (f.listingExecution as any)[method] = () => { throw Error('MUTATED_ADAPTER'); };
  assert.equal((await f.call('resume', { taskDigest: g.task.digest })).outcome, 'submitted'); assert.equal(f.calls.send, 1);
});


test('malformed valuation requests and executable policy getters are rejected before any OTP use', async () => {
  const f = fixture();
  await assert.rejects(f.call('prepare', null), /TASK_REQUEST_REFUSED/);
  await assert.rejects(f.call('authorize', null), /TASK_REQUEST_REFUSED/);
  let invoked = false;
  const bad = { ...valuation(), get priceAt() { invoked = true; return 'order-review'; } };
  await assert.rejects(f.prepare(policy(), bad), /TASK_REQUEST_REFUSED/);
  assert.equal(invoked, false); assert.equal(f.calls.otp, 0);
});

test('direct execute rechecks settlement priceAt even if an adversarial persisted reservation bypassed reserve', async () => {
  const f = fixture(), g = await f.grant(policy(), valuation('settlement')), c = freezeNftListingChild(proposal(g));
  const grantKey = (await f.service.background.list()).entries[0];
  const key = (kind: string, value: any) => `task-${kind}:${createHash('sha256').update(JSON.stringify(value)).digest('hex')}`;
  const okey = key('operation', ['1', a('1'), c.child.operationId]);
  const orderKey = key('listing-order', ['1', a('1'), a('5'), c.child.orderHash]);
  // Synthetic corrupted/restored state only. The public reserve endpoint refuses this record.
  await f.store.transactionMany([grantKey, okey, orderKey], (values: any) => ({
    [grantKey]: { ...values[grantKey], budget: { ...g.budget, revision: '1', reservations: [{ operationId: c.child.operationId,
      childDigest: c.digest, feeWei: '0', units: '3', status: 'reserved', submission: null }] } },
    [okey]: { schema: '8415-task-operation/2', grantKey, child: c, status: 'reserved', orderKey, observationRevision: '0' },
    [orderKey]: { operationKey: okey, taskDigest: g.task.digest, childDigest: c.digest, permanent: false },
  }));
  await assert.rejects(f.call('execute', { taskDigest: g.task.digest, operationId: c.child.operationId, childDigest: c.digest,
    expectedBudgetRevision: '1' }), /TASK_CHILD_OUTSIDE_SCOPE/);
  assert.equal(f.calls.verify, 0); assert.equal(f.calls.send, 0);
});

test('recovery rejects wrong-chain, protocol and order references without rewriting the unknown reservation', async () => {
  for (const change of [{ chainId: '8453' }, { protocol: a('6') }, { orderHash: h('a') }]) {
    const f = fixture({ failSend: true, recoveryOverride: { submission: { kind: 'seaport-order', chainId: '1', protocol: a('5'), orderHash: h('7'), ...change } } });
    const g = await f.grant(), unknown = await f.call('resume', { taskDigest: g.task.digest });
    await assert.rejects(f.call('recover', f.operation(unknown)), /TASK_LISTING_SUBMISSION_REFUSED/);
    const current = await f.call('status', { taskDigest: g.task.digest }); assert.deepEqual(current.budget, unknown.budget); assert.equal(f.calls.send, 1);
  }
});

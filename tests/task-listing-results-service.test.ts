import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createTaskAuthorizationService, freezeNftValuationPolicy } from '../server/task-authorization.mjs';
import { MemoryCredentialStore, openEncryptedStore } from '../server/store.mjs';
import { createTaskBackgroundRunner } from '../server/task-background-runner.mjs';
import { base32, hotp, matchTotp } from '../server/crypto.mjs';
import { freezeNftListingChild } from '../src/agent/taskContract.ts';

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
    listingResults: options.listingResults ?? null, listingExecution, executorIdentity: listingExecution ? options.identity ?? identity : null, observationPolicy: listingExecution ? { minimumConfirmations: '2' } : null,
  });
  const call = (path: string, body: any) => service.handler(`tasks/${path}`, body, session);
  const approval = (p: any) => ({ challengeId: p.challengeId, taskDigest: p.task.digest, executorDigest: p.executor.digest,
    observationPolicyDigest: p.observationPolicy?.digest ?? null, ...(p.valuationPolicy ? { valuationPolicyDigest: p.valuationPolicy.digest, priceAt: p.valuationPolicy.policy.priceAt } : {}),
    code: hotp(secret, Math.floor(state.now / 30000)) });
  const prepare = (p = policy(), v: any = valuation()) => call('prepare', { policy: p, ...(v === null ? {} : { valuationPolicy: v }) });
  const authorize = (p: any) => call('authorize', approval(p));
  const grant = async (p = policy(), v: any = valuation()) => authorize(await prepare(p, v));
  const reserve = (g: any, c = proposal(g)) => call('reserve', { taskDigest: g.task.digest, child: c, expectedBudgetRevision: g.budget.revision });
  const operation = (g: any, c = proposal(g)) => ({ taskDigest: g.task.digest, operationId: c.operationId, childDigest: freezeNftListingChild(c).digest, expectedBudgetRevision: g.budget.revision });
  const runner = () => createTaskBackgroundRunner({ store, continuation: service.background, now: () => state.now });
  return { service, state, store, session, sessions, calls, inputs, listingExecution, call, prepare, authorize, approval, grant, reserve, operation, runner };
}


import { listingEvidenceFixture } from './helpers/listing-results-fixture.mjs';

test('durable consumer -> service status/list shows listed, partial and observed depth without changing task budget', async () => {
  const evidence = listingEvidenceFixture(), f = fixture({ listingResults: evidence.results }), grant = await f.grant();
  const published = await f.call('resume', { taskDigest: grant.task.digest });
  assert.equal(published.completion.state, 'listed-awaiting-evidence'); assert.equal(evidence.state.scans, 0);
  let read = await f.call('status', { taskDigest: grant.task.digest });
  assert.equal(read.listing.result.state, 'unknown'); assert.equal(read.completion.fresh, false); assert.equal(evidence.state.scans, 0);
  read = await f.call('resume', { taskDigest: grant.task.digest });
  assert.ok(read.listing.result, JSON.stringify(read.listing)); assert.equal(read.listing.result.state, 'listed'); assert.equal(read.listing.result.summary.aggregate.quantity, '0');
  evidence.state.quantities.push('2'); evidence.state.duplicate = true;
  read = await f.call('resume', { taskDigest: grant.task.digest });
  assert.equal(read.listing.result.state, 'partial'); assert.equal(read.completion.state, 'listing-partial');
  assert.equal(read.listing.result.summary.aggregate.quantity, '2'); assert.equal(read.completion.fresh, true);
  const scans = evidence.state.scans, budget = read.budget;
  const list = await f.call('list', {}); assert.equal(list.tasks[0].listing.result.summary.aggregate.quantity, '2');
  assert.equal(evidence.state.scans, scans); // List/status revalidate; they never discover another page.
  evidence.state.quantities.push('1'); read = await f.call('resume', { taskDigest: grant.task.digest });
  assert.equal(read.listing.result.state, 'observed-at-depth'); assert.equal(read.completion.state, 'listing-observed-at-depth');
  assert.equal(read.listing.result.summary.availableFillCount, 2); assert.equal(read.listing.result.summary.finality, 'NOT_EVALUATED');
  assert.deepEqual(read.budget, budget); assert.equal(f.calls.send, 1); assert.equal(f.calls.plan, 1); assert.equal(f.calls.otp, 1);
});

test('background observes after logout, revoke and expiry and keeps checking full quantity for reorgs', async () => {
  const evidence = listingEvidenceFixture(), f = fixture({ listingResults: evidence.results }), grant = await f.grant(), runner = f.runner();
  await runner.tick(); evidence.state.quantities.push('3');
  await f.call('revoke', { taskDigest: grant.task.digest, expectedGrantPolicyVersion: '1' }); f.sessions.clear();
  f.state.now += 8000000;
  let tick = await runner.tick(); assert.equal(tick.results[0].state, 'listing-observed-at-depth');
  assert.equal(evidence.state.scans, 1); assert.equal(f.calls.send, 1);
  evidence.state.reorg = true; f.state.now += 5000;
  tick = await runner.tick(); assert.equal(tick.results[0].state, 'listing-reorg');
  assert.equal(evidence.state.scans, 2, 'each continuation attempts at most one bounded scan');
  assert.equal(f.calls.send, 1); assert.equal(f.calls.plan, 1); assert.equal(f.calls.otp, 1);
});

test('unavailable canonical reads downgrade to unknown with no current aggregate; reorg removes quantity', async () => {
  const evidence = listingEvidenceFixture(), f = fixture({ listingResults: evidence.results }), grant = await f.grant();
  await f.call('resume', { taskDigest: grant.task.digest }); evidence.state.quantities.push('3');
  await f.call('resume', { taskDigest: grant.task.digest }); evidence.state.offline = true;
  let read = await f.call('status', { taskDigest: grant.task.digest });
  assert.equal(read.listing.result.state, 'unknown'); assert.equal(read.listing.result.summary.aggregate, null); assert.equal(read.completion.fresh, false);
  evidence.state.offline = false; evidence.state.reorg = true;
  read = await f.call('status', { taskDigest: grant.task.digest });
  assert.equal(read.listing.result.state, 'reorg'); assert.equal(read.listing.result.summary.lastKnownAggregate.quantity, '0');
  assert.equal(read.listing.result.summary.aggregate, null); assert.equal(read.completion.fresh, false);
  assert.equal(f.calls.send, 1);
});

test('untrusted HTTP evidence, wrong owner and revoked execution never enter observation or signing', async () => {
  const evidence = listingEvidenceFixture(), f = fixture({ listingResults: evidence.results }), grant = await f.grant();
  await f.call('resume', { taskDigest: grant.task.digest });
  for (const route of ['status', 'resume']) await assert.rejects(f.call(route, { taskDigest: grant.task.digest, verified: true, quantity: '3' }), /TASK_REQUEST_REFUSED/);
  assert.equal(evidence.state.scans, 0);
  const invalid = { ...f.session, account: a('9') };
  await assert.rejects(f.service.handler('tasks/status', { taskDigest: grant.task.digest }, invalid));
  await f.call('revoke', { taskDigest: grant.task.digest, expectedGrantPolicyVersion: '1' });
  const status = await f.call('status', { taskDigest: grant.task.digest });
  await assert.rejects(f.call('execute', { taskDigest: grant.task.digest, operationId: status.budget.reservations[0].operationId,
    childDigest: status.budget.reservations[0].childDigest, expectedBudgetRevision: status.budget.revision }), /TASK_GRANT_REVOKED/);
  assert.equal(f.calls.send, 1); assert.equal(f.calls.otp, 1);
});

test('consumer and service restart read persisted fills without a new signature or scanning', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'listing-results-')), key = Buffer.alloc(32, 0x22), path = join(dir, 'observation.enc');
  let store = await openEncryptedStore(path, key); t.after(async () => { await store.close(); await rm(dir, { recursive: true, force: true }); });
  let evidence = listingEvidenceFixture(store); const f = fixture({ listingResults: evidence.results }), g = await f.grant();
  await f.call('resume', { taskDigest: g.task.digest }); evidence.state.quantities.push('3');
  const first = await f.call('resume', { taskDigest: g.task.digest });
  await store.close(); store = await openEncryptedStore(path, key); evidence = listingEvidenceFixture(store);
  const restarted = fixture({ store: f.store, state: f.state, listingResults: evidence.results });
  const current = await restarted.call('status', { taskDigest: g.task.digest });
  assert.deepEqual(current.listing.result.summary.aggregate, first.listing.result.summary.aggregate);
  assert.equal(evidence.state.scans, 0); assert.equal(restarted.calls.send, 0); assert.equal(restarted.calls.otp, 0);
});

test('session revocation during an asynchronous observation read prevents returning task results', async () => {
  const evidence = listingEvidenceFixture(); let entered!: () => void, release!: () => void;
  const started = new Promise<void>(resolve => { entered = resolve; }), held = new Promise<void>(resolve => { release = resolve; });
  let block = false;
  const results = { scan: evidence.results.scan, async read(input: any) { if (block) { entered(); await held; } return evidence.results.read(input); } };
  const f = fixture({ listingResults: results }), grant = await f.grant(); await f.call('resume', { taskDigest: grant.task.digest });
  block = true; const pending = f.call('status', { taskDigest: grant.task.digest }); await started;
  f.sessions.clear(); release(); await assert.rejects(pending, /AUTH_REFUSED/);
  assert.equal(evidence.state.scans, 0); assert.equal(f.calls.send, 1);
});

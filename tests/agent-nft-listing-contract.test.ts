import test from 'node:test';
import assert from 'node:assert/strict';
import {
  freezeTaskPolicy, freezeNftListingChild, parseNftListingChild, assessNftListingScope,
  emptyNftListingBudget, reserveNftListingBudget, markTaskSendAttempt, noteNftListingSubmission,
  cancelUnattemptedReservation, normalizeTaskBudget, normalizeTaskBudgetPage, assembleTaskBudgetPages,
  emptyTaskBudget, noteTaskSubmission, freezeChildOperation, normalizeExistingOperation,
} from '../src/agent/taskContract.ts';
const a = (n: string) => `0x${n.repeat(40)}`, h = (n: string) => `0x${n.repeat(64)}`, d = (n: string) => n.repeat(64);
function task() { return freezeTaskPolicy({ schema: '8415-agent-task/1', taskId: 'listing:whole-quantity', tenant: 'xiongan',
  origin: 'https://wallet.example.invalid', chainId: '1', actor: a('1'), expiresAt: '10000', fees: { perOperationWei: '100', totalWei: '200' },
  intent: { kind: 'nft-sale', direction: 'sell', standard: 'ERC-1155', contract: a('2'), tokenId: '7', quantity: '3',
    minimumProceeds: { currency: 'USD', minorUnit: 2, amountMinor: '50000', comparison: 'gt', basis: 'net' }, marketAdapters: ['artfi:seaport'] } }); }
function binding() { return { taskDigest: task().digest, executorDigest: h('3'), grantReference: 'grant:fixture', grantPolicyVersion: '1', valuationPolicyDigest: d('4'), priceAt: 'order-review' as const }; }
function child(extra: any = {}) { return freezeNftListingChild({ schema: '8415-nft-listing-child/1', operationId: 'listing:1', ...binding(),
  priceAt: undefined, chainId: '1', seller: a('1'), protocol: a('5'), nft: { standard: 'ERC-1155', contract: a('2'), tokenId: '7', quantity: '3' },
  adapterId: 'artfi:seaport', nativeOperationId: 'native:1', nativePlanId: 'plan:1', reviewDigest: d('6'), orderHash: h('7'),
  typedDataDigest: h('8'), counter: '0', salt: '9', expiresAt: '9000', quoteEvidenceDigest: d('9'), fees: { maximumFeeWei: '0' }, ...extra }); }
// Build only exact known schema fields; priceAt is covered by the approved valuation digest, not duplicated in a child.
const listing = (extra: any = {}) => {
  const { priceAt: _priceAt, ...b } = binding();
  return freezeNftListingChild({ schema: '8415-nft-listing-child/1', operationId: 'listing:1', ...b,
    chainId: '1', seller: a('1'), protocol: a('5'), nft: { standard: 'ERC-1155', contract: a('2'), tokenId: '7', quantity: '3' },
    adapterId: 'artfi:seaport', nativeOperationId: 'native:1', nativePlanId: 'plan:1', reviewDigest: d('6'), orderHash: h('7'),
    typedDataDigest: h('8'), counter: '0', salt: '9', expiresAt: '9000', quoteEvidenceDigest: d('9'), fees: { maximumFeeWei: '0' }, ...extra });
};
const submission = () => ({ kind: 'seaport-order', chainId: '1', protocol: a('5'), orderHash: h('7') });

test('legacy task v1 bytes remain unchanged and listing is a separate versioned child', () => {
  const t = task();
  assert.equal(t.digest, '0xcc3a672f6ac32ae9b00090b8c072184ff74acc6d48d6c696cf4d01e17692841e');
  const c = listing(); assert.deepEqual(parseNftListingChild(JSON.stringify(c.child)), c);
  assert.ok(Object.isFrozen(c.child.nft)); assert.equal('operation' in c.child, false);
  assert.throws(() => freezeChildOperation(c.child), /TASK_SCHEMA_REFUSED/);
  assert.throws(() => child(), /TASK_SCHEMA_REFUSED/);
  for (const field of ['buyer', 'nonce', 'transactionHash', 'signature', 'approved', 'priceAt'])
    assert.throws(() => freezeNftListingChild({ ...c.child, [field]: 'untrusted' }), /TASK_SCHEMA_REFUSED/);
});

test('every listing binding and quote mutation changes its child digest', () => {
  const original = listing();
  for (const extra of [{ operationId: 'listing:2' }, { executorDigest: h('a') }, { taskDigest: h('b') }, { grantReference: 'grant:other' },
    { grantPolicyVersion: '2' }, { chainId: '8453' }, { seller: a('4') }, { protocol: a('6') }, { adapterId: 'other' },
    { nativeOperationId: 'native:2' }, { nativePlanId: 'plan:2' }, { reviewDigest: d('a') }, { orderHash: h('a') },
    { typedDataDigest: h('a') }, { counter: '1' }, { salt: '10' }, { expiresAt: '9001' }, { valuationPolicyDigest: d('a') },
    { quoteEvidenceDigest: d('a') }, { fees: { maximumFeeWei: '1' } }, { nft: { ...original.child.nft, quantity: '2' } }])
    assert.notEqual(listing(extra).digest, original.digest);
  let invoked = false;
  assert.throws(() => freezeNftListingChild({ ...original.child, get salt() { invoked = true; return '1'; } }), /TASK_SCHEMA_REFUSED/);
  assert.equal(invoked, false);
});

test('listing scope requires the same grant, exact task quantity and explicitly agreed priceAt', () => {
  const t = task(), c = listing();
  assert.equal(assessNftListingScope(t, c, binding(), 1000n).state, 'requires-trusted-verification');
  assert.equal(assessNftListingScope(t, c, binding(), 1000n).executable, false);
  for (const b of [{ ...binding(), executorDigest: h('a') }, { ...binding(), grantReference: 'grant:2' },
    { ...binding(), grantPolicyVersion: '2' }, { ...binding(), valuationPolicyDigest: d('b') },
    { ...binding(), priceAt: 'settlement' as const }, { ...binding(), priceAt: null as any }])
    assert.equal(assessNftListingScope(t, c, b, 1000n).state, 'outside-declared-scope');
  for (const extra of [{ nft: { ...c.child.nft, quantity: '2' } }, { nft: { ...c.child.nft, quantity: '4' } },
    { expiresAt: '10001' }, { seller: a('3') }, { fees: { maximumFeeWei: '101' } }])
    assert.equal(assessNftListingScope(t, listing(extra), binding(), 1000n).state, 'outside-declared-scope');
  // This task restriction does not remove legacy manual partial ERC-1155 transfers.
  assert.equal(normalizeExistingOperation({ kind: 'erc1155-transfer', chainId: '1', actor: a('1'), recipient: a('3'),
    contract: a('2'), tokenId: '7', amount: '1' }).kind, 'erc1155-transfer');
});

test('listing reserves exact quantity once, permits zero off-chain fee and reuses existing CAS/attempt fence', () => {
  const t = task(), c = listing(), empty = emptyNftListingBudget(t);
  assert.equal(empty.schema, '8415-task-budget/2');
  const reserved = reserveNftListingBudget(t, c, binding(), empty, '0', 1000n);
  assert.deepEqual(reserved.reservations[0], { operationId: c.child.operationId, childDigest: c.digest, units: '3', feeWei: '0', status: 'reserved', submission: null });
  assert.throws(() => reserveNftListingBudget(t, listing({ operationId: 'listing:2' }), binding(), reserved, '0', 1000n), /TASK_BUDGET_REVISION_CONFLICT/);
  assert.throws(() => reserveNftListingBudget(t, listing({ operationId: 'listing:2' }), binding(), reserved, '1', 1000n), /TASK_TOTAL_ASSET_LIMIT/);
  assert.throws(() => reserveNftListingBudget(t, c, binding(), emptyTaskBudget(t), '0', 1000n), /TASK_BUDGET_SCHEMA_REFUSED/);
  const attempted = markTaskSendAttempt(reserved, c.child.operationId, c.digest, '1');
  assert.throws(() => markTaskSendAttempt(attempted, c.child.operationId, c.digest, '2'), /TASK_SEND_ATTEMPT_REFUSED/);
  assert.throws(() => cancelUnattemptedReservation(attempted, c.child.operationId, c.digest, '2'), /TASK_UNCERTAIN_RESERVATION_CANNOT_RELEASE/);
  assert.throws(() => noteTaskSubmission(attempted, c.child.operationId, c.digest, h('a'), '2'), /TASK_BUDGET_SCHEMA_REFUSED/);
  const published = noteNftListingSubmission(attempted, c, submission(), '2');
  assert.equal('transactionHash' in published.reservations[0]!, false);
  assert.equal(published.reservations[0]!.units, '3'); assert.deepEqual(published.reservations[0]!.submission, submission());
  assert.throws(() => reserveNftListingBudget(t, listing({ operationId: 'listing:2', orderHash: h('a') }), binding(), published, '3', 1000n), /TASK_TOTAL_ASSET_LIMIT/);
  assert.throws(() => cancelUnattemptedReservation(published, c.child.operationId, c.digest, '3'), /TASK_UNCERTAIN_RESERVATION_CANNOT_RELEASE/);
});

test('listing budget retains fee bounds and a cancelled unattempted tombstone without releasing spent quota', () => {
  const t = task(), c = listing({ fees: { maximumFeeWei: '100' } });
  const occupied = { ...emptyNftListingBudget(t), reservations: [{ operationId: 'other', childDigest: h('a'), feeWei: '101', units: '1', status: 'outcome-unknown', submission: null }] };
  assert.throws(() => reserveNftListingBudget(t, c, binding(), occupied as any, '0', 1000n), /TASK_TOTAL_FEE_LIMIT/);
  const r = reserveNftListingBudget(t, c, binding(), emptyNftListingBudget(t), '0', 1000n);
  const cancelled = cancelUnattemptedReservation(r, c.child.operationId, c.digest, '1');
  assert.throws(() => reserveNftListingBudget(t, c, binding(), cancelled, '2', 1000n), /TASK_DUPLICATE_OPERATION_REFUSED/);
  assert.equal(reserveNftListingBudget(t, listing({ operationId: 'listing:2' }), binding(), cancelled, '2', 1000n).reservations.length, 2);
});

test('submission references, unknown status and paged budgets cannot be interchanged with transaction records', () => {
  const t = task(), c = listing();
  const attempted = markTaskSendAttempt(reserveNftListingBudget(t, c, binding(), emptyNftListingBudget(t), '0', 1000n), c.child.operationId, c.digest, '1');
  for (const bad of [{ ...submission(), orderHash: h('a') }, { ...submission(), chainId: '8453' }, { ...submission(), protocol: a('6') },
    { ...submission(), transactionHash: h('a') }, { kind: 'transaction', transactionHash: h('a') }])
    assert.throws(() => noteNftListingSubmission(attempted, c, bad, '2'));
  assert.throws(() => normalizeTaskBudget({ ...attempted, schema: '8415-task-budget/1' }), /TASK_SCHEMA_REFUSED/);
  assert.throws(() => normalizeTaskBudget({ ...attempted, reservations: [{ ...attempted.reservations[0], submission: submission() }] }), /TASK_BUDGET_STATE_REFUSED/);
  const page = normalizeTaskBudgetPage({ schema: '8415-task-budget-page/2', taskDigest: t.digest, revision: '2', cursor: null, nextCursor: null, reservations: attempted.reservations });
  assert.deepEqual(assembleTaskBudgetPages([page]), attempted);
});

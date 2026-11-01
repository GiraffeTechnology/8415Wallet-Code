import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeReceiptPrincipalPurpose, receiptPrincipalPurposeDigest, newReceiptPrincipalState,
  normalizeReceiptPrincipalState, advanceReceiptPrincipalState, type ReceiptPrincipalState,
  type ReceiptPrincipalAction } from '../src/agent/receiptPrincipal.ts';
const a = (n: string) => '0x' + n.repeat(40), h = (n: string) => '0x' + n.repeat(64);
function purpose() {
  return normalizeReceiptPrincipalPurpose({ schema: '8415-receipt-principal-purpose/1', reservationId: 'original-reservation',
    tenant: 'test-wallet', origin: 'https://wallet.example', account: a('1'), chainId: '31337',
    currency: { kind: 'erc20', contract: a('2'), decimals: 6 }, amountBaseUnits: '500000000', payee: a('3'),
    task: { taskId: 'original-task', taskDigest: h('1'), executorDigest: h('2'), grantReference: 'original-grant',
      grantPolicyVersion: '1', operationId: 'original-operation' },
    receipt: { collection: a('4'), tokenId: '7', segmentId: h('3'), planDigest: h('4'), journalBindingHash: h('5') },
    lineage: { id: 'original-lineage', index: '2', previousReservationId: 'preceding-reservation' },
    mintTerms: { policyVersion: 'original-policy.v1', assetId: 'original-asset', tokenId: '7', source:{chainId:'31337',contract:a('6'),registerId:'registry:7',sourceAuthority:'original-source-authority'}, mintRecordCommitment:h('7'), mintPolicyHash: h('6'), registrationDeadline: '2000000000' } });
}
function step(s: ReceiptPrincipalState, event: unknown, eventId = 'event-' + s.revision) {
  return advanceReceiptPrincipalState(s, { expectedRevision: s.revision, eventId, event });
}
function effect(s: ReceiptPrincipalState, action: ReceiptPrincipalAction, kind = 'effect-confirmed') {
  return { kind, action, effectId: s.purpose.reservationId + ':' + action, reference: 'original-' + action + '-evidence',
    purposeDigest: s.purposeDigest, amountBaseUnits: s.purpose.amountBaseUnits,
    recipient: action === 'settle' ? s.purpose.payee : s.purpose.account };
}
function held() { const s = step(newReceiptPrincipalState(purpose()), { kind: 'freeze-started' }); return step(s,effect(s,'freeze')); }
function registration(s: ReceiptPrincipalState) {
  const p = s.purpose;
  return { sourceReference: 'original-oracle-registration', purposeDigest: s.purposeDigest, mintPolicyHash: p.mintTerms.mintPolicyHash,
    chainId: p.chainId, collection: p.receipt.collection, tokenId: p.receipt.tokenId, registeredHolder: p.account, registeredAt: p.mintTerms.registrationDeadline };
}
function rollback(s: ReceiptPrincipalState) {
  const p = s.purpose;
  return { sourceReference: 'original-oracle-rollback', purposeDigest: s.purposeDigest, mintPolicyHash: p.mintTerms.mintPolicyHash,
    chainId: p.chainId, collection: p.receipt.collection, tokenId: p.receipt.tokenId, validHolder: a('5'),
    observedAt: '2000000001', firstUnresolvedIndex: '1', registrationCompleted: false };
}
test('funded content starts unreserved; it is not a grant, balance or completed freeze', () => {
  const s = newReceiptPrincipalState(purpose());
  assert.equal(s.status,'unreserved'); assert.equal(s.holdReference,null); assert.deepEqual(s.attemptedActions,[]);
  assert.equal(s.purpose.amountBaseUnits,'500000000'); assert.equal(s.purpose.currency.decimals,6);
  assert.equal(Object.hasOwn(s,'balance'),false); assert.equal(Object.hasOwn(s,'canExecute'),false);
});
test('registration settles the existing reservation and fixed payee, without a second buyer payment field', () => {
  const s = held(); assert.equal(s.status,'held'); assert.equal(s.holdReference,'original-freeze-evidence');
  const pending = step(s,{kind:'settle-started',registration:registration(s)});
  const settled = step(pending,effect(pending,'settle'));
  assert.equal(settled.status,'settled'); assert.equal(settled.holdReference,s.holdReference);
  assert.equal(settled.purpose.reservationId,s.purpose.reservationId); assert.equal(settled.purpose.task.operationId,s.purpose.task.operationId);
  assert.equal(settled.purpose.amountBaseUnits,s.purpose.amountBaseUnits); assert.deepEqual(settled.attemptedActions,['freeze','settle']);
  assert.throws(()=>step(settled,{kind:'release-started',rollback:rollback(settled)}));
  assert.throws(()=>step(settled,{kind:'settle-started',registration:registration(settled)}));
});
test('only the unresolved suffix can release an existing hold to its original account', () => {
  const s = held(), pending = step(s,{kind:'release-started',rollback:rollback(s)}), released = step(pending,effect(pending,'release'));
  assert.equal(released.status,'released'); assert.equal(released.holdReference,s.holdReference);
  assert.deepEqual(released.attemptedActions,['freeze','release']);
  assert.throws(()=>step(released,{kind:'freeze-started'}));
  assert.throws(()=>step(released,{kind:'settle-started',registration:registration(released)}));
});
test('unknown freeze survives JSON restart; only exact authoritative reconciliation can establish the hold', () => {
  let s = step(newReceiptPrincipalState(purpose()),{kind:'freeze-started'});
  s = step(s,{kind:'effect-unknown',action:'freeze'}); s = normalizeReceiptPrincipalState(JSON.parse(JSON.stringify(s)));
  assert.equal(s.status,'unknown'); assert.equal(s.holdReference,null);
  assert.throws(()=>step(s,{kind:'freeze-started'}));
  assert.throws(()=>step(s,{kind:'settle-started',registration:registration(s)}));
  assert.throws(()=>step(s,effect(s,'freeze')));
  s = step(s,effect(s,'freeze','effect-reconciled')); assert.equal(s.status,'held');
});
test('unknown settlement keeps the original hold and cannot dispatch either settlement or release again', () => {
  let s = held(); s = step(s,{kind:'settle-started',registration:registration(s)},'settlement-once');
  s = step(s,{kind:'effect-unknown',action:'settle'}); s = normalizeReceiptPrincipalState(JSON.parse(JSON.stringify(s)));
  assert.equal(s.status,'unknown'); assert.equal(s.holdReference,'original-freeze-evidence');
  assert.throws(()=>step(s,{kind:'settle-started',registration:registration(s)}));
  assert.throws(()=>step(s,{kind:'release-started',rollback:rollback(s)}));
  const before = s;
  s = advanceReceiptPrincipalState(s,{expectedRevision:'2',eventId:'settlement-once',event:{kind:'settle-started',registration:registration(s)}});
  assert.deepEqual(s,before); s = step(s,effect(s,'settle','effect-reconciled')); assert.equal(s.status,'settled');
});
test('unknown release remains encumbered until the original release is reconciled, without another effect', () => {
  let s = held(); s = step(s,{kind:'release-started',rollback:rollback(s)}); s = step(s,{kind:'effect-unknown',action:'release'});
  assert.throws(()=>step(s,{kind:'release-started',rollback:rollback(s)}));
  s = step(s,effect(s,'release','effect-reconciled')); assert.equal(s.status,'released');
  assert.deepEqual(s.attemptedActions,['freeze','release']);
});
test('revision conflict and changed reuse of an event identity refuse; exact retries return current state', () => {
  const initial = newReceiptPrincipalState(purpose()), s = step(initial,{kind:'freeze-started'},'original-freeze-request');
  assert.throws(()=>advanceReceiptPrincipalState(s,{expectedRevision:'0',eventId:'other',event:{kind:'effect-unknown',action:'freeze'}}),/REVISION_CONFLICT/);
  assert.deepEqual(advanceReceiptPrincipalState(s,{expectedRevision:'0',eventId:'original-freeze-request',event:{kind:'freeze-started'}}),s);
  assert.throws(()=>advanceReceiptPrincipalState(s,{expectedRevision:'0',eventId:'original-freeze-request',event:{kind:'effect-unknown',action:'freeze'}}),/IDEMPOTENCY_CONFLICT/);
});
for (const field of ['effectId','purposeDigest','amountBaseUnits','recipient','action']) test('financial evidence cannot substitute '+field, () => {
  const s = step(newReceiptPrincipalState(purpose()),{kind:'freeze-started'}), e = effect(s,'freeze');
  const bad = {...e,[field]:field==='recipient'?a('9'):field==='purposeDigest'?h('9'):field==='amountBaseUnits'?'1':field==='action'?'settle':'other-effect'};
  assert.throws(()=>step(s,bad)); assert.equal(s.status,'freeze-pending');
});
for (const field of ['purposeDigest','mintPolicyHash','chainId','collection','tokenId','registeredHolder','registeredAt']) test('registration refuses wrong/late '+field, () => {
  const s = held(), e = registration(s);
  const value = ['purposeDigest','mintPolicyHash'].includes(field)?h('9'):['collection','registeredHolder'].includes(field)?a('9'):field==='registeredAt'?'2000000001':'9';
  assert.throws(()=>step(s,{kind:'settle-started',registration:{...e,[field]:value}}));
});
test('wall-clock expiry, an already registered receipt or a settled prefix does not authorize rollback', () => {
  const s = held(), facts = rollback(s);
  assert.throws(()=>step(s,{kind:'release-started',rollback:{...facts,observedAt:'2000000000'}}),/MINT_DEADLINE_REQUIRED/);
  assert.throws(()=>step(s,{kind:'release-started',rollback:{...facts,registrationCompleted:true}}));
  assert.throws(()=>step(s,{kind:'release-started',rollback:{...facts,firstUnresolvedIndex:'3'}}),/SETTLED_PREFIX_REFUSED/);
});
test('canonical currency, amount and original purpose bindings are included independently of gas budgets', () => {
  const p = purpose(), digest = receiptPrincipalPurposeDigest(p);
  for (const update of [{amountBaseUnits:'500000001'},{chainId:'560048'},{account:a('8')},{payee:a('8')},{reservationId:'other-reservation'}])
    assert.notEqual(receiptPrincipalPurposeDigest({...p,...update}),digest);
  for (const amount of ['0','01','1.0','-1',500000000,(1n<<256n).toString()])
    assert.throws(()=>normalizeReceiptPrincipalPurpose({...p,amountBaseUnits:amount}));
  assert.throws(()=>normalizeReceiptPrincipalPurpose({...p,fees:{totalWei:'1'}}));
  assert.throws(()=>normalizeReceiptPrincipalPurpose({...p,currency:{...p.currency,decimals:256}}));
});
test('accessors, extra authority fields and malformed persisted state never supply principal authority', () => {
  const p = purpose(); let invoked=0; const bad={...p}; Object.defineProperty(bad,'amountBaseUnits',{enumerable:true,get(){invoked++;return '1';}});
  assert.throws(()=>normalizeReceiptPrincipalPurpose(bad)); assert.equal(invoked,0);
  assert.throws(()=>normalizeReceiptPrincipalPurpose({...p,approved:true}));
  const s=held(); assert.throws(()=>normalizeReceiptPrincipalState({...s,holdReference:null}));
  assert.throws(()=>normalizeReceiptPrincipalState({...s,attemptedActions:[]}));
  assert.throws(()=>normalizeReceiptPrincipalState({...s,attemptedActions:['freeze','settle']}));
  assert.throws(()=>normalizeReceiptPrincipalState({...s,revision:'99'}));
  assert.throws(()=>normalizeReceiptPrincipalState({...s,history:[...s.history,s.history[0]]}));
});

test('mint provenance preserves full policy version/hash and original registry/genesis binding without inventing terms hashes',()=>{
 const p=purpose();assert.equal(p.mintTerms.policyVersion,'original-policy.v1');
 assert.notEqual(p.mintTerms.source.contract,p.receipt.collection);
 assert.throws(()=>normalizeReceiptPrincipalPurpose({...p,mintTerms:{...p.mintTerms,tokenId:'8'}}));
 assert.throws(()=>normalizeReceiptPrincipalPurpose({...p,mintTerms:{...p.mintTerms,source:{...p.mintTerms.source,chainId:'560048'}}}));
 for(const change of [{mintPolicyHash:h('8')},{mintRecordCommitment:h('8')},{assetId:'other-asset'},{policyVersion:'other-policy.v2'}])
  assert.notEqual(receiptPrincipalPurposeDigest({...p,mintTerms:{...p.mintTerms,...change}}),receiptPrincipalPurposeDigest(p));
});

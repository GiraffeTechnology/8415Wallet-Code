import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash, webcrypto } from 'node:crypto';
import { createTaskVerificationPolicyWire, taskPolicyChangeQuery, TASK_POLICY_CHANGE_PROTOCOL as protocol } from '../web/task-verification-policy-wire.mjs';
import { createTaskVerificationPolicyClient } from '../web/task-verification-policy-client.mjs';
import { createTaskPolicyPendingStore, taskPolicyPendingReference } from '../web/task-verification-policy-pending.mjs';
import { POLICY_CATALOGS, POLICY_LOCALES } from '../web/locales/task-verification-policy.mjs';
const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const scope = { origin: 'https://wallet.example.invalid', tenant: 'synthetic', username: 'owner',
  account: '0x' + '1'.repeat(40), chainId: '560048', agentId: 'synthetic:agent' };
const session = { ...scope, serverId: 'synthetic-session' }, account = { ...scope };
const wire = createTaskVerificationPolicyWire({ crypto: webcrypto });
const reference = taskPolicyPendingReference({ scopeKey: hash(scope), changeId: 'c'.repeat(43),
  changeDigest: 'd'.repeat(64), mode: 'OFF', previousRevision: '0' });
const initial = () => ({ schema: '8415-task-human-verification/1', scope, mode: 'ON', revision: '0',
  label: 'Per-operation human verification', appliesTo: 'still-valid-in-scope-authorizations', grantsAuthority: false,
  factorsForOFF: ['password-or-bound-wallet', 'previously-verified-email'],
  factorsForEverySave: ['password-or-bound-wallet', 'previously-verified-email'],
  changeCount: 0, lastChange: null, changeProtocol: protocol, pendingChange: null, reconciliation: null });
const pending = () => ({ changeId: reference.changeId, changeDigest: reference.changeDigest,
  expectedRevision: '0', mode: 'OFF', stage: 'identity', issuedAt: 1000, expiresAt: 301000 });
const reconcile = (state = 'unknown', reason = 'unresolved', committedChange = null) => ({
  changeId: reference.changeId, changeDigest: reference.changeDigest, expectedRevision: '0', state, reason,
  automaticRetryAllowed: false, committedChange });
const audit = () => ({ revision: '1', previousRevision: '0', mode: 'OFF', changeId: reference.changeId,
  changeDigest: reference.changeDigest, scopeDigest: hash(scope), credentialRevision: 1,
  verifiedFactors: ['password', 'verified-email'], changedAt: 2000 });
const saved = () => ({ ...initial(), schema: '8415-task-human-verification/2', mode: 'ON', revision: '2',
  enforcedFromRevision: '1', changeCount: 2,
  lastChange: { ...audit(), revision: '2', previousRevision: '1', mode: 'ON', changeId: 'e'.repeat(43) },
  reconciliation: reconcile('committed', null, audit()) });
function storage() {
  const map = new Map(); return { getItem(k) { return map.get(k) ?? null; }, setItem(k,v) { map.set(k,v); }, removeItem(k) { map.delete(k); } };
}
function bridge(status, port = storage()) {
  const calls = [], binding = {}, signal = new AbortController().signal;
  const api = createTaskVerificationPolicyClient({ document: {}, window: { crypto: webcrypto, sessionStorage: port },
    walletLogin: { assert(value) { assert.equal(value, binding); return session; } },
    client: { async account() { return { ...account, taskHumanVerification: initial() }; },
      async taskVerification(action, body) { calls.push({action,body}); return status(action,body); } } });
  return { api, calls, binding, signal, port };
}
test('new source protocol enables owner policy editing without inventing permission inventory', async () => {
  const decoded = await wire.status(initial(), session, account);
  assert.equal(decoded.view.canChange, true); assert.equal(decoded.view.permissions, null);
  assert.equal(decoded.view.mode, 'ON'); assert.equal(decoded.view.revision, '0');
});
test('unknown protocol, getters, extra fields and mismatched query echo refuse', async () => {
  for (const raw of [{...initial(),changeProtocol:'future'}, {...initial(),extra:true},
    {...initial(),reconciliation:{...reconcile(),changeDigest:'e'.repeat(64)}}]) {
    await assert.rejects(wire.status(raw, session, account, raw.reconciliation ? reference : null));
  }
  await assert.rejects(wire.status({...initial(),reconciliation:reconcile()},session,account));
  let reads=0;const raw=initial();Object.defineProperty(raw,'pendingChange',{enumerable:true,get(){reads++;return null;}});
  await assert.rejects(wire.status(raw, session, account));assert.equal(reads,0);
});
test('full original committed audit survives a later effective save', async () => {
  const decoded = await wire.status(saved(), session, account, reference);
  assert.equal(decoded.view.mode,'ON');assert.equal(decoded.view.revision,'2');
  assert.equal(decoded.reconciliation.committedChange.changeId,reference.changeId);
  assert.notEqual(decoded.lastChange.changeId,reference.changeId);
});
test('reconciliation cannot grant retry, replace factors, mode, scope or revision', async () => {
  const valid=saved();
  for (const patch of [{automaticRetryAllowed:true},{reason:'cancelled'},
    {committedChange:{...audit(),verifiedFactors:[]}}, {committedChange:{...audit(),mode:'ON'}},
    {committedChange:{...audit(),scopeDigest:'0'.repeat(64)}}, {committedChange:{...audit(),previousRevision:'1'}}]) {
    await assert.rejects(wire.status({...valid,reconciliation:{...valid.reconciliation,...patch}},session,account,reference));
  }
});
test('only exact live pending/committing summaries corroborate the outcome', async () => {
  for (const stage of ['identity','verifying','email','committing']) {
    const state=stage==='committing'?'committing':'pending';
    const decoded=await wire.status({...initial(),pendingChange:{...pending(),stage},reconciliation:reconcile(state,null)},session,account,reference);
    assert.equal(decoded.view.changeState,'unknown');
  }
  const reloaded=await wire.status({...initial(),pendingChange:null,reconciliation:reconcile('pending',null)},session,account,reference);
  assert.equal(reloaded.view.changeState,'unknown');assert.equal(reloaded.pendingChange,null);
  const otherSlot=await wire.status({...initial(),pendingChange:{...pending(),changeId:'e'.repeat(43)},reconciliation:reconcile('pending',null)},session,account,reference);
  assert.equal(otherSlot.reconciliation.changeId,reference.changeId);
});
test('not-committed needs a conclusive reason and revision-superseded needs a later revision', async () => {
  for(const reason of ['cancelled','replaced']) assert.equal((await wire.status({...initial(),reconciliation:reconcile('not-committed',reason)},session,account,reference)).reconciliation.state,'not-committed');
  await assert.rejects(wire.status({...initial(),reconciliation:reconcile('not-committed','revision-superseded')},session,account,reference));
  await assert.rejects(wire.status({...initial(),reconciliation:reconcile('unknown',null)},session,account,reference));
});
test('reload reads same reference and retains UNKNOWN without any prepare, confirm or cancel', async () => {
  const port=storage();createTaskPolicyPendingStore({storage:port}).remember(reference);
  const x=bridge((_action,body)=>({...initial(),reconciliation:body.changeId?reconcile():null}),port);
  const value=await x.api.read(x);assert.equal(value.changeState,'unknown');
  assert.deepEqual(x.calls.map(x=>x.action),['status','status']);assert.deepEqual(x.calls[1].body,taskPolicyChangeQuery(reference));
  assert.deepEqual(x.calls[0].body,{protocol});
  assert.deepEqual(createTaskPolicyPendingStore({storage:port}).read(reference.scopeKey),reference);
});
test('reload resolves original commit from complete audit, not current mode or lastChange', async () => {
  const port=storage();createTaskPolicyPendingStore({storage:port}).remember(reference);
  const x=bridge((_action,body)=>({...saved(),reconciliation:body.changeId?saved().reconciliation:null}),port);
  const value=await x.api.read(x);assert.equal(value.changeState,'settled');assert.equal(value.mode,'ON');
  assert.equal(createTaskPolicyPendingStore({storage:port}).read(reference.scopeKey),null);
});
test('live server pending is adopted only as a nonsecret scoped reference', async () => {
  const x=bridge((_action,body)=>({...initial(),pendingChange:pending(),reconciliation:body.changeId?reconcile('pending',null):null}));
  assert.equal((await x.api.read(x)).changeState,'unknown');
  assert.deepEqual(createTaskPolicyPendingStore({storage:x.port}).read(reference.scopeKey),reference);
});
test('explicit cancel is qualified and unavailable for UNKNOWN, never a retry', async () => {
  const port=storage();createTaskPolicyPendingStore({storage:port}).remember(reference);
  const x=bridge((_action,body)=>({...initial(),reconciliation:body.changeId?reconcile():null}),port);
  await x.api.cancelPending({...x,expectedScopeKey:reference.scopeKey});
  assert.equal(x.calls.some(x=>x.action!=='status'),false);
});
test('explicit cancel removes only the exact pending draft after authenticated proof', async () => {
  let cancelled=false;
  const x=bridge((action,body)=>{
    if(action==='cancel'){assert.deepEqual(body,taskPolicyChangeQuery(reference));cancelled=true;
      return {changeProtocol:protocol,cancelled:true,reconciliation:reconcile('not-committed','cancelled')};}
    return {...initial(),pendingChange:cancelled?null:pending(),reconciliation:body.changeId?reconcile('pending',null):null};
  });
  await x.api.read(x);const view=await x.api.cancelPending({...x,expectedScopeKey:reference.scopeKey});
  assert.equal(view.changeState,'settled');assert.equal(x.calls.filter(x=>x.action==='cancel').length,1);
});
test('false cancellation is truthful and malformed cancellation cannot erase pending', async () => {
  const decoded=await wire.status(initial(),session,account);
  const raw={changeProtocol:protocol,cancelled:false,reconciliation:reconcile()};
  assert.equal(wire.cancelled(raw,reference,decoded).state,'unknown');
  assert.throws(()=>wire.cancelled({...raw,cancelled:true},reference,decoded));
  assert.throws(()=>wire.cancelled({...raw,extra:true},reference,decoded));
});
test('missing browser storage preserves read-only status rather than inventing an empty pending state', async () => {
  const x=bridge(()=>initial(),{});const view=await x.api.read(x);assert.equal(view.canChange,false);assert.equal(view.mode,'ON');
});
test('all six locales explain missing inventory without disabling or granting authority',()=>{
  for(const locale of POLICY_LOCALES){assert.equal(typeof POLICY_CATALOGS[locale].cancelPending,'string');
    assert.ok(POLICY_CATALOGS[locale].permissionsUnavailable.length>10);}
});
test('explicit discovery input refusal falls back to the strict read-only legacy shape', async()=>{
  const x=bridge((_action,body)=>{
    if(body.protocol) throw Object.assign(new Error('old input'),{code:'TASK_VERIFICATION_INPUT_REFUSED',status:400});
    const raw=initial();delete raw.changeProtocol;delete raw.pendingChange;delete raw.reconciliation;return raw;
  });
  const view=await x.api.read(x);assert.equal(view.canChange,false);assert.equal(view.mode,'ON');
  assert.deepEqual(x.calls.map(x=>x.body),[{protocol},{}]);
});
test('authentication, unknown errors and qualified-reference failures never use legacy fallback',async()=>{
  for(const error of [Object.assign(new Error('unauthorized'),{code:'AUTH_REQUIRED',status:401}),new Error('network')]){
    const x=bridge(()=>{throw error;});await assert.rejects(x.api.read(x));assert.equal(x.calls.length,1);
  }
  const port=storage();createTaskPolicyPendingStore({storage:port}).remember(reference);
  const x=bridge((_a,b)=>{if(b.changeId)throw Object.assign(new Error('bad reference'),{code:'TASK_VERIFICATION_INPUT_REFUSED',status:400});return initial();},port);
  await assert.rejects(x.api.read(x));assert.deepEqual(x.calls.map(x=>x.body),[{protocol},taskPolicyChangeQuery(reference)]);
});


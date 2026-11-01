/** Optional funded-V3 composition. No HTTP route, store creation, default funds
 * adapter, signing, balance invention, or upgrade of an existing receipt grant.
 * These original capabilities must be supplied by the server bootstrap. */
import {randomBytes} from 'node:crypto';
import {isDeepStrictEqual} from 'node:util';
import {keccak256Utf8} from '../src/codec/keccak.ts';
import {normalizeReceiptPrincipalPurpose,receiptPrincipalPurposeDigest,newReceiptPrincipalState,
 normalizeReceiptPrincipalState,advanceReceiptPrincipalState,normalizeReceiptRegistrationFacts,
 normalizeReceiptRollbackFacts} from '../src/agent/receiptPrincipal.ts';
import {createFundsService} from './funds-service.mjs';

export class ReceiptPrincipalRuntimeError extends Error {
 constructor(code,status=409){super(code);this.code=code;this.status=status;}
}
const check=(ok,code='RECEIPT_PRINCIPAL_RUNTIME_REFUSED',status=409)=>{if(!ok)throw new ReceiptPrincipalRuntimeError(code,status);};
function fields(value,keys){
 check(value&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
 const d=Object.getOwnPropertyDescriptors(value);check(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d[k]??{},'value')&&d[k].enumerable));
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
function methods(port,names){check(port&&typeof port==='object','RECEIPT_PRINCIPAL_CAPABILITY_REQUIRED',503);return Object.fromEntries(names.map(name=>{const fn=port[name];check(typeof fn==='function','RECEIPT_PRINCIPAL_CAPABILITY_REQUIRED',503);return [name,fn.bind(port)];}));}
const opaque=x=>typeof x==='string'&&x.length>0&&x.length<=512&&x.trim()===x&&!/[\u0000-\u001f\u007f]/.test(x);
const uint=x=>typeof x==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(x)&&BigInt(x)<1n<<256n;
const actions=['freeze','settle','release'];
const eventId=(...values)=>keccak256Utf8(JSON.stringify(values));
const bindings=new WeakMap();
function resultFor(raw,purpose,action){
 const r=fields(raw,['schema','action','effectId','purposeDigest','outcome','reference','amountBaseUnits','recipient']);
 check(r.schema==='8415-receipt-principal-effect/1'&&r.action===action&&r.effectId===purpose.reservationId+':'+action&&
  r.purposeDigest===receiptPrincipalPurposeDigest(purpose)&&r.amountBaseUnits===purpose.amountBaseUnits&&
  r.recipient===(action==='settle'?purpose.payee:purpose.account),'RECEIPT_PRINCIPAL_EFFECT_BINDING_REFUSED');
 check(['confirmed','unknown'].includes(r.outcome)&&(r.reference===null||opaque(r.reference))&&
  (r.outcome!=='confirmed'||r.reference!==null),'RECEIPT_PRINCIPAL_EFFECT_RESULT_REFUSED');
 return Object.freeze(r);
}
function journal(raw,purpose){
 const r=fields(raw,['schema','state','dispatch','observations']);check(r.schema==='8415-receipt-principal-journal/1');
 const state=normalizeReceiptPrincipalState(r.state);check(state.purposeDigest===receiptPrincipalPurposeDigest(purpose),'RECEIPT_PRINCIPAL_PURPOSE_CONFLICT');
 let dispatch=null;
 if(r.dispatch!==null){dispatch=fields(r.dispatch,['action','effectId','eventId','entered']);check(actions.includes(dispatch.action)&&
  dispatch.effectId===purpose.reservationId+':'+dispatch.action&&opaque(dispatch.eventId)&&typeof dispatch.entered==='boolean');}
 check(Array.isArray(r.observations)&&r.observations.length<=64);
 const descriptors=Object.getOwnPropertyDescriptors(r.observations);check(Reflect.ownKeys(descriptors).length===r.observations.length+1);
 const observations=Array.from({length:r.observations.length},(_,n)=>{check(Object.hasOwn(descriptors[n]??{},'value'));const observation=descriptors[n].value;return resultFor(observation,purpose,observation.action);});
 return {schema:r.schema,state,dispatch,observations};
}

export function createReceiptPrincipalRuntime({store,authorization,fundsReader,fundsEffects,evidence,origin,tenant,now=Date.now}){
 check(store&&typeof store.read==='function'&&typeof store.transactionMany==='function'&&typeof now==='function','RECEIPT_PRINCIPAL_STORE_REQUIRED',500);
 check(typeof origin==='string'&&new URL(origin).origin===origin&&new URL(origin).protocol==='https:'&&typeof tenant==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(tenant),'RECEIPT_PRINCIPAL_REALM_REQUIRED',500);
 // Different method names are intentional. The old four-method receipt port
 // cannot be mistaken for a new, purpose/value-bound financial authorization.
 const authority=methods(authorization,['assertIndependentStore','withPurposeAuthorization','withPurposeObservation']);
 authority.assertIndependentStore(store);
 const effects=methods(fundsEffects,['freezeExisting','settleHeld','releaseHeld','reconcile']);
 // A read/content matcher returning REGISTRATION_OBSERVED is deliberately not
 // this held evidence-authority port. No DTO or NOT_EVALUATED flag enables it.
 const facts=methods(evidence,['withMintTerms','withRegistrationAuthorization','withRollbackAuthorization']);
 check(fundsReader&&typeof fundsReader.readForPrincipal==='function','RECEIPT_PRINCIPAL_FUNDS_READER_REQUIRED',503);
 const reader=Object.freeze({readForPrincipal:fundsReader.readForPrincipal.bind(fundsReader)});
 let realms=bindings.get(store);if(!realms){realms=new Set();bindings.set(store,realms);}const realm=JSON.stringify([origin,tenant]);
 check(!realms.has(realm),'RECEIPT_PRINCIPAL_SINGLE_WRITER_REQUIRED',500);realms.add(realm);
 let closing=false,stopPromise=null;const pending=new Set(),inFlight=new Set();
 const active=()=>check(!closing,'RECEIPT_PRINCIPAL_RUNTIME_STOPPED',503);
 const key=p=>'receipt-principal-v1:'+eventId(origin,tenant,p.account,p.chainId,p.reservationId);
 function purpose(raw){const p=normalizeReceiptPrincipalPurpose(raw);check(p.origin===origin&&p.tenant===tenant,'RECEIPT_PRINCIPAL_REALM_REFUSED',403);return p;}
 function scope(raw,p,action){
  const s=fields(raw,['purpose','principal','expiresAtMs']),owner=fields(s.principal,['origin','tenant','username','account','chainId']);
  check(receiptPrincipalPurposeDigest(s.purpose)===receiptPrincipalPurposeDigest(p)&&owner.origin===origin&&owner.tenant===tenant&&
   owner.account===p.account&&owner.chainId===p.chainId&&typeof owner.username==='string'&&owner.username.length>0,'RECEIPT_PRINCIPAL_AUTHORITY_BINDING_REFUSED',403);
  check(Number.isSafeInteger(s.expiresAtMs)&&s.expiresAtMs>=0,'RECEIPT_PRINCIPAL_AUTHORITY_EXPIRY_REFUSED',500);
  if(action!==null){check(now()<s.expiresAtMs,'RECEIPT_PRINCIPAL_AUTHORITY_EXPIRED',403);
   if(action==='freeze')check(BigInt(s.expiresAtMs)>=BigInt(p.mintTerms.registrationDeadline)*1000n&&BigInt(Math.floor(now()/1000))<=BigInt(p.mintTerms.registrationDeadline),'RECEIPT_PRINCIPAL_MINT_WINDOW_REFUSED');}
  return Object.freeze({...s,purpose:p,principal:Object.freeze(owner)});
 }
 function heldCheck(revalidate,p,action){const current=revalidate();check(!current||typeof current.then!=='function','RECEIPT_PRINCIPAL_ASYNC_REVALIDATION_REFUSED',500);return scope(current,p,action);}
 function track(action){active();const p=Promise.resolve(action());pending.add(p);p.then(()=>pending.delete(p),()=>pending.delete(p));return p;}
 async function readJournal(p){const raw=await store.read(key(p));return raw===null?null:journal(raw,p);}
 async function update(p,revalidate,action,fn){
  const k=key(p);const values=await store.transactionMany([k],async current=>{
   heldCheck(revalidate,p,action);const old=current[k]===null?null:journal(current[k],p);const next=await fn(old);journal(next,p);return {[k]:next};
  });return journal(values[k],p);
 }
 async function recordOutcome(p,fn){
  // Recording an already admitted effect must still finish after grant expiry
  // or runtime shutdown. This private path cannot create a new reservation or
  // dispatch anything, and requires the original durable purpose/effect below.
  const k=key(p),values=await store.transactionMany([k],current=>{check(current[k]!==null,'RECEIPT_PRINCIPAL_NOT_FOUND',404);const next=fn(journal(current[k],p));journal(next,p);return {[k]:next};});return journal(values[k],p);
 }
 async function existingFunds(p,snapshot,revalidate){
  const read=createFundsService({reader,origin,tenant,now,validateSession(owner){const s=heldCheck(revalidate,p,'freeze');check(Object.keys(s.principal).every(k=>s.principal[k]===owner[k]),'RECEIPT_PRINCIPAL_FUNDS_OWNER_REFUSED',403);}});
  // This is the original verified server principal, not a fabricated login
  // session or a caller-selected account/username. The held grant is rechecked.
  const result=await read.read({readId:randomBytes(16).toString('hex')},snapshot.principal);
  const matches=result.currencies.filter(row=>row.currency.chainId===p.chainId&&row.currency.kind===p.currency.kind&&
   row.currency.contract===p.currency.contract&&row.currency.decimals===p.currency.decimals);
  check(matches.length===1&&matches[0].state==='ready'&&uint(matches[0].availableBaseUnits),'RECEIPT_PRINCIPAL_FUNDS_SOURCE_UNAVAILABLE',503);
  check(BigInt(matches[0].availableBaseUnits)>=BigInt(p.amountBaseUnits),'RECEIPT_PRINCIPAL_INSUFFICIENT_EXISTING_FUNDS');
 }
 function request(raw){const r=fields(raw,['eventId','expectedRevision','evidenceReference']);check(opaque(r.eventId)&&uint(r.expectedRevision)&&(r.evidenceReference===null||opaque(r.evidenceReference)),'RECEIPT_PRINCIPAL_REQUEST_REFUSED',400);return Object.freeze(r);}
 async function finish(p,action,started,result){
  return recordOutcome(p,old=>{
   check(old&&old.dispatch?.effectId===p.reservationId+':'+action&&old.dispatch.eventId===started,'RECEIPT_PRINCIPAL_DISPATCH_CONFLICT');
   const state=advanceReceiptPrincipalState(old.state,{expectedRevision:old.state.revision,eventId:eventId(started,'result'),event:result?.outcome==='confirmed'?
    {kind:'effect-confirmed',action,effectId:result.effectId,reference:result.reference,purposeDigest:result.purposeDigest,amountBaseUnits:result.amountBaseUnits,recipient:result.recipient}:{kind:'effect-unknown',action}});
   const observations=result===null?old.observations:[...old.observations,result];check(observations.length<=64,'RECEIPT_PRINCIPAL_OBSERVATION_LIMIT');
   return {...old,state,observations};
  });
 }
 async function perform(rawPurpose,rawRequest,action){
  const p=purpose(rawPurpose),r=request(rawRequest),k=key(p);check(!inFlight.has(k),'RECEIPT_PRINCIPAL_EFFECT_IN_FLIGHT');inFlight.add(k);
  try{return await authority.withPurposeAuthorization(p,action,async(rawScope,revalidate)=>{
   const s=scope(rawScope,p,action);check(typeof revalidate==='function','RECEIPT_PRINCIPAL_REVALIDATION_REQUIRED',500);
   async function runWithEvent(event,revalidateEvidence=null){
   const recheck=()=>{const current=heldCheck(revalidate,p,action);if(revalidateEvidence!==null){const fresh=revalidateEvidence();check(!fresh||typeof fresh.then!=='function','RECEIPT_PRINCIPAL_ASYNC_EVIDENCE_REVALIDATION_REFUSED',500);
    if(action==='freeze')check(receiptPrincipalPurposeDigest({...p,mintTerms:fresh})===receiptPrincipalPurposeDigest(p),'RECEIPT_PRINCIPAL_MINT_TERMS_CHANGED');
    else{const normalized=action==='settle'?normalizeReceiptRegistrationFacts(fresh,p):normalizeReceiptRollbackFacts(fresh,p);
     check(isDeepStrictEqual(normalized,event.registration??event.rollback),'RECEIPT_PRINCIPAL_EVIDENCE_CHANGED');}}return current;};
   let dispatch=false;
   const admitted=await update(p,recheck,action,old=>{
    check(old!==null||action==='freeze','RECEIPT_PRINCIPAL_NOT_FOUND',404);
    const initial=old??{schema:'8415-receipt-principal-journal/1',state:newReceiptPrincipalState(p),dispatch:null,observations:[]};
    const next=advanceReceiptPrincipalState(initial.state,{expectedRevision:r.expectedRevision,eventId:r.eventId,event});
    if(next.revision!==initial.state.revision){dispatch=true;return {...initial,state:next,dispatch:{action,effectId:p.reservationId+':'+action,eventId:r.eventId,entered:false}};}
    // A known pre-entry interruption may resume the SAME intent. An entered or
    // uncertain effect never re-enters a funds method; callers must reconcile.
    dispatch=initial.dispatch?.entered===false&&initial.dispatch.eventId===r.eventId&&next.status===action+'-pending';return initial;
   });
   if(!dispatch)return admitted.state;
   let entered=false;
   try{
    await update(p,recheck,action,old=>{check(old&&old.dispatch?.entered===false&&old.dispatch.eventId===r.eventId);return {...old,dispatch:{...old.dispatch,entered:true}};});
    recheck();
    const fixed=Object.freeze({purpose:p,purposeDigest:admitted.state.purposeDigest,effectId:p.reservationId+':'+action,holdReference:admitted.state.holdReference});
    if(action!=='freeze')check(fixed.holdReference!==null,'RECEIPT_PRINCIPAL_EXISTING_HOLD_REQUIRED');
    entered=true;
    let commitChecks=0;const beforeCommit=()=>{commitChecks++;return recheck();};
    // The captured original funds adapter must recheck inside its actual
    // atomic mutation/dispatch boundary, not merely when this method is called.
    const raw=await effects[{freeze:'freezeExisting',settle:'settleHeld',release:'releaseHeld'}[action]](fixed,beforeCommit);
    check(commitChecks>0,'RECEIPT_PRINCIPAL_FUNDS_COMMIT_GUARD_REQUIRED');
    const result=resultFor(raw,p,action);return (await finish(p,action,r.eventId,result)).state;
   }catch(error){
    if(!entered){
     // No financial method was entered. Preserve the intent for bounded resume;
     // do not misclassify an authorization/preparation refusal as funds UNKNOWN.
     try{await recordOutcome(p,old=>{check(old.dispatch?.eventId===r.eventId);return {...old,dispatch:{...old.dispatch,entered:false}};});}catch{}
     throw new ReceiptPrincipalRuntimeError('RECEIPT_PRINCIPAL_PRE_EFFECT_REFUSED');
    }
    try{await finish(p,action,r.eventId,null);}catch{}
    throw new ReceiptPrincipalRuntimeError('RECEIPT_PRINCIPAL_OUTCOME_UNKNOWN_READ_FIRST');
   }
   }
   if(action==='freeze'){
    return facts.withMintTerms(p,async(terms,revalidateTerms)=>{
     check(typeof revalidateTerms==='function','RECEIPT_PRINCIPAL_MINT_TERMS_GATE_REQUIRED',503);
     check(receiptPrincipalPurposeDigest({...p,mintTerms:terms})===receiptPrincipalPurposeDigest(p),'RECEIPT_PRINCIPAL_MINT_TERMS_REFUSED');heldCheck(revalidate,p,action);
     if(await readJournal(p)===null)await existingFunds(p,s,revalidate);return runWithEvent({kind:'freeze-started'},revalidateTerms);
    });
   }
   check(r.evidenceReference!==null,'RECEIPT_PRINCIPAL_EVIDENCE_REFERENCE_REQUIRED',400);
   // The original application evidence adapter owns source finality and the
   // mint-defined unresolved suffix. It must not reopen this already held
   // Wallet grant gate or independently ingest an offline document.
   const method=action==='settle'?facts.withRegistrationAuthorization:facts.withRollbackAuthorization;
   return method(p,r.evidenceReference,async(verified,revalidateEvidence)=>{
    check(typeof revalidateEvidence==='function','RECEIPT_PRINCIPAL_EVIDENCE_GATE_REQUIRED',503);
    const normalized=action==='settle'?normalizeReceiptRegistrationFacts(verified,p):normalizeReceiptRollbackFacts(verified,p);
    return runWithEvent(action==='settle'?{kind:'settle-started',registration:normalized}:{kind:'release-started',rollback:normalized},revalidateEvidence);
   });
  });}finally{inFlight.delete(k);}
 }
 return Object.freeze({
  freeze:(p,r)=>track(()=>perform(p,r,'freeze')),
  settle:(p,r)=>track(()=>perform(p,r,'settle')),
  rollback:(p,r)=>track(()=>perform(p,r,'release')),
  read:raw=>track(async()=>{const p=purpose(raw);return authority.withPurposeObservation(p,async(rawScope,revalidate)=>{scope(rawScope,p,null);heldCheck(revalidate,p,null);return (await readJournal(p))?.state??null;});}),
  reconcile:raw=>track(async()=>{const p=purpose(raw),k=key(p);check(!inFlight.has(k),'RECEIPT_PRINCIPAL_EFFECT_IN_FLIGHT');inFlight.add(k);
   try{return await authority.withPurposeObservation(p,async(rawScope,revalidate)=>{
    scope(rawScope,p,null);heldCheck(revalidate,p,null);let current=await readJournal(p);check(current!==null,'RECEIPT_PRINCIPAL_NOT_FOUND',404);
    if(!current.dispatch?.entered||!['unknown',current.dispatch.action+'-pending'].includes(current.state.status))return current.state;
    const action=current.dispatch.action;
    if(current.state.status!=='unknown')current=await update(p,revalidate,null,old=>({...old,state:advanceReceiptPrincipalState(old.state,{expectedRevision:old.state.revision,eventId:eventId(old.dispatch.eventId,'recover-pending'),event:{kind:'effect-unknown',action}})}));
    const result=resultFor(await effects.reconcile(Object.freeze({purpose:p,purposeDigest:current.state.purposeDigest,effectId:current.dispatch.effectId,holdReference:current.state.holdReference})),p,action);
    heldCheck(revalidate,p,null);
    const saved=await update(p,revalidate,null,old=>{check(old&&old.state.status==='unknown'&&old.dispatch.effectId===result.effectId);
     check(old.observations.length<64,'RECEIPT_PRINCIPAL_OBSERVATION_LIMIT');
     const state=result.outcome==='unknown'?old.state:advanceReceiptPrincipalState(old.state,{expectedRevision:old.state.revision,eventId:eventId(old.dispatch.eventId,'reconcile-confirmed'),event:{kind:'effect-reconciled',action,effectId:result.effectId,reference:result.reference,purposeDigest:result.purposeDigest,amountBaseUnits:result.amountBaseUnits,recipient:result.recipient}});
     return {...old,state,observations:[...old.observations,result]};});return saved.state;
   });}finally{inFlight.delete(k);}
  }),
  stop(){if(stopPromise)return stopPromise;closing=true;stopPromise=(async()=>{while(pending.size)await Promise.allSettled([...pending]);realms.delete(realm);})();return stopPromise;}
 });
}

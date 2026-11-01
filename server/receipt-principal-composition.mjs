/** Server-only, opt-in composition. Normal durable authorization selects the
 * original realm. No HTTP/config field can supply a grant, reader or adapter. */
import {createReceiptPrincipalRuntime} from './receipt-principal-runtime.mjs';
import {normalizeReceiptPrincipalPurpose,receiptPrincipalPurposeDigest} from '../src/agent/receiptPrincipal.ts';
const check=ok=>{if(!ok)throw Error('RECEIPT_PRINCIPAL_COMPOSITION_REFUSED');};
function capture(port,names){check(port&&typeof port==='object');return Object.freeze(Object.fromEntries(names.map(name=>{const method=port[name];check(typeof method==='function');return [name,method.bind(port)];})));}
export function composeReceiptPrincipalRuntime({binding=null,authorization,fundsReader,tenant,now=Date.now}){
 if(binding===null)return null;
 check(binding&&[Object.prototype,null].includes(Object.getPrototypeOf(binding)));
 const descriptors=Object.getOwnPropertyDescriptors(binding);
 check(Reflect.ownKeys(descriptors).length===3&&['store','fundsEffects','evidence'].every(k=>Object.hasOwn(descriptors[k]??{},'value')));
 const store=descriptors.store.value;
 check(store&&typeof store.read==='function'&&typeof store.transactionMany==='function'&&typeof now==='function');
 const authority=capture(authorization,['assertIndependentStore','withPurposeAuthorization','withPurposeObservation']);
 authority.assertIndependentStore(store);
 const reader=capture(fundsReader,['readForPrincipal']);
 const effects=capture(descriptors.fundsEffects.value,['freezeExisting','settleHeld','releaseHeld','reconcile']);
 const evidence=capture(descriptors.evidence.value,['withMintTerms','withRegistrationAuthorization','withRollbackAuthorization']);
 const cores=new Map(),pending=new Set();let closing=false,stopPromise=null;
 async function core(p){
  // Release this observation gate before acquiring the execution gate below.
  // Its result only chooses the original realm, never authorizes an effect.
  const realm=await authority.withPurposeObservation(p,async(snapshot,revalidate)=>{
   check(typeof revalidate==='function');const current=revalidate();check(current&&typeof current.then!=='function');
   check(receiptPrincipalPurposeDigest(snapshot.purpose)===receiptPrincipalPurposeDigest(p)&&
    receiptPrincipalPurposeDigest(current.purpose)===receiptPrincipalPurposeDigest(p)&&current.principal?.origin===p.origin&&
    current.principal.tenant===tenant&&current.principal.account===p.account&&current.principal.chainId===p.chainId);
   return current.principal.origin;
  });
  if(!cores.has(realm))cores.set(realm,createReceiptPrincipalRuntime({store,authorization:authority,fundsReader:reader,fundsEffects:effects,evidence,origin:realm,tenant,now}));
  return cores.get(realm);
 }
 function invoke(method,raw,request){
  if(closing)throw Error('RECEIPT_PRINCIPAL_COMPOSITION_STOPPED');
  const purpose=normalizeReceiptPrincipalPurpose(raw);check(purpose.tenant===tenant);
  // Request normalization belongs to the runtime; detach before the first await.
  const detached=request===undefined?undefined:structuredClone(request);
  const result=(async()=>{const runtime=await core(purpose);return method==='read'||method==='reconcile'?runtime[method](purpose):runtime[method](purpose,detached);})();
  pending.add(result);result.then(()=>pending.delete(result),()=>pending.delete(result));return result;
 }
 return Object.freeze({freeze:(p,r)=>invoke('freeze',p,r),settle:(p,r)=>invoke('settle',p,r),rollback:(p,r)=>invoke('rollback',p,r),
  read:p=>invoke('read',p),reconcile:p=>invoke('reconcile',p),
  stop(){if(stopPromise)return stopPromise;closing=true;stopPromise=(async()=>{while(pending.size)await Promise.allSettled([...pending]);await Promise.all([...cores.values()].map(runtime=>runtime.stop()));})();return stopPromise;},
 });
}

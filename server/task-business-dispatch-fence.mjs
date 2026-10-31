import {createHash} from 'node:crypto';
/** Server-owned original business CAS capability; never an HTTP flag or approval.
 * Its implementation must claim the original business row UNKNOWN, retaining
 * exact canonical task/child binding. A response shape alone is not evidence
 * that an arbitrary transport implements that contract.
 */
const fail=()=>{throw Object.assign(Error('TASK_BUSINESS_DISPATCH_FENCE_REFUSED'),{code:'TASK_BUSINESS_DISPATCH_FENCE_REFUSED'});};
function fields(value,keys){
 if(!value||![Object.prototype,null].includes(Object.getPrototypeOf(value)))fail();
 const ds=Object.getOwnPropertyDescriptors(value);
 if(Reflect.ownKeys(ds).length!==keys.length||!keys.every(k=>Object.hasOwn(ds,k)&&Object.hasOwn(ds[k],'value')))fail();
}
const ident=v=>typeof v==='string'&&/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
const canonical=v=>JSON.stringify(v&&typeof v==='object'?Array.isArray(v)?v.map(x=>JSON.parse(canonical(x))):Object.fromEntries(Object.keys(v).sort().map(k=>[k,JSON.parse(canonical(v[k]))])):v);
function receipt(raw,input){
 fields(raw,['schema','scope','operation','commitment','generation','digest','binding']);
 const b=raw.binding;fields(b,['taskDigest','childDigest','operationId','chainId','actor','nonce','executorDigest','grantPolicyVersion']);
 if(raw.schema!=='8415-ex-dispatch-claim/1'||!ident(raw.scope)||!ident(raw.operation)||!hash(raw.commitment)||
   !Number.isSafeInteger(raw.generation)||raw.generation<1||typeof raw.digest!=='string'||! /^[0-9a-f]{64}$/.test(raw.digest)||
   canonical(b)!==canonical(input.binding))fail();
 const {digest,...unsigned}=raw;
 if(createHash('sha256').update(canonical(unsigned),'utf8').digest('hex')!==digest)fail();
 return structuredClone(raw);
}
export function captureBusinessDispatchFence(port){
 if(port===null||port===undefined)return null;
 fields(port,['identity','claim','assert']);fields(port.identity,['fenceId','fenceVersion','implementationDigest']);
 if(!ident(port.identity.fenceId)||!ident(port.identity.fenceVersion)||!hash(port.identity.implementationDigest)||
   typeof port.claim!=='function'||typeof port.assert!=='function')fail();
 const claim=port.claim.bind(port),assert=port.assert.bind(port),identity=Object.freeze({...port.identity});
 return Object.freeze({identity,
  async claim(input){return receipt(await claim(structuredClone(input)),input);},
  async assert(input,original){
   const expected=receipt(original,input),current=receipt(await assert(structuredClone(input),structuredClone(expected)),input);
   if(canonical(current)!==canonical(expected))fail();
   return current;
  }});
}

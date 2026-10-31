/** Public locator only. Never a grant, callback, cookie, OTP or execution request. */
import {walletName} from './wallet-entry.mjs';
const keys=['schema','tenant','chainId','taskDigest','operationId','childDigest','expectedBudgetRevision'];
const refuse=()=>{throw Object.assign(Error('EX_OPERATION_INTENT_REFUSED'),{code:'EX_OPERATION_INTENT_REFUSED'});};
export function operationIntent(value){
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==keys.length||!keys.every(k=>Object.hasOwn(value,k)))refuse();
  if(value.schema!=='8415-ex-operation-locator/1'||!walletName(value.tenant)||
    !['11155111','560048'].includes(value.chainId)||
    ![value.taskDigest,value.childDigest].every(v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v))||
    typeof value.operationId!=='string'||! /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.operationId)||
    typeof value.expectedBudgetRevision!=='string'||! /^(0|[1-9][0-9]{0,77})$/.test(value.expectedBudgetRevision))refuse();
  return Object.freeze({...value});
}
export function taskIntent(value){
  const fields=['schema','tenant','chainId','taskDigest'];
  if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).length!==fields.length||!fields.every(k=>Object.hasOwn(value,k))||
    value.schema!=='8415-ex-task-locator/1'||!walletName(value.tenant)||!['11155111','560048'].includes(value.chainId)||
    typeof value.taskDigest!=='string'||!/^0x[0-9a-f]{64}$/.test(value.taskDigest))refuse();
  return Object.freeze({...value});
}
export function decodeExternalIntent(value){return value?.schema==='8415-ex-task-locator/1'?taskIntent(value):operationIntent(value);}
export function verifyTaskIntent(value,session,raw,origin){
  const v=taskIntent(value),p=raw?.task?.policy;
  if(String(session?.chainId)!==v.chainId||session?.tenant!==v.tenant||p?.chainId!==v.chainId||p?.tenant!==v.tenant||
    p?.origin!==origin||p?.actor?.toLowerCase()!==session?.account?.toLowerCase()||raw?.task?.digest!==v.taskDigest||
    p?.intent?.kind!=='exact-operation'||!['pending','authorized'].includes(raw?.effectiveStatus))refuse();
  return v;
}
export function captureOperationIntent(window){
  const hash=window.location?.hash??'';
  const prefix=hash.startsWith('#wallet-operation=')?'#wallet-operation=':hash.startsWith('#wallet-task=')?'#wallet-task=':null;
  if(!prefix)return null;
  if(hash.length>2048)refuse();
  const parse=prefix==='#wallet-task='?taskIntent:operationIntent;
  const value=parse(JSON.parse(decodeURIComponent(hash.slice(prefix.length))));
  const state=window.history.state??{},holds=state.walletVerificationOnlyTasks??[];
  if(!Array.isArray(holds)||holds.length>127||!holds.every(v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)))refuse();
  window.history.replaceState({...state,walletTaskDigest:value.taskDigest,walletExOperationIntent:value,
    walletVerificationOnlyTasks:[...new Set([...holds,value.taskDigest])]},'',window.location.pathname+window.location.search);
  return value;
}
export function verifyOperationIntent(value,session,raw,origin){
  const v=operationIntent(value),policy=raw?.task?.policy;
  if(String(session?.chainId)!==v.chainId||session?.tenant!==v.tenant||
    policy?.chainId!==v.chainId||policy?.tenant!==v.tenant||policy?.origin!==origin||
    policy?.actor?.toLowerCase()!==session?.account?.toLowerCase()||
    raw?.task?.digest!==v.taskDigest||policy?.intent?.kind!=='exact-operation'||
    raw?.effectiveStatus!=='authorized'||raw?.budget?.revision!==v.expectedBudgetRevision||
    !raw.budget.reservations.some(r=>r.operationId===v.operationId&&r.childDigest===v.childDigest&&r.status==='reserved'))refuse();
  return v;
}

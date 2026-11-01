/** Binds an explicit principal proposal to the existing normal task-approval
 * challenge. It does not establish source evidence or perform a funds effect. */
import {normalizeReceiptPrincipalPurpose,receiptPrincipalPurposeDigest} from '../src/agent/receiptPrincipal.ts';

export class ReceiptPrincipalGrantError extends Error {
 constructor(){super('TASK_RECEIPT_PRINCIPAL_BINDING_REFUSED');this.code=this.message;this.status=403;}
}
const check=ok=>{if(!ok)throw new ReceiptPrincipalGrantError();};
function fields(value,keys){
 check(value&&[Object.prototype,null].includes(Object.getPrototypeOf(value)));
 const d=Object.getOwnPropertyDescriptors(value);
 check(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>Object.hasOwn(d[k]??{},'value')&&d[k].enumerable));
 return Object.fromEntries(keys.map(k=>[k,d[k].value]));
}
export function assertReceiptPrincipalTaskBinding(raw,{task,executor,reference}){
 const p=normalizeReceiptPrincipalPurpose(raw),policy=task.policy,sale=policy.intent.sale;
 const slot=policy.intent.phases?.find(phase=>phase.phase==='funded');
 check(policy.intent.kind==='artfi-receipt'&&slot&&p.tenant===policy.tenant&&p.origin===policy.origin&&
  p.account===policy.actor&&p.account===sale.buyer&&p.chainId===policy.chainId&&p.payee===sale.seller&&
  p.amountBaseUnits===sale.price&&p.receipt.collection===sale.collection&&p.receipt.tokenId===sale.tokenId&&
  p.receipt.segmentId===policy.intent.segmentId&&p.receipt.planDigest===slot.planDigest&&p.receipt.journalBindingHash===slot.journalBindingHash&&
  p.task.taskId===policy.taskId&&p.task.taskDigest===task.digest&&p.task.executorDigest===executor.digest&&
  p.task.grantReference===reference&&p.task.grantPolicyVersion==='1'&&
  BigInt(p.mintTerms.registrationDeadline)<=BigInt(policy.expiresAt));
 check(p.currency.kind==='native'?sale.paymentToken==='0x'+'0'.repeat(40):p.currency.contract===sale.paymentToken);
 return p;
}
/** The HTTP template intentionally supplies only operationId inside task. Every
 * other task/grant/executor field comes from this server's pending proposal. */
export function prepareReceiptPrincipalPurpose(raw,grant){
 const template=fields(raw,['schema','reservationId','tenant','origin','account','chainId','currency','amountBaseUnits','payee','task','receipt','lineage','mintTerms']);
 const {operationId}=fields(template.task,['operationId']);
 return assertReceiptPrincipalTaskBinding({...template,task:{taskId:grant.task.policy.taskId,taskDigest:grant.task.digest,
  executorDigest:grant.executor.digest,grantReference:grant.reference,grantPolicyVersion:'1',operationId}},grant);
}
export function requireSameReceiptPrincipalPurpose(purpose,grant){
 check(grant.receiptPrincipalPurpose!==undefined);
 const stored=assertReceiptPrincipalTaskBinding(grant.receiptPrincipalPurpose,grant),p=assertReceiptPrincipalTaskBinding(purpose,grant);
 check(receiptPrincipalPurposeDigest(stored)===receiptPrincipalPurposeDigest(p));return stored;
}

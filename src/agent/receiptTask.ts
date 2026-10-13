import { keccak256Utf8 } from '../codec/keccak.ts';
import { isAddressInput } from '../xiongan/address.ts';

export class ReceiptTaskError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
function insist(ok: unknown, code = 'TASK_RECEIPT_SCOPE_REFUSED'): asserts ok {
  if (!ok) throw new ReceiptTaskError(code);
}
function fields(value: unknown, keys: readonly string[]): Record<string, any> {
  insist(value && typeof value === 'object' && !Array.isArray(value));
  insist([Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const d = Object.getOwnPropertyDescriptors(value);
  insist(Reflect.ownKeys(d).length === keys.length && keys.every(k =>
    Object.hasOwn(d, k) && Object.hasOwn(d[k]!, 'value')));
  return Object.fromEntries(keys.map(k => [k, d[k]!.value]));
}
function uint(x: unknown, positive = false, bits = 256): string {
  insist(typeof x === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(x));
  insist(BigInt(x) >= (positive ? 1n : 0n) && BigInt(x) < 1n << BigInt(bits));
  return x;
}
function address(x: unknown): string { insist(isAddressInput(x)); return (x as string).toLowerCase(); }
function hash(x: unknown, zero = false): string {
  insist(typeof x === 'string' && /^0x[0-9a-fA-F]{64}$/.test(x) && (zero || !/^0x0+$/i.test(x)));
  return x.toLowerCase();
}
function id(x: unknown): string { insist(typeof x === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(x)); return x; }
function freeze<T>(x: T): Readonly<T> {
  if (x && typeof x === 'object') { Object.values(x).forEach(freeze); Object.freeze(x); }
  return x;
}
const order = ['funded', 'registered', 'paid'] as const;
export type ReceiptPhase = typeof order[number];
export function freezeReceiptTask(input: unknown) {
  const r = fields(input, ['schema','taskId','tenant','origin','chainId','actor','expiresAt','fees','intent']);
  insist(r.schema === '8415-agent-task/1');
  const taskId = id(r.taskId), tenant = id(r.tenant);
  insist(/^[a-z][a-z0-9-]{0,47}$/.test(tenant));
  insist(typeof r.origin === 'string');
  const origin = new URL(r.origin);
  insist(origin.origin === r.origin && (origin.protocol === 'https:' ||
    origin.protocol === 'http:' && ['localhost','127.0.0.1','[::1]'].includes(origin.hostname)));
  const chainId = uint(r.chainId, true), actor = address(r.actor), expiresAt = uint(r.expiresAt, true, 64);
  insist(['31337','560048'].includes(chainId), 'TASK_RECEIPT_CHAIN_REFUSED');
  const f = fields(r.fees,['perOperationWei','totalWei']);
  const fees = {perOperationWei:uint(f.perOperationWei,true),totalWei:uint(f.totalWei,true)};
  insist(BigInt(fees.perOperationWei) <= BigInt(fees.totalWei));
  const i = fields(r.intent,['kind','handlerId','escrow','runtimeCodeHash','segmentId','sale','correspondence','phases','recovery']);
  insist(i.kind === 'artfi-receipt' && i.handlerId === 'artfi:whole-receipt:v1');
  const s = fields(i.sale,['seller','collection','tokenId','paymentToken','price','buyer','salt','startsAt','endsAt','epoch']);
  const sale = {seller:address(s.seller),collection:address(s.collection),tokenId:uint(s.tokenId),
    paymentToken:address(s.paymentToken),price:uint(s.price,true),buyer:address(s.buyer),salt:uint(s.salt),
    startsAt:uint(s.startsAt,false,48),endsAt:uint(s.endsAt,true,48),epoch:uint(s.epoch)};
  insist(sale.seller !== sale.buyer && BigInt(sale.startsAt) < BigInt(sale.endsAt));
  const ckeys=['settlementId','assetRecordHash','oracleSourceId','requestHash','executionReferenceHash','previousSegment','oldCertificateHash','warehouseReceiptHash'];
  const c=fields(i.correspondence,ckeys);
  const correspondence=Object.fromEntries(ckeys.map(k=>[k,hash(c[k],k==='previousSegment')]));
  insist(Array.isArray(i.phases) && i.phases.length >= 1 && i.phases.length <= 3);
  const ad=Object.getOwnPropertyDescriptors(i.phases);
  insist(Reflect.ownKeys(ad).length===i.phases.length+1);
  const phases=Array.from({length:i.phases.length},(_:unknown,n:number)=>{
    insist(ad[String(n)] && Object.hasOwn(ad[String(n)]!,'value'));
    const p=fields(ad[String(n)]!.value,['phase','nonce','calldataHash','planDigest','journalBindingHash','gasLimit','maxFeePerGasWei','maxPriorityFeePerGasWei']);
    insist(order.includes(p.phase));
    const result={phase:p.phase as ReceiptPhase,nonce:uint(p.nonce),calldataHash:hash(p.calldataHash),
      planDigest:hash(p.planDigest),journalBindingHash:hash(p.journalBindingHash),gasLimit:uint(p.gasLimit,true),
      maxFeePerGasWei:uint(p.maxFeePerGasWei,true),maxPriorityFeePerGasWei:uint(p.maxPriorityFeePerGasWei)};
    insist(BigInt(result.nonce)<=BigInt(Number.MAX_SAFE_INTEGER) &&
      BigInt(result.maxPriorityFeePerGasWei)<=BigInt(result.maxFeePerGasWei) &&
      BigInt(result.gasLimit)*BigInt(result.maxFeePerGasWei)<=BigInt(fees.perOperationWei));
    insist(result.phase !== 'funded' || actor === sale.buyer, 'TASK_RECEIPT_ACTOR_REFUSED');
    return result;
  });
  insist(new Set(phases.map((p:any)=>p.phase)).size===phases.length &&
    new Set(phases.map((p:any)=>p.nonce)).size===phases.length);
  insist(phases.every((p:any,n:number)=>n===0 || order.indexOf(phases[n-1]!.phase)<order.indexOf(p.phase) && BigInt(phases[n-1]!.nonce)<BigInt(p.nonce)));
  insist(phases.reduce((sum:bigint,p:any)=>sum+BigInt(p.gasLimit)*BigInt(p.maxFeePerGasWei),0n)<=BigInt(fees.totalWei));
  const recovery=fields(i.recovery,['funding','payout','unknownOutcome']);
  insist(recovery.funding==='once' && recovery.payout==='once' && recovery.unknownOutcome==='reconcile-only');
  const intent={kind:'artfi-receipt' as const,handlerId:'artfi:whole-receipt:v1' as const,
    escrow:address(i.escrow),runtimeCodeHash:hash(i.runtimeCodeHash),segmentId:hash(i.segmentId),
    sale,correspondence,phases,recovery:{funding:'once',payout:'once',unknownOutcome:'reconcile-only'}};
  const policy={schema:'8415-agent-task/1' as const,taskId,tenant,origin:r.origin as string,chainId,actor,expiresAt,fees,intent};
  return freeze({policy,digest:keccak256Utf8(JSON.stringify(policy))});
}
export type FrozenReceiptTask = ReturnType<typeof freezeReceiptTask>;
export function receiptTaskCopy(input: FrozenReceiptTask) {
  const copy=freezeReceiptTask(input.policy);
  insist(copy.digest===input.digest,'TASK_RECEIPT_DIGEST_REFUSED'); return copy;
}
export function receiptPhaseScope(input: FrozenReceiptTask, phase: ReceiptPhase) {
  const task=receiptTaskCopy(input), p=task.policy.intent.phases.find((p:any)=>p.phase===phase);
  insist(p,'TASK_RECEIPT_PHASE_REFUSED'); return p;
}

/** Submission markers are not chain finality and never renew authority. */
export function normalizeReceiptAttempts(input: FrozenReceiptTask, raw: unknown) {
  const task=receiptTaskCopy(input);
  insist(Array.isArray(raw) && raw.length<=3,'TASK_RECEIPT_BUDGET_REFUSED');
  const descriptors=Object.getOwnPropertyDescriptors(raw);
  insist(Reflect.ownKeys(descriptors).length===raw.length+1,'TASK_RECEIPT_BUDGET_REFUSED');
  const phases=new Set<string>(),nonces=new Set<string>(),operations=new Set<string>();
  let spent=0n;
  const result=Array.from({length:raw.length},(_,n)=>{
    const descriptor=descriptors[String(n)];insist(descriptor && Object.hasOwn(descriptor,'value'),'TASK_RECEIPT_BUDGET_REFUSED');
    const r=fields(descriptor.value,['phase','nonce','operationId','maximumFeeWei','status','transactionHash']);
    const slot=receiptPhaseScope(task,r.phase),operationId=id(r.operationId);
    insist(r.nonce===slot.nonce && !phases.has(r.phase) && !nonces.has(r.nonce) && !operations.has(operationId),'TASK_RECEIPT_BUDGET_REFUSED');
    const maximumFeeWei=(BigInt(slot.gasLimit)*BigInt(slot.maxFeePerGasWei)).toString();
    insist(r.maximumFeeWei===maximumFeeWei && ['outcome-unknown','submitted'].includes(r.status),'TASK_RECEIPT_BUDGET_REFUSED');
    const transactionHash=r.status==='submitted'?hash(r.transactionHash):null;
    insist(r.status!=='outcome-unknown'||r.transactionHash===null,'TASK_RECEIPT_BUDGET_REFUSED');
    phases.add(r.phase);nonces.add(r.nonce);operations.add(operationId);spent+=BigInt(maximumFeeWei);
    return {phase:slot.phase,nonce:slot.nonce,operationId,maximumFeeWei,status:r.status as 'outcome-unknown'|'submitted',transactionHash};
  });
  insist(spent<=BigInt(task.policy.fees.totalWei),'TASK_RECEIPT_BUDGET_REFUSED');
  return freeze(result);
}

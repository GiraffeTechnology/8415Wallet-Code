import type { Eip1193Provider } from '../adapters/signing/eip1193Signer.ts';
import { ResponsibilityControlClient } from './client.ts';
import { RpcHistoryEntitlementReader, type HistoryPrincipal } from './historyEntitlement.ts';
import { requireControlAdapter as check, type ControlDeploymentPin } from './authorization.ts';
import { buildForwardProgress } from '../wallet/forwardProgress.ts';

type Limits = { readonly blocksPerRequest?:bigint; readonly maximumWindows?:bigint;
  readonly maximumRecords?:bigint; readonly maximumRetainedLegs?:bigint };
type Json = string | boolean | null | { readonly [key:string]:Json };
export type HistoricalMilestoneRequest = {
  readonly principal:HistoryPrincipal;
  readonly asset:{readonly chainId:string;readonly contract:string;readonly tokenId:string};
  readonly sequenceId:string; readonly ownOccurrenceId:string;
  readonly milestone:ReturnType<typeof buildForwardProgress>;
};
const uint=(v:unknown):v is string=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<1n<<256n;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&!/^0x0+$/.test(v);
function fields(v:unknown,keys:readonly string[]):Record<string,unknown>{
  check(v!==null&&typeof v==='object'&&!Array.isArray(v)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(v)),'CONTROL_MILESTONE_SCHEMA_REFUSED');
  const d=Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>d[k]&&Object.hasOwn(d[k],'value')),
    'CONTROL_MILESTONE_SCHEMA_REFUSED');
  return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
// Bounded, descriptor-only copy BEFORE any await. No caller getters, cyclic
// structures, hidden keys, symbols, prototype instances or unbounded JSON.
function canonicalCopy(value:unknown,depth=0,budget={remaining:128}):Json{
  check(--budget.remaining>=0&&depth<=6,'CONTROL_MILESTONE_SCHEMA_REFUSED');
  if(value===null||typeof value==='boolean')return value;
  if(typeof value==='string'){
    check(value.length<=256,'CONTROL_MILESTONE_SCHEMA_REFUSED');return value;
  }
  check(value!==null&&typeof value==='object'&&!Array.isArray(value)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(value)),'CONTROL_MILESTONE_SCHEMA_REFUSED');
  const d=Object.getOwnPropertyDescriptors(value),keys=Reflect.ownKeys(d);
  check(keys.length<=24&&keys.every(k=>typeof k==='string'&&Object.hasOwn(d[k]!, 'value')),
    'CONTROL_MILESTONE_SCHEMA_REFUSED');
  return Object.fromEntries((keys as string[]).sort().map(k=>[k,canonicalCopy(d[k]!.value,depth+1,budget)]));
}

/** PRIVATE server validator for the existing validateMilestone reader port.
 * Existing session/CSRF service supplies the actual authenticated principal.
 * A persisted DONE row or client flag is NOT canonical authority: reconstruct
 * full controller/register state and unique principal entitlement at its exact
 * block, then compare EVERY privacy-safe progress field with original bytes.
 * No latest fallback, earliest-milestone discovery, frozen-record mutation,
 * signing, commercial/funds completion or rollback execution is implemented.
 */
export class RpcHistoryMilestoneValidator {
  readonly #provider:Eip1193Provider;
  readonly #pin:ControlDeploymentPin;
  readonly #namespace:{readonly tenant:string;readonly origin:string};
  readonly #fromBlock:bigint;
  readonly #limits:Limits;
  constructor(provider:Eip1193Provider,pin:ControlDeploymentPin,
    namespace:{readonly tenant:string;readonly origin:string},fromBlock:bigint,limits:Limits={}){
    this.#pin=new ResponsibilityControlClient(provider,pin).deployment;
    const ns=fields(namespace,['tenant','origin']);
    check(typeof ns.tenant==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(ns.tenant)&&
      typeof ns.origin==='string','CONTROL_MILESTONE_NAMESPACE_REFUSED');
    let valid=false;try{const u=new URL(ns.origin);valid=u.origin===ns.origin&&['http:','https:'].includes(u.protocol);}
    catch{/* refuse below */}
    check(valid&&typeof fromBlock==='bigint'&&fromBlock>=0n&&fromBlock<1n<<256n,
      'CONTROL_MILESTONE_NAMESPACE_REFUSED');
    this.#namespace=Object.freeze({tenant:ns.tenant,origin:ns.origin});
    this.#fromBlock=fromBlock;this.#limits=Object.freeze({...limits});
    const request=provider.request.bind(provider);
    this.#provider=Object.freeze({request:(args:Parameters<Eip1193Provider['request']>[0])=>request(args)});
  }
  async validateMilestone(input:HistoricalMilestoneRequest):Promise<boolean>{
    const q=fields(input,['principal','asset','sequenceId','ownOccurrenceId','milestone']),
      a=fields(q.asset,['chainId','contract','tokenId']),
      p=fields(q.principal,['tenant','origin','username','account','chainId']);
    const copied=canonicalCopy(q.milestone);
    check(copied!==null&&typeof copied==='object','CONTROL_MILESTONE_SCHEMA_REFUSED');
    check(uint(a.chainId)&&a.chainId!=='0'&&a.chainId===p.chainId&&
      typeof a.contract==='string'&&/^0x[0-9a-f]{40}$/.test(a.contract)&&!/^0x0+$/.test(a.contract)&&
      uint(a.tokenId)&&hash(q.sequenceId)&&hash(q.ownOccurrenceId)&&
      uint(copied.blockNumber)&&hash(copied.blockHash)&&
      copied.schema==='8415-forward-progress/1'&&copied.state==='DONE'&&copied.canExecute===false,
      'CONTROL_MILESTONE_BINDING_REFUSED');
    check(['tenant','origin','username','account','chainId'].every(k=>typeof p[k]==='string'),
      'CONTROL_MILESTONE_BINDING_REFUSED');
    const asset=Object.freeze({chainId:BigInt(a.chainId),contract:a.contract,tokenId:BigInt(a.tokenId)}),
      sequenceId=q.sequenceId,ownOccurrenceId=q.ownOccurrenceId,
      anchor=Object.freeze({blockNumber:BigInt(copied.blockNumber),blockHash:copied.blockHash});
    check(this.#fromBlock<=anchor.blockNumber,'CONTROL_MILESTONE_BINDING_REFUSED');
    // H6 validates namespace/principal and captures it before its first RPC.
    const reader=new RpcHistoryEntitlementReader(this.#provider,this.#pin,this.#namespace,
      {tenant:p.tenant as string,origin:p.origin as string,username:p.username as string,
        account:p.account as string,chainId:p.chainId as string},this.#limits);
    const admitted=await reader.resolveAt({asset,sequenceId,fromBlock:this.#fromBlock,anchor});
    if(admitted.kind!=='bound'||admitted.ownOccurrenceId!==ownOccurrenceId)return false;
    const rebuilt=buildForwardProgress(admitted.source.snapshot,admitted.source.evidence,admitted.ownOccurrenceId);
    if(rebuilt.state!=='DONE')return false;
    // Sorted descriptor copies permit harmless key order, never extra fields.
    // Full-chain scale and historical knownEnd are compared, not current/latest.
    return JSON.stringify(canonicalCopy(rebuilt))===JSON.stringify(copied);
  }
}

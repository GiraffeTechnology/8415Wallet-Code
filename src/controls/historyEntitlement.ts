import { encodeCall, type AbiValue, type StaticType } from '../codec/abi.ts';
import type { Eip1193Provider } from '../adapters/signing/eip1193Signer.ts';
import type { Bytes32 } from '../sdk/types.ts';
import type { LinkedAsset } from '../sdk/linked.ts';
import { ResponsibilityControlClient, decodeControlWords } from './client.ts';
import { RpcFullControlHistoryReader, type FullControlHistoryProjection } from './historyView.ts';
import type { DetachedPrefixAnchor } from './detachedHistoryLocator.ts';
import { controlHex, controlRpc, hashControlBytes, requireControlAdapter as check,
  verifyControlDeployment, type ControlDeploymentPin } from './authorization.ts';

export type HistoryPrincipal = { readonly tenant:string; readonly origin:string; readonly username:string;
  readonly account:string; readonly chainId:string };
type Scope = { readonly principal:HistoryPrincipal; readonly asset:LinkedAsset;
  readonly sequenceId:Bytes32; readonly anchor:DetachedPrefixAnchor;
  readonly readOnly:true; readonly canExecute:false; readonly displayMilestone:'not-evaluated' };
export type HistoryEntitlement =
  | (Scope & {readonly kind:'not-covered';readonly reason:'account-not-created'|'no-owned-occurrence'})
  | (Scope & {readonly kind:'ambiguous';readonly ownedOccurrenceCount:bigint})
  | (Scope & {readonly kind:'bound';readonly controlledAccount:string;readonly accountRuntimeCodeHash:Bytes32;
      readonly ownOccurrenceId:Bytes32;readonly ownPosition:bigint;readonly source:FullControlHistoryProjection});
const uint=(v:unknown):v is bigint=>typeof v==='bigint'&&v>=0n&&v<1n<<256n;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&!/^0x0+$/.test(v);
const address=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v)&&!/^0x0+$/.test(v);
const exact=(v:unknown,keys:readonly string[]):Record<string,unknown>=>{
  check(v!==null&&typeof v==='object'&&!Array.isArray(v)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(v)),'CONTROL_ENTITLEMENT_SCHEMA_REFUSED');
  const d=Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>d[k]&&Object.hasOwn(d[k],'value')),
    'CONTROL_ENTITLEMENT_SCHEMA_REFUSED');
  return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
};
const immutable=<T>(v:T):T=>{
  if(v!==null&&typeof v==='object'){for(const c of Object.values(v))immutable(c);Object.freeze(v);}return v;
};

/** PRIVATE SERVER SOURCE, not a session verifier or browser/API DTO.
 * The authenticated service creates this principal-scoped instance AFTER its
 * existing session/origin/tenant/account/chain checks. No request body may
 * instantiate the principal, controller, provider or account-of capability.
 * This verifies current same-anchor factory ownership and a UNIQUE historical
 * occurrence. Multiple occurrences remain ambiguous until separately admitted
 * per-occurrence authority exists; never choose first/last by equal address.
 * No signing, account creation, completion, frozen-DONE or funds authority.
 */
export class RpcHistoryEntitlementReader {
  readonly #provider:Eip1193Provider;
  readonly #pin:ControlDeploymentPin;
  readonly #principal:HistoryPrincipal;
  readonly #history:RpcFullControlHistoryReader;
  constructor(provider:Eip1193Provider,pin:ControlDeploymentPin,
    namespace:{readonly tenant:string;readonly origin:string},authenticatedPrincipal:HistoryPrincipal,
    limits:{readonly blocksPerRequest?:bigint;readonly maximumWindows?:bigint;readonly maximumRecords?:bigint;
      readonly maximumRetainedLegs?:bigint}={}) {
    const ns=exact(namespace,['tenant','origin']),p=exact(authenticatedPrincipal,
      ['tenant','origin','username','account','chainId']);
    let originOk=false;try{const u=new URL(p.origin as string);originOk=u.origin===p.origin&&
      ['http:','https:'].includes(u.protocol);}catch{/* refused below */}
    this.#pin=new ResponsibilityControlClient(provider,pin).deployment;
    check(typeof ns.tenant==='string'&&/^[a-z][a-z0-9-]{0,47}$/.test(ns.tenant)&&
      ns.tenant===p.tenant&&typeof ns.origin==='string'&&ns.origin===p.origin&&originOk&&
      typeof p.username==='string'&&p.username.length>0&&p.username.length<=256&&address(p.account)&&
      typeof p.chainId==='string'&&/^[1-9][0-9]{0,77}$/.test(p.chainId)&&
      BigInt(p.chainId)<1n<<256n&&BigInt(p.chainId)===this.#pin.chainId,
      'CONTROL_ENTITLEMENT_PRINCIPAL_REFUSED');
    this.#principal=Object.freeze({tenant:p.tenant as string,origin:p.origin as string,
      username:p.username as string,account:p.account,chainId:p.chainId});
    const capturedRequest=provider.request.bind(provider);
    this.#provider=Object.freeze({request:(args:Parameters<Eip1193Provider['request']>[0])=>capturedRequest(args)});
    this.#history=new RpcFullControlHistoryReader(this.#provider,this.#pin,limits);
  }
  async resolveAt(query:{readonly asset:LinkedAsset;readonly sequenceId:Bytes32;
    readonly fromBlock:bigint;readonly anchor:DetachedPrefixAnchor}):Promise<HistoryEntitlement> {
    const q=exact(query,['asset','sequenceId','fromBlock','anchor']),a=exact(q.asset,['chainId','contract','tokenId']),
      at=exact(q.anchor,['blockNumber','blockHash']);
    check(uint(a.chainId)&&a.chainId===this.#pin.chainId&&address(a.contract)&&uint(a.tokenId)&&
      hash(q.sequenceId)&&uint(q.fromBlock)&&uint(at.blockNumber)&&hash(at.blockHash)&&
      q.fromBlock<=at.blockNumber,'CONTROL_ENTITLEMENT_QUERY_REFUSED');
    const asset=Object.freeze({chainId:a.chainId,contract:a.contract,tokenId:a.tokenId}),
      anchor=Object.freeze({blockNumber:at.blockNumber,blockHash:at.blockHash}),
      sequenceId=q.sequenceId,fromBlock=q.fromBlock;
    const scoped={principal:this.#principal,asset,sequenceId,anchor,readOnly:true as const,canExecute:false as const,
      displayMilestone:'not-evaluated' as const};
    await this.#canonical(anchor);
    const block=Object.freeze({blockHash:anchor.blockHash,requireCanonical:true});
    const read=async(to:string,signature:string,args:readonly AbiValue[],types:readonly StaticType[],returns:readonly StaticType[])=>
      decodeControlWords(returns,await controlRpc(this.#provider,'eth_call',
        [{to,data:encodeCall(signature,types,args)},block]));
    const accountAt=async()=>{
      const account=(await read(this.#pin.controller,'accountOf(address)',[this.#principal.account],
        ['address'],['address']))[0] as string;
      if(/^0x0+$/.test(account))return null;
      check(address(account),'CONTROL_ENTITLEMENT_ACCOUNT_REFUSED');
      const registered=(await read(this.#pin.controller,'registeredAccount(address)',[account],
        ['address'],['bool']))[0];
      check(registered===true,'CONTROL_ENTITLEMENT_ACCOUNT_REFUSED');
      const owner=(await read(account,'owner()',[],[],['address']))[0],
        controller=(await read(account,'controller()',[],[],['address']))[0],
        code=await controlRpc(this.#provider,'eth_getCode',[account,block]);
      check(owner===this.#principal.account&&controller===this.#pin.controller.toLowerCase()&&
        controlHex(code)&&code.length>2,'CONTROL_ENTITLEMENT_ACCOUNT_REFUSED');
      return Object.freeze({account,runtimeCodeHash:hashControlBytes(code)});
    };
    // Do not start a full-history scan until this authenticated principal owns
    // a registered account of the actual factory. Sequence membership is still
    // verified below before returning a bound, server-internal source.
    const first=await accountAt();
    if(first===null){
      await this.#canonical(anchor);
      return immutable({...scoped,kind:'not-covered' as const,reason:'account-not-created' as const});
    }
    const source=await this.#history.observeAt(sequenceId,fromBlock,anchor),s=source.snapshot;
    check(source.source.chainId===asset.chainId&&source.source.controller===this.#pin.controller.toLowerCase()&&
      s.asset.chainId===asset.chainId&&s.asset.contract===asset.contract&&s.asset.tokenId===asset.tokenId&&
      s.sequenceId===sequenceId&&s.blockNumber===anchor.blockNumber&&s.blockHash===anchor.blockHash&&
      s.offChainDetached===0n,'CONTROL_ENTITLEMENT_SOURCE_REFUSED');
    const own:{id:Bytes32;position:bigint}[]=[];
    if(s.initialHolder===first.account)own.push({id:s.initialOccurrenceId,position:0n});
    for(let i=0;i<s.legs.length;i++)if(s.legs[i]!.buyer===first.account)
      own.push({id:s.legs[i]!.buyerOccurrenceId,position:BigInt(i)+1n});
    // Re-read actual same-anchor account/factory facts after all source reads;
    // a cached account address or changed code cannot establish this entitlement.
    const last=await accountAt();
    check(last!==null&&last.account===first.account&&last.runtimeCodeHash===first.runtimeCodeHash,
      'CONTROL_ENTITLEMENT_ACCOUNT_CHANGED');
    await this.#canonical(anchor);
    if(own.length===0)return immutable({...scoped,kind:'not-covered' as const,reason:'no-owned-occurrence' as const});
    if(own.length>1)return immutable({...scoped,kind:'ambiguous' as const,ownedOccurrenceCount:BigInt(own.length)});
    return immutable({...scoped,kind:'bound' as const,controlledAccount:first.account,
      accountRuntimeCodeHash:first.runtimeCodeHash,ownOccurrenceId:own[0]!.id,ownPosition:own[0]!.position,source});
  }
  async #canonical(anchor:DetachedPrefixAnchor):Promise<void>{
    await verifyControlDeployment(this.#provider,this.#pin);
    const block=Object.freeze({blockHash:anchor.blockHash,requireCanonical:true});
    const code=await controlRpc(this.#provider,'eth_getCode',[this.#pin.controller,block]);
    check(controlHex(code)&&code.length>2&&hashControlBytes(code)===this.#pin.runtimeCodeHash.toLowerCase(),
      'CONTROL_ENTITLEMENT_RUNTIME_REFUSED');
    const header=await controlRpc(this.#provider,'eth_getBlockByNumber',['0x'+anchor.blockNumber.toString(16),false]);
    check(header!==null&&typeof header==='object'&&!Array.isArray(header),'CONTROL_ENTITLEMENT_REORGED');
    const h=header as Record<string,unknown>;
    check(typeof h.number==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(h.number)&&
      BigInt(h.number)===anchor.blockNumber&&typeof h.hash==='string'&&h.hash.toLowerCase()===anchor.blockHash,
      'CONTROL_ENTITLEMENT_REORGED');
  }
}

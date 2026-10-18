import { encodeCall, encodeWords, REGISTER_ENTRY_TYPES } from '../codec/abi.ts';
import { keccak256Utf8 } from '../codec/keccak.ts';
import type { Eip1193Provider } from '../adapters/signing/eip1193Signer.ts';
import { ResponsibilityControlClient, decodeControlSequence, decodeControlWords } from './client.ts';
import { RpcHistoryEntitlementReader, type HistoryPrincipal, type HistoryEntitlement } from './historyEntitlement.ts';
import { RpcHistoryMilestoneValidator } from './historyMilestone.ts';
import { buildForwardProgress } from '../wallet/forwardProgress.ts';
import type { DetachedPrefixAnchor } from './detachedHistoryLocator.ts';
import { controlHex, controlRpc, hashControlBytes, requireControlAdapter as check,
  type ControlDeploymentPin, verifyControlDeployment } from './authorization.ts';

type Bound = Extract<HistoryEntitlement,{kind:'bound'}>;
type Limits = {readonly blocksPerRequest?:bigint;readonly maximumWindows?:bigint;
  readonly maximumRecords?:bigint;readonly maximumRetainedLegs?:bigint;readonly maximumBlocks?:bigint};
type Header = {readonly blockNumber:bigint;readonly blockHash:string;readonly parentHash:string;readonly timestamp:bigint};
type Location = {readonly blockNumber:bigint;readonly blockHash:string;readonly transactionHash:string;
  readonly transactionIndex:bigint;readonly logIndex:bigint;readonly topics:readonly string[];readonly data:string};
type Coverage = {readonly kind:'canonical-block-end-only';readonly from:DetachedPrefixAnchor;
  readonly through:DetachedPrefixAnchor;readonly checkedBlocks:bigint;
  readonly intraBlockStates:'not-established';readonly canExecute:false};
export type BlockEndDiscovery =
  | {readonly kind:'found';readonly current:Bound;readonly candidate:Bound;
      readonly progress:ReturnType<typeof buildForwardProgress>;readonly coverage:Coverage}
  | {readonly kind:'not-found-at-block-end';readonly current:Bound;readonly coverage:Coverage};

const OPEN=keccak256Utf8('SequenceOpened(bytes32,address,uint256,address,address)');
const uint=(v:unknown):v is bigint=>typeof v==='bigint'&&v>=0n&&v<1n<<256n;
const hash=(v:unknown):v is string=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&!/^0x0+$/.test(v);
const quantity=(v:unknown):bigint=>{
  check(typeof v==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(v),'CONTROL_DISCOVERY_QUANTITY_REFUSED');
  const n=BigInt(v);check(uint(n),'CONTROL_DISCOVERY_QUANTITY_REFUSED');return n;
};
const hex=(n:bigint)=>'0x'+n.toString(16);
function exact(v:unknown,keys:readonly string[]):Record<string,unknown>{
  check(v!==null&&typeof v==='object'&&!Array.isArray(v)&&
    [Object.prototype,null].includes(Object.getPrototypeOf(v)),'CONTROL_DISCOVERY_SCHEMA_REFUSED');
  const d=Object.getOwnPropertyDescriptors(v);
  check(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>d[k]&&Object.hasOwn(d[k],'value')),
    'CONTROL_DISCOVERY_SCHEMA_REFUSED');
  return Object.fromEntries(keys.map(k=>[k,d[k]!.value]));
}
function object(v:unknown):Record<string,unknown>{
  check(v!==null&&typeof v==='object'&&!Array.isArray(v),'CONTROL_DISCOVERY_SCHEMA_REFUSED');
  return v as Record<string,unknown>;
}

/** PRIVATE source discovery, NOT the installed readForPrincipal service port.
 * Searches every canonical block END from a receipt-proven SequenceOpened.
 * This deliberately includes blocks without logs: a future admitted effectiveAt
 * can change holderAsOf solely as the block timestamp advances.
 * Positive candidates are independently revalidated with H7. No-found means
 * no BLOCK-END milestone, never complete intra-block history or historical:[].
 * RPC/coverage/resource failure throws; no silent skipped ranges or fake empty
 * history. Caller must supply actual deployment scan origin and explicit anchor.
 */
export class RpcBlockEndHistoryDiscovery {
  readonly #provider:Eip1193Provider;
  readonly #pin:ControlDeploymentPin;
  readonly #namespace:{readonly tenant:string;readonly origin:string};
  readonly #fromBlock:bigint;
  readonly #limits:Limits;
  readonly #page:bigint;
  readonly #windows:bigint;
  readonly #maximumBlocks:bigint;
  constructor(provider:Eip1193Provider,pin:ControlDeploymentPin,
    namespace:{readonly tenant:string;readonly origin:string},fromBlock:bigint,limits:Limits={}){
    this.#pin=new ResponsibilityControlClient(provider,pin).deployment;
    const ns=exact(namespace,['tenant','origin']);
    check(typeof ns.tenant==='string'&&typeof ns.origin==='string'&&uint(fromBlock),
      'CONTROL_DISCOVERY_CONFIG_REFUSED');
    this.#namespace=Object.freeze({tenant:ns.tenant,origin:ns.origin});this.#fromBlock=fromBlock;
    this.#limits=Object.freeze({...limits});
    this.#page=limits.blocksPerRequest??2_048n;this.#windows=limits.maximumWindows??512n;
    this.#maximumBlocks=limits.maximumBlocks??4_096n;
    check(uint(this.#page)&&this.#page>0n&&this.#page<=10_000n&&
      uint(this.#windows)&&this.#windows>0n&&this.#windows<=4_096n&&
      uint(this.#maximumBlocks)&&this.#maximumBlocks>0n&&this.#maximumBlocks<=1_048_576n,
      'CONTROL_DISCOVERY_CONFIG_REFUSED');
    const request=provider.request.bind(provider);
    this.#provider=Object.freeze({request:(args:Parameters<Eip1193Provider['request']>[0])=>request(args)});
  }
  async discoverAt(input:{readonly principal:HistoryPrincipal;readonly asset:{readonly chainId:bigint;
    readonly contract:string;readonly tokenId:bigint};readonly sequenceId:string;
    readonly anchor:DetachedPrefixAnchor}):Promise<BlockEndDiscovery>{
    const q=exact(input,['principal','asset','sequenceId','anchor']),p=exact(q.principal,
      ['tenant','origin','username','account','chainId']),a=exact(q.asset,['chainId','contract','tokenId']),
      at=exact(q.anchor,['blockNumber','blockHash']);
    check(['tenant','origin','username','account','chainId'].every(k=>typeof p[k]==='string')&&
      uint(a.chainId)&&a.chainId===this.#pin.chainId&&uint(a.tokenId)&&
      typeof a.contract==='string'&&/^0x[0-9a-f]{40}$/.test(a.contract)&&!/^0x0+$/.test(a.contract)&&
      hash(q.sequenceId)&&uint(at.blockNumber)&&hash(at.blockHash)&&this.#fromBlock<=at.blockNumber,
      'CONTROL_DISCOVERY_QUERY_REFUSED');
    const principal=Object.freeze({tenant:p.tenant as string,origin:p.origin as string,username:p.username as string,
      account:p.account as string,chainId:p.chainId as string}),
      asset=Object.freeze({chainId:a.chainId,contract:a.contract,tokenId:a.tokenId}),sequenceId=q.sequenceId,
      anchor=Object.freeze({blockNumber:at.blockNumber,blockHash:at.blockHash});
    check((anchor.blockNumber-this.#fromBlock)/this.#page+1n<=this.#windows,
      'CONTROL_DISCOVERY_RANGE_UNAVAILABLE');
    const reader=new RpcHistoryEntitlementReader(this.#provider,this.#pin,this.#namespace,principal,this.#limits);
    const current=await reader.resolveAt({asset,sequenceId,fromBlock:this.#fromBlock,anchor});
    check(current.kind==='bound','CONTROL_DISCOVERY_CURRENT_ENTITLEMENT_UNAVAILABLE');
    const opening=await this.#opening(sequenceId,asset.contract,asset.tokenId,current.source.snapshot.initialHolder,anchor);
    check(anchor.blockNumber-opening.blockNumber+1n<=this.#maximumBlocks,'CONTROL_DISCOVERY_BLOCK_RANGE_UNAVAILABLE');
    const initial=await this.#firstEntry(sequenceId,asset.contract,asset.tokenId,anchor);
    const checked:Header[]=[];let found:Bound|null=null;
    for(let n=opening.blockNumber;n<=anchor.blockNumber;n++){
      const h=await this.#header(n,n===opening.blockNumber?opening.blockHash:n===anchor.blockNumber?anchor.blockHash:null);
      const previous=checked[checked.length-1];
      check(previous===undefined||h.parentHash===previous.blockHash&&h.timestamp>previous.timestamp,
        'CONTROL_DISCOVERY_CHAIN_DISCONTINUITY');
      checked.push(h);
      const first=await this.#firstEntry(sequenceId,asset.contract,asset.tokenId,h);
      check(first.digest===initial.digest,'CONTROL_DISCOVERY_FIRST_ENTRY_CHANGED');
      // No entry covers the block's instant yet. This is proven from the
      // actual immutable entry, NOT inferred by swallowing an archive RPC error.
      if(first.effectiveAt>h.timestamp)continue;
      const result=await reader.resolveAt({asset,sequenceId,fromBlock:this.#fromBlock,
        anchor:{blockNumber:h.blockNumber,blockHash:h.blockHash}});
      if(result.kind==='not-covered')continue;
      check(result.kind==='bound'&&result.ownOccurrenceId===current.ownOccurrenceId,
        'CONTROL_DISCOVERY_OCCURRENCE_UNAVAILABLE');
      const progress=buildForwardProgress(result.source.snapshot,result.source.evidence,result.ownOccurrenceId);
      if(progress.state==='DONE'){found=result;break;}
    }
    // Every checked block is canonical again before returning. A single failure
    // invalidates this discovery; no partial prefix is relabelled complete.
    for(const h of checked)await this.#header(h.blockNumber,h.blockHash);
    await verifyControlDeployment(this.#provider,this.#pin);await this.#header(anchor.blockNumber,anchor.blockHash);
    const last=checked[checked.length-1];check(last!==undefined,'CONTROL_DISCOVERY_RANGE_UNAVAILABLE');
    const coverage=Object.freeze({kind:'canonical-block-end-only' as const,
      from:Object.freeze({blockNumber:opening.blockNumber,blockHash:opening.blockHash}),
      through:Object.freeze({blockNumber:last.blockNumber,blockHash:last.blockHash}),checkedBlocks:BigInt(checked.length),
      intraBlockStates:'not-established' as const,canExecute:false as const});
    if(found===null)return Object.freeze({kind:'not-found-at-block-end' as const,current,coverage});
    const progress=buildForwardProgress(found.source.snapshot,found.source.evidence,found.ownOccurrenceId);
    const validator=new RpcHistoryMilestoneValidator(this.#provider,this.#pin,this.#namespace,this.#fromBlock,this.#limits);
    check(await validator.validateMilestone({principal,asset:{chainId:asset.chainId.toString(),
      contract:asset.contract,tokenId:asset.tokenId.toString()},sequenceId,ownOccurrenceId:current.ownOccurrenceId,milestone:progress}),
      'CONTROL_DISCOVERY_MILESTONE_UNAVAILABLE');
    await this.#header(anchor.blockNumber,anchor.blockHash);
    return Object.freeze({kind:'found' as const,current,candidate:found,progress,coverage});
  }
  async #header(n:bigint,expected:string|null):Promise<Header>{
    const r=object(await controlRpc(this.#provider,'eth_getBlockByNumber',[hex(n),false]));
    check(quantity(r.number)===n&&hash(r.hash)&&hash(r.parentHash)&&
      (expected===null||r.hash===expected),'CONTROL_DISCOVERY_REORGED');
    const timestamp=quantity(r.timestamp);check(timestamp<1n<<64n,'CONTROL_DISCOVERY_TIME_REFUSED');
    return Object.freeze({blockNumber:n,blockHash:r.hash,parentHash:r.parentHash,timestamp});
  }
  async #firstEntry(sequenceId:string,token:string,tokenId:bigint,at:DetachedPrefixAnchor){
    const block=Object.freeze({blockHash:at.blockHash,requireCanonical:true});
    const controllerCode=await controlRpc(this.#provider,'eth_getCode',[this.#pin.controller,block]);
    check(controlHex(controllerCode)&&controllerCode.length>2&&
      hashControlBytes(controllerCode)===this.#pin.runtimeCodeHash.toLowerCase(),
      'CONTROL_DISCOVERY_CONTROLLER_RUNTIME_REFUSED');
    const s=decodeControlSequence(
      await controlRpc(this.#provider,'eth_call',[{to:this.#pin.controller,
        data:encodeCall('sequence(bytes32)',['bytes32'],[sequenceId])},block]));
    check(s.token===token&&s.tokenId===tokenId,'CONTROL_DISCOVERY_TOKEN_BINDING_REFUSED');
    const code=await controlRpc(this.#provider,'eth_getCode',[token,block]);
    check(controlHex(code)&&code.length>2&&hashControlBytes(code)===s.tokenCodeHash,
      'CONTROL_DISCOVERY_TOKEN_RUNTIME_REFUSED');
    const entry=decodeControlWords(REGISTER_ENTRY_TYPES,await controlRpc(this.#provider,'eth_call',
      [{to:token,data:encodeCall('entryAt(uint256,uint64)',['uint256','uint64'],[tokenId,1n])},block]));
    check(entry[4]===1n&&hash(entry[0])&&uint(entry[5])&&entry[5]<1n<<64n,
      'CONTROL_DISCOVERY_FIRST_ENTRY_REFUSED');
    return Object.freeze({effectiveAt:entry[5],digest:hashControlBytes(encodeWords(REGISTER_ENTRY_TYPES.slice(0,6),entry.slice(0,6)))});
  }
  #log(v:unknown,sequenceId:string,token:string,tokenId:bigint):Location{
    const r=object(v),topics=r.topics;
    check(r.address===this.#pin.controller.toLowerCase()&&r.removed===false&&hash(r.blockHash)&&
      hash(r.transactionHash)&&Array.isArray(topics)&&topics.length===4&&
      [0,1,2,3].every(i=>Object.hasOwn(topics,i)&&controlHex(topics[i],32))&&
      topics[0]===OPEN&&topics[1]===sequenceId&&topics[2]===encodeWords(['address'],[token])&&
      topics[3]===encodeWords(['uint256'],[tokenId])&&controlHex(r.data,64),'CONTROL_DISCOVERY_OPEN_EVENT_REFUSED');
    return Object.freeze({blockNumber:quantity(r.blockNumber),blockHash:r.blockHash,
      transactionHash:r.transactionHash,transactionIndex:quantity(r.transactionIndex),logIndex:quantity(r.logIndex),
      topics:Object.freeze([...topics] as string[]),data:r.data});
  }
  async #opening(sequenceId:string,token:string,tokenId:bigint,initialAccount:string,anchor:DetachedPrefixAnchor):Promise<Location>{
    let found:Location|undefined;
    const topics=[OPEN,sequenceId,encodeWords(['address'],[token]),encodeWords(['uint256'],[tokenId])];
    for(let start=this.#fromBlock;start<=anchor.blockNumber;start+=this.#page){
      const end=start+this.#page-1n<anchor.blockNumber?start+this.#page-1n:anchor.blockNumber;
      const rows=await controlRpc(this.#provider,'eth_getLogs',[{address:this.#pin.controller,
        fromBlock:hex(start),toBlock:hex(end),topics:[...topics]}]);
      check(Array.isArray(rows)&&rows.length<=1,'CONTROL_DISCOVERY_OPEN_EVENT_DUPLICATE');
      if(rows.length===0)continue;
      check(Object.hasOwn(rows,0)&&found===undefined,'CONTROL_DISCOVERY_OPEN_EVENT_DUPLICATE');
      const row=this.#log(rows[0],sequenceId,token,tokenId),data=decodeControlWords(['address','address'],row.data);
      check(row.blockNumber>=start&&row.blockNumber<=end&&data[0]===initialAccount&&!/^0x0+$/.test(data[1] as string),
        'CONTROL_DISCOVERY_OPEN_EVENT_REFUSED');found=row;
    }
    check(found!==undefined,'CONTROL_DISCOVERY_OPEN_EVENT_UNAVAILABLE');
    const located=found;await this.#header(located.blockNumber,located.blockHash);
    const code=await controlRpc(this.#provider,'eth_getCode',[this.#pin.controller,
      {blockHash:located.blockHash,requireCanonical:true}]);
    check(controlHex(code)&&code.length>2&&hashControlBytes(code)===this.#pin.runtimeCodeHash.toLowerCase(),
      'CONTROL_DISCOVERY_OPEN_RUNTIME_REFUSED');
    const receipt=object(await controlRpc(this.#provider,'eth_getTransactionReceipt',[located.transactionHash]));
    check(receipt.status==='0x1'&&receipt.transactionHash===located.transactionHash&&receipt.blockHash===located.blockHash&&
      quantity(receipt.blockNumber)===located.blockNumber&&quantity(receipt.transactionIndex)===located.transactionIndex&&
      Array.isArray(receipt.logs)&&receipt.logs.length<=1_000_000,'CONTROL_DISCOVERY_OPEN_RECEIPT_REFUSED');
    let matches=0;
    for(let i=0;i<receipt.logs.length;i++){
      check(Object.hasOwn(receipt.logs,i),'CONTROL_DISCOVERY_OPEN_RECEIPT_REFUSED');
      const raw=object(receipt.logs[i]);if(quantity(raw.logIndex)!==located.logIndex)continue;
      const saved=this.#log(raw,sequenceId,token,tokenId);
      check(JSON.stringify(saved)===JSON.stringify(located),'CONTROL_DISCOVERY_OPEN_RECEIPT_REFUSED');matches++;
    }
    check(matches===1,'CONTROL_DISCOVERY_OPEN_RECEIPT_REFUSED');
    await this.#header(located.blockNumber,located.blockHash);return located;
  }
}

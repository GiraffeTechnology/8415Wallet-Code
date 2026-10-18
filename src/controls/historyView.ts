import { encodeCall, encodeWords, REGISTER_ENTRY_TYPES, type AbiValue, type StaticType } from '../codec/abi.ts';
import { keccak256Utf8 } from '../codec/keccak.ts';
import { detectConformance } from '../sdk/conformance.ts';
import type { Eip1193Provider } from '../adapters/signing/eip1193Signer.ts';
import type { Bytes32 } from '../sdk/types.ts';
import type { LinkedChainSnapshot, LinkedCompletionEvidence } from '../sdk/linked.ts';
import { buildLinkedChainView } from '../wallet/linkedChainView.ts';
import { ResponsibilityControlClient, decodeControlWords, decodeControlSequence } from './client.ts';
import { RpcDetachedHistoryLocator, type DetachedPrefixAnchor } from './detachedHistoryLocator.ts';
import { controlHex, controlRpc, hashControlBytes, requireControlAdapter as check,
  verifyControlDeployment, type ControlDeploymentPin } from './authorization.ts';

const uint = (v: unknown): v is bigint => typeof v === 'bigint' && v >= 0n && v < 1n << 256n;
const hash = (v: unknown): v is string => controlHex(v,32) && !/^0x0+$/i.test(v);
const occurrence = (sequenceId: Bytes32, index: bigint): Bytes32 =>
  hashControlBytes(encodeWords(['bytes32','bytes32','uint256'],
    [keccak256Utf8('8415Wallet/Occurrence/v1'),sequenceId,index]));
const immutable = <T>(value:T):T => {
  if(value!==null && typeof value==='object') {
    for(const item of Object.values(value)) immutable(item);
    Object.freeze(value);
  }
  return value;
};

export type FullControlHistoryProjection = {
  readonly snapshot: LinkedChainSnapshot;
  readonly evidence: LinkedCompletionEvidence;
  readonly projection: {
    readonly instant: bigint; readonly owner: string; readonly holder: string;
    readonly admittedVersion: bigint; readonly protocolFinality: boolean;
    readonly openGapId: string; readonly contested: boolean;
    readonly registerId: string; readonly verificationProfile: string;
    readonly freshness: 'not-evaluated';
  };
  readonly source: {
    readonly schema: '8415-full-control-history/1';
    readonly chainId: bigint; readonly controller: string; readonly sequenceId: Bytes32;
    readonly anchor: DetachedPrefixAnchor; readonly detachedCount: bigint;
    readonly appendedCount: bigint; readonly detachedCommitment: Bytes32;
    readonly readOnly: true; readonly canExecute: false;
    readonly principalEntitlement: 'not-evaluated'; readonly displayMilestone: 'not-evaluated';
    readonly fundsAndRollbackExecution: 'not-evaluated';
  };
};

/** Server-side full-history source, NEVER an authenticated API response.
 * Actual canonical detached events/receipts/commitment are verified by H4; all
 * active state and token protocol answers are read at the SAME explicit anchor.
 * No imported snapshot, source document, address ordering or authority callback.
 * Entitlement and historical milestone selection are deliberately separate.
 */
export class RpcFullControlHistoryReader {
  readonly #provider: Eip1193Provider;
  readonly #client: ResponsibilityControlClient;
  readonly #prefix: RpcDetachedHistoryLocator;
  constructor(provider:Eip1193Provider, pin:ControlDeploymentPin,
    limits:{readonly blocksPerRequest?:bigint;readonly maximumWindows?:bigint;readonly maximumRecords?:bigint;
      readonly maximumRetainedLegs?:bigint}={}) {
    const fixedPin=new ResponsibilityControlClient(provider,pin).deployment;
    const maximumRetained=limits.maximumRetainedLegs??16_384n;
    check(uint(maximumRetained)&&maximumRetained>0n&&maximumRetained<=1_048_576n,
      'CONTROL_HISTORY_RESOURCE_LIMIT_REFUSED');
    const request=provider.request.bind(provider);
    const sequenceCall=encodeCall('sequence(bytes32)',['bytes32'],['0x'+'0'.repeat(64)]).slice(0,10);
    // Enforce availability bounds on EVERY actual sequence response before H1/H4
    // can loop over a provider-supplied retained tail. Checking only after their
    // snapshot completes would not bound work; returned tails are not the active
    // 128-leg protocol window. This is no lifetime trade-count limit.
    const bounded:Eip1193Provider={async request(args){
      const result=await request(args),params=args.params??[];
      const tx=params[0] as {to?:unknown;data?:unknown}|undefined;
      if(args.method==='eth_call'&&tx!==undefined&&typeof tx==='object'&&tx!==null&&
        typeof tx.to==='string'&&tx.to.toLowerCase()===fixedPin.controller.toLowerCase()&&
        typeof tx.data==='string'&&tx.data.slice(0,10)===sequenceCall){
        const state=decodeControlSequence(result);
        check(state.appended>=state.completedCount&&state.appended-state.completedCount<=maximumRetained&&
          state.appended<=1_048_576n,'CONTROL_HISTORY_RESOURCE_UNAVAILABLE');
      }
      return result;
    }};
    this.#provider=bounded;
    this.#client=new ResponsibilityControlClient(bounded,fixedPin);
    this.#prefix=new RpcDetachedHistoryLocator(bounded,fixedPin,limits);
  }
  async observeAt(sequenceId:Bytes32, fromBlock:bigint, anchor:DetachedPrefixAnchor):Promise<FullControlHistoryProjection> {
    check(anchor!==null && typeof anchor==='object' && !Array.isArray(anchor),
      'CONTROL_HISTORY_ANCHOR_REFUSED');
    const descriptors=Object.getOwnPropertyDescriptors(anchor);
    check(Reflect.ownKeys(descriptors).length===2 &&
      ['blockNumber','blockHash'].every(k=>descriptors[k]&&Object.hasOwn(descriptors[k],'value')),
      'CONTROL_HISTORY_ANCHOR_REFUSED');
    const number=descriptors.blockNumber!.value, blockHash=descriptors.blockHash!.value;
    check(uint(number)&&hash(blockHash)&&hash(sequenceId)&&uint(fromBlock)&&fromBlock<=number,
      'CONTROL_HISTORY_ANCHOR_REFUSED');
    sequenceId=sequenceId.toLowerCase();
    const fixed=Object.freeze({blockNumber:number,blockHash:blockHash.toLowerCase()});
    const prefix=await this.#prefix.locate(sequenceId,fromBlock,fixed);
    const at=await this.#client.snapshotAt(sequenceId,number,fixed.blockHash),s=at.sequence,
      pin=this.#client.deployment,block=Object.freeze({blockHash:fixed.blockHash,requireCanonical:true});
    check(prefix.sequenceId===sequenceId && prefix.chainId===pin.chainId &&
      prefix.controller===pin.controller.toLowerCase() && prefix.token===s.token && prefix.tokenId===s.tokenId &&
      prefix.revision===s.revision && prefix.anchor.blockNumber===number && prefix.anchor.blockHash===fixed.blockHash &&
      prefix.detachedCount===s.completedCount && prefix.detachedCount===at.firstOccurrence &&
      BigInt(prefix.records.length)===s.completedCount && prefix.detachedCommitment===s.detachedCommitment &&
      prefix.boundaryAccount===(at.legs[0]?.fromAccount??s.currentAccount),
      'CONTROL_HISTORY_SOURCE_MISMATCH');
    check(s.appended<=1_048_576n && s.appended===s.completedCount+BigInt(at.legs.length),
      'CONTROL_HISTORY_RESOURCE_UNAVAILABLE');
    const controlId=hashControlBytes(encodeWords(['uint256','address','bytes32'],
      [pin.chainId,pin.controller,sequenceId]));
    const fullLegs=[...prefix.records.map(row=>({id:row.legId,seller:row.fromAccount,buyer:row.toAccount,
      termsHash:row.termsHash,acceptanceHash:row.acceptanceHash,outcome:'completed' as const})),
      ...at.legs.map(row=>({id:row.id,seller:row.fromAccount,buyer:row.toAccount,
        termsHash:row.termsHash,acceptanceHash:row.acceptanceHash,outcome:row.outcome}))];
    const snapshot:LinkedChainSnapshot={asset:{chainId:pin.chainId,contract:s.token,tokenId:s.tokenId},
      sequenceId,revision:s.revision,blockNumber:number,blockHash:fixed.blockHash,
      initialOccurrenceId:occurrence(sequenceId,0n),initialHolder:s.initialAccount,
      offChainDetached:0n,detachedCommitment:s.detachedCommitment,
      legs:fullLegs.map((leg,i)=>({id:leg.id,predecessorId:i===0?null:fullLegs[i-1]!.id,
        seller:leg.seller,buyer:leg.buyer,buyerOccurrenceId:occurrence(sequenceId,BigInt(i)+1n),
        termsHash:leg.termsHash,outcome:leg.outcome,control:{controlId,acceptanceHash:leg.acceptanceHash}}))};
    // Existing full structural validator detects cross-boundary duplicate IDs,
    // reused occurrences/acceptances, bad continuity and terminal prefix/suffix.
    buildLinkedChainView(snapshot,{kind:'unavailable'});
    const read=async(to:string,signature:string,args:readonly AbiValue[],types:readonly StaticType[],returns:readonly StaticType[])=>
      decodeControlWords(returns,await controlRpc(this.#provider,'eth_call',
        [{to,data:encodeCall(signature,types,args)},block]));
    const verifyToken=async()=>{
      const code=await controlRpc(this.#provider,'eth_getCode',[s.token,block]);
      check(controlHex(code)&&code.length>2&&hashControlBytes(code)===s.tokenCodeHash,
        'CONTROL_HISTORY_TOKEN_IDENTITY_CHANGED');
    };
    await verifyToken();
    const conformance=await detectConformance({async supportsInterface(id){
      return (await read(s.token,'supportsInterface(bytes4)',[id],['bytes4'],['bool']))[0] as boolean;
    }});
    check(conformance.erc165,'CONTROL_HISTORY_ERC165_UNSUPPORTED');
    check(conformance.projection,'CONTROL_HISTORY_PROJECTION_UNSUPPORTED');
    check(conformance.settlement,'CONTROL_HISTORY_SETTLEMENT_UNSUPPORTED');
    const registerId=(await read(s.token,'registerId()',[],[],['bytes32']))[0] as string,
      verificationProfile=(await read(s.token,'verificationProfile()',[],[],['bytes32']))[0] as string;
    check(registerId===s.registerId&&verificationProfile===s.verificationProfile,
      'CONTROL_HISTORY_PROJECTION_IDENTITY_CHANGED');
    const owner=(await read(s.token,'ownerOf(uint256)',[s.tokenId],['uint256'],['address']))[0] as string;
    const entry=await read(s.token,'entryAsOf(uint256,uint64)',[s.tokenId,at.timestamp],
      ['uint256','uint64'],REGISTER_ENTRY_TYPES);
    const holder=(await read(s.token,'holderAsOf(uint256,uint64)',[s.tokenId,at.timestamp],
      ['uint256','uint64'],['address']))[0] as string;
    const finality=(await read(s.token,'isFinalAsOf(uint256,uint64)',[s.tokenId,at.timestamp],
      ['uint256','uint64'],['bool']))[0] as boolean;
    const openGapId=(await read(s.token,'openGapOf(uint256)',[s.tokenId],['uint256'],['bytes32']))[0] as string;
    let contested=false;
    if(!/^0x0+$/.test(openGapId)){
      const gap=await read(s.token,'settlement(bytes32)',[openGapId],['bytes32'],
        ['uint256','address','address','bytes32','uint64','uint64','uint8']);
      check(gap[0]===s.tokenId&&gap[6]===1n,'CONTROL_HISTORY_GAP_BINDING_REFUSED');
      contested=(gap[4] as bigint)<=at.timestamp;
    }
    const binding=await read(pin.controller,'admissionBinding(bytes32,uint64)',[sequenceId,entry[4]!],
      ['bytes32','uint64'],['bool','uint256','bytes32']);
    let evidence:LinkedCompletionEvidence={kind:'unavailable'};
    if(binding[0]===true){
      const index=binding[1] as bigint;
      check(index<=s.appended,'CONTROL_HISTORY_OCCURRENCE_REFUSED');
      const account=index===0n?s.initialAccount:fullLegs[Number(index-1n)]!.buyer;
      check(binding[2]===hashControlBytes(encodeWords(REGISTER_ENTRY_TYPES.slice(0,6),entry.slice(0,6)))&&
        account===holder&&entry[3]===holder,'CONTROL_HISTORY_ADMISSION_BINDING_REFUSED');
      // A closed control may permit a standalone withdrawal. Never attach an
      // unrelated current owner to a previous cursor by address-search fallback.
      if(owner===s.currentAccount)evidence={kind:'bound',asset:snapshot.asset,sequenceId,revision:s.revision,
        blockNumber:number,blockHash:fixed.blockHash,owner:{occurrenceId:occurrence(sequenceId,s.cursor),account:owner},
        admittedHolder:{occurrenceId:occurrence(sequenceId,index),account:holder},protocolFinality:finality};
    }
    buildLinkedChainView(snapshot,evidence);
    await verifyToken();
    await verifyControlDeployment(this.#provider,pin);
    const end=await controlRpc(this.#provider,'eth_getBlockByNumber',['0x'+number.toString(16),false]);
    check(end!==null&&typeof end==='object'&&!Array.isArray(end),'CONTROL_HISTORY_REORGED');
    const last=end as Record<string,unknown>;
    check(typeof last.number==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(last.number)&&
      BigInt(last.number)===number&&typeof last.hash==='string'&&last.hash.toLowerCase()===fixed.blockHash,
      'CONTROL_HISTORY_REORGED');
    return immutable({snapshot,evidence,projection:{instant:at.timestamp,owner,holder,admittedVersion:entry[4] as bigint,
      protocolFinality:finality,openGapId,contested,registerId,verificationProfile,freshness:'not-evaluated' as const},
      source:{schema:'8415-full-control-history/1' as const,chainId:pin.chainId,controller:pin.controller.toLowerCase(),
        sequenceId,anchor:fixed,detachedCount:s.completedCount,appendedCount:s.appended,detachedCommitment:s.detachedCommitment,
        readOnly:true as const,canExecute:false as const,principalEntitlement:'not-evaluated' as const,
        displayMilestone:'not-evaluated' as const,fundsAndRollbackExecution:'not-evaluated' as const}});
  }
}

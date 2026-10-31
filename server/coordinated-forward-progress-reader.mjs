import {createRpcForwardProgressReader} from './forward-progress-reader.mjs';
import {RpcHistoryEntitlementReader} from '../src/controls/historyEntitlement.ts';
import {NativeResponsibilityPaymentClient} from '../src/controls/payments.ts';
import {ResponsibilityControlClient,decodeControlWords} from '../src/controls/client.ts';
import {controlRpc,verifyControlDeployment} from '../src/controls/authorization.ts';
import {encodeCall} from '../src/codec/abi.ts';
import {projectCoordination} from './coordination-projection.mjs';
const refuse=ok=>{if(!ok)throw Error('COORDINATION_SOURCE_REFUSED');};
const exact=(v,keys)=>{refuse(v!==null&&typeof v==='object'&&!Array.isArray(v));const d=Object.getOwnPropertyDescriptors(v);refuse(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>d[k]&&Object.hasOwn(d[k],'value')));return Object.fromEntries(keys.map(k=>[k,d[k].value]));};
const allowed=new Set(['eth_chainId','eth_getCode','eth_getBlockByNumber','eth_call','eth_getLogs','eth_getTransactionReceipt']);
/** PRIVATE V3 composition, installed by the existing trusted runtime owner only.
 * paymentPin absent means UNKNOWN, not unfunded. No configuration/credentials or
 * execution surface is created. Existing forward-history coverage rules remain.
 */
export function createRpcCoordinatedForwardProgressReader(options){
 const d=Object.getOwnPropertyDescriptors(options??{}),keys=Reflect.ownKeys(d);
 refuse(['provider','pin','tenant','origin','fromBlock'].every(k=>d[k])&&keys.every(k=>typeof k==='string'&&['provider','pin','tenant','origin','fromBlock','limits','paymentPin','maximumPaymentRecords'].includes(k)&&Object.hasOwn(d[k],'value')));
 const {paymentPin=null,maximumPaymentRecords=1024,...base}=Object.fromEntries(keys.map(k=>[k,d[k].value]));
 refuse(Number.isSafeInteger(maximumPaymentRecords)&&maximumPaymentRecords>0&&maximumPaymentRecords<=16384);
 const descriptor=Object.getOwnPropertyDescriptor(base.provider??{},'request');refuse(descriptor&&typeof descriptor.value==='function');
 const request=descriptor.value.bind(base.provider),provider=Object.freeze({request:args=>{refuse(allowed.has(args.method));return request(args);}});
 const pin=new ResponsibilityControlClient(provider,base.pin).deployment;
 const fixedPaymentPin=paymentPin===null?null:Object.freeze(exact(paymentPin,['chainId','controller','runtimeCodeHash']));
 const payment=fixedPaymentPin===null?null:new NativeResponsibilityPaymentClient(provider,pin,fixedPaymentPin);
 const namespace=Object.freeze({tenant:base.tenant,origin:base.origin}),fromBlock=base.fromBlock,limits=Object.freeze({...base.limits});
 const forward=createRpcForwardProgressReader({...base,provider,pin});
 return Object.freeze({...forward,async readCoordination(input){
  const q=exact(input,['principal','asset','sequenceId','ownOccurrenceId','anchor']);
  const principal=Object.freeze(exact(q.principal,['tenant','origin','username','account','chainId'])),asset=Object.freeze(exact(q.asset,['chainId','contract','tokenId']));
  const anchorInput=exact(q.anchor,['blockNumber','blockHash']);
  refuse(typeof anchorInput.blockNumber==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(anchorInput.blockNumber)&&typeof anchorInput.blockHash==='string');
  const anchor=Object.freeze({blockNumber:BigInt(anchorInput.blockNumber),blockHash:anchorInput.blockHash});
  const entitlement=new RpcHistoryEntitlementReader(provider,pin,namespace,principal,limits);
  const result=await entitlement.resolveAt({asset:{chainId:BigInt(asset.chainId),contract:asset.contract,tokenId:BigInt(asset.tokenId)},sequenceId:q.sequenceId,fromBlock,anchor});
  refuse(result.kind==='bound'&&result.ownOccurrenceId===q.ownOccurrenceId&&Object.keys(principal).every(k=>result.principal?.[k]===principal[k])&&result.anchor?.blockNumber===anchor.blockNumber&&result.anchor?.blockHash===anchor.blockHash);
  refuse(result.source.snapshot.asset.chainId===BigInt(asset.chainId)&&result.source.snapshot.asset.contract===asset.contract&&result.source.snapshot.asset.tokenId===BigInt(asset.tokenId)&&result.source.snapshot.sequenceId===q.sequenceId&&result.source.snapshot.blockHash===anchor.blockHash&&result.source.snapshot.blockNumber===anchor.blockNumber);
  const {snapshot,evidence}=result.source;
  const payments=payment===null?null:[];
  if(payment){
   refuse(snapshot.legs.length<=maximumPaymentRecords);
   const block={blockHash:anchor.blockHash,requireCanonical:true};
   const adapterAt=decodeControlWords(['address'],await controlRpc(provider,'eth_call',[{to:pin.controller,data:encodeCall('nativePayments()',[],[])},block]))[0];
   const controllerAt=decodeControlWords(['address'],await controlRpc(provider,'eth_call',[{to:fixedPaymentPin.controller,data:encodeCall('controller()',[],[])},block]))[0];
   refuse(adapterAt===fixedPaymentPin.controller.toLowerCase()&&controllerAt===pin.controller.toLowerCase());
   const ownerAt=async account=>decodeControlWords(['address'],await controlRpc(provider,'eth_call',[{to:account,data:encodeCall('owner()',[],[])},block]))[0];
   for(const leg of snapshot.legs){
    const p=await payment.readAt(q.sequenceId,leg.id,anchor.blockHash);
    const outcome=decodeControlWords(['uint8'],await controlRpc(provider,'eth_call',[{to:pin.controller,data:encodeCall('legTerminalOutcome(bytes32,bytes32)',['bytes32','bytes32'],[q.sequenceId,leg.id])},block]))[0];
    refuse(['active','completed','returning','returned'][Number(outcome)]===leg.outcome);
    if(p.state==='unfunded')refuse(p.amount===0n&&/^0x0+$/.test(p.payer)&&/^0x0+$/.test(p.payee));
    else refuse(p.amount>0n&&p.payer===await ownerAt(leg.buyer)&&p.payee===await ownerAt(leg.seller));
    payments.push(p);
   }
  }
  const view=projectCoordination({snapshot,evidence,ownOccurrenceId:q.ownOccurrenceId,payments});
  // Repeat actual entitlement after all asynchronous reads, then final chain and
  // canonical anchor check. No cached scope or self-declared verified flag.
  const again=await entitlement.resolveAt({asset:{chainId:BigInt(asset.chainId),contract:asset.contract,tokenId:BigInt(asset.tokenId)},sequenceId:q.sequenceId,fromBlock,anchor});
  refuse(again.kind==='bound'&&again.ownOccurrenceId===q.ownOccurrenceId&&again.controlledAccount===result.controlledAccount&&again.accountRuntimeCodeHash===result.accountRuntimeCodeHash&&again.source.snapshot.revision===snapshot.revision);
  await verifyControlDeployment(provider,pin);
  const header=await controlRpc(provider,'eth_getBlockByNumber',['0x'+anchor.blockNumber.toString(16),false]);
  refuse(header?.hash===anchor.blockHash&&BigInt(header.number)===anchor.blockNumber);
  return Object.freeze({principal,asset,sequenceId:q.sequenceId,ownOccurrenceId:q.ownOccurrenceId,view});
 }});
}

/** Compose an existing authenticated full-history capability instead of H8's
 * bounded block-end discovery. This is server construction only, never a request
 * option. The supplied history reader retains responsibility for canonical full
 * historical coverage and milestone provenance; no caller flags supply proof.
 */
export function withRpcCoordinationReader(historyReader, options){
 const d=Object.getOwnPropertyDescriptors(historyReader??{});
 refuse(['readForPrincipal','validateMilestone'].every(k=>d[k]&&Object.hasOwn(d[k],'value')&&typeof d[k].value==='function'));
 const read=d.readForPrincipal.value.bind(historyReader),validate=d.validateMilestone.value.bind(historyReader);
 const {readCoordination}=createRpcCoordinatedForwardProgressReader(options);
 return Object.freeze({readForPrincipal:input=>read(input),validateMilestone:input=>validate(input),readCoordination});
}

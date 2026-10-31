/** Composition fixture: entitlement/history transport doubles, real pinned payment
 * ABI decoder and controller verification. No EVM execution or external RPC. */
import test from 'node:test';import assert from 'node:assert/strict';import {readFile} from 'node:fs/promises';
import {encodeCall,encodeWords} from '../src/codec/abi.ts';import {hashControlBytes} from '../src/controls/authorization.ts';
const h=n=>'0x'+n.toString(16).padStart(64,'0'),a=n=>'0x'+n.toString(16).padStart(40,'0');
async function fixture(){
 const stateUrl='data:text/javascript,'+encodeURIComponent(`export const state={result:null,reads:0};export class RpcHistoryEntitlementReader {constructor(provider,pin,ns,p){state.principal=p;state.provider=provider;}async resolveAt(){state.reads++;return state.result;}};export const createRpcForwardProgressReader=()=>({readForPrincipal:async()=>null,validateMilestone:async()=>true}); // ${Math.random()}`);
 const {state}=await import(stateUrl);let src=await readFile(new URL('../server/coordinated-forward-progress-reader.mjs',import.meta.url),'utf8');
 src=src.replace(/from '([^']+)'/g,(_,p)=>'from '+JSON.stringify(p.includes('historyEntitlement')||p==='./forward-progress-reader.mjs'?stateUrl:new URL(p,new URL('../server/coordinated-forward-progress-reader.mjs',import.meta.url)).href));
 const {createRpcCoordinatedForwardProgressReader:create,withRpcCoordinationReader:attach}=await import('data:text/javascript,'+encodeURIComponent(src));
 const principal={tenant:'fixture',origin:'https://wallet.example',username:'owner',account:a(30),chainId:'1'},asset={chainId:1n,contract:a(90),tokenId:7n},sequenceId=h(1),ownOccurrenceId=h(101),blockHash=h(10),blockNumber=10n,revision=10n;
 const snapshot={asset,sequenceId,revision,blockHash,blockNumber,initialHolder:a(10),initialOccurrenceId:h(100),legs:[{id:h(200),buyerOccurrenceId:ownOccurrenceId,seller:a(10),buyer:a(11),outcome:'returned'}]};
 const evidence={kind:'bound',owner:{occurrenceId:h(100)},admittedHolder:{occurrenceId:h(100)}};
 state.result={kind:'bound',principal,anchor:{blockNumber,blockHash},ownOccurrenceId,controlledAccount:a(11),accountRuntimeCodeHash:h(9),source:{snapshot,evidence}};
 const code='0x60006000',pin={chainId:1n,controller:a(1),runtimeCodeHash:hashControlBytes(code)},paymentPin={...pin,controller:a(2)};
 const context={principal,asset:{chainId:'1',contract:a(90),tokenId:'7'},sequenceId,ownOccurrenceId,anchor:{blockNumber:'10',blockHash}};
 const fault={type:'',state:5n},calls=[];
 const provider={request:async({method,params=[]})=>{calls.push({method,params});
  if(method==='eth_chainId')return fault.type==='chain'?'0x2':'0x1';
  if(method==='eth_getCode')return fault.type==='runtime'&&typeof params[1]==='object'?'0x6001':code;
  if(method==='eth_getBlockByNumber')return {number:'0xa',hash:fault.type==='reorg'?h(99):blockHash};
  if(method==='eth_call'){const tx=params[0];
   if(tx.data===encodeCall('controller()',[],[]))return encodeWords(['address'],[pin.controller]);
   if(tx.data===encodeCall('nativePayments()',[],[]))return encodeWords(['address'],[fault.type==='binding'&&typeof params[1]==='object'?a(99):paymentPin.controller]);
   assert.deepEqual(params[1],{blockHash,requireCanonical:true});
   if(tx.data===encodeCall('payment(bytes32,bytes32)',['bytes32','bytes32'],[sequenceId,h(200)]))return encodeWords(['address','address','uint256','uint8'],[fault.type==='payer'?a(99):a(30),a(29),100n,fault.state]);
   if(tx.data===encodeCall('legTerminalOutcome(bytes32,bytes32)',['bytes32','bytes32'],[sequenceId,h(200)]))return encodeWords(['uint8'],[fault.type==='outcome'?1n:3n]);
   if(tx.data===encodeCall('owner()',[],[]))return encodeWords(['address'],[tx.to===a(11)?a(30):a(29)]);
  }throw Error('UNEXPECTED_RPC');}};
 return {create,attach,options:{provider,pin,paymentPin,tenant:'fixture',origin:'https://wallet.example',fromBlock:0n},context,fault,calls,state};
}
test('real payment ABI read pinned to entitlement block and runtime; no write methods',async()=>{
 const f=await fixture(),reader=f.create(f.options);const v=await reader.readCoordination(f.context);assert.equal(v.view.rollback.state,'DONE');assert.equal(v.view.funds.legs[0].state,'refunded');assert.equal(f.state.reads,2);assert.equal(f.calls.at(-1).method,'eth_getBlockByNumber');assert.ok(f.calls.every(c=>!/(send|sign)/i.test(c.method)));
});
for(const fault of ['chain','runtime','reorg','payer','outcome','binding'])test(`reader refuses ${fault} without partial finance response`,async()=>{const f=await fixture();f.fault.type=fault;await assert.rejects(f.create(f.options).readCoordination(f.context));});
test('unknown payment state and cross principal anchor refused',async()=>{
 const f=await fixture();f.fault.state=7n;await assert.rejects(f.create(f.options).readCoordination(f.context),/STATE_REFUSED/);
 f.fault.state=5n;f.state.result.principal={...f.context.principal,account:a(99)};await assert.rejects(f.create(f.options).readCoordination(f.context),/SOURCE_REFUSED/);
 f.state.result.principal=f.context.principal;f.state.result.anchor.blockHash=h(99);await assert.rejects(f.create(f.options).readCoordination(f.context),/SOURCE_REFUSED/);
});
test('missing adapter explicit unknown, bound capabilities cannot be replaced, write RPC fence remains',async()=>{
 const f=await fixture(),reader=f.create({...f.options,paymentPin:null});f.options.provider.request=()=>{throw Error('REPLACED');};
 const v=await reader.readCoordination(f.context);assert.equal(v.view.funds.state,'unknown');assert.equal(v.view.rollback.state,'unknown');
 assert.throws(()=>f.state.provider.request({method:'eth_sendTransaction',params:[]}),/SOURCE_REFUSED/);
});
test('factory refuses accessors without executing them',async()=>{
 const f=await fixture();let ran=false;Object.defineProperty(f.options,'paymentPin',{get(){ran=true;throw Error('GETTER');}});assert.throws(()=>f.create(f.options),/SOURCE_REFUSED/);assert.equal(ran,false);
});

test('existing trusted full-history capability composes without imposing H8 DONE-only source',async()=>{
 const f=await fixture();let reads=0;const history={readForPrincipal:async()=>{reads++;return {snapshot:'trusted-current',historical:[]};},validateMilestone:async()=>true};
 const reader=f.attach(history,f.options);history.readForPrincipal=()=>{throw Error('REPLACED');};
 assert.deepEqual(await reader.readForPrincipal(f.context),{snapshot:'trusted-current',historical:[]});assert.equal(reads,1);assert.equal(await reader.validateMilestone({}),true);assert.equal((await reader.readCoordination(f.context)).view.rollback.state,'DONE');
});

import assert from 'node:assert/strict';
import {test} from 'node:test';
import {WalletSession} from '../src/wallet/session.ts';
import {AccountMismatchError,Eip1193Signer} from '../src/adapters/signing/eip1193Signer.ts';
import {cancelledGapToken,REGISTRAR,STRANGER,DAVE,TOKEN,settlementId,commitment} from '../src/adapters/memory/scenarios.ts';
async function fixture(){const {contract,reader}=cancelledGapToken();const session=new WalletSession(reader,{account:REGISTRAR});const request=await session.transactions.beginSettlement({tokenId:TOKEN,settlementId:settlementId('4'),expectedHolder:DAVE,snapshotHash:commitment('5'),deadline:contract.now+600n});return {session,request,reader};}

test('review: session signer receives detached request across caller mutation during async signing',async()=>{
 const {session,request}=await fixture();let sent:any;
 const pending=session.send(request,{account:REGISTRAR,sendTransaction:async input=>{await Promise.resolve();sent={from:input.from,to:input.to,data:input.data,chainId:input.chainId};return 'synthetic-hash';}});
 const before={from:request.from,to:request.to,data:request.data,chainId:request.chainId};
 Object.assign(request,{from:STRANGER,to:STRANGER,data:'0xdead',chainId:999n});await pending;assert.deepEqual(sent,before);
});

test('review: immutable signer account rejects a switched provider account after old sender was checked',async()=>{
 const {session,request}=await fixture();let sent=0;let accountReads=0;let signer:Eip1193Signer;
 const provider={request:async({method}:any)=>{
  if(method==='eth_chainId')return '0x'+request.chainId.toString(16);
  if(method==='eth_accounts'){
   accountReads++;
   // A direct assignment to the getter-only property throws before the
   // selected account is returned, making a broad rejects assertion vacuous.
   assert.equal(Reflect.set(signer,'account',STRANGER),false);
   return [STRANGER];
  }
  if(method==='eth_sendTransaction'){sent++;return '0x'+'a'.repeat(64);}
  throw Error('UNEXPECTED_METHOD');
 }};signer=new Eip1193Signer(provider,REGISTRAR);
 await assert.rejects(session.send(request,signer),AccountMismatchError);
 assert.equal(accountReads,1);assert.equal(signer.account,REGISTRAR);assert.equal(sent,0);
});

test('review: source mutation after session construction cannot retarget previously bound send',async()=>{
 const {session,request,reader}=await fixture();Object.assign(reader.source,{chainId:999n,address:STRANGER});let sent:any;
 await session.send(request,{account:REGISTRAR,sendTransaction:async input=>{sent=input;return 'synthetic-hash';}});
 assert.equal(sent.to,request.to);assert.notEqual(sent.to,reader.source.address);assert.notEqual(sent.chainId,reader.source.chainId);
});

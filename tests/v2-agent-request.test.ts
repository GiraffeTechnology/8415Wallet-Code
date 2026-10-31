import assert from 'node:assert/strict';
import { test } from 'node:test';
import { reviewAgentRequest } from '../src/standalone/agentRequest.ts';
import { reviewAgentRequest as oldReview } from '../src/xiongan/agentRequest.ts';
const actor='0x'+'1'.repeat(40),controller='0x'+'2'.repeat(40),token='0x'+'3'.repeat(40),hash='0x'+'4'.repeat(64);
const context={actor,controller:{chainId:560048n,controller,runtimeCodeHash:hash},token:{chainId:560048n,controller:token,runtimeCodeHash:hash},now:1000n};
const input=(operation:unknown)=>JSON.stringify({schema:'xiongan-agent-request/1',requestId:'synthetic-v2',agent:'Synthetic owner',chainId:'560048',actor,controller,expiresAt:'1100',operation});
test('V2 account request preserves all three existing exact reviewed operations and digests',()=>{
 for(const operation of [{kind:'create-account'},{kind:'deposit',tokenId:'1'},{kind:'standalone-withdraw',tokenId:'1',destination:actor}]){
  const json=input(operation);assert.deepEqual(reviewAgentRequest(json,context),oldReview(json,context));
 }
});
test('V2 account request refuses linked actions and exact-schema substitution',()=>{
 for(const kind of ['complete','return-hop','forward','begin-return','reserve-payment'])assert.throws(()=>reviewAgentRequest(input({kind,sequenceId:hash,legId:hash,expectedRevision:'1'}),context),/AGENT_REQUEST_OPERATION_REFUSED/);
 assert.throws(()=>reviewAgentRequest(input({kind:'create-account',sequenceId:hash}),context),/AGENT_REQUEST_SCHEMA_REFUSED/);
 assert.throws(()=>reviewAgentRequest(input({kind:'deposit',tokenId:'1'}),{...context,now:1100n}),/AGENT_REQUEST_EXPIRY_REFUSED/);
});

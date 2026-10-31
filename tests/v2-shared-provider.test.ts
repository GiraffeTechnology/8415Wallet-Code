import test from 'node:test';
import assert from 'node:assert/strict';
import * as common from '../src/standalone/authorization.ts';
import * as legacy from '../src/controls/authorization.ts';
import * as receipts from '../src/standalone/execution.ts';
import * as oldReceipts from '../src/controls/execution.ts';
test('V2 and V3 share exact provider error provenance and receipt implementation',async()=>{
 assert.equal(common.ControlAdapterError,legacy.ControlAdapterError);
 assert.equal(receipts.proveSupersededNonce,oldReceipts.proveSupersededNonce);
 try{await common.controlRpc({request:async()=>{throw {code:4001};}},'eth_sendTransaction',[]);assert.fail('must refuse');}
 catch(e){assert.ok(e instanceof legacy.ControlAdapterError);assert.equal(legacy.isControlProviderRejection(e,'eth_sendTransaction'),true);assert.equal(common.isControlProviderRejection(e,'eth_requestAccounts'),false);}
});
test('shared pin verifier preserves wrong-chain and wrong-runtime refusal',async()=>{
 const pin={chainId:1n,controller:'0x'+'11'.repeat(20),runtimeCodeHash:'0x'+'22'.repeat(32)} as const;
 let codeReads=0;
 await assert.rejects(common.verifyControlDeployment({request:async(args)=>{if(args.method==='eth_getCode')codeReads++;return '0x2';}},pin),/CONTROL_CHAIN_MISMATCH/);
 assert.equal(codeReads,0);
 await assert.rejects(common.verifyControlDeployment({request:async(args)=>args.method==='eth_chainId'?'0x1':'0x6000'},pin),/CONTROL_RUNTIME_PIN_MISMATCH/);
});

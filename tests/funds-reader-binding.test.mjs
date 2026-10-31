import test from 'node:test';import assert from 'node:assert/strict';
import {createFundsService} from '../server/funds-service.mjs';
test('funds service captures the original configured read capability despite later object mutation',async()=>{
 let initial=0,replaced=0;const reader={marker:'configured',async readForPrincipal(context){assert.equal(this.marker,'configured');initial++;return {schema:'8415-authoritative-funds/1',scope:{...context.principal},readId:context.readId,observedAt:1,validUntil:1000,inventoryState:'complete',currencies:[]};}};
 const service=createFundsService({reader,tenant:'fixture',origin:'https://example.invalid',now:()=>100,validateSession:async()=>{}});
 reader.readForPrincipal=async()=>{replaced++;throw Error('unconfigured replacement');};
 const result=await service.read({readId:'a'.repeat(32)},{username:'synthetic',account:'0x'+'1'.repeat(40),chainId:'1'});
 assert.equal(initial,1);assert.equal(replaced,0);assert.equal(result.inventoryState,'complete');
});

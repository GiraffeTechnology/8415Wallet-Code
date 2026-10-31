import test from 'node:test';import assert from 'node:assert/strict';
import {Readable} from 'node:stream';import {mkdtemp,writeFile,chmod,rm} from 'node:fs/promises';import {tmpdir} from 'node:os';import {join} from 'node:path';
import {Wallet,verifyMessage} from 'ethers';import {loginMessage} from '../web/login-core.mjs';
import {createNativeLoginStdioHandler,runNativeLoginStdio,createNativeLoginProofSigner} from '../server/native-login-stdio.mjs';
const wallet=new Wallet('0x'+'1'.repeat(64)),binding={origin:'https://wallet.example.invalid',tenant:'fixture',account:wallet.address,chainId:'560048'};
function challenge(){const c={...binding,nonce:'abcdefgh12345678',issuedAt:1000,expiresAt:121000,id:'A'.repeat(43),method:'wallet'};c.message=loginMessage(c)+`\nResources:\n- urn:8415wallet:tenant:${c.tenant}\n- urn:8415wallet:purpose:login\n- urn:8415wallet:request:${c.id}`;return c;}
const request=c=>JSON.stringify({schema:'8415wallet-native-login-request/1',challenge:c});
test('stdio rejects malformed duplicate oversize and unbound input before custody construction',async()=>{
 let reads=0;const h=createNativeLoginStdioHandler({bindings:[binding],now:()=>2000,bridgeFactory:()=>{reads++;throw Error('must not read key');}});const c=challenge(),valid=request(c);
 for(const bytes of ['{',Buffer.from([0xff]),' '.repeat(16385),valid.replace('"schema":','"schema":"wrong","schema":'),valid.replace('"nonce":','"no\\u006ece":"first","nonce":'),JSON.stringify({...JSON.parse(valid),keyFile:'/not-read'}),request({...c,account:'0x'+'2'.repeat(40)}),request({...c,chainId:'1'}),request({...c,origin:'https://wrong.example.invalid'}),request({...c,message:c.message+' extra'}),request({...c,expiresAt:1001}),request({...c,issuedAt:3000})])await assert.rejects(h(bytes));
 assert.equal(reads,0);
});
test('stdio emits only proof for original synthetic raw-key custody and retains repeat rejection',async t=>{
 const dir=await mkdtemp(join(tmpdir(),'native-stdio-fixture-'));await chmod(dir,0o700);t.after(()=>rm(dir,{recursive:true,force:true}));const keyFile=join(dir,'fixture');await writeFile(keyFile,'1'.repeat(64),{mode:0o600});
 const c=challenge(),h=createNativeLoginStdioHandler({bindings:[{...binding,keyFile}],now:()=>2000});const line=await h(request(c)),proof=JSON.parse(line);
 assert.deepEqual(Object.keys(proof),['schema','requestId','signature']);assert.equal(proof.requestId,c.id);assert.equal(verifyMessage(c.message,proof.signature),wallet.address);assert.equal(line,JSON.stringify(proof)+'\n');
 await assert.rejects(h(request(c)),/ALREADY_ATTEMPTED/);
});
test('stdio stream refuses extra records oversize timeout and cancellation before custody',async()=>{
 let reads=0,writes=0;const opts={bindings:[binding],bridgeFactory:()=>{reads++;throw Error('must not read key');},now:()=>2000,output:async()=>{writes++;}};
 await assert.rejects(runNativeLoginStdio({...opts,input:Readable.from([request(challenge()),request(challenge())])}));
 await assert.rejects(runNativeLoginStdio({...opts,input:Readable.from(['x'.repeat(16385)])}));
 await assert.rejects(runNativeLoginStdio({...opts,input:new Readable({read(){}}),readTimeoutMs:10}));
 const controller=new AbortController();controller.abort();await assert.rejects(runNativeLoginStdio({...opts,input:Readable.from([request(challenge())]),signal:controller.signal}));assert.equal(reads,0);assert.equal(writes,0);
});
test('stdio rejects extra or mismatched bridge output without dispatching stdout',async()=>{
 let writes=0;for(const proof of [{schema:'8415wallet-native-login-proof/1',requestId:'wrong',signature:'0x'+'1'.repeat(130)},{schema:'8415wallet-native-login-proof/1',requestId:'A'.repeat(43),signature:'0x'+'1'.repeat(130),keyFile:'/not-output'}]){
 await assert.rejects(runNativeLoginStdio({bindings:[binding],input:Readable.from([request(challenge())]),output:async()=>{writes++;},now:()=>2000,bridgeFactory:async()=>({handle:async()=>proof})}));}assert.equal(writes,0);
});
test('stdio selects only installation allowlisted account and rejects duplicate bindings',async()=>{
 assert.throws(()=>createNativeLoginStdioHandler({bindings:[binding,binding]}));let calls=0;const c=challenge();
 await runNativeLoginStdio({bindings:[binding,{...binding,account:'0x'+'2'.repeat(40)}],input:Readable.from([request(c)]),output:async line=>{calls++;assert.equal(JSON.parse(line).requestId,c.id);},now:()=>2000,bridgeFactory:async selected=>{assert.equal(selected.account,wallet.address);return {handle:async()=>({schema:'8415wallet-native-login-proof/1',requestId:c.id,signature:'0x'+'1'.repeat(130)})};}});assert.equal(calls,1);
});


test('proof consumer connects existing native signer contract and exposes only signature',async()=>{
 const c=challenge();let calls=0;const signer=createNativeLoginProofSigner({...binding,now:()=>2000,exchange:async line=>{calls++;const r=JSON.parse(line);assert.equal(r.schema,'8415wallet-native-login-request/1');assert.deepEqual(r.challenge,c);return JSON.stringify({schema:'8415wallet-native-login-proof/1',requestId:c.id,signature:await wallet.signMessage(c.message)})+'\n';}});
 const proof=await signer.signLoginChallenge(c);assert.deepEqual(Object.keys(proof),['signature']);assert.equal(verifyMessage(c.message,proof.signature),wallet.address);assert.equal(signer.schema,'8415wallet-native-login-signer/1');
 await assert.rejects(signer.signLoginChallenge(c));assert.equal(calls,1);
});
test('proof consumer rejects wrong request duplicate fields extras and wrong-account signatures',async()=>{
 const c=challenge(),good={schema:'8415wallet-native-login-proof/1',requestId:c.id,signature:await wallet.signMessage(c.message)},other=new Wallet('0x'+'2'.repeat(64));
 for(const response of [JSON.stringify({...good,requestId:'B'.repeat(43)}),JSON.stringify({...good,extra:true}),JSON.stringify(good).replace('"requestId":','"requestId":"bad","requestId":'),JSON.stringify({...good,signature:await other.signMessage(c.message)}),'x'.repeat(4097),JSON.stringify(good)+JSON.stringify(good)]){
  const signer=createNativeLoginProofSigner({...binding,now:()=>2000,exchange:async()=>response});await assert.rejects(signer.signLoginChallenge(c));}
});
test('proof consumer never retries unknown exchange or dispatches cancelled expired proofs',async()=>{
 const c=challenge();let calls=0;const signer=createNativeLoginProofSigner({...binding,now:()=>2000,exchange:async()=>{calls++;throw Error('private transport error');}});
 await assert.rejects(signer.signLoginChallenge(c),/EXCHANGE_UNRESOLVED/);await assert.rejects(signer.signLoginChallenge(c));assert.equal(calls,1);
 const controller=new AbortController(),cancel=createNativeLoginProofSigner({...binding,now:()=>2000,exchange:async()=>{controller.abort();return '{}';}});await assert.rejects(cancel.signLoginChallenge(c,{signal:controller.signal}));
 let time=2000;const expired=createNativeLoginProofSigner({...binding,now:()=>time,exchange:async()=>{time=c.expiresAt;return JSON.stringify({schema:'8415wallet-native-login-proof/1',requestId:c.id,signature:await wallet.signMessage(c.message)});}});await assert.rejects(expired.signLoginChallenge(c),/EXPIRED/);
 let badCalls=0;const bad=createNativeLoginProofSigner({...binding,now:()=>2000,exchange:async()=>{badCalls++;}});await assert.rejects(bad.signLoginChallenge({...c,message:'arbitrary'}));assert.equal(badCalls,0);
});

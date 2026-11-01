import assert from 'node:assert/strict';
import {Interface} from 'ethers';
import {request} from 'node:http';
import {once} from 'node:events';
import {createSecureContext} from 'node:tls';
import {readFile,mkdtemp,rm} from 'node:fs/promises';
import {spawn,execFileSync} from 'node:child_process';
import {createServer as createNetServer} from 'node:net';
import {createInterface} from 'node:readline';
import {resolve,join} from 'node:path';
import {createTaskJournalCapabilityListener} from '../server/task-listing-bootstrap-core.mjs';
import {certificates} from './helpers/task-https-fixture.mjs';
import {createHash} from 'node:crypto';
import {createAuthRuntime} from '../server/main.mjs';
import {openEncryptedStore} from '../server/store.mjs';
import {hashPassword} from '../server/crypto.mjs';
import {disabledTaskListingRuntime} from '../server/task-listing-runtime.mjs';
import {loadInstalledTaskListingModules} from '../server/task-listing-installed.mjs';
import {createWholeReceiptBootstrapBinding} from '../server/whole-receipt-host.mjs';
import {prepareAuthenticatedReceiptContexts} from './helpers/receipt-authenticated-context.mjs';
assert.equal(process.platform,'linux');assert.equal(process.env.CI,'true');assert.equal(process.env.RUNNER_OS,'Linux');
const sourceRoot=resolve(process.env.ARTFI_RECEIPT_SOFTWARE_SOURCE??'');
const helper=process.env.ARTFI_RECEIPT_SOFTWARE_HOST;
assert.ok(helper&&helper.startsWith('/'),'ORIGINAL_SOFTWARE_HOST_REQUIRED');
assert.ok(process.env.ARTFI_RECEIPT_SOFTWARE_SOURCE,'ORIGINAL_PINNED_SOURCE_REQUIRED');
const sourceRaw=await readFile(join(sourceRoot,'test/fixtures/simulated-registry-v2.json'));
const cleanup=[];const fixture={after(fn){cleanup.unshift(fn);}};
const certs=await certificates(fixture);
const root=await mkdtemp(resolve('.whole-receipt-sql-'));
const sourceState=join(root,'source.simulated-registry.json');
for(const action of ['init','TOKEN_TRANSFER','REGISTERED'])execFileSync(process.execPath,[join(sourceRoot,'registry-driver.mjs'),sourceState,action],{stdio:'pipe'});
const probe=createNetServer();probe.listen(0,'127.0.0.1');await once(probe,'listening');const journalPort=probe.address().port;await new Promise(r=>probe.close(r));
assert.equal(createHash('sha256').update(sourceRaw).digest('hex'),'0d61e9a57d0e882f5be806a371db37f03f96d3db8dd97473d6fd364ff1704b82');
const dataset=JSON.parse(sourceRaw),runtime=await loadInstalledTaskListingModules();
const softwareReceiptBoundary=runtime.createSimulatedRegistryReceiptBusinessBoundary(sourceRaw.toString('utf8'),'artfi-local','simulated-registry.v2');
// Explicit original software fixture binding, independent of HTTP inputs.
const binding=Object.freeze(structuredClone(softwareReceiptBoundary.source.association.journal));
assert.equal(binding.runtimeCodeHash,'0xf662c0028b6ce5ed175ece4da97f0ca45a5e4230ea73c5c6592cd80b4d12f9ff');
const beforeRPC=await readFile(sourceState);
const rpcResult=execFileSync(process.execPath,[join(sourceRoot,'rpc-read-check.mjs'),sourceState,join(root,'separate-v1-source.json')],{encoding:'utf8'});
assert.equal(rpcResult.trim(),'ORIGINAL_V2_CANONICAL_RUNTIME_READ_ONLY_PASS');assert.deepEqual(await readFile(sourceState),beforeRPC);
console.log(JSON.stringify({stage:'original-v2-canonical-rpc-read',result:rpcResult.trim(),runtimeBytes:9286,readOnly:true,accountsAndSend:'REFUSED_BY_ORIGINAL_SOURCE',stateMutation:false}));
assert.deepEqual(dataset.association.journal,binding);assert.equal(dataset.business.chainId,31337);
const saleType='(address seller,address collection,uint256 tokenId,address paymentToken,uint256 price,address buyer,uint256 salt,uint48 startsAt,uint48 endsAt,uint256 epoch)';
const correspondenceType='(bytes32 settlementId,bytes32 assetRecordHash,bytes32 oracleSourceId,bytes32 requestHash,bytes32 executionReferenceHash,bytes32 previousSegment,bytes32 oldCertificateHash,bytes32 warehouseReceiptHash)';
const abi=new Interface(['function fund('+saleType+' sale,'+correspondenceType+' correspondence,bytes signature)']);
const receipt=dataset.business.wholeReceipt;
// Existing receipt software fixture bytes; not a verified real seller signature.
const data=abi.encodeFunctionData('fund',[receipt.sale,receipt.correspondence,'0x1234']);
const wire={account:binding.actor,chainId:'31337',to:binding.escrow,data,value:'0',nonce:'1',gasLimit:'21000',maxFeePerGasWei:'2',maxPriorityFeePerGasWei:'1'};
const statePath=join(root,'credentials.enc');
const store=await openEncryptedStore(statePath,Buffer.alloc(32,0x52));
const epoch=Date.now(),steps=[];let providerCalls=0,host,peer,child,childEnded;
const password='synthetic-owner-passphrase';
async function stopJournal(){
 if(child&&!child.killed&&child.exitCode===null){child.stdin.end(JSON.stringify({command:'stop'})+'\n');const [code]=await Promise.race([childEnded,new Promise((_,reject)=>setTimeout(()=>reject(Error('ORIGINAL_JOURNAL_DRAIN_TIMEOUT')),15000).unref())]);assert.equal(code,0);}
}
try {
 host=await createAuthRuntime({config:{origin:binding.origin,tenant:binding.tenant,port:31999,statePath,accounts:[{username:'owner',passwordHash:await hashPassword(password),wallets:[{account:binding.actor,chainId:'31337'}]}]},store,now:Date.now,
 listingRuntime:{runtime:disabledTaskListingRuntime(),async start(){},async stop(){}},
 wholeReceipt:createWholeReceiptBootstrapBinding({createInstallation:options=>runtime.createWholeReceiptInstallation({...options,softwareReceiptBoundary}),createJournalTransport:runtime.createNftTaskJournalHttpsTransport,journalStore:{},consumerPeerId:'spiffe://artfi/journal',taskExecutorIdentity:{schema:'8415-task-executor/1',agentId:'synthetic-receipt',agentVersion:'1',adapterId:'artfi:whole-receipt:v1',adapterVersion:'1',implementationDigest:'0x'+'9'.repeat(64)},provider:{request(){providerCalls++;throw Error('NO_PROVIDER_IO');}},journal:{url:`https://127.0.0.1:${journalPort}/internal/v1/nft/operations`,peerId:'spiffe://artfi/wallet',secureContext:createSecureContext({cert:certs.wallet.certBytes,key:certs.wallet.keyBytes,ca:certs.caBytes})}})});
 peer=createTaskJournalCapabilityListener({peerId:'spiffe://artfi/journal',clientFingerprint256:certs.journal.fingerprint},{cert:certs.wallet.certBytes,key:certs.wallet.keyBytes,ca:certs.caBytes},host.wholeReceipt);
 peer.listen(0,'127.0.0.1');await once(peer,'listening');
 host.server.listen(0,'127.0.0.1');await once(host.server,'listening');let jar=new Map(),csrf='';
 async function callAuth(path,body){return new Promise((resolve,reject)=>{const req=request({hostname:'127.0.0.1',port:host.server.address().port,path:'/auth/'+path,method:body===undefined?'GET':'POST',agent:false,headers:{host:'artfi.example',origin:binding.origin,'x-wallet-tenant':binding.tenant,'x-wallet-csrf':csrf,cookie:[...jar].map(([k,v])=>k+'='+v).join('; '),...(body===undefined?{}:{'content-type':'application/json'})}},res=>{for(const cookie of res.headers['set-cookie']??[]){const[k,v]=cookie.split(';')[0].split('=');if(v)jar.set(k,v);else jar.delete(k);}const chunks=[];res.on('data',x=>chunks.push(x));res.on('end',()=>{const data=JSON.parse(Buffer.concat(chunks));if(data.csrf)csrf=data.csrf;steps.push({path,status:res.statusCode,error:data.error??null});resolve({status:res.statusCode,data});});});req.on('error',reject);req.end(body===undefined?undefined:JSON.stringify(body));});}
 assert.equal((await callAuth('bootstrap')).status,200);
 const login=await callAuth('password',{username:'owner',password,account:binding.actor,chainId:'31337'});assert.equal(login.status,200,login.data.error);
 const context=await prepareAuthenticatedReceiptContexts({runtime,softwareReceiptBoundary,callAuth,business:dataset.business,installationBinding:binding,phaseInputs:[{phase:'funded',operationId:'receipt-funded',planId:'SIMULATED_REGISTRY_PLAN',wire}],expiresAt:String(Math.floor(epoch/1000)+600),fees:{perOperationWei:'100000',totalWei:'300000'}});
 assert.equal(context.contexts.length,1);const selected=context.contexts[0];
 const status=await callAuth('tasks/status',{taskDigest:context.task.digest});assert.equal(status.status,200,status.data.error);assert.equal(status.data.authorization.reference,selected.principal.grantReference);assert.deepEqual(status.data.receiptAttempts,[]);
 assert.equal(providerCalls,0);assert.equal(selected.rawPlan.taskPrincipal.grantReference,status.data.authorization.reference);
 const journalEnv={...process.env,ARTFI_SOFTWARE_TEST_HOST:'1',ARTFI_TASK_JOURNAL_ENABLED:'true',ARTFI_TASK_JOURNAL_ADDR:`127.0.0.1:${journalPort}`,ARTFI_TASK_JOURNAL_TLS_CERT_FILE:certs.journal.cert,ARTFI_TASK_JOURNAL_TLS_KEY_FILE:certs.journal.key,ARTFI_TASK_JOURNAL_CLIENT_CA_FILE:certs.ca,ARTFI_TASK_JOURNAL_PEER_URI:'spiffe://artfi/wallet',ARTFI_TASK_JOURNAL_AUTHORITY_CA_FILE:certs.ca,ARTFI_TASK_JOURNAL_AUTHORITY_CERT_FILE:certs.journal.cert,ARTFI_TASK_JOURNAL_AUTHORITY_KEY_FILE:certs.journal.key,ARTFI_TASK_JOURNAL_CAPABILITY_URL:`https://127.0.0.1:${peer.address().port}/internal/v1/task-journal-capabilities/consume`};
 assert.ok(journalEnv.ARTFI_TASK_JOURNAL_MYSQL_DSN,'ORIGINAL_ISOLATED_SQL_FIXTURE_REQUIRED');
 async function startJournal(){
 child=spawn(helper,['--isolated-software-test'],{env:journalEnv,stdio:['pipe','pipe','pipe']});
 childEnded=once(child,'exit');let stderr='';child.stderr.on('data',b=>{stderr=(stderr+b).slice(-1024);});
 const lines=createInterface({input:child.stdout});const ready=Promise.race([once(lines,'line').then(([line])=>JSON.parse(line)),childEnded.then(([code])=>{throw Error('ORIGINAL_JOURNAL_HOST_EXIT_'+code+':'+stderr);}),new Promise((_,reject)=>setTimeout(()=>reject(Error('ORIGINAL_JOURNAL_READY_TIMEOUT')),15000).unref())]);
 child.stdin.write(JSON.stringify({schema:'artfi-task-journal-software-test-host/1',datasetVersion:'simulated-registry.v2',datasetBase64:sourceRaw.toString('base64'),statePath:sourceState,principal:selected.principal})+'\n');
 const bound=await ready;assert.equal(bound.schema,'artfi-task-journal-software-test-host/1');assert.equal(bound.mode,'SIMULATED_REGISTRY_SOFTWARE_TEST_ONLY');assert.equal(bound.address,`127.0.0.1:${journalPort}`);
 }
 await startJournal();
 const handle=host.wholeReceipt.operation({task:context.task,claimed:selected.claimed});
 const created=await handle.create(selected.rawPlan,selected.rawWire);assert.equal(created.executionAuthorization,'NOT_ESTABLISHED');assert.equal(created.operation.id,selected.rawPlan.operationId);assert.equal(created.operation.revision,1);assert.equal(created.operation.status,'awaiting-wallet');assert.equal(created.operation.walletStarted,false);
 const read=await handle.read('observe',selected.rawPlan);assert.deepEqual(read.operation,created.operation);assert.equal(providerCalls,0);
 console.log(JSON.stringify({stage:'first-create-read',journalCreate:'PASS',journalRead:'PASS',revision:read.operation.revision,status:read.operation.status,walletStarted:read.operation.walletStarted,providerCalls,transactions:0}));
 // Reconstruct the original native host and producer handle over the same SQL,
 // source and service-created grant. A confirmed create is never replayed.
 await stopJournal();await startJournal();
 const restoredHandle=host.wholeReceipt.operation({task:context.task,claimed:selected.claimed});
 const restored=await restoredHandle.read('observe',selected.rawPlan);assert.deepEqual(restored.operation,created.operation);
 const restoredStatus=await callAuth('tasks/status',{taskDigest:context.task.digest});assert.equal(restoredStatus.status,200);assert.equal(restoredStatus.data.authorization.reference,selected.principal.grantReference);assert.equal(providerCalls,0);
 // Revoke through the normal authenticated owner route. Existing durable
 // state remains observable; the stale grant cannot create or reserve a send.
 const revoked=await callAuth('tasks/revoke',{taskDigest:context.task.digest,expectedGrantPolicyVersion:selected.principal.grantPolicyVersion});
 assert.equal(revoked.status,200);assert.equal(revoked.data.effectiveStatus,'revoked');
 assert.equal(revoked.data.authorization.grantPolicyVersion,(BigInt(selected.principal.grantPolicyVersion)+1n).toString());
 const afterRevoke=await restoredHandle.read('observe',selected.rawPlan);assert.deepEqual(afterRevoke.operation,created.operation);
 console.log(JSON.stringify({stage:'revoked-read',revoked:true,journalRead:'PASS',providerCalls,transactions:0}));
 await assert.rejects(restoredHandle.create(selected.rawPlan,selected.rawWire),{message:'RECEIPT_PREPARATION_REFUSED'});
 const executionRequest={account:binding.actor,chainId:Number(dataset.business.chainId),to:binding.escrow,data,value:0n};
 await assert.rejects(restoredHandle.execute(executionRequest),{message:'TASK_RECEIPT_GRANT_BINDING_REFUSED'});
 const unchanged=await restoredHandle.read('observe',selected.rawPlan);assert.deepEqual(unchanged.operation,created.operation);
 const revokedStatus=await callAuth('tasks/status',{taskDigest:context.task.digest});assert.equal(revokedStatus.status,200);assert.equal(revokedStatus.data.effectiveStatus,'revoked');assert.deepEqual(revokedStatus.data.receiptAttempts,[]);assert.equal(providerCalls,0);
 console.log(JSON.stringify({scope:'SIMULATED_REGISTRY_V2_SOFTWARE_TEST_ONLY',datasetVersion:'simulated-registry.v2',authSteps:steps,normalServiceGrant:true,manualSessions:0,manualGrants:0,journalDTOsFabricated:0,journalCreate:'PASS',journalRead:'PASS',journalHostRestartRead:'PASS',revokedRead:'PASS',revokedCreate:'REFUSED',revokedExecute:'REFUSED',attemptsAfterRevoke:0,revision:restored.operation.revision,status:restored.operation.status,walletStarted:restored.operation.walletStarted,providerCalls,transactions:0,CAS:'NOT_RUN_PROVIDER_CODE_REVIEW_REQUIRED',SEND:'NOT_RUN_COMPILED_ESCROW_FIXTURE_REQUIRED'}));
}finally{
 await host?.stop();
 await stopJournal();
 if(peer?.listening)await new Promise(r=>peer.close(r));await store.close();
 for(const fn of cleanup)await fn();await rm(root,{recursive:true,force:true});
}

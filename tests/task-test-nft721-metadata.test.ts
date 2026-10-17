/** Synthetic metadata readback fixtures; no published URI, HTTP call or source proof. */
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createTaskNFT721MetadataVerifier,verifyTestNFT721Metadata} from '../server/task-test-nft721-metadata.mjs';
const h=n=>'0x'+n.repeat(64),actor='0x'+'1'.repeat(40),collection='0x'+'2'.repeat(40);
const description='TESTNET / NO REAL-WORLD VALUE / NO LEGAL EFFECT. Task-generated isolated technical input. No real warehouse, custody, institutional evidence, physical title, donation or production rights are asserted.';
function fixture(change=v=>v,encode=v=>JSON.stringify(v,null,2)+'\n') {
 const body=change({name:'Simulated warehouse record - TESTNET',description,properties:{testOnly:true,chainId:560048,assetKind:0,
   sourceSha256:h('6').slice(2),realWorldValue:false,legalTitle:false,institutionalSourceEvidence:false}});
 const bytes=Buffer.from(encode(body)),metadataHash='0x'+createHash('sha256').update(bytes).digest('hex');
 const uri='https://metadata.example.invalid:9446/api/test-nft/metadata/'+metadataHash.slice(2);
 const operation={kind:'artfi-test-nft721-mint',taskId:'wallet:mint:synthetic',sourceTaskId:'producer:task:original',taskIdBytes32:h('3'),
   artifactDigest:h('4'),chainId:'560048',actor,collection:{contract:collection,runtimeCodeHash:h('5')},sourceHash:h('6'),assetKind:0,metadataHash,metadataURI:uri};
 const publication={schema:'8415-hoodi-test-metadata-publication/1',taskId:operation.taskId,chainId:'560048',uri,sourceHash:operation.sourceHash,
   assetKind:0,metadataHash,byteLength:bytes.length};
 const calls=[];
 const request=async(url,options)=>{calls.push({url,options});return new Response(bytes,{status:200,headers:{'content-type':'application/json; charset=utf-8','content-length':String(bytes.length)}});};
 return {operation,publication,timeoutMs:1000,fetch:request,bytes,calls};
}
test('exact server-registered HTTPS raw bytes preserve hash/length and explicitly do not assert source authority',async()=>{
 const f=fixture(),result=await verifyTestNFT721Metadata(f);assert.equal(result.metadataHash,f.operation.metadataHash);
 assert.equal(result.byteLength,f.bytes.length);assert.equal(result.sourceAuthenticity,false);assert.equal(result.institutionalSourceEvidence,false);
 assert.equal(f.calls.length,1);const {url,options}=f.calls[0];assert.equal(url,f.publication.uri);
 assert.equal(options.method,'GET');assert.equal(options.redirect,'error');assert.equal(options.credentials,'omit');
 assert.equal(options.referrerPolicy,'no-referrer');assert.deepEqual(options.headers,{accept:'application/json'});
});
test('server factory captures registrations and refuses unregistered task JSON before any transport call',async()=>{
 const f=fixture(),verifier=createTaskNFT721MetadataVerifier({publications:[f.publication],timeoutMs:f.timeoutMs,fetch:f.fetch});
 f.publication.uri='https://changed.example.invalid';
 assert.equal((await verifier.verify(f.operation)).metadataHash,f.operation.metadataHash);
 assert.ok(Object.isFrozen(verifier)&&Object.isFrozen(verifier.identity));const count=f.calls.length;
 await assert.rejects(verifier.verify({...f.operation,taskId:'unknown'}),/METADATA_REFUSED/);assert.equal(f.calls.length,count);
});
test('metadata registrations and timeout bind identity; no construction performs a read',()=>{
 const f=fixture(),make=(publications,timeoutMs)=>createTaskNFT721MetadataVerifier({publications,timeoutMs,fetch:f.fetch});
 const first=make([f.publication],1000);assert.notEqual(first.identity.configurationDigest,make([f.publication],2000).identity.configurationDigest);
 assert.notEqual(first.identity.configurationDigest,make([],1000).identity.configurationDigest);assert.equal(f.calls.length,0);
 assert.throws(()=>make([f.publication,f.publication],1000),/METADATA_REFUSED/);
});
test('a request cannot invent a publication origin/path, query, userinfo or alternate digest',async()=>{
 for(const patch of [{uri:'https://other.example.invalid/metadata'}, {uri:'https://metadata.example.invalid/api/test-nft/metadata/'+h('a').slice(2)+'?x=1'},
   {uri:'https://secret:password@metadata.example.invalid/api/test-nft/metadata/'+h('a').slice(2)}, {metadataHash:h('a')}, {taskId:'other-task'},
   {byteLength:8193}, {chainId:'11155111'}]) {
   const f=fixture();f.publication={...f.publication,...patch};await assert.rejects(verifyTestNFT721Metadata(f),/METADATA_REFUSED/);assert.equal(f.calls.length,0);
 }
});
test('noncanonical JSON, hidden fields, value/title claims and wrong source/kind refuse even with a matching raw digest',async()=>{
 const changes=[v=>({...v,image:'https://example.invalid/image'}),v=>({...v,description:'real warehouse'}),
   v=>({...v,properties:{...v.properties,legalTitle:true}}),v=>({...v,properties:{...v.properties,institutionalSourceEvidence:true}}),
   v=>({...v,properties:{...v.properties,sourceSha256:h('7').slice(2)}}),v=>({...v,properties:{...v.properties,assetKind:1}})];
 for(const change of changes)await assert.rejects(verifyTestNFT721Metadata(fixture(change)),/METADATA_REFUSED/);
 for(const encode of [v=>JSON.stringify(v),v=>JSON.stringify(v,null,2)+'\r\n',v=>'\ufeff'+JSON.stringify(v,null,2)+'\n',
   v=>JSON.stringify(v,null,2).replace('"properties": {','"name":"duplicate",\n  "properties": {')+'\n'])
   await assert.rejects(verifyTestNFT721Metadata(fixture(v=>v,encode)),/METADATA_REFUSED/);
});
test('changed raw bytes, oversized stream, redirect and non-JSON/error responses never establish readback',async()=>{
 for(const make of [f=>new Response(Buffer.concat([f.bytes,Buffer.from(' ')]),{headers:{'content-type':'application/json'}}),
   f=>new Response(Buffer.from(f.bytes.toString().replace('TESTNET','testnet')),{headers:{'content-type':'application/json'}}),
   f=>new Response(f.bytes,{status:503,headers:{'content-type':'application/json'}}),
   f=>new Response(f.bytes,{headers:{'content-type':'text/html'}}),
   f=>({status:200,redirected:true,headers:new Headers({'content-type':'application/json'})})]) {
   const f=fixture();f.fetch=async()=>make(f);await assert.rejects(verifyTestNFT721Metadata(f),/METADATA_REFUSED/);
 }
});


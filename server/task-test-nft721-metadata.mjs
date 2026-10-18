/** Read-only consumer of ArtFi PR214's fixed public TEST_ONLY JSON profile.
 * No default URI, discovery, upload, image load, grant, custody or source proof.
 */
import {createHash} from 'node:crypto';
import {normalizeExistingOperation} from '../src/agent/taskContract.ts';
const description='TESTNET / NO REAL-WORLD VALUE / NO LEGAL EFFECT. Task-generated isolated technical input. No real warehouse, custody, institutional evidence, physical title, donation or production rights are asserted.';
const names=['Simulated warehouse record - TESTNET','Digitally native artwork - TESTNET'];
const fail=()=>{throw Error('TASK_TEST_721_METADATA_REFUSED');};
function fields(v,keys){if(!v||Object.getPrototypeOf(v)!==Object.prototype)fail();const d=Object.getOwnPropertyDescriptors(v);
 if(Reflect.ownKeys(d).length!==keys.length||keys.some(k=>!Object.hasOwn(d,k)||!Object.hasOwn(d[k],'value')))fail();}
export function captureTestNFT721MetadataVerifier(value) {
 if(value===null)return null;
 fields(value,['identity','verify']);fields(value.identity,['schema','configurationDigest']);
 if(value.identity.schema!=='8415-test-nft-metadata-verifier/1'||typeof value.identity.configurationDigest!=='string'||
   !/^[0-9a-f]{64}$/.test(value.identity.configurationDigest)||typeof value.verify!=='function')fail();
 return Object.freeze({identity:Object.freeze({...value.identity}),verify:value.verify.bind(value)});
}
/** Capture registration at server construction; an operation cannot select its
 * own publication record, transport, timeout or redirect policy. */
export function createTaskNFT721MetadataVerifier({publications,timeoutMs,fetch:request=globalThis.fetch}) {
 if(!Array.isArray(publications)||publications.length>10000||typeof request!=='function'||
   !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000)fail();
 const seen=new Set(),records=publications.map(raw=>{
   fields(raw,['schema','taskId','chainId','uri','sourceHash','assetKind','metadataHash','byteLength']);
   const p=structuredClone(raw);let uri;try{uri=new URL(p.uri);}catch{fail();}
   if(p.schema!=='8415-hoodi-test-metadata-publication/1'||p.chainId!=='560048'||
     typeof p.taskId!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(p.taskId)||
     ![p.sourceHash,p.metadataHash].every(h=>typeof h==='string'&&/^0x[0-9a-f]{64}$/.test(h)&&!/^0x0+$/.test(h))||
     ![0,1].includes(p.assetKind)||!Number.isSafeInteger(p.byteLength)||p.byteLength<1||p.byteLength>8192||
     uri.protocol!=='https:'||uri.username||uri.password||uri.search||uri.hash||
     uri.pathname!=='/api/test-nft/metadata/'+p.metadataHash.slice(2))fail();
   const key=JSON.stringify([p.taskId,p.metadataHash]);if(seen.has(key))fail();seen.add(key);
   return Object.freeze(Object.fromEntries(['schema','taskId','chainId','uri','sourceHash','assetKind','metadataHash','byteLength'].map(k=>[k,p[k]])));
 }).sort((a,b)=>JSON.stringify(a)<JSON.stringify(b)?-1:JSON.stringify(a)>JSON.stringify(b)?1:0);
 const digest=createHash('sha256').update(JSON.stringify({publications:records,timeoutMs})).digest('hex');
 return Object.freeze({identity:Object.freeze({schema:'8415-test-nft-metadata-verifier/1',configurationDigest:digest}),
   async verify(operation){const op=normalizeExistingOperation(operation);
     const publication=records.find(p=>p.taskId===op.taskId&&p.metadataHash===op.metadataHash);
     if(!publication)fail();return verifyTestNFT721Metadata({operation:op,publication,timeoutMs,fetch:request});}});
}
export async function verifyTestNFT721Metadata({operation,publication,timeoutMs,fetch:request=globalThis.fetch}) {
 const op=normalizeExistingOperation(operation);
 if(op.kind!=='artfi-test-nft721-mint')fail();
 fields(publication,['schema','taskId','chainId','uri','sourceHash','assetKind','metadataHash','byteLength']);
 const p=structuredClone(publication);
 if(p.schema!=='8415-hoodi-test-metadata-publication/1'||p.taskId!==op.taskId||p.chainId!=='560048'||
   p.uri!==op.metadataURI||p.sourceHash!==op.sourceHash||p.assetKind!==op.assetKind||p.metadataHash!==op.metadataHash||
   !Number.isSafeInteger(p.byteLength)||p.byteLength<1||p.byteLength>8192||
   !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>30000||typeof request!=='function')fail();
 let uri;try{uri=new URL(p.uri);}catch{fail();}
 if(uri.protocol!=='https:'||uri.username||uri.password||uri.search||uri.hash||
   uri.pathname!=='/api/test-nft/metadata/'+p.metadataHash.slice(2))fail();
 const abort=new AbortController(),timer=setTimeout(()=>abort.abort(),timeoutMs);let reader;
 try {
   const response=await request(p.uri,{method:'GET',redirect:'error',credentials:'omit',cache:'no-store',
     referrerPolicy:'no-referrer',headers:{accept:'application/json'},signal:abort.signal});
   if(response.status!==200||response.redirected||response.url&&response.url!==p.uri||
     !/^application\/json(?:\s*;|$)/i.test(response.headers.get('content-type')??'')||typeof response.body?.getReader!=='function')fail();
   const length=response.headers.get('content-length');
   if(length!==null&&length!==String(p.byteLength))fail();
   reader=response.body.getReader();const chunks=[];let size=0;
   while(true){const part=await reader.read();if(part.done)break;
     if(!(part.value instanceof Uint8Array))fail();size+=part.value.byteLength;
     if(size>p.byteLength||size>8192)fail();chunks.push(Buffer.from(part.value));}
   const bytes=Buffer.concat(chunks);
   if(abort.signal.aborted||size!==p.byteLength||createHash('sha256').update(bytes).digest('hex')!==p.metadataHash.slice(2)||
     !bytes.every(b=>b===10||b>=32&&b<=126))fail();
   const text=bytes.toString('utf8'),body=JSON.parse(text);
   if(JSON.stringify(body,null,2)+'\n'!==text)fail();
   fields(body,['name','description','properties']);const v=body.properties;
   fields(v,['testOnly','chainId','assetKind','sourceSha256','realWorldValue','legalTitle','institutionalSourceEvidence']);
   if(body.name!==names[op.assetKind]||body.description!==description||v.testOnly!==true||v.chainId!==560048||
     v.assetKind!==op.assetKind||v.sourceSha256!==op.sourceHash.slice(2)||v.realWorldValue!==false||
     v.legalTitle!==false||v.institutionalSourceEvidence!==false)fail();
   return Object.freeze({schema:'8415-test-nft-metadata-readback/1',taskId:op.taskId,chainId:op.chainId,
     uri:p.uri,metadataHash:p.metadataHash,byteLength:size,sourceHash:op.sourceHash,assetKind:op.assetKind,
     testOnly:true,sourceAuthenticity:false,institutionalSourceEvidence:false});
 } catch {throw Error('TASK_TEST_721_METADATA_REFUSED');}
 finally {clearTimeout(timer);if(reader){try{await reader.cancel();}catch{}reader.releaseLock();}}
}


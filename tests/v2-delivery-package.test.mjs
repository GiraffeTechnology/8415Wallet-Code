import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,writeFileSync,readFileSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {gunzipSync,gzipSync} from 'node:zlib';
import {readDeliveryArchive} from '../scripts/package/archive-v2.mjs';
import {deterministicArchive,sha256} from '../scripts/package/dapp-release.mjs';
import {verifyDeliveryArchive} from '../scripts/package/verify-v2-delivery.mjs';
import {createDappConfig} from '../deploy/dapp-v2/install.mjs';
function fixture(fn){const root=mkdtempSync(join(tmpdir(),'v2-archive-case-'));try{writeFileSync(join(root,'example.txt'),'synthetic\n');const artifact=join(tmpdir(),root.split('/').at(-1)+'.tar.gz');try{const hash=deterministicArchive(root,artifact);fn(root,artifact,hash);}finally{rmSync(artifact,{force:true});}}finally{rmSync(root,{recursive:true,force:true});}}
function replaceHeader(buffer,change){const bytes=gunzipSync(buffer);change(bytes.subarray(512,1024));bytes.fill(32,512+148,512+156);let sum=0;for(const n of bytes.subarray(512,1024))sum+=n;bytes.write(sum.toString(8).padStart(6,'0')+'\0 ',512+148,'ascii');return gzipSync(bytes);}
test('V2 copied strict archive reader accepts pinned file bytes/path and rejects wrong pin',()=>fixture((_r,a,h)=>{
 assert.equal(readDeliveryArchive(a,h).get('example.txt').bytes.toString(),'synthetic\n');assert.throws(()=>readDeliveryArchive(a,'0'.repeat(64)),/DIGEST_MISMATCH/);
}));
test('V2 strict archive reader refuses symlink and traversal before extracting',()=>fixture((_r,a)=>{
 const original=readFileSync(a);for(const edited of [replaceHeader(original,h=>h[156]=50),replaceHeader(original,h=>{h.fill(0,0,100);h.write('../escape',0,'ascii');})])assert.throws(()=>readDeliveryArchive(edited));
}));
test('V2 kit verifier requires external exact pins and cannot accept an arbitrary archive',()=>fixture((_r,a,h)=>{
 assert.throws(()=>verifyDeliveryArchive(a),/EXTERNAL_PINS_REQUIRED/);assert.throws(()=>verifyDeliveryArchive(a,{expectedSha256:h,expectedTree:'a'.repeat(40)}),/MISSING_DELIVERY/);
}));
test('V2 installer refuses a V3 profile before making configuration writes',()=>fixture((r)=>{
 assert.throws(()=>createDappConfig({tenant:'test',label:'Test',profile:'v3',environment:'local',url:'http://127.0.0.1:12345/web/index.html',output:join(r,'config.json')}),{message:'RELEASE_PROFILE_REFUSED'});
 assert.equal(existsSync(join(r,'config.json')),false);
}));

import {extractDelivery} from '../scripts/package/verify-v2-delivery.mjs';
import {existsSync} from 'node:fs';
test('V2 verified extraction retains independent auth tree and refuses existing destination',()=>fixture((r)=>{
 const target=join(r,'new-kit');const result={entries:new Map([['NOTICE.txt',{bytes:Buffer.from('verified synthetic kit'),mode:0o644}]]),authRuntime:new Map([['server/v2/runtime-entry.mjs',{bytes:Buffer.from('export const testOnly=true;'),mode:0o644}]])};
 assert.equal(extractDelivery(result,target),target);assert.ok(existsSync(join(target,'runtime/auth/server/v2/runtime-entry.mjs')));assert.throws(()=>extractDelivery(result,target),/EEXIST/);
}));

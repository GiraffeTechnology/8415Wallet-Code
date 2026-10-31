import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,mkdirSync,writeFileSync,readFileSync,existsSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {removePinnedNonRuntimeArchive} from '../scripts/package/build-auth-v2.mjs';
import {walkV2} from '../scripts/package/verify-auth-v2.mjs';
const actual=readFileSync(new URL('../node_modules/aes-js/aes-js-4.0.0-beta.4.tgz',import.meta.url));
function fixture(run){const root=mkdtempSync(join(tmpdir(),'v2-nested-archive-'));const dir=join(root,'node_modules/aes-js');mkdirSync(dir,{recursive:true});writeFileSync(join(dir,'package.json'),JSON.stringify({name:'aes-js',version:'4.0.0-beta.5'}));writeFileSync(join(dir,'LICENSE.txt'),'retained license');try{run(root,dir)}finally{rmSync(root,{recursive:true,force:true})}}
test('only exact pinned nonruntime nested archive is removed; license and code remain',()=>fixture((r,d)=>{writeFileSync(join(d,'aes-js-4.0.0-beta.4.tgz'),actual);writeFileSync(join(d,'index.js'),'export {};');assert.throws(()=>walkV2(r),/PRIVATE_PATH_REFUSED/);assert.equal(removePinnedNonRuntimeArchive(r),true);assert.equal(existsSync(join(d,'aes-js-4.0.0-beta.4.tgz')),false);assert.equal(readFileSync(join(d,'LICENSE.txt'),'utf8'),'retained license');assert.ok(walkV2(r).includes('node_modules/aes-js/index.js'));}));
test('different bytes at exact archive path are refused and retained',()=>fixture((r,d)=>{writeFileSync(join(d,'aes-js-4.0.0-beta.4.tgz'),'different');assert.throws(()=>removePinnedNonRuntimeArchive(r),/IDENTITY_REFUSED/);assert.equal(existsSync(join(d,'aes-js-4.0.0-beta.4.tgz')),true);}));
test('other nested archives remain forbidden and untouched',()=>fixture((r,d)=>{writeFileSync(join(d,'another.tgz'),actual);assert.equal(removePinnedNonRuntimeArchive(r),false);assert.equal(existsSync(join(d,'another.tgz')),true);assert.throws(()=>walkV2(r),/PRIVATE_PATH_REFUSED/);}));

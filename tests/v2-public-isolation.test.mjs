import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { publicV2ModuleClosure, verifyV2Isolation } from '../scripts/package/v2-public-isolation.mjs';
function fixture(fn) {
 const root=mkdtempSync(join(tmpdir(),'v2-isolation-test-'));
 const put=(path,text)=>{mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),text);};
 put('web/index.html','<meta http-equiv="Content-Security-Policy" content="default-src self"><script type="module" src="app-v2.mjs"></script>');
 put('web/app-v2.mjs',"import '../dist/browser/browser.js';");put('dist/browser/browser.js','export const nativeAsset = true;');put('web/release-profile.mjs','export const profile = "v2";');put('web/release-config.json','{"profile":"v2"}');
 try {fn(root,put);} finally{rmSync(root,{recursive:true,force:true});}
}
test('V2 accepts exact standalone closure and reports source-bound hashes',()=>fixture(root=>{
 const result=verifyV2Isolation(root);assert.equal(result.linkedImplementationIncluded,false);assert.equal(result.moduleFiles.length,3);assert.equal(result.runtimeFiles['dist/browser/browser.js'].length,64);
}));
test('V3 runtime paths fail even if reexported from V2 barrel',()=>fixture((root,put)=>{
 put('dist/browser/browser.js',"export * from './controls/session.js';");put('dist/browser/controls/session.js','export const value = 1;');
 assert.throws(()=>publicV2ModuleClosure(root),/PRIVATE_MODULE_REFUSED/);
}));
test('renamed linked algorithm is rejected, not just its path',()=>fixture((root,put)=>{
 put('dist/browser/browser.js','export class ResponsibilityWalletSession {}');assert.throws(()=>publicV2ModuleClosure(root),/PRIVATE_IMPLEMENTATION_REFUSED/);
}));
test('nonliteral dynamic imports cannot conceal private code',()=>fixture((root,put)=>{
 put('dist/browser/browser.js','export const load = path => import(path);');assert.throws(()=>publicV2ModuleClosure(root),/DYNAMIC_IMPORT_REFUSED/);
}));
test('missing dependency fails without pruning required imports',()=>fixture((root,put)=>{
 put('dist/browser/browser.js',"import './missing.js';");assert.throws(()=>publicV2ModuleClosure(root),/UNRESOLVED_IMPORT/);
}));
test('unused module payload is refused rather than hidden behind flags',()=>fixture((root,put)=>{
 put('dist/browser/unused.js','export const hidden=true;');assert.throws(()=>verifyV2Isolation(root),/UNREACHABLE_MODULE_REFUSED/);
}));
test('source, backend and nested full delivery cannot enter public V2',()=>{
 for(const path of ['src/private.ts','server/auth.mjs','payload.tar.gz'])fixture((root,put)=>{
 put(path,'private');assert.throws(()=>verifyV2Isolation(root),/PRIVATE_FILE_REFUSED/);
 });
});

import { publicRelease } from '../scripts/package/build-public-v2.mjs';
test('public metadata excludes full source inventories and archive locations',()=>{
 const prior={profile:'v2',features:{linkedResponsibilities:false,controlledAccounts:true},tenant:{id:'default'},deployment:{environment:'unconfigured',url:null},source:{commit:'a'.repeat(40),tree:'b'.repeat(40),dirty:true,files:{'server/private-config.mjs':'secret'}},sourceArchive:{artifact:'full-private.tar.gz'},version:'2.2.0-beta',prd:{sha256:'c'.repeat(64)},status:'candidate'};
 const safe=publicRelease(prior,{moduleFiles:[]});assert.deepEqual(Object.keys(safe.source).sort(),['commit','dirty','tree']);assert.equal(JSON.stringify(safe).includes('private-config'),false);assert.equal(Object.hasOwn(safe,'sourceArchive'),false);assert.equal(safe.distribution.authRuntimeIncluded,false);
 assert.throws(()=>publicRelease({...prior,profile:'v3'},{}),/PROFILE_REQUIRED/);
 assert.throws(()=>publicRelease({...prior,tenant:{id:'private'}},{}),/GENERIC_TEMPLATE_REQUIRED/);
});

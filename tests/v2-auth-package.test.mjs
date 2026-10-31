import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { AUTH_V2_ROOTS, AUTH_V2_SCHEMA, AUTH_STATE_SEMANTICS, OPTIONAL_PRIVATE_PROVIDER, publicV2Path, moduleSpecifiers, verifyV2Imports, validateAuthStateTransition, verifyAuthDirectory, sha256, walkV2 } from '../scripts/package/verify-auth-v2.mjs';
import { v2RuntimeDependencies, v2SourceClosure } from '../scripts/package/build-auth-v2.mjs';
import { renderAuthServiceUnit, verifyIncomingV2Package } from '../deploy/auth-runtime-v2/install.mjs';
const root=new URL('../',import.meta.url);
function temp(fn){const path=mkdtempSync(join(tmpdir(),'v2-auth-test-'));try{return fn(path);}finally{rmSync(path,{recursive:true,force:true});}}
function put(root,path,content){mkdirSync(dirname(join(root,path)),{recursive:true});writeFileSync(join(root,path),content,{mode:0o644});}
test('V2 auth package excludes private runtime/source/credentials paths',()=>{
  for(const path of ['src/controls/client.ts','src/sdk/linked.ts','vendor/artfi.tgz','node_modules/@artfi/task-listing-runtime/index.js','provenance/package.source.json','server/main.mjs','server/runtime-entry.mjs','server/task-listing-installed.mjs','server/task-listing-package-pin.mjs','server/forward-progress-reader.mjs','server/credentials.enc','server/store-key','full-source.tar.gz'])assert.equal(publicV2Path(path),false,path);
  for(const path of ['server/v2/runtime-entry.mjs','server/auth-service-core.mjs','src/standalone/client.ts','web/login-core.mjs','node_modules/ethers/package.json','deploy/auth-runtime-v2/install.mjs'])assert.equal(publicV2Path(path),true,path);
});
test('V2 source scanner handles static/reexports/TS type imports and rejects dynamic expressions without executing',()=>{
  const deps=moduleSpecifiers({'server/v2/check.ts':"import type { X } from './types.ts'; import { y } from './one.mjs'; export { z } from './two.mjs'; throw Error('MUST_NOT_EXECUTE'); await import('./three.mjs');"});
  assert.deepEqual(deps['server/v2/check.ts'],['./one.mjs','./two.mjs','./three.mjs']);
  assert.throws(()=>moduleSpecifiers({'server/v2/check.mjs':"await import(globalThis.secret);"}));
});
test('V2 source closure rejects missing, private or untracked imports',()=>temp(dir=>{
  put(dir,'server/v2/main.mjs',"import './missing.mjs';");const files={'server/v2/main.mjs':sha256(readFileSync(join(dir,'server/v2/main.mjs')))};
  assert.throws(()=>v2SourceClosure(dir,{files},['server/v2/main.mjs']),/SOURCE_CLOSURE_REFUSED/);
  put(dir,'server/v2/main.mjs',"export * from '../../src/controls/client.ts';");files['server/v2/main.mjs']=sha256(readFileSync(join(dir,'server/v2/main.mjs')));
  assert.throws(()=>v2SourceClosure(dir,{files},['server/v2/main.mjs']),/SOURCE_CLOSURE_REFUSED/);
  put(dir,'server/v2/main.mjs',"import './child.mjs';");files['server/v2/main.mjs']=sha256(readFileSync(join(dir,'server/v2/main.mjs')));put(dir,'server/v2/child.mjs','export const x=1;');files['server/v2/child.mjs']=sha256(readFileSync(join(dir,'server/v2/child.mjs')));
  assert.deepEqual(v2SourceClosure(dir,{files},['server/v2/main.mjs']),['server/v2/child.mjs','server/v2/main.mjs']);
}));
test('V2 installed import check refuses absent runtime and nonapproved external module',()=>temp(dir=>{
  put(dir,'server/v2/main.mjs',"import 'unapproved';");assert.throws(()=>verifyV2Imports(dir,['server/v2/main.mjs']),/EXTERNAL_IMPORT_REFUSED/);
  put(dir,'server/v2/main.mjs',"import './absent.mjs';");assert.throws(()=>verifyV2Imports(dir,['server/v2/main.mjs']),/IMPORT_CLOSURE_REFUSED/);
}));
test('V2 dependency lock is exact ethers graph, excludes private ArtFi and install scripts',()=>{
  const pkg=JSON.parse(readFileSync(new URL('package.json',root))),lock=JSON.parse(readFileSync(new URL('package-lock.json',root)));
  const result=v2RuntimeDependencies(pkg,lock);assert.deepEqual(Object.keys(result.manifest.dependencies),['ethers']);assert.equal(Object.keys(result.lock.packages).some(p=>p.includes('@artfi')),false);
  const mutated=structuredClone(lock);mutated.packages['node_modules/ethers'].hasInstallScript=true;assert.throws(()=>v2RuntimeDependencies(pkg,mutated),/DEPENDENCY_PIN_REFUSED/);
});
test('V2 installer retains hardening and pins V2 runtime entry without activation',()=>{
  const template=readFileSync(new URL('deploy/auth-runtime/8415wallet-auth.service',root),'utf8');
  const unit=renderAuthServiceUnit(template,{tenant:'synthetic',node:'/usr/bin/node'});
  assert.match(unit,/server\/v2\/runtime-entry.mjs --tenant synthetic/);assert.match(unit,/NoNewPrivileges=true/);assert.match(unit,/IPAddressDeny=any/);assert.match(unit,/ProtectSystem=strict/);
});
test('V2 state format six cannot downgrade or implicitly rollback forward',()=>{
  const state=n=>({runtime:{authStateSemantics:`8415wallet-auth-state/${n}`}});
  validateAuthStateTransition(state(5),state(6));assert.throws(()=>validateAuthStateTransition(state(6),state(5)),/DOWNGRADE/);assert.throws(()=>validateAuthStateTransition(state(5),state(6),{rollback:true}),/TRANSITION/);
});
test('V2 full package verifier enforces inventory/source pins and refuses added paths',()=>temp(dir=>{
  for(const path of [...AUTH_V2_ROOTS,'deploy/auth-runtime/origin-continuation-core.mjs','server/origin-continuation.mjs','server/origin-continuation-context.mjs','server/origin-realm-router.mjs','server/owner-change-origin.mjs'])put(dir,path,path===OPTIONAL_PRIVATE_PROVIDER.loader?`export async function load(){return import('${OPTIONAL_PRIVATE_PROVIDER.specifier}');}`:'export const inert=true;');
  put(dir,'deploy/auth-runtime/8415wallet-auth.service','inert fixture');put(dir,'server/mail-config.mjs','export const inert=true;');
  const dependencies={ethers:'1.0.0'};put(dir,'package.json',JSON.stringify({name:'8415wallet-auth-runtime-v2',type:'module',scripts:{start:'node server/v2/runtime-entry.mjs'},dependencies}));
  put(dir,'package-lock.json',JSON.stringify({lockfileVersion:3,packages:{'':{dependencies},'node_modules/ethers':{version:'1.0.0',resolved:'https://registry.npmjs.org/ethers/-/ethers-1.0.0.tgz',integrity:'sha512-YQ=='}}}));put(dir,'node_modules/ethers/package.json',JSON.stringify({name:'ethers',version:'1.0.0'}));
  const release={schema:AUTH_V2_SCHEMA,profile:'v2',status:'OFFLINE_CANDIDATE_NOT_ACTIVATED',source:{commit:'1'.repeat(40),tree:'2'.repeat(40),dirty:true,prdSha256:'3'.repeat(64)},runtime:{legacyMigrationIncluded:false,externalDependencies:[OPTIONAL_PRIVATE_PROVIDER],entry:'server/v2/runtime-entry.mjs',credentialStoreFormat:5,authStateSemantics:AUTH_STATE_SEMANTICS,bundledProductionDependencies:true},files:Object.fromEntries(walkV2(dir).map(p=>[p,sha256(readFileSync(join(dir,p)))]))};
  put(dir,'AUTH-RELEASE.json',JSON.stringify(release));put(dir,'SHA256SUMS',walkV2(dir).map(p=>`${sha256(readFileSync(join(dir,p)))}  ${p}`).join('\n')+'\n');
  assert.equal(verifyAuthDirectory(dir,{expectedTree:'2'.repeat(40)}).profile,'v2');assert.throws(()=>verifyAuthDirectory(dir,{expectedTree:'4'.repeat(40)}),/EXPECTED_TREE_MISMATCH/);
  put(dir,'src/extra.ts','export const x=1;');assert.throws(()=>verifyAuthDirectory(dir),/INVENTORY_MISMATCH/);
}));
test('V2 verifier refuses symlinks before following them',()=>temp(dir=>{mkdirSync(join(dir,'server'));symlinkSync('/does/not/exist',join(dir,'server','external'));assert.throws(()=>walkV2(dir),/UNSAFE_FILE/);}));

test('V2 installer requires external tree and manifest hash before accepting a package',async()=>{
  await assert.rejects(verifyIncomingV2Package('/never-read',undefined,undefined),/EXTERNAL_PINS_REQUIRED/);
  const directory=mkdtempSync(join(tmpdir(),'v2-pin-test-'));try{put(directory,'AUTH-RELEASE.json','{}');await assert.rejects(verifyIncomingV2Package(directory,'1'.repeat(40),'2'.repeat(64)),/EXPECTED_MANIFEST_MISMATCH/);}finally{rmSync(directory,{recursive:true,force:true});}
});

test('V2 private provider exemption is one fixed dynamic import in one loader only',()=>temp(dir=>{
  const allowed='server/v2/task-listing-installed.mjs',specifier='@artfi/task-listing-runtime/server';
  put(dir,allowed,`export async function load(){return import('${specifier}');}`);verifyV2Imports(dir,[allowed]);
  for(const [file,code] of [['server/v2/other.mjs',`await import('${specifier}');`],[allowed,`import * as provider from '${specifier}';`],[allowed,`await import('@artfi/task-listing-runtime/other');`],[allowed,`await import('${specifier}');await import('${specifier}');`]]){put(dir,file,code);assert.throws(()=>verifyV2Imports(dir,[file]),/EXTERNAL_IMPORT_REFUSED/);}
}));


test('V2 continuation semantics preserve forward6-to8 and refuse rollback or unknown state9',()=>{
 const state=n=>({runtime:{authStateSemantics:`8415wallet-auth-state/${n}`}});
 validateAuthStateTransition(state(6),state(8));
 assert.throws(()=>validateAuthStateTransition(state(8),state(6),{rollback:true}),/DOWNGRADE/);
 assert.throws(()=>validateAuthStateTransition(state(6),state(9)),/SEMANTICS_REFUSED/);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync, mkdirSync, cpSync, rmSync} from 'node:fs';
import {join,dirname} from 'node:path';
import {tmpdir} from 'node:os';
import {execFileSync} from 'node:child_process';
import {pathToFileURL} from 'node:url';
import {sourcePathAllowed,packagePathAllowed} from '../scripts/package/verify-auth.mjs';
import {DELIVERY_FILES as fullFiles} from '../scripts/package/verify-delivery.mjs';
import {DELIVERY_FILES as v2Files} from '../scripts/package/verify-v2-delivery.mjs';
const root=new URL('../',import.meta.url);
test('auth runtime permits only the exact new tenant dependency, not arbitrary web modules',()=>{
 assert.equal(sourcePathAllowed('web/tenant-path.mjs'),true);
 assert.equal(packagePathAllowed('web/tenant-path.mjs'),true);
 for(const path of ['web/tenant-path-extra.mjs','web/task-operation-verification-ui.mjs','web/arbitrary.mjs']) assert.equal(sourcePathAllowed(path),false);
});
for(const [profile,files,entry] of [['v3',fullFiles,'scripts/package/verify-delivery.mjs'],['v2',v2Files,'scripts/package/verify-v2-delivery.mjs']])test(`${profile} isolated outer delivery imports close, and removing tenant-path fails`,()=>{
 assert.equal(files.filter(path=>path==='web/tenant-path.mjs').length,1);
 const stage=mkdtempSync(join(tmpdir(),'tenant-path-closure-'));
 try{
  for(const file of files){mkdirSync(dirname(join(stage,file)),{recursive:true});cpSync(new URL(file,root),join(stage,file));}
  const run=()=>execFileSync(process.execPath,['--input-type=module','--import',pathToFileURL(join(stage,entry)).href,'-e',''],{cwd:stage,stdio:'pipe',env:{...process.env,NODE_PATH:'',NODE_OPTIONS:''}});
  run();rmSync(join(stage,'web/tenant-path.mjs'));
  assert.throws(run,error=>String(error.stderr).includes('ERR_MODULE_NOT_FOUND')&&String(error.stderr).includes('tenant-path.mjs'));
 }finally{rmSync(stage,{recursive:true,force:true});}
});

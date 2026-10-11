import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { TASK_RUNTIME_SOURCE_PATHS, sourcePathAllowed } from '../scripts/package/verify-auth.mjs';
const root=fileURLToPath(new URL('..',import.meta.url));
const modules=['server/task-native-listing-composition.mjs','server/task-listing-observation-consumer.mjs'];
function closure(path,seen=new Set()){
 if(seen.has(path))return seen;seen.add(path);const source=readFileSync(join(root,path),'utf8');
 for(const match of source.matchAll(/(?:from\s+|import\s+)['"]([^'"]+)['"]/g)){
  if(match[1].startsWith('node:'))continue;
  assert.ok(match[1].startsWith('.'),'Wallet listing source must not import external ArtFi or executor checkout');
  const resolved=resolve(dirname(join(root,path)),match[1]);assert.ok(resolved.startsWith(root));closure(resolved.slice(root.length),seen);
 }
 return seen;
}
test('new server modules are mandatory package sources and accurately fingerprinted',()=>{
 const policy=JSON.parse(readFileSync(join(root,'config/product-source-allowlist.json')));
 for(const path of modules){assert.ok(TASK_RUNTIME_SOURCE_PATHS.includes(path));assert.ok(sourcePathAllowed(path));assert.ok(policy.mandatory.runtime_and_installers.includes(path));const entry=policy.entries.find(x=>x.path===path),bytes=readFileSync(join(root,path));assert.equal(entry.sha256,createHash('sha256').update(bytes).digest('hex'));}
 const probe=readFileSync(join(root,'server/task-runtime-import-probe.mjs'),'utf8');for(const path of modules)assert.ok(probe.includes(`import './${path.slice(7)}'`));
});
test('isolated installed Wallet sources import without any ArtFi checkout or network and reject unconfigured factories',()=>{
 const dir=mkdtempSync(join(tmpdir(),'listing-import-'));try{
  const all=new Set(modules.flatMap(p=>[...closure(p)]));for(const path of all){mkdirSync(dirname(join(dir,path)),{recursive:true});cpSync(join(root,path),join(dir,path));}
  writeFileSync(join(dir,'package.json'),JSON.stringify({type:'module'}));
  const program="import assert from 'node:assert/strict';globalThis.fetch=()=>{throw Error('NETWORK_FORBIDDEN')};const a=await import('./server/task-native-listing-composition.mjs');const b=await import('./server/task-listing-observation-consumer.mjs');assert.equal(typeof a.createTaskNativeListingComposition,'function');assert.equal(typeof b.createTaskListingObservationConsumer,'function');assert.throws(()=>a.createTaskNativeListingComposition({}),/CONFIGURATION_REQUIRED/);assert.throws(()=>b.createTaskListingObservationConsumer({}),/CONFIGURATION_REFUSED/);";
  const run=()=>spawnSync(process.execPath,['--input-type=module','-e',program],{cwd:dir,encoding:'utf8',timeout:10000,env:{...process.env,NODE_OPTIONS:'',NODE_PATH:''}});
  let r=run();assert.equal(r.status,0,r.stderr);
  for(const path of all){renameSync(join(dir,path),join(dir,path+'.absent'));r=run();assert.notEqual(r.status,0,`Missing source did not fail import: ${path}`);renameSync(join(dir,path+'.absent'),join(dir,path));}
 }finally{rmSync(dir,{recursive:true,force:true});}
});

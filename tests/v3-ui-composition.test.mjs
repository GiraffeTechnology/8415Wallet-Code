import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync,mkdtempSync,mkdirSync,cpSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {stageV3Composition,privateV3ModuleClosure} from '../scripts/package/v3-ui-composition.mjs';
const root=new URL('..',import.meta.url),read=name=>readFileSync(new URL(name,root),'utf8');
test('explicit V3 entry preserves login boundary and mounts each business module once',()=>{
 const html=read('web/index-v3.html');assert.match(html,/id="wallet-private"[^>]*\bhidden\b[^>]*\binert\b/);
 for(const name of ['app.mjs','external-assets.mjs','legacy-clearing.mjs','task-ui-v3.mjs','wallet-auth.mjs','asset-control-startup.mjs','nft-browser-startup.mjs','funds-startup.mjs'])assert.equal([...html.matchAll(new RegExp('src="'+name.replaceAll('.','\\.')+'"','g'))].length,1);
 assert.doesNotMatch(html,/src="(?:app-v2|task-ui)\.mjs"/);assert.match(html,/id="asset-network"[^>]*><option value="1" selected>Ethereum/);
 for(const m of html.matchAll(/<(button|input|select|form)\b[^>]*data-foundation-placeholder="true"[^>]*>/g))assert.match(m[0],/foundation\.rbac|data-policy-source|id="tenant-avatar-/);
 for(const id of ['connect','task-authorize-form','asset-connect','settlement-prepare','forward'])assert.doesNotMatch(html.match(new RegExp('<[^>]+id="'+id+'"[^>]*>'))?.[0]??'MISSING',/disabled|data-foundation-placeholder|MISSING/);
});
test('compiled V3 staging resolves its entire mounted import closure and excludes unused V2 entry',()=>{
 const directory=mkdtempSync(join(tmpdir(),'v3-composition-'));try{
  cpSync(new URL('web',root),join(directory,'web'),{recursive:true});mkdirSync(join(directory,'dist'),{recursive:true});cpSync(new URL('dist/browser',root),join(directory,'dist/browser'),{recursive:true});
  stageV3Composition(directory);const modules=privateV3ModuleClosure(directory);
  assert.ok(modules.includes('web/forward-progress-panel.mjs'));assert.ok(modules.includes('web/task-authorization-ui-v3.mjs'));assert.equal(modules.includes('web/task-authorization-ui.mjs'),false);assert.ok(modules.includes('web/method-change-ui.mjs'));
  assert.equal(existsSync(join(directory,'web/app-v2.mjs')),false);assert.equal(existsSync(join(directory,'web/index-v3.html')),false);
  assert.match(readFileSync(join(directory,'web/index.html'),'utf8'),/src="app.mjs"/);
 }finally{rmSync(directory,{recursive:true,force:true});}
});

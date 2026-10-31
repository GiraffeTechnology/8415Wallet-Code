import test from 'node:test';
import assert from 'node:assert/strict';
import {validateImageOrigins,imageContentSecurityPolicy,applyImagePolicy} from '../web/image-policy.mjs';
import {resolveReleaseProfile} from '../web/release-profile.mjs';
import {resolveReleaseProfile as resolveV2} from '../web/release-profile-v2.mjs';
const base="default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' blob:; connect-src 'self'; object-src 'none'";
const config={schema:'8415wallet-release/1',product:'8415wallet',platform:'8415wallet.com',profile:'v2',tenant:{id:'default',label:'Wallet'},deployment:{environment:'unconfigured',url:null}};
test('image capability is default none in both strict release profiles',()=>{
 for(const resolve of [resolveReleaseProfile,resolveV2]){assert.deepEqual(resolve(config).imageOrigins,[]);assert.deepEqual(resolve({...config,imageOrigins:['https://media.example.com']}).imageOrigins,['https://media.example.com']);assert.throws(()=>resolve({...config,imageOrigins:['https:']}));}
 assert.equal(imageContentSecurityPolicy(base),base);
});
test('image policy only admits canonical exact public HTTPS origins',()=>{
 for(const origin of ['*','https:','https://*.example.com','http://media.example.com','https://media.example.com/','https://media.example.com/x','https://media.example.com?q=1','https://media.example.com#x','https://u:p@media.example.com','https://127.0.0.1','https://[::1]','https://0x7f000001','https://host.local','https://host.internal','https://localhost','https://host.lan','https://host.home','https://media.example.com:444'])assert.throws(()=>validateImageOrigins([origin]),undefined,origin);
 assert.throws(()=>validateImageOrigins(['https://media.example.com','https://media.example.com']));
});
test('staged CSP adds only exact approved image origins leaving script/connect restrictions unchanged',()=>{
 const csp=imageContentSecurityPolicy(base,['https://media.example.com']);assert.match(csp,/img-src 'self' blob: https:\/\/media\.example\.com;/);assert.match(csp,/script-src 'self';/);assert.match(csp,/connect-src 'self';/);assert.ok(!csp.includes(' https:;')&&!csp.includes('*')&&!csp.includes('evil.example.com'));
 const html='<meta http-equiv="Content-Security-Policy" content="'+base+'">';assert.equal(applyImagePolicy(html,['https://media.example.com']),'<meta http-equiv="Content-Security-Policy" content="'+csp+'">');assert.throws(()=>applyImagePolicy(html+html,[]));
});
test('loopback development server serves matching default-deny image header and module',async t=>{
 const {spawn}=await import('node:child_process');const child=spawn(process.execPath,['scripts/controls/serve-browser.cjs'],{cwd:new URL('..',import.meta.url),env:{...process.env,WALLET_BROWSER_PORT:'18451'},stdio:['ignore','pipe','pipe']});
 let log='';const ready=new Promise((resolve,reject)=>{child.stdout.on('data',chunk=>{log+=chunk;if(log.includes('available on loopback'))resolve();});child.stderr.on('data',chunk=>{log+=chunk;});child.on('exit',code=>reject(Error('SERVER_EXIT '+code+' '+log)));});
 t.after(()=>child.kill());await ready;const response=await fetch('http://127.0.0.1:18451/web/index.html');assert.equal(response.status,200);const header=response.headers.get('content-security-policy');assert.match(header,/img-src 'self' blob:;/);assert.ok(!header.includes('https:'));const html=await response.text();assert.match(html,/img-src 'self' blob:;/);for(const name of ['image-policy','coordination-render','coordination-view','renderer-messages'])assert.equal((await fetch('http://127.0.0.1:18451/web/'+name+'.mjs')).status,200,name);
});

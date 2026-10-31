/** Assemble the V2-only UI/runtime and protected installers; never activate. */
import assert from 'node:assert/strict';
import {cpSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {tmpdir} from 'node:os';
import {fileURLToPath} from 'node:url';
import {captureSource,deterministicArchive,sha256,walk} from './dapp-release.mjs';
import {DELIVERY_SCHEMA,DELIVERY_FILES,verifyDeliveryArchive} from './verify-v2-delivery.mjs';
export function buildV2Delivery(root=process.cwd()){
 const source=captureSource(root),output=join(root,'dist');
 const ui=JSON.parse(readFileSync(join(output,'public-v2-package-manifest.json'),'utf8'));
 const auth=JSON.parse(readFileSync(join(output,'auth-v2-package-manifest.json'),'utf8'));
 for(const item of [ui,auth]){assert.equal(item.source.tree,source.tree,'V2_DELIVERY_REBUILD_REQUIRED');assert.equal(sha256(readFileSync(join(output,item.artifact))),item.sha256,'V2_DELIVERY_INPUT_HASH_MISMATCH');}
 const stage=mkdtempSync(join(tmpdir(),'wallet-v2-install-build-'));
 try{
  for(const file of DELIVERY_FILES){assert.equal(sha256(readFileSync(join(root,file))),source.files[file],'V2_DELIVERY_TOOL_SOURCE_MISMATCH');mkdirSync(dirname(join(stage,file)),{recursive:true});cpSync(join(root,file),join(stage,file));}
  mkdirSync(join(stage,'artifacts'));
  const artifacts={};for(const [id,item]of [['v2',ui],['auth',auth]]){artifacts[id]={artifact:item.artifact,sha256:item.sha256};cpSync(join(output,item.artifact),join(stage,'artifacts',item.artifact));}
  const release={schema:DELIVERY_SCHEMA,profile:'v2',product:'8415wallet',status:'OFFLINE_CANDIDATE_NOT_INSTALLED',source:{commit:source.commit,tree:source.tree,dirty:source.dirty},artifacts,
   files:Object.fromEntries(DELIVERY_FILES.map(p=>[p,sha256(readFileSync(join(stage,p)))])),
   scope:{installation:'Explicit operator-supplied already-authorized V2 tenant, origin, runtime configuration and storage bindings only; no service activation.',v3Included:false,fullSourceIncluded:false,credentialsIncluded:false,
    runtime:'V2 ordinary task/sale provider integration requires separately authorized external provider binding; no private provider implementation is published.',acceptance:'Offline source/package validation is not remote CI, physical browser, production runtime, store restoration, mail, device or on-chain acceptance.'}};
  writeFileSync(join(stage,'DELIVERY.json'),JSON.stringify(release,null,2)+'\n');writeFileSync(join(stage,'SHA256SUMS'),walk(stage).map(p=>`${sha256(readFileSync(join(stage,p)))}  ${p}`).join('\n')+'\n');
  assert.equal(captureSource(root).tree,source.tree,'V2_DELIVERY_SOURCE_CHANGED');
  const artifact=`8415wallet-v2-install-${source.tree}.tar.gz`,digest=deterministicArchive(stage,join(output,artifact));
  verifyDeliveryArchive(join(output,artifact),{expectedSha256:digest,expectedTree:source.tree});
  const result={artifact,sha256:digest,...release};writeFileSync(join(output,'v2-install-package-manifest.json'),JSON.stringify(result,null,2)+'\n');return result;
 }finally{rmSync(stage,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 if(process.argv.length!==2)throw Error('V2_DELIVERY_ARGUMENT_REFUSED');const r=buildV2Delivery();console.log(JSON.stringify({artifact:r.artifact,sha256:r.sha256,tree:r.source.tree,status:r.status}));
}

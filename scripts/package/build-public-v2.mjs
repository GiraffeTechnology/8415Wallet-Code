/** Produce a V2-only static UI distribution. Auth/runtime stays separately private. */
import assert from 'node:assert/strict';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { captureSource, deterministicArchive, sha256, walk } from './dapp-release.mjs';
import { verifyPublicV2Archive } from './verify-public-v2.mjs';
import { verifyV2Isolation } from './v2-public-isolation.mjs';
export function publicRelease(privateRelease, isolation) {
  assert.equal(privateRelease.profile,'v2','PUBLIC_V2_PROFILE_REQUIRED');
  assert.equal(privateRelease.features.linkedResponsibilities,false,'PUBLIC_V2_FEATURE_REFUSED');
  assert.equal(privateRelease.tenant.id,'default','PUBLIC_V2_GENERIC_TEMPLATE_REQUIRED');
  assert.deepEqual(privateRelease.deployment,{environment:'unconfigured',url:null},'PUBLIC_V2_PRIVATE_BINDING_REFUSED');
  const {commit,tree,dirty}=privateRelease.source;
  assert.match(commit,/^[a-f0-9]{40}$/);assert.match(tree,/^[a-f0-9]{40}$/);assert.equal(typeof dirty,'boolean');
  return {schema:'8415wallet-public-v2/1',product:'8415wallet',profile:'v2',version:privateRelease.version,
    status:privateRelease.status,entry:'web/index.html',source:{commit,tree,dirty},prd:privateRelease.prd,
    build:{configSha256:privateRelease.build?.configSha256},
    features:privateRelease.features,tenant:privateRelease.tenant,deployment:privateRelease.deployment,
    distribution:{kind:'static-browser-ui',authRuntimeIncluded:false,sourceArchiveIncluded:false,v3Included:false,
      acceptance:'Offline package integrity only; not deployed, browser/device, remote CI or on-chain acceptance.'},
    codeIsolation:isolation};
}
export function buildPublicV2(root=process.cwd()) {
  const current=captureSource(root), stage=join(root,'dist/package-dapp-v2');
  const prior=JSON.parse(readFileSync(join(stage,'RELEASE.json'),'utf8'));
  assert.equal(current.tree,prior.source.tree,'PUBLIC_V2_REBUILD_REQUIRED');
  const temporary=mkdtempSync(join(tmpdir(),'wallet-public-v2-'));
  try {
    cpSync(stage,temporary,{recursive:true});
    const isolation=verifyV2Isolation(temporary);
    const release=publicRelease(prior,isolation);
    writeFileSync(join(temporary,'RELEASE.json'),JSON.stringify(release,null,2)+'\n');
    const files=walk(temporary).filter(f=>f!=='SHA256SUMS');
    writeFileSync(join(temporary,'SHA256SUMS'),files.map(f=>`${sha256(readFileSync(join(temporary,f)))}  ${f}`).join('\n')+'\n');
    // Exact inventory is bound outside the archive; no full/private source paths are exported.
    const inventory=Object.fromEntries(walk(temporary).map(f=>[f,sha256(readFileSync(join(temporary,f)))]));
    const artifact=`8415wallet-public-v2-${release.version}-${current.tree}.tar.gz`;
    const output=join(root,'dist');mkdirSync(output,{recursive:true});
    const digest=deterministicArchive(temporary,join(output,artifact));
    verifyPublicV2Archive(join(output,artifact),{expectedSha256:digest,expectedTree:current.tree});
    const manifest={artifact,sha256:digest,...release,files:inventory};
    writeFileSync(join(output,'public-v2-package-manifest.json'),JSON.stringify(manifest,null,2)+'\n');
    return manifest;
  } finally {rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  if(process.argv.length!==2)throw new Error('PUBLIC_V2_ARGUMENT_REFUSED');
  const result=buildPublicV2();console.log(`${result.artifact}\nsha256 ${result.sha256}\nsource tree ${result.source.tree}\nStatic UI only; no public publication or deployment performed.`);
}

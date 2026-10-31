/** Verify V2-only public UI archive with out-of-band hash/tree pins; never install. */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { sha256, walk } from './dapp-release.mjs';
import { verifyV2Isolation } from './v2-public-isolation.mjs';
import { readDeliveryArchive } from './archive-v2.mjs';
export function verifyPublicV2Archive(archive,{expectedSha256,expectedTree}) {
 assert.match(expectedSha256,/^[a-f0-9]{64}$/);assert.match(expectedTree,/^[a-f0-9]{40}$/);
 const entries=readDeliveryArchive(archive,expectedSha256);
 assert.ok(entries.size<=4096,'PUBLIC_V2_ARCHIVE_INVENTORY_REFUSED');
 const root=mkdtempSync(join(tmpdir(),'wallet-public-v2-verify-'));
 try {
  for(const [path,entry] of entries){mkdirSync(dirname(join(root,path)),{recursive:true,mode:0o755});writeFileSync(join(root,path),entry.bytes,{flag:'wx',mode:0o644});}
  const files=walk(root),release=JSON.parse(readFileSync(join(root,'RELEASE.json'),'utf8'));
  assert.equal(release.schema,'8415wallet-public-v2/1');assert.equal(release.profile,'v2');assert.equal(release.source.tree,expectedTree);
  assert.deepEqual(Object.keys(release.source).sort(),['commit','dirty','tree']);assert.equal(Object.hasOwn(release,'sourceArchive'),false);
  assert.equal(release.distribution.authRuntimeIncluded,false);assert.equal(release.distribution.v3Included,false);
  const isolated=verifyV2Isolation(root);assert.deepEqual(release.codeIsolation,isolated,'PUBLIC_V2_CLOSURE_MISMATCH');
  assert.equal(release.prd.sha256,sha256(readFileSync(join(root,release.prd.file))),'PUBLIC_V2_PRD_MISMATCH');
  assert.equal(readFileSync(join(root,'SHA256SUMS'),'utf8'),files.filter(f=>f!=='SHA256SUMS').map(f=>`${sha256(readFileSync(join(root,f)))}  ${f}`).join('\n')+'\n','PUBLIC_V2_INVENTORY_MISMATCH');
  return {sourceTree:expectedTree,sha256:expectedSha256,files:files.length,modules:isolated.moduleFiles.length,profile:'v2',kind:'static-browser-ui',installed:false};
 } finally {rmSync(root,{recursive:true,force:true});}
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const args=process.argv.slice(2);if(args.length!==3)throw Error('PUBLIC_V2_ARGUMENT_REFUSED');
 console.log(JSON.stringify(verifyPublicV2Archive(args[0],{expectedSha256:args[1],expectedTree:args[2]})));
}

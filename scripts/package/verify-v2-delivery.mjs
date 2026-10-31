/** Public V2 install kit: exact UI+auth closure; no V3/full-source payload. */
import assert from 'node:assert/strict';
import {lstatSync,realpathSync,mkdirSync,mkdtempSync,readFileSync,rmSync,writeFileSync} from 'node:fs';
import {dirname,join,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {tmpdir} from 'node:os';
import {readDeliveryArchive} from './archive-v2.mjs';
import {sha256,safePath,verifyAuthDirectory} from './verify-auth-v2.mjs';
import {resolveReleaseProfile} from '../../web/release-profile-v2.mjs';
export {sha256};
export const DELIVERY_SCHEMA='8415wallet-public-v2-install/1';
export const DELIVERY_FILES=Object.freeze(['deploy/dapp-v2/install.mjs','scripts/package/verify-v2-delivery.mjs','scripts/package/archive-v2.mjs','scripts/package/verify-auth-v2.mjs','web/image-policy.mjs','web/release-profile-v2.mjs','web/tenant-password-routing.mjs','web/wallet-entry.mjs','web/tenant-path.mjs','config/releases/v2.json','docs/V2-INSTALL.md','LICENSE','THIRD_PARTY_NOTICES.md','LICENSES/CC0-1.0.txt']);
const check=(ok,code)=>{if(!ok)throw Error('V2_DELIVERY_'+code);};
const hash=/^[a-f0-9]{64}$/,tree=/^[a-f0-9]{40}$/;
const get=(entries,path)=>{check(entries.has(path),'MISSING_'+path);return entries.get(path).bytes;};
const parsed=(entries,path)=>JSON.parse(get(entries,path).toString('utf8'));
const hashes=entries=>Object.fromEntries([...entries].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([p,e])=>[p,sha256(e.bytes)]));
const sums=entries=>[...entries].filter(([p])=>p!=='SHA256SUMS').sort(([a],[b])=>a<b?-1:a>b?1:0).map(([p,e])=>`${sha256(e.bytes)}  ${p}`).join('\n')+'\n';
export function isPublicFile(path){return safePath(path)&&/^(?:web\/|dist\/browser\/)/.test(path)&&!path.split('/').some(p=>p.startsWith('.'))&&(/\.(?:html|mjs|js|css|json|svg|png|jpg|jpeg|webp|ico|woff|woff2|ttf)$/.test(path)||['web/assets/license-dm-sans.txt','dist/browser/vendor/ETHERS-LICENSE.md','web/legal/LICENSE','web/legal/THIRD_PARTY_NOTICES.md','web/legal/LICENSES/CC0-1.0.txt'].includes(path));}
export function verifyDeliveryArchive(archive,{expectedSha256,expectedTree}={}){
 check(hash.test(expectedSha256??'')&&tree.test(expectedTree??''),'EXTERNAL_PINS_REQUIRED');
 const entries=readDeliveryArchive(archive,expectedSha256),release=parsed(entries,'DELIVERY.json');
 check(release.schema===DELIVERY_SCHEMA&&release.profile==='v2'&&release.source?.tree===expectedTree,'IDENTITY_REFUSED');
 assert.deepEqual(Object.keys(release.source).sort(),['commit','dirty','tree']);assert.deepEqual(Object.keys(release.artifacts).sort(),['auth','v2']);
 check(get(entries,'SHA256SUMS').toString()===sums(entries),'SUMS_MISMATCH');
 const expected=new Set([...DELIVERY_FILES,'DELIVERY.json','SHA256SUMS']);
 for(const item of Object.values(release.artifacts)){check(item&&safePath(item.artifact)&&!item.artifact.includes('/')&&hash.test(item.sha256),'ARTIFACT_REFUSED');expected.add('artifacts/'+item.artifact);check(sha256(get(entries,'artifacts/'+item.artifact))===item.sha256,'ARTIFACT_HASH_MISMATCH');}
 assert.deepEqual([...entries.keys()].sort(),[...expected].sort(),'V2_DELIVERY_EXACT_INVENTORY');
 assert.deepEqual(release.files,Object.fromEntries(DELIVERY_FILES.map(p=>[p,sha256(get(entries,p))])),'V2_DELIVERY_TOOL_HASHES');
 const ui=readDeliveryArchive(get(entries,'artifacts/'+release.artifacts.v2.artifact),release.artifacts.v2.sha256),uiRelease=parsed(ui,'RELEASE.json');
 check(uiRelease.schema==='8415wallet-public-v2/1'&&uiRelease.profile==='v2'&&uiRelease.source.tree===expectedTree,'UI_IDENTITY_REFUSED');
 assert.deepEqual(Object.keys(uiRelease.source).sort(),['commit','dirty','tree']);check(!Object.hasOwn(uiRelease,'sourceArchive'),'FULL_SOURCE_REFUSED');
 const profile=resolveReleaseProfile(parsed(ui,'web/release-config.json'));check(profile.id==='v2'&&!profile.features.linkedResponsibilities,'UI_PROFILE_REFUSED');
 assert.deepEqual(profile.features,uiRelease.features);check(uiRelease.build.configSha256===sha256(get(ui,'web/release-config.json')),'UI_CONFIG_MISMATCH');
 check(sha256(get(ui,uiRelease.prd.file))===uiRelease.prd.sha256,'UI_PRD_MISMATCH');check(get(ui,'SHA256SUMS').toString()===sums(ui),'UI_SUMS_MISMATCH');
 const uiAllowed=new Set(['RELEASE.json','SHA256SUMS','LICENSE','THIRD_PARTY_NOTICES.md','LICENSES/CC0-1.0.txt','docs/ERC-8415-Wallet-PRD.md','docs/BETA-DAPP-DELIVERY.md','docs/BETA-PRD-COVERAGE.md','docs/STANDARDS-COMPATIBILITY.md','docs/WALLET-LOGIN.md','docs/ACCOUNT-AUTHENTICATION.md','docs/APPROVED-UI-IMPLEMENTATION.md','docs/TENANT-AVATAR.md','docs/stages/LEGACY-CLEARING-BETA-DAPP.md',...Object.keys(uiRelease.codeIsolation.runtimeFiles)]);
 assert.deepEqual([...ui.keys()].sort(),[...uiAllowed].sort(),'V2_DELIVERY_UI_EXACT_INVENTORY');
 assert.deepEqual(uiRelease.source,release.source,'V2_DELIVERY_UI_SOURCE_IDENTITY');
 const runtime=new Map([...ui].filter(([p])=>p.startsWith('web/')||p.startsWith('dist/browser/')));check([...runtime.keys()].every(isPublicFile)&&runtime.has('web/index.html'),'UI_RUNTIME_REFUSED');
 check(![...ui.keys()].some(p=>/^dist\/browser\/controls\/|^dist\/browser\/sdk\/linked\.|^dist\/browser\/wallet\/(?:linkedChainView|renderLinkedChain)\.|\.(?:tgz|tar\.gz|zip)$/.test(p)),'V3_UI_REFUSED');
 assert.deepEqual(hashes(runtime),uiRelease.codeIsolation.runtimeFiles,'V2_DELIVERY_UI_RUNTIME_HASHES');
 const authEntries=readDeliveryArchive(get(entries,'artifacts/'+release.artifacts.auth.artifact),release.artifacts.auth.sha256);
 const temp=mkdtempSync(join(tmpdir(),'v2-install-verify-'));
 try{
  for(const [p,e]of authEntries){mkdirSync(dirname(join(temp,p)),{recursive:true,mode:0o755});writeFileSync(join(temp,p),e.bytes,{flag:'wx',mode:0o644});}
  const auth=verifyAuthDirectory(temp,{expectedTree});assert.deepEqual({commit:auth.source.commit,tree:auth.source.tree,dirty:auth.source.dirty},release.source);check(auth.source.prdSha256===uiRelease.prd.sha256,'PRD_IDENTITY_MISMATCH');
  return {release,entries,dapps:{v2:{release:uiRelease,runtime}},auth,authRuntime:authEntries,sha256:expectedSha256};
 }finally{rmSync(temp,{recursive:true,force:true});}
}

export function extractDelivery(result, destination) {
  destination = resolve(destination);
  let parent = dirname(destination);
  while (true) {
    const stat = lstatSync(parent), uid = process.getuid?.();
    check(stat.isDirectory() && !stat.isSymbolicLink() && realpathSync(parent) === parent
      && (uid === undefined || stat.uid === uid || stat.uid === 0)
      && (!(stat.mode & 0o022) || (stat.uid === 0 && (stat.mode & 0o1000))), 'EXTRACT_PARENT_REFUSED');
    if (dirname(parent) === parent) break; parent = dirname(parent);
  }
  mkdirSync(destination, { mode: 0o700 }); // An existing target is deliberately refused.
  try {
    for (const [path, entry] of [...result.entries, ...[...result.authRuntime].map(([path, entry]) => [`runtime/auth/${path}`, entry])]) {
      mkdirSync(dirname(join(destination, path)), { recursive: true, mode: 0o755 });
      writeFileSync(join(destination, path), entry.bytes, { flag: 'wx', mode: 0o644 });
    }
  } catch (error) { rmSync(destination, { recursive: true, force: true }); throw error; }
  return destination;
}

if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
 const [command,archive,expectedSha256,expectedTree,destination,...extra]=process.argv.slice(2);
 check(['verify','extract'].includes(command)&&archive&&expectedSha256&&expectedTree&&extra.length===0&&(command==='extract'?destination!==undefined:destination===undefined),'ARGUMENT_REFUSED');
 const result=verifyDeliveryArchive(resolve(archive),{expectedSha256,expectedTree});
 if(command==='extract')extractDelivery(result,resolve(destination));
 console.log(JSON.stringify({profile:'v2',sourceTree:expectedTree,sha256:expectedSha256,verified:true,extracted:command==='extract',installed:false}));
}

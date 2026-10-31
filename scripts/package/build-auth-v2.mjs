/** Offline public V2 auth-runtime closure. Never installs or activates a service. */
import { execFileSync } from 'node:child_process';
import { chmodSync, cpSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { tmpdir } from 'node:os';
import { pathToFileURL } from 'node:url';
import { captureSource, deterministicArchive } from './dapp-release.mjs';
import { AUTH_V2_SCHEMA, AUTH_STATE_SEMANTICS, AUTH_V2_ROOTS, OPTIONAL_PRIVATE_PROVIDER, moduleImportDetails, allowedOptionalProvider, publicV2Path, sha256, verifyAuthDirectory, walkV2 } from './verify-auth-v2.mjs';
const check=(ok,code)=>{if(!ok)throw Error(`AUTH_V2_${code}`);};
export function v2RuntimeDependencies(sourcePackage, sourceLock) {
  check(sourcePackage.name==='8415wallet'&&sourceLock.lockfileVersion===3,'SOURCE_PACKAGE_REFUSED');
  const packages=sourceLock.packages,selected={},queue=['node_modules/ethers'];
  const dependencyPath=(from,name)=>{let scope=from;for(;;){const path=(scope?scope+'/':'')+'node_modules/'+name;if(packages[path])return path;if(!scope)throw Error('AUTH_V2_DEPENDENCY_MISSING');const boundary=scope.lastIndexOf('/node_modules/');scope=boundary<0?'':scope.slice(0,boundary);}};
  while(queue.length){const path=queue.shift();if(selected[path])continue;const entry=packages[path];
    check(entry&&typeof entry.version==='string'&&!entry.dev&&!entry.link&&!entry.hasInstallScript&&!entry.optional&&!entry.inBundle&&/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved??'')&&/^sha512-[A-Za-z0-9+/]+=*$/.test(entry.integrity??''),'DEPENDENCY_PIN_REFUSED');
    check(publicV2Path(path+'/package.json'),'PRIVATE_DEPENDENCY_REFUSED');selected[path]=structuredClone(entry);queue.push(...Object.keys(entry.dependencies??{}).map(name=>dependencyPath(path,name)));
  }
  const manifest={name:'8415wallet-auth-runtime-v2',version:sourcePackage.version,private:true,type:'module',license:sourcePackage.license,engines:{node:'>=22.18.0'},scripts:{start:'node server/v2/runtime-entry.mjs','operator:initialize':'node server/operator-init.mjs','operator:activate':'node server/operator-activate.mjs'},dependencies:{ethers:selected['node_modules/ethers'].version}};
  return {manifest,lock:{name:manifest.name,version:manifest.version,lockfileVersion:3,requires:true,packages:{'':{name:manifest.name,version:manifest.version,license:manifest.license,engines:manifest.engines,dependencies:manifest.dependencies},...selected}}};
}
export function v2SourceClosure(root,source,roots=AUTH_V2_ROOTS) {
  const seen=new Set(),queue=[...roots];
  while(queue.length){const file=queue.shift();if(seen.has(file))continue;check(publicV2Path(file)&&source.files[file],'SOURCE_CLOSURE_REFUSED');
    const text=readFileSync(join(root,file),'utf8');check(sha256(text)===source.files[file],'SOURCE_CHANGED');seen.add(file);
    if(!/\.(?:mjs|js|ts)$/.test(file))continue;
    const details=moduleImportDetails({[file]:text})[file];
    for(const specifier of [...details.static,...details.dynamic]){
      if(specifier.startsWith('node:'))continue;
      if(!specifier.startsWith('.')){check(specifier==='ethers'||allowedOptionalProvider(file,specifier,details),'EXTERNAL_IMPORT_REFUSED');continue;}
      queue.push(relative(root,resolve(root,dirname(file),specifier)).split('\\').join('/'));
    }
  }
  return [...seen].sort();
}
function normalize(directory){for(const name of readdirSync(directory)){const p=join(directory,name),s=lstatSync(p);check(!s.isSymbolicLink()&&(s.isFile()||s.isDirectory())&&s.nlink=== (s.isFile()?1:s.nlink),'UNSAFE_FILE');chmodSync(p,s.isDirectory()?0o755:0o644);if(s.isDirectory())normalize(p);}}
// aes-js 4.0.0-beta.5 includes a historical beta.4 npm tarball. It is not
// referenced by exports/main/module or executable source. Retain all runtime and
// license bytes; remove only this independently pinned non-runtime nested archive.
export function removePinnedNonRuntimeArchive(stage) {
  const relativePath='node_modules/aes-js/aes-js-4.0.0-beta.4.tgz';
  const file=join(stage,relativePath);
  if(!existsSync(file))return false;
  const stat=lstatSync(file),pkg=JSON.parse(readFileSync(join(stage,'node_modules/aes-js/package.json'),'utf8'));
  check(stat.isFile()&&!stat.isSymbolicLink()&&stat.nlink===1&&pkg.name==='aes-js'&&pkg.version==='4.0.0-beta.5'
    &&sha256(readFileSync(file))==='9f881ba245fa7bb186f1cfc8e463370d2397779052ce8372b627513c70dcdcf4','NON_RUNTIME_ARCHIVE_IDENTITY_REFUSED');
  rmSync(file);return true;
}
export function buildAuthV2({root=process.cwd(),output=join(root,'dist'),cache}={}) {
  root=resolve(root);output=resolve(output);
  check(typeof cache==='string'&&existsSync(resolve(cache)),'EXISTING_OFFLINE_CACHE_REQUIRED');
  const source=captureSource(root);
  // The V2 runtime owner supplies exact extra data/readFile identities, not an
  // unrestricted source-folder copy. All imports are independently traversed.
  const inventoryPath='server/v2/runtime-files.json';check(source.files[inventoryPath],'RUNTIME_COMPOSITION_NOT_READY');
  const inventory=JSON.parse(readFileSync(join(root,inventoryPath),'utf8'));
  check(inventory.schema==='8415wallet-v2-runtime-files/1'&&Array.isArray(inventory.files)&&inventory.files.every(p=>typeof p==='string'&&publicV2Path(p)),'RUNTIME_INVENTORY_REFUSED');
  const files=v2SourceClosure(root,source,[...AUTH_V2_ROOTS,...inventory.files,inventoryPath]);
  const runtime=v2RuntimeDependencies(JSON.parse(readFileSync(join(root,'package.json'),'utf8')),JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8')));
  const temporary=mkdtempSync(join(tmpdir(),'wallet-auth-v2-')),stage=join(temporary,'runtime');mkdirSync(stage,{mode:0o755});let complete=false;
  try{
    for(const file of [...files,'LICENSE','THIRD_PARTY_NOTICES.md','LICENSES/CC0-1.0.txt','deploy/auth-runtime/8415wallet-auth.service']){
      check(source.files[file]&&publicV2Path(file),'SOURCE_REQUIRED');const bytes=readFileSync(join(root,file));check(sha256(bytes)===source.files[file],'SOURCE_CHANGED');mkdirSync(dirname(join(stage,file)),{recursive:true});writeFileSync(join(stage,file),bytes,{mode:0o644});
    }
    writeFileSync(join(stage,'package.json'),JSON.stringify(runtime.manifest,null,2)+'\n');writeFileSync(join(stage,'package-lock.json'),JSON.stringify(runtime.lock,null,2)+'\n');
    const logs=join(temporary,'npm-logs');mkdirSync(logs,{mode:0o700});
    execFileSync('npm',['ci','--offline','--omit=dev','--ignore-scripts','--no-audit','--no-fund','--bin-links=false','--cache',resolve(cache)],{cwd:stage,stdio:'pipe',timeout:180000,env:{...process.env,NODE_OPTIONS:'',NODE_PATH:'',npm_config_update_notifier:'false',npm_config_logs_dir:logs}});
    rmSync(join(stage,'node_modules/.package-lock.json'),{force:true});normalize(stage);removePinnedNonRuntimeArchive(stage);
    const payload=Object.fromEntries(walkV2(stage).map(p=>[p,sha256(readFileSync(join(stage,p)))]));
    const release={schema:AUTH_V2_SCHEMA,profile:'v2',status:'OFFLINE_CANDIDATE_NOT_ACTIVATED',source:{commit:source.commit,tree:source.tree,dirty:source.dirty,prdSha256:source.files['docs/ERC-8415-Wallet-PRD.md']},runtime:{legacyMigrationIncluded:false,externalDependencies:[OPTIONAL_PRIVATE_PROVIDER],entry:'server/v2/runtime-entry.mjs',credentialStoreFormat:5,authStateSemantics:AUTH_STATE_SEMANTICS,bundledProductionDependencies:true,node:'>=22.18.0'},files:payload};
    writeFileSync(join(stage,'AUTH-RELEASE.json'),JSON.stringify(release,null,2)+'\n');writeFileSync(join(stage,'SHA256SUMS'),walkV2(stage).map(p=>`${sha256(readFileSync(join(stage,p)))}  ${p}`).join('\n')+'\n');
    verifyAuthDirectory(stage,{expectedTree:source.tree,expectedCommit:source.commit});
    // Import factories only in the installed closure; never call a listener,
    // credential entry, operator initialization, signing or execution factory.
    execFileSync(process.execPath,['--input-type=module','-e',"const main=await import('./server/v2/main.mjs');const auth=await import('./server/v2/auth-service.mjs');if(typeof main.createAuthRuntime!=='function'||typeof auth.createAuthService!=='function')throw Error('AUTH_V2_RUNTIME_EXPORTS_REFUSED');"],{cwd:stage,stdio:'pipe',timeout:30000,env:{PATH:process.env.PATH,NODE_OPTIONS:'',NODE_PATH:''}});
    check(captureSource(root).tree===source.tree,'SOURCE_CHANGED');
    mkdirSync(output,{recursive:true});const artifact=`8415wallet-auth-v2-${source.tree}.tar.gz`,digest=deterministicArchive(stage,join(output,artifact));
    const extracted=join(output,'package-auth-v2');check(!existsSync(extracted),'OUTPUT_EXISTS');cpSync(stage,extracted,{recursive:true});
    const result={artifact,sha256:digest,releaseManifestSha256:sha256(readFileSync(join(stage,'AUTH-RELEASE.json'))),...release};writeFileSync(join(output,'auth-v2-package-manifest.json'),JSON.stringify(result,null,2)+'\n');complete=true;return result;
  }finally{if(complete)rmSync(temporary,{recursive:true,force:true});}
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){check(process.argv.length===4&&process.argv[2]==='--existing-cache','ARGUMENT_REFUSED');const result=buildAuthV2({cache:process.argv[3]});console.log(JSON.stringify({artifact:result.artifact,sha256:result.sha256,tree:result.source.tree,status:result.status}));}

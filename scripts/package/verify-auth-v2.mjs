/** Public V2 runtime integrity. No service execution, secrets or activation. */
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { lstatSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
export const AUTH_V2_SCHEMA = '8415wallet-auth-runtime-v2/1';
export const AUTH_STATE_SEMANTICS = '8415wallet-auth-state/8';
export const PRE_CONTINUATION_STATE_SEMANTICS = '8415wallet-auth-state/6';
export const OPTIONAL_PRIVATE_PROVIDER = Object.freeze({loader:'server/v2/task-listing-installed.mjs',specifier:'@artfi/task-listing-runtime/server',manifestSha256:'7322af3b54aa068fd95ba1289be3b69a719dbf66d5b70d1ca3fbbf67a784ef0b',availability:'externally-installed-only',requiredWhen:'ordinary-nft-sale-enabled',automaticallyInstalled:false,bundled:false});
export const AUTH_V2_ROOTS = Object.freeze(['deploy/auth-runtime-v2/origin-continuation.mjs','server/v2/runtime-entry.mjs', 'server/v2/task-listing-installed.mjs', 'server/operator-init.mjs', 'server/operator-activate.mjs', 'deploy/auth-runtime-v2/install.mjs', 'scripts/package/verify-auth-v2.mjs']);
export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const check=(ok,code)=>{if(!ok)throw Error(`AUTH_V2_${code}`);};
const hex=/^[a-f0-9]{64}$/,git=/^[a-f0-9]{40}$/;
export const safePath=path=>typeof path==='string'&&path.length>0&&path.length<=240&&/^[A-Za-z0-9_@.+/=-]+$/.test(path)&&path.split('/').every(p=>p&&p!=='.'&&p!=='..');
export function publicV2Path(path) {
  return safePath(path) && !path.split('/').some(p=>p.startsWith('.')) &&
    !/^(?:src\/controls\/|src\/sdk\/linked\.|src\/wallet\/(?:linkedChainView|renderLinkedChain|forwardProgress)\.|vendor\/|provenance\/|node_modules\/@artfi\/)/.test(path) &&
    !/^server\/(?:main|runtime-entry|task-listing-installed|task-listing-package-pin|task-listing-bootstrap|forward-progress-reader|forward-progress-service)\.mjs$/.test(path) &&
    !/(?:^|\/)(?:credentials|store-key|auth\.json|\.env)(?:$|\.)/.test(path) && !/\.(?:tar|tgz|gz|zip|pem|key|enc)$/.test(path) &&
    (['AUTH-RELEASE.json','SHA256SUMS','package.json','package-lock.json','LICENSE','THIRD_PARTY_NOTICES.md'].includes(path) || /^(?:server\/|src\/|web\/|node_modules\/|LICENSES\/|deploy\/auth-runtime(?:-v2)?\/|scripts\/package\/verify-auth-v2\.mjs$)/.test(path));
}
export function walkV2(root,prefix='') {
  const directory=lstatSync(join(root,prefix));check(directory.isDirectory()&&!directory.isSymbolicLink(),'DIRECTORY_REFUSED');
  return readdirSync(join(root,prefix)).sort().flatMap(name=>{
    const path=prefix?`${prefix}/${name}`:name;check(safePath(path),'PATH_REFUSED');const stat=lstatSync(join(root,path));
    check(!stat.isSymbolicLink()&&(stat.isDirectory()||stat.isFile())&&!(stat.mode&0o7022),'UNSAFE_FILE');
    if(stat.isDirectory())return walkV2(root,path);
    check(stat.nlink===1&&!(stat.mode&0o111),'UNSAFE_FILE');check(publicV2Path(path),'PRIVATE_PATH_REFUSED');return [path];
  });
}
/** Parse source with the installed Node parser without evaluating any module. */
export function moduleImportDetails(files) {
  const program=`import vm from 'node:vm';import {stripTypeScriptTypes} from 'node:module';let data='';for await(const chunk of process.stdin)data+=chunk;const files=JSON.parse(data),result={};for(const [path,text] of Object.entries(files)){const code=path.endsWith('.ts')?stripTypeScriptTypes(text):text;const parsed=new vm.SourceTextModule(code);const dynamic=[...code.matchAll(/\\bimport\\s*\\(\\s*(['"])([^'"]+)\\1\\s*\\)/g)].map(m=>m[2]);if([...code.matchAll(/\\bimport\\s*\\(/g)].length!==dynamic.length)throw Error('AUTH_V2_DYNAMIC_IMPORT_REFUSED');result[path]={static:parsed.dependencySpecifiers,dynamic};}process.stdout.write(JSON.stringify(result));`;
  return JSON.parse(execFileSync(process.execPath,['--experimental-vm-modules','--input-type=module','-e',program],{input:JSON.stringify(files),encoding:'utf8',maxBuffer:8*1024*1024,env:{...process.env,NODE_OPTIONS:'',NODE_PATH:''},stdio:['pipe','pipe','pipe']}));
}
export function moduleSpecifiers(files) {
  return Object.fromEntries(Object.entries(moduleImportDetails(files)).map(([file,value])=>[file,[...value.static,...value.dynamic]]));
}
export function allowedOptionalProvider(file,specifier,details) {
  return file===OPTIONAL_PRIVATE_PROVIDER.loader&&specifier===OPTIONAL_PRIVATE_PROVIDER.specifier&&details.dynamic.filter(v=>v===specifier).length===1&&!details.static.includes(specifier);
}
export function verifyV2Imports(root,files) {
  const modules=Object.fromEntries(files.filter(p=>!p.startsWith('node_modules/')&&/\.(mjs|js|ts)$/.test(p)).map(p=>[p,readFileSync(join(root,p),'utf8')]));
  const parsed=moduleImportDetails(modules),present=new Set(files);
  for(const [file,details] of Object.entries(parsed))for(const specifier of [...details.static,...details.dynamic]){
    if(specifier.startsWith('node:'))continue;
    if(!specifier.startsWith('.')){if(allowedOptionalProvider(file,specifier,details))continue;check(specifier==='ethers','EXTERNAL_IMPORT_REFUSED');check(present.has('node_modules/ethers/package.json'),'DEPENDENCY_MISSING');continue;}
    const target=relative(root,resolve(root,dirname(file),specifier)).split('\\').join('/');
    check(publicV2Path(target)&&present.has(target),'IMPORT_CLOSURE_REFUSED');
  }
  return parsed;
}
export function authStateSemantics(release) {
  const value=release?.runtime?.authStateSemantics;
  check(value===undefined||/^8415wallet-auth-state\/[1-8]$/.test(value),'STATE_SEMANTICS_REFUSED');return value??'8415wallet-auth-state/1';
}
export function validateAuthStateTransition(current,candidate,{rollback=false}={}) {
  const from=authStateSemantics(current),to=authStateSemantics(candidate);if(from===to)return;
  check(Number(to.split('/')[1])>Number(from.split('/')[1]),'STATE_SEMANTICS_DOWNGRADE_REFUSED');check(!rollback,'STATE_SEMANTICS_TRANSITION_REFUSED');
}
export function verifyAuthDirectory(directory,{expectedTree,expectedCommit}={}) {
  const root=resolve(directory),files=walkV2(root),release=JSON.parse(readFileSync(join(root,'AUTH-RELEASE.json'),'utf8'));
  check(release.schema===AUTH_V2_SCHEMA&&release.profile==='v2'&&release.status==='OFFLINE_CANDIDATE_NOT_ACTIVATED','PROFILE_REFUSED');
  check(release.source&&Object.keys(release.source).sort().join(',')==='commit,dirty,prdSha256,tree'&&git.test(release.source.commit)&&git.test(release.source.tree)&&typeof release.source.dirty==='boolean'&&hex.test(release.source.prdSha256),'SOURCE_REFUSED');
  check(expectedTree===undefined||git.test(expectedTree)&&release.source.tree===expectedTree,'EXPECTED_TREE_MISMATCH');
  check(expectedCommit===undefined||git.test(expectedCommit)&&release.source.commit===expectedCommit,'EXPECTED_COMMIT_MISMATCH');
  check(JSON.stringify(release.runtime?.externalDependencies)===JSON.stringify([OPTIONAL_PRIVATE_PROVIDER]),'EXTERNAL_DEPENDENCY_DECLARATION_REFUSED');
  check(release.runtime?.legacyMigrationIncluded===false,'LEGACY_MIGRATION_SCOPE_REFUSED');
  check(release.runtime?.entry==='server/v2/runtime-entry.mjs'&&((release.runtime.authStateSemantics===AUTH_STATE_SEMANTICS&&release.runtime.credentialStoreFormat===5)||(release.runtime.authStateSemantics===PRE_CONTINUATION_STATE_SEMANTICS&&release.runtime.credentialStoreFormat===3))&&release.runtime.bundledProductionDependencies===true,'RUNTIME_REFUSED');
  check(release.files&&typeof release.files==='object'&&!Array.isArray(release.files),'INVENTORY_REFUSED');
  const expected=[...Object.keys(release.files),'AUTH-RELEASE.json','SHA256SUMS'].sort();check(JSON.stringify([...files].sort())===JSON.stringify(expected),'INVENTORY_MISMATCH');
  for(const [path,hash] of Object.entries(release.files))check(publicV2Path(path)&&hex.test(hash)&&sha256(readFileSync(join(root,path)))===hash,'FILE_HASH_MISMATCH');
  for(const path of [...AUTH_V2_ROOTS,'deploy/auth-runtime/8415wallet-auth.service','server/mail-config.mjs'])check(Object.hasOwn(release.files,path),'ENTRY_REQUIRED');
  if(release.runtime.authStateSemantics===AUTH_STATE_SEMANTICS)for(const path of ['deploy/auth-runtime/origin-continuation-core.mjs','server/origin-continuation.mjs','server/origin-continuation-context.mjs','server/origin-realm-router.mjs', 'server/owner-change-origin.mjs'])check(Object.hasOwn(release.files,path),'CONTINUATION_REQUIRED');
  const sums=files.filter(p=>p!=='SHA256SUMS').map(p=>`${sha256(readFileSync(join(root,p)))}  ${p}`).join('\n')+'\n';check(readFileSync(join(root,'SHA256SUMS'),'utf8')===sums,'SUMS_MISMATCH');
  const pkg=JSON.parse(readFileSync(join(root,'package.json'),'utf8'));
  check(pkg.name==='8415wallet-auth-runtime-v2'&&pkg.type==='module'&&Object.keys(pkg.dependencies??{}).join(',')==='ethers'&&pkg.scripts?.start==='node server/v2/runtime-entry.mjs','PACKAGE_REFUSED');
  const lock=JSON.parse(readFileSync(join(root,'package-lock.json'),'utf8'));check(lock.lockfileVersion===3&&lock.packages?.['']?.dependencies?.ethers===pkg.dependencies.ethers,'LOCK_REFUSED');
  for(const [path,entry] of Object.entries(lock.packages??{})){
    if(!path)continue;
    check(path.startsWith('node_modules/')&&publicV2Path(path+'/package.json')&&!entry.dev&&!entry.link&&!entry.hasInstallScript&&!entry.optional&&!entry.inBundle&&typeof entry.version==='string'&&/^https:\/\/registry\.npmjs\.org\//.test(entry.resolved??'')&&/^sha512-[A-Za-z0-9+/]+=*$/.test(entry.integrity??''),'DEPENDENCY_REFUSED');
    check(files.includes(path+'/package.json'),'DEPENDENCY_MISSING');
    const installed=JSON.parse(readFileSync(join(root,path,'package.json'),'utf8'));
    check(installed.version===entry.version&&!Object.keys(installed.scripts??{}).some(name=>['preinstall','install','postinstall','prepare'].includes(name)),'DEPENDENCY_METADATA_REFUSED');
  }
  const imports=verifyV2Imports(root,files);check(imports[OPTIONAL_PRIVATE_PROVIDER.loader]&&allowedOptionalProvider(OPTIONAL_PRIVATE_PROVIDER.loader,OPTIONAL_PRIVATE_PROVIDER.specifier,imports[OPTIONAL_PRIVATE_PROVIDER.loader]),'EXTERNAL_LOADER_REQUIRED');return release;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(resolve(process.argv[1])).href){
  if(process.argv.length!==4||process.argv[2]!=='--directory')throw Error('AUTH_V2_ARGUMENT_REFUSED');
  const release=verifyAuthDirectory(process.argv[3]);console.log(JSON.stringify({profile:release.profile,tree:release.source.tree,status:release.status}));
}

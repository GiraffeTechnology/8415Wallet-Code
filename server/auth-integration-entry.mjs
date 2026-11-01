/** Original systemd credential context only. No key/path arguments, new store,
 * transaction adapters, background worker or credential/configuration export. */
import { open,lstat,realpath,rename } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash,randomBytes } from 'node:crypto';
import { dirname,join } from 'node:path';
import { openEncryptedStore } from './store.mjs';
import { createCaVerifier } from './ca-verifier.mjs';
import { validateAuthConfig } from './config-validation.mjs';
import { assertAuthConfigurationStable } from './configuration-transition.mjs';
import { createAuthIntegrationRuntime,originalAuthenticationStoreView } from './auth-integration-runtime.mjs';
import { createManagedBusinessRuntime } from './managed-business-runtime.mjs';
import { createManagedFirstWrite } from './managed-first-write.mjs';
import { validateOriginalUninitializedWitness,loadSourceInstallationReceipt } from './auth-integration-provenance.mjs';
if(process.platform!=='linux'||process.getuid?.()!==0||process.geteuid?.()!==0)throw Error('AUTH_SERVICE_IDENTITY_REQUIRED');
if(![6,8].includes(process.argv.length)||process.argv[2]!=='--tenant'||!/^[a-z][a-z0-9-]{0,47}$/.test(process.argv[3])||process.argv[4]!=='--transport-origin')throw Error('AUTH_SERVICE_TENANT_REQUIRED');
if(process.argv.length===8&&(process.argv[6]!=='--runtime'||process.argv[7]!=='business'))throw Error('AUTH_SERVICE_RUNTIME_REFUSED');
const businessMode=process.argv.length===8;
const tenant=process.argv[3],name='8415wallet-auth-'+tenant,transportOrigin=process.argv[5],credentialDirectory='/run/credentials/'+name+'.service',configDirectory='/etc/'+name;
if(process.env.CREDENTIALS_DIRECTORY!==credentialDirectory||process.env.NODE_OPTIONS||process.env.NODE_PATH||process.env.WALLET_AUTH_STORE_KEY||process.env.WALLET_AUTH_CONFIG||
  Object.keys(process.env).some(k=>k.startsWith('WALLET_AUTH_SMTP_')))throw Error('AUTH_AMBIENT_CREDENTIAL_REFUSED');
async function directory(path,privateMode=false){const s=await lstat(path);if(!s.isDirectory()||s.isSymbolicLink()||s.uid!==0||s.gid!==0||
  s.mode&(privateMode?0o7077:0o7022)||await realpath(path)!==path)throw Error('AUTH_SERVICE_DIRECTORY_REFUSED');}
async function privateFile(path,limit){const f=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);try{const s=await f.stat();
  if(!s.isFile()||s.nlink!==1||s.uid!==0||s.gid!==0||s.mode&0o7077||s.size>limit)throw Error('AUTH_SERVICE_FILE_REFUSED');return await f.readFile();}finally{await f.close();}}
for(const leaf of [credentialDirectory,configDirectory,'/var/lib/'+name]){
 const ancestors=[];for(let p=leaf;;p=dirname(p)){ancestors.unshift(p);if(p===dirname(p))break;}
 for(const p of ancestors)await directory(p,p===leaf);
}
const configPath=configDirectory+'/auth.json';await assertAuthConfigurationStable(configPath);
const configurationBytes=await privateFile(configPath,1000000),configurationSha256=createHash('sha256').update(configurationBytes).digest('hex');
const config=JSON.parse(configurationBytes);validateAuthConfig(config);
if(config.tenant!==tenant||config.statePath!=='/var/lib/'+name+'/credentials.enc'||config.socketPath!=='/run/'+name+'/auth.sock'||config.port!==undefined)throw Error('AUTH_SERVICE_CONFIG_BINDING_REFUSED');
const cwd=await realpath(process.cwd());let packaged=false,packagedRelease=null;
try{
 const releaseFile=await open(join(cwd,'AUTH-RELEASE.json'),constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await releaseFile.stat();if(!stat.isFile()||stat.nlink!==1||stat.uid!==0||stat.gid!==0||stat.mode&0o7022||stat.size>16*1024*1024)throw Error('AUTH_INTEGRATION_PACKAGE_IDENTITY_REFUSED');packaged=true;packagedRelease=JSON.parse(await releaseFile.readFile());}
 finally{await releaseFile.close();}
}catch(error){if(error.code!=='ENOENT')throw error;}
let sourceReference;
const identity=await loadSourceInstallationReceipt(cwd,{packaged,release:packagedRelease,readReceipt:async reference=>{
sourceReference=reference;
if(reference.metadataDirectory){
 for(let p=reference.metadataDirectory;;p=dirname(p)){await directory(p,p===reference.metadataDirectory);if(p===dirname(p))break;}
 try{await lstat(join(cwd,'SOURCE-INSTALLATION.json'));throw Error('AUTH_INTEGRATION_RECEIPT_IN_PAYLOAD_REFUSED');}catch(error){if(error.code!=='ENOENT')throw error;}
}
return JSON.parse(await privateFile(reference.receiptPath,10000));
}});
if(identity.runtime!==cwd||identity.sourceDirty!==false||identity.status!=='SOURCE_AND_PINNED_RUNTIME_DEPENDENCIES_INSTALLED_NOT_ACTIVATED')throw Error('AUTH_INTEGRATION_SOURCE_REFUSED');
let originalUninitialized=false,stateExists=false,firstWrite=null;
try{
 const stateStat=await lstat(config.statePath);if(!stateStat.isFile()||stateStat.isSymbolicLink()||stateStat.nlink!==1||stateStat.uid!==0||stateStat.gid!==0||stateStat.mode&0o7077||stateStat.size===0)throw Error('AUTH_ORIGIN_EXISTING_STATE_REQUIRED');
 stateExists=true;
 if(identity.originalStoreWitness&&!businessMode)throw Error('AUTH_ORIGIN_CONTINUATION_STATE_CHANGED');
}catch(error){
 if(error.code!=='ENOENT')throw error;
 const w=identity.originalStoreWitness,dir=await lstat(dirname(config.statePath),{bigint:true});
 if(!businessMode)validateOriginalUninitializedWitness(w,{tenant,statePath:config.statePath,transportOrigin,sourceIdentity:{commit:identity.sourceCommit,tree:identity.sourceTree},
  directory:{inode:String(dir.ino),mtimeNs:String(dir.mtimeNs)}});
 originalUninitialized=true;
}
if(businessMode&&identity.originalStoreWitness){
 const journalPath=sourceReference.receiptPath+'.first-write.json';let journalBytes=null;
 await directory(dirname(journalPath),Boolean(sourceReference.metadataDirectory));
 const dir=await lstat(dirname(config.statePath),{bigint:true});
 firstWrite=await createManagedFirstWrite({receipt:identity,config,configurationSha256,transportOrigin,stateExists,
  directory:{inode:String(dir.ino),mtimeNs:String(dir.mtimeNs),uid:Number(dir.uid),gid:Number(dir.gid),mode:'0o'+(Number(dir.mode)&0o7777).toString(8)},
  readDirectoryIdentity:async()=>{
   await directory(dirname(config.statePath),true);const actual=await lstat(dirname(config.statePath),{bigint:true});
   return {inode:String(actual.ino),mtimeNs:String(actual.mtimeNs),uid:Number(actual.uid),gid:Number(actual.gid),mode:'0o'+(Number(actual.mode)&0o7777).toString(8)};
  },
  readJournal:async()=>{try{journalBytes=await privateFile(journalPath,20000);return JSON.parse(journalBytes);}catch(error){if(error.code==='ENOENT')return null;throw error;}},
  writeJournal:async record=>{
   await assertAuthConfigurationStable(configPath);
   if(createHash('sha256').update(await privateFile(configPath,1000000)).digest('hex')!==configurationSha256)throw Error('AUTH_FIRST_WRITE_CONFIGURATION_CHANGED');
   let prior=null;try{prior=await privateFile(journalPath,20000);}catch(error){if(error.code!=='ENOENT')throw error;}
   if(prior===null?journalBytes!==null:journalBytes===null||!prior.equals(journalBytes))throw Error('AUTH_FIRST_WRITE_JOURNAL_CHANGED');
   const raw=Buffer.from(JSON.stringify(record)),temporary=journalPath+'.'+randomBytes(12).toString('hex')+'.tmp';
   const file=await open(temporary,constants.O_WRONLY|constants.O_CREAT|constants.O_EXCL|constants.O_NOFOLLOW,0o600);
   try{await file.writeFile(raw);await file.sync();}finally{await file.close();}
   await rename(temporary,journalPath);const parent=await open(dirname(journalPath),'r');try{await parent.sync();}finally{await parent.close();}
   journalBytes=raw;
  }});
}
let key,store,runtime;
try{
 if(businessMode&&originalUninitialized&&!firstWrite)throw Error('AUTH_BUSINESS_EXISTING_STATE_REQUIRED');
 if(businessMode&&config.origin!==transportOrigin&&!firstWrite)throw Error('AUTH_BUSINESS_ORIGIN_MIGRATION_REQUIRED');
 const raw=await privateFile(credentialDirectory+'/store-key',66);
 try{const value=raw.toString('utf8').trim();if(!/^[a-fA-F0-9]{64}$/.test(value))throw Error('AUTH_CREDENTIAL_FORMAT_REFUSED');key=Buffer.from(value,'hex');}finally{raw.fill(0);}
 await assertAuthConfigurationStable(configPath);store=await openEncryptedStore(config.statePath,key,{firstWriteLifecycle:firstWrite?.hooks??null});
 if(store.originTransitionBinding().stateEstablished!==true&&!originalUninitialized)throw Error('AUTH_ORIGIN_EXISTING_STATE_REQUIRED');
 if(originalUninitialized&&store.originTransitionBinding().stateEstablished===true&&!firstWrite)throw Error('AUTH_ORIGIN_CONTINUATION_STATE_CHANGED');
 const common={config,transportOrigin,sourceIdentity:{commit:identity.sourceCommit,tree:identity.sourceTree},verifyCa:config.ca?await createCaVerifier(config.ca):null};
 runtime=businessMode?await createManagedBusinessRuntime({...common,store,originalFirstWrite:firstWrite?.admission??null}):createAuthIntegrationRuntime({...common,store:originalAuthenticationStoreView(store,{uninitialized:originalUninitialized})});
 await assertAuthConfigurationStable(configPath);await runtime.start();
 process.stdout.write(JSON.stringify({schema:'8415wallet-auth-integration-start/1',sourceCommit:identity.sourceCommit,sourceTree:identity.sourceTree,tenant,transportOrigin,basePath:config.basePath??'',mode:businessMode?'business-runtime':'auth-only-read-only',readOnlyScope:businessMode?null:'business-authority',authenticationReplayStateMayPersist:businessMode||!originalUninitialized,originalStoreStateEstablished:store.originTransitionBinding().stateEstablished,configurationOriginMatchesTransport:config.origin===transportOrigin,fullTaskAuthorityActivated:false,...(businessMode?{taskAuthorizationRuntimeEnabled:true,exactState:runtime.exactState,listingState:runtime.listingState,firstWriteState:firstWrite?.status()??'existing-state'}:{})})+'\n');
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await runtime.stop();await store.close();key.fill(0);};
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>stop().catch(()=>{process.exitCode=1;}));
}catch(error){await runtime?.stop();await store?.close();key?.fill(0);throw error;}

/** Original systemd credential context only. No key/path arguments, new store,
 * transaction adapters, background worker or credential/configuration export. */
import { open,lstat,realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname,join } from 'node:path';
import { openEncryptedStore } from './store.mjs';
import { createCaVerifier } from './ca-verifier.mjs';
import { validateAuthConfig } from './config-validation.mjs';
import { assertAuthConfigurationStable } from './configuration-transition.mjs';
import { createAuthIntegrationRuntime,originalAuthenticationStoreView } from './auth-integration-runtime.mjs';
import { validateOriginalUninitializedWitness } from './auth-integration-provenance.mjs';
if(process.platform!=='linux'||process.getuid?.()!==0||process.geteuid?.()!==0)throw Error('AUTH_SERVICE_IDENTITY_REQUIRED');
if(process.argv.length!==6||process.argv[2]!=='--tenant'||!/^[a-z][a-z0-9-]{0,47}$/.test(process.argv[3])||process.argv[4]!=='--transport-origin')throw Error('AUTH_SERVICE_TENANT_REQUIRED');
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
const config=JSON.parse(await privateFile(configPath,1000000));validateAuthConfig(config);
if(config.tenant!==tenant||config.statePath!=='/var/lib/'+name+'/credentials.enc'||config.socketPath!=='/run/'+name+'/auth.sock'||config.port!==undefined)throw Error('AUTH_SERVICE_CONFIG_BINDING_REFUSED');
const cwd=await realpath(process.cwd()),identity=JSON.parse(await privateFile(join(cwd,'SOURCE-INSTALLATION.json'),10000));
if(identity.runtime!==cwd||identity.sourceDirty!==false||identity.status!=='SOURCE_AND_PINNED_RUNTIME_DEPENDENCIES_INSTALLED_NOT_ACTIVATED')throw Error('AUTH_INTEGRATION_SOURCE_REFUSED');
let originalUninitialized=false;
try{
 const stateStat=await lstat(config.statePath);if(!stateStat.isFile()||stateStat.isSymbolicLink()||stateStat.nlink!==1||stateStat.uid!==0||stateStat.gid!==0||stateStat.mode&0o7077||stateStat.size===0)throw Error('AUTH_ORIGIN_EXISTING_STATE_REQUIRED');
 if(identity.originalStoreWitness)throw Error('AUTH_ORIGIN_CONTINUATION_STATE_CHANGED');
}catch(error){
 if(error.code!=='ENOENT')throw error;
 const w=identity.originalStoreWitness,dir=await lstat(dirname(config.statePath),{bigint:true});
 validateOriginalUninitializedWitness(w,{tenant,statePath:config.statePath,transportOrigin,sourceIdentity:{commit:identity.sourceCommit,tree:identity.sourceTree},
  directory:{inode:String(dir.ino),mtimeNs:String(dir.mtimeNs)}});
 originalUninitialized=true;
}
let key,store,runtime;
try{
 const raw=await privateFile(credentialDirectory+'/store-key',66);
 try{const value=raw.toString('utf8').trim();if(!/^[a-fA-F0-9]{64}$/.test(value))throw Error('AUTH_CREDENTIAL_FORMAT_REFUSED');key=Buffer.from(value,'hex');}finally{raw.fill(0);}
 await assertAuthConfigurationStable(configPath);store=await openEncryptedStore(config.statePath,key);
 if(store.originTransitionBinding().stateEstablished!==true&&!originalUninitialized)throw Error('AUTH_ORIGIN_EXISTING_STATE_REQUIRED');
 if(originalUninitialized&&store.originTransitionBinding().stateEstablished===true)throw Error('AUTH_ORIGIN_CONTINUATION_STATE_CHANGED');
 const authenticationStore=originalAuthenticationStoreView(store,{uninitialized:originalUninitialized});
 runtime=createAuthIntegrationRuntime({config,store:authenticationStore,transportOrigin,sourceIdentity:{commit:identity.sourceCommit,tree:identity.sourceTree},verifyCa:config.ca?await createCaVerifier(config.ca):null});
 await assertAuthConfigurationStable(configPath);await runtime.start();
 process.stdout.write(JSON.stringify({schema:'8415wallet-auth-integration-start/1',sourceCommit:identity.sourceCommit,sourceTree:identity.sourceTree,tenant,transportOrigin,basePath:config.basePath??'',mode:'auth-only-read-only',readOnlyScope:'business-authority',authenticationReplayStateMayPersist:!originalUninitialized,originalStoreStateEstablished:store.originTransitionBinding().stateEstablished,fullTaskAuthorityActivated:false})+'\n');
 let stopping=false;const stop=async()=>{if(stopping)return;stopping=true;await runtime.stop();await store.close();key.fill(0);};
 for(const signal of ['SIGTERM','SIGINT'])process.on(signal,()=>stop().catch(()=>{process.exitCode=1;}));
}catch(error){await runtime?.stop();await store?.close();key?.fill(0);throw error;}

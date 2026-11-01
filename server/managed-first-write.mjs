/** Service-owned first durable transaction provenance. No empty-store seeding,
 * identity creation, grant approval or plaintext/key export. */
import {createHash} from 'node:crypto';
import {open,lstat,rename,readdir} from 'node:fs/promises';
import {constants} from 'node:fs';
import {basename,dirname,join} from 'node:path';
import {validateOriginalUninitializedWitness} from './auth-integration-provenance.mjs';
import {validateOriginTransitionScope} from './origin-transition-state.mjs';
const admissions=new WeakMap();
const digest=value=>createHash('sha256').update(value).digest('hex');
const json=value=>JSON.stringify(value);
const check=(ok,code)=>{if(!ok)throw Error('AUTH_FIRST_WRITE_'+code);};
const hex=value=>typeof value==='string'&&/^[a-f0-9]{64}$/.test(value);
const same=(a,b)=>json(a)===json(b);
async function encryptedFile(path) {
 let file;
 try {file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);}
 catch(error){if(error.code==='ENOENT')return null;throw error;}
 try {
  const stat=await file.stat();
  check(stat.isFile()&&stat.uid===process.getuid()&&stat.nlink===1&&(stat.mode&0o7777)===0o600&&stat.size>0&&stat.size<=4*1024*1024,'STATE_FILE_REFUSED');
  const bytes=await file.readFile();return {sha256:digest(bytes),bytes:bytes.length};
 } finally {await file.close();}
}
/** readJournal/writeJournal are private, derived-receipt I/O supplied by the
 * managed entry. Neither callback nor an admission can be supplied by HTTP. */
export async function createManagedFirstWrite({receipt,config,configurationSha256,transportOrigin,directory,stateExists,readJournal,writeJournal,readDirectoryIdentity}) {
 check(receipt?.schema==='8415wallet-prepared-source-install/1'&&receipt.sourceDirty===false&&
  receipt.status==='SOURCE_AND_PINNED_RUNTIME_DEPENDENCIES_INSTALLED_NOT_ACTIVATED'&&hex(configurationSha256)&&
  typeof readJournal==='function'&&typeof writeJournal==='function'&&typeof readDirectoryIdentity==='function','CONTEXT_REFUSED');
 const witness=receipt.originalStoreWitness;
 const sourceIdentity={commit:receipt.sourceCommit,tree:receipt.sourceTree};
 validateOriginalUninitializedWitness(witness,{tenant:config.tenant,statePath:config.statePath,transportOrigin,sourceIdentity,directory:witness?.afterDrainDirectory});
 const stableDirectory=value=>check(value?.inode===witness.afterDrainDirectory.inode&&value.uid===0&&value.gid===0&&value.mode==='0o700','DIRECTORY_IDENTITY_CHANGED');
 // mtime legitimately changes when locks and state files are created. The
 // original directory identity and ownership never become optional, in any phase.
 stableDirectory(directory);
 if(config.origin!==transportOrigin)validateOriginTransitionScope({tenant:config.tenant,fromOrigin:config.origin,toOrigin:transportOrigin});
 const scope={tenant:config.tenant,statePath:config.statePath,configuredOrigin:config.origin,transportOrigin,
  sourceCommit:receipt.sourceCommit,sourceTree:receipt.sourceTree,receiptSha256:digest(json(receipt)),
  witnessSha256:digest(json(witness)),configurationSha256};
 let record=await readJournal();
 function validate(value) {
  check(value&&Object.keys(value).sort().join(',')==='candidate,phase,schema,scope'&&
   value.schema==='8415wallet-original-first-write/1'&&['admitted','prepared','committed'].includes(value.phase)&&same(value.scope,scope),'JOURNAL_BINDING_REFUSED');
  if(value.phase==='admitted'){check(value.candidate===null,'CANDIDATE_REFUSED');return value;}
  const candidate=value.candidate;
  check(candidate&&Object.keys(candidate).sort().join(',')==='bytes,sha256,temporaryName'&&hex(candidate.sha256)&&
   Number.isSafeInteger(candidate.bytes)&&candidate.bytes>0&&candidate.bytes<=4*1024*1024&&
   typeof candidate.temporaryName==='string'&&candidate.temporaryName.startsWith(basename(config.statePath)+'.')&&
   /^[a-f0-9]{24}\.tmp$/.test(candidate.temporaryName.slice(basename(config.statePath).length+1)),'CANDIDATE_REFUSED');
  return value;
 }
 if(record===null) {
  check(stateExists===false,'UNPROVEN_EXISTING_STATE');
  validateOriginalUninitializedWitness(witness,{tenant:config.tenant,statePath:config.statePath,transportOrigin,sourceIdentity,directory});
 } else validate(record);
 async function save(value) {validate(value);await writeJournal(value);record=value;}
 async function compare(path,candidate) {
  const actual=await encryptedFile(path);check(actual&&actual.sha256===candidate.sha256&&actual.bytes===candidate.bytes,'CANDIDATE_CHANGED');
 }
 const admission=Object.freeze({});admissions.set(admission,scope);
 const hooks=Object.freeze({
  // openEncryptedStore holds the original writer lock throughout recovery.
  async recover({statePath}) {
   check(statePath===scope.statePath,'STATE_REFERENCE_CHANGED');
   stableDirectory(await readDirectoryIdentity());
   const actual=await encryptedFile(statePath);
   const prefix=basename(statePath)+'.';
   const candidates=(await readdir(dirname(statePath))).filter(name=>name.startsWith(prefix)&&/^[a-f0-9]{24}\.tmp$/.test(name.slice(prefix.length)));
   if(record===null){
    check(actual===null,'UNPROVEN_EXISTING_STATE');check(candidates.length===0,'UNJOURNALED_CANDIDATE');
    // Admission metadata is not credential state. This records the original
    // absence under its real writer lock so a clean pre-transaction restart
    // need not pretend that the old directory timestamp is still current.
    await save({schema:'8415wallet-original-first-write/1',phase:'admitted',scope,candidate:null});return;
   }
   validate(record);
   if(record.phase==='admitted'){check(actual===null,'UNPROVEN_EXISTING_STATE');check(candidates.length===0,'UNJOURNALED_CANDIDATE');return;}
   if(record.phase==='committed'){check(actual!==null,'ESTABLISHED_STATE_MISSING');return;}
   check(candidates.every(name=>name===record.candidate.temporaryName),'MULTIPLE_CANDIDATES');
   const temporary=join(dirname(statePath),record.candidate.temporaryName);
   if(actual!==null) {
    await compare(statePath,record.candidate);
    let duplicate=false;try{await lstat(temporary);duplicate=true;}catch(error){if(error.code!=='ENOENT')throw error;}
    check(!duplicate,'DUPLICATE_CANDIDATE');
   } else {
    await compare(temporary,record.candidate);
    await rename(temporary,statePath);
    const dir=await open(dirname(statePath),'r');try{await dir.sync();}finally{await dir.close();}
   }
  },
  // Decryption/decoding must succeed before a prepared journal is committed.
  async opened({statePath,stateEstablished}) {
   check(statePath===scope.statePath,'STATE_REFERENCE_CHANGED');
   stableDirectory(await readDirectoryIdentity());
   if(record?.phase==='prepared') {check(stateEstablished===true,'CANDIDATE_NOT_OPENED');await save({...record,phase:'committed'});}
   else check(record?.phase==='admitted'?!stateEstablished:stateEstablished,'STATE_LIFECYCLE_CHANGED');
  },
  async prepare({statePath,temporaryPath,sha256,bytes}) {
   stableDirectory(await readDirectoryIdentity());
   check(record?.phase==='admitted'&&statePath===scope.statePath&&dirname(temporaryPath)===dirname(statePath),'ALREADY_PREPARED');
   const value={schema:'8415wallet-original-first-write/1',phase:'prepared',scope,candidate:{temporaryName:basename(temporaryPath),sha256,bytes}};
   validate(value);await compare(temporaryPath,value.candidate);await save(value);
  },
  async committed({statePath}) {
   stableDirectory(await readDirectoryIdentity());
   check(record?.phase==='prepared'&&statePath===scope.statePath,'COMMIT_SEQUENCE_REFUSED');
   await compare(statePath,record.candidate);await save({...record,phase:'committed'});
  }
 });
 return Object.freeze({admission,hooks,status:()=>record?.phase??'awaiting-first-transaction'});
}
export function assertManagedFirstWriteAdmission(admission,{config,transportOrigin,sourceIdentity}) {
 const scope=admissions.get(admission);
 check(scope&&scope.tenant===config.tenant&&scope.statePath===config.statePath&&scope.configuredOrigin===config.origin&&
  scope.transportOrigin===transportOrigin&&scope.sourceCommit===sourceIdentity.commit&&scope.sourceTree===sourceIdentity.tree,'ADMISSION_REFUSED');
 return true;
}

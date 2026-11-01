/** Source-managed auth-only code transitions. Pure metadata preparation only:
 * never reads config/keys/store, writes a receipt, stops a service or switches code.
 * The original privileged operator must measure inputs and verify external pins. */
import {createHash} from 'node:crypto';
import {posix} from 'node:path';
import {authStateSemantics} from '../../scripts/package/verify-auth.mjs';
import {SOURCE_RECEIPT_LAYOUT,sourceInstallationReference,validateOriginalUninitializedWitness} from '../../server/auth-integration-provenance.mjs';
const fail=code=>{throw Error('AUTH_SOURCE_UPGRADE_'+code);};
const requireThat=(value,code)=>{if(!value)fail(code);};
const hash=(value,length)=>typeof value==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(value)&&!/^0+$/.test(value);
const digest=bytes=>createHash('sha256').update(bytes).digest('hex');
const json=value=>JSON.stringify(value);
const clone=value=>JSON.parse(json(value));
function freeze(v){if(v&&typeof v==='object'){for(const c of Object.values(v))freeze(c);Object.freeze(v);}return v;}
const ns=v=>typeof v==='string'&&/^[1-9][0-9]{0,19}$/.test(v);
const path=v=>typeof v==='string'&&posix.isAbsolute(v)&&posix.normalize(v)===v;
function pinned(bytes,pin){requireThat(Buffer.isBuffer(bytes)&&hash(pin,64)&&digest(bytes)===pin,'EXTERNAL_PIN_REFUSED');try{return JSON.parse(bytes);}catch{fail('RECEIPT_JSON_REFUSED');}}
function privateReference(ref,expectedPath){requireThat(ref&&ref.path===expectedPath&&path(ref.path)&&ref.uid===0&&ref.gid===0&&ref.mode==='0o600'&&ref.links===1&&ref.symlink===false&&ns(ref.ctimeNs)&&ns(ref.mtimeNs)&&Number.isSafeInteger(ref.size)&&ref.size>0&&ref.size<=1000000&&typeof ref.device==='string'&&/^[1-9][0-9]*$/.test(ref.device)&&typeof ref.inode==='string'&&/^[1-9][0-9]*$/.test(ref.inode),'CONFIG_REFERENCE_REFUSED');}
function snapshot(artifact){return {commit:artifact.source.commit,tree:artifact.source.tree};}
export function planSourceModeUpgrade({currentReceiptBytes,candidateReleaseBytes,pins,current}){
 requireThat(pins&&current&&path(current.root),'CONTEXT_REFUSED');
 const receipt=pinned(currentReceiptBytes,pins.currentReceiptSha256),candidate=pinned(candidateReleaseBytes,pins.candidateReleaseSha256);
 requireThat(receipt.schema==='8415wallet-prepared-source-install/1'&&receipt.sourceDirty===false&&receipt.status==='SOURCE_AND_PINNED_RUNTIME_DEPENDENCIES_INSTALLED_NOT_ACTIVATED','SOURCE_RECEIPT_REFUSED');
 requireThat(hash(pins.currentCommit,40)&&hash(pins.currentTree,40)&&hash(pins.candidateCommit,40)&&hash(pins.candidateTree,40)&&receipt.sourceCommit===pins.currentCommit&&receipt.sourceTree===pins.currentTree&&candidate.source?.commit===pins.candidateCommit&&candidate.source?.tree===pins.candidateTree&&candidate.source.dirty===false,'SOURCE_IDENTITY_REFUSED');
 requireThat(pins.candidateTree!==pins.currentTree,'ALREADY_CURRENT');
 requireThat(/^[a-z][a-z0-9-]{0,47}$/.test(current.tenant)&&current.unitName==='8415wallet-auth-'+current.tenant+'.service'&&current.runtime===current.root+'/releases/'+pins.currentTree&&receipt.runtime===current.runtime&&current.resolvedWorkingDirectory===current.runtime&&current.currentTarget===current.runtime,'RUNTIME_REFERENCE_REFUSED');
 requireThat(current.uid===0&&current.gid===0&&hash(current.unitSha256,64)&&hash(current.entrySha256,64)&&current.unitSha256===pins.currentUnitSha256&&current.entrySha256===pins.currentEntrySha256&&hash(current.storeSourceSha256,64)&&current.storeSourceSha256===pins.currentStoreSourceSha256&&/^[1-9][0-9]*$/.test(current.pid),'RUNNING_IDENTITY_REFUSED');
 requireThat(current.startup?.sourceCommit===pins.currentCommit&&current.startup?.sourceTree===pins.currentTree&&current.startup?.transportOrigin===current.transportOrigin&&current.startup?.mode==='auth-only-read-only'&&current.startup?.fullTaskAuthorityActivated===false,'STARTUP_ATTESTATION_REFUSED');
 requireThat(current.state?.exists===false,'INITIALIZED_STATE_REQUIRES_COMPATIBILITY_REVIEW');
 const witness=receipt.originalStoreWitness;requireThat(witness&&witness.tenant===current.tenant&&witness.statePath===current.state.path&&witness.transportOrigin===current.transportOrigin,'ORIGINAL_WITNESS_REFUSED');
 // This checks the retained witness structure against its originally observed
 // post-drain metadata. It does NOT certify the currently running directory.
 validateOriginalUninitializedWitness(witness,{tenant:current.tenant,statePath:current.state.path,transportOrigin:current.transportOrigin,sourceIdentity:{commit:pins.currentCommit,tree:pins.currentTree},directory:witness.afterDrainDirectory});
 requireThat(current.state.path==='/var/lib/8415wallet-auth-'+current.tenant+'/credentials.enc'&&current.socketPath==='/run/8415wallet-auth-'+current.tenant+'/auth.sock','STATE_REFERENCE_REFUSED');
 privateReference(current.configReference,'/etc/8415wallet-auth-'+current.tenant+'/auth.json');
 requireThat(path(current.node?.path)&&current.node.uid===0&&current.node.gid===0&&current.node.links===1&&current.node.symlink===false&&['0o755','0o750','0o700'].includes(current.node.mode)&&ns(current.node.inode)&&ns(current.node.device)&&ns(current.node.ctimeNs)&&ns(current.node.mtimeNs)&&Number.isSafeInteger(current.node.size)&&current.node.size>0&&hash(current.node.sha256,64)&&current.node.sha256===pins.nodeSha256,'NODE_REFERENCE_REFUSED');
 requireThat(authStateSemantics({runtime:current.runtimeContract})===authStateSemantics(candidate)&&typeof current.runtimeContract?.authStateSemantics==='string'&&current.runtimeContract.credentialStoreFormat===candidate.runtime?.credentialStoreFormat&&[1,2,3,4,5].includes(candidate.runtime?.credentialStoreFormat),'STATE_SEMANTICS_CHANGE_REQUIRES_COMPATIBILITY_REVIEW');
 requireThat(candidate.runtime.sourceInstallationReceiptLayout===SOURCE_RECEIPT_LAYOUT,'CANDIDATE_RECEIPT_LAYOUT_UNSUPPORTED');
 const candidateRuntime=current.root+'/releases/'+pins.candidateTree;
 const body={schema:'8415wallet-source-mode-upgrade-plan/1',status:'PLANNED_REQUIRES_FRESH_DRAIN_EVIDENCE',pins:clone(pins),current:clone(current),candidate:snapshot(candidate),candidateRuntime,candidateReceiptPath:sourceInstallationReference(candidateRuntime,{packaged:true}).receiptPath,previousWitnessSha256:digest(Buffer.from(json(witness))),effects:{codeOnly:true,authConfigChanged:false,stateWritten:false,credentialsChanged:false,newIdentity:false,fullTaskAuthorityActivated:false}};
 return freeze({...body,planSha256:digest(Buffer.from(json(body)))});
}
export function finalizeSourceModeUpgrade(plan,{expectedPlanSha256,operationLock,drain,after}){
 requireThat(plan&&plan.schema==='8415wallet-source-mode-upgrade-plan/1','PLAN_REFUSED');
 const {planSha256,...body}=plan;requireThat(hash(expectedPlanSha256,64)&&planSha256===expectedPlanSha256&&digest(Buffer.from(json(body)))===expectedPlanSha256,'PLAN_CHANGED');
 const current=plan.current;
 requireThat(operationLock&&operationLock.path===current.root+'/operation.lock'&&operationLock.exclusive===true&&operationLock.uid===0&&operationLock.gid===0&&operationLock.mode==='0o600'&&operationLock.links===1&&hash(operationLock.tokenSha256,64)&&typeof operationLock.inode==='string'&&/^[1-9][0-9]*$/.test(operationLock.inode),'EXCLUSIVE_OPERATION_LOCK_REQUIRED');
 requireThat(drain&&drain.unitName===current.unitName&&drain.priorPid===current.pid&&drain.priorSourceCommit===plan.pins.currentCommit&&drain.priorSourceTree===plan.pins.currentTree&&drain.startedAfterOperationLock===true&&drain.gracefulCompleted===true&&drain.originalLockHeldByPriorPid===true&&drain.originalLockPath===current.state.path+'.lock'&&drain.storeFileAbsentBefore===true&&drain.priorStoreSourceSha256===current.storeSourceSha256,'FRESH_GRACEFUL_DRAIN_REQUIRED');
 requireThat(ns(operationLock.acquiredAtNs)&&ns(drain.startedAtNs)&&ns(drain.completedAtNs)&&BigInt(drain.startedAtNs)>=BigInt(operationLock.acquiredAtNs)&&BigInt(drain.completedAtNs)>=BigInt(drain.startedAtNs),'DRAIN_SEQUENCE_REFUSED');
 requireThat(after&&after.unitStopped===true&&after.priorPidExited===true&&after.writerLockAbsent===true&&after.stateFileAbsent===true&&after.statePath===current.state.path&&after.operationLockInode===operationLock.inode&&after.operationLockTokenSha256===operationLock.tokenSha256&&after.unitSha256===current.unitSha256&&after.entrySha256===current.entrySha256&&after.storeSourceSha256===current.storeSourceSha256&&after.currentTarget===current.currentTarget,'POST_DRAIN_IDENTITY_CHANGED');
 requireThat(ns(after.observedAtNs)&&BigInt(after.observedAtNs)>=BigInt(drain.completedAtNs)&&ns(after.directory?.mtimeNs)&&BigInt(after.directory.mtimeNs)>=BigInt(drain.startedAtNs)&&BigInt(after.directory.mtimeNs)<=BigInt(drain.completedAtNs),'POST_DRAIN_SEQUENCE_REFUSED');
 requireThat(['path','uid','gid','mode','links','symlink','inode','device','size','ctimeNs','mtimeNs'].every(k=>after.configReference?.[k]===current.configReference[k]),'CONFIG_REFERENCE_CHANGED');
 requireThat(['path','uid','gid','mode','links','symlink','inode','device','size','ctimeNs','mtimeNs','sha256'].every(k=>after.node?.[k]===current.node[k]),'NODE_REFERENCE_CHANGED');
 const witness={schema:'8415wallet-original-uninitialized-store-witness/1',tenant:current.tenant,statePath:current.state.path,unitName:current.unitName,sourceCommit:plan.candidate.commit,sourceTree:plan.candidate.tree,transportOrigin:current.transportOrigin,gracefulDrainCompleted:true,storeFileAbsentBefore:true,storeFileAbsentAfterDrain:true,originalOpenLockVerified:true,priorMainPid:current.pid,priorSourceCommit:plan.pins.currentCommit,priorSourceTree:plan.pins.currentTree,priorStoreSourceSha256:drain.priorStoreSourceSha256,beforeDirectory:clone(drain.beforeDirectory),beforeLock:clone(drain.beforeLock),afterDrainDirectory:clone(after.directory)};
 validateOriginalUninitializedWitness(witness,{tenant:current.tenant,statePath:current.state.path,transportOrigin:current.transportOrigin,sourceIdentity:plan.candidate,directory:after.directory});
 return freeze({schema:'8415wallet-prepared-source-install/1',status:'SOURCE_AND_PINNED_RUNTIME_DEPENDENCIES_INSTALLED_NOT_ACTIVATED',sourceCommit:plan.candidate.commit,sourceTree:plan.candidate.tree,sourceDirty:false,runtime:plan.candidateRuntime,originalStoreWitness:witness,sourceUpgrade:{schema:'8415wallet-source-mode-upgrade-evidence/1',receiptLayout:SOURCE_RECEIPT_LAYOUT,receiptPath:plan.candidateReceiptPath,planSha256,previousReceiptSha256:plan.pins.currentReceiptSha256,previousWitnessSha256:plan.previousWitnessSha256,operationTokenSha256:operationLock.tokenSha256,previousRuntime:current.runtime,configReference:clone(current.configReference),statePath:current.state.path,node:clone(current.node),unitSha256:current.unitSha256,fullTaskAuthorityActivated:false}});
}

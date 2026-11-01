import {posix} from 'node:path';
/** Private operator provenance, never a grant or HTTP input. It records an
 * inference from the pinned original store implementation, the live held lock,
 * unchanged directory metadata and a completed graceful drain. It permits only
 * the nonpersisting authentication view, not an empty business-authority store. */
const refuse=()=>{throw Error('AUTH_ORIGIN_EXISTING_STATE_REQUIRED');};
const decimal=value=>typeof value==='string'&&/^[1-9][0-9]{0,19}$/.test(value)&&BigInt(value)<1n<<64n;
const hash=(value,length)=>typeof value==='string'&&new RegExp('^[a-f0-9]{'+length+'}$').test(value)&&!/^0+$/.test(value);
export function validateOriginalUninitializedWitness(w,{tenant,statePath,transportOrigin,sourceIdentity,directory}){
 if(!w||w.schema!=='8415wallet-original-uninitialized-store-witness/1'||w.tenant!==tenant||w.statePath!==statePath||
   w.unitName!=='8415wallet-auth-'+tenant+'.service'||w.sourceCommit!==sourceIdentity.commit||w.sourceTree!==sourceIdentity.tree||w.transportOrigin!==transportOrigin||
   w.gracefulDrainCompleted!==true||w.storeFileAbsentBefore!==true||w.storeFileAbsentAfterDrain!==true||w.originalOpenLockVerified!==true||
   !hash(w.priorStoreSourceSha256,64)||!hash(w.priorSourceCommit,40)||!hash(w.priorSourceTree,40)||!decimal(w.priorMainPid))refuse();
 const before=w.beforeDirectory,lock=w.beforeLock,after=w.afterDrainDirectory;
 if(!before||!lock||!after||![before.inode,lock.inode,before.ctimeNs,before.mtimeNs,lock.ctimeNs,lock.mtimeNs,after.mtimeNs].every(decimal)||
  before.ctimeNs!==lock.ctimeNs||before.mtimeNs!==lock.mtimeNs||before.inode!==after.inode||directory.inode!==after.inode||directory.mtimeNs!==after.mtimeNs||
  before.uid!==0||before.gid!==0||before.mode!=='0o700'||lock.uid!==0||lock.gid!==0||lock.mode!=='0o600'||lock.size!==0||lock.links!==1||
  after.uid!==0||after.gid!==0||after.mode!=='0o700')refuse();
 return Object.freeze({status:'ORIGINAL_UNINITIALIZED_METADATA_WITNESS',businessAuthorityAvailable:false,storeInitializationAllowed:false});
}


export const SOURCE_RECEIPT_LAYOUT = 'external-instance-metadata/1';
/** Operator metadata is deliberately outside an immutable packaged runtime. */
export function sourceInstallationReference(runtime,{packaged}={}){
 if(typeof packaged!=='boolean'||typeof runtime!=='string'||!posix.isAbsolute(runtime)||posix.normalize(runtime)!==runtime)throw Error('AUTH_INTEGRATION_SOURCE_REFUSED');
 if(packaged&&(posix.basename(posix.dirname(runtime))!=='releases'||!hash(posix.basename(runtime),40)))throw Error('AUTH_INTEGRATION_SOURCE_REFUSED');
 const tree=posix.basename(runtime),root=posix.dirname(posix.dirname(runtime));
 return Object.freeze(packaged?{layout:SOURCE_RECEIPT_LAYOUT,receiptPath:posix.join(root,'source-installations',tree+'.json'),metadataDirectory:posix.join(root,'source-installations')}
  :{layout:'legacy-source-receipt/1',receiptPath:posix.join(runtime,'SOURCE-INSTALLATION.json'),metadataDirectory:null});
}
export function validatePackagedSourceReceipt(receipt,release,runtime){
 if(release?.schema!=='8415wallet-auth-runtime/1'||release.runtime?.sourceInstallationReceiptLayout!==SOURCE_RECEIPT_LAYOUT||release.source?.dirty!==false||!hash(release.source?.commit,40)||!hash(release.source?.tree,40)||receipt?.sourceDirty!==false||receipt?.runtime!==runtime||receipt.sourceCommit!==release.source.commit||receipt.sourceTree!==release.source.tree||posix.basename(runtime)!==release.source.tree)throw Error('AUTH_INTEGRATION_PACKAGE_IDENTITY_REFUSED');
 return Object.freeze({layout:SOURCE_RECEIPT_LAYOUT,sourceCommit:release.source.commit,sourceTree:release.source.tree});
}

/** One derived metadata lookup only. An absent packaged receipt never selects
 * legacy metadata, even if the latter exists in the payload. */
export async function loadSourceInstallationReceipt(runtime,{packaged,release,readReceipt}){
 if(typeof readReceipt!=='function')throw Error('AUTH_INTEGRATION_SOURCE_REFUSED');
 const reference=sourceInstallationReference(runtime,{packaged});
 const identity=await readReceipt(reference);
 if(packaged)validatePackagedSourceReceipt(identity,release,runtime);
 return identity;
}

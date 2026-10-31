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

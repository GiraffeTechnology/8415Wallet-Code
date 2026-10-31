/** Offline forward-only continuation coordinator for the original open store.
 * No key input, new store, service stop/start, proxy change or transaction API. */
import { readFile, open, unlink, lstat } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { validateAuthConfig } from '../../server/config-validation.mjs';
import { readOriginContinuation, originContinuationKey } from '../../server/origin-continuation.mjs';
const check = (ok,code = 'AUTH_ORIGIN_CONTINUATION_CONFLICT') => { if (!ok) throw Error(code); };
const sha = value => createHash('sha256').update(value).digest('hex');
const present = async path => { try { await lstat(path); return true; } catch(e) { if(e.code==='ENOENT')return false;throw e; } };
async function sync(path) { const h = await open(path,'r');try { await h.sync(); } finally { await h.close(); } }
export function createManagedOriginContinuation({ protect, protectedAncestors, exclusive, replace }) {
  check([protect,protectedAncestors,exclusive,replace].every(value=>typeof value==='function'));
  async function text(path,uid) { await protect(path,{uid,privateMode:true});return readFile(path,'utf8'); }
  return async function continueManagedOrigin({ target, store, continuation, uid = 0,
  run = (file,args) => execFileSync(file,args,{encoding:'utf8'}), checkpoint = async () => {} }) {
  const record = readOriginContinuation(continuation), reference = originContinuationKey(record);
  check(target?.tenant===record.tenant && typeof store?.withOriginContinuation==='function' && typeof store?.originTransitionBinding==='function');
  const binding = store.originTransitionBinding();
  check(binding.statePath===join(target.state,'credentials.enc') && binding.stateEstablished===true,'AUTH_ORIGIN_EXISTING_STATE_REQUIRED');
  const stopped = async () => {
    const lines = String(await run('systemctl',['show',target.unitName,'--property=ActiveState,SubState,MainPID']));
    const v = Object.fromEntries(lines.trim().split('\n').map(line=>{const i=line.indexOf('=');return [line.slice(0,i),line.slice(i+1)];}));
    check(v.ActiveState==='inactive' && v.SubState==='dead' && v.MainPID==='0','AUTH_ORIGIN_SERVICE_MUST_BE_STOPPED');
  };
  await stopped();
  for (const dir of [target.root,target.config,target.state]) {
    await protectedAncestors(dir,uid);await protect(dir,{uid,directory:true,privateMode:dir!==target.root});
  }
  await protect(binding.statePath,{uid,privateMode:true});
  for (const name of ['mail-config.lock','origin-migration.lock'])
    check(!await present(join(target.config,name)),'AUTH_CONFIG_TRANSITION_CONFLICT');
  const configPath=join(target.config,'auth.json'),receiptPath=join(target.root,'installation.json'),
    fence=join(target.config,'migration-config.lock'),operation=join(target.root,'operation.lock'),
    archive=join(target.root,'origin-continuation-'+record.digest+'.json');
  let result;
  await store.withOriginContinuation(record,async(stage,proof)=>{
    await stopped();let journal;
    if (await present(fence)) {
      journal=JSON.parse(await text(fence,uid));
      check(await text(operation,uid)==='origin-continuation:'+record.digest+'\n');
    } else if (await present(archive)) {
      const saved=JSON.parse(await text(archive,uid));check(saved.completed===true);const {completed,...body}=saved;journal=body;
      if(await present(operation))check(await text(operation,uid)==='origin-continuation:'+record.digest+'\n');
    } else {
      check(stage==='prepared' && !await present(operation));
      const beforeConfig=await text(configPath,uid),beforeReceipt=await text(receiptPath,uid),config=JSON.parse(beforeConfig),receipt=JSON.parse(beforeReceipt);
      validateAuthConfig(config);
      check(config.tenant===record.tenant && config.origin===record.authorizationOrigin && config.statePath===binding.statePath &&
        config.socketPath===join(target.socketDirectory,'auth.sock') && receipt.socketPath===config.socketPath &&
        receipt.schema==='8415wallet-auth-install/1' && receipt.tenant===record.tenant && receipt.origin===record.authorizationOrigin &&
        /^[a-f0-9]{40}$/.test(receipt.sourceTree) && ['prepared-not-activated','proxy-enabled'].includes(receipt.status));
      const rest={...config};delete rest.origin;
      check(!JSON.stringify(rest).includes(record.authorizationOrigin),'AUTH_ORIGIN_FEATURE_MIGRATION_REQUIRED');
      const nextConfig={...config,origin:record.transportOrigin};validateAuthConfig(nextConfig);
      const continuationIdentity={reference,digest:record.digest,revision:record.revision};
      const afterConfig=JSON.stringify(nextConfig,null,2)+'\n',afterReceipt=JSON.stringify({...receipt,origin:record.transportOrigin,originContinuation:continuationIdentity},null,2)+'\n';
      journal={schema:'8415wallet-managed-origin-continuation/1',tenant:record.tenant,continuation:record,proof,beforeConfig,beforeReceipt,afterConfig,afterReceipt};
      journal.id=sha(JSON.stringify(journal));
      await exclusive(operation,'origin-continuation:'+record.digest+'\n');
      await sync(target.root);
      try { await exclusive(fence,JSON.stringify(journal)+'\n');await sync(target.config);await checkpoint('fenced'); }
      catch(error) { if(!await present(fence)){await unlink(operation);await sync(target.root);}throw error; }
    }
    const {id,...body}=journal;
    check(id===sha(JSON.stringify(body)) && journal.schema==='8415wallet-managed-origin-continuation/1' && journal.tenant===record.tenant &&
      JSON.stringify(journal.continuation)===JSON.stringify(record) && JSON.stringify(journal.proof)===JSON.stringify(proof));
    if(stage==='prepared')return;
    await checkpoint('state-committed');
    for(const [path,before,after,name] of [[configPath,journal.beforeConfig,journal.afterConfig,'config-written'],[receiptPath,journal.beforeReceipt,journal.afterReceipt,'receipt-written']]) {
      const current=await text(path,uid);check(current===before||current===after,'AUTH_ORIGIN_RECOVERY_FILE_CHANGED');
      if(current!==after)await replace(path,after);await sync(path===configPath?target.config:target.root);await checkpoint(name);
    }
    const complete=JSON.stringify({...journal,completed:true})+'\n';
    if(await present(archive))check(await text(archive,uid)===complete);else {await exclusive(archive,complete);await sync(target.root);}
    await checkpoint('archived');
    if(await present(fence)){await unlink(fence);await sync(target.config);}await checkpoint('fence-cleared');
    if(await present(operation)){check(await text(operation,uid)==='origin-continuation:'+record.digest+'\n');await unlink(operation);await sync(target.root);}
    result=Object.freeze({status:'origin-continuation-complete',id,tenant:record.tenant,transportOrigin:record.transportOrigin,
      authorizationOrigin:record.authorizationOrigin,continuation:proof,sourceTree:JSON.parse(journal.afterReceipt).sourceTree,
      originalStateRecordsPreserved:true,serviceStarted:false,proxyChanged:false});
  });
  return result;
};
}

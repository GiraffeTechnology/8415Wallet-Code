/** Authentication-only integration on the original store. Task/owner-setting
 * routes and worker capabilities stay unavailable, not an empty grant inventory.
 * Normal product runtime defaults and persisted authority records are unchanged. */
import { createServer } from 'node:http';
import { chmod } from 'node:fs/promises';
import { createAuthService } from './auth-service.mjs';
import { validateAuthConfig } from './config-validation.mjs';
import { validateOriginTransitionScope } from './origin-transition-state.mjs';
import { protectSocketDirectory, protectSocket } from './socket-path.mjs';
/** A genuinely uninitialized original instance may authenticate configured
 * identities, but this view cannot initialize/rebuild a credential file. Existing
 * initialized stores retain normal authentication replay-counter persistence. */
export function originalAuthenticationStoreView(store,{uninitialized=false}={}) {
  if(!uninitialized)return store;
  const readOnly=Object.fromEntries(['read','readMany','withReadGate','withReadSnapshot','originTransitionBinding'].map(name=>{
    if(typeof store[name]!=='function')throw Error('AUTH_INTEGRATION_STORE_REFUSED');return [name,store[name].bind(store)];
  }));
  const refuse=()=>{throw Error('AUTH_ORIGINAL_STORE_INITIALIZATION_NOT_AUTHORIZED');};
  return Object.freeze({...readOnly,transaction:refuse,transactionMany:refuse});
}
export function createAuthIntegrationRuntime({config,store,transportOrigin,sourceIdentity,verifyCa=null}) {
  validateAuthConfig(config);
  const target=new URL(transportOrigin);
  if(target.origin!==transportOrigin||target.protocol!=='https:'||target.port!==''||!config.socketPath||
    !sourceIdentity||!['commit','tree'].every(k=>/^[a-f0-9]{40}$/.test(sourceIdentity[k]??'')))throw Error('AUTH_INTEGRATION_CONFIG_REFUSED');
  if(config.origin!==transportOrigin)validateOriginTransitionScope({tenant:config.tenant,fromOrigin:config.origin,toOrigin:transportOrigin});
  const handler=createAuthService({origin:transportOrigin,tenant:config.tenant,basePath:config.basePath??'',accounts:config.accounts,
    store,verifyCa,integrationReadOnly:true});
  const server=createServer((req,res)=>{
    res.setHeader('X-Wallet-Source-Commit',sourceIdentity.commit);res.setHeader('X-Wallet-Source-Tree',sourceIdentity.tree);
    res.setHeader('X-Wallet-Runtime-Mode','auth-only-read-only');return handler(req,res);
  });
  let started=false,closed=false,stopping=null;
  return Object.freeze({server,async start(){
    if(started||closed)throw Error('AUTH_LISTENER_ALREADY_STARTED');
    await protectSocketDirectory(config.socketPath);
    await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(config.socketPath,()=>{server.removeListener('error',reject);resolve();});});
    started=true;await chmod(config.socketPath,0o666);await protectSocket(config.socketPath);
  },stop(){closed=true;return stopping??=(async()=>{if(server.listening)await new Promise(resolve=>server.close(resolve));})();}});
}

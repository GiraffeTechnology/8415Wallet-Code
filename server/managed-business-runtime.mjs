/** Standard API composition for an existing managed instance. An original
 * first-write admission permits a genuine normal transaction, never an empty
 * seed, migrated grant, new principal or supplied execution capability. */
import {createAuthRuntime} from './main.mjs';
import {validateAuthConfig} from './config-validation.mjs';
import {assertManagedFirstWriteAdmission} from './managed-first-write.mjs';

export async function createManagedBusinessRuntime({config,store,transportOrigin,sourceIdentity,originalFirstWrite=null,...capabilities}) {
  validateAuthConfig(config);
  const target = new URL(transportOrigin);
  if (target.origin !== transportOrigin || target.protocol !== 'https:' || target.port !== '' || !config.socketPath ||
      !sourceIdentity || !['commit','tree'].every(key => /^[a-f0-9]{40}$/.test(sourceIdentity[key] ?? '')))
    throw Error('AUTH_BUSINESS_CONFIG_REFUSED');
  // A code upgrade is not a grant-scope or credential-realm migration.
  if (originalFirstWrite !== null) assertManagedFirstWriteAdmission(originalFirstWrite,{config,transportOrigin,sourceIdentity});
  if (config.origin !== transportOrigin && originalFirstWrite === null) throw Error('AUTH_BUSINESS_ORIGIN_MIGRATION_REQUIRED');
  const binding = store?.originTransitionBinding?.();
  if (binding?.statePath !== config.statePath || binding.stateEstablished !== true && originalFirstWrite === null)
    throw Error('AUTH_BUSINESS_EXISTING_STATE_REQUIRED');
  if (typeof store.transaction !== 'function' || typeof store.transactionMany !== 'function')
    throw Error('AUTH_BUSINESS_WRITABLE_STORE_REQUIRED');
  const runtime = await createAuthRuntime({config:config.origin===transportOrigin?config:{...config,origin:transportOrigin},store,...capabilities});
  // Headers identify the installed source, not the availability of every
  // provider, an accepted authorization, a signer or an executed transaction.
  runtime.server.prependListener('request', (_request,response) => {
    response.setHeader('X-Wallet-Source-Commit',sourceIdentity.commit);
    response.setHeader('X-Wallet-Source-Tree',sourceIdentity.tree);
    response.setHeader('X-Wallet-Runtime-Mode','business-runtime');
  });
  return runtime;
}

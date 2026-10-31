/** Session-bound read-only authority locator. It does not approve or execute a
 * task. Only the configured store and authenticated session select a mapping. */
import { originContinuationKey, resolveOriginContinuation } from './origin-continuation.mjs';
export async function readAuthorizationContext({ store, tenant, transportOrigin, session, validateSession }) {
  if (!store || typeof store.read !== 'function' || typeof validateSession !== 'function')
    throw Error('AUTH_ORIGIN_CONTEXT_CONFIG_REFUSED');
  await validateSession(session);
  const url = new URL(transportOrigin);
  const canonical = url.protocol === 'https:' && url.port === '';
  const record = canonical ? await store.read(originContinuationKey({ tenant, transportOrigin })) : null;
  if (canonical && record === null && store.originTransitionBinding?.().minimumGeneration === 5)
    throw Error('AUTH_ORIGIN_CONTINUATION_REFUSED');
  const selected = canonical ?
    resolveOriginContinuation(record, {
      tenant, transportOrigin, username: session.username, account: session.account.toLowerCase(), chainId: session.chainId
    }) : { authorizationOrigin: transportOrigin, continuation: null };
  // A logout, credential revision or binding change during the store read must
  // not return a late context for the previous identity.
  await validateSession(session);
  return Object.freeze({ schema: '8415wallet-authorization-context/1', tenant, transportOrigin,
    authorizationOrigin: selected.authorizationOrigin, username: session.username,
    account: session.account, chainId: session.chainId, continuation: selected.continuation });
}

import { mountTaskAuthorization } from './task-authorization-ui.mjs';
import { walletLogin, currentAccountClient } from './wallet-auth.mjs';
import { TaskAuthorizationClient } from './task-authorization.mjs';
mountTaskAuthorization({ document, window: globalThis, walletLogin, getClient: currentAccountClient });

// One stable read-only adapter per actual authenticated client/session. It
// shares the original cookie/CSRF transport and never constructs an endpoint.
let observerClient = null, observerTransport = null, observerSession = null;
const clearObserverClient = () => { observerClient = observerTransport = observerSession = null; };
walletLogin.subscribe(clearObserverClient);
function observationDetailsClientFor() {
  const session = walletLogin.assert(), transport = currentAccountClient();
  if (!transport || !session.serverId) { clearObserverClient(); return null; }
  const sessionKey = JSON.stringify([session.serverId, session.tenant, session.origin,
    session.account.toLowerCase(), session.chainId]);
  if (observerClient && observerTransport === transport && observerSession === sessionKey) return observerClient;
  const binding = walletLogin.capture();
  const assertCurrent = signal => {
    if (signal?.aborted) throw new DOMException('Cancelled', 'AbortError');
    walletLogin.assert(binding);
    if (currentAccountClient() !== transport) throw Error('OBSERVATION_SESSION_CHANGED');
  };
  const request = async (path, body, { signal } = {}) => {
    assertCurrent(signal); await walletLogin.check(); assertCurrent(signal);
    const value = await transport.request(path, body, { signal });
    assertCurrent(signal); await walletLogin.check(); assertCurrent(signal); return value;
  };
  observerClient = new TaskAuthorizationClient({ request, context: session }).observationDetailsClient();
  observerTransport = transport; observerSession = sessionKey; return observerClient;
}
import { mountTaskActivity } from './task-activity-ui.mjs';
mountTaskActivity({ document, window: globalThis, walletLogin, getClient: currentAccountClient,
  observationDetailsClientFor });

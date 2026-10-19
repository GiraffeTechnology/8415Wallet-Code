/** Connect the human policy controls to the actual account-settings lifecycle.
 * The controls own login, focus, visibility, cancellation and readback handling.
 * This entry never selects an endpoint, performs verification or grants authority.
 */
const connections = new WeakMap();

export function connectTaskVerificationPolicySettings({ document, window, walletLogin,
  currentAccountClient, subscribeAccountSettings, mountTaskVerificationPolicy, createTaskVerificationPolicyClient }) {
  if (connections.has(document)) return connections.get(document);
  const host = document.getElementById('task-verification-policy-settings');
  if (!host || !document.getElementById('auth-management')) return null;

  const adapters = new WeakMap();
  const controller = mountTaskVerificationPolicy({ document, window, walletLogin, host,
    getPolicyClient() {
      // Only the current server-authenticated client may supply the adapter.
      // Local wallet login, missing contracts and stale sessions stay unavailable.
      try {
        const client = currentAccountClient();
        if (!client || typeof client.taskVerification !== 'function' || typeof client.account !== 'function' ||
          typeof createTaskVerificationPolicyClient !== 'function') return null;
        if (!adapters.has(client)) {
          let adapter = null;
          try { adapter = createTaskVerificationPolicyClient({ client, walletLogin, document, window }); }
          catch { /* An unbound or unsupported wire contract remains unavailable. */ }
          adapters.set(client, adapter);
        }
        return adapters.get(client);
      } catch { return null; }
    },
  });
  let unsubscribe = null, destroyed = false;
  const connection = Object.freeze({
    destroy() {
      if (destroyed) return;
      destroyed = true; unsubscribe?.(); connections.delete(document); host.hidden = true; controller.destroy();
    },
  });
  connections.set(document, connection);
  try {
    unsubscribe = subscribeAccountSettings(open => {
      if (destroyed) return;
      host.hidden = open !== true;
      if (open === true) controller.show();
      else controller.hide();
    });
  } catch (error) {
    connection.destroy(); throw error;
  }
  return connection;
}

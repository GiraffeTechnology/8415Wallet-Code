import { walletLogin, currentAccountClient } from './wallet-auth.mjs';
import { createAssetControlClient } from './asset-control-client.mjs';
import { mountAssetControls } from './asset-control-ui.mjs';

const parent = document.getElementById('foundation-agent-settings');
if (parent) {
  // Do not retain contradictory unconnected/default summaries beside an
  // authoritative reader. A failed new read is shown as unavailable, not ON.
  for (const id of ['foundation-allowAgent-label', 'foundation-assetScope-label', 'foundation-operations-label'])
    document.getElementById(id)?.closest('.foundation-policy-row')?.setAttribute('hidden', '');
  const host = document.createElement('section'); host.id = 'asset-control-settings'; host.hidden = true; parent.append(host);
  const clients = new WeakMap();
  const getClient = () => {
    const client = currentAccountClient();
    if (!client || typeof client.account !== 'function' || typeof client.request !== 'function') return null;
    if (!clients.has(client)) clients.set(client, createAssetControlClient({ client, walletLogin, document, window: globalThis }));
    return clients.get(client);
  };
  const controller = mountAssetControls({ document, walletLogin, host, getClient });
  document.addEventListener('wallet:page', event => {
    if (event.detail === 'settings' && !parent.hidden) controller.show(); else controller.hide();
  });
  globalThis.addEventListener('pagehide', () => controller.hide());
}

/** Public owner-entered intent. No anonymous lookup or endpoint directory. */
import { getReleaseProfile } from './release-profile.mjs';
import { isPlatformPasswordProfile } from './tenant-password-routing.mjs';
import { loginIdentifier, requestedWalletPath } from './wallet-entry.mjs';
import { msg, paint } from './i18n.mjs';
import { walletUiBusy } from './ui-lock.mjs';
const el = id => document.getElementById(id);
let platform = false;
function render() {
  const unavailable = !platform || !loginIdentifier(el('password-tenant-select').value);
  el('password-tenant-continue').disabled = unavailable;
  el('password-tenant-continue').setAttribute('aria-disabled', String(unavailable));
  el('existing-login-open').disabled = unavailable;
  paint(el('password-tenant-status'), msg('entry.verifyHelp'));
}
el('password-tenant-select').addEventListener('input', render);
el('password-tenant-select').addEventListener('change', render);
el('password-tenant-continue').addEventListener('click', event => {
  event.preventDefault();
  if (!platform || walletUiBusy() || !loginIdentifier(el('password-tenant-select').value)) return;
  el('existing-login-open').click();
});
el('password-tenant-select').addEventListener('keydown', event => {
  if (event.key !== 'Enter') return;
  event.preventDefault(); el('password-tenant-continue').click();
});
getReleaseProfile().then(profile => {
  platform = isPlatformPasswordProfile(profile);
  if (!platform) return;
  const requested = requestedWalletPath(globalThis.location);
  if (requested && !el('password-tenant-select').value) el('password-tenant-select').value = requested.slice(1);
  el('platform-password-tenants').hidden = false; render();
}).catch(() => { /* Unverified release identity grants no navigation authority. */ });

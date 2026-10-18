/** Public owner-known name entry. No anonymous resolver or tenant directory. */
import { getReleaseProfile } from './release-profile.mjs';
import { isPlatformPasswordProfile } from './tenant-password-routing.mjs';
import { msg, paint } from './i18n.mjs';
import { walletUiBusy } from './ui-lock.mjs';
const el = id => document.getElementById(id);
function render() {
  const link = el('password-tenant-continue');
  link.removeAttribute('href'); link.setAttribute('aria-disabled', 'true');
  // Every name/action has the same local response. No existence/readiness hint,
  // URL synthesis, persistence, request or automatic navigation is performed.
  paint(el('password-tenant-status'), msg('account.tenantPasswordPending'));
}
el('password-tenant-select').addEventListener('input', render);
el('password-tenant-select').addEventListener('change', render);
el('password-tenant-action').addEventListener('change', render);
el('password-tenant-continue').addEventListener('click', event => {
  if (walletUiBusy() || !el('password-tenant-continue').hasAttribute('href')) event.preventDefault();
});
getReleaseProfile().then(profile => {
  if (!isPlatformPasswordProfile(profile)) return;
  el('platform-password-tenants').hidden = false; render();
}).catch(() => { /* An unverified platform has no navigation authority. */ });

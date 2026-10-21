/** Approved Figma presentation. No signing, RPC, custody or authentication authority. */
import { msg, paint } from './i18n.mjs';
import { walletLogin } from './wallet-auth.mjs';
import { getReleaseProfile } from './release-profile.mjs';
import { loginIdentifier, requestedWalletPath, authenticatedRoute } from './wallet-entry.mjs';
import { isPlatformPasswordProfile } from './tenant-password-routing.mjs';
import { walletUiBusy } from './ui-lock.mjs';
import { TenantAvatarController } from './tenant-avatar.mjs';
import { walletIdentityStateDisplay } from './wallet-identity-display.mjs';
const el = id => document.getElementById(id);
// This entry composition keeps business modules unmounted. It is not a service
// enablement flag, saved policy, authorization grant or backend security control.
const foundationOnly = document.body.dataset?.walletComposition === 'foundation';
const managementPage = 'authentication-management';
const publicPages = new Set(['home', 'existing', 'login', 'register', managementPage]);
const placeholderNodes = new Set(foundationOnly ? document.querySelectorAll('[data-foundation-placeholder="true"]') : []);
const isPlaceholder = node => placeholderNodes.has(node);
let publicEntryTransition = false, restoringPublicHistory = false;
if (foundationOnly) {
  // Capture the actual nodes once: removing a disabled/ARIA/data attribute later
  // does not activate a saved handler. Native disabled controls also cover keys.
  const stopPlaceholder = event => {
    if (!isPlaceholder(event.submitter) && !(event.composedPath?.() ?? [event.target]).some(isPlaceholder)) return;
    event.preventDefault?.(); event.stopImmediatePropagation?.();
  };
  for (const name of ['click', 'keydown', 'input', 'change', 'submit']) document.addEventListener(name, stopPlaceholder, true);
  // requestSubmit/submit do not consistently dispatch cancellable events. The
  // unmounted task form has no business handler; explicit instance calls are
  // quiet no-ops as well. The existing form-action CSP remains unchanged.
  for (const node of placeholderNodes) if (node.tagName?.toLowerCase() === 'form') {
    node.submit = () => {}; node.requestSubmit = () => {};
    node.addEventListener('submit', stopPlaceholder);
  }
}
const pages = new Set(['overview', 'native', 'settlement', 'account', 'transfer', 'review', 'receive', 'activity', 'nft', 'linked', 'advanced', 'settings', 'tasks']);
const titles = { overview: 'overview', native: 'native', settlement: 'settlement', account: 'standalone', transfer: 'send', review: 'review', receive: 'receive', activity: 'activity', nft: 'nftDetails', linked: 'responsibilities', advanced: 'advanced', settings: 'settings', tasks: 'tasks' };
pages.add(managementPage);
if (foundationOnly) for (const entry of publicPages) pages.add(entry);
let page = 'overview', authenticated = false, profile = null, avatarGeneration = 0, navigationDismiss = false;
let avatar = new TenantAvatarController();
function resetNative(state = 'notRead') {
  for (const id of ['native-token', 'native-entry', 'native-finality', 'native-contested', 'native-gap', 'native-freshness']) paint(el(id), '');
  for (const id of ['native-owner', 'native-holder']) paint(el(id), '—');
  paint(el('native-status'), msg(`design.${state}`));
}
function dismissReview() { if (page !== 'review') return; navigationDismiss = true; try { el('asset-dismiss').click(); } finally { navigationDismiss = false; } }
function route(next, { history = true, focus = true } = {}) {
  if (!pages.has(next)) next = foundationOnly && !authenticated ? 'home' : 'overview';
  if (foundationOnly && !authenticated && !publicPages.has(next)) next = 'login';
  if (foundationOnly && authenticated && publicPages.has(next) && next !== managementPage) next = 'overview';
  if (next === 'linked' && !profile?.features.linkedResponsibilities) next = 'overview';
  if (page !== next) { dismissReview(); avatarGeneration++; avatar.cancel(); renderAvatar(); }
  page = next;
  for (const node of document.querySelectorAll('[data-page]')) node.hidden = node.dataset.page !== page;
  el('external-pages').hidden = !['transfer', 'review', 'receive', 'activity', 'nft'].includes(page);
  el('login-panel').hidden = page === managementPage || (foundationOnly ? page !== 'login' : authenticated && page !== 'settings');
  el('registration-panel').hidden = page !== 'register';
  el('existing-user-panel').hidden = authenticated || page !== 'existing';
  el('auth-management-view').hidden = page !== managementPage;
  const host = el(page === managementPage ? 'auth-management-verification' : 'auth-login-host');
  if (el('auth-login-controls').parentElement !== host) host.append(el('auth-login-controls'));
  const statusHost = el(page === managementPage ? 'auth-management-view' : 'auth-login-controls');
  if (el('wallet-login-status').parentElement !== statusHost) statusHost.append(el('wallet-login-status'));
  if (foundationOnly) {
    el('public-home').hidden = authenticated || page !== 'home';
    for (const node of document.querySelectorAll('[data-public-route]')) {
      node.hidden = authenticated || (node.closest('.foundation-public-nav') !== null && page === 'home');
      if (node.dataset.publicRoute === page) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
    }
  }
  // Native mode is retained by the original adapter; this router only chooses its screen.
  el('standalone').hidden = page !== 'native';
  el('read-result-card').hidden = !authenticated || !['native', 'settlement', 'account', 'linked'].includes(page);
  for (const node of document.querySelectorAll('.nav-item')) {
    const active = node.dataset.route === page || (node.dataset.route === 'native' && ['nft', 'settlement', 'account'].includes(page)) || (node.dataset.route === 'overview' && ['transfer', 'review', 'receive'].includes(page));
    if (active) node.setAttribute('aria-current', 'page'); else node.removeAttribute('aria-current');
  }
  paint(el('page-title'), msg(page === managementPage ? 'account.title' : page === 'existing' ? 'entry.existing' : foundationOnly && !authenticated ? `foundation.${page}` : authenticated ? `design.${titles[page]}` : 'ui.005'));
  paint(el('page-description'), authenticated && page === 'overview' ? msg('design.overviewNote') : '');
  if (history) globalThis.history.replaceState({ ...(globalThis.history.state ?? {}), walletPage: page }, '');
  if (focus) el('page-title').focus({ preventScroll: true });
  document.dispatchEvent?.(new CustomEvent('wallet:page', { detail: page }));
}
for (const button of document.querySelectorAll('[data-route]')) button.addEventListener('click', () => {
  if (walletUiBusy() || isPlaceholder(button)) return;
  if (foundationOnly && !authenticated) return;
  const next = button.dataset.route;
  if (['settings', managementPage].includes(page) && page !== next) document.dispatchEvent(new CustomEvent('wallet:authentication-leaving'));
  if (authenticated && next !== page) globalThis.history.pushState({ ...(globalThis.history.state ?? {}), walletPage: next }, '');
  if (button.dataset.settlement) {
    el('settlement-kind').value = button.dataset.settlement;
    el('settlement-kind').dispatchEvent(new Event('change', { bubbles: true }));
  }
  if (button.dataset.nftTransfer) {
    el('asset-kind').value = el('nft-standard').value === 'ERC-1155' ? 'erc1155-transfer' : 'erc721-transfer';
    el('asset-contract').value = el('nft-contract').value; el('asset-token-id').value = el('nft-token-id').value;
    el('asset-kind').dispatchEvent(new Event('change', { bubbles: true }));
  }
  route(next);
});
function openPublicPage(next, { history = true, cancelledManagement = false } = {}) {
  if (!foundationOnly || authenticated || (walletUiBusy() && !cancelledManagement) || !publicPages.has(next)) return;
  if (next === 'login' && !profile) return;
  if (next === 'login' && isPlatformPasswordProfile(profile)) {
    const identifier = loginIdentifier(el('password-tenant-select').value);
    if (!identifier) { el('password-tenant-select').focus?.(); return; }
    el('auth-username').value = identifier;
  }
  if (next === managementPage) {
    restoringPublicHistory = !history;
    try { el('auth-initial-open').click(); } finally { restoringPublicHistory = false; }
    return;
  }
  if (page === next && (next !== 'register' || !el('auth-registration').hidden)) return;
  publicEntryTransition = true;
  try {
    // Real auth cancellation remains owned by wallet-auth, including late-result
    // invalidation and any already-submitted registration reconciliation.
    if (!cancelledManagement) document.dispatchEvent(new CustomEvent('wallet:authentication-leaving'));
    if (next === 'register') el('auth-registration-open').click();
  } finally { publicEntryTransition = false; }
  let publicDestination;
  if (history && profile && isPlatformPasswordProfile(profile) && ['home', 'register'].includes(next)) {
    publicDestination = new URL(profile.deployment.url).pathname;
    el('password-tenant-select').value = ''; el('auth-username').value = '';
    el('existing-login-open').disabled = true; el('password-tenant-continue').disabled = true;
  }
  if (history) globalThis.history.pushState({ ...(globalThis.history.state ?? {}), walletPage: next }, '', publicDestination);
  route(next, { history: false });
}
for (const button of document.querySelectorAll('[data-public-route]')) button.addEventListener('click', () => openPublicPage(button.dataset.publicRoute));
el('auth-registration-open').addEventListener('click', () => {
  if (profile && isPlatformPasswordProfile(profile) && !authenticated && requestedWalletPath(globalThis.location)) {
    globalThis.history.replaceState({ ...(globalThis.history.state ?? {}), walletPage: 'register' }, '', new URL(profile.deployment.url).pathname);
    el('password-tenant-select').value = ''; el('auth-username').value = '';
  }
  if (foundationOnly && !publicEntryTransition && !authenticated) route('register', { history: false });
});
el('auth-registration-close').addEventListener('click', () => {
  if (foundationOnly && !publicEntryTransition && !authenticated) route('existing', { history: false });
});
el('skip-content').addEventListener('click', () => el('page-title').focus());
globalThis.addEventListener('keydown', event => { if (event.key !== 'Escape' || walletUiBusy()) return; if (foundationOnly && !authenticated && page === 'register') { openPublicPage('existing', { history: false }); globalThis.history.replaceState({ ...(globalThis.history.state ?? {}), walletPage: page }, ''); return; } if (page === 'review') el('asset-dismiss').click(); else if (page === 'settings') { avatarGeneration++; avatar.cancel(); el('tenant-avatar-file').value = ''; renderAvatar(); } });
globalThis.addEventListener('popstate', event => {
  try {
    const session = walletLogin.assert();
    if (profile && isPlatformPasswordProfile(profile) && session.walletRoute && session.walletRoute.walletPath !== globalThis.location.pathname) {
      document.dispatchEvent(new CustomEvent('wallet:authentication-leaving'));
      walletLogin.logout('LOGIN_CONTEXT_CHANGED');
    }
  } catch { /* No authenticated route to retain across navigation. */ }
  const cancelledManagement = page === managementPage || (foundationOnly && !authenticated && (page === 'login' || page === 'register'));
  if (cancelledManagement) document.dispatchEvent(new CustomEvent('wallet:authentication-leaving'));
  else if (walletUiBusy()) { globalThis.history.replaceState({ ...(globalThis.history.state ?? {}), walletPage: page }, ''); return; }
  // Cancellation invalidates the attempt immediately, but its request owns the
  // business lock until finally. History may display the destination meanwhile.
  if (foundationOnly && !authenticated) { openPublicPage(publicPages.has(event.state?.walletPage) ? event.state.walletPage : 'home', { history: false, cancelledManagement }); return; }
  if (event.state?.walletPage === managementPage) {
    restoringPublicHistory = true;
    try { el('auth-manage-open').click(); } finally { restoringPublicHistory = false; }
    return;
  }
  route(event.state?.walletPage, { history: false });
});
el('asset-dismiss').addEventListener('click', () => { if (isPlaceholder(el('asset-dismiss'))) return; if (page === 'review' && !navigationDismiss) { page = 'transfer'; route('transfer'); } });
document.addEventListener('wallet:asset-review', event => {
  if (!authenticated) return;
  const value = event.detail, summary = el('transfer-review-summary'); summary.replaceChildren();
  const title = document.createElement('h2'); title.textContent = `${value.amount} ${value.asset === 'ETH' ? 'wei' : value.asset}`; summary.append(title);
  const fields = [['ui.040', value.asset], ['ui.045', value.recipient], ['design.externalAccount', value.transaction.from], ['design.network', value.chain], ['ui.047', value.transaction.to], ['ui.050', value.tokenId ?? '—']];
  for (const [key, content] of fields) { const row = document.createElement('div'); row.className = 'review-row'; const label = document.createElement('span'); paint(label, msg(key)); const data = document.createElement('strong'); data.textContent = content; row.append(label, data); summary.append(row); }
  route('review');
});
document.addEventListener('wallet:asset-review-cleared', () => el('transfer-review-summary').replaceChildren());
document.addEventListener('wallet:summary-stale', event => {
  const scope = event.detail ?? 'all';
  if (scope === 'all' || scope === 'native') resetNative();
  if (['all', 'external', 'eth'].includes(scope)) paint(el('shell-balance'), msg('design.balanceUnread'));
  if (['all', 'external', 'nft'].includes(scope)) {
    paint(el('nft-result'), msg('design.noNft'));
    document.dispatchEvent(new CustomEvent('wallet:nft-view', { detail: null }));
  }
});
document.addEventListener('wallet:nft-view', event => {
  const card = el('nft-overview'); card.replaceChildren();
  if (!authenticated || !event.detail) { const title = document.createElement('strong'); paint(title, msg('design.noNft')); const note = document.createElement('p'); paint(note, msg('design.exactNft')); card.append(title, note); return; }
  const value = event.detail, title = document.createElement('strong'), body = document.createElement('p');
  title.textContent = `${value.standard} #${value.tokenId}`;
  body.textContent = `${value.balanceRaw} · ${value.contract}`; card.append(title, body);
});
document.addEventListener('wallet:asset-balance', event => { if (authenticated) paint(el('shell-balance'), `${event.detail.balanceETH} ETH`); });
document.addEventListener('wallet:native-view', event => {
  if (!authenticated) return;
  const { state, view } = event.detail;
  if (state !== 'ready') { resetNative(state === 'loading' ? 'loading' : state === 'error' ? 'readFailed' : 'notRead'); return; }
  if (view?.schema !== '8415-native-summary/1') { resetNative('readFailed'); return; }
  paint(el('native-token'), `#${view.tokenId}`);
  paint(el('native-owner'), walletIdentityStateDisplay(view.tradeablePosition.owner));
  paint(el('native-holder'), walletIdentityStateDisplay(view.confirmedHolder.holder));
  paint(el('native-entry'), msg('design.entry', { version: view.confirmedHolder.version }));
  // The answer and how it stands against the rule are separate facts. A final
  // present instant is legitimate while an admitted entry's effective time is
  // still ahead of it, so only a disagreement is shown as an inconsistency,
  // and an unobtained boundary is shown as neither.
  const finality = view.presentFinality;
  // Only a standing that is explicitly consistent earns a settled label: any
  // other value, including one a view did not state, is shown as unchecked.
  const standing = finality.agreement === 'consistent'
    ? finality.final
      ? { label: 'design.finalityCovered', note: 'design.finalityCoveredNote', tone: '' }
      : { label: 'design.provisional', note: null, tone: 'warning' }
    : finality.agreement === 'disagrees'
      ? finality.final
        ? { label: 'design.finalityAnomaly', note: 'design.finalityAnomalyNote', tone: 'danger' }
        : { label: 'design.finalityWithheld', note: 'design.finalityWithheldNote', tone: 'danger' }
      : { label: 'design.finalityUnverified', note: 'design.finalityUnverifiedNote', tone: 'warning' };
  paint(el('native-finality'), msg(standing.label));
  el('native-finality').className = `badge ${standing.tone}`;
  paint(el('native-gap'), msg(view.gap.kind === 'open' ? 'design.openGap' : view.gap.kind === 'none' ? 'design.closedGap' : 'design.noSettlement'));
  el('native-gap').className = `badge ${view.gap.kind === 'open' ? 'warning' : ''}`;
  paint(el('native-contested'), view.gap.kind === 'open' ? msg('design.contestedFrom', { instant: view.gap.openedAt }) : msg(view.gap.kind === 'none' ? 'design.notContested' : 'design.noSettlement'));
  el('native-contested').className = `badge ${view.gap.kind === 'open' ? 'danger' : ''}`;
  paint(el('native-freshness'), msg('design.freshnessUnread'));
  paint(el('native-status'), standing.note ? msg(standing.note) : msg('design.snapshot', { instant: view.observedAt }));
});
walletLogin.subscribe(session => {
  if (session && profile && isPlatformPasswordProfile(profile)) {
    const destination = authenticatedRoute(session.walletRoute);
    const requested = requestedWalletPath(globalThis.location);
    if (!session.serverId || !destination || requested !== null && requested !== destination.walletPath) {
      walletLogin.logout('LOGIN_SERVICE_BINDING_REFUSED'); return;
    }
    globalThis.history.replaceState({ ...(globalThis.history.state ?? {}), walletPage: 'overview' }, '', destination.walletPath);
    // Keep only authenticated canonical intent in memory for later reauth.
    // Do not dispatch input: this is not a new user attempt or a lookup.
    el('password-tenant-select').value = destination.walletName;
    el('auth-username').value = destination.walletName;
    paint(el('tenant-label'), destination.walletName);
  }
  authenticated = !!session;
  // A new authenticated context must not inherit another account's summary.
  resetNative();
  document.body.classList.toggle('signed-out', !authenticated);
  paint(el('shell-account'), session ? session.account : msg('design.signedOut'));
  paint(el('shell-chain'), session ? `Chain ${session.chainId}` : '');
  if (!session) { resetNative(); paint(el('shell-balance'), msg('design.balanceUnread')); paint(el('native-read-result'), ''); }
  if (publicEntryTransition) return;
  const entry = publicPages.has(page) ? page : 'home';
  if (page === managementPage) { route(managementPage, { focus: false, history: false }); return; }
  route(session ? (/^0x[0-9a-f]{64}$/.test(globalThis.history.state?.walletTaskDigest ?? '') ? 'tasks' : 'overview') : foundationOnly ? entry : 'settings', { focus: false, history: !foundationOnly });
});
function avatarImage(target, url) {
  target.replaceChildren();
  if (url) { const image = document.createElement('img'); image.src = url; image.alt = ''; target.append(image); }
  else target.textContent = profile?.tenant.label?.slice(0, 1) || '8';
}
function renderAvatar() {
  const state = avatar.snapshot();
  avatarImage(el('tenant-avatar'), state.savedUrl);
  avatarImage(el('tenant-avatar-preview'), state.previewUrl ?? state.savedUrl);
  paint(el('tenant-avatar-status'), msg('design.avatarStatus', { status: state.errorCode ?? state.status }));
  el('tenant-avatar-save').disabled = foundationOnly || !state.hasDraft;
  el('tenant-avatar-remove').disabled = foundationOnly || !state.hasSaved;
}
async function changeAvatar(action) {
  if (foundationOnly) return; // No unverified preference write or direct-handler effect.
  const generation = ++avatarGeneration;
  try { await action(); } catch { /* Render only the controller's stable public status. */ }
  if (generation === avatarGeneration) renderAvatar();
}
el('tenant-avatar-file').addEventListener('change', () => {
  if (isPlaceholder(el('tenant-avatar-file'))) return;
  const file = el('tenant-avatar-file').files?.[0];
  if (file) changeAvatar(() => avatar.select(file));
});
el('tenant-avatar-save').addEventListener('click', () => changeAvatar(() => avatar.save()));
el('tenant-avatar-cancel').addEventListener('click', () => { if (isPlaceholder(el('tenant-avatar-cancel'))) return; avatarGeneration++; avatar.cancel(); el('tenant-avatar-file').value = ''; renderAvatar(); });
el('tenant-avatar-remove').addEventListener('click', () => changeAvatar(() => avatar.remove()));
globalThis.addEventListener('pagehide', () => { avatarGeneration++; avatar.dispose(); });
globalThis.addEventListener('pageshow', event => {
  if (!event.persisted) return;
  avatarGeneration++; avatar = new TenantAvatarController();
  if (profile) { try { avatar.setContext(profile, globalThis.location); changeAvatar(() => avatar.load()); } catch { renderAvatar(); } }
});
getReleaseProfile().then(async value => {
  profile = value; paint(el('tenant-label'), value.tenant.label);
  const platform = isPlatformPasswordProfile(value);
  for (const id of ['existing-tenant-context', 'login-tenant-context']) paint(el(id), msg(platform ? 'entry.platformContext' : 'entry.currentWallet', { wallet: value.tenant.label }));
  // A configured current wallet is usable. An arbitrary public identifier is not a resolver.
  if (platform) {
    const requested = requestedWalletPath(globalThis.location);
    if (requested && !el('password-tenant-select').value) el('password-tenant-select').value = requested.slice(1);
  }
  el('existing-login-open').disabled = platform && !loginIdentifier(el('password-tenant-select').value);
  // Release identity belongs to the shared shell, not an optional business module.
  paint(el('release-profile'), msg('status.profile', { product: value.product, version: value.version, platform: value.platform, tenant: value.tenant.label }));
  el('profile-name').value = value.tenant.label; el('profile-tenant').value = value.tenant.id; el('profile-version').value = value.id.toUpperCase();
  paint(el('tenant-context'), msg('design.workspace', { profile: value.id.toUpperCase() }));
  document.querySelector('.nav-item[data-route="linked"]').hidden = !value.features.linkedResponsibilities;
  try { avatar.setContext(value, globalThis.location); await avatar.load(); } catch { /* Storage unavailable is a visible local preference failure only. */ }
  renderAvatar(); route(platform && requestedWalletPath(globalThis.location) && !authenticated ? 'existing' : page, { focus: false });
}).catch(() => { paint(el('release-profile'), msg('message.000')); for (const button of document.querySelectorAll('[data-route]')) button.disabled = true; });
el('wallet-login-method').addEventListener('change', () => {
  if (foundationOnly && !authenticated && page !== managementPage) route('login', { history: false });
});
document.addEventListener('wallet:authentication-method', () => {
  if (el('auth-management').hidden) return;
  if (page !== managementPage && !restoringPublicHistory) globalThis.history.pushState({ ...(globalThis.history.state ?? {}), walletPage: managementPage }, '');
  route(managementPage, { history: false });
});
document.addEventListener('wallet:authentication-settings', () => {
  if (page !== managementPage && !restoringPublicHistory) globalThis.history.pushState({ ...(globalThis.history.state ?? {}), walletPage: managementPage }, '');
  route(managementPage, { history: false });
});
document.addEventListener('wallet:authentication-closed', () => {
  route(authenticated ? 'settings' : 'existing');
  el(authenticated ? 'auth-manage-open' : 'auth-initial-open').focus?.();
});
document.addEventListener('wallet:authentication-view', () => {
  if (page === managementPage) route(managementPage, { focus: false, history: false });
});
resetNative();
if (foundationOnly) {
  const entry = publicPages.has(globalThis.history.state?.walletPage) ? globalThis.history.state.walletPage : 'home';
  if (entry === 'register') openPublicPage(entry, { history: false });
  else if (entry === managementPage) route('existing', { focus: false, history: false });
  else route(entry, { focus: false, history: false });
} else route('overview', { focus: false });

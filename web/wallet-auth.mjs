import { tenantClientOptions } from './tenant-path.mjs';
import { isPlatformPasswordProfile, passwordPanelAction } from './tenant-password-routing.mjs';
import { msg, paint } from './i18n.mjs';
import { WalletLogin, WalletLoginError } from './login-core.mjs';
import { AccountAuthClient } from './account-auth.mjs';
import { verifyMessage, getAddress, hashMessage, Interface } from '../dist/browser/vendor/ethers.js';
import { getReleaseProfile } from './release-profile.mjs';
import { acquireWalletUi, releaseWalletUi } from './ui-lock.mjs';
import { clearEnrollmentQr, renderEnrollmentQr } from './enrollment-qr.mjs';
import { authorizeMethodChange, commitMethodChange, cancelMethodChangeUi } from './method-change-ui.mjs';
import { loginIdentifier, requestedWalletPath } from './wallet-entry.mjs';

export { WalletLoginError, currentAccountClient, currentAccountFeatures, subscribeAccountSettings, subscribeAgentPolicySettings };
function currentAccountFeatures() { return currentSession()?.serverId ? { forwardProgressAvailable: accountState?.forwardProgressAvailable === true, fundsAvailable: accountState?.fundsAvailable === true, nftInventoryAvailable: accountState?.nftInventoryAvailable === true } : null; }
export const walletLogin = new WalletLogin({ crypto: { verifyMessage, getAddress, hashMessage, Interface }, origin: () => globalThis.location.origin });
// Only the current authenticated account client supplies cookie/CSRF task requests.
function currentAccountClient() { return walletLogin.assert().serverId ? accountClient : null; }
const el = id => document.getElementById(id);
let timer = null, signing = false, attemptRevision = 0, accountClient = null, enrollmentTimer = null;
let managementProfile = null, managementStep = null, managementContext = null, managementReauthStep = null;
let platformRelease = false, releaseManagementContext = null;
let moduleOpen = false, accountState = null, managementTimer = null, enrollmentId = null, enrollmentRevision = 0, enrollmentProof = null;
const accountSettingsListeners = new Set();
const agentPolicySettingsListeners = new Set();
let agentPolicySettingsOpen = false;
function subscribeAgentPolicySettings(listener) {
  if (typeof listener !== 'function') throw new TypeError('Agent policy settings listener required');
  agentPolicySettingsListeners.add(listener);
  try { listener(agentPolicySettingsOpen); } catch (error) { agentPolicySettingsListeners.delete(listener); throw error; }
  return () => agentPolicySettingsListeners.delete(listener);
}
function notifyAgentPolicySettings(open) {
  if (agentPolicySettingsOpen === open) return;
  agentPolicySettingsOpen = open;
  for (const listener of agentPolicySettingsListeners) {
    try { listener(open); } catch { /* An optional reader cannot interrupt auth cleanup. */ }
  }
}
function subscribeAccountSettings(listener) {
  if (typeof listener !== 'function') throw new TypeError('Account settings listener required');
  accountSettingsListeners.add(listener);
  try { listener(moduleOpen); } catch (error) { accountSettingsListeners.delete(listener); throw error; }
  return () => accountSettingsListeners.delete(listener);
}
function notifyAccountSettings() {
  for (const listener of accountSettingsListeners) {
    // An optional settings panel must never interrupt authentication cleanup.
    try { listener(moduleOpen); } catch { /* Its next open must re-read state. */ }
  }
}
let recoveryStep = null, resetProof = null, recoveryTimer = null, recoveryRevision = 0;
let registrationOpen = false, registrationStep = null, registrationProof = null, registrationTimer = null, registrationRevision = 0, signupClient = null, signupAuthenticating = false;
let migrationStep = null, migrationTimer = null, migrationRevision = 0;
let managementCapabilities = null, capabilityRevision = 0, passwordRevision = 0, passwordPending = false;
const methods = ['password', 'wallet', 'ca', 'totp'];
const currentSession = () => { try { return walletLogin.assert(); } catch { return null; } };
const freshManagement = () => accountState?.management.freshIndependentLogin === true && Date.now() < accountState.management.reauthenticateBy;
function enrollmentControls() {
  el('auth-enroll-start').disabled = signing || !freshManagement() || !!enrollmentId || managementCapabilities !== true || accountState?.methodChange?.available !== true;
  el('auth-enroll-confirm').disabled = signing || !enrollmentId;
  el('auth-confirm-fields').hidden = !enrollmentId;
  el('auth-methods-save').disabled = signing || !freshManagement();
  if (el('auth-unbind')) { el('auth-unbind').hidden = !accountState?.authenticator.enrolled; el('auth-unbind').disabled = signing || !freshManagement(); }
  walletBindingControls(); caControls(); recoveryControls(); registrationControls();
}
function walletBindingControls() {
  const panel = el('auth-wallet-bindings'); if (!panel) return;
  const supported = accountState?.walletBindingManagement === 'same-account-v1'; panel.hidden = !supported;
  const bound = accountState?.walletBinding?.bound === true;
  for (const operation of ['initial', 'unbind']) {
    const button = el(`auth-wallet-${operation}`); button.hidden = operation === 'initial' ? bound : !bound;
    button.disabled = signing || !freshManagement() || !supported || accountState?.methodChange?.available !== true || (operation === 'initial' && !accountState?.methods?.password?.bound);
  }
}
function caControls() {
  const panel = el('auth-ca-bindings'); if (!panel) return;
  const fingerprints = accountState?.caBindings?.fingerprints ?? [];
  const supported = accountState?.caBindingManagement === 'combined-v1';
  panel.hidden = !supported;
  const select = el('auth-ca-old'), selected = select.value;
  if (JSON.stringify(Array.from(select.options ?? [], option => option.value)) !== JSON.stringify(fingerprints)) {
    select.replaceChildren();
    for (const fingerprint of fingerprints) { const option = document.createElement('option'); option.value = fingerprint; option.textContent = fingerprint; select.append(option); }
    if (fingerprints.includes(selected)) select.value = selected;
  }
  const disabled = signing || !freshManagement() || !supported || accountState?.methodChange?.available !== true;
  for (const id of ['auth-ca-old', 'auth-ca-new', 'auth-ca-initial', 'auth-ca-replace', 'auth-ca-unbind']) el(id).disabled = disabled;
  el('auth-ca-initial').hidden = fingerprints.length !== 0;
  for (const id of ['auth-ca-replace', 'auth-ca-unbind']) el(id).hidden = fingerprints.length === 0;
  select.parentElement.hidden = fingerprints.length === 0;
  if (!freshManagement()) el('auth-ca-new').value = '';
}
function clearPasswordInputs() {
  el('auth-new-password').value = ''; el('auth-new-password-confirm').value = '';
}
function clearPassword() {
  passwordRevision++; clearPasswordInputs(); paint(el('auth-password-status'), '');
}
function passwordControls() {
  const fresh = moduleOpen && !!currentSession()?.serverId && freshManagement(), supported = managementCapabilities === true;
  if (!fresh || !supported) clearPasswordInputs();
  el('auth-password-fields').hidden = !fresh || !supported;
  for (const id of ['auth-new-password', 'auth-new-password-confirm']) el(id).disabled = signing || !fresh || !supported;
  el('auth-password-save').disabled = signing || !fresh || !supported;
  if (el('auth-password-unbind')) {
    el('auth-password-unbind').hidden = !accountState?.methods.password.bound;
    el('auth-password-unbind').disabled = signing || !fresh || !supported || accountState?.methodChange?.available !== true;
  }
  el('auth-password-factor-help').hidden = !fresh || !accountState?.authenticator.enrolled;
  el('auth-password-reset-help').hidden = true;
  paint(el('auth-password-factor-help'), msg('change.combined'));
  paint(el('auth-password-save'), msg(accountState?.methods.password.bound ? 'account.passwordReplace' : 'account.passwordInitial'));
  paint(el('auth-password-state'), msg(managementCapabilities === false ? 'account.passwordUpgrade' : managementCapabilities === 'unavailable' ?
    'account.passwordServiceUnavailable' : !fresh ? 'account.passwordVerify' : accountState.methods.password.bound ? 'account.passwordBound' : 'account.passwordNotBound'));
}
function hideEnrollmentSecret() {
  paint(el('auth-enroll-secret'), ''); clearEnrollmentQr(el('auth-enroll-qr'));
  el('auth-enroll-qr-help').hidden = true;
}
function clearEnrollment() {
  clearTimeout(enrollmentTimer); enrollmentTimer = null; enrollmentId = null; enrollmentProof = null;
  hideEnrollmentSecret(); el('auth-enroll-code').value = ''; enrollmentControls();
}
function syncManagementIntent() {
  if (!platformRelease) return;
  const session = currentSession(), requested = requestedWalletPath(globalThis.location);
  const entered = loginIdentifier(el('password-tenant-select').value);
  // A route or entered identifier supplies intent, never authenticated identity.
  // Only the existing resolver and a verified session can bind an account.
  const intent = entered ?? (requested ? loginIdentifier(requested.slice(1)) : null);
  if (!entered && intent) {
    el('password-tenant-select').value = intent;
    el('auth-username').value = intent;
  }
  managementProfile = session?.serverId && session.walletRoute || moduleOpen && intent ? 'local' : 'platform';
  managementContext = session?.walletRoute?.walletName ?? intent ?? releaseManagementContext;
}
function renderManagement() {
  syncManagementIntent();
  el('auth-management').hidden = !moduleOpen;
  for (const id of ['auth-initial-open', 'auth-manage-open']) {
    el(id).disabled = managementProfile === null;
    el(id).hidden = false;
    el(id).setAttribute?.('aria-expanded', String(moduleOpen));
  }
  const session = currentSession(), verified = !!session?.serverId && !!accountState, fresh = verified && freshManagement();
  const changeUnavailable = verified && fresh && managementStep === 'totp' && (managementCapabilities === false || managementCapabilities === 'unavailable' || accountState?.methodChange?.available !== true);
  el('auth-method-states').hidden = !verified || managementStep !== 'methods';
  if (el('auth-method-password-open')) paint(el('auth-method-password-open'), msg(accountState?.methods.password.bound ? 'change.password.replace' : 'change.password.initial'));
  if (el('auth-method-totp-open')) paint(el('auth-method-totp-open'), msg(accountState?.authenticator.enrolled ? 'change.totp.replace' : 'change.totp.initial'));
  for (const [id, bound] of [['auth-method-password-unbind', accountState?.methods.password.bound], ['auth-method-totp-unbind', accountState?.authenticator.enrolled]]) {
    if (el(id)) { el(id).hidden = !verified || !bound; el(id).disabled = signing || !fresh || accountState?.methodChange?.available !== true; }
  }
  el('auth-enrollment').hidden = !verified || !fresh || managementStep !== 'totp';
  el('auth-existing-fields').hidden = true;
  el('auth-reauthenticate').hidden = !moduleOpen || !managementStep || managementStep === 'policy' || managementProfile !== 'local' || (verified && fresh);
  for (const method of methods) paint(el(`auth-state-${method}`), verified ? msg(accountState.methods[method].bound ?
    accountState.methods[method].enabled ? 'account.enabled' : accountState.methods[method].available === false ? 'account.unavailable' : 'account.disabled' : 'account.notBound') : '');
  for (const method of methods) {
    el(`auth-enable-${method}`).checked = verified && accountState.methods[method].enabled;
    el(`auth-enable-${method}`).disabled = !fresh || !accountState?.methods[method].bound || accountState?.methods[method].available === false;
  }
  paint(el('auth-management-status'), managementStep === 'policy' ? '' : msg(managementProfile === 'platform' ? 'entry.resolverUnavailable' : changeUnavailable ? 'change.serviceUnavailable' : !managementStep ? 'entry.chooseSetup' : verified ? fresh ? 'change.combined' : 'account.freshRequired' : 'entry.verifyHelp'));
  paint(el('auth-enrollment-title'), msg(accountState?.authenticator.enrolled ? 'account.reset' : 'ui.020'));
  paint(el('auth-enroll-start'), msg(accountState?.authenticator.enrolled ? 'account.reset' : 'ui.024'));
  el('auth-initial-guide').hidden = managementStep !== 'totp' || !verified || accountState.authenticator.enrolled;
  el('auth-reset-guide').hidden = managementStep !== 'totp' || !verified || !accountState.authenticator.enrolled;
  enrollmentControls(); renderRecovery(); renderRegistration();
  // Choosing an operation changes presentation only; existing server proofs own authority.
  el('auth-setup-menu').hidden = !!managementStep;
  el('auth-management-back').hidden = !managementStep;
  const labels = { totp: 'entry.authenticator', password: 'account.passwordTitle', methods: 'account.methods', email: 'registration.migrateTitle', recovery: 'recovery.title', policy: 'entry.agentPolicy' };
  el('auth-management-step-title').hidden = !managementStep;
  paint(el('auth-management-step-title'), managementStep ? msg(labels[managementStep]) : '');
  for (const step of ['methods', 'email', 'recovery', 'policy']) el(`auth-setup-${step}-open`).hidden = !verified;
  for (const step of Object.keys(labels)) el(`auth-setup-${step}-open`).disabled = managementProfile === null;
  const needsEmail = verified && !!managementStep && managementStep !== 'policy' &&
    !accountState.registration.complete &&
    (!accountState.recovery.configured || managementStep === 'recovery');
  el('auth-password-settings').hidden = managementProfile !== 'local' || managementStep !== 'password' || needsEmail;
  el('auth-registration-account').hidden = !verified || (managementStep !== 'email' && !needsEmail);
  el('auth-recovery-settings').hidden = !verified || managementStep !== 'recovery' || needsEmail;
  if (needsEmail) { el('auth-enrollment').hidden = true; el('auth-method-states').hidden = true; }
  el('auth-management-verification').hidden = !moduleOpen || !managementStep || managementStep === 'policy' || fresh || managementProfile !== 'local';
  if (managementContext) paint(el('auth-management-tenant-context'), msg(managementProfile === 'local' ? 'entry.currentWallet' : 'entry.platformContext', { wallet: managementContext }));
  notifyAgentPolicySettings(moduleOpen && verified && managementProfile === 'local' && managementStep === 'policy');
  document.dispatchEvent?.(new CustomEvent('wallet:authentication-view', { detail: { open: moduleOpen } }));
}
async function loadAccount() {
  const client = accountClient, binding = walletLogin.capture(), revision = attemptRevision;
  if (!walletLogin.assert(binding).serverId || !client) return;
  paint(el('auth-management-status'), msg('account.loading'));
  managementCapabilities = client.supportsPasswordManagement && client.supportsMethodManagement;
  try {
    const value = await client.account(); walletLogin.assert(binding);
    if (client !== accountClient || revision !== attemptRevision) return;
    accountState = value;
    document.dispatchEvent?.(new CustomEvent('wallet:account-features'));
    el('auth-registration-account-email').value = value.registration?.email ?? '';
    renderManagement(); clearTimeout(managementTimer);
    if (freshManagement()) managementTimer = setTimeout(() => { clearPassword(); clearEnrollment(); clearRecovery(); clearMigration(); el('auth-existing-code').value = ''; renderManagement(); }, Math.max(0, value.management.reauthenticateBy - Date.now()));
  } catch {
    if (client !== accountClient || revision !== attemptRevision || !currentSession()) return;
    accountState = null; renderManagement(); paint(el('auth-management-status'), msg('account.statusFailed'));
  }
}
walletLogin.subscribe((session, reason) => {
  if (platformRelease) {
    syncManagementIntent();
  }
  if (!session) {
    const continuingReauthentication = managementReauthStep && moduleOpen && ['LOGIN_REQUIRED', 'LOGIN_STARTING'].includes(reason);
    if (continuingReauthentication) managementStep = managementReauthStep;
    else {
      managementReauthStep = null;
      if (!['password', 'totp'].includes(managementStep) || ['LOGIN_ACCOUNT_CHANGED', 'LOGIN_CHAIN_CHANGED', 'LOGIN_ACCOUNT_OR_CHAIN_CHANGED', 'LOGIN_DISCONNECTED'].includes(reason)) managementStep = null;
    }
  } else managementReauthStep = null;
  clearTimeout(timer); clearTimeout(managementTimer); enrollmentRevision++; capabilityRevision++; accountState = null;
  cancelMethodChangeUi(); clearPassword();
  if (!(signupAuthenticating && reason === 'LOGIN_STARTING')) {
    if (!session) {
      registrationRevision++; const pending = signupClient; signupClient = null;
      if (pending) void pending.cancelRegistration();
    }
    clearSignup(true);
  }
  migrationRevision++; clearMigration();
  clearEnrollment(); clearRecovery(); // Session/identity transitions remove pixels and localized secret bindings.
  for (const id of ['auth-password', 'auth-code', 'auth-existing-code', 'auth-enroll-code']) el(id).value = '';
  el('auth-recovery-output').hidden = true; paint(el('auth-recovery-codes'), '');
  el('wallet-private').hidden = !session; el('wallet-private').inert = !session;
  el('wallet-logout').hidden = !session && !signing; el('wallet-login').hidden = !!session;
  paint(el('wallet-login-status'), session ? msg('status.loggedIn', { account: session.account, chain: session.chainId, expires: new Date(session.expiresAt).toISOString() }) :
    reason === 'LOGIN_EXPIRED' ? msg('message.017') : msg('ui.031'));
  renderManagement();
  if (session) timer = setTimeout(() => walletLogin.logout('LOGIN_EXPIRED'), Math.max(0, session.expiresAt - Date.now()));
});
el('wallet-login').addEventListener('click', async () => {
  if (signing) return;
  const lock = acquireWalletUi(); if (lock === null) return;
  const currentAttempt = ++attemptRevision;
  signing = true; el('wallet-login').disabled = true; el('wallet-logout').hidden = false; enrollmentControls();
  try {
    const profile = await getReleaseProfile().catch(() => { throw new WalletLoginError('LOGIN_RELEASE_CONFIG_REFUSED'); });
    if (currentAttempt !== attemptRevision) throw new WalletLoginError('LOGIN_CANCELLED');
    paint(el('wallet-login-status'), msg('message.018'));
    const method = el('wallet-login-method').value || 'wallet-local';
    const credentials = { username: el('auth-username').value, password: el('auth-password').value, code: el('auth-code').value, recovery: el('auth-recovery').checked === true };
    const platform = isPlatformPasswordProfile(profile);
    const identifier = platform ? loginIdentifier(el('password-tenant-select').value) : null;
    if (platform && (!identifier || method === 'wallet-local')) throw new WalletLoginError('LOGIN_SERVICE_BINDING_REFUSED');
    if (method === 'wallet-local') { accountClient = null; await walletLogin.signIn(globalThis.ethereum); }
    else {
      accountClient = new AccountAuthClient({ ...tenantClientOptions(profile), tenant: profile.tenant.id,
        ...(platform ? { loginEntry: { identifier, requestedWalletPath: requestedWalletPath(globalThis.location) } } : {}) });
      const adapter = accountClient.adapter(method, credentials);
      el('auth-password').value = ''; el('auth-code').value = '';
      await walletLogin.signIn(globalThis.ethereum, adapter);
      if (currentAttempt !== attemptRevision) throw new WalletLoginError('LOGIN_CANCELLED');
      await loadAccount();
    }
    if (moduleOpen && currentAttempt === attemptRevision) document.dispatchEvent?.(new CustomEvent('wallet:authentication-settings'));
  } catch (error) {
    if (currentAttempt !== attemptRevision) return;
    paint(el('wallet-login-status'), error instanceof WalletLoginError && error.code === 'LOGIN_PROVIDER_REQUIRED' ? msg('account.providerRequired') :
      error instanceof WalletLoginError && error.code === 'LOGIN_REJECTED' ? msg('message.019') :
      error instanceof WalletLoginError ? error.code : 'LOGIN_SERVICE_OR_CONFIG_UNAVAILABLE');
  } finally {
    // Profile/binding/provider failures can occur before the adapter clears
    // submitted fields. Never retain a password or OTP after a login attempt.
    el('auth-password').value = ''; el('auth-code').value = '';
    signing = false; el('wallet-login').disabled = false; releaseWalletUi(lock); enrollmentControls();
    try { walletLogin.assert(); } catch { el('wallet-logout').hidden = true; }
  }
});
function cancelLogin({ preserveManagementStep = false } = {}) {
  managementReauthStep = preserveManagementStep && moduleOpen ? managementStep : null;
  const pendingRegistration = signupClient; signupClient = null;
  if (pendingRegistration) void pendingRegistration.cancelRegistration();
  attemptRevision++; enrollmentRevision++; recoveryRevision++; registrationRevision++; migrationRevision++; capabilityRevision++;
  clearPassword(); clearEnrollment(); clearRecovery(); clearSignup(true); clearMigration(); walletLogin.logout();
}
el('wallet-logout').addEventListener('click', cancelLogin);
globalThis.addEventListener('pagehide', cancelLogin);
globalThis.addEventListener('pageshow', event => { if (event.persisted) cancelLogin(); });
globalThis.addEventListener('focus', () => { try { walletLogin.assert(); } catch { /* Already locked. */ } });
document.addEventListener('visibilitychange', () => { try { walletLogin.assert(); } catch { /* Already locked. */ } });

function renderLoginMethod() {
  const method = el('wallet-login-method').value || 'wallet-local';
  el('account-login-fields').hidden = !['password', 'totp'].includes(method);
  el('auth-password-label').hidden = method !== 'password';
  el('auth-code-label').hidden = method !== 'totp'; el('auth-recovery-label').hidden = method !== 'totp';
  const labels = { 'wallet-local': 'ui.018', password: 'account.loginPassword', totp: el('auth-recovery').checked ? 'account.loginRecovery' : 'account.loginTotp', wallet: 'account.loginWallet', ca: 'account.loginCa' };
  paint(el('wallet-login'), msg(labels[method] ?? 'ui.018'));
  paint(el('auth-method-help'), method === 'wallet-local' ? msg('ui.017') : method === 'ca' ? msg('message.020') : msg('message.021'));
}
function methodChanged() { cancelLogin({ preserveManagementStep: moduleOpen }); el('auth-password').value = ''; el('auth-code').value = ''; el('auth-recovery').checked = false; renderLoginMethod(); }
el('wallet-login-method').addEventListener('change', methodChanged);
el('auth-recovery').addEventListener('change', renderLoginMethod);
function verifyAgain() {
  cancelLogin({ preserveManagementStep: true }); accountState = null;
  if (!['password', 'wallet', 'ca'].includes(el('wallet-login-method').value)) el('wallet-login-method').value = 'wallet';
  renderLoginMethod(); renderManagement(); el('wallet-login-method').focus?.();
  document.dispatchEvent?.(new CustomEvent('wallet:authentication-method'));
}
async function loadManagementCapabilities() {
  // Platform intent cannot select an account-scoped service before login.
  // The authenticated client will load the real capabilities after resolution.
  if (platformRelease && !currentSession()?.serverId) {
    managementCapabilities = null; passwordControls(); return;
  }
  const revision = ++capabilityRevision;
  try {
    const profile = await getReleaseProfile();
    if (!moduleOpen || revision !== capabilityRevision) return;
    const client = accountClient ?? new AccountAuthClient({ ...tenantClientOptions(profile), tenant: profile.tenant.id });
    const value = await client.capabilities();
    if (!moduleOpen || revision !== capabilityRevision) return;
    managementCapabilities = value.passwordManagement === true && value.methodManagement === "combined-v1";
  } catch {
    if (!moduleOpen || revision !== capabilityRevision) return;
    managementCapabilities = 'unavailable';
  }
  renderManagement();
}
async function openManagement({ initial = false } = {}) {
  // Pre-profile events are ignored, never queued for later execution.
  if (managementProfile === null || signing) return;
  if (registrationOpen) closeRegistration({ navigate: false });
  clearManagementOperation(); moduleOpen = true; managementStep = null;
  renderManagement(); notifyAccountSettings();
  document.dispatchEvent?.(new CustomEvent('wallet:authentication-method'));
  document.dispatchEvent?.(new CustomEvent('wallet:authentication-settings'));
  el('auth-management-title').focus?.();
}
function clearManagementOperation() {
  managementReauthStep = null;
  if (el('auth-ca-new')) el('auth-ca-new').value = '';
  const pendingEnrollment = !!enrollmentId, pendingRecovery = !!recoveryStep || !!resetProof, pendingMigration = !!migrationStep;
  enrollmentRevision++; recoveryRevision++; migrationRevision++; capabilityRevision++;
  cancelMethodChangeUi();
  if (signing) cancelLogin();
  else {
    // Preserve each existing server-cancellation path, not only its local fields.
    if (pendingEnrollment) void cancelSetup({ status: false }); else clearEnrollment();
    if (pendingRecovery) void cancelRecovery(); else clearRecovery();
    if (pendingMigration) void cancelMigration(); else clearMigration();
    clearPassword();
  }
  for (const id of ['auth-password', 'auth-code', 'auth-existing-code']) el(id).value = '';
  el('auth-recovery').checked = false; el('auth-existing-recovery').checked = false;
  paint(el('auth-recovery-codes'), ''); el('auth-recovery-output').hidden = true;
}
function chooseManagementStep(step) {
  if (!moduleOpen || managementProfile === null || signing || !['totp', 'password', 'methods', 'email', 'recovery', 'policy'].includes(step)) return;
  if (!['totp', 'password'].includes(step) && !(currentSession()?.serverId && accountState)) return;
  if (managementStep === step) return;
  clearManagementOperation(); managementStep = step; renderManagement();
  if (managementProfile === 'local' && step !== 'policy') {
    if (!freshManagement()) {
      if (!currentSession()?.serverId || !['password', 'wallet', 'ca'].includes(currentSession()?.kind)) el('wallet-login-method').value = 'wallet';
      verifyAgain();
    }
    void loadManagementCapabilities();
  }
  el('auth-management-step-title').focus?.();
}
for (const step of ['totp', 'password', 'methods', 'email', 'recovery', 'policy']) {
  el(`auth-setup-${step}-open`)?.addEventListener('click', () => chooseManagementStep(step));
}
el('auth-management-back')?.addEventListener('click', () => {
  if (!moduleOpen) return;
  clearManagementOperation(); managementStep = null; renderManagement(); el('auth-management-title').focus?.();
});
el('auth-initial-open').addEventListener('click', () => openManagement({ initial: true }));
el('auth-manage-open').addEventListener('click', () => openManagement());
el('auth-reauthenticate').addEventListener('click', verifyAgain);
async function cancelSetup({ status = true } = {}) {
  const proof = enrollmentId, revision = ++enrollmentRevision, client = accountClient, session = currentSession();
  const binding = session ? walletLogin.capture() : null;
  clearEnrollment(); el('auth-existing-code').value = '';
  if (!session?.serverId || !client) return;
  try {
    const result = await client.change('cancel', proof ? { changeProof: proof } : {});
    walletLogin.assert(binding);
    if (status && revision === enrollmentRevision) paint(el('auth-management-status'), result.confirmationInProgress ? 'AUTH_CONFIRMATION_IN_PROGRESS' : msg('account.cancelled'));
  } catch (error) {
    if (status && revision === enrollmentRevision && currentSession()) paint(el('auth-management-status'), error instanceof WalletLoginError ? error.code : 'AUTH_SETUP_UNAVAILABLE');
  }
}
function closeManagement({ navigate = true } = {}) {
  moduleOpen = false; managementStep = null; notifyAccountSettings();
  // Closing invalidates local generations. A submitted commit may still require reconciliation.
  clearManagementOperation(); renderManagement();
  if (navigate) document.dispatchEvent?.(new CustomEvent('wallet:authentication-closed'));
}
el('auth-management-close').addEventListener('click', () => closeManagement());
globalThis.addEventListener('keydown', event => {
  if (event.key !== 'Escape') return;
  if (registrationOpen) closeRegistration(); else if (moduleOpen) closeManagement();
});
document.addEventListener('wallet:authentication-leaving', () => {
  if (registrationOpen) closeRegistration({ navigate: false });
  if (moduleOpen) closeManagement({ navigate: false });
  // Successful enrollment closes the form before showing one-time recovery
  // codes. Leaving that completed screen must clear those codes and bindings too.
  else clearManagementOperation();
  for (const id of ['auth-password', 'auth-code']) el(id).value = '';
});
function methodStillCurrent(client, binding, revision) {
  try { walletLogin.assert(binding); return client === accountClient && revision === attemptRevision && moduleOpen && freshManagement(); }
  catch { return false; }
}
async function beginMethodChange(client, binding, revision, action, fields = {}) {
  if (action !== 'email.initial' && !accountState.registration.complete &&
    (!accountState.recovery.configured ||
      action === 'recovery.initial' || action === 'recovery.replace')) {
    paint(el('auth-management-status'), msg('change.verifyEmailFirst')); el('auth-registration-account-email').focus?.();
    throw new WalletLoginError('AUTH_VERIFIED_EMAIL_REQUIRED');
  }
  return authorizeMethodChange({ client, intent: { action, ...fields }, state: accountState, provider: globalThis.ethereum,
    isCurrent: () => methodStillCurrent(client, binding, revision) });
}
async function finishMethodChange(client, binding, revision, proof, code) {
  return commitMethodChange({ client, proof, state: accountState, code, caBridge: globalThis.walletCaBridge,
    isCurrent: () => methodStillCurrent(client, binding, revision) });
}
async function changeWalletBinding(action) {
  if (signing || !moduleOpen || managementStep !== 'methods' || !accountClient || !freshManagement() ||
    accountState?.walletBindingManagement !== 'same-account-v1' || accountState?.methodChange?.available !== true) return;
  const lock = acquireWalletUi(); if (lock === null) return;
  signing = true; const revision = attemptRevision, binding = walletLogin.capture(), client = accountClient;
  enrollmentControls(); let submitted = false;
  try {
    await walletLogin.check(); walletLogin.assert(binding);
    if (!methodStillCurrent(client, binding, revision)) throw new WalletLoginError('LOGIN_CANCELLED');
    const proof = await beginMethodChange(client, binding, revision, action, {});
    submitted = true; await finishMethodChange(client, binding, revision, proof);
    cancelLogin(); paint(el('wallet-login-status'), msg('change.saved'));
  } catch (error) {
    if (revision !== attemptRevision) return;
    if (submitted) { cancelLogin(); paint(el('wallet-login-status'), msg('change.wallet.checkState')); }
    else paint(el('auth-management-status'), msg('change.wallet.failed'));
  } finally { signing = false; releaseWalletUi(lock); enrollmentControls(); }
}
for (const operation of ['initial', 'unbind']) el(`auth-wallet-${operation}`)?.addEventListener('click', () => void changeWalletBinding(`wallet.${operation}`));
async function changeCaBinding(action) {
  if (signing || !moduleOpen || managementStep !== 'methods' || !accountClient || !freshManagement() ||
    accountState?.caBindingManagement !== 'combined-v1' || accountState?.methodChange?.available !== true) return;
  const fields = { ...(action !== 'ca.initial' ? { oldFingerprint: el('auth-ca-old').value } : {}),
    ...(action !== 'ca.unbind' ? { newFingerprint: el('auth-ca-new').value.trim() } : {}) };
  if (action !== 'ca.unbind' && !/^[a-f0-9]{64}$/.test(fields.newFingerprint)) { paint(el('auth-management-status'), msg('change.ca.invalid')); return; }
  const lock = acquireWalletUi(); if (lock === null) return;
  signing = true; const revision = attemptRevision, binding = walletLogin.capture(), client = accountClient;
  el('auth-ca-new').value = ''; enrollmentControls(); let submitted = false;
  try {
    await walletLogin.check(); walletLogin.assert(binding);
    if (!methodStillCurrent(client, binding, revision)) throw new WalletLoginError('LOGIN_CANCELLED');
    const proof = await beginMethodChange(client, binding, revision, action, fields);
    // A transport failure after this boundary is not permission to replay the change.
    submitted = true; await finishMethodChange(client, binding, revision, proof);
    cancelLogin(); paint(el('wallet-login-status'), msg('change.saved'));
  } catch (error) {
    if (revision !== attemptRevision) return;
    if (submitted && !(error instanceof WalletLoginError && ['LOGIN_CA_BRIDGE_REQUIRED', 'LOGIN_CANCELLED', 'LOGIN_CHALLENGE_BINDING_REFUSED', 'AUTH_CHANGE_REFUSED', 'AUTH_CHANGE_INPUT_REFUSED'].includes(error.code))) {
      cancelLogin(); paint(el('wallet-login-status'), msg('change.ca.checkState'));
    } else paint(el('auth-management-status'), msg('change.ca.failed'));
  } finally { signing = false; releaseWalletUi(lock); enrollmentControls(); }
}
for (const operation of ['initial', 'replace', 'unbind']) el(`auth-ca-${operation}`)?.addEventListener('click', () => void changeCaBinding(`ca.${operation}`));
async function unbindMethod(action) {
  const bound = action === 'totp.unbind' ? accountState?.authenticator.enrolled : accountState?.methods.password.bound;
  if (signing || !accountClient || !freshManagement() || !bound || accountState?.methodChange?.available !== true) return;
  const lock = acquireWalletUi(); if (lock === null) return;
  signing = true; enrollmentControls(); const revision = attemptRevision, binding = walletLogin.capture(), client = accountClient;
  clearEnrollment();
  try {
    await walletLogin.check(); walletLogin.assert(binding);
    const proof = await beginMethodChange(client, binding, revision, action);
    await finishMethodChange(client, binding, revision, proof); cancelLogin(); paint(el('wallet-login-status'), msg('change.saved'));
  } catch (error) { if (revision === attemptRevision) paint(el('auth-management-status'), error instanceof WalletLoginError ? error.code : 'AUTH_MANAGEMENT_UNAVAILABLE'); }
  finally { signing = false; releaseWalletUi(lock); enrollmentControls(); }
}
el('auth-unbind')?.addEventListener('click', () => void unbindMethod('totp.unbind'));
el('auth-password-unbind')?.addEventListener('click', () => void unbindMethod('password.unbind'));
el('auth-method-password-unbind')?.addEventListener('click', () => void unbindMethod('password.unbind'));
el('auth-method-totp-unbind')?.addEventListener('click', () => void unbindMethod('totp.unbind'));
el('auth-method-password-open')?.addEventListener('click', () => chooseManagementStep('password'));
el('auth-method-totp-open')?.addEventListener('click', () => chooseManagementStep('totp'));
async function savePassword() {
  if (signing) return;
  const body = { password: el('auth-new-password').value, purpose: accountState?.methods.password.bound ? 'replace' : 'initial',
    ...(accountState?.authenticator.enrolled ? { existingCode: el('auth-existing-code').value, recovery: el('auth-existing-recovery').checked === true } : {}),
    ...(resetProof ? { resetProof } : {}) };
  const matches = body.password === el('auth-new-password-confirm').value;
  clearPasswordInputs(); el('auth-existing-code').value = '';
  if (!moduleOpen || !accountClient || !freshManagement() || managementCapabilities !== true) { body.password = ''; passwordControls(); return; }
  if (!matches || body.password.length < 12 || new TextEncoder().encode(body.password).length > 1024) {
    body.password = ''; paint(el('auth-password-status'), msg('account.passwordMismatch')); return;
  }
  const lock = acquireWalletUi(); if (lock === null) { body.password = ''; return; }
  signing = true; passwordPending = true; const attempt = attemptRevision, revision = ++passwordRevision;
  const client = accountClient, binding = walletLogin.capture();
  clearEnrollment(); enrollmentControls(); paint(el('auth-password-status'), msg('account.passwordSaving'));
  let submitted = false;
  try {
    await walletLogin.check(); walletLogin.assert(binding);
    if (attempt !== attemptRevision || revision !== passwordRevision || !freshManagement()) throw new WalletLoginError('LOGIN_CANCELLED');
    const proof = await beginMethodChange(client, binding, attempt, `password.${body.purpose}`, { newPassword: body.password });
    body.password = ''; submitted = true; await finishMethodChange(client, binding, attempt, proof); walletLogin.assert(binding);
    if (attempt !== attemptRevision || revision !== passwordRevision) throw new WalletLoginError('LOGIN_CANCELLED');
    cancelLogin(); paint(el('wallet-login-status'), msg('account.passwordSaved'));
  } catch (error) {
    if (attempt !== attemptRevision || revision !== passwordRevision) return;
    // Only documented pre-commit refusals are safe to retry. Storage failures
    // can occur after the new credential reached disk; never replay those.
    const refused = error instanceof WalletLoginError && ['AUTH_REFUSED', 'AUTH_PASSWORD_INPUT_REFUSED', 'AUTH_RECENT_INDEPENDENT_LOGIN_REQUIRED',
      'AUTH_SETUP_STATE_CHANGED', 'AUTH_RATE_LIMITED', 'AUTH_BUSY', 'AUTH_PASSWORD_MANAGEMENT_UNAVAILABLE', 'AUTH_ROUTE_REFUSED', 'AUTH_CHANGE_REFUSED', 'AUTH_CHANGE_FLOW_REQUIRED', 'AUTH_CHANGE_INPUT_REFUSED'].includes(error.code);
    if (submitted && !refused) { cancelLogin(); paint(el('wallet-login-status'), msg('account.passwordSubmitted')); }
    else if (error instanceof WalletLoginError && ['AUTH_RECENT_INDEPENDENT_LOGIN_REQUIRED', 'AUTH_SETUP_STATE_CHANGED'].includes(error.code)) {
      cancelLogin(); paint(el('wallet-login-status'), msg(error.code === 'AUTH_RECENT_INDEPENDENT_LOGIN_REQUIRED' ? 'account.freshRequired' : 'account.statusFailed'));
    } else paint(el('auth-password-status'), error instanceof WalletLoginError ? error.code === 'AUTH_PASSWORD_MANAGEMENT_UNAVAILABLE' ? msg('account.passwordUpgrade') :
      error.code === 'AUTH_PASSWORD_INPUT_REFUSED' ? msg('account.passwordMismatch') : error.code : msg('account.passwordFailed'));
  } finally { body.password = ''; body.existingCode = ''; body.resetProof = ''; passwordPending = false; signing = false; releaseWalletUi(lock); enrollmentControls(); }
}
el('auth-password-save').addEventListener('click', savePassword);
el('auth-password-recovery-link').addEventListener('click', event => {
  event?.preventDefault?.();
  if (!moduleOpen || !freshManagement() || !accountState?.recovery?.configured) return;
  chooseManagementStep('recovery'); el('auth-recovery-settings').scrollIntoView?.({ block: 'start' }); el('auth-reset-answer').focus?.();
});
el('auth-password-cancel').addEventListener('click', () => {
  if (passwordPending) { cancelLogin(); paint(el('wallet-login-status'), msg('account.passwordSubmitted')); }
  else { clearPassword(); el('auth-existing-code').value = ''; void cancelRecovery(); paint(el('auth-password-status'), msg('account.passwordCancelled')); }
});
async function enroll(action) {
  if (action === 'start' && (managementCapabilities !== true || accountState?.methodChange?.available !== true)) { renderManagement(); return; }
  if (signing || !accountClient || !freshManagement() || (action === 'start' && enrollmentId) || (action === 'confirm' && !enrollmentId)) return;
  const lock = acquireWalletUi(); if (lock === null) return;
  signing = true; const currentAttempt = attemptRevision, revision = ++enrollmentRevision, client = accountClient;
  const pendingProof = enrollmentProof, code = el('auth-enroll-code').value;
  const purpose = accountState.authenticator.enrolled ? 'replace' : 'initial';
  el('auth-existing-code').value = ''; el('auth-enroll-code').value = '';
  if (action === 'confirm') hideEnrollmentSecret(); enrollmentControls();
  try {
    const binding = walletLogin.capture(); await walletLogin.check(); walletLogin.assert(binding);
    if (revision !== enrollmentRevision || currentAttempt !== attemptRevision) throw new WalletLoginError('LOGIN_CANCELLED');
    if (action === 'start') {
      const result = await beginMethodChange(client, binding, currentAttempt, `totp.${purpose}`);
      walletLogin.assert(binding);
      if (revision !== enrollmentRevision || currentAttempt !== attemptRevision) throw new WalletLoginError('LOGIN_CANCELLED');
      if (!Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now() || typeof result.changeProof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.changeProof)) throw new WalletLoginError('AUTH_SETUP_EXPIRED');
      clearEnrollment(); enrollmentId = result.changeProof; enrollmentProof = { changeProof: result.changeProof, action: result.action, expiresAt: result.expiresAt, newEmailRequired: false };
      resetProof = null; clearTimeout(recoveryTimer); recoveryTimer = null; paint(el('auth-recovery-verification-status'), '');
      paint(el('auth-enroll-secret'), msg('auth.setupSecret', { secret: result.secret, uri: result.uri, expires: new Date(result.expiresAt).toISOString() }));
      try { renderEnrollmentQr(el('auth-enroll-qr'), result.uri); el('auth-enroll-qr-help').hidden = false; }
      catch { clearEnrollmentQr(el('auth-enroll-qr')); }
      enrollmentTimer = setTimeout(() => { enrollmentRevision++; clearEnrollment(); }, Math.max(0, result.expiresAt - Date.now()));
    } else {
      const result = await finishMethodChange(client, binding, currentAttempt, pendingProof, code);
      walletLogin.assert(binding);
      if (revision !== enrollmentRevision || currentAttempt !== attemptRevision) throw new WalletLoginError('LOGIN_CANCELLED');
      cancelLogin(); moduleOpen = false; notifyAccountSettings(); renderManagement();
      paint(el('auth-recovery-codes'), result.recoveryCodes.join('\n')); el('auth-recovery-output').hidden = false;
    }
  } catch (error) {
    if (revision === enrollmentRevision && !(action === 'confirm' && error instanceof WalletLoginError && ['AUTH_REFUSED', 'AUTH_CHANGE_REFUSED'].includes(error.code))) clearEnrollment();
    if (revision === enrollmentRevision && currentAttempt === attemptRevision) paint(el('wallet-login-status'), error instanceof WalletLoginError ? error.code : 'AUTH_SETUP_UNAVAILABLE');
  } finally { signing = false; releaseWalletUi(lock); enrollmentControls(); }
}
function recoveryControls() {
  const usable = !signing && freshManagement() && accountState?.recovery?.emailOtpAvailable === true;
  el('auth-recovery-enroll').disabled = !usable || !!recoveryStep;
  el('auth-reset-start').hidden = true; el('auth-reset-start').disabled = true;
  el('auth-email-confirm').disabled = !usable || !recoveryStep;
  el('auth-email-code-fields').hidden = !recoveryStep;
  el('auth-email-cancel').hidden = !recoveryStep && !resetProof;
  el('auth-reserve-fields').hidden = false;
  passwordControls();
}
function clearRecovery() {
  clearTimeout(recoveryTimer); recoveryTimer = null; recoveryStep = null; resetProof = null;
  for (const id of ['auth-reset-answer', 'auth-reserved-answer', 'auth-reserved-email', 'auth-email-code']) el(id).value = '';
  paint(el('auth-recovery-verification-status'), ''); recoveryControls();
}
function renderRecovery() {
  const state = accountState?.recovery, verified = !!currentSession()?.serverId && !!state;
  el('auth-recovery-settings').hidden = !verified;
  el('auth-reset-reserved').hidden = true;
  paint(el('auth-recovery-state'), !verified ? '' : !state.emailOtpAvailable ? msg('recovery.unavailable') :
    state.configured ? msg('recovery.configured', { email: state.emailMasked }) : msg('recovery.notConfigured'));
  paint(el('auth-reserved-question'), verified && state.configured ? msg(`recovery.question.${state.questionId}`) : '');
  if (verified && accountState?.registration?.complete) el('auth-reserved-email').value = accountState.registration.email;
  el('auth-reserved-email').readOnly = !!accountState?.registration?.complete;
  recoveryControls();
}
async function cancelRecovery() {
  // Cancelling a proof-dependent operation also invalidates its enrollment generation.
  if (signing) { cancelLogin(); return; }
  recoveryRevision++; clearPassword(); clearRecovery();
  const client = accountClient, session = currentSession();
  if (client && session?.serverId) { try { await client.change('cancel'); } catch { /* Local private state is already cleared. */ } }
}
async function runRecovery(action) {
  if (signing || !accountClient || !freshManagement() || !accountState?.recovery?.emailOtpAvailable) return;
  if (action === 'confirm' && !recoveryStep) return;
  if (action !== 'confirm' && recoveryStep) return;
  const lock = acquireWalletUi(); if (lock === null) return;
  signing = true; enrollmentControls(); const attempt = attemptRevision, revision = ++recoveryRevision;
  const binding = walletLogin.capture(), client = accountClient;
  const pending = recoveryStep;
  const kind = action === 'confirm' ? pending.kind : action;
  const body = action === 'confirm' ? { challengeId: pending.challengeId, code: el('auth-email-code').value } :
    action === 'reset' ? { answer: el('auth-reset-answer').value } : {
      email: el('auth-reserved-email').value, questionId: el('auth-reserved-question-id').value,
      answer: el('auth-reserved-answer').value, existingCode: el('auth-existing-code').value,
      recovery: el('auth-existing-recovery').checked === true, ...(resetProof ? { resetProof } : {}),
    };
  for (const id of ['auth-email-code', 'auth-reset-answer', 'auth-reserved-answer', 'auth-existing-code']) el(id).value = '';
  if (action !== 'confirm') { if (action === 'reset') resetProof = null; clearEnrollment(); }
  try {
    await walletLogin.check(); walletLogin.assert(binding);
    if (attempt !== attemptRevision || revision !== recoveryRevision) throw new WalletLoginError('LOGIN_CANCELLED');
    if (action === 'enroll') {
      const proof = await beginMethodChange(client, binding, attempt, `recovery.${accountState.recovery.configured ? 'replace' : 'initial'}`,
        { email: body.email, questionId: body.questionId, answer: body.answer });
      body.answer = ''; await finishMethodChange(client, binding, attempt, proof);
      cancelLogin(); paint(el('wallet-login-status'), msg('recovery.saved')); return;
    }
    const result = await client.recovery(`${kind}/${action === 'confirm' ? 'confirm' : 'start'}`, body);
    walletLogin.assert(binding);
    if (attempt !== attemptRevision || revision !== recoveryRevision) throw new WalletLoginError('LOGIN_CANCELLED');
    if (action === 'confirm' && kind === 'enroll') {
      cancelLogin(); paint(el('wallet-login-status'), msg('recovery.saved'));
    } else {
      if (!Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) throw new WalletLoginError('AUTH_SETUP_EXPIRED');
      clearTimeout(recoveryTimer);
      if (action === 'confirm') {
        if (typeof result.resetProof !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.resetProof)) throw new WalletLoginError('LOGIN_SERVER_RESPONSE_REFUSED');
        recoveryStep = null; resetProof = result.resetProof; paint(el('auth-recovery-verification-status'), msg('recovery.proofReady'));
      } else {
        if (typeof result.challengeId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.challengeId) || result.digits !== 8 || typeof result.emailMasked !== 'string') throw new WalletLoginError('LOGIN_SERVER_RESPONSE_REFUSED');
        resetProof = null; recoveryStep = { kind, challengeId: result.challengeId, expiresAt: result.expiresAt };
        paint(el('auth-recovery-verification-status'), msg('recovery.sent', { email: result.emailMasked, expires: new Date(result.expiresAt).toISOString() }));
      }
      recoveryTimer = setTimeout(() => { recoveryRevision++; clearPassword(); clearRecovery(); paint(el('auth-recovery-verification-status'), msg('recovery.expired')); }, Math.max(0, result.expiresAt - Date.now()));
    }
  } catch (error) {
    if (attempt === attemptRevision && revision === recoveryRevision) paint(el('auth-recovery-verification-status'), error instanceof WalletLoginError ? error.code === 'AUTH_RATE_LIMITED' ? msg('recovery.rateLimited') : error.code : 'AUTH_RECOVERY_UNAVAILABLE');
  } finally { body.answer = ''; body.code = ''; body.existingCode = ''; body.resetProof = ''; signing = false; releaseWalletUi(lock); enrollmentControls(); }
}
el('auth-recovery-enroll').addEventListener('click', () => runRecovery('enroll'));
el('auth-reset-start').addEventListener('click', () => runRecovery('reset'));
el('auth-email-confirm').addEventListener('click', () => runRecovery('confirm'));
el('auth-email-cancel').addEventListener('click', cancelRecovery);
function registrationControls() {
  el('auth-registration-start').disabled = signing || !!registrationStep || !!registrationProof;
  el('auth-registration-verify').disabled = signing || !registrationStep;
  el('auth-registration-finish').disabled = signing || !registrationProof;
  el('auth-registration-email').readOnly = !!registrationStep || !!registrationProof;
  el('auth-registration-code-fields').hidden = !registrationStep;
  el('auth-registration-wallet-fields').hidden = !registrationProof;
  const migrationAllowed = !signing && freshManagement() && accountState?.registration?.emailOtpAvailable === true;
  el('auth-registration-account-start').disabled = !migrationAllowed || !!migrationStep;
  el('auth-registration-account-confirm').disabled = !migrationAllowed || !migrationStep;
  el('auth-registration-account-cancel').hidden = !migrationStep;
  el('auth-registration-account-code-fields').hidden = !migrationStep;
  el('auth-registration-account-email').readOnly = !!migrationStep;
}
function clearSignup(hide = false) {
  clearTimeout(registrationTimer); registrationTimer = null; registrationStep = null; registrationProof = null;
  for (const id of ['auth-registration-email', 'auth-registration-code', 'auth-registration-password', 'auth-registration-password-confirm']) el(id).value = '';
  paint(el('auth-registration-status'), ''); if (hide) registrationOpen = false;
  el('auth-registration').hidden = !registrationOpen; registrationControls();
}
function clearMigration() {
  clearTimeout(migrationTimer); migrationTimer = null; migrationStep = null;
  for (const id of ['auth-registration-account-email', 'auth-registration-account-code']) el(id).value = '';
  paint(el('auth-registration-account-status'), ''); registrationControls();
}
function renderRegistration() {
  el('auth-registration').hidden = !registrationOpen;
  el('auth-registration-open').hidden = true; // Routed entry trigger; never a duplicate visible action.
  el('auth-registration-open').setAttribute?.('aria-expanded', String(registrationOpen));
  const state = accountState?.registration, visible = !!currentSession()?.serverId && !!state;
  el('auth-registration-account').hidden = !visible;
  el('auth-registration-change-help').hidden = true;
  paint(el('auth-registration-change-help'), msg(state?.complete ? 'registration.changeHelp' : 'registration.migrationProof'));
  paint(el('auth-registration-account-state'), !visible ? '' : state.complete ? msg('registration.current', { email: state.emailMasked }) : msg('registration.required'));
  if (visible && !state.emailOtpAvailable) paint(el('auth-registration-account-status'), msg('recovery.unavailable'));
  registrationControls();
}
function closeRegistration({ navigate = true } = {}) {
  const client = signupClient; signupClient = null;
  cancelLogin(); registrationOpen = false; renderRegistration();
  if (client) {
    const attempt = attemptRevision;
    void client.cancelRegistration().then(result => {
      if (attempt === attemptRevision && !currentSession() && (result?.confirmationInProgress || result?.unconfirmed)) paint(el('wallet-login-status'), msg('registration.checkSubmitted'));
    });
  }
  el('auth-registration-open').focus?.();
  // Navigation may leave immediately; the in-flight operation still owns its lock
  // until its original finally and any submitted registration still needs reconciliation.
  if (navigate) document.dispatchEvent?.(new CustomEvent('wallet:authentication-closed'));
}
el('auth-registration-open').addEventListener('click', () => {
  cancelLogin(); moduleOpen = false; notifyAccountSettings(); registrationOpen = true; signupClient = null; renderManagement();
  el('auth-registration-title').focus?.();
});
el('auth-registration-close').addEventListener('click', () => closeRegistration());
function challengeMetadata(result) {
  if (typeof result.challengeId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.challengeId) || result.digits !== 8 || typeof result.emailMasked !== 'string' ||
    !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) throw new WalletLoginError('LOGIN_SERVER_RESPONSE_REFUSED');
  return { challengeId: result.challengeId, expiresAt: result.expiresAt };
}
async function runSignup(action) {
  if (signing || !registrationOpen || (action === 'verify' && !registrationStep) || (action === 'finish' && !registrationProof)) return;
  if (action === 'start' && (registrationStep || registrationProof)) return;
  const password = el('auth-registration-password').value, confirmation = el('auth-registration-password-confirm').value;
  if (action === 'finish' && ((password || confirmation) && (password !== confirmation || password.length < 12 || new TextEncoder().encode(password).length > 1024))) {
    paint(el('auth-registration-status'), msg('registration.passwordMismatch')); return;
  }
  const lock = acquireWalletUi(); if (lock === null) return;
  signing = true; enrollmentControls(); const revision = ++registrationRevision, attempt = attemptRevision;
  const email = el('auth-registration-email').value, step = registrationStep, proof = registrationProof;
  const code = el('auth-registration-code').value;
  el('auth-registration-code').value = ''; el('auth-registration-password').value = ''; el('auth-registration-password-confirm').value = '';
  try {
    if (action === 'start') {
      const profile = await getReleaseProfile();
      if (revision !== registrationRevision || attempt !== attemptRevision) throw new WalletLoginError('LOGIN_CANCELLED');
      const client = new AccountAuthClient({ ...tenantClientOptions(profile), tenant: profile.tenant.id }); signupClient = client;
      const result = await client.registrationStart(email);
      if (client !== signupClient || revision !== registrationRevision || attempt !== attemptRevision) throw new WalletLoginError('LOGIN_CANCELLED');
      registrationStep = challengeMetadata(result);
      paint(el('auth-registration-status'), msg('registration.codeSent', { email: result.emailMasked, expires: new Date(result.expiresAt).toISOString() }));
      registrationTimer = setTimeout(() => {
        if (signupClient !== client) return;
        signupClient = null; registrationRevision++;
        const submissionPossible = signupAuthenticating;
        if (submissionPossible) cancelLogin();
        clearSignup(); registrationOpen = true; renderRegistration();
        // Expiry cannot undo an account already being persisted. Stay conservative
        // until cancellation is confirmed, and never revive a replaced UI attempt.
        const expiredRevision = registrationRevision, expiredAttempt = attemptRevision;
        paint(el('auth-registration-status'), msg('registration.checkSubmitted'));
        void client.cancelRegistration().then(result => {
          if (expiredRevision !== registrationRevision || expiredAttempt !== attemptRevision || !registrationOpen || signupClient || currentSession()) return;
          const uncertain = submissionPossible || result?.confirmationInProgress || result?.unconfirmed || result?.cancelled !== true;
          paint(el('auth-registration-status'), msg(uncertain ? 'registration.checkSubmitted' : 'registration.expired'));
        });
      }, Math.max(0, result.expiresAt - Date.now()));
    } else if (action === 'verify') {
      const result = await signupClient.registrationVerify(step.challengeId, code);
      if (revision !== registrationRevision || attempt !== attemptRevision) throw new WalletLoginError('LOGIN_CANCELLED');
      if (result.verified !== true || typeof result.registrationId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(result.registrationId) || !Number.isSafeInteger(result.expiresAt) || result.expiresAt <= Date.now()) throw new WalletLoginError('LOGIN_SERVER_RESPONSE_REFUSED');
      registrationStep = null; registrationProof = { id: result.registrationId, expiresAt: result.expiresAt };
      paint(el('auth-registration-status'), msg('registration.verified'));
    } else {
      const client = signupClient, credentials = { password };
      signupAuthenticating = true; accountClient = client;
      await walletLogin.signIn(globalThis.ethereum, client.registrationAdapter(proof.id, credentials));
      if (revision !== registrationRevision || attempt !== attemptRevision) throw new WalletLoginError('LOGIN_CANCELLED');
      await loadAccount(); walletLogin.assert();
      signupClient = null; registrationOpen = false; moduleOpen = true; managementStep = null; el('auth-username').value = email; el('wallet-login-method').value = 'wallet';
      renderLoginMethod(); renderManagement(); notifyAccountSettings(); paint(el('wallet-login-status'), msg('registration.complete'));
      document.dispatchEvent?.(new CustomEvent('wallet:authentication-method'));
      document.dispatchEvent?.(new CustomEvent('wallet:authentication-settings'));
    }
  } catch (error) {
    if (attempt === attemptRevision && (revision === registrationRevision || (action === 'finish' && error instanceof WalletLoginError && !/CANCELLED|ACCOUNT|CHAIN|DISCONNECTED|SESSION_CHANGED/.test(error.code)))) {
      if (action === 'finish') { clearSignup(); registrationOpen = true; el('auth-registration-email').value = email; renderRegistration(); }
      const code = error instanceof WalletLoginError ? error.code : 'AUTH_REGISTRATION_UNAVAILABLE';
      // A failed finish response does not prove account creation was rolled back.
      const status = action === 'finish' ? msg('registration.checkSubmitted')
        : code === 'AUTH_RATE_LIMITED' ? msg('recovery.rateLimited')
        : code === 'AUTH_EMAIL_UNAVAILABLE' ? msg('registration.emailUnavailable')
        : code === 'AUTH_REFUSED' ? msg('registration.verificationRefused')
        : msg('registration.unavailable');
      paint(el('auth-registration-status'), status);
    }
  } finally { signupAuthenticating = false; signing = false; releaseWalletUi(lock); enrollmentControls(); }
}
el('auth-registration-start').addEventListener('click', () => runSignup('start'));
el('auth-registration-verify').addEventListener('click', () => runSignup('verify'));
el('auth-registration-finish').addEventListener('click', () => runSignup('finish'));
async function cancelMigration() {
  if (signing) { cancelLogin(); return; }
  migrationRevision++; clearMigration();
  if (accountClient && currentSession()?.serverId) { try { await accountClient.change('cancel'); } catch { /* Already locally cleared. */ } }
}
async function runMigration(action) {
  if (action !== 'start' || signing || !accountClient || !freshManagement() || !accountState?.registration?.emailOtpAvailable) return;
  const lock = acquireWalletUi(); if (lock === null) return;
  signing = true; enrollmentControls(); const revision = ++migrationRevision, attempt = attemptRevision, binding = walletLogin.capture(), client = accountClient;
  try {
    await walletLogin.check(); walletLogin.assert(binding);
    if (revision !== migrationRevision || attempt !== attemptRevision) throw new WalletLoginError('LOGIN_CANCELLED');
    const proof = await beginMethodChange(client, binding, attempt, `email.${accountState.registration.complete ? 'replace' : 'initial'}`, { email: el('auth-registration-account-email').value });
    await finishMethodChange(client, binding, attempt, proof);
    cancelLogin(); paint(el('wallet-login-status'), msg('registration.migrateDone'));
  } catch (error) {
    if (revision === migrationRevision && attempt === attemptRevision) paint(el('auth-registration-account-status'), error instanceof WalletLoginError ? error.code : 'AUTH_REGISTRATION_UNAVAILABLE');
  } finally { signing = false; releaseWalletUi(lock); enrollmentControls(); }
}
el('auth-registration-account-start').addEventListener('click', () => runMigration('start'));
el('auth-registration-account-confirm').addEventListener('click', () => runMigration('confirm'));
el('auth-registration-account-cancel').addEventListener('click', cancelMigration);
el('auth-methods-save').addEventListener('click', async () => {
  if (signing || !accountClient || !freshManagement()) return;
  const lock = acquireWalletUi(); if (lock === null) return;
  signing = true; enrollmentControls(); const revision = attemptRevision, binding = walletLogin.capture(), client = accountClient;
  const enabledMethods = methods.filter(method => el(`auth-enable-${method}`).checked);
  const existingCode = el('auth-existing-code').value, recovery = el('auth-existing-recovery').checked === true;
  el('auth-existing-code').value = ''; clearEnrollment();
  try {
    await walletLogin.check(); walletLogin.assert(binding);
    if (revision !== attemptRevision) throw new WalletLoginError('LOGIN_CANCELLED');
    const proof = await beginMethodChange(client, binding, revision, 'methods', { enabledMethods });
    await finishMethodChange(client, binding, revision, proof);
    walletLogin.assert(binding); if (revision !== attemptRevision) throw new WalletLoginError('LOGIN_CANCELLED');
    cancelLogin(); paint(el('wallet-login-status'), msg('account.methodsSaved'));
  } catch (error) {
    if (revision === attemptRevision) paint(el('auth-management-status'), error instanceof WalletLoginError ? error.code : 'AUTH_MANAGEMENT_UNAVAILABLE');
  } finally { signing = false; releaseWalletUi(lock); enrollmentControls(); }
});
el('auth-enroll-start').addEventListener('click', () => enroll('start'));
el('auth-enroll-confirm').addEventListener('click', () => enroll('confirm'));
el('auth-enroll-cancel').addEventListener('click', () => cancelSetup());
el('auth-recovery-dismiss').addEventListener('click', () => { paint(el('auth-recovery-codes'), ''); el('auth-recovery-output').hidden = true; });
renderLoginMethod(); renderManagement();

/** Fixed fragment opens a local panel only; it is not login or change authority. */
getReleaseProfile().then(profile => {
  managementProfile = isPlatformPasswordProfile(profile) ? 'platform' : 'local';
  platformRelease = managementProfile === 'platform';
  releaseManagementContext = profile.tenant.label;
  if (managementProfile === 'platform') {
    const localOption = el('wallet-login-method').querySelector('option[value="wallet-local"]');
    if (localOption) { localOption.disabled = true; localOption.hidden = true; }
    if (el('wallet-login-method').value === 'wallet-local') el('wallet-login-method').value = 'wallet';
    el('auth-username').readOnly = true;
    renderLoginMethod();
  }
  managementContext = profile.tenant.label;
  renderManagement();
  if (managementProfile !== 'local') return;
  const action = passwordPanelAction(profile, globalThis.location);
  if (!action) return;
  globalThis.history.replaceState(globalThis.history.state, '', profile.deployment.url);
  return openManagement({ initial: action === 'initial' });
}).catch(() => { /* Invalid location/config stays closed. */ });
// Editing intent invalidates any in-flight proof, without querying membership.
el('password-tenant-select').addEventListener('input', () => {
  if (platformRelease) {
    cancelLogin();
    el('auth-username').value = loginIdentifier(el('password-tenant-select').value) ?? '';
  }
});

/** Same-origin account login client. Passwords/codes are never persisted. */
import { WalletLoginError } from './login-core.mjs';
import { forwardProgressRequest, validateForwardProgress } from './forward-progress-client.mjs';
const policyActions = new Set(['status', 'prepare', 'verify', 'confirm', 'cancel']);
const policyRoute = path => /^account\/task-verification\/(?:status|prepare|verify|confirm|cancel)$/.test(path);
function policyRequestBody(action, input) {
  const refuse = () => { throw new WalletLoginError('TASK_VERIFICATION_INPUT_REFUSED'); };
  if (!input || typeof input !== 'object' || Array.isArray(input) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(input))) refuse();
  const properties = Object.getOwnPropertyDescriptors(input), keys = Reflect.ownKeys(properties);
  if (keys.some(key => typeof key !== 'string' || !Object.hasOwn(properties[key], 'value') || !properties[key].enumerable)) refuse();
  const exact = expected => keys.length === expected.length && expected.every(key => Object.hasOwn(properties, key));
  const value = key => properties[key]?.value;
  const string = key => typeof value(key) === 'string' && value(key).length > 0;
  if (action === 'status' || action === 'cancel') {
    if (!(action === 'status' && (exact([]) || exact(['protocol']) && value('protocol') === '8415-task-policy-change-wire/1')) &&
      (!exact(['protocol', 'changeId', 'changeDigest', 'expectedRevision']) ||
        value('protocol') !== '8415-task-policy-change-wire/1' ||
        typeof value('changeId') !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value('changeId')) ||
        typeof value('changeDigest') !== 'string' || !/^[a-f0-9]{64}$/.test(value('changeDigest')) ||
        typeof value('expectedRevision') !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value('expectedRevision')) ||
        BigInt(value('expectedRevision')) >= (1n << 256n))) refuse();
  }
  else if (action === 'prepare') {
    if (!(exact(['expectedRevision', 'identityMethod', 'mode']) ||
      exact(['expectedRevision', 'identityMethod', 'mode', 'protocol']) && value('protocol') === '8415-task-policy-change-wire/1') ||
      typeof value('expectedRevision') !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value('expectedRevision')) ||
      BigInt(value('expectedRevision')) >= (1n << 256n) || !['password', 'wallet'].includes(value('identityMethod')) ||
      !['ON', 'OFF'].includes(value('mode'))) refuse();
  } else if (action === 'verify') {
    if ((!exact(['changeId', 'changeDigest', 'password']) && !exact(['changeId', 'changeDigest', 'signature'])) ||
      !string('changeId') || !string('changeDigest') || !(string('password') || string('signature'))) refuse();
  } else if (action === 'confirm') {
    if (!exact(['changeId', 'changeDigest', 'code']) || !string('changeId') || !string('changeDigest') ||
      typeof value('code') !== 'string' || !/^\d{8}$/.test(value('code'))) refuse();
  }
  return Object.fromEntries(keys.map(key => [key, properties[key].value]));
}
export class AccountAuthClient {
  #tenant; #fetch; #csrf = null; #session = null; #origin; #registrationEpoch = 0; #capabilities = null; #taskPolicyChange = null; #policyEpoch = 0;
  constructor({ tenant, origin = globalThis.location.origin, fetcher = globalThis.fetch.bind(globalThis) }) { this.#tenant = tenant; this.#fetch = fetcher; this.#origin = origin; }
  async request(path, body, { keepalive = false, signal } = {}) {
    const response = await this.#fetch(new URL(`/auth/${path}`, this.#origin), { method: body === undefined ? 'GET' : 'POST', credentials: 'same-origin', cache: 'no-store', keepalive, ...(signal === undefined ? {} : { signal }),
      headers: { 'X-Wallet-Tenant': this.#tenant, ...(this.#csrf ? { 'X-Wallet-CSRF': this.#csrf } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }) });
    const text = await response.text(); if (text.length > (path.startsWith('tasks/') ? 4194304 : 16384)) throw new WalletLoginError('LOGIN_SERVER_RESPONSE_REFUSED');
    let result; try { result = JSON.parse(text); } catch { throw new WalletLoginError('LOGIN_SERVICE_UNAVAILABLE'); }
    if (!response.ok) {
      const errorPattern = path.startsWith('tasks/') ? /^(AUTH|TASK)_[A-Z_]+$/ :
        path === 'assets/forward-progress' ? /^(AUTH|FORWARD_PROGRESS)_[A-Z_]+$/ :
        policyRoute(path) ? /^(?:AUTH_[A-Z_]+|TASK_VERIFICATION_[A-Z_]+)$/ : /^AUTH_[A-Z_]+$/;
      const error = new WalletLoginError(typeof result?.error === 'string' && errorPattern.test(result.error) ? result.error : 'LOGIN_SERVICE_UNAVAILABLE');
      // Account-policy routes expose failure status, never task retry metadata.
      if (policyRoute(path) && Number.isInteger(response.status)) error.status = response.status;
      // Scheduling metadata is never authority. Only the authenticated task-route
      // limiter's explicit 429 response may delay automatic continuation.
      if (path.startsWith('tasks/') && response.status === 429 && error.code === 'AUTH_RATE_LIMITED') {
        const header = response.headers?.get?.('Retry-After');
        const seconds = typeof header === 'string' && /^[1-9][0-9]{0,2}$/.test(header) ? Number(header) : result.retryAfterSeconds;
        if (Number.isSafeInteger(seconds) && seconds >= 1 && seconds <= 900) {
          error.status = 429; error.retryAfterMs = seconds * 1000;
        }
      }
      throw error;
    }
    return result;
  }
  async capabilities() {
    const value = await this.request('capabilities');
    if (value.schema !== '8415wallet-auth/1' || value.tenant !== this.#tenant || value.origin !== this.#origin) throw new WalletLoginError('LOGIN_SERVICE_BINDING_REFUSED');
    this.#capabilities = value; return value;
  }
  get supportsMethodManagement() { return this.#capabilities?.methodManagement === "combined-v1"; }
  get supportsPasswordManagement() { return this.#capabilities?.passwordManagement === true; }
  async registrationStart(email) {
    const epoch = ++this.#registrationEpoch;
    const current = () => { if (epoch !== this.#registrationEpoch) throw new WalletLoginError('LOGIN_CANCELLED'); };
    const capabilities = await this.capabilities(); current();
    if (capabilities.registration?.available === false) throw new WalletLoginError('AUTH_EMAIL_UNAVAILABLE');
    const bootstrap = await this.request('bootstrap'); this.#csrf = bootstrap.csrf;
    if (epoch !== this.#registrationEpoch) { await this.cancelRegistration(); throw new WalletLoginError('LOGIN_CANCELLED'); }
    const result = await this.request('registration/start', { email }); current(); return result;
  }
  async registrationVerify(challengeId, code) { return this.request('registration/verify', { challengeId, code }); }
  async cancelRegistration() {
    this.#registrationEpoch++;
    if (this.#csrf) { try { return await this.request('registration/cancel', {}); } catch { return { cancelled: false, unconfirmed: true }; } }
    return { cancelled: true };
  }
  async registrationEmail(action, body = {}) {
    if (!['start', 'confirm', 'cancel'].includes(action)) throw new WalletLoginError('AUTH_ROUTE_REFUSED');
    return this.request(`registration/email/${action}`, body);
  }
  registrationAdapter(registrationId, credentials = {}) {
    return {
      authenticate: async (identity, provider) => {
        this.#policyEpoch++; this.#taskPolicyChange = null;
        const epoch = this.#registrationEpoch;
        const current = () => { if (epoch !== this.#registrationEpoch) throw new WalletLoginError('LOGIN_CANCELLED'); };
        try {
          const challenge = await this.request('registration/challenge', { registrationId, ...identity }); current();
          if (challenge.tenant !== this.#tenant || challenge.origin !== this.#origin || challenge.account !== identity.account ||
            challenge.chainId !== identity.chainId || challenge.method !== 'wallet' || typeof challenge.message !== 'string' ||
            !challenge.message.includes('urn:8415wallet:purpose:registration')) throw new WalletLoginError('LOGIN_CHALLENGE_BINDING_REFUSED');
          const encoded = `0x${Array.from(new TextEncoder().encode(challenge.message), b => b.toString(16).padStart(2, '0')).join('')}`;
          const signature = await provider.request({ method: 'personal_sign', params: [encoded, identity.account] }); current();
          const result = await this.request('registration/confirm', { registrationId, id: challenge.id, ...identity, signature,
            ...(credentials.password ? { password: credentials.password } : {}) }); current();
          const session = result.session;
          if (result.registered !== true || !session || session.tenant !== this.#tenant || session.origin !== this.#origin ||
            session.account !== identity.account || session.chainId !== identity.chainId || session.kind !== 'wallet') throw new WalletLoginError('LOGIN_SERVICE_BINDING_REFUSED');
          this.#csrf = session.csrf; this.#session = session; return session;
        } finally { credentials.password = ''; }
      },
      check: async () => this.request('session'),
      logout: async () => this.logout(),
    };
  }
  adapter(method, credentials = {}, caBridge = globalThis.walletCaBridge) {
    return {
      authenticate: async (identity, provider) => {
        this.#policyEpoch++; this.#taskPolicyChange = null;
        const available = await this.capabilities();
        if (!available.methods.includes(method)) throw new WalletLoginError('LOGIN_METHOD_UNAVAILABLE');
        const bootstrap = await this.request('bootstrap'); this.#csrf = bootstrap.csrf;
        let session;
        if (['password', 'totp'].includes(method)) {
          try { session = await this.request(method, { ...credentials, ...identity }); }
          finally { credentials.password = ''; credentials.code = ''; }
        }
        else {
          const challenge = await this.request('challenge', { ...identity, method });
          if (challenge.tenant !== this.#tenant || challenge.origin !== this.#origin || challenge.account !== identity.account || challenge.chainId !== identity.chainId || challenge.method !== method)
            throw new WalletLoginError('LOGIN_CHALLENGE_BINDING_REFUSED');
          let proof;
          if (method === 'wallet') {
            const encoded = `0x${Array.from(new TextEncoder().encode(challenge.message), b => b.toString(16).padStart(2, '0')).join('')}`;
            proof = { signature: await provider.request({ method: 'personal_sign', params: [encoded, identity.account] }) };
          } else {
            if (caBridge?.version !== '8415wallet-ca/1' || typeof caBridge.signChallenge !== 'function') throw new WalletLoginError('LOGIN_CA_BRIDGE_REQUIRED');
            // The bridge must display the full challenge, get local user consent,
            // and sign UTF-8 bytes using a non-exportable hardware-held key.
            const signed = await caBridge.signChallenge(Object.freeze({ ...challenge }));
            proof = { signature: signed.signature, certificateChain: signed.certificateChain, algorithm: signed.algorithm };
          }
          session = await this.request('proof', { ...identity, id: challenge.id, ...proof });
        }
        if (session.tenant !== this.#tenant || session.origin !== this.#origin) throw new WalletLoginError('LOGIN_SERVICE_BINDING_REFUSED');
        this.#csrf = session.csrf; this.#session = session; return session;
      },
      check: async () => this.request('session'),
      logout: async () => this.logout(),
    };
  }
  async logout() {
    this.#registrationEpoch++; this.#policyEpoch++; this.#taskPolicyChange = null;
    if (!this.#csrf) return;
    try { await this.request('logout', {}, { keepalive: true }); } finally { this.#csrf = null; this.#session = null; }
  }
  async account() {
    if (!this.#session) throw new WalletLoginError('LOGIN_REQUIRED');
    const value = await this.request('account');
    if (value.schema !== '8415wallet-account/1' || value.tenant !== this.#tenant || value.origin !== this.#origin ||
      value.username !== this.#session.username || value.account !== this.#session.account || value.chainId !== this.#session.chainId ||
      !['password', 'wallet', 'ca', 'totp'].every(method => typeof value.methods?.[method]?.enabled === 'boolean' && typeof value.methods?.[method]?.bound === 'boolean') ||
      typeof value.authenticator?.enrolled !== 'boolean' || typeof value.management?.freshIndependentLogin !== 'boolean' ||
      typeof value.management?.existingCodeRequired !== 'boolean' ||
      !(value.management.reauthenticateBy === null || Number.isSafeInteger(value.management.reauthenticateBy)) ||
      !value.registration || typeof value.registration.required !== 'boolean' || typeof value.registration.complete !== 'boolean' ||
      value.registration.required === value.registration.complete || typeof value.registration.emailOtpAvailable !== 'boolean' ||
      (value.registration.complete && (typeof value.registration.email !== 'string' || typeof value.registration.emailMasked !== 'string')) ||
      (!value.registration.complete && (value.registration.email !== null || value.registration.emailMasked !== null)) ||
      !value.recovery || typeof value.recovery.configured !== 'boolean' || typeof value.recovery.emailOtpAvailable !== 'boolean' ||
      (value.recovery.configured && (typeof value.recovery.emailMasked !== 'string' || !['recovery-phrase', 'first-school', 'childhood-place'].includes(value.recovery.questionId))) ||
      value.authenticator.enrolled !== value.methods.totp.bound || value.management.existingCodeRequired !== value.authenticator.enrolled)
      throw new WalletLoginError('LOGIN_SERVICE_BINDING_REFUSED');
    return value;
  }
  async readForwardProgress(input) {
    const session = this.#session;
    if (!session || !this.#csrf) throw new WalletLoginError('LOGIN_REQUIRED');
    let body;
    try { body = forwardProgressRequest(input, session.chainId); }
    catch { throw new WalletLoginError('FORWARD_PROGRESS_REQUEST_REFUSED'); }
    const result = await this.request('assets/forward-progress', body);
    if (this.#session !== session) throw new WalletLoginError('LOGIN_CANCELLED');
    try { return validateForwardProgress(result, body); }
    catch { throw new WalletLoginError('FORWARD_PROGRESS_RESPONSE_REFUSED'); }
  }
  async change(action, body = {}) {
    if (!this.#session) throw new WalletLoginError('LOGIN_REQUIRED');
    if (!['start', 'verify', 'confirm', 'commit', 'cancel'].includes(action)) throw new WalletLoginError('AUTH_ROUTE_REFUSED');
    return this.request(`account/change/${action}`, body);
  }
  /** Source-bound owner-policy transport. Retains the selected candidate's
   * scope, revision, factor and prepare/confirm binding checks. The UI bridge
   * additionally validates exact response keys and canonical challenge bytes.
   * No default mode, retired /on action, activation switch or automatic retry. */
  async taskVerification(action, body = {}, { signal } = {}) {
    if (!policyActions.has(action)) throw new WalletLoginError('AUTH_ROUTE_REFUSED');
    const session = this.#session, epoch = this.#policyEpoch;
    const current = () => {
      if (!session || !this.#csrf) throw new WalletLoginError('LOGIN_REQUIRED');
      if (session !== this.#session || epoch !== this.#policyEpoch) throw new WalletLoginError('LOGIN_SESSION_CHANGED');
      if (signal?.aborted) throw new WalletLoginError('LOGIN_CANCELLED');
      if (session.origin !== this.#origin || session.tenant !== this.#tenant) throw new WalletLoginError('LOGIN_SERVICE_BINDING_REFUSED');
    };
    current(); body = policyRequestBody(action, body);
    try {
      if (['verify', 'confirm'].includes(action) && (this.#taskPolicyChange?.session !== session ||
        this.#taskPolicyChange.request.changeId !== body.changeId || this.#taskPolicyChange.changeDigest !== body.changeDigest))
        throw new WalletLoginError('LOGIN_SERVICE_BINDING_REFUSED');
      const result = await this.request(`account/task-verification/${action}`, body, { signal });
      current();
      if (!result || typeof result !== 'object' || Array.isArray(result)) throw new WalletLoginError('LOGIN_SERVICE_BINDING_REFUSED');
      const boundScope = value => value && value.origin === this.#origin && value.tenant === this.#tenant &&
        value.username === session.username && value.account === session.account.toLowerCase() && value.chainId === session.chainId &&
        typeof value.agentId === 'string' && /^[A-Za-z0-9][A-Za-z0-9:._/-]{0,159}$/.test(value.agentId);
      const version = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < (1n << 256n);
      const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
      const hash = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
      let valid;
      if (action === 'cancel') valid = result.changeProtocol === '8415-task-policy-change-wire/1' &&
        typeof result.cancelled === 'boolean' && result.reconciliation?.changeId === body.changeId &&
        result.reconciliation?.changeDigest === body.changeDigest && result.reconciliation?.expectedRevision === body.expectedRevision &&
        result.reconciliation?.automaticRetryAllowed === false;
      else if (['status', 'confirm'].includes(action)) {
        valid = ['8415-task-human-verification/1', '8415-task-human-verification/2'].includes(result.schema) && boundScope(result.scope) &&
          ['ON', 'OFF'].includes(result.mode) && version(result.revision) && Number.isSafeInteger(result.changeCount) && result.changeCount >= 0 &&
          result.label === 'Per-operation human verification' && result.appliesTo === 'still-valid-in-scope-authorizations' && result.grantsAuthority === false &&
          (result.changeCount === 0 ? result.revision === '0' && result.mode === 'ON' && result.lastChange === null :
            result.lastChange?.revision === result.revision && result.lastChange?.mode === result.mode && hash(result.lastChange?.changeDigest));
      } else if (action === 'prepare') {
        const request = result.request;
        valid = request?.schema === '8415-task-human-verification-change/2' && boundScope(request.scope) && ['ON', 'OFF'].includes(body.mode) && request.mode === body.mode &&
          request.expectedRevision === body.expectedRevision && version(request.expectedRevision) && Number.isSafeInteger(request.credentialRevision) &&
          request.credentialRevision >= 0 && token(request.changeId) && token(request.nonce) && hash(result.changeDigest) &&
          Number.isSafeInteger(request.issuedAt) && Number.isSafeInteger(request.expiresAt) && request.expiresAt > request.issuedAt &&
          request.expiresAt - request.issuedAt <= 5 * 60000 && result.identityMethod === body.identityMethod &&
          typeof result.emailMasked === 'string' && (result.identityMethod !== 'wallet' || typeof result.message === 'string' &&
            result.message.includes(`Per-operation human verification ${request.mode}`) && result.message.includes(`Digest: ${result.changeDigest}`) && result.message.includes(`Scope: ${JSON.stringify(request.scope)}`) &&
            result.message.includes(`Change: ${request.changeId}`) && result.message.includes(`Nonce: ${request.nonce}`) &&
            result.message.includes('Purpose: policy change only; no login, recovery, or transaction signature.'));
      } else {
        valid = result.changeId === body.changeId && result.changeDigest === body.changeDigest && result.digits === 8 &&
          typeof result.emailMasked === 'string' && Number.isSafeInteger(result.expiresAt);
      }
      if (valid && ['status', 'confirm'].includes(action) && result.schema === '8415-task-human-verification/2') {
        valid = version(result.enforcedFromRevision) && BigInt(result.enforcedFromRevision) > 0n &&
          BigInt(result.enforcedFromRevision) <= BigInt(result.revision) &&
          result.lastChange?.verifiedFactors?.length === 2 &&
          ['password', 'wallet'].includes(result.lastChange.verifiedFactors[0]) &&
          result.lastChange.verifiedFactors[1] === 'verified-email';
      }
      if (valid && action === 'confirm') {
        const pending = this.#taskPolicyChange;
        valid = pending?.session === session && body.changeId === pending.request.changeId &&
          body.changeDigest === pending.changeDigest && JSON.stringify(result.scope) === JSON.stringify(pending.request.scope) && result.mode === pending.request.mode &&
          result.revision === (BigInt(pending.request.expectedRevision) + 1n).toString();
      }
      if (valid && action === 'status' && body.changeId) valid = result.changeProtocol === body.protocol &&
        result.reconciliation?.changeId === body.changeId && result.reconciliation?.changeDigest === body.changeDigest &&
        result.reconciliation?.expectedRevision === body.expectedRevision && result.reconciliation?.automaticRetryAllowed === false;
      if (valid && ['status', 'prepare'].includes(action) && body.protocol)
        valid = result.changeProtocol === body.protocol;
      if (valid && action === 'prepare') this.#taskPolicyChange = { session, request: result.request, changeDigest: result.changeDigest };
      if (valid && action === 'cancel' && result.cancelled &&
          this.#taskPolicyChange?.request.changeId === body.changeId && this.#taskPolicyChange?.changeDigest === body.changeDigest ||
          valid && action === 'confirm') this.#taskPolicyChange = null;
      if (!valid) throw new WalletLoginError('LOGIN_SERVICE_BINDING_REFUSED');
      return result;
    } catch (error) { current(); throw error; }
    finally {
      for (const key of ['password', 'signature', 'code']) if (Object.hasOwn(body, key)) body[key] = '';
    }
  }
  async recovery(action, body = {}) {
    if (!['enroll/start', 'enroll/confirm', 'reset/start', 'reset/confirm', 'cancel'].includes(action)) throw new WalletLoginError('AUTH_ROUTE_REFUSED');
    return this.request(`recovery/${action}`, body);
  }
  async setMethods(enabledMethods, existingCode, recovery = false) {
    return this.request('account/methods', { enabledMethods, existingCode, recovery });
  }
  async setPassword(body) {
    if (!this.#session) throw new WalletLoginError('LOGIN_REQUIRED');
    if (!this.supportsPasswordManagement) throw new WalletLoginError('AUTH_PASSWORD_MANAGEMENT_UNAVAILABLE');
    const result = await this.request('account/password', body);
    if (result.updated !== true || result.loggedOut !== true) throw new WalletLoginError('LOGIN_SERVER_RESPONSE_REFUSED');
    this.#session = null; return result;
  }
  async startEnrollment(existingCode, recovery = false, purpose, resetProof) {
    if (!this.#session) throw new WalletLoginError('LOGIN_REQUIRED');
    return this.request('totp/enroll/start', { existingCode, recovery, ...(purpose ? { purpose } : {}), ...(resetProof ? { resetProof } : {}) });
  }
  async confirmEnrollment(code, enrollmentId) { const result = await this.request('totp/enroll/confirm', { code, enrollmentId }); this.#session = null; return result; }
  async cancelEnrollment(enrollmentId) { return this.request('totp/enroll/cancel', enrollmentId ? { enrollmentId } : {}); }
}

/** Same-origin, single-process account authentication. No transaction signing authority. */
import { randomToken, digest, equal, verifyPassword, matchTotp } from './crypto.mjs';
import { loginOrigin, loginMessage } from '../web/login-core.mjs';
import { verifyMessage, getAddress } from 'ethers';
import { validateAccountBindings } from './config-validation.mjs';
import { createRecoveryService, RecoveryError } from './recovery-service.mjs';
import { createTaskAuthorizationService, TaskAuthorizationError } from './task-authorization.mjs';
import { createForwardProgressService, ForwardProgressError } from './forward-progress-service.mjs';
import { createRpcForwardProgressReader } from './forward-progress-reader.mjs';
import { createTaskVerificationPolicyService, TaskVerificationPolicyError } from './task-verification-policy.mjs';
import { createAssetControlPolicyService } from './task-asset-control-policy.mjs';
import { AssetControlStateError, normalizeAssetControlPatch } from './task-asset-control-state.mjs';
import { createAssetControlCatalog } from './task-asset-control-catalog.mjs';
import { createMethodChangeService, MethodChangeError } from './method-change-service.mjs';
import { createAccountDirectory } from './account-directory.mjs';
import { createRegistrationService, RegistrationError } from './registration-service.mjs';
const LIFE = 15 * 60_000, CHALLENGE = 2 * 60_000, ENROLL = 5 * 60_000;
const accountMethods = ['password', 'wallet', 'ca', 'totp'];
const chains = new Set(['1', '8453', '11155111', '84532', '560048', '31337']);
export class AuthError extends Error {
  constructor(code = 'AUTH_REFUSED', status = 401) { super(code); this.status = status; }
}
const requireThat = (condition, code = 'AUTH_REFUSED', status = 401) => { if (!condition) throw new AuthError(code, status); };
const validUsername = name => typeof name === 'string' && /^[a-z0-9][a-z0-9._-]{2,63}$/.test(name) && !['__proto__', 'constructor', 'prototype'].includes(name);
function identity(value) {
  requireThat(value && typeof value.account === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value.account) &&
    typeof value.chainId === 'string' && chains.has(value.chainId));
  const account = getAddress(value.account.toLowerCase()); requireThat(!/^0x0+$/.test(account));
  return { account, chainId: value.chainId };
}
function cookies(request) {
  const result = new Map();
  for (const entry of (request.headers.cookie ?? '').split(';')) {
    const [name, value, ...extra] = entry.trim().split('=');
    if (name && value && !extra.length && !result.has(name)) result.set(name, value);
  }
  return result;
}
export function createAuthService({ origin, tenant, accounts, store, verifyCa = null, sendOtp = null, now = Date.now, taskExecution = null, taskExecutorIdentity = null, taskObservationPolicy = null, taskReceipt = null, taskListingExecution = null, taskListingResults = null, taskListingRuntimeStatus = null, taskReceiptHandlerId = null, taskChannelBindings = null, taskTestAuthorization = null, forwardProgressReader = null, forwardProgressSource = null, taskVerificationPolicyEnabled = false, assetControlCatalogReader = null }) {
  const url = loginOrigin(origin);
  requireThat(typeof tenant === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(tenant), 'AUTH_CONFIG_REFUSED', 500);
  requireThat(Array.isArray(accounts) && accounts.length > 0 && accounts.length <= 10000 && store, 'AUTH_CONFIG_REFUSED', 500);
  try { validateAccountBindings(accounts); } catch { throw new AuthError('AUTH_CONFIG_REFUSED', 500); }
  const users = new Map();
  for (const input of accounts) {
    requireThat(validUsername(input.username) && !users.has(input.username) && Array.isArray(input.wallets) && input.wallets.length > 0 && input.wallets.length <= 64,
      'AUTH_CONFIG_REFUSED', 500);
    requireThat(input.passwordHash === undefined || /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(input.passwordHash), 'AUTH_CONFIG_REFUSED', 500);
    requireThat(input.caFingerprints === undefined || (Array.isArray(input.caFingerprints) && input.caFingerprints.every(v => /^[a-f0-9]{64}$/.test(v))), 'AUTH_CONFIG_REFUSED', 500);
    users.set(input.username, Object.freeze({ username: input.username, passwordHash: input.passwordHash,
      wallets: input.wallets.map(identity), caFingerprints: input.caFingerprints ?? [] }));
  }
  const directory = createAccountDirectory({ tenant, accounts, store, users });
  const secure = url.protocol === 'https:', sessionName = secure ? '__Host-8415session' : '8415session-local', preauthName = secure ? '__Host-8415preauth' : '8415preauth-local';
  const sessions = new Map(), preauth = new Map(), challenges = new Map(), limits = new Map();
  let expensive = 0;
  let recoveryService = null, registrationService = null, methodChangeService = null, taskService = null, verificationPolicyService = null, assetControlService = null;
  const stamp = () => { const time = now(); requireThat(Number.isSafeInteger(time) && time >= 0, 'AUTH_CLOCK_REFUSED', 503); return time; };
  function sweep() {
    const time = stamp();
    for (const collection of [sessions, preauth, challenges, limits]) {
      for (const [key, entry] of collection) if (time < entry.issuedAt || time >= entry.expiresAt) collection.delete(key);
    }
  }
  function capacity(collection) { sweep(); requireThat(collection.size < 10000, 'AUTH_BUSY', 503); }
  function limit(key, maximum, duration = 15 * 60_000) {
    const time = stamp(); let value = limits.get(key);
    if (!value || time >= value.expiresAt || time < value.issuedAt) {
      capacity(limits); value = { count: 0, issuedAt: time, expiresAt: time + duration }; limits.set(key, value);
    }
    if (++value.count > maximum) {
      const error = new AuthError('AUTH_RATE_LIMITED', 429);
      error.retryAfterSeconds = Math.max(1, Math.ceil((value.expiresAt - time) / 1000)); throw error;
    }
  }
  const cookie = (name, value, seconds) => `${name}=${value}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${seconds}${secure ? '; Secure' : ''}`;
  function publicSession(session) {
    return { id: session.id, tenant, origin, username: session.username, account: session.account, chainId: session.chainId,
      kind: session.kind, issuedAt: session.issuedAt, expiresAt: session.expiresAt, csrf: session.csrf };
  }
  const boundUser = (name, selected) => {
    const user = users.get(validUsername(name) ? name : directory.alias(name));
    return user?.wallets.some(wallet => wallet.account === selected.account && wallet.chainId === selected.chainId) ? user : null;
  };
  function localSession(req) {
    sweep(); const token = cookies(req).get(sessionName), session = token ? sessions.get(digest(token)) : null;
    requireThat(session && equal(req.headers['x-wallet-csrf'], session.csrf));
    return session;
  }
  function activeSession(session) {
    sweep(); requireThat(sessions.get(session.key) === session);
  }
  function revokeSession(session) {
    sessions.delete(session.key); recoveryService?.cancel(session); registrationService?.cancel(session, true); methodChangeService?.cancel(session); taskService?.cancel(session); verificationPolicyService?.cancel(session); assetControlService?.cancel(session);
  }
  function revokeAccount(username) {
    for (const current of sessions.values()) if (current.username === username) revokeSession(current);
  }
  function passwordFor(user, credential) {
    // A persisted account password supersedes the original configured/signup
    // hash. Malformed overrides must fail closed, never revive the old password.
    if (credential?.passwordHash === undefined) return user?.passwordHash;
    requireThat(typeof credential.passwordHash === 'string' && /^scrypt-v1\$[a-f0-9]{32}\$[a-f0-9]{64}$/.test(credential.passwordHash),
      'AUTH_PASSWORD_STATE_REFUSED', 503);
    return credential.passwordHash;
  }
  function methodStates(user, credential) {
    const bindings = { password: Boolean(passwordFor(user, credential)), wallet: user.wallets.length > 0,
      ca: user.caFingerprints.length > 0, totp: Boolean(credential?.secret) };
    return Object.fromEntries(accountMethods.map(method => [method, { available: method !== 'ca' || Boolean(verifyCa), bound: bindings[method],
      enabled: bindings[method] && (method !== 'ca' || Boolean(verifyCa)) &&
        (credential?.enabledMethods === undefined || (Array.isArray(credential.enabledMethods) && credential.enabledMethods.includes(method))) }]));
  }
  async function credentialFor(session) {
    const credential = await store.read(`${tenant}:${session.username}`);
    // A read may wait behind other work. Never revive a session revoked while it waited.
    activeSession(session); requireThat((credential?.revision ?? 0) === session.revision);
    directory.checkCredential(session.username, credential);
    return credential;
  }
  async function sessionFor(req) {
    const session = localSession(req); await credentialFor(session); return session;
  }
  const independent = session => ['password', 'wallet', 'ca'].includes(session.kind);
  function recentIndependent(session) {
    activeSession(session);
    requireThat(independent(session) && stamp() - session.issuedAt < ENROLL, 'AUTH_RECENT_INDEPENDENT_LOGIN_REQUIRED', 403);
  }
  function preauthFor(req) {
    sweep(); const token = cookies(req).get(preauthName), state = token ? preauth.get(digest(token)) : null;
    requireThat(state && equal(req.headers['x-wallet-csrf'], state.csrf), 'AUTH_CSRF_REFUSED', 403);
    return state;
  }
  async function issue(req, res, user, selected, kind, expectedRevision, signup = null) {
    const credential = await store.read(`${tenant}:${user.username}`), time = stamp(), token = randomToken(); capacity(sessions);
    directory.checkCredential(user.username, credential);
    preauthFor(req); // Logout/cancellation also revokes an in-flight login.
    requireThat(expectedRevision === undefined || expectedRevision === (credential?.revision ?? 0));
    requireThat(methodStates(user, credential)[kind === 'recovery' ? 'totp' : kind]?.enabled);
    const prior = sessions.get(digest(cookies(req).get(sessionName) ?? '')); if (prior) revokeSession(prior);
    signup?.authorizeSession();
    const session = { ...selected, ...(signup ? { registrationBootstrapId: signup.bootstrapId } : {}), username: user.username, id: randomToken(), csrf: randomToken(), kind,
      key: digest(token), issuedAt: time, expiresAt: time + LIFE, revision: credential?.revision ?? 0 };
    sessions.set(session.key, session); res.setHeader('Set-Cookie', cookie(sessionName, token, LIFE / 1000));
    return publicSession(session);
  }
  function withConsumedCode(value, code, recovery = false) {
    requireThat(value?.secret); const next = structuredClone(value);
    if (recovery) {
      requireThat(typeof code === 'string' && /^[a-f0-9]{4}(?:-[a-f0-9]{4}){7}$/.test(code));
      const hash = digest(`${value.recoverySalt}:${code}`), index = value.recoveryHashes.findIndex(v => equal(v, hash));
      requireThat(index >= 0); next.recoveryHashes.splice(index, 1);
    } else {
      const step = matchTotp(value.secret, code, stamp(), value.lastStep); requireThat(step !== null); next.lastStep = step;
    }
    return next;
  }
  async function consumeCode(username, code, recovery = false, { expectedRevision, validate, authorize, login = false } = {}) {
    let accepted = false, revision;
    await store.transaction(`${tenant}:${username}`, value => {
      validate?.();
      requireThat(expectedRevision === undefined || (value?.revision ?? 0) === expectedRevision);
      if (login) requireThat(methodStates(users.get(username), value).totp.enabled);
      const next = withConsumedCode(value, code, recovery);
      // Independent reset proof is consumed only after the existing code matches.
      authorize?.(value); accepted = true; revision = next.revision; return next;
    });
    requireThat(accepted); return revision;
  }
  async function readBody(req) {
    requireThat(req.headers['content-type'] === 'application/json', 'AUTH_REQUEST_REFUSED', 415);
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; requireThat(size <= 100000, 'AUTH_REQUEST_TOO_LARGE', 413); chunks.push(chunk); }
    try { const value = JSON.parse(Buffer.concat(chunks).toString('utf8')); requireThat(value && typeof value === 'object' && !Array.isArray(value)); return value; }
    catch { throw new AuthError('AUTH_REQUEST_REFUSED', 400); }
  }
  recoveryService = createRecoveryService({ origin, tenant, store, sendOtp, now,
    assertRecent: recentIndependent, credentialFor, revokeAccount,
    consumeExistingCode: (session, code, recovery, authorize) => consumeCode(session.username, code, recovery,
      { expectedRevision: session.revision, validate: () => recentIndependent(session), authorize }) });
  registrationService = createRegistrationService({ origin, tenant, store, directory, sendOtp, now, identity,
    assertPreauth: state => { sweep(); requireThat([...preauth.values()].includes(state), 'AUTH_CSRF_REFUSED', 403); },
    assertRecent: recentIndependent, credentialFor, withConsumedCode,
    consumeResetProof: (session, proof, prior) => recoveryService.consumeProof(session, proof, prior), revokeAccount });
  methodChangeService = createMethodChangeService({ origin, tenant, store, directory, users, sendOtp, now,
    assertRecent: recentIndependent, credentialFor, passwordFor, methodStates, withConsumedCode, revokeAccount });
  // Policy scope follows actual configured Agent identities, never caller JSON.
  // Multiple distinct configured agents need an explicit per-agent management
  // selector; do not silently attach a wallet-wide switch to a made-up identity.
  const policyAgents = new Set([taskExecutorIdentity?.agentId,
    ...Object.values(taskChannelBindings ?? {}).map(binding => binding.executorIdentity?.agentId)].filter(Boolean));
  // Do not activate settings until the owning runtime binds its execution gates.
  // This server-owned composition flag is never taken from a request or UI.
  if (taskVerificationPolicyEnabled === true && policyAgents.size <= 1) verificationPolicyService = createTaskVerificationPolicyService({ origin, tenant,
    agentId: [...policyAgents][0] ?? '8415wallet:local-task-service',
    store, directory, users, sendOtp, now, assertSession: activeSession, credentialFor, passwordFor, methodStates });
  // Source-owned readers and configured executor identities, never HTTP flags.
  requireThat(assetControlCatalogReader === null || typeof assetControlCatalogReader === 'function',
    'AUTH_ASSET_CATALOG_CONFIG_REFUSED',500);
  const readAssetSubjects=assetControlCatalogReader;
  if(policyAgents.size<=1) assetControlService=createAssetControlPolicyService({origin,tenant,
    agentId:[...policyAgents][0]??'8415wallet:local-task-service',store,directory,users,sendOtp,now,
    assertSession:activeSession,credentialFor,passwordFor,methodStates});
  const publicAssetControl=value=>{
    const {changes,...status}=value;
    return {...status,changeCount:changes.length,lastChange:changes.at(-1)??null,
      canSave:policyAgents.size===1,executionScope:'supported-actual-task-bindings'};
  };
  async function currentAssetCatalog(session) {
    requireThat(assetControlService!==null,'AUTH_POLICY_AGENT_SCOPE_UNAVAILABLE',503);
    const credential=await credentialFor(session);
    const state=await assetControlService.status(session);
    let subjects=[{chainId:session.chainId,standard:'native',contract:null,tokenId:null}];
    // Native denotes the configured chain's native asset, not a claim of funds.
    // A missing NFT inventory stays explicitly incomplete; it is never empty PASS.
    if(readAssetSubjects!==null) {
      const observed=await readAssetSubjects(Object.freeze({origin,tenant,username:session.username,
        account:session.account,chainId:session.chainId,agentId:state.scope.agentId}));
      await credentialFor(session);
      requireThat(Array.isArray(observed),'AUTH_ASSET_CATALOG_SOURCE_REFUSED',503);
      const supplement=createAssetControlCatalog(state.scope,observed);
      subjects=subjects.concat(supplement.entries.filter(e=>e.subject.standard!=='native').map(e=>e.subject));
    }
    // Reader/session/credential changes cannot return a different wallet's data.
    activeSession(session);requireThat((credential?.revision??0)===session.revision);
    return {...createAssetControlCatalog(state.scope,subjects),
      inventoryComplete:readAssetSubjects!==null};
  }
  async function assertAssetControlSaveTarget(session,body) {
    requireThat(policyAgents.size===1,'AUTH_POLICY_AGENT_SCOPE_UNAVAILABLE',503);
    const patch=normalizeAssetControlPatch(body.patch),catalog=await currentAssetCatalog(session);
    const target=patch.target;
    requireThat(target.kind==='allow-agent'||catalog.entries.some(entry=>
      target.path.every((id,i)=>entry.path[i]===id)),'AUTH_ASSET_CATALOG_TARGET_REFUSED',403);
  }
  const publicVerificationPolicy = value => {
    const { changes, ...status } = value;
    return { ...status, changeCount: changes.length, lastChange: changes.at(-1) ?? null };
  };
  taskService = createTaskAuthorizationService({ origin, tenant, store, now, execution: taskExecution, executorIdentity: taskExecutorIdentity, observationPolicy: taskObservationPolicy, receipt: taskReceipt, listingExecution: taskListingExecution, listingResults: taskListingResults, receiptHandlerId: taskReceiptHandlerId, channelBindings: taskChannelBindings, testAuthorization: taskTestAuthorization,
    operationVerificationEnabled: verificationPolicyService !== null,
    principalReady: directory.ready,
    assertPrincipal(principal, credential) {
      const user = users.get(principal.username);
      requireThat(user && user.wallets.some(wallet => wallet.account.toLowerCase() === principal.account && wallet.chainId === principal.chainId),
        'TASK_BACKGROUND_PRINCIPAL_REFUSED', 403);
      if (credential !== undefined) {
        requireThat(credential !== null, 'TASK_BACKGROUND_CREDENTIAL_REQUIRED', 403);
        directory.checkCredential(principal.username, credential);
      }
    },
    credentialFor, assertSession(session, credential) {
      activeSession(session);
      if (credential !== undefined) {
        requireThat((credential?.revision ?? 0) === session.revision);
        directory.checkCredential(session.username, credential);
      }
    }, consumeTotp(session, credential, code) {
      requireThat(methodStates(users.get(session.username), credential).totp.enabled, 'TASK_AUTHENTICATOR_REQUIRED', 403);
      return withConsumedCode(credential, code, false);
    } });
  // This capability comes from server composition, never a route/body/session flag.
  requireThat(forwardProgressReader === null || forwardProgressSource === null, 'AUTH_FORWARD_SOURCE_CONFIG_REFUSED', 500);
  if (forwardProgressSource !== null) {
    requireThat(typeof forwardProgressSource === 'object' && !Array.isArray(forwardProgressSource) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(forwardProgressSource)), 'AUTH_FORWARD_SOURCE_CONFIG_REFUSED', 500);
    const descriptors = Object.getOwnPropertyDescriptors(forwardProgressSource), keys = Reflect.ownKeys(descriptors);
    requireThat(['provider', 'pin', 'fromBlock'].every(k => Object.hasOwn(descriptors, k)) &&
      keys.every(k => typeof k === 'string' && ['provider', 'pin', 'fromBlock', 'limits'].includes(k) &&
        Object.hasOwn(descriptors[k], 'value')), 'AUTH_FORWARD_SOURCE_CONFIG_REFUSED', 500);
    const source = Object.fromEntries(keys.map(k => [k, descriptors[k].value]));
    try { forwardProgressReader = createRpcForwardProgressReader({ ...source, tenant, origin }); }
    catch { throw new AuthError('AUTH_FORWARD_SOURCE_CONFIG_REFUSED', 500); }
  }
  const forwardProgress = createForwardProgressService({ store, reader: forwardProgressReader, origin, tenant,
    assertSession(session, credential) {
      activeSession(session);
      if (credential !== undefined) {
        requireThat((credential?.revision ?? 0) === session.revision);
        directory.checkCredential(session.username, credential);
      }
    } });
  async function route(req, res) {
    requireThat(req.headers.host === url.host, 'AUTH_ORIGIN_REFUSED', 403);
    requireThat(req.headers['x-wallet-tenant'] === tenant, 'AUTH_TENANT_REFUSED', 403);
    requireThat(!req.headers['sec-fetch-site'] || ['same-origin', 'none'].includes(req.headers['sec-fetch-site']), 'AUTH_ORIGIN_REFUSED', 403);
    requireThat(req.url?.startsWith('/auth/') && !req.url.includes('?'), 'AUTH_ROUTE_REFUSED', 404);
    const path = req.url.slice(6), ip = req.socket.remoteAddress ?? 'unknown';
    await directory.ready;
    if (req.method === 'GET' && path === 'capabilities') return { schema: '8415wallet-auth/1', tenant, origin, passwordManagement: true, methodManagement: "combined-v1",
      taskAuthorization: { available: true, schema: '8415-agent-task/1', sessionRequired: true, adapterConfigured: Boolean(taskExecution), executable: false, listing: { adapterConfigured: Boolean(taskListingExecution), resultsConfigured: Boolean(taskListingResults), state: taskListingExecution ? 'configured' : 'disabled', code: taskListingExecution ? null : taskListingRuntimeStatus?.code ?? 'TASK_LISTING_NOT_CONFIGURED' } },
      methods: ['password', 'totp', 'wallet', ...(verifyCa ? ['ca'] : [])], registration: { available: Boolean(sendOtp), emailRequired: true }, totp: { algorithm: 'SHA1', digits: 6, period: 30 }, hardwareCa: verifyCa ? 'bridge-v1' : null };
    if (req.method === 'GET' && path === 'bootstrap') {
      limit(`bootstrap:${ip}`, 60); capacity(preauth);
      const token = randomToken(), csrf = randomToken(), time = stamp();
      const prior = cookies(req).get(preauthName); if (prior) {
        const previous = preauth.get(digest(prior)); if (previous) registrationService.cancel(previous); preauth.delete(digest(prior));
      }
      preauth.set(digest(token), { id: randomToken(), csrf, issuedAt: time, expiresAt: time + LIFE });
      res.setHeader('Set-Cookie', cookie(preauthName, token, LIFE / 1000)); return { csrf };
    }
    if (req.method === 'GET' && path === 'session') return publicSession(await sessionFor(req));
    if (req.method === 'GET' && path === 'account') {
      const session = localSession(req), credential = await credentialFor(session), user = users.get(session.username);
      const enrolled = Boolean(credential?.secret);
      return { schema: '8415wallet-account/1', tenant, origin, username: session.username, account: session.account, chainId: session.chainId,
        methods: methodStates(user, credential), recovery: recoveryService.status(credential),
        registration: registrationService.status(session.username, credential),
        authenticator: methodChangeService.authenticatorStatus(session, credential),
        methodChange: methodChangeService.status(session, credential),
        forwardProgressAvailable: forwardProgressReader !== null,
        taskHumanVerification: verificationPolicyService === null ? null : publicVerificationPolicy(await verificationPolicyService.status(session)),
        management: { freshIndependentLogin: independent(session) && stamp() - session.issuedAt < ENROLL,
          reauthenticateBy: independent(session) ? session.issuedAt + ENROLL : null, existingCodeRequired: enrolled } };
    }
    requireThat(req.method === 'POST', 'AUTH_ROUTE_REFUSED', 404);
    requireThat(req.headers.origin === origin, 'AUTH_ORIGIN_REFUSED', 403);
    const body = await readBody(req);
    if (path === 'logout') {
      // Revoke locally before any await, including a delayed credential read/write.
      // A valid bootstrap can also revoke a late-issued login in the same browser.
      try { localSession(req); } catch { preauthFor(req); }
      const session = sessions.get(digest(cookies(req).get(sessionName) ?? '')); if (session) revokeSession(session);
      const state = cookies(req).get(preauthName); if (state) {
        const previous = preauth.get(digest(state)); if (previous) registrationService.cancel(previous); preauth.delete(digest(state));
      }
      res.setHeader('Set-Cookie', [cookie(sessionName, '', 0), cookie(preauthName, '', 0)]); return { loggedOut: true };
    }
    if (path === 'assets/forward-progress') {
      const session = await sessionFor(req);
      limit(`forward-progress:${session.username}`, 120);
      return forwardProgress.read(body, session);
    }
    if (path.startsWith('tasks/')) {
      const session = localSession(req); limit(`tasks:${session.username}`, 120);
      if (path === 'tasks/observation-source' || path === 'tasks/observation-details') {
        requireThat(taskService.observationDetails !== undefined, 'TASK_OBSERVATION_SOURCE_UNSUPPORTED', 503);
        return path === 'tasks/observation-source' ?
          taskService.observationDetails.resolve(body, session) : taskService.observationDetails.read(body, session);
      }
      if (path === 'tasks/authorize') limit(`task-approval:${session.username}`, 10);
      return taskService.handler(path, body, session);
    }
    if(path.startsWith('account/asset-controls/')) {
      const session=await sessionFor(req);limit(`asset-policy:${session.username}`,30);
      requireThat(assetControlService!==null,'AUTH_POLICY_AGENT_SCOPE_UNAVAILABLE',503);
      if(path==='account/asset-controls/status') {
        requireThat(Object.keys(body).length===0,'AUTH_REQUEST_REFUSED',400);
        return publicAssetControl(await assetControlService.status(session));
      }
      if(path==='account/asset-controls/catalog') {
        requireThat(Object.keys(body).length===0,'AUTH_REQUEST_REFUSED',400);
        return currentAssetCatalog(session);
      }
      if(path==='account/asset-controls/prepare') {
        await assertAssetControlSaveTarget(session,body);return assetControlService.prepare(session,body);
      }
      if(path==='account/asset-controls/verify')return assetControlService.verify(session,body);
      if(path==='account/asset-controls/confirm')return publicAssetControl(await assetControlService.confirm(session,body));
      if(path==='account/asset-controls/cancel') {
        requireThat(Object.keys(body).length===0,'AUTH_REQUEST_REFUSED',400);
        assetControlService.cancel(session);return {cancelled:true};
      }
      throw new AuthError('AUTH_ROUTE_REFUSED',404);
    }
    if (path.startsWith('account/task-verification/')) {
      const session = await sessionFor(req); limit(`task-policy:${session.username}`, 30);
      requireThat(verificationPolicyService !== null, 'AUTH_POLICY_AGENT_SCOPE_UNAVAILABLE', 503);
      // Owner settings are not task grants. Two established factors are bound
      // to each exact ON/OFF revision; an existing OFF or Agent grant never saves.
      if (path === 'account/task-verification/status') {
        requireThat(Object.keys(body).length === 0, 'AUTH_REQUEST_REFUSED', 400);
        return publicVerificationPolicy(await verificationPolicyService.status(session));
      }
      if (path === 'account/task-verification/prepare') return verificationPolicyService.prepare(session, body);
      if (path === 'account/task-verification/verify') return verificationPolicyService.verify(session, body);
      if (path === 'account/task-verification/confirm') return publicVerificationPolicy(await verificationPolicyService.confirm(session, body));
      if (path === 'account/task-verification/on') return publicVerificationPolicy(await verificationPolicyService.enable(session, body));
      if (path === 'account/task-verification/cancel') {
        requireThat(Object.keys(body).length === 0, 'AUTH_REQUEST_REFUSED', 400);
        verificationPolicyService.cancel(session); return { cancelled: true };
      }
      throw new AuthError('AUTH_ROUTE_REFUSED', 404);
    }
    if (path.startsWith('account/change/')) {
      const result = await methodChangeService.handler(path, body, localSession(req));
      if (result.loggedOut) res.setHeader('Set-Cookie', cookie(sessionName, '', 0));
      return result;
    }
    // Legacy mutation routes cannot bypass exact combined verification. Login,
    // signup and read-only status remain available to existing accounts.
    if (['account/password', 'account/methods'].includes(path) || path.startsWith('totp/enroll/') ||
      path.startsWith('recovery/enroll/') || path.startsWith('registration/email/')) {
      localSession(req);
      throw new AuthError('AUTH_CHANGE_FLOW_REQUIRED', 409);
    }
    if (path.startsWith('registration/')) {
      const bootstrap = preauthFor(req);
      if (path === 'registration/cancel') for (const session of sessions.values()) {
        if (session.registrationBootstrapId === bootstrap.id) revokeSession(session);
      }
      const result = await registrationService.signup(path, body, bootstrap, ip);
      if (result.user) {
        try { return { registered: true, session: await issue(req, res, result.user, result.selected, 'wallet', 1, result) }; }
        catch (error) {
          registrationService.cancel(bootstrap);
          for (const session of sessions.values()) if (session.registrationBootstrapId === bootstrap.id) revokeSession(session);
          throw error;
        }
      }
      return result;
    }
    if (path.startsWith('recovery/')) {
      const result = await recoveryService.handler(path, body, localSession(req));
      if (result.loggedOut) res.setHeader('Set-Cookie', cookie(sessionName, '', 0));
      return result;
    }
    const bootstrap = preauthFor(req), selected = identity(body);
    limit(`ip:${ip}`, 100); // Proxy headers are intentionally not trusted.
    if (path === 'password' || path === 'totp') {
      requireThat(typeof body.username === 'string' && body.username.length <= 254);
      const user = boundUser(body.username, selected);
      limit(`account:${user?.username ?? digest(body.username.toLowerCase())}`, 10); let revision;
      if (path === 'password') {
        const credential = user ? await store.read(`${tenant}:${user.username}`) : null;
        if (user) directory.checkCredential(user.username, credential);
        const passwordHash = passwordFor(user, credential); revision = credential?.revision ?? 0;
        requireThat(expensive < 2, 'AUTH_BUSY', 503); expensive++;
        let verified;
        try { verified = await verifyPassword(body.password, passwordHash); } finally { expensive--; }
        requireThat(verified && user);
      } else {
        requireThat(user); revision = await consumeCode(user.username, body.code, body.recovery === true, { login: true });
      }
      return issue(req, res, user, selected, path === 'totp' && body.recovery === true ? 'recovery' : path, revision);
    }
    if (path === 'challenge') {
      requireThat(['wallet', 'ca'].includes(body.method) && (body.method !== 'ca' || verifyCa));
      capacity(challenges); const id = randomToken(), time = stamp(), nonce = randomToken().replace(/[-_]/g, '');
      const context = { ...selected, origin, nonce, issuedAt: time, expiresAt: time + CHALLENGE };
      const message = body.method === 'wallet' ? loginMessage(context) + `\nResources:\n- urn:8415wallet:tenant:${tenant}\n- urn:8415wallet:purpose:login\n- urn:8415wallet:request:${id}` :
        `8415wallet hardware CA login\nOrigin: ${origin}\nTenant: ${tenant}\nAccount: ${selected.account}\nChain ID: ${selected.chainId}\nPurpose: login only; no transaction authority\nRequest: ${id}\nNonce: ${nonce}\nIssued At: ${new Date(time).toISOString()}\nExpiration Time: ${new Date(time + CHALLENGE).toISOString()}`;
      challenges.set(id, { ...context, id, method: body.method, bootstrapId: bootstrap.id, message });
      return { ...context, id, tenant, method: body.method, message };
    }
    if (path === 'proof') {
      sweep(); const challenge = typeof body.id === 'string' ? challenges.get(body.id) : null;
      requireThat(challenge && challenge.bootstrapId === bootstrap.id && challenge.account === selected.account && challenge.chainId === selected.chainId);
      challenges.delete(body.id);
      let user;
      if (challenge.method === 'wallet') {
        requireThat(typeof body.signature === 'string' && /^0x[0-9a-fA-F]{130}$/.test(body.signature));
        let recovered; try { recovered = verifyMessage(challenge.message, body.signature); } catch { throw new AuthError(); }
        requireThat(recovered === selected.account);
        const matches = [...users.values()].filter(candidate => candidate.wallets.some(w => w.account === selected.account && w.chainId === selected.chainId));
        requireThat(matches.length === 1); user = matches[0];
      } else {
        requireThat(expensive < 2, 'AUTH_BUSY', 503); expensive++;
        let proof;
        try { proof = await verifyCa({ message: challenge.message, signature: body.signature, certificateChain: body.certificateChain, algorithm: body.algorithm }); }
        catch { throw new AuthError(); } finally { expensive--; }
        const matches = [...users.values()].filter(candidate => candidate.caFingerprints.includes(proof.fingerprint) && candidate.wallets.some(w => w.account === selected.account && w.chainId === selected.chainId));
        requireThat(matches.length === 1); user = matches[0];
      }
      requireThat(stamp() >= challenge.issuedAt && stamp() < challenge.expiresAt);
      return issue(req, res, user, selected, challenge.method);
    }
    throw new AuthError('AUTH_ROUTE_REFUSED', 404);
  }
  const handler = async (req, res) => {
    res.setHeader('Content-Type', 'application/json'); res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Pragma', 'no-cache'); res.setHeader('X-Content-Type-Options', 'nosniff');
    // No Access-Control-Allow-Origin: only the configured same-origin UI can read.
    try { const result = await route(req, res); res.statusCode = 200; res.end(JSON.stringify(result)); }
    catch (error) { const expected = error instanceof AuthError || error instanceof RecoveryError || error instanceof RegistrationError || error instanceof MethodChangeError || error instanceof TaskAuthorizationError || error instanceof ForwardProgressError || error instanceof TaskVerificationPolicyError || error instanceof AssetControlStateError; res.statusCode = expected ? error.status : 503;
      const retryAfterSeconds = expected && error.status === 429 && req.url?.startsWith('/auth/tasks/') &&
        Number.isSafeInteger(error.retryAfterSeconds) && error.retryAfterSeconds >= 1 && error.retryAfterSeconds <= 900 ? error.retryAfterSeconds : null;
      if (retryAfterSeconds !== null) res.setHeader('Retry-After', String(retryAfterSeconds));
      res.end(JSON.stringify({ error: expected ? error.message : 'AUTH_UNAVAILABLE', ...(retryAfterSeconds === null ? {} : { retryAfterSeconds }) })); }
  };
  Object.defineProperty(handler, 'taskBackground', { value: taskService.background, enumerable: false });
  Object.defineProperty(handler, 'taskReceiptAuthorization', { value: taskService.receiptAuthorization, enumerable: false });
  Object.defineProperty(handler, 'taskListingAuthorization', { value: taskService.listingAuthorization, enumerable: false });
  return handler;
}

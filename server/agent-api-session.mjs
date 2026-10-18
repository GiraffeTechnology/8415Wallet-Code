/** Headless API client. No browser/provider UI, key loading, settings writes,
 * human-factor prompting, transaction signing or automatic submission retries.
 * Inject only the existing lawful login-message signer and trusted transport.
 * The server remains authoritative for grants, owner settings and execution.
 */
import { request as httpsRequest } from 'node:https';
import { request as httpRequest } from 'node:http';
import { verifyMessage, getAddress } from 'ethers';
import { loginOrigin, loginMessage } from '../web/login-core.mjs';

export class AgentApiError extends Error {
  constructor(code, status = null) { super(code); this.name = 'AgentApiError'; this.code = code; this.status = status; }
}
const check = (ok, code) => { if (!ok) throw new AgentApiError(code); };
const token = value => typeof value === 'string' && /^[A-Za-z0-9_-]{43}$/.test(value);
const uint = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < 1n << 256n;
const taskPaths = new Set(['list', 'prepare', 'authorize', 'status', 'reserve', 'execute', 'recover', 'resume',
  'observe', 'observe-replacement', 'observation-source', 'observation-details']);

/** Fixed-origin, bounded Node HTTP transport. No redirects, ambient cookie jar,
 * proxy selection, TLS relaxation or alternate endpoint fallback. Secrets are
 * passed in memory and never included in errors. HTTP is loopback-only.
 */
export function createAgentHttpTransport({ origin, timeoutMs = 10_000, maxResponseBytes = 1_048_576 }) {
  const base = loginOrigin(origin);
  check(Number.isSafeInteger(timeoutMs) && timeoutMs > 0 && timeoutMs <= 60_000 &&
    Number.isSafeInteger(maxResponseBytes) && maxResponseBytes > 0 && maxResponseBytes <= 4_194_304,
  'AGENT_API_TRANSPORT_CONFIG_REFUSED');
  const send = base.protocol === 'https:' ? httpsRequest : httpRequest;
  return Object.freeze({ request({ method, path, headers, body }) {
    check(['GET', 'POST'].includes(method) && /^\/auth\/[a-z/-]+$/.test(path), 'AGENT_API_ROUTE_REFUSED');
    const bytes = body === undefined ? undefined : Buffer.from(JSON.stringify(body));
    return new Promise((resolve, reject) => {
      const fail = () => reject(new AgentApiError('AGENT_API_TRANSPORT_UNAVAILABLE'));
      const req = send(new URL(path, base), { method, headers: { ...headers,
        ...(bytes === undefined ? {} : { 'Content-Type': 'application/json', 'Content-Length': String(bytes.length) }) } }, res => {
        const chunks = []; let size = 0;
        res.on('data', chunk => {
          size += chunk.length;
          if (size > maxResponseBytes) res.destroy(new AgentApiError('AGENT_API_RESPONSE_TOO_LARGE'));
          else chunks.push(chunk);
        });
        res.on('error', fail);
        res.on('end', () => {
          let data = null;
          try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { /* public status is retained */ }
          resolve({ status: res.statusCode, headers: res.headers, data });
        });
      });
      const deadline = setTimeout(() => req.destroy(), timeoutMs);
      req.on('error', fail); req.on('close', () => clearTimeout(deadline)); req.end(bytes);
    });
  } });
}

export function createAgentApiSession({ origin, tenant, account, chainId, loginSigner, transport, now = Date.now }) {
  const url = loginOrigin(origin);
  check(typeof tenant === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(tenant) && uint(chainId) &&
    typeof account === 'string' && /^0x[0-9a-fA-F]{40}$/.test(account) && !/^0x0+$/.test(account), 'AGENT_API_CONTEXT_REFUSED');
  const selected = getAddress(account.toLowerCase());
  check(typeof loginSigner?.signLoginMessage === 'function' && typeof transport?.request === 'function' && typeof now === 'function',
    'AGENT_API_CONFIG_REFUSED');
  // Capture methods once; JSON/body flags cannot select a signer or transport.
  const sign = loginSigner.signLoginMessage.bind(loginSigner), request = transport.request.bind(transport);
  const prefix = url.protocol === 'https:' ? '__Host-' : '';
  const preauthCookie = prefix ? '__Host-8415preauth' : '8415preauth-local';
  const sessionCookie = prefix ? '__Host-8415session' : '8415session-local';
  const cookies = new Map(), attempted = new Set();
  let session = null, csrf = '', epoch = 0, pending = false;
  const time = () => { const t = now(); check(Number.isSafeInteger(t) && t >= 0, 'AGENT_API_CLOCK_REFUSED'); return t; };
  const current = version => check(version === epoch, 'AGENT_API_CONTEXT_CANCELLED');
  const clear = () => { epoch++; session = null; csrf = ''; cookies.clear(); };
  const publicSession = () => Object.freeze({ origin, tenant, account: selected, chainId,
    sessionId: session.id, expiresAt: session.expiresAt, authentication: 'wallet-message-api', transactionAuthority: false });
  function validSession(value, expectedId = null) {
    const t = time();
    check(value && token(value.id) && token(value.csrf) && value.origin === origin && value.tenant === tenant &&
      typeof value.account === 'string' && value.account.toLowerCase() === selected.toLowerCase() && value.chainId === chainId &&
      value.kind === 'wallet' && (expectedId === null || value.id === expectedId) &&
      Number.isSafeInteger(value.issuedAt) && Number.isSafeInteger(value.expiresAt) && value.issuedAt <= t &&
      t < value.expiresAt && value.expiresAt - value.issuedAt <= 900_000, 'AGENT_API_SESSION_REFUSED');
  }
  function requireSession() {
    check(session !== null, 'AGENT_API_AUTHENTICATION_REQUIRED');
    try { validSession(session); } catch (error) { clear(); throw error; }
  }
  async function call(method, path, body, version) {
    let response;
    try { response = await request({ method, path: `/auth/${path}`, headers: {
      Origin: origin, 'X-Wallet-Tenant': tenant, Accept: 'application/json',
      ...(csrf ? { 'X-Wallet-CSRF': csrf } : {}),
      ...(cookies.size ? { Cookie: [...cookies].map(([k, v]) => `${k}=${v}`).join('; ') } : {}),
    }, ...(body === undefined ? {} : { body: structuredClone(body) }) });
    } catch {
      current(version);
      // Every route, including session checks and logout, uses this boundary.
      // An injected transport exception may contain private connection details.
      throw new AgentApiError('AGENT_API_TRANSPORT_UNAVAILABLE');
    }
    current(version);
    check(response && Number.isInteger(response.status), 'AGENT_API_RESPONSE_REFUSED');
    if (response.status !== 200) {
      if (response.status === 401) clear();
      const code = response.data?.error;
      throw new AgentApiError(typeof code === 'string' && /^[A-Z][A-Z0-9_]{0,127}$/.test(code) ? code :
        `AGENT_API_HTTP_${response.status}`, response.status);
    }
    const setCookies = response.headers?.['set-cookie'] ?? [];
    check(Array.isArray(setCookies), 'AGENT_API_COOKIE_REFUSED');
    for (const item of setCookies) {
      const [pair] = item.split(';'), index = pair.indexOf('='), name = pair.slice(0, index), value = pair.slice(index + 1);
      if (![preauthCookie, sessionCookie].includes(name)) continue;
      check(index > 0 && (value === '' || token(value)), 'AGENT_API_COOKIE_REFUSED');
      if (value) cookies.set(name, value); else cookies.delete(name);
    }
    return response.data;
  }
  async function authenticate() {
    check(!pending, 'AGENT_API_AUTHENTICATION_PENDING'); clear(); pending = true; const version = epoch;
    try {
      const boot = await call('GET', 'bootstrap', undefined, version);
      check(token(boot?.csrf) && cookies.has(preauthCookie), 'AGENT_API_BOOTSTRAP_REFUSED'); csrf = boot.csrf;
      const challenge = await call('POST', 'challenge', { method: 'wallet', account: selected, chainId }, version);
      const t = time();
      check(challenge && token(challenge.id) && challenge.origin === origin && challenge.tenant === tenant &&
        challenge.account === selected && challenge.chainId === chainId && challenge.method === 'wallet' &&
        typeof challenge.nonce === 'string' && /^[A-Za-z0-9]{1,128}$/.test(challenge.nonce) &&
        Number.isSafeInteger(challenge.issuedAt) && Number.isSafeInteger(challenge.expiresAt) &&
        challenge.issuedAt <= t && t < challenge.expiresAt && challenge.expiresAt - challenge.issuedAt <= 120_000,
      'AGENT_API_CHALLENGE_REFUSED');
      const expected = loginMessage(challenge) + `\nResources:\n- urn:8415wallet:tenant:${tenant}\n- urn:8415wallet:purpose:login\n- urn:8415wallet:request:${challenge.id}`;
      check(challenge.message === expected, 'AGENT_API_LOGIN_PURPOSE_REFUSED');
      const signature = await sign(Object.freeze({ message: expected, purpose: 'login', origin, tenant,
        account: selected, chainId, requestId: challenge.id, issuedAt: challenge.issuedAt, expiresAt: challenge.expiresAt }));
      current(version);
      check(time() < challenge.expiresAt && typeof signature === 'string' && /^0x[0-9a-fA-F]{130}$/.test(signature),
        'AGENT_API_LOGIN_SIGNATURE_REFUSED');
      let recovered; try { recovered = verifyMessage(expected, signature); } catch { throw new AgentApiError('AGENT_API_LOGIN_SIGNATURE_REFUSED'); }
      check(recovered === selected, 'AGENT_API_LOGIN_SIGNATURE_REFUSED');
      const verified = await call('POST', 'proof', { id: challenge.id, account: selected, chainId, signature }, version);
      validSession(verified); check(cookies.has(sessionCookie), 'AGENT_API_SESSION_REFUSED');
      session = verified; csrf = verified.csrf; cookies.delete(preauthCookie);
      return publicSession();
    } catch (error) {
      if (version === epoch) clear();
      // Never propagate signer/transport exception messages containing secrets.
      throw error instanceof AgentApiError ? error : new AgentApiError('AGENT_API_AUTHENTICATION_UNAVAILABLE');
    } finally { pending = false; }
  }
  async function checkSession() {
    requireSession(); const version = epoch, id = session.id;
    const value = await call('GET', 'session', undefined, version);
    try { validSession(value, id); } catch (error) { clear(); throw error; }
    session = value; csrf = value.csrf; return publicSession();
  }
  async function task(path, input) {
    check(taskPaths.has(path), 'AGENT_API_ROUTE_REFUSED'); requireSession();
    check(input && typeof input === 'object' && !Array.isArray(input), 'AGENT_API_INPUT_REFUSED');
    const body = structuredClone(input), version = epoch;
    // Task creation is not owner authority. This client never acquires TOTP,
    // saves ON/OFF, or invents an approval. Existing-grant status/resume remain
    // available; test authorize is accepted only by the server's scoped policy.
    check(path !== 'authorize' || body.code === '', 'AGENT_API_HUMAN_FACTOR_REFUSED');
    let attempt = null;
    if (path === 'execute') {
      check(['taskDigest', 'childDigest'].every(k => /^0x[0-9a-f]{64}$/.test(body[k])) &&
        typeof body.operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(body.operationId), 'AGENT_API_INPUT_REFUSED');
      attempt = JSON.stringify([body.taskDigest, body.childDigest, body.operationId]);
      check(!attempted.has(attempt), 'AGENT_API_OUTCOME_UNKNOWN_RECONCILE_ONLY');
      check(attempted.size < 10_000, 'AGENT_API_ATTEMPT_LIMIT'); attempted.add(attempt);
    }
    try { return await call('POST', `tasks/${path}`, body, version); }
    catch (error) {
      // An execute transport loss is not proof of failure. The durable server
      // journal is authoritative; do not retry execute, reauthorize or cancel.
      if (attempt !== null) throw new AgentApiError('AGENT_API_OUTCOME_UNKNOWN_RECONCILE_ONLY');
      throw error instanceof AgentApiError ? error : new AgentApiError('AGENT_API_TRANSPORT_UNAVAILABLE');
    }
  }
  async function logout() {
    const version = epoch, hadSession = session !== null;
    try { if (hadSession) await call('POST', 'logout', {}, version); }
    finally { if (version === epoch) clear(); }
  }
  return Object.freeze({ authenticate, checkSession, task, logout, cancel: clear });
}

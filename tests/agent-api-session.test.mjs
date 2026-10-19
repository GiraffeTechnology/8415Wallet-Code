/** Synthetic handler and bounded loopback HTTP tests; no browser, production
 * endpoint, real wallet/RPC, credential files or transaction submission. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { Wallet } from 'ethers';
import { createAgentApiSession, createAgentHttpTransport } from '../server/agent-api-session.mjs';
import { createAuthService } from '../server/auth-service.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { freezeChildOperation } from '../src/agent/taskContract.ts';
import { freezeTaskObservationPolicy } from '../src/agent/receiptObservation.ts';
import { digest } from '../server/crypto.mjs';
import { taskVerificationPolicyKey } from '../server/task-verification-state.mjs';

const origin = 'https://wallet.example.invalid', tenant = 'example', chainId = '560048';
const epoch = 1_800_000_000_000, hash = c => '0x' + c.repeat(64), recipient = '0x' + '2'.repeat(40);
async function fixture(options = {}) {
  const origin = options.origin ?? 'https://wallet.example.invalid';
  const wallet = Wallet.createRandom(), actor = wallet.address.toLowerCase();
  const state = { now: epoch, loginSigns: 0, sends: 0, recoveries: 0, requests: [], cancelled: false };
  const store = new MemoryCredentialStore(options.noCredential ? {} : { 'example:alice': { revision: 7 } });
  const executor = { schema: '8415-task-executor/1', agentId: 'synthetic:agent', agentVersion: '1',
    adapterId: 'synthetic:adapter', adapterVersion: '1', implementationDigest: hash('9') };
  const observation = freezeTaskObservationPolicy({ minimumConfirmations: '2' });
  const verifier = { verifierId: 'synthetic:receipt', verifierVersion: '1', verifierImplementationDigest: hash('7') };
  const binding = input => ({ taskDigest: input.task.digest, childDigest: input.child.digest, chainId, actor,
    nonce: input.child.child.nonce, executorDigest: input.executor.digest, grantPolicyVersion: input.grantPolicyVersion });
  const handler = createAuthService({ origin, tenant, accounts: [{ username: 'alice', wallets: [
    { account: actor, chainId }, { account: actor, chainId: '8453' }] }], store, now: () => state.now,
    taskExecutorIdentity: executor, taskObservationPolicy: observation.policy, taskVerificationPolicyEnabled: true,
    taskTestAuthorization: { allows: () => options.testScope !== false },
    taskReceipt: { identity: verifier, observationPolicy: observation,
      async assessChild(input) { return { ...verifier, taskDigest: input.task.digest, childDigest: input.child.digest,
        executorDigest: input.executor.digest, observationPolicyDigest: observation.digest, capability: 'exact-operation-observable' }; },
      async observe() { throw Error('Synthetic receipt evidence not supplied'); } },
    taskExecution: {
      async verify(input) { return binding(input); },
      async send(input) { state.sends++; if (options.unknown) throw Error('Synthetic lost dispatch response');
        return { ...binding(input), transactionHash: hash('a') }; },
      async recover(input) { state.recoveries++; return { ...binding(input), state: 'submitted', transactionHash: hash('a') }; },
    } });
  const transport = { async request(input) {
    state.requests.push({ path: input.path, method: input.method, fields: Object.keys(input.body ?? {}) });
    const req = Readable.from(input.body === undefined ? [] : [Buffer.from(JSON.stringify(input.body))]);
    Object.assign(req, { method: input.method, url: input.path, socket: { remoteAddress: '127.0.0.1' },
      headers: Object.fromEntries(Object.entries({ host: 'wallet.example.invalid', 'content-type': 'application/json',
        ...input.headers }).map(([key, value]) => [key.toLowerCase(), value])) });
    const result = { headers: {} };
    await handler(req, { setHeader(key, value) { result.headers[key.toLowerCase()] = value; },
      set statusCode(value) { result.status = value; }, end(value) { result.data = JSON.parse(value); } });
    const set = result.headers['set-cookie']; if (typeof set === 'string') result.headers['set-cookie'] = [set];
    if (options.tamper) await options.tamper(input, result, state);
    return result;
  } };
  const signer = { async signLoginMessage(input) { state.loginSigns++;
    assert.equal(input.purpose, 'login'); assert.equal(input.account, wallet.address); assert.equal(input.chainId, chainId);
    if (options.beforeSign) await options.beforeSign(input, state);
    return (options.wrongSigner ? Wallet.createRandom() : wallet).signMessage(input.message);
  } };
  const client = createAgentApiSession({ origin, tenant, account: actor, chainId, loginSigner: signer, transport, now: () => state.now });
  const policy = { schema: '8415-agent-task/1', taskId: 'synthetic:api-task', origin, tenant, chainId, actor,
    expiresAt: String(epoch / 1000 + 7200), fees: { perOperationWei: '100000', totalWei: '200000' },
    intent: { kind: 'exact-operation', operation: { kind: 'native-transfer', chainId, actor, recipient, valueWei: '10' } } };
  async function authorize() {
    const p = await client.task('prepare', { policy });
    assert.equal(p.approvalFactor, options.testScope === false ? 'preoperational-default-on' : 'server-test-scope');
    return client.task('authorize', { challengeId: p.challengeId, taskDigest: p.task.digest,
      executorDigest: p.executor.digest, observationPolicyDigest: p.observationPolicy.digest, code: '' });
  }
  const child = task => ({ schema: '8415-agent-child/1', operationId: 'synthetic:api-operation', taskDigest: task.digest,
    operation: task.policy.intent.operation, nonce: '7', expiresAt: String(epoch / 1000 + 600),
    wire: { to: recipient, calldataHash: '0xc5d2460186f7233c927e7db2dcc703c0e500b653ca82273b7bfad8045d85a470', valueWei: '10' },
    fees: { gasLimit: '21000', maxFeePerGasWei: '2' }, market: null });
  const reserve = g => client.task('reserve', { taskDigest: g.task.digest, child: child(g.task), expectedBudgetRevision: g.budget.revision });
  const operation = g => ({ taskDigest: g.task.digest, operationId: child(g.task).operationId,
    childDigest: freezeChildOperation(child(g.task)).digest, expectedBudgetRevision: g.budget.revision });
  return { client, state, store, wallet, actor, policy, authorize, reserve, operation, transport, signer, handler, background: handler.taskBackground };
}

test('address and chain authenticate through APIs with no username, UI, browser or provider session', async () => {
  const f = await fixture(), session = await f.client.authenticate();
  assert.equal(session.account, f.wallet.address); assert.equal(session.transactionAuthority, false);
  assert.equal(session.csrf, undefined); assert.equal(session.username, undefined);
  assert.equal((await f.client.checkSession()).sessionId, session.sessionId);
  assert.equal(f.state.loginSigns, 1); assert.equal(f.state.sends, 0);
  assert.deepEqual(f.state.requests.slice(0, 3).map(x => x.path), ['/auth/bootstrap', '/auth/challenge', '/auth/proof']);
  assert.ok(f.state.requests.every(x => !x.fields.includes('username')));
});
test('default ON executes a server-authorized task without settings writes or extra human proof', async () => {
  const f = await fixture(); await f.client.authenticate(); const g = await f.reserve(await f.authorize());
  assert.equal(g.humanVerification.mode, 'ON'); assert.equal(g.humanVerification.revision, '0');
  const result = await f.client.task('execute', f.operation(g));
  assert.equal(result.outcome, 'submitted'); assert.equal(f.state.sends, 1); assert.equal(f.state.loginSigns, 1);
  assert.equal((await f.store.read('example:alice')).taskVerificationPolicies, undefined);
  assert.ok(f.state.requests.every(x => !x.path.startsWith('/auth/account/') && !x.path.includes('operation-verification')));
});
for (const field of ['account', 'chainId', 'tenant', 'origin', 'message', 'expiresAt'])
  test(`challenge ${field} mismatch is refused before invoking the signer`, async () => {
    const f = await fixture({ tamper(input, response) {
      if (input.path !== '/auth/challenge') return;
      response.data[field] = field === 'expiresAt' ? epoch : field === 'chainId' ? '8453' : field === 'message' ? 'Approve transaction' : 'wrong';
    } });
    await assert.rejects(f.client.authenticate(), /CHALLENGE_REFUSED|LOGIN_PURPOSE_REFUSED/);
    assert.equal(f.state.loginSigns, 0); assert.equal(f.state.requests.some(x => x.path === '/auth/proof'), false);
  });
test('wrong-wallet signature is refused locally without submitting a login proof', async () => {
  const f = await fixture({ wrongSigner: true }); await assert.rejects(f.client.authenticate(), /LOGIN_SIGNATURE_REFUSED/);
  assert.equal(f.state.requests.some(x => x.path === '/auth/proof'), false);
});
test('proof expiry while signing never sends the late proof', async () => {
  const f = await fixture({ beforeSign(input, state) { state.now = input.expiresAt; } });
  await assert.rejects(f.client.authenticate(), /LOGIN_SIGNATURE_REFUSED/);
  assert.equal(f.state.requests.some(x => x.path === '/auth/proof'), false);
});
test('cancel during signing discards the proof and cannot reestablish a session', async () => {
  let client; const f = await fixture({ beforeSign() { client.cancel(); } }); client = f.client;
  await assert.rejects(client.authenticate(), /CONTEXT_CANCELLED/);
  await assert.rejects(client.task('list', {}), /AUTHENTICATION_REQUIRED/);
  assert.equal(f.state.requests.some(x => x.path === '/auth/proof'), false);
});
test('wrong-chain returned session is rejected rather than silently selecting Base', async () => {
  const f = await fixture({ tamper(input, response) { if (input.path === '/auth/proof') response.data.chainId = '8453'; } });
  await assert.rejects(f.client.authenticate(), /SESSION_REFUSED/);
  await assert.rejects(f.client.task('list', {}), /AUTHENTICATION_REQUIRED/);
});
test('logout and expiry remove API state without UI login or automatic reauthentication', async () => {
  const f = await fixture(); await f.client.authenticate(); await f.client.logout();
  await assert.rejects(f.client.task('list', {}), /AUTHENTICATION_REQUIRED/);
  await f.client.authenticate(); f.state.now += 900_000;
  await assert.rejects(f.client.task('list', {}), /SESSION_REFUSED/); assert.equal(f.state.loginSigns, 2);
});
test('API client cannot save owner settings or solicit TOTP while native default ON remains unlocked', async () => {
  const f = await fixture({ testScope: false }); await f.client.authenticate();
  await assert.rejects(f.client.task('account/task-verification/on', {}), /ROUTE_REFUSED/);
  await assert.rejects(f.client.task('authorize', { code: '123456' }), /HUMAN_FACTOR_REFUSED/);
  const g = await f.authorize(); assert.equal(g.effectiveStatus, 'authorized');
  assert.equal(g.humanVerification.revision, '0'); assert.equal(f.state.sends, 0);
  assert.equal((await f.store.read('example:alice')).taskVerificationPolicies, undefined);
});
test('UNKNOWN reconciles once without execute replay, human prompt or duplicate send', async () => {
  const f = await fixture({ unknown: true }); await f.client.authenticate(); const g = await f.reserve(await f.authorize());
  const body = f.operation(g), unknown = await f.client.task('execute', body);
  assert.equal(unknown.outcome, 'outcome-unknown');
  await assert.rejects(f.client.task('execute', body), /OUTCOME_UNKNOWN_RECONCILE_ONLY/);
  const resumed = await f.client.task('resume', { taskDigest: g.task.digest });
  assert.equal(resumed.budget.reservations[0].status, 'submitted');
  assert.equal(f.state.sends, 1); assert.equal(f.state.recoveries, 1); assert.equal(f.state.loginSigns, 1);
});
test('transport loss during execute is unknown, never retried, and does not leak its error', async () => {
  const f = await fixture(); const transport = { async request(input) {
    if (input.path === '/auth/tasks/execute') throw Error('secret transport detail'); return f.transport.request(input);
  } };
  const c = createAgentApiSession({ origin, tenant, account: f.actor, chainId, transport, loginSigner: f.signer, now: () => f.state.now });
  await c.authenticate(); const body = { taskDigest: hash('1'), childDigest: hash('2'), operationId: 'synthetic:lost', expectedBudgetRevision: '0' };
  await assert.rejects(c.task('execute', body), /OUTCOME_UNKNOWN_RECONCILE_ONLY/);
  await assert.rejects(c.task('execute', body), /OUTCOME_UNKNOWN_RECONCILE_ONLY/);
});
test('a saved effective ON is retained; no client-side default disables the owner lock', async () => {
  const f = await fixture(); await f.client.authenticate(); const g = await f.reserve(await f.authorize());
  const scope = { origin, tenant, username: 'alice', account: f.actor, chainId, agentId: 'synthetic:agent' };
  const record = { schema: '8415-task-human-verification/2', scope, mode: 'ON', revision: '1', enforcedFromRevision: '1',
    changes: [{ revision: '1', previousRevision: '0', mode: 'ON', changeId: 'A'.repeat(43), changeDigest: 'a'.repeat(64),
      scopeDigest: digest(JSON.stringify(scope)), credentialRevision: 7,
      verifiedFactors: ['wallet', 'verified-email'], changedAt: epoch - 1 }] };
  await f.store.transaction('example:alice', value => ({ ...value, taskVerificationPolicies: { [taskVerificationPolicyKey(scope)]: record } }));
  // The explicit existing test grant remains exempt; that is server authority,
  // not the client rewriting the saved ON setting or claiming human verification.
  await f.client.task('execute', f.operation(g));
  assert.deepEqual((await f.store.read('example:alice')).taskVerificationPolicies[taskVerificationPolicyKey(scope)], record);
});
test('Node transport refuses nonloopback HTTP, redirects-as-routes and TLS bypass configuration', () => {
  assert.throws(() => createAgentHttpTransport({ origin: 'http://example.invalid' }));
  assert.throws(() => createAgentHttpTransport({ origin, timeoutMs: 0 }));
  const t = createAgentHttpTransport({ origin });
  assert.throws(() => t.request({ method: 'GET', path: '//evil.invalid/auth/session', headers: {} }), /ROUTE_REFUSED/);
});

for (const [method, path] of [['checkSession', '/auth/session'], ['logout', '/auth/logout']]) {
  test(`${method} sanitizes injected transport failures without leaking private details`, async () => {
    const f = await fixture();
    const transport = { async request(input) {
      if (input.path === path) throw Error('synthetic private transport credential detail');
      return f.transport.request(input);
    } };
    const client = createAgentApiSession({ origin, tenant, account: f.actor, chainId,
      loginSigner: f.signer, transport, now: () => f.state.now });
    await client.authenticate();
    await assert.rejects(client[method](), error => {
      assert.equal(error.code, 'AGENT_API_TRANSPORT_UNAVAILABLE');
      assert.equal(error.message, 'AGENT_API_TRANSPORT_UNAVAILABLE');
      assert.doesNotMatch(error.message, /private|credential|synthetic/);
      return true;
    });
    if (method === 'logout') await assert.rejects(client.task('list', {}), /AUTHENTICATION_REQUIRED/);
  });
}

test('a real saved ON before ordinary task preparation does not inherit the unlocked revision-zero path', async () => {
  const f = await fixture({ testScope: false }); await f.client.authenticate();
  const scope = { origin, tenant, username: 'alice', account: f.actor, chainId, agentId: 'synthetic:agent' };
  const record = { schema: '8415-task-human-verification/2', scope, mode: 'ON', revision: '1', enforcedFromRevision: '1',
    changes: [{ revision: '1', previousRevision: '0', mode: 'ON', changeId: 'A'.repeat(43), changeDigest: 'a'.repeat(64),
      scopeDigest: digest(JSON.stringify(scope)), credentialRevision: 7,
      verifiedFactors: ['wallet', 'verified-email'], changedAt: epoch - 1 }] };
  await f.store.transaction('example:alice', value => ({ ...value,
    taskVerificationPolicies: { [taskVerificationPolicyKey(scope)]: record } }));
  const prepared = await f.client.task('prepare', { policy: f.policy });
  assert.equal(prepared.approvalFactor, 'totp');
  await assert.rejects(f.client.task('authorize', { challengeId: prepared.challengeId, taskDigest: prepared.task.digest,
    executorDigest: prepared.executor.digest, observationPolicyDigest: prepared.observationPolicy.digest, code: '' }),
    /TASK_AUTHENTICATOR_REQUIRED/);
  assert.deepEqual((await f.store.read('example:alice')).taskVerificationPolicies[taskVerificationPolicyKey(scope)], record);
  assert.equal(f.state.sends, 0);
});

test('wallet-only revision-zero account continues its bounded task after logout without a new credential', async () => {
  const f = await fixture({ testScope: false, noCredential: true });
  await f.client.authenticate();
  const reserved = await f.reserve(await f.authorize());
  assert.equal(reserved.authorization.credentialRevisionAtApproval, '0');
  assert.equal(await f.store.read('example:alice'), null);
  await f.client.logout();
  const queue = await f.background.list(); assert.equal(queue.entries.length, 1);
  const result = await f.background.resume(queue.entries[0]);
  assert.equal(result.continuation.state, 'submitted');
  assert.equal(f.state.sends, 1); assert.equal(f.state.loginSigns, 1);
  assert.equal(await f.store.read('example:alice'), null);
});

/** Actual OS-selected loopback HTTP, still synthetic.
 * No browser, production endpoint, persistent credential or real-chain access.
 * Every server/socket is bounded and closed before its fixture returns.
 */
async function network(t, handler) {
  const server = createServer(handler);
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise((resolve, reject) => server.close(error => error ? reject(error) : resolve())); });
  return { server, origin: `http://127.0.0.1:${server.address().port}` };
}
test('real Node HTTP authenticates with received cookies and session CSRF without a browser', async t => {
  let f; const requests = [];
  const n = await network(t, (req, res) => { requests.push({ path: req.url, hasCookie: Boolean(req.headers.cookie),
    hasCSRF: Boolean(req.headers['x-wallet-csrf']) }); f.handler(req, res); });
  f = await fixture({ origin: n.origin });
  const client = createAgentApiSession({ origin: n.origin, tenant, account: f.actor, chainId,
    loginSigner: f.signer, transport: createAgentHttpTransport({ origin: n.origin }), now: () => f.state.now });
  const session = await client.authenticate(); assert.equal((await client.checkSession()).sessionId, session.sessionId);
  assert.deepEqual(requests.map(x => x.path), ['/auth/bootstrap', '/auth/challenge', '/auth/proof', '/auth/session']);
  assert.equal(requests[0].hasCookie, false);
  assert.ok(requests.slice(1).every(x => x.hasCookie && x.hasCSRF));
  await client.logout(); assert.equal(requests.at(-1).path, '/auth/logout');
  await assert.rejects(client.task('list', {}), /AUTHENTICATION_REQUIRED/);
  assert.equal(f.state.loginSigns, 1); assert.equal(f.state.sends, 0);
});
test('real Node HTTP sends the exact JSON body and boundedly decodes a successful response', async t => {
  const n = await network(t, async (req, res) => {
    const chunks = []; for await (const chunk of req) chunks.push(chunk);
    assert.equal(req.method, 'POST'); assert.equal(req.headers['content-type'], 'application/json');
    res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ observed: JSON.parse(Buffer.concat(chunks).toString()) }));
  });
  const result = await createAgentHttpTransport({ origin: n.origin }).request({ method: 'POST', path: '/auth/tasks/status',
    headers: {}, body: { taskDigest: hash('a') } });
  assert.equal(result.status, 200); assert.deepEqual(result.data, { observed: { taskDigest: hash('a') } });
});
test('real Node HTTP rejects an oversized response without returning partial JSON', async t => {
  const n = await network(t, (_req, res) => res.end(JSON.stringify({ value: 'x'.repeat(4096) })));
  await assert.rejects(createAgentHttpTransport({ origin: n.origin, maxResponseBytes: 64 }).request({
    method: 'GET', path: '/auth/bootstrap', headers: {} }), /AGENT_API_TRANSPORT_UNAVAILABLE/);
});
test('real Node HTTP total timeout bounds a response stream that never ends', async t => {
  let opened;
  const ready = new Promise(resolve => { opened = resolve; });
  const n = await network(t, (_req, res) => { res.writeHead(200, { 'Content-Type': 'application/json' }); res.write('{'); opened(); });
  const request = createAgentHttpTransport({ origin: n.origin, timeoutMs: 200 }).request({ method: 'GET', path: '/auth/bootstrap', headers: {} });
  // Attach the rejection handler before the request can time out under load.
  const rejected = assert.rejects(request, /AGENT_API_TRANSPORT_UNAVAILABLE/);
  await ready; await rejected;
});
test('real Node HTTP explicit abort closes a stalled request without retrying', async t => {
  let opened; const ready = new Promise(resolve => { opened = resolve; }); let calls = 0;
  const n = await network(t, (_req, res) => { calls++; res.writeHead(200); res.write('{'); opened(); });
  const abort = new AbortController(), request = createAgentHttpTransport({ origin: n.origin }).request({
    method: 'GET', path: '/auth/bootstrap', headers: {}, signal: abort.signal });
  const rejected = assert.rejects(request, /AGENT_API_TRANSPORT_UNAVAILABLE/);
  await ready; abort.abort(); await rejected; assert.equal(calls, 1);
});
test('real Node HTTP disconnect is a sanitized error, not successful partial data', async t => {
  const n = await network(t, (req, _res) => req.socket.destroy());
  await assert.rejects(createAgentHttpTransport({ origin: n.origin }).request({ method: 'GET', path: '/auth/bootstrap', headers: {} }),
    error => error.code === 'AGENT_API_TRANSPORT_UNAVAILABLE' && error.message === 'AGENT_API_TRANSPORT_UNAVAILABLE');
});
test('real Node HTTP preserves redirect status and never follows its Location', async t => {
  let calls = 0;
  const n = await network(t, (_req, res) => { calls++; res.writeHead(302, { Location: '/auth/session' }); res.end('{}'); });
  const response = await createAgentHttpTransport({ origin: n.origin }).request({ method: 'GET', path: '/auth/bootstrap', headers: {} });
  assert.equal(response.status, 302); assert.equal(calls, 1);
});
test('client cancellation propagates to the actual pending Node HTTP request', async t => {
  let opened; const ready = new Promise(resolve => { opened = resolve; }); let calls = 0;
  const n = await network(t, (_req, res) => { calls++; res.writeHead(200); res.write('{'); opened(); });
  const client = createAgentApiSession({ origin: n.origin, tenant, account: '0x' + '1'.repeat(40), chainId,
    loginSigner: { signLoginMessage() { assert.fail('must not sign before bootstrap'); } },
    transport: createAgentHttpTransport({ origin: n.origin }) });
  const pending = client.authenticate(), rejected = assert.rejects(pending, /AGENT_API_CONTEXT_CANCELLED/);
  await ready; client.cancel(); await rejected; assert.equal(calls, 1);
  await assert.rejects(client.task('list', {}), /AUTHENTICATION_REQUIRED/);
});

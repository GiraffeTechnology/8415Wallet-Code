/** Synthetic transport regression source; not server execution acceptance. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { AccountAuthClient } from '../web/account-auth.mjs';

interface RequestOptions {
  method: string; credentials: string; cache: string; keepalive: boolean;
  headers: Record<string, string>; body?: string; signal?: AbortSignal;
}
interface RecordedRequest { url: URL; options: RequestOptions; body: unknown; }

interface PreparedRequest {
  schema: string; scope: Record<string, string>; mode: string; expectedRevision: string;
  credentialRevision: number; changeId: string; nonce: string; issuedAt: number; expiresAt: number;
}
async function fixture({ login = true } = {}) {
  const origin = 'https://wallet.example.invalid', tenant = 'synthetic';
  const identity = { account: '0x1111111111111111111111111111111111111111', chainId: '1' };
  const scope = { origin, tenant, username: 'tester', ...identity, agentId: 'synthetic-agent' };
  const requests: RecordedRequest[] = [];
  const state: { gate: Promise<void> | null; error: { status: number; code: string } | null; failure: Error | null;
    transform: ((action: string, value: Record<string, unknown>) => unknown) | null } =
    { gate: null, error: null, failure: null, transform: null };
  let prepared: PreparedRequest | null = null, preparedMethod = 'password', changeDigest = '', mode = 'ON', revision = '0';
  let lastChange: Record<string, unknown> | null = null;
  const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
  const statusValue = () => ({ schema: lastChange ? '8415-task-human-verification/2' : '8415-task-human-verification/1',
    scope, mode, revision, ...(lastChange ? { enforcedFromRevision: '1' } : {}),
    label: 'Per-operation human verification', appliesTo: 'still-valid-in-scope-authorizations', grantsAuthority: false,
    factorsForOFF: ['password-or-bound-wallet', 'previously-verified-email'],
    factorsForEverySave: ['password-or-bound-wallet', 'previously-verified-email'],
    changeCount: Number(revision), lastChange });
  const client = new AccountAuthClient({ origin, tenant, fetcher: async (url: URL, options: RequestOptions) => {
    const body = options.body === undefined ? undefined : JSON.parse(options.body) as Record<string, string>;
    requests.push({ url, options, body });
    let value: unknown; let status = 200;
    if (url.pathname === '/auth/capabilities') value = { schema: '8415wallet-auth/1', tenant, origin, methods: ['password'] };
    else if (url.pathname === '/auth/bootstrap') value = { csrf: 'synthetic-bootstrap' };
    else if (url.pathname === '/auth/password') value = { ...identity, tenant, origin, username: 'tester', kind: 'password',
      id: 's'.repeat(43), csrf: 'synthetic-session-csrf', issuedAt: Date.now(), expiresAt: Date.now() + 900000 };
    else if (url.pathname === '/auth/logout') value = { loggedOut: true };
    else {
      if (state.gate) await state.gate;
      if (state.failure) throw state.failure;
      if (state.error) { status = state.error.status; value = { error: state.error.code }; }
      else {
        const action = url.pathname.split('/').at(-1)!;
        if (action === 'prepare') {
          assert.ok(body); const issuedAt = Date.now(); preparedMethod = body.identityMethod!;
          prepared = { schema: '8415-task-human-verification-change/2', scope, mode: body.mode!, expectedRevision: body.expectedRevision!,
            credentialRevision: 0, changeId: 'c'.repeat(43), nonce: 'n'.repeat(43), issuedAt, expiresAt: issuedAt + 300000 };
          changeDigest = digest(prepared);
          const message = [`8415wallet owner policy change: Per-operation human verification ${prepared.mode}`,
            `Scope: ${JSON.stringify(scope)}`, 'Applies only to still-valid, in-scope authorizations; no new task authority.',
            prepared.mode === 'OFF' ? 'Preparation, signing, submission, continuation and receipts will not ask again within existing authority.' :
              'Future not-yet-submitted operations use ON verification. Existing submitted/unknown attempts are reconciled without resubmission.',
            `Revision: ${prepared.expectedRevision}`, `Credential revision: ${prepared.credentialRevision}`,
            `Change: ${prepared.changeId}`, `Nonce: ${prepared.nonce}`, `Digest: ${changeDigest}`,
            `Expires at: ${prepared.expiresAt}`, 'Purpose: policy change only; no login, recovery, or transaction signature.'].join('\n');
          value = { request: prepared, changeDigest, identityMethod: body.identityMethod, emailMasked: 't***@example.invalid',
            ...(body.identityMethod === 'wallet' ? { message } : {}) };
        } else if (action === 'verify') {
          assert.ok(prepared); value = { changeId: prepared.changeId, changeDigest, digits: 8,
            emailMasked: 't***@example.invalid', expiresAt: prepared.expiresAt };
        } else if (action === 'confirm') {
          assert.ok(prepared); const previousRevision = revision; revision = (BigInt(revision) + 1n).toString(); mode = prepared.mode;
          lastChange = { revision, previousRevision, mode, changeId: prepared.changeId, changeDigest, scopeDigest: digest(scope),
            credentialRevision: 0, verifiedFactors: [preparedMethod, 'verified-email'], changedAt: Date.now() };
          value = statusValue();
        } else if (action === 'cancel') value = { cancelled: true };
        else value = statusValue();
        if (state.transform) value = state.transform(action, value as Record<string, unknown>);
      }
    }
    return { ok: status >= 200 && status < 300, status,
      headers: { get: () => '1' }, text: async () => JSON.stringify(value) };
  } });
  const authenticate = () => client.adapter('password', { username: 'tester', password: 'synthetic-only-password' }).authenticate(identity, null);
  if (login) await authenticate();
  return { client, origin, tenant, requests, state, authenticate,
    prepare: (mode = 'OFF', identityMethod = 'password') => client.taskVerification('prepare', { mode, expectedRevision: revision, identityMethod }),
    policyRequests: () => requests.filter(request => request.url.pathname.startsWith('/auth/account/task-verification/')) };
}

test('documented policy routes retain prepared binding and use same-origin POST JSON with abort signals', async () => {
  const f = await fixture();
  const send = async (action: string, body: Record<string, string>) => {
    const signal = new AbortController().signal;
    const result = await f.client.taskVerification(action, body, { signal });
    const request = f.policyRequests().at(-1); assert.ok(request);
    assert.equal(request.url.href, `${f.origin}/auth/account/task-verification/${action}`);
    assert.equal(request.options.method, 'POST'); assert.equal(request.options.credentials, 'same-origin');
    assert.equal(request.options.cache, 'no-store'); assert.equal(request.options.keepalive, false);
    assert.equal(request.options.headers['Content-Type'], 'application/json');
    assert.equal(request.options.headers['X-Wallet-Tenant'], f.tenant);
    assert.equal(request.options.headers['X-Wallet-CSRF'], 'synthetic-session-csrf');
    assert.equal(request.options.signal, signal); assert.deepEqual(request.body, body);
    return result;
  };
  assert.equal((await send('status', {})).mode, 'ON');
  let revision = '0';
  for (const [mode, identityMethod] of [['OFF', 'password'], ['ON', 'wallet']]) {
    const prepared = await send('prepare', { mode: mode!, identityMethod: identityMethod!, expectedRevision: revision });
    const proof = { changeId: prepared.request.changeId, changeDigest: prepared.changeDigest };
    await send('verify', identityMethod === 'password' ? { ...proof, password: 'synthetic-only-password' } :
      { ...proof, signature: '0x' + 'a'.repeat(130) });
    const committed = await send('confirm', { ...proof, code: '01234567' });
    assert.equal(committed.mode, mode); revision = committed.revision;
  }
  assert.deepEqual(await send('cancel', {}), { cancelled: true });
  assert.equal(f.policyRequests().length, 8);
});

test('policy transport rejects no-session, retired route, malformed fields and omitted mode without sending', async () => {
  const f = await fixture({ login: false });
  await assert.rejects(f.client.taskVerification('status', {}), { code: 'LOGIN_REQUIRED' });
  await f.authenticate();
  for (const action of ['on', 'unknown', '../change/commit', 'status?mode=OFF']) {
    await assert.rejects(f.client.taskVerification(action, {}), { code: 'AUTH_ROUTE_REFUSED' });
  }
  const invalid: Array<[string, unknown]> = [
    ['status', { mode: 'OFF' }], ['cancel', { changeId: 'unexpected' }], ['status', []], ['status', null],
    ['prepare', { expectedRevision: '0', identityMethod: 'password' }],
    ['prepare', { mode: 'OFF', expectedRevision: '00', identityMethod: 'password' }],
    ['prepare', { mode: 'OFF', expectedRevision: '-1', identityMethod: 'password' }],
    ['prepare', { mode: 'OFF', expectedRevision: (1n << 256n).toString(), identityMethod: 'password' }],
    ['prepare', { mode: 'OFF', expectedRevision: '0', identityMethod: 'totp' }],
    ['prepare', { mode: 'OFF', expectedRevision: '0', identityMethod: 'wallet', scope: { account: 'replacement' } }],
    ['verify', { changeId: 'id', changeDigest: 'digest', password: 'secret', signature: 'signature' }],
    ['verify', { changeId: 'id', changeDigest: 'digest' }],
    ['confirm', { changeId: 'id', changeDigest: 'digest', code: '1234567' }],
    ['confirm', { changeId: 'id', changeDigest: 'digest', code: '123456789' }],
  ];
  for (const [action, body] of invalid) await assert.rejects(f.client.taskVerification(action, body), { code: 'TASK_VERIFICATION_INPUT_REFUSED' });
  let evaluated = false;
  const getter = Object.defineProperty({}, 'mode', { enumerable: true, get() { evaluated = true; return 'OFF'; } });
  await assert.rejects(f.client.taskVerification('prepare', getter), { code: 'TASK_VERIFICATION_INPUT_REFUSED' });
  assert.equal(evaluated, false); assert.equal(f.policyRequests().length, 0);
});

test('documented policy errors preserve status but account routes gain no task retry metadata', async () => {
  const f = await fixture();
  for (const error of [
    { status: 503, code: 'AUTH_POLICY_AGENT_SCOPE_UNAVAILABLE' },
    { status: 409, code: 'TASK_VERIFICATION_REVISION_CONFLICT' },
    { status: 403, code: 'TASK_VERIFICATION_FACTOR_REFUSED' },
    { status: 429, code: 'TASK_VERIFICATION_RATE_LIMITED' },
  ]) {
    f.state.error = error;
    await assert.rejects(f.client.taskVerification('status', {}), (value: unknown) => {
      const actual = value as { code?: string; status?: number; retryAfterMs?: number };
      assert.equal(actual.code, error.code); assert.equal(actual.status, error.status);
      assert.equal(actual.retryAfterMs, undefined); return true;
    });
  }
  f.state.error = { status: 409, code: 'TASK_UNRELATED_ROUTE' };
  await assert.rejects(f.client.taskVerification('status', {}), { code: 'LOGIN_SERVICE_UNAVAILABLE' });
  f.state.error = { status: 409, code: 'TASK_VERIFICATION_REVISION_CONFLICT' };
  await assert.rejects(f.client.request('account/password', {}), { code: 'LOGIN_SERVICE_UNAVAILABLE' });
  f.state.error = { status: 503, code: 'FORWARD_PROGRESS_UNAVAILABLE' };
  await assert.rejects(f.client.request('assets/forward-progress', {}), { code: 'FORWARD_PROGRESS_UNAVAILABLE' });
  assert.equal(f.policyRequests().length, 5, 'No account policy error is automatically retried');
});

test('aborted policy reads are refused before transport and late ignored-signal responses are discarded', async () => {
  const f = await fixture(), early = new AbortController(); early.abort();
  await assert.rejects(f.client.taskVerification('status', {}, { signal: early.signal }), { code: 'LOGIN_CANCELLED' });
  assert.equal(f.policyRequests().length, 0);
  let release!: () => void; f.state.gate = new Promise<void>(resolve => { release = resolve; });
  const late = new AbortController(), pending = f.client.taskVerification('status', {}, { signal: late.signal });
  late.abort(); release();
  await assert.rejects(pending, { code: 'LOGIN_CANCELLED' });
  assert.equal(f.policyRequests().length, 1);
});

test('logout and replacement authentication discard in-flight policy responses', async () => {
  for (const transition of ['logout', 'authenticate']) {
    const f = await fixture(); let release!: () => void;
    f.state.gate = new Promise<void>(resolve => { release = resolve; });
    const pending = f.client.taskVerification('status', {});
    if (transition === 'logout') await f.client.logout(); else await f.authenticate();
    release();
    await assert.rejects(pending, (value: unknown) => ['LOGIN_REQUIRED', 'LOGIN_SESSION_CHANGED'].includes((value as { code: string }).code));
    assert.equal(f.policyRequests().length, 1);
  }
});

test('uncertain confirm response is surfaced once, without automatic replay or cancellation', async () => {
  const f = await fixture(), prepared = await f.prepare();
  const failure = new Error('synthetic connection loss'); f.state.failure = failure;
  await assert.rejects(f.client.taskVerification('confirm', { changeId: prepared.request.changeId,
    changeDigest: prepared.changeDigest, code: '12345678' }), failure);
  assert.deepEqual(f.policyRequests().map(value => value.url.pathname.split('/').at(-1)), ['prepare', 'confirm']);
});

test('candidate scope, revision, factor and prepare/confirm guards remain active', async () => {
  const f = await fixture();
  await assert.rejects(f.client.taskVerification('verify', { changeId: 'id', changeDigest: 'digest', password: 'synthetic' }),
    { code: 'LOGIN_SERVICE_BINDING_REFUSED' });
  assert.equal(f.policyRequests().length, 0);
  const prepared = await f.prepare();
  f.state.transform = (action, value) => action === 'confirm' ? { ...value, scope: { ...(value.scope as object), agentId: 'replacement-agent' } } : value;
  await assert.rejects(f.client.taskVerification('confirm', { changeId: prepared.request.changeId,
    changeDigest: prepared.changeDigest, code: '12345678' }), { code: 'LOGIN_SERVICE_BINDING_REFUSED' });
  f.state.transform = (_action, value) => ({ ...value, lastChange: { ...(value.lastChange as object), verifiedFactors: [] } });
  await assert.rejects(f.client.taskVerification('status', {}), { code: 'LOGIN_SERVICE_BINDING_REFUSED' });
  f.state.transform = (_action, value) => ({ ...value, revision: '00' });
  await assert.rejects(f.client.taskVerification('status', {}), { code: 'LOGIN_SERVICE_BINDING_REFUSED' });
});

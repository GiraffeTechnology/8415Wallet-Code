import * as nativeI18n from '../web/native-i18n.mjs';
import * as uiI18n from '../web/i18n.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { recoveryGuidance } from '../src/xiongan/recoveryView.ts';
import { isAddressInput } from '../src/xiongan/address.ts';
import { reviewAgentRequest } from '../src/xiongan/agentRequest.ts';

// Executes the actual UI handlers with deterministic provider/DOM boundaries.
// This is a connection-lifecycle regression, not genuine wallet/UI acceptance.
const source = readFileSync(new URL('../web/app.mjs', import.meta.url), 'utf8')
  .replace(/^import[\s\S]*?;\r?\n/gm, '');
const address = `0x${'1'.repeat(40)}`;
const digest = `0x${'2'.repeat(64)}`;
function deferred() {
  let resolve!: (value?: any) => void;
  const promise = new Promise<any>(r => { resolve = r; });
  return { promise, resolve };
}
class CollisionScanErrorStub extends Error {
  code: string;
  limit: number | undefined;
  constructor(code: string, limit?: number) {
    super(limit === undefined ? code : `${code}: limit ${limit}`);
    this.code = code;
    this.limit = limit;
  }
}

function fixture(profile = 'v3') {
  const elements = new Map<string, any>(), events = new Map<string, (event?: any) => void>();
  const element = (id: string) => {
    if (!elements.has(id)) elements.set(id, { value: '1', textContent: '', checked: false,
      files: [], disabled: false, dataset: {}, handlers: new Map(),
      addEventListener(name: string, fn: () => Promise<void>) { this.handlers.set(name, fn); } });
    return elements.get(id);
  };
  const actions = ['account', 'read', 'reserve-payment', 'standalone-withdraw', 'create-account', 'deposit', 'open-sequence', 'complete'].map(name => {
    const node = element(name); node.dataset.action = name; return node;
  });
  const reads = [element('read-asset'), element('read-collisions')];
  reads[0].dataset.read = 'asset'; reads[1].dataset.read = 'collisions';
  const hooks: Record<'request' | 'chain' | 'verify' | 'status' | 'read' | 'collisions' | 'prepare' | 'accept' | 'execute' | 'settlementPrepare' | 'settlementSubmit', () => Promise<any>> = {
    request: async () => [address], chain: async () => '0x88bb0', verify: async () => undefined,
    status: async () => ({ status: 'idle' }), read: async () => 'current asset',
    prepare: async () => ({ digest, consent: {} }), accept: async () => 'memory-only-signature',
    execute: async () => ({ submitted: true }), settlementPrepare: async () => ({ digest, summary: 'Review settlement', preflight: { checks: [], blocking: [], unverifiable: [], consequences: [] } }), settlementSubmit: async () => digest, collisions: async () => ({ scopeNote: 'only these tokens', collisions: [] }),
  };
  let executions = 0, prepares = 0, accepts = 0, settlementSends = 0;
  let collisionIds: bigint[] = [];
  const provider = { request: async () => undefined, on(name: string, fn: () => void) { events.set(name, fn); } };
  class ControlAdapterError extends Error { code: string; constructor(code: string) { super(code); this.code = code; } }
  class Session {
    consent = { prepare: () => { prepares++; return hooks.prepare(); }, accept: () => { accepts++; return hooks.accept(); } };
    accounts = { account: () => hooks.read() };
    status() { return hooks.status(); }
    execute() { executions++; return hooks.execute(); }
  }
  const document = { getElementById: element, querySelectorAll(selector: string) {
    return selector === '[data-action]' ? actions : selector === '[data-read]' ? reads : [...elements.values()];
  } };
  // Capture real mount contracts here; panel internals retain their own suites.
  const mounts = new Map<string, { root: unknown; login: unknown; getContext: () => any }>();
  const mount = (name: string) => (options: { root: unknown; login: unknown; getContext: () => any }) => {
    assert.equal(mounts.has(name), false, `duplicate mount: ${name}`);
    assert.equal(typeof options.getContext, 'function');
    mounts.set(name, options);
  };
  let authenticationChanged: ((session: any, reason: string) => void) | null = null;
  const sdk = { ...uiI18n, ...nativeI18n,
    // Authentication is isolated in wallet-login.test.ts and the full browser suite.
    walletLogin: { assert() {}, check: async () => {}, provider: () => provider, subscribe(listener: (session: any, reason: string) => void) { authenticationChanged = listener; } }, WalletLoginError: class extends Error {},
    ResponsibilityWalletSession: Session, ControlAdapterError, isAddressInput, TransactionWouldRevertError: class extends Error {},
    getReleaseProfile: async () => { if (profile === 'blocked') throw new Error('RELEASE_LOCATION_MISMATCH'); return ({ product: '8415wallet', platform: '8415wallet.com', version: '3.0.0-beta', tenant: { label: 'None' }, features: { linkedResponsibilities: profile === 'v3' } }); },
    StandaloneSettlementSession: class { status() { return Promise.resolve({ status: 'idle' }); }
      prepare() { return hooks.settlementPrepare(); } submit() { settlementSends++; return hooks.settlementSubmit(); } }, BrowserSettlementStore: class {}, recoveryGuidance, reviewAgentRequest, acquireWalletUi: () => Symbol(), releaseWalletUi: () => {},
    WalletSession: class {
      assetView() { return hooks.read(); }
      collisions(ids: bigint[]) { collisionIds = ids; return hooks.collisions(); }
    },
    RpcErc8415Reader: class {}, Eip1193ReadTransport: class {}, BrowserPublicOperationStore: class {},
    renderAssetView: (v: unknown) => typeof v === 'string' ? v : JSON.stringify(v),
    renderCollisions: (v: unknown) => JSON.stringify(v),
    // The fixture strips app.mjs imports and injects every name the source
    // uses, so each optional panel mounted at load time needs an entry here.
    // Without one the sandbox throws ReferenceError before any handler runs,
    // which fails every case in this file rather than the panel's own tests.
    // The panels are covered by their own suites; these stubs only let the
    // connection lifecycle under test execute.
    mountAssetWorkspace: mount('asset-workspace'),
    mountAuditExport: mount('audit-export'),
    mountFeedContinuity: mount('feed-continuity'),
    mountWatchtowerRead: mount('watchtower-read'),
    mountKitRead: mount('kit-read'),
    COLLISION_SCAN_MAX_TOKENS: 32,
    // The page reads code and limit off this, so the stub carries both.
    CollisionScanError: CollisionScanErrorStub,
    verifyControlDeployment: () => hooks.verify(),
    controlRpc: (_p: unknown, method: string) => method === 'eth_requestAccounts' ? hooks.request() : hooks.chain(),
  };
  const state = new Function('document', 'globalThis', ...Object.keys(sdk), `${source}
    return () => ({ connected: plainWallet !== null, linked: session !== null, actor,
      reviewed: review !== null, signed: signed !== null, settlementReviewed: settlementReview !== null, busy });`)(document, { ethereum: provider, addEventListener: (name: string, fn: (event: unknown) => void) => events.set(name, fn) }, ...Object.values(sdk));
  const click = async (id: string, event = 'click') => element(id).handlers.get(event)();
  const file = (id: string, data: unknown) => { element(id).files = [{ size: 1, text: async () => JSON.stringify(data) }]; };
  file('deployment', { schema: '8415-controls-testnet/1', chainId: '560048',
    token: { address, runtimeCodeHash: digest }, controller: { address, runtimeCodeHash: digest }, payment: null });
  file('consent-file', { consent: { expectedRevision: '0', tokenId: '1', deadline: '1', recipientNonce: '0', paymentAmount: '0' },
    documents: { incoming: { terms: { scheme: 'utf8-keccak256' } }, inherited: [] } });
  return { mounts, login: sdk.walletLogin, authChange: (reason: string) => authenticationChanged!(null, reason), hooks, element, click, state, collisionIds: () => collisionIds, emit: (event: string, value?: unknown) => events.get(event)!(value),
    counts: () => ({ executions, prepares, accepts, settlementSends }),
    load: () => click('deployment', 'change'),
    async connect() { await click('deployment', 'change'); await click('connect'); },
    async sign() { await click('review'); element('acknowledge').checked = true; await click('accept'); } };
}

for (const phase of ['request', 'chain', 'verify', 'status'] as const) {
  test(`account event during connection ${phase} cannot resurrect the old session`, { timeout: 5000 }, async () => {
    const f = fixture(); await f.load(); const gate = deferred(), entered = deferred();
    f.hooks[phase] = () => { entered.resolve(); return gate.promise; };
    const pending = f.click('connect'); await entered.promise;
    f.emit('accountsChanged'); gate.resolve(phase === 'request' ? [address] : phase === 'chain' ? '0x88bb0' : {});
    await pending;
    assert.equal(f.state().connected, false); assert.equal(f.state().linked, false); assert.equal(f.state().actor, null);
    assert.equal(f.element('result').textContent, 'CONTROL_CONNECTION_CHANGED');
    assert.equal(f.counts().executions, 0);
  });
}
test('failed reconnect cannot retain the prior connected session', async () => {
  const f = fixture(); await f.connect(); assert.equal(f.state().connected, true);
  f.hooks.request = async () => { throw new Error('private provider diagnostic'); };
  await f.click('connect'); assert.equal(f.state().connected, false);
  assert.equal(f.element('result').textContent, 'CONTROL_UI_OPERATION_REFUSED');
});

test('collision review reads the explicit token set without any send', async () => {
  const f = fixture(); await f.connect();
  f.element('collision-token-ids').value = '1, 2,3';
  f.element('tokenId').value = 'unrelated input';
  await f.click('read-collisions');
  assert.deepEqual(f.collisionIds(), [1n, 2n, 3n]);
  assert.match(f.element('result').textContent, /only these tokens/);
  assert.equal(f.counts().executions, 0);
});

test('collision review rejects duplicate, empty and malformed input before scanning', async () => {
  const f = fixture(); await f.connect();
  f.hooks.collisions = async () => { assert.fail('must not scan'); };
  for (const input of ['', '1,1', '1,', '-1', '1.5', '0x1', Array(33).fill('1').join(',')]) {
    f.element('collision-token-ids').value = input;
    await f.click('read-collisions');
    assert.deepEqual(f.collisionIds(), []);
    assert.match(f.element('result').textContent, /REFUSED/);
  }
});

test('each refused collision input states the bound it met and the value asked', async () => {
  const f = fixture(); await f.connect();
  f.hooks.collisions = async () => { assert.fail('must not scan'); };
  // Too many tokens: the page states the scan's own budget, not a copy.
  f.element('collision-token-ids').value = Array(33).fill('1').join(',');
  await f.click('read-collisions');
  assert.equal(f.element('result').textContent,
    'COLLISION_TOKEN_BUDGET_REFUSED: at most 32 tokens, asked 33');
  // Too long a field: a different fault, with its own number.
  f.element('collision-token-ids').value = Array(1300).fill('1').join(',');
  await f.click('read-collisions');
  assert.equal(f.element('result').textContent,
    'COLLISION_TOKEN_INPUT_REFUSED: at most 2560 characters, received 2599');
  // Empty is neither: nothing was asked, so there is no figure to state.
  f.element('collision-token-ids').value = '';
  await f.click('read-collisions');
  assert.equal(f.element('result').textContent, 'COLLISION_TOKEN_INPUT_REFUSED');
  assert.deepEqual(f.collisionIds(), []);
});

test('a scan refusal reaches the page with the limit it enforced', async () => {
  const f = fixture(); await f.connect();
  f.hooks.collisions = async () => { throw new CollisionScanErrorStub('COLLISION_ENTRY_BUDGET_REFUSED', 2048); };
  f.element('collision-token-ids').value = '1,2';
  await f.click('read-collisions');
  assert.equal(f.element('result').textContent, 'COLLISION_ENTRY_BUDGET_REFUSED: limit 2048');
  // A refusal with no limit still shows exactly its code, with nothing appended.
  f.hooks.collisions = async () => { throw new CollisionScanErrorStub('COLLISION_DUPLICATE_TOKEN_REFUSED'); };
  await f.click('read-collisions');
  assert.equal(f.element('result').textContent, 'COLLISION_DUPLICATE_TOKEN_REFUSED');
});

test('late collision result is discarded after a wallet change', { timeout: 5000 }, async () => {
  const f = fixture(); await f.connect();
  const gate = deferred(), entered = deferred();
  f.hooks.collisions = () => { entered.resolve(); return gate.promise; };
  f.element('collision-token-ids').value = '1,2';
  const pending = f.click('read-collisions');
  await entered.promise;
  f.emit('accountsChanged'); gate.resolve({ stale: true }); await pending;
  assert.equal(f.element('result').textContent, 'CONTROL_CONNECTION_CHANGED');
});

test('unavailable collision data is not rendered as a clean report or raw error', async () => {
  const f = fixture(); await f.connect();
  f.hooks.collisions = async () => { throw new Error('private provider diagnostic'); };
  f.element('collision-token-ids').value = '1,2';
  await f.click('read-collisions');
  assert.equal(f.element('result').textContent, 'CONTROL_UI_OPERATION_REFUSED');
  assert.equal(f.counts().executions, 0);
});
test('delayed review cannot restore stale terms after an account change', { timeout: 5000 }, async () => {
  const f = fixture(); await f.connect(); const gate = deferred(), entered = deferred();
  f.hooks.prepare = () => { entered.resolve(); return gate.promise; };
  const pending = f.click('review'); await entered.promise; f.emit('accountsChanged');
  gate.resolve({ digest, consent: {} }); await pending;
  assert.equal(f.state().reviewed, false); assert.equal(f.element('terms').textContent, 'No review prepared');
  assert.equal(f.element('acknowledge').checked, false);
});
test('delayed signature is discarded after an account change and cannot be forwarded', async () => {
  const f = fixture(); await f.connect(); await f.click('review');
  f.element('acknowledge').checked = true; const gate = deferred(); f.hooks.accept = () => gate.promise;
  const pending = f.click('accept'); f.emit('accountsChanged'); gate.resolve('never-display-this'); await pending;
  assert.equal(f.state().signed, false); await f.click('connect'); await f.click('forward');
  assert.equal(f.counts().executions, 0); assert.equal(f.element('result').textContent, 'CONTROL_IN_MEMORY_CONSENT_REQUIRED');
});
test('completed acceptance survives intentional same-chain seller switching', async () => {
  const f = fixture(); await f.connect(); await f.sign(); assert.equal(f.state().signed, true);
  f.emit('accountsChanged'); await f.click('connect'); await f.click('forward');
  assert.equal(f.counts().executions, 1); assert.equal(f.state().signed, false);
});
for (const event of ['chainChanged', 'disconnect']) {
  test(`${event} clears completed in-memory acceptance as well as review`, async () => {
    const f = fixture(); await f.connect(); await f.sign(); f.emit(event);
    assert.equal(f.state().signed, false); assert.equal(f.state().reviewed, false);
    assert.equal(f.state().connected, false); assert.equal(f.element('terms').textContent, 'No review prepared');
  });
}
test('deployment reload clears completed acceptance', async () => {
  const f = fixture(); await f.connect(); await f.sign(); await f.load();
  assert.equal(f.state().signed, false); assert.equal(f.state().connected, false);
});
test('late read does not overwrite the connection-change result', async () => {
  const f = fixture(); await f.connect(); const gate = deferred(); f.hooks.read = () => gate.promise;
  const pending = f.click('account'); f.emit('accountsChanged'); gate.resolve('stale account'); await pending;
  assert.equal(f.element('result').textContent, 'CONTROL_CONNECTION_CHANGED');
});
test('late send result is not attributed to the new account and is never retried', async () => {
  const f = fixture(); await f.connect(); await f.sign(); const gate = deferred(), entered = deferred(); f.hooks.execute = () => { entered.resolve(); return gate.promise; };
  const pending = f.click('forward'); await entered.promise; f.emit('accountsChanged'); gate.resolve({ submitted: true }); await pending;
  assert.equal(f.counts().executions, 1); assert.equal(f.element('result').textContent, 'CONTROL_CONNECTION_CHANGED');
  await f.click('connect'); assert.equal(f.counts().executions, 1);
});

for (const state of ['reviewed', 'signed']) test(`consent file change invalidates ${state} and clears all terms`, async () => {
  const f = fixture(); await f.connect();
  if (state === 'signed') await f.sign(); else { await f.click('review'); f.element('acknowledge').checked = true; }
  await f.click('consent-file', 'change');
  assert.equal(f.state().reviewed, false); assert.equal(f.state().signed, false);
  assert.equal(f.element('terms').textContent, 'No review prepared'); assert.equal(f.element('acknowledge').checked, false);
  await f.click('accept'); await f.click('forward'); assert.equal(f.counts().executions, 0);
});
test('failed replacement review clears earlier displayed terms', async () => {
  const f = fixture(); await f.connect(); await f.click('review');
  f.hooks.prepare = async () => { throw new Error('private failure'); }; await f.click('review');
  assert.equal(f.element('terms').textContent, 'No review prepared'); assert.equal(f.state().reviewed, false);
});
for (const phase of ['prepare', 'accept'] as const) test(`file change while ${phase} is pending cannot restore stale consent`, async () => {
  const f = fixture(); await f.connect();
  if (phase === 'accept') { await f.click('review'); f.element('acknowledge').checked = true; }
  const gate = deferred(), entered = deferred(); f.hooks[phase] = () => { entered.resolve(); return gate.promise; };
  const pending = f.click(phase === 'prepare' ? 'review' : 'accept'); await entered.promise;
  await f.click('consent-file', 'change'); gate.resolve(phase === 'prepare' ? { digest, consent: {} } : 'memory-signature'); await pending;
  assert.equal(f.state().reviewed, false); assert.equal(f.state().signed, false); assert.equal(f.element('terms').textContent, 'No review prepared');
});
test('consent dismiss clears acceptance and repeated actions cannot revive it', async () => {
  const f = fixture(); await f.connect(); await f.sign(); await f.click('consent-dismiss');
  for (let i = 0; i < 2; i++) { await f.click('accept'); await f.click('forward'); }
  assert.equal(f.state().signed, false); assert.equal(f.counts().executions, 0);
});
test('manual withdrawal validates mixed-case checksum before normalization', async () => {
  const f = fixture(); await f.connect();
  const valid = '0x5aAeb6053F3E94C9b9A09f33669435E7Ef1BeAed';
  f.element('destination').value = valid.slice(0, -1) + 'c'; await f.click('standalone-withdraw');
  assert.equal(f.element('result').textContent, 'CONTROL_ADDRESS_REFUSED'); assert.equal(f.counts().executions, 0);
  for (const destination of [valid, valid.toLowerCase(), `0x${valid.slice(2).toUpperCase()}`]) {
    f.element('destination').value = destination; await f.click('standalone-withdraw');
  }
  assert.equal(f.counts().executions, 3);
});

test('V2 preserves optional account operations and recovery session but refuses linked entry points', async () => {
  const f = fixture('v2'); await f.connect(); assert.equal(f.state().linked, true);
  for (const action of ['account', 'create-account', 'deposit']) await f.click(action);
  assert.equal(f.counts().executions, 2);
  for (const action of ['open-sequence', 'complete', 'reserve-payment', 'review', 'accept', 'forward']) {
    await f.click(action); assert.equal(f.element('result').textContent, 'CONTROL_RELEASE_PROFILE_REFUSED');
  }
  assert.equal(f.counts().executions, 2); assert.equal(f.element('linked-tab').hidden, true);
  assert.equal(f.element('controlled-account-actions').hidden, false);
});

async function prepareSettlement(f: ReturnType<typeof fixture>) {
  f.element('settlement-kind').value = 'beginSettlement'; f.element('settlement-id').value = digest;
  f.element('settlement-holder').value = address; f.element('settlement-snapshot').value = digest;
  f.element('settlement-deadline').value = '1234'; await f.click('settlement-prepare');
}
test('standalone settlement review has separate acknowledgement, is consumed once and can be dismissed', async () => {
  const f = fixture(); await f.connect(); await prepareSettlement(f); assert.equal(f.state().settlementReviewed, true);
  await f.click('settlement-send'); assert.equal(f.counts().settlementSends, 0);
  f.element('settlement-ack').checked = true; await f.click('settlement-send'); await f.click('settlement-send');
  assert.equal(f.counts().settlementSends, 1); assert.equal(f.element('settlement-terms').textContent, 'No settlement reviewed');
  await prepareSettlement(f); f.element('settlement-ack').checked = true; await f.click('settlement-dismiss'); await f.click('settlement-send');
  assert.equal(f.counts().settlementSends, 1);
});
for (const id of ['settlement-kind', 'settlement-id', 'settlement-holder', 'settlement-snapshot', 'settlement-deadline',
  'settlement-commitment', 'settlement-reference', 'settlement-effective', 'settlement-proof', 'settlement-reason', 'tokenId']) {
  test(`${id} edit clears settlement review and acknowledgement`, async () => {
    const f = fixture(); await f.connect(); await prepareSettlement(f); f.element('settlement-ack').checked = true;
    await f.click(id, 'input'); assert.equal(f.state().settlementReviewed, false); assert.equal(f.element('settlement-ack').checked, false);
    await f.click('settlement-send'); assert.equal(f.counts().settlementSends, 0);
  });
}
test('a failed or late settlement Prepare cannot leave stale terms active', async () => {
  const f = fixture(); await f.connect(); await prepareSettlement(f); f.hooks.settlementPrepare = async () => { throw new Error('private diagnostic'); };
  await prepareSettlement(f); assert.equal(f.element('settlement-terms').textContent, 'No settlement reviewed');
  const gate = deferred(), entered = deferred(); f.hooks.settlementPrepare = () => { entered.resolve(); return gate.promise; };
  const pending = prepareSettlement(f); await entered.promise; await f.click('settlement-id', 'change'); gate.resolve({ digest }); await pending;
  assert.equal(f.state().settlementReviewed, false); assert.equal(f.element('settlement-terms').textContent, 'No settlement reviewed');
});
for (const event of ['pagehide', 'pageshow']) test(`${event} clears reviews and acceptance before history restoration`, async () => {
  const f = fixture(); await f.connect(); await f.sign(); await prepareSettlement(f); f.emit(event, { persisted: true });
  assert.equal(f.state().connected, false); assert.equal(f.state().signed, false); assert.equal(f.state().settlementReviewed, false);
});
test('failed release profile refuses wallet connection and leaves every signing path closed', async () => {
  const f = fixture('blocked'); await f.connect(); assert.equal(f.state().connected, false);
  assert.equal(f.element('result').textContent, 'CONTROL_RELEASE_PROFILE_REFUSED');
  await f.click('settlement-send'); await f.click('forward'); assert.equal(f.counts().settlementSends, 0); assert.equal(f.counts().executions, 0);
});

test('verified V3 recipient acceptance remains separate from login across an account switch', async () => {
  const f = fixture(); await f.connect(); await f.sign(); f.authChange('LOGIN_ACCOUNT_CHANGED');
  assert.equal(f.state().signed, true); assert.equal(f.state().reviewed, false); assert.equal(f.state().connected, false);
  assert.equal(f.element('terms').textContent, 'No review prepared');
  f.authChange('LOGIN_STARTING'); await f.click('connect'); await f.click('forward'); assert.equal(f.counts().executions, 1);
});
for (const reason of ['LOGIN_REQUIRED', 'LOGIN_EXPIRED', 'LOGIN_CHAIN_CHANGED', 'LOGIN_DISCONNECTED']) test(`login invalidation ${reason} clears completed consent too`, async () => {
  const f = fixture(); await f.connect(); await f.sign(); f.authChange(reason);
  assert.equal(f.state().signed, false); assert.equal(f.state().connected, false); assert.equal(f.element('result').textContent, 'Log in to view assets and history.');
});


test('all additive panel mount contexts retain login and connection invalidation boundaries', async () => {
  const f = fixture();
  assert.deepEqual([...f.mounts.keys()], ['asset-workspace', 'audit-export', 'feed-continuity', 'watchtower-read', 'kit-read']);
  for (const options of f.mounts.values()) {
    assert.strictEqual(options.login, f.login);
    assert.strictEqual(options.root, f.element('wallet-private'));
    assert.throws(() => options.getContext(), /CONTROL_CONNECTION_REQUIRED/);
  }
  await f.connect();
  const contexts = [...f.mounts.values()].map(options => options.getContext());
  for (const context of contexts) {
    assert.equal(context.tokenId, 1n);
    assert.strictEqual(context.wallet, contexts[0].wallet);
  }
  f.emit('accountsChanged');
  for (const options of f.mounts.values()) assert.throws(() => options.getContext(), /CONTROL_CONNECTION_/);
  assert.equal(f.counts().executions, 0);
  assert.equal(f.counts().settlementSends, 0);
});

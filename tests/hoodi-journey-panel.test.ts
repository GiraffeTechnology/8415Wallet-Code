import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeLogin, Node, SECRET } from './helpers/readonly-panel-harness.mjs';

/**
 * The Hoodi evidence panel builds its card at module scope and reads the
 * walletLogin singleton, so a real import yields one panel per process and no
 * control over the session. app.mjs has that same shape, and the established
 * fixture for it strips the imports and injects every name the source uses
 * (tests/browser-connection.test.ts); this file follows it.
 *
 * Not loading the panel's own `../dist/browser/browser.js` import is what
 * keeps this suite inside npm test, which runs before the browser build. That
 * the real module and that import resolve and are served is covered after the
 * build by tests/task-static-module-closure.test.mjs, which walks the served
 * closure of every index.html module entry, app.mjs among them.
 */
const source = readFileSync(new URL('../web/hoodi-journey-panel.mjs', import.meta.url), 'utf8');
const body = source.replace(/^import[\s\S]*?;\r?\n/gm, '');
assert.doesNotMatch(body, /^\s*import\b/m, 'an import statement survived the strip');

/** Every name the source imports, so an added import fails by name below. */
const importedNames = [...source.matchAll(/^import\s*\{([^}]*)\}/gm)]
  .flatMap(match => (match[1] ?? '').split(','))
  .map(name => (name.trim().split(/\s+as\s+/).pop() ?? '').trim())
  .filter(name => name.length > 0)
  .sort();

const ACCOUNT = `0x${'ab'.repeat(20)}`;
/** The manifest spells the same account in mixed case on purpose. */
const MANIFEST_ACCOUNT = `0x${'Ab'.repeat(20)}`;
const OTHER_ACCOUNT = `0x${'cd'.repeat(20)}`;
const TENANT = 'xiongan';
const RENDERED = 'original v2 and later v3 compared';

const session = (overrides: Record<string, unknown> = {}) =>
  ({ account: ACCOUNT, chainId: '560048', tenant: TENANT, ...overrides });

/** Integer-typed fields are decimal strings; the panel's reviver converts them. */
const evidence = () => ({
  original: {
    manifest: {
      chainId: '560048', tokenId: '7',
      wallets: [{ account: OTHER_ACCOUNT, tenant: 'giraffe' }, { account: MANIFEST_ACCOUNT, tenant: TENANT }],
    },
    release: { version: '2', recordedAt: '1700000000', blockNumber: '10', effectiveAt: '1700000000' },
  },
  laterV3: { version: '3', recordedAt: '1700000100', blockNumber: '20', effectiveAt: '1700000100' },
});

const fileOf = (value: unknown, size?: number) => {
  const text = typeof value === 'string' ? value : JSON.stringify(value);
  return { size: size ?? text.length, text: async () => text };
};

const flush = async () => {
  for (let turn = 0; turn < 8; turn += 1) await new Promise(resolve => setImmediate(resolve));
};

type Hooks = { open?: (...args: unknown[]) => unknown; compare?: (...args: unknown[]) => unknown };

function mount(options: { withHost?: boolean; login?: any; hooks?: Hooks } = {}) {
  const { withHost = true, hooks = {} } = options;
  const login = options.login ?? fakeLogin(session());
  const host = new Node();
  let created = 0;
  const document = {
    getElementById: (id: string) => (withHost && id === 'wallet-private' ? host : undefined),
    createElement: () => { created += 1; return new Node(); },
  };
  const windowEvents = new Node();
  const state = { opens: 0, compares: 0, renders: 0, openArgs: [] as unknown[], compareArgs: [] as unknown[] };
  const sandbox: Record<string, unknown> = {
    walletLogin: login,
    openHoodiJourneyRead: async (...args: unknown[]) => {
      state.opens += 1; state.openArgs = args;
      return hooks.open ? await hooks.open(...args) : { pinned: true };
    },
    compareHoodiReleaseHistory: async (...args: unknown[]) => {
      state.compares += 1; state.compareArgs = args;
      return hooks.compare ? await hooks.compare(...args) : { report: true };
    },
    renderHoodiReleaseHistory: (report: unknown) => {
      state.renders += 1;
      assert.deepEqual(report, { report: true }, 'the panel must render the compared report');
      return RENDERED;
    },
  };
  const sandboxNames = Object.keys(sandbox).sort();
  new Function('document', 'globalThis', ...Object.keys(sandbox), body)(
    document, { addEventListener: windowEvents.addEventListener.bind(windowEvents) },
    ...Object.values(sandbox),
  );
  const nodes = host.descendants();
  const find = (match: (node: any) => boolean) => nodes.find(match);
  return {
    host, login, state, windowEvents, sandboxNames, created,
    card: host.children[0],
    input: find(node => node.type === 'file'),
    button: find(node => node.textContent === 'Compare authenticated Hoodi history'),
    output: find(node => node.getAttribute('aria-live') === 'polite'),
    select(value: unknown, size?: number) {
      (find(node => node.type === 'file') as any).files = [fileOf(value, size)];
    },
  };
}

test('the fixture injects exactly the names the panel imports', () => {
  assert.deepEqual(mount().sandboxNames, importedNames);
});

test('no private host mounts no panel at all', () => {
  const panel = mount({ withHost: false });
  assert.equal(panel.created, 0);
  assert.deepEqual(panel.host.children, []);
  assert.equal(panel.login.subscriberCount(), 0);
  assert.deepEqual(panel.windowEvents.handlers.size, 0);
});

test('a mounted panel exposes one read-only evidence card', () => {
  const panel = mount();
  assert.equal(panel.host.children.length, 1);
  assert.equal(panel.card?.getAttribute('aria-label'), 'Hoodi original release and late register history');
  assert.equal(panel.input?.accept, '.json,application/json');
  assert.ok(panel.button, 'the panel must expose its compare control');
  assert.equal(panel.output?.textContent, '');
  assert.equal(panel.login.subscriberCount(), 1);
  assert.deepEqual([...panel.windowEvents.handlers.keys()].sort(), ['pagehide', 'pageshow']);
});

test('a signed-out session disables the card', () => {
  const login = fakeLogin(session());
  login.logout();
  const panel = mount({ login });
  assert.equal(panel.button?.disabled, true);
  assert.equal(panel.input?.disabled, true);
});

/**
 * Each fixture is a valid envelope with exactly one defect, so only the guard
 * under test can refuse it. An envelope that a second guard would also reject
 * passes this suite even when the guard under test is gone.
 */
const hexInteger = () => {
  const value = evidence();
  return { ...value, original: { ...value.original, manifest: { ...value.original.manifest, tokenId: '0x7' } } };
};
const numericInteger = () => JSON.stringify(evidence()).replace('"tokenId":"7"', '"tokenId":7');

for (const refusal of [
  { label: 'no file selected' },
  { label: 'an oversized file', value: evidence(), size: 65537 },
  { label: 'a hexadecimal integer field', value: hexInteger() },
  { label: 'a numeric integer field', value: numericInteger() },
  { label: 'a missing envelope half', value: { original: evidence().original } },
  { label: 'an extra envelope key', value: { ...evidence(), extra: 1 } },
] as { label: string; value?: unknown; size?: number }[]) {
  test(`${refusal.label} refuses before any authenticated read`, async () => {
    const panel = mount();
    if ('value' in refusal) panel.select(refusal.value, refusal.size);
    panel.button?.click();
    await flush();
    assert.equal(panel.state.opens, 0, 'a refused envelope must not reach the pinned read');
    assert.equal(panel.output?.textContent, 'HOODI_EVIDENCE_UNAVAILABLE');
    for (const node of panel.host.descendants()) {
      assert.doesNotMatch(node.textContent, /560048|0x7|"original"/, 'file content reached the page');
    }
  });
}

for (const mismatch of [
  { label: 'another chain', session: session({ chainId: '1' }) },
  { label: 'an account outside the manifest', session: session({ account: `0x${'ef'.repeat(20)}` }) },
  { label: 'a tenant the manifest wallet does not carry', session: session({ tenant: 'other' }) },
]) {
  test(`a session on ${mismatch.label} refuses before any authenticated read`, async () => {
    const panel = mount({ login: fakeLogin(mismatch.session) });
    panel.select(evidence());
    panel.button?.click();
    await flush();
    assert.equal(panel.state.opens, 0);
    assert.equal(panel.output?.textContent, 'HOODI_EVIDENCE_UNAVAILABLE');
  });
}

test('the manifest wallet matches case-insensitively and the comparison renders', async () => {
  const panel = mount();
  panel.select(evidence());
  panel.button?.click();
  await flush();
  assert.equal(panel.state.opens, 1);
  assert.equal(panel.state.compares, 1);
  assert.equal(panel.state.renders, 1);
  const [provider, manifest] = panel.state.openArgs as [unknown, any];
  assert.equal(provider, panel.login.provider(), 'the pinned read must use the session provider');
  assert.equal(manifest.chainId, 560048n, 'integer fields must arrive as integers, not strings');
  assert.equal(manifest.tokenId, 7n);
  const [original, laterV3, pinned] = panel.state.compareArgs as [any, any, unknown];
  assert.equal(original.manifest, manifest, 'the compared original must be the read manifest owner');
  assert.equal(original.release.version, 2n);
  assert.equal(laterV3.version, 3n);
  assert.deepEqual(pinned, { pinned: true });
  assert.equal(panel.output?.textContent, RENDERED);
});

test('a failed authenticated read shows only its own message', async () => {
  const panel = mount({ hooks: { open: () => { throw new Error(SECRET); } } });
  panel.select(evidence());
  panel.button?.click();
  await flush();
  assert.equal(panel.state.opens, 1, 'the read refused earlier, so this proves nothing about leaking');
  assert.equal(panel.state.renders, 0);
  assert.equal(panel.output?.textContent, 'HOODI_EVIDENCE_UNAVAILABLE');
  for (const node of panel.host.descendants()) {
    assert.doesNotMatch(node.textContent, new RegExp(SECRET), 'backend text reached the page');
  }
});

/** Holds one stage of the read open so staleness can arrive during it. */
function deferredAt(stage: 'open' | 'compare') {
  let release = () => {};
  const value = stage === 'open' ? { pinned: true } : { report: true };
  const hook = () => new Promise(resolve => { release = () => resolve(value); });
  return { hooks: stage === 'open' ? { open: hook } : { compare: hook }, release: () => release() };
}

test('a pending read refuses re-entry even when its control is dispatched again', async () => {
  const held = deferredAt('open');
  const panel = mount({ hooks: held.hooks });
  panel.select(evidence());
  panel.button?.click();
  await flush();
  assert.equal(panel.button?.disabled, true, 'a pending read must disable its control');
  // A disabled control hides the handler's own guard, so dispatch past it.
  panel.button?.dispatchEvent({ type: 'click' });
  await flush();
  assert.equal(panel.state.opens, 1, 'the pending read was entered twice');
  held.release();
  await flush();
  assert.equal(panel.state.compares, 1);
});

for (const stage of ['open', 'compare'] as const) {
  test(`a logout during the ${stage} stage discards the result`, async () => {
    const held = deferredAt(stage);
    const panel = mount({ hooks: held.hooks });
    panel.select(evidence());
    panel.button?.click();
    await flush();
    panel.login.logout();
    held.release();
    await flush();
    assert.equal(panel.state.renders, 0, 'a stale session still reached the page');
    // Refusing to show the result is not enough: a session that changed must
    // not carry the read on into the next stage either.
    assert.equal(panel.state.compares, stage === 'compare' ? 1 : 0,
      'a stale session continued into the comparison');
    assert.equal(panel.output?.textContent, '');
  });

  test(`a silent session change during the ${stage} stage discards the result`, async () => {
    const held = deferredAt(stage);
    const panel = mount({ hooks: held.hooks });
    panel.select(evidence());
    panel.button?.click();
    await flush();
    // Nothing clears the card here: only the binding asserts stand in the way.
    panel.login.expire();
    held.release();
    await flush();
    assert.equal(panel.state.renders, 0, 'a read bound to a replaced session reached the page');
    assert.equal(panel.state.compares, stage === 'compare' ? 1 : 0,
      'a read bound to a replaced session continued into the comparison');
    assert.equal(panel.output?.textContent, '');
  });

  test(`a new file selection during the ${stage} stage discards the earlier result`, async () => {
    const held = deferredAt(stage);
    const panel = mount({ hooks: held.hooks });
    panel.select(evidence());
    panel.button?.click();
    await flush();
    panel.input?.dispatchEvent({ type: 'change' });
    held.release();
    await flush();
    assert.equal(panel.state.renders, 0, 'a superseded selection still rendered');
    assert.equal(panel.state.compares, stage === 'compare' ? 1 : 0,
      'a superseded selection continued into the comparison');
    assert.equal(panel.output?.textContent, '');
  });
}

for (const clearing of [
  { label: 'logout', fire: (panel: any) => panel.login.logout() },
  { label: 'pagehide', fire: (panel: any) => panel.windowEvents.dispatchEvent({ type: 'pagehide' }) },
  { label: 'pageshow', fire: (panel: any) => panel.windowEvents.dispatchEvent({ type: 'pageshow' }) },
]) {
  test(`${clearing.label} clears the reported failure`, async () => {
    const panel = mount();
    panel.select(evidence(), 65537);
    panel.button?.click();
    await flush();
    assert.equal(panel.output?.textContent, 'HOODI_EVIDENCE_UNAVAILABLE');
    // Set by the browser, not by the panel: an empty value would prove nothing.
    (panel.input as any).value = 'picked-evidence.json';
    clearing.fire(panel);
    await flush();
    assert.equal(panel.output?.textContent, '', 'stale evidence state survived a clearing event');
    assert.equal(panel.input?.value, '', 'the chosen file survived a clearing event');
  });
}

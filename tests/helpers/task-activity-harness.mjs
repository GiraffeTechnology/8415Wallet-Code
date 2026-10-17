import assert from 'node:assert/strict';
import test from 'node:test';

import { mountTaskActivity } from '../../web/task-activity-ui.mjs';
import { Node } from './readonly-panel-harness.mjs';

/**
 * The read-only task activity overview.
 *
 * web/task-ui.mjs mounts it and nothing executed it. Unlike the other panels
 * it takes a client rather than a selection context, and it stays inert until
 * the tasks page is actually shown, so it gets its own fixture.
 *
 * It needs the browser build: task-activity-ui imports task-authorization,
 * which imports four modules from dist/browser. Only the direct imports were
 * checked at first, which put this suite in npm test, where it failed on a
 * clean checkout. The whole relative-import closure decides where a suite can
 * run, not the entry module's own import list.
 */

const SECRET = 'SAVED_TASK_DETAIL_THAT_MUST_NOT_REACH_THE_PAGE';
const UNAVAILABLE =
  'Activity unavailable. Sign in again or restart from the first page; no action was sent.';

// A boolean rather than an optional serverId: a destructuring default fires on
// an explicit undefined, so the no-server case kept getting a server anyway.
function fixture({ withServer = true } = {}) {
  const host = new Node();
  const documentEvents = new Node();
  const windowEvents = new Node();
  const byId = new Map([['task-page', host]]);
  const document = {
    visibilityState: 'visible',
    getElementById: id => byId.get(id),
    createElement: () => new Node(),
    addEventListener: documentEvents.addEventListener.bind(documentEvents),
    dispatchEvent: documentEvents.dispatchEvent.bind(documentEvents),
  };
  const window = { addEventListener: windowEvents.addEventListener.bind(windowEvents) };

  let session = withServer
    ? { account: '0xowner', chainId: '1', serverId: 'server-1' }
    : { account: '0xowner', chainId: '1' };
  let generation = 0;
  const listeners = [];
  const walletLogin = {
    assert(binding) {
      if (session === null) throw new Error('LOGIN_REQUIRED');
      if (binding !== undefined && binding.generation !== generation) throw new Error('LOGIN_SESSION_CHANGED');
      return session;
    },
    capture() { walletLogin.assert(); return Object.freeze({ generation }); },
    async check() { walletLogin.assert(); },
    subscribe(fn) { listeners.push(fn); return () => {}; },
    logout() { session = null; generation += 1; for (const fn of listeners) fn(null, 'LOGIN_REQUIRED'); },
    subscriberCount() { return listeners.length; },
  };

  let requests = 0;
  const client = {
    supportsPasswordManagement: true,
    supportsMethodManagement: true,
    async request() { requests += 1; throw new Error(SECRET); },
  };
  let clientReads = 0;
  mountTaskActivity({
    document, window, walletLogin,
    getClient: () => { clientReads += 1; return client; },
  });
  return { host, document, documentEvents, windowEvents, walletLogin,
    requests: () => requests, clientReads: () => clientReads,
    showTasks: () => documentEvents.dispatchEvent({ type: 'wallet:page', detail: 'tasks' }) };
}

const flush = async () => {
  for (let turn = 0; turn < 8; turn += 1) await new Promise(resolve => setImmediate(resolve));
};
const statusOf = host => {
  const found = host.descendants().find(node => node.getAttribute('role') === 'status');
  assert.ok(found, 'the panel must expose a status region');
  return found;
};
const buttonOf = (host, label) => {
  const found = host.descendants().find(node => node.textContent === label);
  assert.ok(found, `the panel must expose its ${label} control`);
  return found;
};
const FIRST_PAGE = 'Read first activity page';

export function runTaskActivityCases() {
  test('mounts nothing when the task page is absent', () => {
    const absent = new Node();
    const events = new Node();
    mountTaskActivity({
      document: {
        visibilityState: 'visible', getElementById: () => undefined, createElement: () => new Node(),
        addEventListener: events.addEventListener.bind(events),
      },
      window: { addEventListener: () => {} },
      walletLogin: { subscribe: () => {} },
      getClient: () => { throw new Error('must not be reached'); },
    });
    assert.deepEqual(absent.children, []);
  });

  test('mounts one panel, registers a logout subscriber and starts with no next page', () => {
    const f = fixture();
    assert.equal(f.host.children.length, 1);
    assert.equal(f.walletLogin.subscriberCount(), 1);
    assert.equal(buttonOf(f.host, 'Read next activity page').disabled, true);
  });

  test('reads nothing until the tasks page is shown', async () => {
    const f = fixture();
    buttonOf(f.host, FIRST_PAGE).click();
    await flush();
    assert.equal(f.clientReads(), 0, 'an unshown panel must not reach for a client');
    assert.equal(f.requests(), 0);
    assert.equal(statusOf(f.host).textContent, '');
  });

  test('a failed read reports the fixed message and leaks no saved detail', async () => {
    const f = fixture();
    f.showTasks();
    buttonOf(f.host, FIRST_PAGE).click();
    await flush();
    assert.ok(f.requests() > 0, 'the read never reached the client, so this proves nothing about leaking');
    assert.equal(statusOf(f.host).textContent, UNAVAILABLE);
    for (const node of f.host.descendants()) {
      assert.doesNotMatch(node.textContent, new RegExp(SECRET), 'saved task detail reached the page');
    }
  });

  test('a session without a server refuses before any request', async () => {
    const f = fixture({ withServer: false });
    f.showTasks();
    buttonOf(f.host, FIRST_PAGE).click();
    await flush();
    assert.equal(f.requests(), 0, 'a session with no server must not be asked for task status');
    assert.equal(statusOf(f.host).textContent, UNAVAILABLE);
  });

  test('a repeated click while reading does not issue a second request', async () => {
    const f = fixture();
    f.showTasks();
    const read = buttonOf(f.host, FIRST_PAGE);
    read.click();
    read.click();
    await flush();
    assert.equal(f.requests(), 1, 'a repeat click started a second read');
  });

  for (const clearing of [
    { label: 'logout', fire: f => f.walletLogin.logout() },
    { label: 'leaving the tasks page', fire: f => f.documentEvents.dispatchEvent({ type: 'wallet:page', detail: 'overview' }) },
    { label: 'the page becoming hidden', fire: f => { f.document.visibilityState = 'hidden'; f.documentEvents.dispatchEvent({ type: 'visibilitychange' }); } },
    { label: 'pagehide', fire: f => f.windowEvents.dispatchEvent({ type: 'pagehide' }) },
  ]) {
    test(`${clearing.label} clears the reported failure`, async () => {
      const f = fixture();
      f.showTasks();
      buttonOf(f.host, FIRST_PAGE).click();
      await flush();
      assert.equal(statusOf(f.host).textContent, UNAVAILABLE);
      clearing.fire(f);
      await flush();
      assert.equal(statusOf(f.host).textContent, '', 'stale state survived a clearing event');
    });
  }

}

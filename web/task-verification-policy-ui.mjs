/**
 * Human policy settings presentation only. No endpoint, persisted browser policy,
 * credential, task grant, or execution capability is implemented by this module.
 *
 * The injected adapter is an application-owned, independently verified bridge.
 * Its read/change interface below is a LOCAL VIEW CONTRACT, not a server schema.
 * read({ binding, signal }) must use an authenticated, uncached authoritative read
 * and return only the explicitly allowed presentation fields. changeState stays
 * unknown until any previously requested policy change has been reconciled.
 * change({ binding, signal, expectedRevision, expectedScopeKey, mode }) must perform
 * human secondary authentication for BOTH ON and OFF, two established independent
 * factors for OFF, and atomic revision/scope checks at commit. It must never use
 * a session, a browser flag, or the existing unattended policy as that proof.
 * The adapter owns and cancels secret-input UI; no proof is returned here.
 * Abort cannot unsend a request. A settled Promise alone is not reconciliation.
 */
import { paint, presentation } from './i18n.mjs';
import { policyText } from './locales/task-verification-policy.mjs';

const MODES = ['ON', 'OFF'];
const MAX_REVISION = 1n << 256n;
const mounts = new WeakMap();
const refused = () => new Error('TASK_POLICY_VIEW_REFUSED');
const requireValue = condition => { if (!condition) throw refused(); };
function record(value, keys) {
  requireValue(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const descriptors = Object.getOwnPropertyDescriptors(value);
  requireValue(Reflect.ownKeys(descriptors).length === keys.length && keys.every(key =>
    Object.hasOwn(descriptors, key) && Object.hasOwn(descriptors[key], 'value') && descriptors[key].enumerable));
}
function text(value, limit = 256) {
  requireValue(typeof value === 'string' && value.length > 0 && value.length <= limit &&
    !/[\u0000-\u001f\u007f\u202a-\u202e\u2066-\u2069]/u.test(value));
  return value;
}
function revision(value) {
  requireValue(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < MAX_REVISION);
  return value;
}
/** Strict decoder for the bridge's presentation projection; never decode raw HTTP here. */
export function validateTaskVerificationPolicyView(raw, session) {
  record(raw, ['mode', 'revision', 'context', 'scopeKey', 'walletLabel', 'agentId', 'agentLabel',
    'scopeLabel', 'permissions', 'canChange', 'changeState']);
  record(raw.context, ['origin', 'tenant', 'account', 'chainId']);
  requireValue(session && typeof session.serverId === 'string' && session.serverId.length > 0 &&
    typeof session.account === 'string' && /^0x[0-9a-fA-F]{40}$/.test(session.account));
  const context = raw.context;
  requireValue(text(context.origin, 2048) === session.origin && new URL(context.origin).origin === context.origin &&
    text(context.tenant) === session.tenant && text(context.chainId) === session.chainId &&
    typeof context.account === 'string' && /^0x[0-9a-fA-F]{40}$/.test(context.account) &&
    context.account.toLowerCase() === session.account.toLowerCase());
  requireValue(MODES.includes(raw.mode) && typeof raw.canChange === 'boolean' &&
    ['settled', 'unknown'].includes(raw.changeState));
  requireValue(raw.permissions === null ? raw.canChange === false :
    Array.isArray(raw.permissions) && Object.getPrototypeOf(raw.permissions) === Array.prototype && raw.permissions.length <= 128);
  const arrayFields = raw.permissions === null ? null : Object.getOwnPropertyDescriptors(raw.permissions);
  if (arrayFields) requireValue(Reflect.ownKeys(arrayFields).length === raw.permissions.length + 1);
  const permissions = [], ids = new Set();
  for (let index = 0; index < (raw.permissions?.length ?? 0); index++) {
    const property = arrayFields[String(index)];
    requireValue(property && Object.hasOwn(property, 'value') && property.enumerable);
    const permission = property.value; record(permission, ['id', 'label']);
    const id = text(permission.id); requireValue(!ids.has(id)); ids.add(id);
    permissions.push(Object.freeze({ id, label: text(permission.label, 1024) }));
  }
  return Object.freeze({ mode: raw.mode, revision: revision(raw.revision),
    context: Object.freeze({ origin: context.origin, tenant: context.tenant,
      account: session.account, chainId: context.chainId }),
    scopeKey: text(raw.scopeKey, 1024), walletLabel: text(raw.walletLabel),
    agentId: text(raw.agentId), agentLabel: text(raw.agentLabel), scopeLabel: text(raw.scopeLabel, 4096),
    permissions: raw.permissions === null ? null : Object.freeze(permissions), canChange: raw.canChange, changeState: raw.changeState });
}

function sameReview(left, right) { return JSON.stringify(left) === JSON.stringify(right); }
function monotonic(next, prior) {
  if (!prior || next.scopeKey !== prior.scopeKey) return;
  requireValue(BigInt(next.revision) >= BigInt(prior.revision));
  // Within one revision the effective mode, scope and permissions cannot mutate.
  if (next.revision === prior.revision) {
    const content = value => JSON.stringify({ ...value, canChange: null, changeState: null });
    requireValue(content(next) === content(prior));
  }
}

export class TaskVerificationPolicyController {
  #login; #getClient; #onChange; #isVisible; #visible = false; #destroyed = false;
  #epoch = 0; #abort = null; #mutation = null; #unsubscribe; #pending = null;
  #state = Object.freeze({ phase: 'hidden', view: null, draftMode: null, busy: false, notice: null });
  constructor({ walletLogin, getPolicyClient, onChange = () => {}, isVisible = () => true }) {
    this.#login = walletLogin; this.#getClient = getPolicyClient;
    this.#onChange = onChange; this.#isVisible = isVisible;
    this.#unsubscribe = walletLogin.subscribe(() => { void this.invalidate(); });
  }
  snapshot() { return this.#state; }
  #publish(phase, { view = null, draftMode = null, busy = false, notice = null } = {}) {
    this.#state = Object.freeze({ phase, view, draftMode, busy, notice });
    this.#onChange(this.#state);
  }
  #reset() {
    this.#epoch++; this.#abort?.abort(); this.#abort = new AbortController();
    return { epoch: this.#epoch, signal: this.#abort.signal };
  }
  #current(ticket, binding = null, client = null) {
    requireValue(!this.#destroyed && this.#visible && this.#isVisible() &&
      ticket.epoch === this.#epoch && !ticket.signal.aborted);
    if (binding) this.#login.assert(binding);
    if (client) requireValue(this.#getClient() === client);
  }
  async #connect(ticket) {
    this.#current(ticket);
    const binding = this.#login.capture();
    await this.#login.check(); this.#current(ticket, binding);
    const session = this.#login.assert(binding), client = this.#getClient();
    requireValue(typeof session.serverId === 'string' && session.serverId.length > 0);
    if (!client || typeof client.read !== 'function' || typeof client.change !== 'function') {
      throw new Error('TASK_POLICY_ADAPTER_UNAVAILABLE');
    }
    return { binding, session, client };
  }
  async #read(ticket, connection, prior = null) {
    const { binding, session, client } = connection;
    this.#current(ticket, binding, client);
    await this.#login.check(); this.#current(ticket, binding, client);
    const raw = await client.read({ binding, signal: ticket.signal });
    this.#current(ticket, binding, client);
    await this.#login.check(); this.#current(ticket, binding, client);
    const view = validateTaskVerificationPolicyView(raw, session);
    monotonic(view, prior); return view;
  }
  #accept(view, notice = null) {
    this.#publish(view.changeState === 'unknown' ? 'unknown' : 'ready', { view, notice });
  }
  show() {
    if (this.#destroyed) return Promise.resolve();
    if (this.#visible) return this.#pending ?? Promise.resolve();
    this.#visible = true; return this.refresh();
  }
  hide() {
    if (this.#destroyed) return;
    this.#visible = false; this.#reset(); this.#publish('hidden');
  }
  invalidate() {
    if (this.#destroyed) return Promise.resolve();
    this.#reset(); this.#publish(this.#visible ? 'loading' : 'hidden');
    return this.#visible ? this.refresh() : Promise.resolve();
  }
  refresh() {
    if (this.#destroyed || !this.#visible || !this.#isVisible() || this.#state.busy) return Promise.resolve();
    const prior = this.#state.view, ticket = this.#reset();
    this.#publish(this.#mutation ? 'reconciling' : 'loading', { busy: true });
    this.#pending = this.#load(ticket, prior); return this.#pending;
  }
  async #load(ticket, prior) {
    try {
      // A cancelled/hidden view cannot open a second change while the first
      // adapter call is unresolved. The subsequent read still must reconcile it.
      if (this.#mutation) await this.#mutation.done;
      this.#current(ticket);
      const connection = await this.#connect(ticket);
      const view = await this.#read(ticket, connection, prior);
      this.#current(ticket, connection.binding, connection.client); this.#accept(view);
    } catch {
      if (ticket.epoch === this.#epoch && this.#visible && !this.#destroyed) {
        this.#publish('unavailable');
      }
    }
  }
  choose(mode) {
    const { phase, view, busy } = this.#state;
    if (!this.#visible || !this.#isVisible() || busy || !view?.canChange || view.changeState !== 'settled' ||
      !['ready', 'review'].includes(phase) || !MODES.includes(mode)) return;
    this.#publish(mode === view.mode ? 'ready' : 'review', { view, draftMode: mode === view.mode ? null : mode });
  }
  cancel() {
    if (!this.#visible || this.#destroyed) return Promise.resolve();
    if (!this.#state.busy) {
      if (this.#state.view?.changeState === 'settled') this.#accept(this.#state.view);
      return Promise.resolve();
    }
    // Stop the local ceremony and read back. Never promise the server write was
    // cancelled or retry it; a request already sent may have committed.
    return this.invalidate();
  }
  save() {
    const reviewed = this.#state.view, mode = this.#state.draftMode;
    if (this.#destroyed || !this.#visible || !this.#isVisible() || this.#state.busy ||
      this.#state.phase !== 'review' || !reviewed?.canChange || reviewed.changeState !== 'settled' ||
      !MODES.includes(mode) || mode === reviewed.mode || this.#mutation) return Promise.resolve();
    const ticket = this.#reset();
    this.#publish('checking', { view: reviewed, draftMode: mode, busy: true });
    this.#pending = this.#save(ticket, reviewed, mode); return this.#pending;
  }
  async #save(ticket, reviewed, mode) {
    let changeStarted = false;
    try {
      const connection = await this.#connect(ticket);
      const fresh = await this.#read(ticket, connection, reviewed);
      this.#current(ticket, connection.binding, connection.client);
      if (!sameReview(fresh, reviewed) || !fresh.canChange || fresh.changeState !== 'settled') {
        this.#accept(fresh, 'changed'); return;
      }
      this.#publish('verifying', { view: fresh, draftMode: mode, busy: true });
      let finish;
      const mutation = { done: new Promise(resolve => { finish = resolve; }) };
      this.#mutation = mutation; changeStarted = true;
      let failed = false;
      try {
        // The bridge must recheck the captured binding after every await and at
        // the commit boundary. UI checks alone are never an authority boundary.
        await connection.client.change({ binding: connection.binding, signal: ticket.signal,
          expectedRevision: fresh.revision, expectedScopeKey: fresh.scopeKey, mode });
      } catch { failed = true; }
      finally { if (this.#mutation === mutation) this.#mutation = null; finish(); }
      this.#current(ticket, connection.binding, connection.client);
      this.#publish('reconciling', { busy: true });
      const saved = await this.#read(ticket, connection, fresh);
      this.#current(ticket, connection.binding, connection.client);
      const applied = saved.scopeKey === fresh.scopeKey && saved.mode === mode &&
        BigInt(saved.revision) > BigInt(fresh.revision) && saved.changeState === 'settled';
      this.#accept(saved, saved.changeState === 'unknown' ? null : applied ? 'saved' : failed ? 'notSaved' : 'changed');
    } catch {
      if (ticket.epoch === this.#epoch && this.#visible && !this.#destroyed) {
        this.#publish(changeStarted ? 'unknown' : 'unavailable');
      }
    }
  }
  destroy() {
    if (this.#destroyed) return;
    this.hide(); this.#destroyed = true; this.#unsubscribe?.();
  }
}

/** Mount only in the human management entry. The caller owns entry visibility. */
export function mountTaskVerificationPolicy({ document, window, walletLogin, getPolicyClient,
  host = document.getElementById('task-verification-policy-settings') }) {
  if (!host) return null;
  if (mounts.has(host)) return mounts.get(host);
  let open = false, controller;
  const node = (tag, parent, id) => {
    const item = document.createElement(tag); if (id) item.id = id;
    if (parent) parent.append(item); return item;
  };
  const localized = (item, key, parameters = {}) => paint(item, presentation(locale => policyText(key, parameters, locale)));
  const section = node('section', host); section.className = 'task-verification-policy';
  const title = node('h3', section, 'task-verification-policy-title'); localized(title, 'title');
  section.setAttribute('aria-labelledby', title.id);
  const explanation = node('p', section, 'task-verification-policy-help'); localized(explanation, 'explanation');
  const status = node('p', section, 'task-verification-policy-status');
  status.setAttribute('role', 'status'); status.setAttribute('aria-live', 'polite'); status.setAttribute('aria-atomic', 'true');
  const facts = node('dl', section), factValues = {};
  for (const key of ['wallet', 'account', 'chain', 'agent', 'scope', 'revision', 'savedMode']) {
    const row = node('div', facts); row.className = 'review-row';
    localized(node('dt', row), key); factValues[key] = node('dd', row);
    factValues[key].style.overflowWrap = 'anywhere'; factValues[key].style.margin = '0';
  }
  const permissionTitle = node('h4', section); localized(permissionTitle, 'permissions');
  const permissions = node('ul', section);
  const toggle = node('button', section, 'task-verification-policy-toggle');
  toggle.type = 'button'; toggle.setAttribute('role', 'switch');
  toggle.setAttribute('aria-labelledby', title.id); toggle.setAttribute('aria-describedby', explanation.id);
  const draft = node('p', section, 'task-verification-policy-draft');
  const actions = node('div', section); actions.className = 'actions';
  const save = node('button', actions, 'task-verification-policy-save'); save.type = 'button'; localized(save, 'save');
  const cancel = node('button', actions, 'task-verification-policy-cancel'); cancel.type = 'button'; localized(cancel, 'cancel');
  const refresh = node('button', actions, 'task-verification-policy-refresh'); refresh.type = 'button'; localized(refresh, 'refresh');
  const notice = node('p', section); notice.setAttribute('role', 'status');
  const boundary = node('p', section); localized(boundary, 'boundary');
  function render(state) {
    const view = state.view, known = Boolean(view), editable = known && view.canChange &&
      view.changeState === 'settled' && !state.busy && ['ready', 'review'].includes(state.phase);
    section.setAttribute('aria-busy', String(state.busy));
    localized(status, state.phase === 'ready' && view?.canChange === false ? 'state.readOnly' : `state.${state.phase}`);
    facts.hidden = !known; permissionTitle.hidden = !known; permissions.hidden = !known;
    for (const item of Object.values(factValues)) paint(item, '');
    // Plain text only. Private context fields, scopeKey and bridge metadata never
    // enter DOM attributes, hidden nodes, URLs, storage or diagnostics.
    if (view) {
      factValues.wallet.textContent = view.walletLabel;
      factValues.account.textContent = view.context.account;
      factValues.chain.textContent = view.context.chainId;
      factValues.agent.textContent = `${view.agentLabel} (${view.agentId})`;
      factValues.scope.textContent = view.scopeLabel;
      factValues.revision.textContent = view.revision;
      localized(factValues.savedMode, `mode.${view.mode}`);
    }
    for (const child of permissions.children) paint(child, '');
    permissions.replaceChildren();
    if (view?.permissions === null) localized(node('li', permissions), 'permissionsUnavailable');
    else if (view?.permissions.length) {
      for (const permission of view.permissions) node('li', permissions).textContent = `${permission.label} (${permission.id})`;
    } else if (known) localized(node('li', permissions), 'noPermissions');
    const selected = state.draftMode ?? view?.mode;
    toggle.hidden = !known; toggle.disabled = !editable;
    if (known) {
      toggle.setAttribute('aria-checked', String(selected === 'ON'));
      toggle.setAttribute('data-policy-mode', selected);
      toggle.style.background = selected === 'ON' ? 'var(--accent)' : 'var(--line)';
      toggle.style.color = 'var(--ink)'; localized(toggle, `mode.${selected}`);
    } else {
      toggle.removeAttribute('aria-checked'); toggle.removeAttribute('data-policy-mode'); paint(toggle, '');
    }
    if (state.draftMode) localized(draft, state.draftMode === 'OFF' ? 'draftOff' : 'draftOn');
    else paint(draft, '');
    save.disabled = !editable || state.phase !== 'review';
    cancel.disabled = !state.busy && !state.draftMode;
    refresh.disabled = state.busy || !open;
    if (state.notice) localized(notice, `notice.${state.notice}`); else paint(notice, '');
  }
  controller = new TaskVerificationPolicyController({ walletLogin, getPolicyClient, onChange: render,
    isVisible: () => open && document.visibilityState !== 'hidden' && host.isConnected !== false && !host.hidden });
  const listeners = [];
  const listen = (target, type, handler) => { target.addEventListener(type, handler); listeners.push(() => target.removeEventListener(type, handler)); };
  listen(toggle, 'click', () => {
    const state = controller.snapshot(), selected = state.draftMode ?? state.view?.mode;
    controller.choose(selected === 'ON' ? 'OFF' : 'ON');
  });
  listen(save, 'click', () => { void controller.save(); });
  listen(cancel, 'click', () => { void controller.cancel(); });
  listen(refresh, 'click', () => { void controller.refresh(); });
  listen(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') controller.hide(); else if (open) void controller.show();
  });
  listen(window, 'pagehide', () => controller.hide());
  listen(window, 'pageshow', () => { if (open) void controller.show(); });
  listen(window, 'focus', () => {
    const state = controller.snapshot();
    if (open && !state.busy && !state.draftMode && document.visibilityState !== 'hidden') void controller.refresh();
  });
  const api = Object.freeze({
    show() { open = true; return controller.show(); },
    hide() { open = false; controller.hide(); },
    invalidate() { return controller.invalidate(); },
    snapshot() { return controller.snapshot(); },
    destroy() {
      open = false; controller.destroy(); for (const remove of listeners) remove();
      for (const child of section.querySelectorAll('*')) paint(child, '');
      section.remove(); mounts.delete(host);
    },
  });
  mounts.set(host, api); render(controller.snapshot()); return api;
}

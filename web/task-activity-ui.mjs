import { TaskActivityReader } from './task-activity.mjs';
import { TaskAuthorizationClient } from './task-authorization.mjs';
/** An explicit-read cockpit beside, not inside, the authorization/continuation flow. */
export function mountTaskActivity({ document, window, walletLogin, getClient }) {
  const host = document.getElementById('task-page');
  if (!host) return;
  const panel = document.createElement('details');
  const title = document.createElement('summary'); title.textContent = 'Task activity and recovery overview (read only)';
  const notice = document.createElement('p');
  notice.textContent = 'Saved status only. Fee allocations are ceilings, not gas spent. Unknown outcomes must be reconciled before any retry. Use the existing authorization form for human-approved actions.';
  const refresh = document.createElement('button'); refresh.type = 'button'; refresh.textContent = 'Read first activity page';
  const next = document.createElement('button'); next.type = 'button'; next.textContent = 'Read next activity page'; next.disabled = true;
  const filter = document.createElement('select'); filter.setAttribute('aria-label', 'Filter current activity page');
  for (const value of ['all','pending','authorized','suspended','revoked','expired']) {
    const option = document.createElement('option'); option.value = value; option.textContent = value; filter.append(option);
  }
  const status = document.createElement('p'); status.setAttribute('role','status');
  const list = document.createElement('div'), detail = document.createElement('pre');
  panel.append(title, notice, refresh, next, filter, status, list, detail); host.append(panel);
  let epoch = 0, visible = false, busy = false, page = null, reader = null, binding = null;
  function clear() {
    epoch++; page = null; reader = null; binding = null; busy = false;
    list.replaceChildren(); detail.textContent = ''; status.textContent = '';
    refresh.disabled = false; next.disabled = true;
  }
  function assertCurrent(ticket) {
    if (ticket !== epoch || !visible || document.visibilityState === 'hidden') throw new Error('TASK_ACTIVITY_STALE');
    walletLogin.assert(binding);
  }
  async function connect(ticket) {
    await walletLogin.check();
    if (ticket !== epoch || !visible) throw new Error('TASK_ACTIVITY_STALE');
    const session = walletLogin.assert(), client = getClient();
    if (!session.serverId || !client) throw new Error('TASK_ACTIVITY_LOGIN_REQUIRED');
    binding = walletLogin.capture();
    const request = async (path, body) => {
      assertCurrent(ticket); await walletLogin.check(); assertCurrent(ticket);
      const result = await client.request(path, body);
      await walletLogin.check(); assertCurrent(ticket); return result;
    };
    const decoder = new TaskAuthorizationClient({ context: session, request });
    reader = new TaskActivityReader({ request,
      decode: raw => decoder.view(raw, { allowFresh: raw?.valuationPolicy !== undefined }) });
  }
  function render() {
    list.replaceChildren();
    for (const task of page?.tasks ?? []) {
      if (filter.value !== 'all' && task.status !== filter.value) continue;
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = task.taskDigest + ' — ' + task.status + ' — unknown: ' + task.unknownCount;
      button.disabled = busy;
      button.addEventListener('click', () => { void readDetail(task.taskDigest); });
      list.append(button);
    }
  }
  async function run(action) {
    if (busy || !visible || document.visibilityState === 'hidden') return;
    const ticket = epoch; busy = true; refresh.disabled = true; next.disabled = true;
    detail.textContent = ''; status.textContent = 'Reading authenticated saved task status…'; render();
    try {
      if (!reader) await connect(ticket);
      assertCurrent(ticket); await action(ticket); assertCurrent(ticket);
    } catch {
      if (ticket === epoch) { page = null; list.replaceChildren(); detail.textContent = '';
        reader = null; binding = null; status.textContent = 'Activity unavailable. Sign in again or restart from the first page; no action was sent.'; }
    } finally {
      if (ticket === epoch) { busy = false; refresh.disabled = false; next.disabled = !page?.nextCursor; render(); }
    }
  }
  function readPage(first) {
    return run(async ticket => {
      const result = await reader.page(first ? null : page?.nextCursor, first ? null : page?.revision);
      assertCurrent(ticket); page = result;
      status.textContent = 'Saved list revision ' + result.revision + '; ' + result.tasks.length +
        ' tasks on this page only. Filters and counts do not describe other pages.';
    });
  }
  function readDetail(taskDigest) {
    return run(async ticket => {
      const result = await reader.status(taskDigest); assertCurrent(ticket);
      detail.textContent = JSON.stringify(result, null, 2);
      status.textContent = 'Read-only saved task detail. This is not authority, execution or fresh confirmation.';
    });
  }
  refresh.addEventListener('click', () => { void readPage(true); });
  next.addEventListener('click', () => { if (page?.nextCursor) void readPage(false); });
  filter.addEventListener('change', render);
  document.addEventListener('wallet:page', event => { visible = event.detail === 'tasks'; if (!visible) clear(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') clear(); });
  window.addEventListener('pagehide', clear);
  walletLogin.subscribe(clear);
}

import { mountObservationDetails } from './observation-details-ui.mjs';
import { msg, paint, t } from './i18n.mjs';
import { TaskActivityReader, taskActivity } from './task-activity.mjs';
import { TaskAuthorizationClient } from './task-authorization.mjs';
/** An explicit-read cockpit beside, not inside, the authorization/continuation flow. */
export function mountTaskActivity({ document, window, walletLogin, getClient, observationDetailsClientFor = () => null }) {
  const host = document.getElementById('task-page');
  if (!host) return;
  const panel = document.createElement('details');
  const title = document.createElement('summary'); paint(title, msg('task.activityTitle'));
  const notice = document.createElement('p');
  paint(notice, msg('task.activityNotice'));
  const refresh = document.createElement('button'); refresh.type = 'button'; paint(refresh, msg('task.refresh'));
  const next = document.createElement('button'); next.type = 'button'; paint(next, msg('task.activityNext')); next.disabled = true;
  const filter = document.createElement('select'); filter.setAttribute('aria-label', t('task.activityFilter'));
  filter.setAttribute('data-i18n-aria', 'task.activityFilter');
  for (const value of ['all','pending','authorized','suspended','revoked','expired']) {
    const option = document.createElement('option'); option.value = value;
    paint(option, msg(value === 'all' ? 'task.activityAll' : `task.${value}`)); filter.append(option);
  }
  filter.value = 'all';
  const status = document.createElement('p'); status.setAttribute('role','status');
  const list = document.createElement('div'), detail = document.createElement('pre'), operations = document.createElement('div');
  detail.tabIndex = -1;
  panel.append(title, notice, refresh, next, filter, status, list, detail, operations); host.append(panel);
  const observations = mountObservationDetails({ root: panel, document, window, walletLogin,
    clientFor: observationDetailsClientFor, onBack: () => detail.focus?.() });
  let epoch = 0, selectionGeneration = 0, visible = false, busy = false, page = null, reader = null, binding = null;
  function clear() {
    epoch++; selectionGeneration++; page = null; reader = null; binding = null; busy = false;
    list.replaceChildren(); detail.textContent = ''; paint(status, ''); operations.replaceChildren(); observations?.close();
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
      const digest = document.createElement('strong'), state = document.createElement('span'), unknown = document.createElement('span');
      digest.textContent = task.taskDigest; paint(state, msg(`task.${task.status}`));
      paint(unknown, msg('task.activityUnknown', { count: task.unknownCount })); button.append(digest, state, unknown);
      button.disabled = busy;
      button.addEventListener('click', () => { void readDetail(task.taskDigest); });
      list.append(button);
    }
  }
  async function run(action) {
    if (busy || !visible || document.visibilityState === 'hidden') return;
    const ticket = epoch; selectionGeneration++; busy = true; refresh.disabled = true; next.disabled = true;
    detail.textContent = ''; operations.replaceChildren(); observations?.close();
    paint(status, msg('task.detailsLoading')); render();
    try {
      if (!reader) await connect(ticket);
      assertCurrent(ticket); await action(ticket); assertCurrent(ticket);
    } catch {
      if (ticket === epoch) { page = null; list.replaceChildren(); detail.textContent = '';
        reader = null; binding = null; paint(status, msg('task.activityUnavailable')); }
    } finally {
      if (ticket === epoch) { busy = false; refresh.disabled = false; next.disabled = !page?.nextCursor; render(); }
    }
  }
  function readPage(first) {
    return run(async ticket => {
      const result = await reader.page(first ? null : page?.nextCursor, first ? null : page?.revision);
      assertCurrent(ticket); page = result;
      paint(status, msg('task.activityRevision', { revision: result.revision, count: result.tasks.length }));
    });
  }
  function readDetail(taskDigest) {
    return run(async ticket => {
      const view = await reader.detail(taskDigest); assertCurrent(ticket);
      const result = taskActivity(view); detail.textContent = JSON.stringify(result, null, 2);
      const selected = selectionGeneration;
      if (view.task.policy.intent.kind === 'exact-operation') for (const op of result.operations) {
        if (op.status !== 'submitted' || !op.transactionHash) continue;
        const open = document.createElement('button'); open.type = 'button'; paint(open, msg('task.detailsOpen'));
        open.addEventListener('click', () => {
          try { assertCurrent(ticket); if (selected !== selectionGeneration) return;
            void observations?.open({ taskDigest, operationId: op.operationId,
            childDigest: op.childDigest, transactionHash: op.transactionHash,
            approvedVerifier: view.receiptVerifier, grantState: view.effectiveStatus }).catch(() => {
              observations?.close(); paint(status, msg('task.detailsUnsupported'));
            }); } catch { observations?.close(); }
        });
        operations.append(open);
      }
      paint(status, msg('task.activityDetail'));
    });
  }
  refresh.addEventListener('click', () => { void readPage(true); });
  next.addEventListener('click', () => { if (page?.nextCursor) void readPage(false); });
  filter.addEventListener('change', render);
  document.addEventListener('wallet:page', event => { visible = event.detail === 'tasks'; if (!visible) clear(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') clear(); });
  window.addEventListener('pagehide', clear);
  walletLogin.subscribe(clear);
  return Object.freeze({ readPage, readDetail, clear, observations });
}

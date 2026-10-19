/** Human policy-change ceremony. Uses only the current documented policy POST
 * transport and supplied current-source wire decoders. No legacy decoder fallback,
 * third factor, API activation, transaction signing or unattended setting change.
 */
import { paint, presentation } from './i18n.mjs';
import { policyText } from './locales/task-verification-policy.mjs';

const active = new WeakMap();
let dialogSequence = 0;
const fail = code => Object.assign(new Error(code), { code });
const insist = (condition, code = 'TASK_POLICY_CEREMONY_REFUSED') => { if (!condition) throw fail(code); };
const localized = (element, key, parameters = {}) => paint(element,
  presentation(locale => policyText(key, parameters, locale)));

/** These functions must be provided by the current, reviewed source decoder:
 * prepared(raw, {session, account, reviewed, mode, identityMethod, now}) ->
 *   {changeId, changeDigest, identityMethod, emailMasked, issuedAt, expiresAt,
 *    message: exact validated wallet message or null}
 * verified(raw, prepared, now) -> {changeId,changeDigest,emailMasked,digits:8,expiresAt}
 * committed(raw, prepared) -> strict current status (never a reusable proof).
 * They must reject unknown schemas/fields, scope/mode/revision/digest substitutions,
 * unsupported factor methods and any message not exactly bound to the challenge.
 */
export async function runTaskVerificationPolicyChange({ document, window, walletLogin,
  client, binding, signal, reviewed, mode, decoders, now = Date.now,
  onConfirmDispatch = () => {}, onCommitted = () => {}, onCancelled = () => {} }) {
  insist(document && window && client && typeof client.taskVerification === 'function' &&
    ['prepared', 'verified', 'committed'].every(name => typeof decoders?.[name] === 'function'));
  insist(['ON', 'OFF'].includes(mode) && reviewed && reviewed.mode !== mode && signal && !signal.aborted);
  insist(!active.has(document), 'TASK_POLICY_CEREMONY_BUSY');
  const startTime = now(); insist(Number.isSafeInteger(startTime) && startTime >= 0);
  const flow = { cancelled: false, dismiss: null, prepared: null, issuedAt: startTime,
    expiresAt: startTime + 5 * 60_000, lastTime: startTime, confirmDispatched: false };
  active.set(document, flow);
  let input = null, verificationBody = null, confirmBody = null;
  let needsCancel = false, completed = false;
  const current = () => {
    insist(active.get(document) === flow && !flow.cancelled && !signal.aborted, 'TASK_POLICY_CHANGE_CANCELLED');
    const time = now();
    insist(Number.isSafeInteger(time) && time >= flow.lastTime && time >= flow.issuedAt && time < flow.expiresAt,
      'TASK_VERIFICATION_CHANGE_EXPIRED');
    flow.lastTime = time; walletLogin.assert(binding);
  };
  const recheck = async () => { current(); await walletLogin.check(); current(); };
  const abort = () => { flow.cancelled = true; flow.dismiss?.(fail('TASK_POLICY_CHANGE_CANCELLED')); };
  signal.addEventListener('abort', abort, { once: true });
  function node(tag, parent, key) {
    const element = document.createElement(tag); if (key) localized(element, key);
    if (parent) parent.append(element); return element;
  }
  function prompt(kind, account = null) {
    current();
    return new Promise((resolve, reject) => {
      const priorFocus = document.activeElement, dialog = node('dialog'); dialog.className = 'auth-change-dialog';
      const form = node('form', dialog); form.method = 'dialog';
      const title = node('h3', form, mode === 'OFF' ? 'ceremony.titleOff' : 'ceremony.titleOn');
      title.id = `task-policy-change-title-${++dialogSequence}`; dialog.setAttribute('aria-labelledby', title.id);
      const help = node('p', form, 'ceremony.twoFactors'); help.id = `${title.id}-help`;
      dialog.setAttribute('aria-describedby', help.id);
      const identity = node('p', form);
      identity.textContent = `${reviewed.walletLabel} · ${reviewed.context.account} · ${reviewed.context.chainId}`;
      const scope = node('p', form); scope.textContent = `${reviewed.agentLabel} (${reviewed.agentId}) · ${reviewed.scopeLabel}`;
      const controls = {}, secrets = [];
      if (kind === 'identity') {
        const methodLabel = node('label', form); node('span', methodLabel, 'ceremony.identityMethod');
        controls.method = node('select', methodLabel); controls.method.id = `${title.id}-method`;
        const methods = ['password', 'wallet'].filter(method => account.methods[method].bound === true &&
          account.methods[method].enabled === true && account.methods[method].available !== false);
        for (const method of methods) {
          const option = node('option', controls.method, `ceremony.${method}`); option.value = method;
        }
        const passwordLabel = node('label', form); node('span', passwordLabel, 'ceremony.passwordValue');
        controls.password = node('input', passwordLabel); controls.password.type = 'password';
        controls.password.autocomplete = 'off'; controls.password.maxLength = 1024; secrets.push(controls.password);
        const selectMethod = () => {
          controls.password.value = ''; passwordLabel.hidden = controls.method.value !== 'password';
          controls.password.required = controls.method.value === 'password';
        };
        controls.method.addEventListener('change', selectMethod); selectMethod();
      } else if (kind === 'email') {
        const masked = node('p', form); localized(masked, 'ceremony.emailSent', { email: flow.prepared.emailMasked });
        const codeLabel = node('label', form); node('span', codeLabel, 'ceremony.emailCode');
        controls.code = node('input', codeLabel); controls.code.type = 'password';
        controls.code.inputMode = 'numeric'; controls.code.autocomplete = 'one-time-code';
        controls.code.pattern = '[0-9]{8}'; controls.code.minLength = 8; controls.code.maxLength = 8;
        controls.code.required = true; secrets.push(controls.code);
        node('p', form, 'ceremony.emailPurpose');
      } else {
        insist(kind === 'review');
        // The exact source-validated challenge is reviewed before either factor
        // is transmitted or the wallet is asked to sign. Signed bytes stay raw.
        const exact = node('pre', form); exact.style.whiteSpace = 'pre-wrap'; exact.style.overflowWrap = 'anywhere';
        exact.textContent = flow.prepared.message ?? JSON.stringify({ request: flow.prepared.request,
          changeDigest: flow.prepared.changeDigest }, null, 2);
      }
      const validation = node('p', form); validation.setAttribute('role', 'alert');
      const actions = node('div', form); actions.className = 'actions';
      const submit = node('button', actions, kind === 'email' ? 'ceremony.confirm' : 'ceremony.continue'); submit.type = 'submit';
      const cancel = node('button', actions, 'ceremony.cancel'); cancel.type = 'button';
      let settled = false, timer = null;
      function finish(value, error = null) {
        if (settled) return; settled = true;
        if (timer !== null) window.clearTimeout(timer); flow.dismiss = null;
        for (const field of secrets) field.value = '';
        for (const element of dialog.querySelectorAll('*')) paint(element, '');
        dialog.close(); dialog.remove();
        if (!signal.aborted && priorFocus?.isConnected !== false) priorFocus?.focus?.();
        if (error) reject(error); else resolve(value);
      }
      flow.dismiss = error => finish(null, error ?? fail('TASK_POLICY_CHANGE_CANCELLED'));
      cancel.addEventListener('click', () => { flow.cancelled = true; flow.dismiss?.(); });
      dialog.addEventListener('cancel', event => { event.preventDefault(); flow.cancelled = true; flow.dismiss?.(); });
      dialog.addEventListener('close', () => { if (!settled) { flow.cancelled = true; flow.dismiss?.(); } });
      form.addEventListener('submit', event => {
        event.preventDefault();
        try { current(); } catch (error) { finish(null, error); return; }
        if (kind === 'identity') {
          const method = controls.method.value;
          if (!['password', 'wallet'].includes(method) || account.methods[method].enabled !== true ||
            account.methods[method].bound !== true || account.methods[method].available === false) {
            localized(validation, 'ceremony.methodUnavailable'); return;
          }
          if (method === 'password' && controls.password.value.length === 0) {
            localized(validation, 'ceremony.passwordRequired'); return;
          }
          finish({ identityMethod: method, password: method === 'password' ? controls.password.value : '' });
        } else if (kind === 'email') {
          if (!/^[0-9]{8}$/.test(controls.code.value)) { localized(validation, 'ceremony.codeRequired'); return; }
          finish({ code: controls.code.value });
        } else finish({});
      });
      try {
        document.body.append(dialog); dialog.showModal();
        (kind === 'identity' ? controls.method : kind === 'email' ? controls.code : submit).focus();
        timer = window.setTimeout(() => finish(null, fail('TASK_VERIFICATION_CHANGE_EXPIRED')),
          Math.max(0, flow.expiresAt - now()));
        current();
      } catch (error) { finish(null, error); }
    });
  }
  try {
    await recheck();
    const account = await client.account(); await recheck();
    const session = walletLogin.assert(binding);
    insist(account?.origin === session.origin && account?.tenant === session.tenant &&
      account?.account?.toLowerCase() === session.account.toLowerCase() && account.chainId === session.chainId &&
      account.registration?.complete === true && account.registration.emailOtpAvailable === true &&
      ['password', 'wallet'].some(method => account.methods?.[method]?.enabled === true &&
        account.methods[method].bound === true && account.methods[method].available !== false),
    'TASK_VERIFICATION_TWO_ESTABLISHED_FACTORS_REQUIRED');
    // Deliberately do not consume method-management TOTP/recovery/answer gates.
    input = await prompt('identity', account); await recheck();
    needsCancel = true;
    const raw = await client.taskVerification('prepare', { expectedRevision: reviewed.revision,
      identityMethod: input.identityMethod, mode }, { signal });
    await recheck();
    flow.prepared = await decoders.prepared(raw, { session, account, reviewed, mode,
      identityMethod: input.identityMethod, now: now() });
    await recheck();
    // Identifier and digest encodings belong to the exact current-source wire
    // decoder, not this presentation seam. These checks do not accept or
    // authenticate wire data independently of that decoder.
    insist(flow.prepared && typeof flow.prepared.changeId === 'string' && flow.prepared.changeId.length > 0 &&
      typeof flow.prepared.changeDigest === 'string' && flow.prepared.changeDigest.length > 0 &&
      flow.prepared.identityMethod === input.identityMethod &&
      typeof flow.prepared.emailMasked === 'string' && flow.prepared.emailMasked.length > 0 &&
      flow.prepared.emailMasked.length <= 320 && !/[\u0000-\u001f\u007f]/u.test(flow.prepared.emailMasked) &&
      Number.isSafeInteger(flow.prepared.issuedAt) && Number.isSafeInteger(flow.prepared.expiresAt) &&
      flow.prepared.issuedAt >= 0 && flow.prepared.expiresAt > flow.prepared.issuedAt &&
      flow.prepared.expiresAt - flow.prepared.issuedAt <= 5 * 60_000);
    flow.issuedAt = flow.prepared.issuedAt; flow.expiresAt = flow.prepared.expiresAt; current();
    await prompt('review'); await recheck();
    verificationBody = { changeId: flow.prepared.changeId, changeDigest: flow.prepared.changeDigest };
    if (input.identityMethod === 'password') {
      verificationBody.password = input.password; input.password = '';
    } else {
      insist(typeof flow.prepared.message === 'string' && flow.prepared.message.length > 0 && flow.prepared.message.length <= 16384);
      // Only the decoder-approved, exact-purpose policy message is signed. No
      // transaction/send method, private key or blind arbitrary-message fallback.
      const bytes = new TextEncoder().encode(flow.prepared.message);
      const encoded = `0x${Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('')}`;
      await recheck();
      verificationBody.signature = await walletLogin.provider().request({ method: 'personal_sign', params: [encoded, session.account] });
      await recheck();
    }
    const verifiedRaw = await client.taskVerification('verify', verificationBody, { signal });
    verificationBody.password = ''; verificationBody.signature = ''; verificationBody = null;
    await recheck();
    await decoders.verified(verifiedRaw, flow.prepared, now()); await recheck();
    input = await prompt('email'); await recheck();
    confirmBody = { changeId: flow.prepared.changeId, changeDigest: flow.prepared.changeDigest, code: input.code };
    input.code = ''; flow.confirmDispatched = true; onConfirmDispatch(flow.prepared);
    const result = await client.taskVerification('confirm', confirmBody, { signal });
    confirmBody.code = ''; confirmBody = null; await recheck();
    const committed = await decoders.committed(result, flow.prepared); await recheck();
    await onCommitted(committed, flow.prepared); completed = true; needsCancel = false;
    return committed;
  } finally {
    if (input) { input.password = ''; input.code = ''; }
    if (verificationBody) { verificationBody.password = ''; verificationBody.signature = ''; }
    if (confirmBody) confirmBody.code = '';
    flow.dismiss?.(fail('TASK_POLICY_CHANGE_CANCELLED')); signal.removeEventListener('abort', abort);
    // A single best-effort cancellation, bound to the original session. It never
    // retries confirm or claims rollback, and it cannot cancel a new account's draft.
    // RELEASE BLOCKER: cancel {} is session-wide, not challenge-qualified. The
    // source-bound bridge stays unavailable until replacement-draft/cross-tab
    // cancellation safety has been established by the authoritative implementation.
    if (needsCancel && !completed) {
      try {
        walletLogin.assert(binding);
        const result = await client.taskVerification('cancel', {});
        walletLogin.assert(binding);
        if (result?.cancelled === true) onCancelled({ confirmDispatched: flow.confirmDispatched });
      } catch { /* The adapter must preserve unresolved outcome state. */ }
    }
    if (active.get(document) === flow) active.delete(document);
  }
}

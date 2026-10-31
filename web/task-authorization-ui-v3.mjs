import {captureOperationIntent, decodeExternalIntent, verifyOperationIntent, verifyTaskIntent} from './ex-operation-intent.mjs';
/** Human-only task authorization form; no OTP, credential or grant is persisted. */
import { TaskAuthorizationClient, TaskAuthorizationFlow } from './task-authorization.mjs';
import { OperationVerificationFlow } from './task-operation-verification.mjs';
import { mountOperationVerificationUI } from './task-operation-verification-ui.mjs';
import { msg, paint } from './i18n.mjs';
const validDigest = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) ? value : null;
export function mountTaskAuthorization({ document, window, walletLogin, getClient, Client = TaskAuthorizationClient, Flow = TaskAuthorizationFlow, OperationFlow = OperationVerificationFlow }) {
  const el = id => document.getElementById(id);
  let externalIntent = null, intentInvalid = false;
  try { captureOperationIntent(window); externalIntent = window.history.state?.walletExOperationIntent ? decodeExternalIntent(window.history.state.walletExOperationIntent) : null; } catch { intentInvalid = true; }
  let flow = null, visible = false, generation = 0, identity = null, active = null, continuationTimer = null;
  let coordinationTimer = null, releaseLease = null, leasePending = false, leader = false, leaseEpoch = 0;
  let operationUI = null;
  // Non-secret, restrictive navigation preference only; never an authorization.
  // Keep the hold independent of challenge cancellation and document reload.
  const savedHolds = window.history.state?.walletVerificationOnlyTasks;
  let invalidHoldState = savedHolds !== undefined && (!Array.isArray(savedHolds) ||
    savedHolds.length > 128 || !savedHolds.every(value => validDigest(value)));
  const verificationOnlyTasks = new Set(invalidHoldState ? [] : savedHolds ?? []);
  function holdVerificationOnly(digest) {
    if (!validDigest(digest)) return;
    if (invalidHoldState || (!verificationOnlyTasks.has(digest) && verificationOnlyTasks.size >= 128)) {
      invalidHoldState = true; stopContinuation(); stopCoordination(); return false;
    }
    verificationOnlyTasks.add(digest);
    window.history.replaceState({ ...window.history.state, walletVerificationOnlyTasks: [...verificationOnlyTasks] }, '');
    stopContinuation(); stopCoordination(); return true;
  }
  const taskReview = () => externalIntent?.schema === '8415-ex-task-locator/1';
  const reviewOptions = () => ({verificationOnly:Boolean(externalIntent) && !taskReview(),authorizationOnly:taskReview()});
  let selectedDigest = validDigest(window.history.state?.walletTaskDigest);
  const clearCode = () => { el('task-code').value = ''; el('task-ack').checked = false; };
  function rememberDigest(digest) {
    selectedDigest = validDigest(digest);
    // A digest is a public locator, never login, authority, a grant reference or OTP.
    window.history.replaceState({ ...(window.history.state ?? {}), walletTaskDigest: selectedDigest }, '');
  }
  function row(key, value, target = el('task-summary')) {
    const item = document.createElement('div'); item.className = 'review-row';
    const name = document.createElement('span'), data = document.createElement('strong');
    paint(name, msg(key)); data.textContent = String(value); item.append(name, data); target.append(item);
  }
  function note(key, parameters = {}, target = el('task-summary')) { const item = document.createElement('p'); paint(item, msg(key, parameters)); target.append(item); }
  function stopContinuation() { if (continuationTimer !== null) window.clearTimeout(continuationTimer); continuationTimer = null; }
  function stopCoordination() {
    leaseEpoch++; leasePending = false; leader = false;
    if (coordinationTimer !== null) window.clearTimeout(coordinationTimer); coordinationTimer = null;
    const release = releaseLease; releaseLease = null; release?.();
  }
  function coordinate() {
    if (leader || leasePending || coordinationTimer !== null) return;
    if (!window.navigator?.locks?.request) { paint(el('task-auto-status'), msg('task.autoUnavailable')); return; }
    const epoch = leaseEpoch; leasePending = true;
    // One visible same-origin tab polls at a time. A lock is coordination only;
    // no task, credential, grant or account detail is shared or persisted.
    void window.navigator.locks.request('8415wallet:task-continuation', { ifAvailable: true }, async lock => {
      if (epoch !== leaseEpoch) return; leasePending = false;
      if (!lock) {
        paint(el('task-auto-status'), msg('task.autoOtherTab'));
        coordinationTimer = window.setTimeout(() => { coordinationTimer = null; scheduleContinuation(); }, 60000); return;
      }
      leader = true; paint(el('task-auto-status'), '');
      await new Promise(resolve => { releaseLease = resolve; scheduleContinuation(); });
    }).catch(() => { if (epoch === leaseEpoch) { leasePending = false; leader = false; paint(el('task-auto-status'), msg('task.autoUnavailable')); } });
  }
  function scheduleContinuation() {
    stopContinuation();
    if (invalidHoldState || verificationOnlyTasks.has(active?.selected?.task?.digest) || operationUI?.blocksContinuation()) { stopCoordination(); return; }
    const eligible = visible && document.visibilityState !== 'hidden' &&
      ((active?.selected?.listing?.settlementObservationConfigured && active?.selected?.executionState === 'listed' &&
        !['paused', 'locked', 'loading', 'list'].includes(active?.phase)) ||
      (active?.selected?.capabilities.adapterConfigured || active?.selected?.capabilities.receiptVerifierConfigured) &&
      ['authorized-waiting', 'outcome-unknown', 'submitted', 'awaiting-evidence', 'rate-limited'].includes(active?.phase));
    if (!eligible) {
      // Keep the lease across one in-flight request; release on terminal/hidden/closed states.
      if (!active?.busy || !visible || document.visibilityState === 'hidden') stopCoordination();
      paint(el('task-auto-status'), ''); return;
    }
    if (active.busy) return;
    if (!leader) { coordinate(); return; }
    const timing = flow?.snapshot() ?? active;
    const delay = Math.max(timing.continuationDelayMs ?? 30000, timing.retryAfterMs ?? 0);
    continuationTimer = window.setTimeout(() => { continuationTimer = null; void flow?.continue(); }, delay);
  }
  function render(snapshot) {
    if (document.visibilityState === 'hidden' && snapshot.selected?.completion.fresh) { flow?.markHistorical(); return; }
    active = snapshot; el('task-list').replaceChildren(); el('task-summary').replaceChildren();
    for (const view of snapshot.tasks) {
      const button = document.createElement('button'); button.type = 'button'; button.className = 'task-list-item';
      const title = document.createElement('strong'); title.textContent = view.task.policy.taskId;
      const status = document.createElement('span'); paint(status, msg(`task.${view.effectiveStatus}`)); button.append(title, status);
      button.addEventListener('click', () => { operationUI?.cancel(); clearCode(); rememberDigest(view.task.digest); void flow?.open(view.task.digest, reviewOptions()); });
      el('task-list').append(button);
    }
    el('task-empty').hidden = snapshot.phase !== 'list' || snapshot.tasks.length !== 0;
    paint(el('task-status'), msg(snapshot.selected?.valuationPolicy && snapshot.phase === 'recovering' ? 'task.state.listing-recovering' : `task.state.${snapshot.phase}`, snapshot.phase === 'rate-limited' ?
      { seconds: Math.ceil(Math.max(snapshot.retryAfterMs, snapshot.continuationDelayMs) / 1000) } : {}));
    paint(el('task-error'), snapshot.error ?? snapshot.selected?.continuation?.code ?? snapshot.selected?.listing?.observationError ?? '');
    const view = snapshot.selected; el('task-detail').hidden = !view;
    paint(el('task-observation-heading'), msg(view?.valuationPolicy ? 'task.listingObservationTitle' : 'task.observationTitle'));
    if (view) {
      const { policy, digest } = view.task;
      if (snapshot.approvalEvaluation?.state === 'NOT_EVALUATED') note('task.approvalNotEvaluated');
      row('task.agentId', view.executor.identity.agentId); row('task.agentVersion', view.executor.identity.agentVersion);
      row('task.adapterId', view.executor.identity.adapterId); row('task.adapterVersion', view.executor.identity.adapterVersion);
      row('task.implementationDigest', view.executor.identity.implementationDigest); row('task.executorDigest', view.executor.digest);
      if (view.observationPolicy) {
        row('task.minimumConfirmations', view.observationPolicy.policy.minimumConfirmations);
        row('task.observationPolicyDigest', view.observationPolicy.digest);
      }
      paint(el('task-policy-status'), msg(view.observationPolicy ? 'task.observationPolicyConfigured' : 'task.observationPolicyMissing'));
      if (view.receiptVerifier) {
        note('task.originalApprovalVerifier');
        row('task.verifierId', view.receiptVerifier.verifierId); row('task.verifierVersion', view.receiptVerifier.verifierVersion);
        row('task.verifierDigest', view.receiptVerifier.verifierImplementationDigest);
      }
      paint(el('task-verifier-status'), msg(view.receiptVerifier ? 'task.verifierPinned' : 'task.verifierMissing'));
      if (view.observationView) {
        const current = view.observationView.currentReadOnlyObserver;
        note('task.currentReadOnlyObserver'); note('task.readOnlyObserverNote');
        if (current) {
          row('task.verifierId', current.verifier.verifierId);
          row('task.verifierVersion', current.verifier.verifierVersion);
          row('task.verifierDigest', current.verifier.verifierImplementationDigest);
          row('task.minimumConfirmations', current.verificationPolicy.policy.minimumConfirmations);
          row('task.observationPolicyDigest', current.verificationPolicy.digest);
        } else note('task.readOnlyObserverUnavailable');
      }
      paint(el('task-completion'), msg(`task.completion.${view.completion.state}`));
      paint(el('task-observation-freshness'), msg(view.completion.fresh ? 'task.observationFresh' : 'task.observationHistorical'));
      el('task-observation-states').replaceChildren();
      for (const entry of view.observations) {
        const item = document.createElement('p');
        paint(item, msg(entry.available && entry.observation ? `task.observation.${entry.observation.state}` : 'task.observationUnavailable'));
        el('task-observation-states').append(item);
        if (entry.schema === '8415-task-observation-entry/2') {
          const details = document.createElement('div');
          const accepted = entry.acceptedObserverContext;
          row('task.operationObservationRevision', entry.observationRevision, details);
          if (accepted) {
            note('task.acceptedEvidenceObserver', {}, details);
            row('task.verifierId', accepted.verifier.verifierId, details);
            row('task.verifierVersion', accepted.verifier.verifierVersion, details);
            row('task.verifierDigest', accepted.verifier.verifierImplementationDigest, details);
            row('task.acceptedObservationRevision', accepted.acceptedObservationRevision, details);
            row('task.minimumConfirmations', accepted.verificationPolicy.policy.minimumConfirmations, details);
            row('task.observationPolicyDigest', accepted.verificationPolicy.digest, details);
          } else note(entry.provenance === 'legacy-approved-cache' ?
            'task.legacyObserverCache' : 'task.unverifiedObserverContext', {}, details);
          el('task-observation-states').append(details);
        }
      }
      el('task-observations').textContent = JSON.stringify(view.listing?.result?.summary ?? view.observations, null, 2);
      if (view.listing?.result) {
        const result = view.listing.result, item = document.createElement('p');
        paint(item, msg(`task.listingResult.${result.state}`)); el('task-observation-states').append(item);
        if (result.summary.aggregate) {
          row('task.listingObservedQuantity', `${result.summary.aggregate.quantity} / ${policy.intent.quantity}`);
          row('task.listingGross', result.summary.aggregate.gross); row('task.listingFees', result.summary.aggregate.fees);
          row('task.listingSellerNet', result.summary.aggregate.sellerNet);
        }
        row('task.listingCheckedAt', result.summary.checkedAt ?? ''); note('task.listingDepthBoundary');
        if (result.state === 'listed') note('task.listingNoFillBoundary');
      } else if (view.listing?.observationError) note('task.listingResult.unknown');
      row('task.id', policy.taskId); row('task.digest', digest); row('task.account', policy.actor);
      row('task.tenant', policy.tenant); row('task.origin', policy.origin); row('task.chain', policy.chainId);
      if (policy.intent.kind === 'nft-sale') {
        const intent = policy.intent, amount = intent.minimumProceeds.amountMinor.padStart(3, '0');
        row('task.intent', intent.kind); row('task.standard', intent.standard); row('task.contract', intent.contract);
        row('task.token', intent.tokenId); row('task.quantity', intent.quantity);
        row('task.minimum', `${intent.minimumProceeds.comparison === 'gt' ? '>' : '≥'} ${amount.slice(0, -2)}.${amount.slice(-2)} USD`);
        row('task.comparison', intent.minimumProceeds.comparison);
        row('task.basis', intent.minimumProceeds.basis); row('task.markets', intent.marketAdapters.join(', '));
        note(`task.basis.${intent.minimumProceeds.basis}`); note('task.listingFeeBoundary');
        if (view.valuationPolicy) {
          const valuation = view.valuationPolicy.policy;
          row('task.valuationDigest', view.valuationPolicy.digest); row('task.priceAt', valuation.priceAt);
          note(`task.priceAt.${valuation.priceAt}`);
          row('task.valuationSource', valuation.source); note('task.valuationSourceBoundary');
          row('task.valuationBaseChain', valuation.base.chainId); row('task.valuationBaseToken', valuation.base.token);
          row('task.valuationBaseDecimals', valuation.base.decimals); row('task.valuationQuote', `${valuation.quote.currency} / ${valuation.quote.decimals}`);
          row('task.valuationRateDecimals', valuation.rateDecimals); row('task.valuationValidFrom', valuation.validFrom);
          row('task.valuationValidUntil', valuation.validUntil); row('task.valuationMaxAge', valuation.maxAgeSeconds);
          note('task.listingRevocation');
        } else note('task.valuationMissing');
        if (view.authorization) row('task.authorizationSchema', view.authorization.schema);
        if (view.listing && !view.listing.settlementObservationConfigured) note('task.listingEvidenceMissing');
      } else {
        if (policy.intent.kind === 'artfi-receipt') {
          row('task.intent', policy.intent.kind);
          row('task.contract', policy.intent.escrow);
          row('task.token', policy.intent.sale.tokenId);
          note('task.receiptPhases', { phases: policy.intent.phases.map(p => p.phase).join(', ') });
        } else row('task.intent', policy.intent.operation.kind);
        const fields = (object, prefix = '') => { for (const [key, value] of Object.entries(object)) {
          if (value && typeof value === 'object') fields(value, `${prefix}${key}.`);
          else { const item = document.createElement('div'); item.className = 'review-row';
            const name = document.createElement('span'), data = document.createElement('strong');
            name.textContent = `${prefix}${key}`; data.textContent = value; item.append(name, data); el('task-summary').append(item); }
        } }; fields(policy.intent.kind === 'artfi-receipt' ? policy.intent : policy.intent.operation);
      }
      row('task.expiry', `${policy.expiresAt} (Unix seconds)`);
      row('task.feeEach', `${policy.fees.perOperationWei} wei`); row('task.feeTotal', `${policy.fees.totalWei} wei`);
      el('task-canonical').textContent = JSON.stringify(view.valuationPolicy ? { taskPolicy: policy, valuationPolicy: view.valuationPolicy } : policy, null, 2);
      el('task-missing').textContent = view.capabilities.missing.join('\n');
      paint(el('task-execution-status'), msg(view.valuationPolicy && view.executionState === 'unknown' ? 'task.execution.listingUnknown' : `task.execution.${view.executionState}`));
      el('task-operations').textContent = JSON.stringify(view.receiptAttempts ?? view.budget?.reservations ?? [], null, 2);
    } else { for (const id of ['task-policy-status', 'task-verifier-status', 'task-completion', 'task-observation-freshness', 'task-observations']) el(id).textContent = '';
      el('task-observation-states').replaceChildren(); el('task-canonical').textContent = ''; el('task-missing').textContent = ''; el('task-execution-status').textContent = ''; el('task-operations').textContent = ''; }
    el('task-authorize-fields').hidden = snapshot.phase !== 'review';
    const testFactorExempt = ['server-test-scope', 'preoperational-default-on'].includes(snapshot.approvalFactor);
    el('task-code').disabled = snapshot.phase !== 'review' || testFactorExempt;
    el('task-code').hidden = testFactorExempt;
    el('task-code-label').hidden = testFactorExempt;
    el('task-authenticator-help').hidden = testFactorExempt;
    el('task-code').required = !testFactorExempt;
    el('task-authorize').disabled = snapshot.phase !== 'review';
    el('task-refresh').disabled = snapshot.busy || snapshot.retryAfterMs > 0;
    el('task-recheck').hidden = !view || snapshot.busy; el('task-recheck').disabled = snapshot.retryAfterMs > 0;
    el('task-revoke').hidden = !view?.authorization || ['revoked', 'expired'].includes(view?.effectiveStatus);
    el('task-revoke').disabled = snapshot.busy;
    el('task-recover').hidden = !['unknown', 'submitted', 'listed'].includes(view?.executionState);
    paint(el('task-recover'), msg(view?.valuationPolicy ? 'task.listingCheck' : view?.executionState === 'submitted' ? 'task.observe' : 'task.recover')); el('task-recover').disabled = snapshot.busy || snapshot.retryAfterMs > 0;
    el('task-blocked').hidden = snapshot.phase !== 'authorized-blocked';
    if (snapshot.phase !== 'review') clearCode();
    const operationView = taskReview() ? null : externalIntent && view ? {...view,budget:{...view.budget,reservations:view.budget?.reservations.filter(r=>r.operationId===externalIntent.operationId&&r.childDigest===externalIntent.childDigest)??[]}} : view;
    operationUI?.setView(operationView, { busy: snapshot.busy });
    scheduleContinuation();
  }
  function leave() { operationUI?.cancel(); stopContinuation(); stopCoordination(); generation++; visible = false; clearCode(); flow?.suspend(); }
  async function show() {
    visible = true; const current = ++generation; clearCode();
    try {
      const session = await walletLogin.check(); if (!visible || current !== generation) return;
      if (intentInvalid || (externalIntent && (session.tenant !== externalIntent.tenant || String(session.chainId) !== externalIntent.chainId))) throw Error('EX_OPERATION_INTENT_REFUSED');
      const client = getClient();
      if (!session.serverId || !client) { flow?.lock(); paint(el('task-status'), msg('task.serverLogin')); return; }
      const key = `${session.id}:${session.serverId}:${session.account}:${session.chainId}:${session.tenant}`;
      if (!flow || key !== identity) {
        operationUI?.destroy(); operationUI = null;
        identity = key;
        const binding = walletLogin.capture();
        const request = async (path, body) => {
          const expectedIntent = externalIntent, requestGeneration = generation;
          const assertContinuationAllowed = () => {
            if ((invalidHoldState || verificationOnlyTasks.has(body?.taskDigest)) && ['tasks/resume', 'tasks/execute'].includes(path)) {
              throw Object.assign(new Error('TASK_VERIFICATION_ONLY'), { code: 'TASK_VERIFICATION_ONLY' });
            }
          };
          assertContinuationAllowed();
          if (externalIntent && !(taskReview()?['tasks/list','tasks/status','tasks/prepare','tasks/authorize']:['tasks/list','tasks/status','tasks/prepare-operation-verification','tasks/confirm-operation-verification']).includes(path)) throw Error('EX_OPERATION_INTENT_READ_ONLY');
          if (externalIntent && ['tasks/status','tasks/authorize','tasks/prepare-operation-verification'].includes(path) && body?.taskDigest !== externalIntent.taskDigest) throw Error('EX_OPERATION_INTENT_REFUSED');
          if (externalIntent && path === 'tasks/prepare-operation-verification' && (body.operationId !== externalIntent.operationId || body.childDigest !== externalIntent.childDigest || body.expectedBudgetRevision !== externalIntent.expectedBudgetRevision)) throw Error('EX_OPERATION_INTENT_REFUSED');
          walletLogin.assert(binding); await walletLogin.check(); walletLogin.assert(binding);
          if (generation !== requestGeneration || externalIntent !== expectedIntent) throw Error('EX_OPERATION_INTENT_CHANGED');
          assertContinuationAllowed();
          const result = await client.request(path, body); walletLogin.assert(binding);
          if (generation !== requestGeneration || externalIntent !== expectedIntent) throw Error('EX_OPERATION_INTENT_CHANGED');
          if (expectedIntent && ['tasks/status','tasks/authorize'].includes(path)) {
            if (expectedIntent.schema === '8415-ex-task-locator/1') verifyTaskIntent(expectedIntent,session,result,window.location.origin);
            else verifyOperationIntent(expectedIntent,session,result,window.location.origin);
          }
          return result;
        };
        operationUI = mountOperationVerificationUI({ document, Flow: OperationFlow, request, context: session, onVerificationOnly: holdVerificationOnly,
          onBarrier: blocked => { if (blocked) { stopContinuation(); stopCoordination(); } } });
        flow = new Flow({ client: new Client({ context: session, request }), onChange: render });
      }
      await flow.load(selectedDigest, reviewOptions());
    } catch { if (visible && current === generation) { flow?.lock(); paint(el('task-status'), msg('task.serverLogin')); } }
  }
  el('task-refresh').addEventListener('click', () => { operationUI?.cancel(); clearCode(); void flow?.load(selectedDigest, reviewOptions()); });
  el('task-recheck').addEventListener('click', () => { operationUI?.cancel(); clearCode(); if (selectedDigest) void flow?.open(selectedDigest, reviewOptions()); });
  const authorize = event => {
    event.preventDefault();
    if (!visible || active?.phase !== 'review' || !el('task-ack').checked) { paint(el('task-error'), msg('task.ackRequired')); return; }
    let code = ['server-test-scope', 'preoperational-default-on'].includes(active.approvalFactor) ? '' : el('task-code').value; clearCode(); void flow?.authorize(code); code = '';
  };
  el('task-authorize-form').addEventListener('submit', authorize);
  el('task-authorize').addEventListener('click', event => {
    // Current foundation markup is type=button. If changed to submit later,
    // let the form's default submission call the single handler instead.
    if (el('task-authorize').type === 'button') authorize(event);
  });
  el('task-cancel').addEventListener('click', () => { operationUI?.cancel(); clearCode(); flow?.suspend(); });
  el('task-recover').addEventListener('click', () => { operationUI?.cancel(); clearCode(); void flow?.recover(); });
  el('task-revoke').addEventListener('click', () => { operationUI?.cancel(); clearCode(); void flow?.revoke(); });
  document.addEventListener('wallet:page', event => { if (event.detail === 'tasks') { if (!visible) void show(); } else if (visible) leave(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { operationUI?.cancel(); clearCode(); stopContinuation(); stopCoordination(); flow?.markHistorical(); } else scheduleContinuation(); });
  function selectIntentPage() {
    if (!externalIntent || intentInvalid || visible) return;
    // Use the original shell control, preserving authentication/busy gates.
    document.querySelector?.('.nav-item[data-route="tasks"]')?.click();
  }
  function changeExternalIntent() {
    // Invalidate every in-flight flow before adopting Back/newer navigation.
    operationUI?.cancel(); flow?.suspend(); stopContinuation(); stopCoordination(); generation++;
    try {
      captureOperationIntent(window);
      const incomingHolds = window.history.state?.walletVerificationOnlyTasks ?? [];
      if (!Array.isArray(incomingHolds) || incomingHolds.length > 128 || !incomingHolds.every(validDigest)) { invalidHoldState = true; throw Error('TASK_VERIFICATION_ONLY_STATE_REFUSED'); }
      for (const digest of incomingHolds) { if (holdVerificationOnly(digest) === false) throw Error('TASK_VERIFICATION_ONLY_STATE_REFUSED'); }
      window.history.replaceState({...window.history.state,walletVerificationOnlyTasks:[...verificationOnlyTasks]},'');
      externalIntent = window.history.state?.walletExOperationIntent ? decodeExternalIntent(window.history.state.walletExOperationIntent) : null;
      intentInvalid = false;
      if (externalIntent) { holdVerificationOnly(externalIntent.taskDigest); rememberDigest(externalIntent.taskDigest); }
      else selectedDigest = validDigest(window.history.state?.walletTaskDigest);
    } catch { intentInvalid = true; externalIntent = null; }
    flow?.lock(); flow = null; identity = null;
    if (visible) void show(); else selectIntentPage();
  }
  window.addEventListener('hashchange', changeExternalIntent);
  window.addEventListener('popstate', changeExternalIntent);
  window.addEventListener('pagehide', leave);
  window.addEventListener('keydown', event => { if (event.key === 'Escape' && visible) { operationUI?.cancel(); clearCode(); flow?.suspend(); } });
  walletLogin.subscribe(session => {
    operationUI?.destroy(); operationUI = null; stopContinuation(); stopCoordination(); generation++; clearCode(); flow?.lock(); flow = null; identity = null;
    if (!session) { el('task-summary').replaceChildren(); el('task-canonical').textContent = ''; el('task-missing').textContent = ''; el('task-execution-status').textContent = ''; el('task-operations').textContent = ''; }
    // Login never authorizes a task. Reload only the page already selected.
    if (session && visible) void show(); else if (session) selectIntentPage();
  });
  render({ phase: 'locked', tasks: [], selected: null, busy: false, error: null });
  // Module ordering may place the shell's first route event before this mount.
  Promise.resolve().then(selectIntentPage);
  return { snapshot: () => flow?.snapshot() ?? null };
}


/** Standalone V2 composition; no linked responsibility implementation. */
import { settlementDisplay, checkDisplay } from './native-i18n.mjs';
import { privateNativeSummary, privateKeyedNativeUi, privateReadDisplay } from './wallet-identity-display.mjs';
import { msg, paint, jsonUi, trustedMessage } from './i18n.mjs';
import { walletLogin, WalletLoginError, currentAccountClient, currentAccountFeatures } from './wallet-auth.mjs';
import { getReleaseProfile } from './release-profile.mjs';
import { BrowserSettlementStore } from './settlement-store.mjs';
import { StandaloneSettlementSession, isAddressInput, TransactionWouldRevertError } from '../dist/browser/browser-v2.js';
import { acquireWalletUi, releaseWalletUi } from './ui-lock.mjs';
import { StandaloneAccountSession, ControlAdapterError, WalletSession, RpcErc8415Reader, Eip1193ReadTransport,
  renderAssetView, renderTemporalQuery, renderHistory, renderRegistration, renderAcquisitionDisclosure,
  renderRiskSurfaces, renderPosture, renderSettlementLog, renderOwnershipHistory, renderCollisions, CollisionScanError, COLLISION_SCAN_MAX_TOKENS, verifyControlDeployment, controlRpc } from '../dist/browser/browser-v2.js';
import { reviewAgentRequest, recoveryGuidance } from '../dist/browser/browser-v2.js';
import { BrowserPublicOperationStore } from './public-store-v2.mjs';

const el = id => document.getElementById(id);
const renderResult = value => { paint(el('result'), jsonUi(value)); paint(el('native-read-result'), jsonUi(value)); };
const nativeView = (state, view = null) => document.dispatchEvent?.(new CustomEvent('wallet:native-view', { detail: { state,
  view: state === 'ready' ? privateNativeSummary(view, walletLogin.assert()?.account) : null } }));
const privateNative = (renderer, view) => privateKeyedNativeUi(renderer, view, walletLogin.assert()?.account);
const privateDisplay = (value, disclosure = null) => {
  display(privateReadDisplay(value, walletLogin.assert()?.account, disclosure));
};
const display = value => { requireCurrentConnection(); renderResult(value); };
const value = id => el(id).value.trim();
const fail = code => { throw new ControlAdapterError(code); };
/** The comma-separated token field this page reads, in characters. */
const COLLISION_INPUT_MAX_CHARACTERS = 2560;
const integer = text => { if (!/^(0|[1-9][0-9]{0,77})$/.test(text) || BigInt(text) >= 1n << 256n) fail('CONTROL_INTEGER_REFUSED'); return BigInt(text); };
const number = id => integer(value(id));
const bytes = (text, size) => { if (!new RegExp(`^0x[0-9a-fA-F]{${size * 2}}$`).test(text)) fail('CONTROL_HEX_REFUSED'); return text.toLowerCase(); };
let deployment = null, provider = null, session = null, plainWallet = null, actor = null, review = null, signed = null, busy = false;
let agentRequestText = null, agentReview = null, agentReviewRevision = 0;
let settlementSession = null, settlementReview = null, settlementReviewRevision = 0n, consentRevision = 0n;
let releaseProfile = null;
const releaseReady = getReleaseProfile().then(profile => {
  if (profile.id !== 'v2' || profile.features.linkedResponsibilities) fail('CONTROL_RELEASE_PROFILE_REFUSED');
  releaseProfile = profile;
  paint(el('release-profile'), msg('status.profile', { product: profile.product, version: profile.version, platform: profile.platform, tenant: profile.tenant.label }));
  if (el('linked-tab')) el('linked-tab').hidden = true;
  el('controlled-account-actions').hidden = false;
  el('agent-controls-panel').hidden = false;
  el('control-recovery-panel').hidden = false;
}).catch(() => { paint(el('release-profile'), msg('message.000')); });
let connectionRevision = 0n, operationRevision = 0n, nativeReadRevision = 0;
function requireCurrentConnection() {
  walletLogin.assert();
  if (operationRevision !== connectionRevision) fail('CONTROL_CONNECTION_CHANGED');
}
const selected = () => { walletLogin.assert(); if (!session || !deployment || !actor) fail('CONTROL_CONNECTION_REQUIRED'); return session; };
function clearAgentReview() {
  agentReviewRevision++;
  agentRequestText = null; agentReview = null;
  el('agent-acknowledge').checked = false; paint(el('agent-terms'), msg('ui.166'));
}
function clearConsent() { consentRevision++; review = null; signed = null; }
function clearSettlementReview() {
  settlementReviewRevision++; settlementReview = null;
  el('settlement-ack').checked = false; paint(el('settlement-terms'), msg('ui.108'));
}
function clearConnection() {
  nativeView('empty');
  clearConsent(false); clearSettlementReview(); settlementSession = null;
  paint(el('settlement-state'), msg('message.001'));
  clearAgentReview(); paint(el('recovery-guidance'), trustedMessage(recoveryGuidance(null)));
  connectionRevision++; session = null; plainWallet = null; actor = null; review = null;
  paint(el('identity'), msg('message.002'));
  renderResult(msg('message.003'));
}
async function run(fn, reconnect = false) {
  if (busy) return;
  const uiLock = acquireWalletUi(); if (uiLock === null) return;
  if (reconnect) clearConnection();
  operationRevision = connectionRevision;
  busy = true;
  // These triggers belong to this controller. Preserve their prior availability
  // while the operation (including final state readback) is still pending.
  const actions = [el('connect'), el('settlement-prepare'), el('settlement-send')].map(button => [button, button.disabled]);
  for (const [button] of actions) button.disabled = true;
  try { await walletLogin.check(); requireCurrentConnection(); if (!releaseProfile) await releaseReady; if (!releaseProfile) fail('CONTROL_RELEASE_PROFILE_REFUSED'); requireCurrentConnection(); await fn(); } catch (e) {
    if (e instanceof ControlAdapterError && e.code === 'CONTROL_READ_CHANGED') return;
    nativeView('error');
    // Provider, RPC and DOM exception text is never rendered, logged or persisted.
    renderResult(operationRevision !== connectionRevision ? 'CONTROL_CONNECTION_CHANGED' :
      e instanceof WalletLoginError ? e.code : e instanceof ControlAdapterError ? (e.code === 'CONTROL_PROVIDER_REQUEST_REJECTED' ? msg('message.004') : e.code) :
      e instanceof TransactionWouldRevertError ? { action: e.kind, refusedChecks: checkDisplay(e.checks), transactionSent: false } : 'CONTROL_UI_OPERATION_REFUSED');
  } finally {
    if (session && operationRevision === connectionRevision) {
      const current = session;
      try {
        const state = await current.status();
        if (current === session && operationRevision === connectionRevision) paint(el('recovery-guidance'), trustedMessage(recoveryGuidance(state)));
      } catch { if (current === session && operationRevision === connectionRevision) paint(el('recovery-guidance'), msg('message.005')); }
    }
    if (settlementSession && operationRevision === connectionRevision) {
      const current = settlementSession;
      try { const state = await current.status();
        if (current === settlementSession && operationRevision === connectionRevision) paint(el('settlement-state'), jsonUi(state));
      } catch { if (current === settlementSession && operationRevision === connectionRevision) paint(el('settlement-state'), msg('message.006')); }
    }
    for (const [button, wasDisabled] of actions) button.disabled = wasDisabled;
    busy = false; releaseWalletUi(uiLock);
  }
}
async function jsonFile(id, maximum) {
  const file = el(id).files?.[0]; if (!file || file.size > maximum) fail('CONTROL_PUBLIC_DOCUMENT_REFUSED');
  try { return JSON.parse(await file.text()); } catch { fail('CONTROL_PUBLIC_DOCUMENT_REFUSED'); }
}
function pin(raw, chainId) {
  if (!raw || Object.keys(raw).sort().join(',') !== 'address,runtimeCodeHash') fail('CONTROL_DEPLOYMENT_PIN_REFUSED');
  return { chainId, controller: bytes(raw.address, 20), runtimeCodeHash: bytes(raw.runtimeCodeHash, 32) };
}
el('deployment').addEventListener('change', () => {
  signed = null; deployment = null; clearConnection();
  return run(async () => {
  signed = null; deployment = null;
  const d = await jsonFile('deployment', 8192);
  requireCurrentConnection();
  if (!d || Object.keys(d).sort().join(',') !== 'chainId,controller,payment,schema,token' || d.schema !== '8415-controls-testnet/1') fail('CONTROL_DEPLOYMENT_SCHEMA_REFUSED');
  const chainId = integer(d.chainId);
  if (![560048n, 11155111n].includes(chainId)) fail('CONTROL_TESTNET_REQUIRED');
  if (d.controller === null && d.payment !== null) fail('CONTROL_DEPLOYMENT_SCHEMA_REFUSED');
  deployment = { chainId, controller: d.controller === null ? null : pin(d.controller, chainId), token: pin(d.token, chainId), payment: d.payment === null ? null : pin(d.payment, chainId) };
  display({ deploymentLoaded: true, chainId, executionPerformed: false });
}, true);
});
el('connect').addEventListener('click', () => run(async () => {
  if (!deployment) fail('CONTROL_DEPLOYMENT_REQUIRED');
  {
    provider = walletLogin.provider();
    if (!provider || typeof provider.request !== 'function') fail('CONTROL_GENUINE_WALLET_PROVIDER_REQUIRED');
    provider.on?.('accountsChanged', clearConnection);
    provider.on?.('chainChanged', () => { signed = null; clearConnection(); });
    provider.on?.('disconnect', () => { signed = null; clearConnection(); });
  }
  const accounts = await controlRpc(provider, 'eth_requestAccounts', []);
  requireCurrentConnection();
  if (!Array.isArray(accounts) || !accounts[0]) fail('CONTROL_SIGNER_REFUSED');
  const connected = bytes(accounts[0], 20);
  const chain = await controlRpc(provider, 'eth_chainId', []);
  requireCurrentConnection();
  if (typeof chain !== 'string' || !/^0x[0-9a-f]+$/i.test(chain) || BigInt(chain) !== deployment.chainId) fail('CONTROL_CHAIN_MISMATCH');
  await verifyControlDeployment(provider, deployment.token);
  requireCurrentConnection();
  const capturedRevision = connectionRevision;
  const connectedProvider = { request: args => {
    if (capturedRevision !== connectionRevision) fail('CONTROL_CONNECTION_CHANGED');
    return provider.request(args);
  } };
  const nextWallet = new WalletSession(new RpcErc8415Reader(new Eip1193ReadTransport(connectedProvider, deployment.chainId),
    deployment.chainId, deployment.token.controller), { account: connected });
  const nextSettlement = new StandaloneSettlementSession(connectedProvider, deployment.token, connected,
    new BrowserSettlementStore(deployment.chainId, deployment.token.controller, connected),
    () => { if (capturedRevision !== connectionRevision) fail('CONTROL_CONNECTION_CHANGED'); }, nextWallet);
  await nextSettlement.status();
  const nextSession = deployment.controller === null ? null : new StandaloneAccountSession(connectedProvider, deployment.controller, connected,
    new BrowserPublicOperationStore(deployment.chainId, deployment.controller.controller, connected));
  const state = nextSession ? await nextSession.status() : msg('message.007');
  requireCurrentConnection();
  actor = connected; plainWallet = nextWallet; session = nextSession; settlementSession = nextSettlement;
  paint(el('identity'), msg('status.identity', { chain: deployment.chainId, account: actor }));
  display(state);
}, true));
walletLogin.subscribe((authenticated, reason) => {
  if (authenticated) return;
  if (!['LOGIN_ACCOUNT_CHANGED', 'LOGIN_STARTING'].includes(reason)) signed = null;
  clearConnection(); provider = null;
  for (const input of document.querySelectorAll('#standalone input, #settlement-panel input, #account-panel input, #linked input, #agent-controls-panel input, #control-recovery-panel input')) {
    if (input.type === 'checkbox') input.checked = false; else input.value = input.type === 'file' ? '' : input.defaultValue ?? '';
  }
  paint(el('settlement-state'), msg('message.008'));
  paint(el('recovery-guidance'), msg('message.009'));
  paint(el('identity'), msg('message.010'));
  renderResult(msg('message.011'));
});
for (const id of ['tokenId', 'instant', 'collision-token-ids']) for (const event of ['input', 'change'])
  el(id).addEventListener(event, () => { nativeReadRevision++; nativeView('empty'); });
document.addEventListener('wallet:page', () => { nativeReadRevision++; });
document.querySelectorAll('[data-read]').forEach(button => button.addEventListener('click', () => run(async () => {
  const readRevision = nativeReadRevision;
  if (!plainWallet || !deployment) fail('CONTROL_CONNECTION_REQUIRED');
  const wallet = plainWallet; await verifyControlDeployment(provider, deployment.token);
  requireCurrentConnection();
  const tokenId = button.dataset.read === 'collisions' ? 0n : number('tokenId'); let output, assetObservation = null;
  if (button.dataset.read === 'asset') nativeView('loading');
  switch (button.dataset.read) {
    case 'collisions': {
      const input = value('collision-token-ids');
      if (input.length === 0) fail('COLLISION_TOKEN_INPUT_REFUSED');
      // Each bound says what it is: an empty box is a different fault from one
      // too full to read, and a caller told only the code cannot tell either
      // how long the field accepts or how many tokens one scan takes.
      if (input.length > COLLISION_INPUT_MAX_CHARACTERS) {
        fail(`COLLISION_TOKEN_INPUT_REFUSED: at most ${COLLISION_INPUT_MAX_CHARACTERS} characters, received ${input.length}`);
      }
      const parts = input.split(',');
      // The budget is the scan's own constant, not a copy that can drift from it.
      if (parts.length > COLLISION_SCAN_MAX_TOKENS) {
        fail(`COLLISION_TOKEN_BUDGET_REFUSED: at most ${COLLISION_SCAN_MAX_TOKENS} tokens, asked ${parts.length}`);
      }
      const ids = parts.map(part => integer(part.trim()));
      if (new Set(ids).size !== ids.length) fail('COLLISION_DUPLICATE_TOKEN_REFUSED');
      try { output = privateNative(renderCollisions, await wallet.collisions(ids)); }
      catch (error) {
        // The scan's refusal carries the limit it enforced. Showing the bare
        // code loses it, which is the invisible bound this replaces.
        if (error instanceof CollisionScanError) fail(error.limit === undefined ? error.code : `${error.code}: limit ${error.limit}`);
        throw error;
      }
      break;
    }
    case 'asset': assetObservation = await wallet.assetView(tokenId); output = privateNative(renderAssetView, assetObservation); break;
    case 'temporal': output = privateNative(renderTemporalQuery, await wallet.temporalQuery(tokenId, number('instant'))); break;
    case 'history': output = privateNative(renderHistory, await wallet.history(tokenId)); break;
    case 'registration': output = privateNative(renderRegistration, await wallet.registration(tokenId)); break;
    case 'acquisition': output = privateNative(renderAcquisitionDisclosure, await wallet.acquisitionDisclosure(tokenId)); break;
    case 'risk': output = privateNative(renderRiskSurfaces, await wallet.riskSurfaces(tokenId)); break;
    case 'posture': output = privateNative(renderPosture, await wallet.posture(tokenId, number('instant'))); break;
    case 'settlements': output = privateNative(renderSettlementLog, await wallet.settlementLog(tokenId)); break;
    case 'ownership': output = privateNative(renderOwnershipHistory, await wallet.ownershipHistory(tokenId)); break;
    default: fail('CONTROL_ACTION_REFUSED');
  }
  if (wallet !== plainWallet) fail('CONTROL_CONNECTION_CHANGED'); requireCurrentConnection();
  if (readRevision !== nativeReadRevision) fail('CONTROL_READ_CHANGED');
  if (assetObservation) nativeView('ready', assetObservation); display(output);
})));
el('standalone-tab').addEventListener('click', () => { clearConsent(false); clearSettlementReview(); el('standalone').hidden = false; el('linked').hidden = true; });
document.querySelectorAll('[data-action]').forEach(button => button.addEventListener('click', () => run(async () => {
  const s = selected(), kind = button.dataset.action;
  if (!['create-account', 'account', 'deposit', 'standalone-withdraw'].includes(kind)) fail('CONTROL_RELEASE_PROFILE_REFUSED');
  if (kind === 'account') { display(await s.accounts.account(actor)); return; }
  const operation = kind === 'create-account' ? { kind: 'control', action: { kind } }
    : { kind, token: deployment.token, tokenId: number('tokenId'),
      ...(kind === 'standalone-withdraw' ? { destination: addressInput(value('destination')) } : {}) };
  document.dispatchEvent?.(new CustomEvent('wallet:summary-stale'));
  display(await s.execute(operation));
})));
el('recover').addEventListener('click', () => run(async () => { display(await selected().reconcile()); }));
el('discard-unprepared').addEventListener('click', () => run(async () => {
  const s = selected(); await s.discardUnpreparedIntent(); display(await s.status());
}));
el('recover-hash').addEventListener('click', () => run(async () => {
  const s = selected(); await s.recoverTransactionHash(bytes(value('recovery-hash'), 32)); display(await s.reconcile());
}));
el('superseded-nonce').addEventListener('click', () => run(async () => {
  display(await selected().acknowledgeSupersededNonce(bytes(value('recovery-hash'), 32)));
}));
el('ack-terminal').addEventListener('click', () => run(async () => {
  const s = selected(); const state = await s.status();
  if (!state.submission) fail('CONTROL_KNOWN_SUBMISSION_REQUIRED');
  await s.acknowledgeTerminal(state.submission.transactionHash); display(await s.status());
}));

// Public file input only: no ambient message listener, HTTP write endpoint or agent credential.
async function agentContext() {
  selected();
  const header = await controlRpc(provider, 'eth_getBlockByNumber', ['latest', false]);
  requireCurrentConnection();
  if (!header || typeof header.timestamp !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(header.timestamp)) fail('AGENT_CHAIN_TIME_UNAVAILABLE');
  return { actor, controller: deployment.controller, token: deployment.token, now: BigInt(header.timestamp) };
}
el('agent-file').addEventListener('change', clearAgentReview);
el('agent-dismiss').addEventListener('click', clearAgentReview);
el('agent-review').addEventListener('click', () => run(async () => {
  clearAgentReview(); const revision = agentReviewRevision;
  const file = el('agent-file').files?.[0];
  if (!file || file.size > 8192) fail('AGENT_REQUEST_SIZE_REFUSED');
  const text = await file.text(); requireCurrentConnection();
  const currentReview = () => { if (revision !== agentReviewRevision || file !== el('agent-file').files?.[0]) fail('AGENT_REVIEW_CHANGED'); };
  currentReview();
  const context = await agentContext(); requireCurrentConnection(); currentReview();
  const prepared = reviewAgentRequest(text, context);
  requireOperationProfile(prepared.operation);
  requireCurrentConnection(); if (revision !== agentReviewRevision) fail('AGENT_REVIEW_CHANGED'); agentRequestText = text; agentReview = prepared;
  paint(el('agent-terms'), jsonUi(prepared));
  display(msg('message.015'));
}));
el('agent-execute').addEventListener('click', () => run(async () => {
  const s = selected();
  if (!agentReview || !agentRequestText || !el('agent-acknowledge').checked) fail('AGENT_OWNER_REVIEW_REQUIRED');
  const prior = agentReview, text = agentRequestText;
  // Consume review before any asynchronous work. Repeated clicks cannot reuse it.
  clearAgentReview(); const executionRevision = agentReviewRevision;
  const context = await agentContext(); requireCurrentConnection();
  if (executionRevision !== agentReviewRevision) fail('AGENT_REVIEW_CHANGED');
  const fresh = reviewAgentRequest(text, context);
  requireOperationProfile(fresh.operation);
  if (s !== session || fresh.digest !== prior.digest) fail('AGENT_REVIEW_CHANGED');
  document.dispatchEvent?.(new CustomEvent('wallet:summary-stale'));
  display(await s.execute(fresh.operation));
}));

const addressInput = text => { if (!isAddressInput(text)) fail('CONTROL_ADDRESS_REFUSED'); return text.toLowerCase(); };
const settlementSelected = () => { if (!settlementSession) fail('CONTROL_CONNECTION_REQUIRED'); return settlementSession; };
for (const id of ['settlement-kind', 'settlement-id', 'settlement-holder', 'settlement-snapshot', 'settlement-deadline',
  'settlement-commitment', 'settlement-reference', 'settlement-effective', 'settlement-proof', 'settlement-reason', 'tokenId']) {
  el(id).addEventListener('input', clearSettlementReview); el(id).addEventListener('change', clearSettlementReview);
}
el('settlement-dismiss').addEventListener('click', clearSettlementReview);
el('settlement-prepare').addEventListener('click', () => run(async () => {
  clearSettlementReview(); const s = settlementSelected(), revision = settlementReviewRevision;
  const kind = value('settlement-kind'), settlementId = bytes(value('settlement-id'), 32); let params;
  if (kind === 'beginSettlement') params = { tokenId: number('tokenId'), settlementId, expectedHolder: addressInput(value('settlement-holder')),
    snapshotHash: bytes(value('settlement-snapshot'), 32), deadline: number('settlement-deadline') };
  else if (kind === 'finalizeSettlement') params = { settlementId, recordCommitment: bytes(value('settlement-commitment'), 32),
    registryReference: bytes(value('settlement-reference'), 32), effectiveAt: number('settlement-effective'), proofData: value('settlement-proof') };
  else if (kind === 'cancelSettlement') params = { settlementId, reasonHash: bytes(value('settlement-reason'), 32) };
  else fail('SETTLEMENT_ACTION_REFUSED');
  const prepared = await s.prepare({ kind, params }); requireCurrentConnection();
  if (revision !== settlementReviewRevision || s !== settlementSession) fail('SETTLEMENT_REVIEW_CHANGED');
  settlementReview = prepared; paint(el('settlement-terms'), settlementDisplay(prepared));
  display(msg('message.016'));
}));
el('settlement-send').addEventListener('click', () => run(async () => {
  const s = settlementSelected(); if (!settlementReview || !el('settlement-ack').checked) fail('SETTLEMENT_REVIEW_REQUIRED');
  const accepted = settlementReview; clearSettlementReview();
  document.dispatchEvent?.(new CustomEvent('wallet:summary-stale'));
  display({ transactionHash: await s.submit(accepted, accepted.digest), protocolFinality: 'not-evaluated' });
}));
el('settlement-reconcile').addEventListener('click', () => run(async () => { display(await settlementSelected().reconcile()); }));
el('settlement-recover').addEventListener('click', () => run(async () => { display(await settlementSelected().recover(bytes(value('settlement-recovery-hash'), 32))); }));
el('settlement-replacement').addEventListener('click', () => run(async () => { display(await settlementSelected().acknowledgeReplacement(bytes(value('settlement-recovery-hash'), 32))); }));
el('settlement-ack-terminal').addEventListener('click', () => run(async () => { const s = settlementSelected(); await s.acknowledge(); display(await s.status()); }));

// Navigation cancels unsent reviews, not persisted transaction recovery.
let activePage = globalThis.history?.state?.walletPage;
document.addEventListener('wallet:page', event => {
  if (event.detail !== activePage) { clearConsent(); clearSettlementReview(); clearAgentReview(); }
  activePage = event.detail;
});

// A restored history entry must not reuse a review or signature from the old page lifecycle.
globalThis.addEventListener?.('pagehide', () => { signed = null; clearConnection(); });
globalThis.addEventListener?.('pageshow', event => { if (event.persisted) { signed = null; clearConnection(); } });

function requireOperationProfile(operation) {
  if (['deposit', 'standalone-withdraw'].includes(operation.kind) || operation.kind === 'control' && operation.action.kind === 'create-account') return;
  fail('CONTROL_RELEASE_PROFILE_REFUSED');
}

// Additive login-protected, read-only three-wallet evidence panel.
import './hoodi-journey-panel.mjs';

import { mountAssetWorkspace } from './asset-workspace-panel-v2.mjs';
mountAssetWorkspace({
  root: el('wallet-private'), login: walletLogin,
  getContext: () => {
    requireCurrentConnection();
    if (!plainWallet || !deployment || !provider) fail('CONTROL_CONNECTION_REQUIRED');
    return { wallet: plainWallet, tokenId: number('tokenId'), provider,
      linkedReader: null, payments: null };
  },
});

import { mountAuditExport } from './audit-export-panel.mjs';
mountAuditExport({
  root: el('wallet-private'), login: walletLogin,
  getContext: () => {
    requireCurrentConnection();
    if (!plainWallet || !deployment || !provider) fail('CONTROL_CONNECTION_REQUIRED');
    return { wallet: plainWallet, tokenId: number('tokenId') };
  },
});

import { mountFeedContinuity } from './feed-continuity-panel.mjs';
mountFeedContinuity({
  root: el('wallet-private'), login: walletLogin,
  getContext: () => {
    requireCurrentConnection();
    if (!plainWallet || !deployment || !provider) fail('CONTROL_CONNECTION_REQUIRED');
    return { wallet: plainWallet, tokenId: number('tokenId') };
  },
});

import { mountWatchtowerRead } from './watchtower-read-panel.mjs';
mountWatchtowerRead({
  root: el('wallet-private'), login: walletLogin,
  getContext: () => {
    requireCurrentConnection();
    if (!plainWallet || !deployment || !provider) fail('CONTROL_CONNECTION_REQUIRED');
    return { wallet: plainWallet, tokenId: number('tokenId'), provider };
  },
});


import { mountKitRead } from './kit-read-panel.mjs';
mountKitRead({
  root: el('wallet-private'), login: walletLogin,
  getContext: () => {
    requireCurrentConnection();
    if (!plainWallet || !deployment) fail('CONTROL_CONNECTION_REQUIRED');
    return { wallet: plainWallet, tokenId: number('tokenId') };
  },
});


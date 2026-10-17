import { normalizeTestNFT721OperationResult } from './task-test-nft721-binding.mjs';
import { normalizeListingResult, listingCompletion } from '../web/task-listing-results.mjs';
/** Durable bounded task grants. Login is not operation authorization.
 * No signer, market verifier or receipt verifier is supplied by this module.
 */
import { digest, equal, randomToken } from './crypto.mjs';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  TaskContractError, freezeTaskPolicy, freezeChildOperation, emptyTaskBudget,
  normalizeTaskBudget, reserveTaskBudget, markTaskSendAttempt, noteTaskSubmission,
  cancelUnattemptedReservation, assessChildScope, freezeNftListingChild, assessNftListingScope,
  emptyNftListingBudget, reserveNftListingBudget, noteNftListingSubmission, normalizeSeaportOrderReference,
} from '../src/agent/taskContract.ts';
import { TaskObservationError, freezeTaskObservationPolicy, normalizeObservationVerifier, normalizeTaskObservation, bindTaskObservation } from '../src/agent/receiptObservation.ts';

import { ReceiptTaskError, freezeReceiptTask, receiptPhaseScope, normalizeReceiptAttempts } from '../src/agent/receiptTask.ts';
import { validateReceiptWire } from './receipt-operation-encoding.mjs';
import { testMintInventoryKey } from './task-test-asset-authorization.mjs';
function freezeAuthorizedTask(policy) {
  const descriptor = policy && typeof policy === 'object' ? Object.getOwnPropertyDescriptor(policy, 'intent') : null;
  const intent = descriptor && Object.hasOwn(descriptor, 'value') ? descriptor.value : null;
  const kind = intent && typeof intent === 'object' ? Object.getOwnPropertyDescriptor(intent, 'kind') : null;
  return kind && Object.hasOwn(kind, 'value') && kind.value === 'artfi-receipt' ? freezeReceiptTask(policy) : freezeTaskPolicy(policy);
}
const CHALLENGE_LIFE = 2 * 60_000;
export class TaskAuthorizationError extends Error {
  constructor(code, status = 409) { super(code); this.status = status; }
}
const requireThat = (ok, code, status = 409) => { if (!ok) throw new TaskAuthorizationError(code, status); };
function fields(value, names) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) &&
    Object.keys(value).length === names.length && names.every(name => Object.hasOwn(value, name)), 'TASK_REQUEST_REFUSED', 400);
}
function hash(value) { requireThat(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value), 'TASK_DIGEST_REFUSED', 400); return value; }
function identifier(value) { requireThat(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value), 'TASK_ID_REFUSED', 400); return value; }
function version(value) { requireThat(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 1n << 256n, 'TASK_REVISION_REFUSED', 400); return value; }
const immutable = value => { for (const child of Object.values(value)) if (child && typeof child === 'object') immutable(child); return Object.freeze(value); };
const key = (kind, values) => `task-${kind}:${digest(JSON.stringify(values))}`;
const missing = ['OPERATION_ENCODING_VERIFIER_NOT_CONNECTED', 'USER_CONTROLLED_SIGNER_NOT_CONNECTED'];

const SERVICE_IMPLEMENTATION_DIGEST = `0x${digest(readFileSync(fileURLToPath(import.meta.url)))}`;
export function freezeTaskExecutorIdentity(input) {
  fields(input, ['schema', 'agentId', 'agentVersion', 'adapterId', 'adapterVersion', 'implementationDigest']);
  requireThat(input.schema === '8415-task-executor/1', 'TASK_EXECUTOR_IDENTITY_REFUSED', 400);
  const identity = { schema: '8415-task-executor/1', agentId: identifier(input.agentId), agentVersion: identifier(input.agentVersion),
    adapterId: identifier(input.adapterId), adapterVersion: identifier(input.adapterVersion), implementationDigest: hash(input.implementationDigest) };
  requireThat(!/^0x0+$/.test(identity.implementationDigest), 'TASK_EXECUTOR_IDENTITY_REFUSED', 400);
  return immutable({ identity, digest: `0x${digest(JSON.stringify(identity))}` });
}
function executorCopy(input) {
  requireThat(input && typeof input === 'object', 'TASK_EXECUTOR_STATE_REFUSED', 503);
  const copy = freezeTaskExecutorIdentity(input.identity);
  requireThat(copy.digest === input.digest, 'TASK_EXECUTOR_STATE_REFUSED', 503); return copy;
}

function observationPolicyCopy(input) {
  if (input === null) return null;
  requireThat(input && typeof input === 'object', 'TASK_OBSERVATION_POLICY_STATE_REFUSED', 503);
  const copy = freezeTaskObservationPolicy(input.policy);
  requireThat(copy.digest === input.digest, 'TASK_OBSERVATION_POLICY_STATE_REFUSED', 503); return copy;
}
const sameVerifier = (a, b) => JSON.stringify(a) === JSON.stringify(b);

/** The complete explicit policy uses ArtFi kernelRequestDigest's canonical
 * sorted-key SHA-256, without changing the legacy Wallet task digest. */
export function freezeNftValuationPolicy(input) {
  const policyFields = (value, keys) => {
    requireThat(value && typeof value === 'object' && [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'TASK_REQUEST_REFUSED', 400);
    const descriptors = Object.getOwnPropertyDescriptors(value);
    requireThat(Reflect.ownKeys(descriptors).length === keys.length && keys.every(k =>
      Object.hasOwn(descriptors, k) && Object.hasOwn(descriptors[k], 'value')), 'TASK_REQUEST_REFUSED', 400);
  };
  policyFields(input, ['source', 'base', 'quote', 'rateDecimals', 'priceAt', 'validFrom', 'validUntil', 'maxAgeSeconds']);
  policyFields(input.base, ['chainId', 'token', 'decimals']); policyFields(input.quote, ['currency', 'decimals']);
  const decimals = value => Number.isInteger(value) && value >= 0 && value <= 36;
  requireThat(typeof input.base.token === 'string' && /^0x[0-9a-f]{40}$/i.test(input.base.token) &&
    decimals(input.base.decimals) && decimals(input.rateDecimals) && input.quote.currency === 'USD' && input.quote.decimals === 2 &&
    ['order-review', 'settlement'].includes(input.priceAt), 'TASK_VALUATION_POLICY_REFUSED', 400);
  const policy = { source: identifier(input.source), base: { chainId: version(input.base.chainId), token: input.base.token, decimals: input.base.decimals },
    quote: { currency: 'USD', decimals: 2 }, rateDecimals: input.rateDecimals, priceAt: input.priceAt,
    validFrom: version(input.validFrom), validUntil: version(input.validUntil), maxAgeSeconds: version(input.maxAgeSeconds) };
  requireThat(BigInt(policy.base.chainId) > 0n && BigInt(policy.validFrom) < BigInt(policy.validUntil) &&
    BigInt(policy.maxAgeSeconds) > 0n, 'TASK_VALUATION_POLICY_REFUSED', 400);
  const canonical = value => value && typeof value === 'object' ?
    Object.fromEntries(Object.keys(value).sort().map(k => [k, canonical(value[k])])) : value;
  return immutable({ policy, digest: digest(JSON.stringify(canonical(policy))) });
}
function valuationPolicyCopy(input) {
  requireThat(input && typeof input === 'object', 'TASK_VALUATION_POLICY_STATE_REFUSED', 503);
  const copy = freezeNftValuationPolicy(input.policy);
  requireThat(copy.digest === input.digest, 'TASK_VALUATION_POLICY_STATE_REFUSED', 503); return copy;
}
const isListing = child => child.child.schema === '8415-nft-listing-child/1';
/** Session/credential callbacks and execution adapters are server-owned objects,
 * never JSON request fields. All tenants sharing an actor MUST use this same
 * single-writer store for cross-tenant nonce exclusion. Separate stores/replicas
 * do not provide a coordinated execution boundary and are unsupported.
 */
export function createTaskAuthorizationService({ origin, tenant, store, now = Date.now,
  assertSession, credentialFor, consumeTotp, assertPrincipal = null, principalReady = null,
  execution = null, executorIdentity = null, observationPolicy = null, receipt = null, listingExecution = null, listingResults = null, receiptHandlerId = null, channelBindings = null, testAuthorization = null }) {
  requireThat(receiptHandlerId === null || receiptHandlerId === 'artfi:whole-receipt:v1', 'TASK_RECEIPT_CONFIG_REFUSED', 500);
  requireThat(store && typeof store.transactionMany === 'function' &&
    [assertSession, credentialFor, consumeTotp, now].every(value => typeof value === 'function'), 'TASK_CONFIG_REFUSED', 500);
  requireThat(execution === null || execution && ['verify', 'send', 'recover'].every(name => typeof execution[name] === 'function') &&
    (execution.plan === undefined || typeof execution.plan === 'function') &&
    (execution.recoverHistorical === undefined || typeof execution.recoverHistorical === 'function'), 'TASK_ADAPTER_CONFIG_REFUSED', 500);
  requireThat(listingExecution === null || listingExecution && ['verify', 'send', 'recover'].every(name => typeof listingExecution[name] === 'function') &&
    (listingExecution.plan === undefined || typeof listingExecution.plan === 'function') && typeof store.withReadSnapshot === 'function', 'TASK_LISTING_CONFIG_REFUSED', 500);
  requireThat(listingResults === null || ['read', 'scan'].every(name => typeof listingResults?.[name] === 'function'), 'TASK_LISTING_RESULTS_CONFIG_REFUSED', 500);
  if (listingResults !== null) {
    const configured = listingResults; listingResults = Object.freeze({ read: configured.read.bind(configured), scan: configured.scan.bind(configured) });
  }
  // Legacy direct composition remains supported. New multi-channel startup must
  // supply one explicit binding per active port and no ambiguous global facts.
  requireThat(channelBindings !== null || [execution, listingExecution, receiptHandlerId].filter(port => port !== null).length <= 1,
    'TASK_CHANNEL_BINDINGS_REQUIRED', 500);
  requireThat(channelBindings === null ?
    (execution === null && listingExecution === null && receiptHandlerId === null ? executorIdentity === null : executorIdentity !== null) :
    executorIdentity === null && observationPolicy === null, 'TASK_EXECUTOR_IDENTITY_CONFIG_REQUIRED', 500);
  let channelContexts = null;
  if (channelBindings !== null) {
    const plain = value => value && [Object.prototype, null].includes(Object.getPrototypeOf(value));
    requireThat(plain(channelBindings), 'TASK_CHANNEL_CONFIG_REFUSED', 500);
    const descriptors = Object.getOwnPropertyDescriptors(channelBindings);
    const ports = { 'exact-operation': execution !== null, 'nft-sale': listingExecution !== null, 'artfi-receipt': receiptHandlerId !== null };
    requireThat(Reflect.ownKeys(descriptors).every(kind => Object.hasOwn(ports, kind) && Object.hasOwn(descriptors[kind], 'value')) &&
      Object.entries(ports).every(([kind, enabled]) => Object.hasOwn(descriptors, kind) === enabled), 'TASK_CHANNEL_CONFIG_REFUSED', 500);
    const contexts = {}, identities = new Set();
    for (const kind of Object.keys(descriptors)) {
      const value = descriptors[kind].value;
      requireThat(plain(value), 'TASK_CHANNEL_CONFIG_REFUSED', 500);
      const binding = Object.getOwnPropertyDescriptors(value);
      requireThat(Reflect.ownKeys(binding).length === 2 && ['executorIdentity', 'observationPolicy'].every(key =>
        Object.hasOwn(binding, key) && Object.hasOwn(binding[key], 'value')), 'TASK_CHANNEL_CONFIG_REFUSED', 500);
      const executor = freezeTaskExecutorIdentity(binding.executorIdentity.value);
      requireThat(executor.identity.adapterId !== 'unconfigured-signer' && !identities.has(executor.digest), 'TASK_CHANNEL_EXECUTOR_REUSE_REFUSED', 500);
      identities.add(executor.digest);
      const policy = binding.observationPolicy.value;
      requireThat(kind === 'artfi-receipt' ? policy === null : policy !== null, 'TASK_CHANNEL_OBSERVATION_CONFIG_REFUSED', 500);
      contexts[kind] = Object.freeze({ executor, observationPolicy: policy === null ? null : freezeTaskObservationPolicy(policy) });
    }
    channelContexts = Object.freeze(contexts);
  }
  const executor = freezeTaskExecutorIdentity(executorIdentity ?? { schema: '8415-task-executor/1',
    agentId: '8415wallet:local-task-service', agentVersion: '1', adapterId: 'unconfigured-signer', adapterVersion: '0',
    implementationDigest: SERVICE_IMPLEMENTATION_DIGEST });
  requireThat(channelContexts !== null || execution === null && listingExecution === null && receiptHandlerId === null || executor.identity.adapterId !== 'unconfigured-signer', 'TASK_EXECUTOR_IDENTITY_CONFIG_REQUIRED', 500);
  // Capture methods once; mutating a configuration object's properties cannot
  // replace the verifier/signer beneath an already reviewed executor identity.
  if (execution !== null) {
    const configured = execution;
    execution = Object.freeze(Object.fromEntries(['verify', 'send', 'recover', 'recoverHistorical', 'plan'].filter(name => typeof configured[name] === 'function')
      .map(name => [name, configured[name].bind(configured)])));
  }
  if (listingExecution !== null) {
    const configured = listingExecution;
    listingExecution = Object.freeze(Object.fromEntries(['verify', 'send', 'recover', 'plan'].filter(name => typeof configured[name] === 'function')
      .map(name => [name, configured[name].bind(configured)])));
  }
  requireThat(channelContexts !== null || execution === null && listingExecution === null || observationPolicy !== null, 'TASK_OBSERVATION_POLICY_CONFIG_REQUIRED', 500);
  const approvedObservationPolicy = channelContexts === null ? (observationPolicy === null ? null : freezeTaskObservationPolicy(observationPolicy)) :
    channelContexts['exact-operation']?.observationPolicy ?? null;
  let receiptVerifier = null;
  if (receipt !== null) {
    requireThat(typeof receipt.observe === 'function' && typeof receipt.assessChild === 'function' && approvedObservationPolicy !== null &&
      observationPolicyCopy(receipt.observationPolicy)?.digest === approvedObservationPolicy.digest, 'TASK_RECEIPT_CONFIG_REFUSED', 500);
    receiptVerifier = normalizeObservationVerifier(receipt.identity);
    const configured = receipt;
    receipt = Object.freeze({ assessChild: configured.assessChild.bind(configured), observe: configured.observe.bind(configured), ...(typeof configured.observeReplacement === 'function' ?
      { observeReplacement: configured.observeReplacement.bind(configured) } : {}), ...(typeof configured.observeMintResult === 'function' ?
      { observeMintResult: configured.observeMintResult.bind(configured) } : {}) });
  }
  // Selection is always from a normalized task (or the stored grant), never a
  // request-supplied adapter name. Removing/replacing a port suspends its grants;
  // it never falls back to another channel's approval identity.
  function approvalContext(task) {
    if (channelContexts === null) return { executor, approvedObservationPolicy, receiptVerifier };
    const kind = task.policy.intent.kind, selected = channelContexts[kind];
    return { executor: selected?.executor ?? executor,
      approvedObservationPolicy: selected?.observationPolicy ?? null,
      receiptVerifier: kind === 'exact-operation' && selected ? receiptVerifier : null };
  }
  requireThat(assertPrincipal === null || typeof assertPrincipal === 'function', 'TASK_BACKGROUND_CONFIG_REFUSED', 500);
  const internalContexts = new WeakSet(), assertOwnerSession = assertSession, ownerCredentialFor = credentialFor;
  // Only this closure creates internal contexts, from a durably approved grant.
  // A JSON object, caller flag, session ID or cookie cannot construct one.
  assertSession = (context, credential) => {
    if (!internalContexts.has(context)) return assertOwnerSession(context, credential);
    requireThat(assertPrincipal !== null, 'TASK_BACKGROUND_PRINCIPAL_NOT_CONFIGURED', 503);
    const result = assertPrincipal(context, credential);
    requireThat(!result || typeof result.then !== 'function', 'TASK_BACKGROUND_CONFIG_REFUSED', 500);
  };
  credentialFor = async context => {
    if (!internalContexts.has(context)) return ownerCredentialFor(context);
    const credential = await store.read(`${tenant}:${context.username}`); assertSession(context, credential); return credential;
  };
  requireThat(testAuthorization === null || typeof testAuthorization.allows === 'function', 'TASK_TEST_ASSET_CONFIG_REFUSED', 500);
  const testScope = testAuthorization === null ? null : testAuthorization.allows.bind(testAuthorization);
  const acceptCommittedMintRecord = typeof testAuthorization?.acceptCommittedMintRecord === 'function' ?
    testAuthorization.acceptCommittedMintRecord.bind(testAuthorization) : null;
  function testFactorAllowed(task) {
    if (testScope === null) return false;
    const value = testScope(task);
    requireThat(typeof value === 'boolean', 'TASK_TEST_ASSET_CONFIG_REFUSED', 500);
    return value;
  }
  const queueKey = key('queue', [origin, tenant]);
  const challenges = new Map();
  const stamp = () => { const time = now(); requireThat(Number.isSafeInteger(time) && time >= 0, 'TASK_CLOCK_REFUSED', 503); return time; };
  const seconds = () => BigInt(Math.floor(stamp() / 1000));
  const principal = session => [origin, tenant, session.username, session.account.toLowerCase(), session.chainId];
  const binding = session => JSON.stringify([...principal(session), session.id, session.revision]);
  const credentialKey = session => `${tenant}:${session.username}`;
  const grantKey = (session, taskDigest) => key('grant', [...principal(session), hash(taskDigest)]);
  const ownerIndexKey = session => key('owner', principal(session));
  const taskIdKey = (session, taskId) => key('id', [...principal(session), identifier(taskId)]);
  // Tenant-independent keys: one account cannot spend the same nonce in two tasks.
  const operationKey = (task, operationId) => key('operation', [task.policy.chainId, task.policy.actor, identifier(operationId)]);
  const nonceKey = child => isListing(child) ? key('listing-order', [child.child.chainId, child.child.seller, child.child.protocol, child.child.orderHash]) :
    key('nonce', [child.child.operation.chainId, child.child.operation.actor, child.child.nonce]);
  function sweep() {
    const time = stamp();
    for (const [id, challenge] of challenges) if (time < challenge.issuedAt || time >= challenge.expiresAt) challenges.delete(id);
  }
  function cancel(session) {
    for (const [id, challenge] of challenges) if (challenge.sessionId === session.id) challenges.delete(id);
  }
  function checkTask(task, session) {
    requireThat(task.policy.origin === origin && task.policy.tenant === tenant && task.policy.actor === session.account.toLowerCase() &&
      task.policy.chainId === session.chainId, 'TASK_PRINCIPAL_BINDING_REFUSED', 403);
  }
  function readGrant(raw, session, taskDigest) {
    requireThat(['8415-task-grant/1', '8415-task-grant/2'].includes(raw?.schema) && raw.principal === JSON.stringify(principal(session)) &&
      raw.task?.digest === taskDigest && ['pending', 'authorized', 'revoked'].includes(raw.status), 'TASK_GRANT_NOT_FOUND', 404);
    if (raw.schema === '8415-task-grant/2') {
      const valuation = valuationPolicyCopy(raw.valuationPolicy);
      requireThat(raw.task.policy.intent.kind === 'nft-sale' && valuation.policy.base.chainId === raw.task.policy.chainId &&
        (raw.status === 'pending' || raw.budget?.schema === '8415-task-budget/2'), 'TASK_VALUATION_POLICY_STATE_REFUSED', 503);
    } else requireThat(raw.valuationPolicy === undefined && (raw.status === 'pending' || raw.budget?.schema === '8415-task-budget/1'), 'TASK_GRANT_STATE_REFUSED', 503);
    const task = freezeAuthorizedTask(raw.task.policy); checkTask(task, session); executorCopy(raw.executor); observationPolicyCopy(raw.observationPolicy);
    if (raw.receiptVerifier !== null) normalizeObservationVerifier(raw.receiptVerifier);
    requireThat(Array.isArray(raw.observations), 'TASK_OBSERVATION_STATE_REFUSED', 503); version(raw.observationRevision);
    for (const entry of raw.observations) { identifier(entry.operationId);
      requireThat(typeof entry.available === 'boolean' && (!entry.available || entry.observation !== null), 'TASK_OBSERVATION_STATE_REFUSED', 503);
      if (entry.observation !== null) normalizeTaskObservation(entry.observation); }
    requireThat(task.digest === taskDigest && (raw.status === 'pending' ? raw.budget === null : raw.budget?.taskDigest === taskDigest) &&
      typeof raw.reference === 'string' && Number.isSafeInteger(raw.issuedAt) && raw.issuedAt >= 0,
    'TASK_GRANT_STATE_REFUSED', 503);
    version(raw.grantPolicyVersion);
    if (raw.status !== 'pending') { version(raw.credentialRevisionAtApproval); normalizeTaskBudget(raw.budget); }
    return raw;
  }
  function effectiveStatus(grant, credential) {
    const { executor, approvedObservationPolicy, receiptVerifier } = approvalContext(grant.task);
    if (grant.status === 'revoked') return 'revoked';
    if (grant.approvalFactor === 'server-test-scope' && !testFactorAllowed(grant.task)) return 'suspended';
    if (stamp() < grant.issuedAt || seconds() >= BigInt(grant.task.policy.expiresAt)) return 'expired';
    // Factor changes pause this principal only; they never renew or expand a task.
    if (grant.status === 'pending') return 'pending';
    if (grant.executor.digest !== executor.digest || grant.observationPolicy?.digest !== approvedObservationPolicy?.digest ||
      !sameVerifier(grant.receiptVerifier, receiptVerifier)) return 'suspended';
    if (String(credential?.revision ?? 0) !== grant.credentialRevisionAtApproval) return 'suspended';
    return 'authorized';
  }
  function requireActive(grant, credential) {
    const { executor, approvedObservationPolicy, receiptVerifier } = approvalContext(grant.task);
    const status = effectiveStatus(grant, credential);
    requireThat(status === 'authorized', status === 'suspended' ? (grant.executor.digest !== executor.digest ? 'TASK_EXECUTOR_REVALIDATION_REQUIRED' : grant.observationPolicy?.digest !== approvedObservationPolicy?.digest ? 'TASK_OBSERVATION_POLICY_REVALIDATION_REQUIRED' :
      !sameVerifier(grant.receiptVerifier, receiptVerifier) ? 'TASK_RECEIPT_VERIFIER_REVALIDATION_REQUIRED' : 'TASK_FACTOR_REVALIDATION_REQUIRED') : `TASK_GRANT_${status.toUpperCase()}`, 403);
  }
  function completion(grant) {
    const spent = grant.budget?.reservations.filter(r => r.status !== 'cancelled') ?? [];
    if (!spent.length) return { state: 'not-attempted', fresh: false };
    if (spent.some(r => r.status === 'outcome-unknown')) return { state: 'outcome-unknown', fresh: false };
    if (grant.schema === '8415-task-grant/2') return { state: spent.some(r => r.status === 'submitted') ? 'listed-awaiting-evidence' : 'not-attempted', fresh: false };
    const observations = spent.map(r => grant.observations.find(entry => entry.operationId === r.operationId &&
      entry.available && entry.observation?.childDigest === r.childDigest)?.observation);
    if (observations.every(o => o?.state === 'confirmed-at-depth')) return { state: 'completed-at-observation-depth', fresh: false };
    if (observations.some(o => ['reverted-at-depth', 'superseded-at-depth'].includes(o?.state))) return { state: 'failed-at-observation-depth', fresh: false };
    return { state: 'awaiting-evidence', fresh: false };
  }
  function view(grant, credential) {
    const { executor, approvedObservationPolicy, receiptVerifier } = approvalContext(grant.task);
    const effective = effectiveStatus(grant, credential), gaps = grant.schema === '8415-task-grant/2' ?
      (listingResults ? [] : ['TASK_LISTING_OBSERVER_NOT_CONNECTED']) : execution ? ['TASK_CHILD_VERIFICATION_REQUIRED'] : [...missing,
      ...(grant.task.policy.intent.kind === 'nft-sale' ? ['MARKET_PRICE_VERIFIER_NOT_CONNECTED', 'ATOMIC_SALE_SETTLEMENT_VERIFIER_NOT_CONNECTED'] : [])];
    if (grant.task.policy.intent.kind === 'artfi-receipt') { gaps.length = 0; gaps.push('TASK_RECEIPT_FIXED_HANDLER_REQUIRED'); }
    if (grant.task.policy.intent.kind === 'nft-sale') gaps.push(grant.schema !== '8415-task-grant/2' ? 'TASK_VALUATION_POLICY_AUTHORIZATION_REQUIRED' :
      grant.valuationPolicy.policy.priceAt === 'settlement' ? 'TASK_FUTURE_USD_PRICE_NOT_GUARANTEED' :
      listingExecution === null ? 'TASK_LISTING_ADAPTER_NOT_CONNECTED' : 'TASK_LISTING_VERIFICATION_REQUIRED');
    return { ...(grant.schema === '8415-task-grant/2' ? { valuationPolicy: grant.valuationPolicy, listing: {
      revocationCancelsPublishedOrder: false, settlementObservationConfigured: Boolean(listingResults), ...(listingResults ? { result: null } : {}) } } : {}), task: grant.task, executor: grant.executor, observationPolicy: grant.observationPolicy, receiptVerifier: grant.receiptVerifier,
      observations: grant.observations, observationRevision: grant.observationRevision, completion: completion(grant), authorization: grant.status === 'pending' ? null : {
      schema: grant.schema === '8415-task-grant/2' ? '8415-task-authorization-reference/2' : '8415-task-authorization-reference/1',
      ...(grant.schema === '8415-task-grant/2' ? { valuationPolicyDigest: grant.valuationPolicy.digest, priceAt: grant.valuationPolicy.policy.priceAt } : {}),
      taskDigest: grant.task.digest, reference: grant.reference,
      status: effective, grantPolicyVersion: grant.grantPolicyVersion,
      credentialRevisionAtApproval: grant.credentialRevisionAtApproval,
    }, effectiveStatus: effective, budget: grant.budget,
    ...(grant.task.policy.intent.kind === 'artfi-receipt' ? { receiptAttempts: normalizeReceiptAttempts(grant.task, grant.receiptAttempts ?? []) } : {}),
    capabilities: { executable: false, adapterConfigured: Boolean(grant.task.policy.intent.kind === 'artfi-receipt' ? receiptHandlerId : grant.schema === '8415-task-grant/2' ? listingExecution : execution), missing: gaps,
      sessionRequired: true, factorRevalidationRequired: String(credential?.revision ?? 0) !== grant.credentialRevisionAtApproval && grant.status !== 'pending',
      executorRevalidationRequired: grant.executor.digest !== executor.digest, receiptVerifierConfigured: receiptVerifier !== null,
      observationPolicyRevalidationRequired: grant.observationPolicy?.digest !== approvedObservationPolicy?.digest,
      receiptVerifierRevalidationRequired: !sameVerifier(grant.receiptVerifier, receiptVerifier) } };
  }
  async function transaction(keys, update) {
    try { return await store.transactionMany(keys, update); }
    catch (error) {
      if (error?.message === 'AUTH_STORE_CAPACITY') throw new TaskAuthorizationError('TASK_STORE_CAPACITY', 507);
      if (error instanceof TaskContractError || error instanceof ReceiptTaskError || error instanceof TaskObservationError) throw new TaskAuthorizationError(error.code, 409);
      throw error;
    }
  }
  async function status(session, taskDigest) {
    const ckey = credentialKey(session), gkey = grantKey(session, taskDigest);
    // Read both in one serialized snapshot; a write failure cannot yield authority.
    const result = await store.readMany([ckey, gkey]);
    assertSession(session, result[ckey]); readGrant(result[gkey], session, taskDigest);
    return listingView(session, result[gkey], result[ckey]);
  }
  // This read path never calls plan, send, recovery or observer discovery.
  async function listingView(session, grant, credential, scan = false) {
    const initial = view(grant, credential);
    if (!listingResults || grant.schema !== '8415-task-grant/2') return initial;
    const submitted = grant.budget?.reservations.filter(r => r.status === 'submitted') ?? [];
    if (!submitted.length) return initial;
    requireThat(submitted.length === 1, 'TASK_LISTING_RESULTS_BINDING_REFUSED', 503);
    const reservation = submitted[0], gkey = grantKey(session, grant.task.digest), ckey = credentialKey(session),
      okey = operationKey(grant.task, reservation.operationId);
    const values = await store.readMany([ckey, gkey, okey]);
    assertSession(session, values[ckey]);
    const current = readGrant(values[gkey], session, grant.task.digest), operation = values[okey];
    requireThat(operation?.schema === '8415-task-operation/2' && operation.grantKey === gkey && operation.status === 'submitted' &&
      operation.child?.digest === reservation.childDigest && isListing(operation.child), 'TASK_LISTING_RESULTS_BINDING_REFUSED', 503);
    const child = freezeNftListingChild(operation.child.child);
    requireThat(child.digest === reservation.childDigest && child.child.orderHash === reservation.submission?.orderHash &&
      child.child.chainId === reservation.submission?.chainId, 'TASK_LISTING_RESULTS_BINDING_REFUSED', 503);
    let result = null, error = null;
    try {
      const summary = await listingResults[scan ? 'scan' : 'read'](listingInput({ grant: current, child, operation }));
      result = normalizeListingResult(summary, { taskDigest: current.task.digest, childDigest: child.digest, chainId: current.task.policy.chainId,
        orderHash: child.child.orderHash, requestedQuantity: current.task.policy.intent.quantity, minimumConfirmations: current.observationPolicy.policy.minimumConfirmations });
    } catch (failure) { error = /^[A-Z][A-Z0-9_]{0,127}$/.test(failure?.code ?? failure?.message ?? '') ? failure.code ?? failure.message : 'TASK_LISTING_OBSERVER_UNAVAILABLE'; }
    // Recheck owner entitlement after asynchronous external reads. Revocation
    // changes the displayed grant, but never turns this read into new authority.
    const latest = await store.readMany([ckey, gkey, okey]); assertSession(session, latest[ckey]);
    const checked = readGrant(latest[gkey], session, grant.task.digest);
    requireThat(latest[okey]?.child?.digest === child.digest && latest[okey]?.status === 'submitted' &&
      checked.budget.reservations.some(r => r.childDigest === child.digest && r.status === 'submitted'), 'TASK_LISTING_RESULTS_BINDING_REFUSED', 503);
    const projected = view(checked, latest[ckey]);
    return { ...projected, listing: { ...projected.listing, result, ...(error ? { observationError: error } : {}) },
      completion: { state: listingCompletion(result?.state ?? 'unknown'), fresh: result?.summary.freshness === 'FRESH' } };
  }
  async function list(body, session) {
    requireThat(Object.keys(body).length === 0 || Object.keys(body).length === 2 && Object.hasOwn(body, 'cursor') && Object.hasOwn(body, 'revision'), 'TASK_REQUEST_REFUSED', 400);
    const cursor = body.cursor === undefined ? 0 : Number(version(body.cursor));
    requireThat(Number.isSafeInteger(cursor) && cursor >= 0, 'TASK_CURSOR_REFUSED', 400);
    const ckey = credentialKey(session), lkey = ownerIndexKey(session);
    const first = await store.readMany([ckey, lkey]); assertSession(session, first[ckey]);
    const index = first[lkey] ?? { revision: '0', taskDigests: [] };
    if (body.revision !== undefined) requireThat(version(body.revision) === index.revision, 'TASK_LIST_REVISION_CONFLICT');
    requireThat(Array.isArray(index.taskDigests) && cursor <= index.taskDigests.length, 'TASK_CURSOR_REFUSED', 400);
    const selected = index.taskDigests.slice(cursor, cursor + 50), keys = selected.map(value => grantKey(session, value));
    const result = await store.readMany([ckey, lkey, ...keys]); assertSession(session, result[ckey]);
    requireThat((result[lkey]?.revision ?? '0') === index.revision, 'TASK_LIST_REVISION_CONFLICT');
    return { tasks: await Promise.all(selected.map((value, i) => listingView(session, readGrant(result[keys[i]], session, value), result[ckey]))),
      revision: index.revision, nextCursor: cursor + selected.length < index.taskDigests.length ? String(cursor + selected.length) : null };
  }
  async function prepare(body, session) {
    const withValuation = body !== null && typeof body === 'object' && Object.hasOwn(body, 'valuationPolicy'); fields(body, withValuation ? ['policy', 'valuationPolicy'] : ['policy']);
    const task = freezeAuthorizedTask(body.policy); checkTask(task, session);
    requireThat(!['artfi-test-series-mint','artfi-test-nft721-mint'].includes(task.policy.intent.operation?.kind) || testFactorAllowed(task),
      'TASK_TEST_MINT_INVENTORY_REQUIRED', 403);
    requireThat(!['artfi-test-series-mint','artfi-test-nft721-mint'].includes(task.policy.intent.operation?.kind) || typeof receipt?.observeMintResult === 'function',
      'TASK_TEST_MINT_OBSERVER_NOT_CONNECTED', 503);
    requireThat(channelContexts === null || Object.hasOwn(channelContexts, task.policy.intent.kind), 'TASK_CHANNEL_NOT_CONFIGURED', 503);
    const { executor, approvedObservationPolicy, receiptVerifier } = approvalContext(task);
    requireThat(task.policy.intent.kind !== 'artfi-receipt' || receiptHandlerId !== null, 'TASK_RECEIPT_GATE_NOT_CONFIGURED', 503);
    const valuationPolicy = withValuation ? freezeNftValuationPolicy(body.valuationPolicy) : null;
    requireThat(valuationPolicy === null || task.policy.intent.kind === 'nft-sale' && valuationPolicy.policy.base.chainId === task.policy.chainId, 'TASK_VALUATION_POLICY_BINDING_REFUSED', 400);
    await credentialFor(session); assertSession(session); sweep();
    const time = stamp(); requireThat(BigInt(task.policy.expiresAt) > seconds(), 'TASK_EXPIRED', 400);
    requireThat(challenges.size < 10000, 'TASK_BUSY', 503);
    const ckey = credentialKey(session), gkey = grantKey(session, task.digest), ikey = taskIdKey(session, task.policy.taskId), lkey = ownerIndexKey(session);
    await transaction([ckey, gkey, ikey, lkey], values => {
      assertSession(session, values[ckey]); requireThat(BigInt(task.policy.expiresAt) > seconds(), 'TASK_EXPIRED', 400);
      requireThat(values[ikey] === null || values[ikey].taskDigest === task.digest, 'TASK_ID_ALREADY_BOUND');
      if (values[gkey] !== null) {
        const prior = readGrant(values[gkey], session, task.digest); requireThat(prior.status === 'pending', 'TASK_ALREADY_EXISTS');
        requireThat((prior.valuationPolicy?.digest ?? null) === (valuationPolicy?.digest ?? null), 'TASK_VALUATION_POLICY_REAUTHORIZATION_REQUIRED');
        requireThat(prior.executor.digest === executor.digest && prior.observationPolicy?.digest === approvedObservationPolicy?.digest &&
          sameVerifier(prior.receiptVerifier, receiptVerifier), 'TASK_EXECUTOR_REVALIDATION_REQUIRED');
        return values;
      }
      const index = values[lkey] ?? { revision: '0', taskDigests: [] };
      version(index.revision); requireThat(BigInt(index.revision) < (1n << 256n) - 1n, 'TASK_REVISION_EXHAUSTED');
      return { [ckey]: values[ckey], [gkey]: { schema: valuationPolicy === null ? '8415-task-grant/1' : '8415-task-grant/2', ...(valuationPolicy === null ? {} : { valuationPolicy }), principal: JSON.stringify(principal(session)), task, executor, observationPolicy: approvedObservationPolicy, receiptVerifier,
        observations: [], observationRevision: '0',
        reference: `grant:${randomToken()}`, status: 'pending', grantPolicyVersion: '0', credentialRevisionAtApproval: null,
        issuedAt: time, revokedAt: null, budget: null }, [ikey]: { taskDigest: task.digest },
      [lkey]: { revision: (BigInt(index.revision) + 1n).toString(), taskDigests: [...index.taskDigests, task.digest] } };
    });
    assertSession(session); sweep();
    const challengeId = `challenge:${randomToken()}`, expiresAt = Math.min(time + CHALLENGE_LIFE, session.expiresAt,
      Number(BigInt(task.policy.expiresAt) * 1000n > BigInt(Number.MAX_SAFE_INTEGER) ? BigInt(Number.MAX_SAFE_INTEGER) : BigInt(task.policy.expiresAt) * 1000n));
    requireThat(stamp() < expiresAt, 'TASK_APPROVAL_CHALLENGE_REFUSED', 403);
    challenges.set(challengeId, { task, executor, valuationPolicy, observationPolicy: approvedObservationPolicy, receiptVerifier, sessionId: session.id, binding: binding(session), testFactorExempt: testFactorAllowed(task), issuedAt: time, expiresAt, attempts: 0 });
    return { challengeId, task, executor, ...(valuationPolicy === null ? {} : { valuationPolicy }), observationPolicy: approvedObservationPolicy, receiptVerifier, expiresAt, approvalFactor: testFactorAllowed(task) ? 'server-test-scope' : 'totp', purpose: 'authorize-task' };
  }
  async function authorize(body, session) {
    const withValuation = body !== null && typeof body === 'object' && (Object.hasOwn(body, 'valuationPolicyDigest') || Object.hasOwn(body, 'priceAt'));
    fields(body, ['challengeId', 'taskDigest', 'executorDigest', 'observationPolicyDigest', 'code', ...(withValuation ? ['valuationPolicyDigest', 'priceAt'] : [])]); hash(body.taskDigest); hash(body.executorDigest); if (body.observationPolicyDigest !== null) hash(body.observationPolicyDigest); sweep();
    const challenge = challenges.get(body.challengeId);
    const current = () => {
      assertSession(session); sweep();
      requireThat(challenge, 'TASK_APPROVAL_CHALLENGE_REFUSED', 403);
      requireThat(testFactorAllowed(challenge.task) === challenge.testFactorExempt, 'TASK_APPROVAL_CHALLENGE_REFUSED', 403);
      const { executor, approvedObservationPolicy } = approvalContext(challenge.task);
      requireThat(challenge && challenges.get(body.challengeId) === challenge && challenge.binding === binding(session) &&
        equal(challenge.task.digest, body.taskDigest) && equal(challenge.executor.digest, body.executorDigest) && equal(executor.digest, body.executorDigest) &&
        (challenge.valuationPolicy === null ? !withValuation : withValuation && challenge.valuationPolicy.digest === body.valuationPolicyDigest &&
          challenge.valuationPolicy.policy.priceAt === body.priceAt) &&
        (challenge.observationPolicy?.digest ?? null) === body.observationPolicyDigest &&
        (approvedObservationPolicy?.digest ?? null) === body.observationPolicyDigest, 'TASK_APPROVAL_CHALLENGE_REFUSED', 403);
    };
    current(); requireThat(challenge.attempts < 5, 'TASK_APPROVAL_ATTEMPTS_EXHAUSTED', 429); challenge.attempts++;
    const ckey = credentialKey(session), gkey = grantKey(session, body.taskDigest), ikey = taskIdKey(session, challenge.task.policy.taskId);
    const result = await transaction([ckey, gkey, ikey, queueKey], values => {
      current(); assertSession(session, values[ckey]);
      const proposal = readGrant(values[gkey], session, body.taskDigest);
      requireThat(proposal.status === 'pending' && proposal.executor.digest === body.executorDigest && values[ikey]?.taskDigest === body.taskDigest, 'TASK_ALREADY_EXISTS');
      requireThat((proposal.valuationPolicy?.digest ?? null) === (challenge.valuationPolicy?.digest ?? null), 'TASK_VALUATION_POLICY_REAUTHORIZATION_REQUIRED');
      // One durable replace consumes the OTP and creates every grant/index field.
      const credential = challenge.testFactorExempt ? values[ckey] : consumeTotp(session, values[ckey], body.code);
      const grant = { schema: challenge.valuationPolicy === null ? '8415-task-grant/1' : '8415-task-grant/2',
        ...(challenge.valuationPolicy === null ? {} : { valuationPolicy: challenge.valuationPolicy }), principal: JSON.stringify(principal(session)),
        task: challenge.task, executor: challenge.executor, observationPolicy: challenge.observationPolicy, receiptVerifier: challenge.receiptVerifier,
        observations: [], observationRevision: '0', reference: proposal.reference, status: 'authorized', grantPolicyVersion: '1',
        approvalFactor: challenge.testFactorExempt ? 'server-test-scope' : 'totp',
        credentialRevisionAtApproval: String(session.revision), issuedAt: stamp(), revokedAt: null,
        budget: challenge.task.policy.intent.kind === 'artfi-receipt' ? { schema: '8415-task-budget/1', taskDigest: challenge.task.digest, revision: '0', reservations: [] } : challenge.valuationPolicy === null ? emptyTaskBudget(challenge.task) : emptyNftListingBudget(challenge.task) };
      const queue = values[queueKey] ?? { schema: '8415-task-queue/1', entries: [] };
      requireThat(queue.schema === '8415-task-queue/1' && Array.isArray(queue.entries) && !queue.entries.includes(gkey), 'TASK_QUEUE_STATE_REFUSED', 503);
      return { [ckey]: credential, [gkey]: grant, [ikey]: { taskDigest: body.taskDigest },
        [queueKey]: { schema: '8415-task-queue/1', entries: [...queue.entries, gkey] } };
    });
    challenges.delete(body.challengeId); return view(result[gkey], result[ckey]);
  }
  async function reserve(body, session) {
    fields(body, ['taskDigest', 'child', 'expectedBudgetRevision']); hash(body.taskDigest); version(body.expectedBudgetRevision);
    const child = body.child?.schema === '8415-nft-listing-child/1' ? freezeNftListingChild(body.child) : freezeChildOperation(body.child);
    requireThat(child.child.taskDigest === body.taskDigest, 'TASK_BINDING_MISMATCH');
    const ckey = credentialKey(session), gkey = grantKey(session, body.taskDigest);
    const okey = key('operation', [isListing(child) ? child.child.chainId : child.child.operation.chainId,
      isListing(child) ? child.child.seller : child.child.operation.actor, child.child.operationId]), nkey = nonceKey(child);
    const result = await transaction([ckey, gkey, okey, nkey], values => {
      assertSession(session, values[ckey]); const grant = readGrant(values[gkey], session, body.taskDigest); requireActive(grant, values[ckey]);
      requireThat(values[okey] === null, 'TASK_DUPLICATE_OPERATION_REFUSED'); requireThat(values[nkey] === null, 'TASK_NONCE_OCCUPIED');
      if (isListing(child)) requireThat(grant.schema === '8415-task-grant/2', 'TASK_VALUATION_POLICY_AUTHORIZATION_REQUIRED');
      const budget = isListing(child) ? reserveNftListingBudget(grant.task, child, listingGrantBinding(grant), grant.budget, body.expectedBudgetRevision, seconds()) :
        reserveTaskBudget(grant.task, child, grant.budget, body.expectedBudgetRevision, seconds());
      const operation = { schema: isListing(child) ? '8415-task-operation/2' : '8415-task-operation/1', grantKey: gkey, child, status: 'reserved',
        ...(isListing(child) ? { orderKey: nkey } : { nonceKey: nkey }), observationRevision: '0' };
      return { [ckey]: values[ckey], [gkey]: { ...grant, budget }, [okey]: operation,
        [nkey]: { operationKey: okey, taskDigest: body.taskDigest, childDigest: child.digest, permanent: false } };
    });
    return view(result[gkey], result[ckey]);
  }
  async function operationContext(body, session) {
    fields(body, ['taskDigest', 'operationId', 'childDigest', 'expectedBudgetRevision']);
    hash(body.taskDigest); hash(body.childDigest); identifier(body.operationId); version(body.expectedBudgetRevision);
    const credential = await credentialFor(session), gkey = grantKey(session, body.taskDigest);
    const grant = readGrant(await store.read(gkey), session, body.taskDigest);
    assertSession(session); const okey = operationKey(grant.task, body.operationId), operation = await store.read(okey);
    assertSession(session);
    requireThat(['8415-task-operation/1', '8415-task-operation/2'].includes(operation?.schema) && operation.grantKey === gkey && operation.child?.digest === body.childDigest,
      'TASK_OPERATION_NOT_FOUND', 404);
    const child = operation.schema === '8415-task-operation/2' ? freezeNftListingChild(operation.child.child) : freezeChildOperation(operation.child.child);
    const claimKey = isListing(child) ? operation.orderKey : operation.nonceKey;
    requireThat(child.digest === body.childDigest && child.child.taskDigest === body.taskDigest &&
      claimKey === nonceKey(child), 'TASK_OPERATION_STATE_REFUSED', 503);
    return { credential, ckey: credentialKey(session), gkey, grant, okey, nkey: claimKey, child, operation };
  }
  function checkOperation(values, context, body, session) {
    const { ckey, gkey, okey, nkey } = context;
    assertSession(session, values[ckey]); const grant = readGrant(values[gkey], session, body.taskDigest);
    requireThat(values[okey]?.grantKey === gkey && values[okey]?.child?.digest === body.childDigest &&
      values[nkey]?.operationKey === okey && values[nkey]?.childDigest === body.childDigest, 'TASK_OPERATION_STATE_REFUSED', 503);
    requireThat(grant.budget.revision === body.expectedBudgetRevision, 'TASK_BUDGET_REVISION_CONFLICT');
    return grant;
  }
  async function cancelReservation(body, session) {
    const context = await operationContext(body, session), { ckey, gkey, okey, nkey } = context;
    const result = await transaction([ckey, gkey, okey, nkey], values => {
      const grant = checkOperation(values, context, body, session);
      requireThat(values[okey].status === 'reserved' && values[nkey].permanent === false, 'TASK_UNCERTAIN_RESERVATION_CANNOT_RELEASE');
      const budget = cancelUnattemptedReservation(grant.budget, body.operationId, body.childDigest, body.expectedBudgetRevision);
      // Cancel is safe even after revocation/expiry. The operation ID is forever
      // consumed; the nonce can be used by a new explicitly unattempted proposal.
      return { [ckey]: values[ckey], [gkey]: { ...grant, budget }, [okey]: { ...values[okey], status: 'cancelled' }, [nkey]: null };
    });
    return view(result[gkey], result[ckey]);
  }
  function verifiedBinding(result, context) {
    const { child, grant } = context;
    return result && result.taskDigest === grant.task.digest && result.childDigest === child.digest &&
      result.chainId === child.child.operation.chainId && result.actor === child.child.operation.actor &&
      result.nonce === child.child.nonce && result.executorDigest === (context.operation?.attemptExecutor?.digest ?? grant.executor.digest) && result.grantPolicyVersion === (context.operation?.attemptGrantPolicyVersion ?? grant.grantPolicyVersion);
  }
  async function execute(body, session) {
    const context = await operationContext(body, session);
    if (isListing(context.child)) return executeListing(context, body, session);
    requireThat(execution, 'TASK_EXECUTION_ADAPTER_NOT_CONNECTED', 503);
    requireThat(receipt && context.grant.receiptVerifier !== null, 'TASK_RECEIPT_VERIFIER_NOT_CONNECTED', 503); requireActive(context.grant, context.credential);
    requireThat(assessChildScope(context.grant.task, context.child, seconds()).state !== 'outside-declared-scope', 'TASK_CHILD_OUTSIDE_SCOPE');
    const capability = await receipt.assessChild(immutable(structuredClone({ task: context.grant.task, child: context.child,
      executor: context.grant.executor, observationPolicy: context.grant.observationPolicy.policy })));
    fields(capability, ['taskDigest', 'childDigest', 'executorDigest', 'observationPolicyDigest', 'verifierId', 'verifierVersion',
      'verifierImplementationDigest', 'capability']);
    requireThat(capability.taskDigest === context.grant.task.digest && capability.childDigest === context.child.digest &&
      capability.executorDigest === context.grant.executor.digest && capability.observationPolicyDigest === context.grant.observationPolicy.digest &&
      capability.verifierId === receiptVerifier.verifierId && capability.verifierVersion === receiptVerifier.verifierVersion &&
      capability.verifierImplementationDigest === receiptVerifier.verifierImplementationDigest &&
      capability.capability === 'exact-operation-observable' && context.grant.task.policy.intent.kind === 'exact-operation',
      'TASK_RECEIPT_CAPABILITY_REFUSED', 503);
    // Server-configured verifier must independently re-encode the operation,
    // inspect live account/chain/nonce, and verify sale price + atomic settlement.
    const checked = await execution.verify(immutable(structuredClone({ task: context.grant.task, child: context.child, executor: context.grant.executor,
      grantPolicyVersion: context.grant.grantPolicyVersion })));
    requireThat(verifiedBinding(checked, context), 'TASK_EXECUTION_VERIFICATION_REFUSED', 403);
    const { ckey, gkey, okey, nkey } = context;
    const result = await transaction([ckey, gkey, okey, nkey], values => {
      const grant = checkOperation(values, context, body, session); requireActive(grant, values[ckey]);
      requireThat(grant.grantPolicyVersion === context.grant.grantPolicyVersion && values[okey].status === 'reserved' &&
        !values[nkey].permanent, 'TASK_SEND_ATTEMPT_REFUSED');
      requireThat(assessChildScope(grant.task, context.child, seconds()).state !== 'outside-declared-scope', 'TASK_CHILD_OUTSIDE_SCOPE');
      return { [ckey]: values[ckey], [gkey]: { ...grant, budget: markTaskSendAttempt(grant.budget, body.operationId, body.childDigest, body.expectedBudgetRevision) },
        [okey]: { ...values[okey], status: 'outcome-unknown', attemptGrantPolicyVersion: grant.grantPolicyVersion, attemptExecutor: grant.executor, attemptObservationPolicy: grant.observationPolicy, attemptReceiptVerifier: grant.receiptVerifier }, [nkey]: { ...values[nkey], permanent: true } };
    });
    // This is the sole send call. Any exception or lost response keeps the full
    // durable reservation and permanent nonce claim; neither retry nor release.
    let submitted;
    try { submitted = await execution.send(immutable(structuredClone({ task: context.grant.task, child: context.child, executor: context.grant.executor,
      grantPolicyVersion: context.grant.grantPolicyVersion }))); }
    catch { return { ...view(result[gkey], result[ckey]), outcome: 'outcome-unknown' }; }
    if (!verifiedBinding(submitted, context) || !/^0x[0-9a-f]{64}$/.test(submitted.transactionHash ?? '') || /^0x0+$/.test(submitted.transactionHash)) {
      return { ...view(result[gkey], result[ckey]), outcome: 'outcome-unknown' };
    }
    return recordSubmission(context, body, session, submitted.transactionHash, result[gkey].budget.revision);
  }
  function listingGrantBinding(grant) {
    requireThat(grant.schema === '8415-task-grant/2', 'TASK_VALUATION_POLICY_AUTHORIZATION_REQUIRED');
    return { taskDigest: grant.task.digest, executorDigest: grant.executor.digest, grantReference: grant.reference,
      grantPolicyVersion: grant.grantPolicyVersion, valuationPolicyDigest: grant.valuationPolicy.digest, priceAt: grant.valuationPolicy.policy.priceAt };
  }
  function listingInput(context) {
    return immutable(structuredClone({ task: context.grant.task, child: context.child,
      executor: context.operation.attemptExecutor ?? context.grant.executor,
      grantReference: context.grant.reference, grantPolicyVersion: context.operation.attemptGrantPolicyVersion ?? context.grant.grantPolicyVersion,
      valuationPolicy: context.grant.valuationPolicy, observationPolicy: context.grant.observationPolicy }));
  }
  function listingResultBound(result, context) {
    const c = context.child.child, input = listingInput(context);
    return result && result.taskDigest === context.grant.task.digest && result.childDigest === context.child.digest &&
      result.executorDigest === input.executor.digest && result.grantReference === input.grantReference && result.grantPolicyVersion === input.grantPolicyVersion &&
      result.valuationPolicyDigest === c.valuationPolicyDigest && result.quoteEvidenceDigest === c.quoteEvidenceDigest &&
      result.orderHash === c.orderHash && result.typedDataDigest === c.typedDataDigest;
  }
  function checkListingScope(grant, child) {
    const time = seconds(), policy = grant.valuationPolicy?.policy;
    requireThat(assessNftListingScope(grant.task, child, listingGrantBinding(grant), time).state !== 'outside-declared-scope', 'TASK_CHILD_OUTSIDE_SCOPE');
    requireThat(policy && BigInt(policy.validFrom) <= time && time < BigInt(policy.validUntil), 'TASK_VALUATION_POLICY_EXPIRED');
  }
  async function executeListing(context, body, session) {
    requireThat(listingExecution, 'TASK_LISTING_ADAPTER_NOT_CONNECTED', 503);
    requireActive(context.grant, context.credential); checkListingScope(context.grant, context.child);
    requireThat(context.operation.status === 'reserved', 'TASK_SEND_ATTEMPT_REFUSED');
    const input = listingInput(context), checked = await listingExecution.verify(input);
    requireThat(listingResultBound(checked, context) && checked.capability === 'nft-listing-observable', 'TASK_LISTING_VERIFICATION_REFUSED', 403);
    const { ckey, gkey, okey, nkey } = context;
    const result = await transaction([ckey, gkey, okey, nkey], values => {
      const grant = checkOperation(values, context, body, session); requireActive(grant, values[ckey]); checkListingScope(grant, context.child);
      requireThat(grant.grantPolicyVersion === context.grant.grantPolicyVersion && values[okey].status === 'reserved' && !values[nkey].permanent, 'TASK_SEND_ATTEMPT_REFUSED');
      return { [ckey]: values[ckey], [gkey]: { ...grant, budget: markTaskSendAttempt(grant.budget, body.operationId, body.childDigest, body.expectedBudgetRevision) },
        [okey]: { ...values[okey], status: 'outcome-unknown', attemptGrantPolicyVersion: grant.grantPolicyVersion, attemptExecutor: grant.executor },
        [nkey]: { ...values[nkey], permanent: true } };
    });
    let sending;
    // Reuse the existing store's serialized immediate-side-effect fence. A
    // queued revoke/factor change must win before calling the native port.
    // An adapter which awaits before signing/publishing MUST revalidate this
    // same durable grant again at each actual side-effect boundary.
    await store.withReadSnapshot([ckey, gkey, okey, nkey], values => {
      const grant = checkOperation(values, context, { ...body, expectedBudgetRevision: result[gkey].budget.revision }, session);
      requireActive(grant, values[ckey]); checkListingScope(grant, context.child);
      requireThat(values[okey].status === 'outcome-unknown' && values[nkey].permanent && grant.grantPolicyVersion === input.grantPolicyVersion, 'TASK_SEND_ATTEMPT_REFUSED');
      try { sending = Promise.resolve(listingExecution.send(input)).then(value => ({ value }), () => ({ failed: true })); }
      catch { sending = Promise.resolve({ failed: true }); }
    });
    const submitted = await sending;
    if (!listingResultBound(submitted.value, context) || submitted.value.transactionHash !== undefined)
      return currentListingProgress(context, session);
    let reference;
    try { reference = normalizeSeaportOrderReference(submitted.value.submission); }
    catch { return currentListingProgress(context, session); }
    const c = context.child.child;
    if (reference.chainId !== c.chainId || reference.protocol !== c.protocol || reference.orderHash !== c.orderHash)
      return currentListingProgress(context, session);
    return recordListingSubmission(context, body, session, reference, result[gkey].budget.revision);
  }
  async function currentListingProgress(context, session) {
    const current = await status(session, context.grant.task.digest);
    const reservation = current.budget.reservations.find(r => r.operationId === context.child.child.operationId && r.childDigest === context.child.digest);
    return { ...current, outcome: reservation?.status === 'submitted' ? 'submitted' : 'outcome-unknown' };
  }
  async function recordListingSubmission(context, body, session, submission, expectedRevision) {
    const { ckey, gkey, okey, nkey } = context;
    const result = await transaction([ckey, gkey, okey, nkey], values => {
      const grant = checkOperation(values, context, { ...body, expectedBudgetRevision: expectedRevision }, session);
      requireThat(values[okey].status === 'outcome-unknown' && values[nkey].permanent, 'TASK_SUBMISSION_STATE_REFUSED');
      return { [ckey]: values[ckey], [gkey]: { ...grant, budget: noteNftListingSubmission(grant.budget, context.child, submission, expectedRevision) },
        [okey]: { ...values[okey], status: 'submitted' }, [nkey]: values[nkey] };
    });
    return { ...view(result[gkey], result[ckey]), outcome: 'submitted' };
  }
  async function recoverListing(context, body, session) {
    requireThat(listingExecution, 'TASK_LISTING_ADAPTER_NOT_CONNECTED', 503);
    requireThat(context.operation.status === 'outcome-unknown' && context.operation.attemptExecutor &&
      executorCopy(context.operation.attemptExecutor).digest === approvalContext(context.grant.task).executor.digest, 'TASK_RECOVERY_EXECUTOR_BINDING_REQUIRED', 503);
    const evidence = await listingExecution.recover(listingInput(context));
    requireThat(listingResultBound(evidence, context) && evidence.state === 'submitted' && evidence.transactionHash === undefined,
      'TASK_RECOVERY_NOT_ESTABLISHED');
    return recordListingSubmission(context, body, session, evidence.submission, body.expectedBudgetRevision);
  }
  async function recordSubmission(context, body, session, transactionHash, expectedRevision) {
    const { ckey, gkey, okey, nkey } = context;
    // Recording already attempted progress must remain possible after grant
    // expiry/revocation. A current authenticated session is still required.
    const result = await transaction([ckey, gkey, okey, nkey], values => {
      const grant = checkOperation(values, context, { ...body, expectedBudgetRevision: expectedRevision }, session);
      requireThat(values[okey].status === 'outcome-unknown' && values[nkey].permanent, 'TASK_SUBMISSION_STATE_REFUSED');
      return { [ckey]: values[ckey], [gkey]: { ...grant, budget: noteTaskSubmission(grant.budget, body.operationId, body.childDigest, transactionHash, expectedRevision) },
        [okey]: { ...values[okey], status: 'submitted' }, [nkey]: values[nkey] };
    });
    return { ...view(result[gkey], result[ckey]), outcome: 'submitted' };
  }
  async function recover(body, session) {
    const context = await operationContext(body, session);
    if (isListing(context.child)) return recoverListing(context, body, session);
    requireThat(execution, 'TASK_RECEIPT_VERIFIER_NOT_CONNECTED', 503);
    const attemptedExecutor = executorCopy(context.operation.attemptExecutor);
    const currentExecutor = approvalContext(context.grant.task).executor;
    // Read-only evidence must preserve the historical signed attempt, not demand
    // a new owner grant solely because the implementation version changed.
    const historical = attemptedExecutor.digest !== currentExecutor.digest;
    requireThat(!historical || typeof execution.recoverHistorical === 'function' &&
      attemptedExecutor.identity.agentId === currentExecutor.identity.agentId &&
      attemptedExecutor.identity.adapterId === currentExecutor.identity.adapterId, 'TASK_RECOVERY_EXECUTOR_BINDING_REQUIRED', 503);
    const recoverAttempt = historical ? execution.recoverHistorical : execution.recover;
    const evidence = await recoverAttempt(immutable(structuredClone({ task: context.grant.task, child: context.child, executor: context.operation.attemptExecutor,
      grantPolicyVersion: context.operation.attemptGrantPolicyVersion })));
    requireThat(verifiedBinding(evidence, context) && evidence.state === 'submitted' &&
      /^0x[0-9a-f]{64}$/.test(evidence.transactionHash ?? '') && !/^0x0+$/.test(evidence.transactionHash), 'TASK_RECOVERY_NOT_ESTABLISHED');
    // A matching trusted chain observation records submission only. It never
    // proves finality or refunds any reserved quota, even on a reverted receipt.
    return recordSubmission(context, body, session, evidence.transactionHash, body.expectedBudgetRevision);
  }
  async function observe(body, session, requestedReplacementHash = null) {
    const context = await operationContext(body, session), { ckey, gkey, okey, nkey, operation } = context;
    requireThat(!isListing(context.child), 'TASK_LISTING_OBSERVER_NOT_CONNECTED', 503);
    requireThat(receipt && operation.attemptReceiptVerifier !== null, 'TASK_RECEIPT_VERIFIER_NOT_CONNECTED', 503);
    requireThat(operation.status === 'submitted' && operation.attemptExecutor?.digest === approvalContext(context.grant.task).executor.digest &&
      sameVerifier(operation.attemptReceiptVerifier, receiptVerifier), 'TASK_RECEIPT_EXECUTOR_BINDING_REQUIRED', 503);
    const policy = observationPolicyCopy(operation.attemptObservationPolicy);
    requireThat(policy !== null && policy.digest === approvedObservationPolicy?.digest, 'TASK_RECEIPT_POLICY_BINDING_REQUIRED', 503);
    const reservation = context.grant.budget.reservations.find(r => r.operationId === body.operationId && r.childDigest === body.childDigest);
    requireThat(reservation?.status === 'submitted' && reservation.transactionHash !== null, 'TASK_SUBMISSION_STATE_REFUSED');
    const input = immutable(structuredClone({ task: context.grant.task, child: context.child, executor: operation.attemptExecutor,
      attempt: { executorDigest: operation.attemptExecutor.digest, grantPolicyVersion: operation.attemptGrantPolicyVersion,
        transactionHash: reservation.transactionHash }, observationPolicy: policy.policy }));
    const replacementHash = requestedReplacementHash ?? operation.replacementHash ?? null;
    if (replacementHash !== null) {
      hash(replacementHash); requireThat(!/^0x0+$/.test(replacementHash) && replacementHash !== reservation.transactionHash,
        'TASK_OBSERVATION_REPLACEMENT_REFUSED', 400);
      requireThat(receipt.observeReplacement, 'TASK_REPLACEMENT_VERIFIER_NOT_CONNECTED', 503);
    }
    const mintOperation = ['artfi-test-series-mint','artfi-test-nft721-mint'].includes(context.child.child.operation.kind) ? context.child.child.operation : null;
    const mintKey = mintOperation === null ? null : testMintInventoryKey(mintOperation.chainId, mintOperation.collection.contract, mintOperation.sourceHash ?? mintOperation.masterArtworkHash);
    const startedAt = seconds(); let observation = null, mintResult = null, failure = null;
    try {
      const raw = await (replacementHash === null ? receipt.observe(input) : receipt.observeReplacement(input, replacementHash));
      observation = bindTaskObservation(raw, { ...input, verifier: receiptVerifier });
      requireThat(BigInt(observation.observedAt) >= startedAt && BigInt(observation.observedAt) <= seconds(), 'TASK_OBSERVATION_TIME_REFUSED', 503);
      requireThat(replacementHash === null ? observation.state !== 'superseded-at-depth' :
        observation.state === 'superseded-at-depth' ? observation.replacementHash === replacementHash :
          ['pending', 'confirming', 'reorged'].includes(observation.state), 'TASK_OBSERVATION_REPLACEMENT_REFUSED', 503);
      if (mintOperation !== null && observation.state === 'confirmed-at-depth') {
        requireThat(observation.effect === 'exact-operation-observed' && typeof receipt.observeMintResult === 'function', 'TASK_TEST_MINT_OBSERVER_NOT_CONNECTED', 503);
        mintResult = await receipt.observeMintResult(input, observation);
        if(mintOperation.kind==='artfi-test-nft721-mint') mintResult=normalizeTestNFT721OperationResult(mintResult,mintOperation,observation);
        else {
        fields(mintResult, ['schema','taskId','chainId','collection','runtimeCodeHash','issuer','transactionHash','blockHash','blockNumber',
          'tokenId','standard','quantity','artworkId','masterArtworkHash','metadataHash','metadataURI','distributionWallet','testOnly','finality']);
        requireThat(mintResult.schema === '8415-artfi-test-series-mint-result/1' && mintResult.taskId === context.grant.task.policy.taskId &&
          mintResult.chainId === mintOperation.chainId && mintResult.collection === mintOperation.collection.contract &&
          mintResult.runtimeCodeHash === mintOperation.collection.runtimeCodeHash && mintResult.issuer === mintOperation.actor &&
          mintResult.transactionHash === reservation.transactionHash && mintResult.blockHash === observation.blockHash &&
          /^0x(?:0|[1-9a-f][0-9a-f]*)$/.test(mintResult.blockNumber) && BigInt(mintResult.blockNumber) === BigInt(observation.blockNumber) &&
          BigInt(version(mintResult.tokenId)) > 0n && mintResult.standard === 'ERC-1155' && mintResult.quantity === '100' &&
          mintResult.artworkId === mintOperation.artworkId && mintResult.masterArtworkHash === mintOperation.masterArtworkHash &&
          mintResult.metadataHash === mintOperation.metadataHash && mintResult.metadataURI === mintOperation.metadataURI &&
          mintResult.distributionWallet === mintOperation.distributionWallet && mintResult.testOnly === true &&
          mintResult.finality === 'canonical-at-observed-block-not-finality', 'TASK_TEST_MINT_RESULT_BINDING_REFUSED', 503);
        }
      }
    } catch (error) { failure = error; }
    const result = await transaction([ckey, gkey, okey, nkey, ...(mintKey === null ? [] : [mintKey])], values => {
      const grant = checkOperation(values, context, body, session), current = values[okey];
      requireThat(current.status === 'submitted' && values[nkey].permanent && current.observationRevision === operation.observationRevision &&
        current.attemptExecutor.digest === operation.attemptExecutor.digest && current.attemptObservationPolicy.digest === policy.digest &&
        sameVerifier(current.attemptReceiptVerifier, receiptVerifier), 'TASK_OBSERVATION_REVISION_CONFLICT');
      requireThat(BigInt(grant.observationRevision) < (1n << 256n) - 1n && BigInt(current.observationRevision) < (1n << 256n) - 1n,
        'TASK_OBSERVATION_REVISION_EXHAUSTED');
      const revision = (BigInt(grant.observationRevision) + 1n).toString();
      const prior = grant.observations.find(entry => entry.operationId === body.operationId);
      const observations = [...grant.observations.filter(entry => entry.operationId !== body.operationId),
        { operationId: body.operationId, observation: failure ? prior?.observation ?? null : observation, available: failure === null,
          ...(mintOperation === null ? {} : { mintResult: failure ? prior?.mintResult ?? null : mintResult }) }];
      const inventory = mintKey === null ? {} : { [mintKey]: mintResult !== null && failure === null ? {
        schema: '8415-task-test-mint-inventory/1', available: true, input, result: mintResult, observation,
        sourceTaskDigest: context.grant.task.digest, sourceChildDigest: context.child.digest,
      } : values[mintKey] === null ? null : values[mintKey].input?.attempt?.transactionHash === reservation.transactionHash ?
        { ...values[mintKey], available: false } : values[mintKey] };
      return { ...inventory, [ckey]: values[ckey], [gkey]: { ...grant, observations, observationRevision: revision },
        [okey]: { ...current, observationRevision: (BigInt(current.observationRevision) + 1n).toString(),
          // Only a verified supersession may install a replacement locator.
          // A later disappearance/reorg retains that locator for read-only retry.
          ...(failure === null && observation.state === 'superseded-at-depth' ? { replacementHash } : {}) }, [nkey]: values[nkey] };
    });
    if (mintKey !== null) acceptCommittedMintRecord?.(result[mintKey]);
    // Persist unavailable before reporting an error: old evidence is historical,
    // never silently presented as a successful current observation.
    if (failure) throw new TaskAuthorizationError('TASK_OBSERVATION_UNAVAILABLE', 503);
    const snapshot = view(result[gkey], result[ckey]);
    const single = result[gkey].budget.reservations.filter(r => r.status !== 'cancelled').length === 1;
    return { ...snapshot, observation, completion: { ...snapshot.completion, fresh: single }, outcome: observation.state };
  }
  async function revoke(body, session) {
    fields(body, ['taskDigest', 'expectedGrantPolicyVersion']); hash(body.taskDigest); version(body.expectedGrantPolicyVersion);
    const ckey = credentialKey(session), gkey = grantKey(session, body.taskDigest);
    const result = await transaction([ckey, gkey], values => {
      assertSession(session, values[ckey]); const grant = readGrant(values[gkey], session, body.taskDigest);
      requireThat(grant.status !== 'pending', 'TASK_GRANT_NOT_AUTHORIZED');
      requireThat(grant.grantPolicyVersion === body.expectedGrantPolicyVersion, 'TASK_GRANT_REVISION_CONFLICT');
      requireThat(BigInt(grant.grantPolicyVersion) < (1n << 256n) - 1n, 'TASK_GRANT_REVISION_EXHAUSTED');
      return { [ckey]: values[ckey], [gkey]: grant.status === 'revoked' ? grant : { ...grant, status: 'revoked', revokedAt: stamp(),
        grantPolicyVersion: (BigInt(grant.grantPolicyVersion) + 1n).toString() } };
    });
    return view(result[gkey], result[ckey]);
  }
  async function resume(body, session) {
    fields(body, ['taskDigest']); const initial = await status(session, hash(body.taskDigest));
    const blocked = code => ({ ...initial, continuation: { state: 'blocked', code } });
    const continueExecution = async operation => {
      try { return await execute(operation, session); }
      catch (error) {
        if (error?.code === 'TASK_ATOMIC_SALE_VERIFIER_NOT_CONNECTED') return { ...await status(session, body.taskDigest),
          outcome: 'blocked', continuation: { state: 'blocked', code: error.code } };
        throw error;
      }
    };
    // Recovery only records an already attempted operation. It is permitted
    // after task expiry/revocation/factor changes and never calls plan or send.
    const unknown = initial.budget?.reservations.find(r => r.status === 'outcome-unknown');
    if (unknown) {
      if (initial.budget.schema === '8415-task-budget/2' ? !listingExecution : !execution) return blocked('TASK_RECEIPT_VERIFIER_NOT_CONNECTED');
      const progress = await recover({ taskDigest: body.taskDigest, operationId: unknown.operationId,
        childDigest: unknown.childDigest, expectedBudgetRevision: initial.budget.revision }, session);
      return { ...progress, continuation: { state: progress.outcome, operationId: unknown.operationId } };
    }
    // The current contract permits one whole non-cancelled operation. Its spent
    // quota is never released. Terminal cached outcomes do not restart planning
    // or monopolize automatic continuation; explicit observe rechecks reorgs.
    if (['completed-at-observation-depth', 'failed-at-observation-depth'].includes(initial.completion.state))
      return { ...initial, continuation: { state: initial.completion.state } };
    const submitted = initial.budget?.reservations.filter(r => r.status === 'submitted').sort((a, b) => {
      const at = id => initial.observations.find(entry => entry.operationId === id)?.observation?.observedAt ?? '-1';
      return BigInt(at(a.operationId)) < BigInt(at(b.operationId)) ? -1 : 1;
    })[0];
    if (submitted) {
      if (initial.budget.schema === '8415-task-budget/2') {
        if (!listingResults) return { ...initial, continuation: { state: 'listed-awaiting-evidence', code: 'TASK_LISTING_OBSERVER_NOT_CONNECTED', operationId: submitted.operationId } };
        const values = await store.readMany([credentialKey(session), grantKey(session, initial.task.digest)]);
        assertSession(session, values[credentialKey(session)]);
        const grant = readGrant(values[grantKey(session, initial.task.digest)], session, initial.task.digest);
        // One bounded consumer scan per continuation, including revoked/expired
        // grants. No branch from here can reach planning, signing or publication.
        const progress = await listingView(session, grant, values[credentialKey(session)], true);
        return { ...progress, continuation: { state: progress.completion.state, operationId: submitted.operationId } };
      }
      if (!receipt) return { ...initial, continuation: { state: 'awaiting-evidence', code: 'TASK_RECEIPT_VERIFIER_NOT_CONNECTED' } };
      const progress = await observe({ taskDigest: body.taskDigest, operationId: submitted.operationId, childDigest: submitted.childDigest,
        expectedBudgetRevision: initial.budget.revision }, session);
      return { ...progress, continuation: { state: progress.completion.state, operationId: submitted.operationId } };
    }
    if (initial.effectiveStatus !== 'authorized') return blocked(initial.effectiveStatus === 'suspended' ?
      (initial.capabilities.executorRevalidationRequired ? 'TASK_EXECUTOR_REVALIDATION_REQUIRED' : initial.capabilities.observationPolicyRevalidationRequired ?
        'TASK_OBSERVATION_POLICY_REVALIDATION_REQUIRED' : initial.capabilities.receiptVerifierRevalidationRequired ? 'TASK_RECEIPT_VERIFIER_REVALIDATION_REQUIRED' : 'TASK_FACTOR_REVALIDATION_REQUIRED') : 'TASK_GRANT_NOT_ACTIVE');
    if (initial.task.policy.intent.kind === 'artfi-receipt') return blocked('TASK_RECEIPT_FIXED_HANDLER_REQUIRED');
    if (initial.task.policy.intent.kind === 'nft-sale') {
      if (!initial.valuationPolicy) return blocked('TASK_VALUATION_POLICY_AUTHORIZATION_REQUIRED');
      if (initial.valuationPolicy.policy.priceAt !== 'order-review') return blocked('TASK_FUTURE_USD_PRICE_NOT_GUARANTEED');
      if (!listingExecution) return blocked('TASK_LISTING_ADAPTER_NOT_CONNECTED');
      const pending = initial.budget.reservations.find(r => r.status === 'reserved');
      if (pending) {
        const progress = await execute({ taskDigest: body.taskDigest, operationId: pending.operationId, childDigest: pending.childDigest,
          expectedBudgetRevision: initial.budget.revision }, session);
        return { ...progress, continuation: { state: progress.outcome, operationId: pending.operationId } };
      }
      if (!listingExecution.plan) return { ...initial, continuation: { state: 'waiting-for-operation', code: 'TASK_PLANNER_NOT_CONNECTED' } };
      const proposal = await listingExecution.plan(immutable(structuredClone({ task: initial.task, budget: initial.budget, executor: initial.executor,
        grantReference: initial.authorization.reference, grantPolicyVersion: initial.authorization.grantPolicyVersion, valuationPolicy: initial.valuationPolicy })));
      if (proposal === null) return { ...await status(session, body.taskDigest), continuation: { state: 'waiting-for-operation', code: 'TASK_NO_CANDIDATE' } };
      const frozen = freezeNftListingChild(proposal);
      const reserved = await reserve({ taskDigest: body.taskDigest, child: frozen.child, expectedBudgetRevision: initial.budget.revision }, session);
      const progress = await execute({ taskDigest: body.taskDigest, operationId: frozen.child.operationId, childDigest: frozen.digest,
        expectedBudgetRevision: reserved.budget.revision }, session);
      return { ...progress, continuation: { state: progress.outcome, operationId: frozen.child.operationId } };
    }
    if (!execution) return blocked('TASK_EXECUTION_ADAPTER_NOT_CONNECTED');
    if (!receipt || initial.receiptVerifier === null) return blocked('TASK_RECEIPT_VERIFIER_NOT_CONNECTED');
    // Exactly one bounded step per call. Never replan or resend an unknown
    // operation; verified recovery above takes priority over new work.
    const pending = initial.budget.reservations.find(r => r.status === 'reserved');
    if (pending) {
      const progress = await continueExecution({ taskDigest: body.taskDigest, operationId: pending.operationId, childDigest: pending.childDigest,
        expectedBudgetRevision: initial.budget.revision });
      return { ...progress, continuation: progress.continuation ?? { state: progress.outcome, operationId: pending.operationId } };
    }
    if (!execution.plan) return { ...initial, continuation: { state: 'waiting-for-operation', code: 'TASK_PLANNER_NOT_CONNECTED' } };
    const proposal = await execution.plan(immutable(structuredClone({ task: initial.task, budget: initial.budget, executor: initial.executor,
      grantPolicyVersion: initial.authorization.grantPolicyVersion })));
    if (proposal === null) return { ...await status(session, body.taskDigest), continuation: { state: 'waiting-for-operation', code: 'TASK_NO_CANDIDATE' } };
    const frozen = freezeChildOperation(proposal);
    const reserved = await reserve({ taskDigest: body.taskDigest, child: frozen.child, expectedBudgetRevision: initial.budget.revision }, session);
    const progress = await continueExecution({ taskDigest: body.taskDigest, operationId: frozen.child.operationId, childDigest: frozen.digest,
      expectedBudgetRevision: reserved.budget.revision });
    return { ...progress, continuation: progress.continuation ?? { state: progress.outcome, operationId: frozen.child.operationId } };
  }
  async function handler(path, body, session) {
    try {
      if (path === 'tasks/list') return await list(body, session);
      if (path === 'tasks/resume') return await resume(body, session);
      if (path === 'tasks/prepare') return await prepare(body, session);
      if (path === 'tasks/authorize') return await authorize(body, session);
      if (path === 'tasks/status') { fields(body, ['taskDigest']); return await status(session, hash(body.taskDigest)); }
      if (path === 'tasks/revoke') return await revoke(body, session);
      if (path === 'tasks/reserve') return await reserve(body, session);
      if (path === 'tasks/cancel-reservation') return await cancelReservation(body, session);
      if (path === 'tasks/execute') return await execute(body, session);
      if (path === 'tasks/recover') return await recover(body, session);
      if (path === 'tasks/observe') return await observe(body, session);
      if (path === 'tasks/observe-replacement') {
        fields(body, ['taskDigest', 'operationId', 'childDigest', 'expectedBudgetRevision', 'replacementHash']);
        const { replacementHash, ...operation } = body; return await observe(operation, session, hash(replacementHash));
      }
      throw new TaskAuthorizationError('TASK_ROUTE_REFUSED', 404);
    } catch (error) {
      if (error instanceof TaskContractError || error instanceof ReceiptTaskError || error instanceof TaskObservationError) throw new TaskAuthorizationError(error.code, 400);
      throw error;
    }
  }
  // Server-only capability for the explicitly configured cross-library composition.
  // Public binding fields locate an existing approved grant; they create no session,
  // bridge credential, approval or HTTP route. Every access revalidates durable state.
  async function locateListing(claimed) {
    await principalReady;
    requireThat(listingExecution !== null && assertPrincipal !== null && typeof store.withReadGate === 'function', 'TASK_LISTING_GATE_NOT_CONFIGURED', 503);
    fields(claimed, ['taskId', 'taskDigest', 'executorDigest', 'grantReference', 'grantPolicyVersion', 'operationId']);
    hash(claimed.taskDigest); hash(claimed.executorDigest); identifier(claimed.taskId); identifier(claimed.operationId); version(claimed.grantPolicyVersion);
    const queue = await store.read(queueKey);
    requireThat(queue?.schema === '8415-task-queue/1' && Array.isArray(queue.entries), 'TASK_BACKGROUND_GRANT_REFUSED', 403);
    const entries = queue.entries;
    requireThat(entries.length > 0, 'TASK_GRANT_NOT_FOUND', 404);
    const grants = await store.readMany(entries);
    const selected = entries.filter(entry => grants[entry]?.task?.digest === claimed.taskDigest && grants[entry]?.reference === claimed.grantReference);
    requireThat(selected.length === 1, 'TASK_GRANT_NOT_FOUND', 404);
    const gkey = selected[0], raw = grants[gkey];
    let owner; try { owner = JSON.parse(raw.principal); } catch { throw new TaskAuthorizationError('TASK_BACKGROUND_PRINCIPAL_REFUSED', 503); }
    requireThat(Array.isArray(owner) && owner.length === 5 && owner[0] === origin && owner[1] === tenant &&
      typeof owner[2] === 'string' && typeof owner[3] === 'string' && typeof owner[4] === 'string', 'TASK_BACKGROUND_PRINCIPAL_REFUSED', 503);
    const context = Object.freeze({ username: owner[2], account: owner[3], chainId: owner[4] });
    requireThat(grantKey(context, claimed.taskDigest) === gkey, 'TASK_BACKGROUND_GRANT_REFUSED', 403);
    return { context, gkey, ckey: credentialKey(context), okey: operationKey(raw.task, claimed.operationId) };
  }
  function listingCapability(values, found, claimed, purpose) {
    const { context, gkey, ckey, okey } = found;
    requireThat(values[queueKey]?.entries?.includes(gkey), 'TASK_BACKGROUND_GRANT_REFUSED', 403);
    const grant = readGrant(values[gkey], context, claimed.taskDigest), credential = values[ckey], operation = values[okey];
    const checked = assertPrincipal(context, credential);
    requireThat(!checked || typeof checked.then !== 'function', 'TASK_BACKGROUND_CONFIG_REFUSED', 500);
    requireThat(grant.schema === '8415-task-grant/2' && grant.status !== 'pending' &&
      grant.task.policy.taskId === claimed.taskId && grant.executor.digest === claimed.executorDigest && grant.reference === claimed.grantReference,
      'TASK_LISTING_BINDING_REFUSED', 403);
    if (purpose === 'observe') {
      requireThat(claimed.grantPolicyVersion === (operation?.attemptGrantPolicyVersion ?? (grant.status === 'revoked' ? (BigInt(grant.grantPolicyVersion) - 1n).toString() : grant.grantPolicyVersion)), 'TASK_LISTING_BINDING_REFUSED', 403);
    } else {
      requireActive(grant, credential);
      requireThat(claimed.grantPolicyVersion === grant.grantPolicyVersion, 'TASK_LISTING_BINDING_REFUSED', 403);
      requireThat(grant.valuationPolicy.policy.priceAt === 'order-review' && seconds() >= BigInt(grant.valuationPolicy.policy.validFrom) &&
        seconds() < BigInt(grant.valuationPolicy.policy.validUntil), 'TASK_VALUATION_POLICY_EXPIRED', 403);
      if (purpose === 'sign' || purpose === 'publish') {
        requireThat(operation?.schema === '8415-task-operation/2' && operation.grantKey === gkey && operation.status === 'outcome-unknown' &&
          operation.attemptGrantPolicyVersion === claimed.grantPolicyVersion && operation.attemptExecutor?.digest === claimed.executorDigest,
          'TASK_SEND_ATTEMPT_REFUSED', 403);
        checkListingScope(grant, operation.child);
      }
    }
    if (operation) requireThat(operation.grantKey === gkey && isListing(operation.child), 'TASK_LISTING_BINDING_REFUSED', 403);
    return immutable(structuredClone({ task: grant.task, executor: grant.executor, valuationPolicy: grant.valuationPolicy,
      observationPolicy: grant.observationPolicy, grantReference: grant.reference, grantPolicyVersion: claimed.grantPolicyVersion,
      child: operation?.child ?? null, operationStatus: operation?.status ?? null }));
  }
  const listingAuthorization = Object.freeze({
    assertIndependentStore(candidate) { requireThat(candidate !== store, 'TASK_LISTING_STORE_REENTRY_REFUSED', 500); },
    async inspect(claimed, purpose = 'observe') {
      requireThat(['prepare', 'review', 'sign', 'publish', 'observe'].includes(purpose), 'TASK_LISTING_PURPOSE_REFUSED', 400);
      const binding = immutable(structuredClone(claimed)), found = await locateListing(binding);
      const keys = [queueKey, found.ckey, found.gkey, found.okey];
      const values = await store.readMany(keys); return listingCapability(values, found, binding, purpose);
    },
    async withAuthorization(claimed, purpose, action) {
      requireThat(['prepare', 'review', 'sign', 'publish', 'observe'].includes(purpose) && typeof action === 'function', 'TASK_LISTING_PURPOSE_REFUSED', 400);
      const binding = immutable(structuredClone(claimed)), found = await locateListing(binding);
      return store.withReadGate([queueKey, found.ckey, found.gkey, found.okey], async values => {
        const snapshot = listingCapability(values, found, binding, purpose);
        return await action(snapshot, () => listingCapability(values, found, binding, purpose));
      });
    },
  });

  // Server-owned, fixed receipt composition. No HTTP dispatch, arbitrary call,
  // default provider, new credential, or old-grant upgrade is exposed here.
  async function locateReceipt(claimed) {
    await principalReady;
    requireThat(receiptHandlerId === 'artfi:whole-receipt:v1' && assertPrincipal !== null &&
      typeof store.withReadGate === 'function', 'TASK_RECEIPT_GATE_NOT_CONFIGURED', 503);
    fields(claimed, ['taskId','taskDigest','executorDigest','grantReference','grantPolicyVersion',
      'operationId','phase','planDigest','journalBindingHash']);
    identifier(claimed.taskId); hash(claimed.taskDigest); hash(claimed.executorDigest);
    identifier(claimed.operationId); version(claimed.grantPolicyVersion);
    hash(claimed.planDigest); hash(claimed.journalBindingHash);
    requireThat(['funded','registered','paid'].includes(claimed.phase), 'TASK_RECEIPT_PHASE_REFUSED',400);
    const queue=await store.read(queueKey);
    requireThat(queue?.schema==='8415-task-queue/1' && Array.isArray(queue.entries) && queue.entries.length>0,'TASK_GRANT_NOT_FOUND',404);
    const grants=await store.readMany(queue.entries);
    const selected=queue.entries.filter(k=>grants[k]?.task?.digest===claimed.taskDigest && grants[k]?.reference===claimed.grantReference);
    requireThat(selected.length===1,'TASK_GRANT_NOT_FOUND',404);
    const gkey=selected[0],raw=grants[gkey];
    let owner; try {owner=JSON.parse(raw.principal);}catch {throw new TaskAuthorizationError('TASK_BACKGROUND_PRINCIPAL_REFUSED',503);}
    requireThat(Array.isArray(owner)&&owner.length===5&&owner[0]===origin&&owner[1]===tenant&&
      typeof owner[2]==='string'&&typeof owner[3]==='string'&&typeof owner[4]==='string','TASK_BACKGROUND_PRINCIPAL_REFUSED',503);
    const context=Object.freeze({username:owner[2],account:owner[3],chainId:owner[4]});
    requireThat(grantKey(context,claimed.taskDigest)===gkey,'TASK_BACKGROUND_GRANT_REFUSED',403);
    const phase=receiptPhaseScope(freezeReceiptTask(raw.task.policy),claimed.phase);
    return {context,gkey,ckey:credentialKey(context),
      okey:operationKey(raw.task,claimed.operationId),nkey:key('nonce',[raw.task.policy.chainId,raw.task.policy.actor,phase.nonce])};
  }
  function receiptCapability(values,found,claimed,wire) {
    const {context,ckey,gkey}=found;
    requireThat(values[queueKey]?.entries?.includes(gkey),'TASK_BACKGROUND_GRANT_REFUSED',403);
    const credential=values[ckey],grant=readGrant(values[gkey],context,claimed.taskDigest);
    const checked=assertPrincipal(context,credential);
    requireThat(!checked || typeof checked.then!=='function','TASK_BACKGROUND_CONFIG_REFUSED',500);
    requireThat(grant.task.policy.intent.kind==='artfi-receipt' && grant.valuationPolicy===undefined &&
      grant.task.policy.taskId===claimed.taskId && grant.reference===claimed.grantReference &&
      grant.executor.digest===claimed.executorDigest && grant.grantPolicyVersion===claimed.grantPolicyVersion,
      'TASK_RECEIPT_GRANT_BINDING_REFUSED',403);
    requireActive(grant,credential);
    const scope=validateReceiptWire(grant.task,claimed.phase,wire);
    requireThat(scope.planDigest===claimed.planDigest && scope.journalBindingHash===claimed.journalBindingHash,
      'TASK_RECEIPT_PLAN_BINDING_REFUSED',403);
    const attempts=normalizeReceiptAttempts(grant.task,grant.receiptAttempts??[]);
    requireThat(Array.isArray(attempts)&&attempts.length<=3,'TASK_RECEIPT_BUDGET_REFUSED',503);
    const phases=new Set(),nonces=new Set();
    let spent=0n;
    for(const r of attempts){
      fields(r,['phase','nonce','operationId','maximumFeeWei','status','transactionHash']);
      const slot=receiptPhaseScope(grant.task,r.phase);
      requireThat(r.nonce===slot.nonce && !phases.has(r.phase) && !nonces.has(r.nonce) &&
        r.maximumFeeWei===(BigInt(slot.gasLimit)*BigInt(slot.maxFeePerGasWei)).toString() &&
        ['outcome-unknown','submitted'].includes(r.status) &&
        (r.status==='outcome-unknown'?r.transactionHash===null:
          /^0x[0-9a-f]{64}$/.test(r.transactionHash)&&!/^0x0+$/.test(r.transactionHash)),'TASK_RECEIPT_BUDGET_REFUSED',503);
      identifier(r.operationId);phases.add(r.phase);nonces.add(r.nonce);spent+=BigInt(r.maximumFeeWei);
    }
    requireThat(spent<=BigInt(grant.task.policy.fees.totalWei),'TASK_TOTAL_FEE_LIMIT');
    return {grant,scope,spent,phases,nonce:scope.nonce};
  }
  /** Read-only phase view for journal preparation. No wire, no attempt, no
   * nonce claim: it cannot consume the single permitted attempt for a phase. */
  function receiptPreparation(values,found,claimed,purpose){
    const {context,ckey,gkey,okey,nkey}=found;
    requireThat(values[queueKey]?.entries?.includes(gkey),'TASK_BACKGROUND_GRANT_REFUSED',403);
    const credential=values[ckey],grant=readGrant(values[gkey],context,claimed.taskDigest);
    const checked=assertPrincipal(context,credential);
    requireThat(!checked || typeof checked.then!=='function','TASK_BACKGROUND_CONFIG_REFUSED',500);
    requireThat(grant.task.policy.intent.kind==='artfi-receipt' && grant.valuationPolicy===undefined &&
      grant.task.policy.taskId===claimed.taskId && grant.reference===claimed.grantReference &&
      grant.executor.digest===claimed.executorDigest,'TASK_RECEIPT_GRANT_BINDING_REFUSED',403);
    // Creating a plan binds the live grant policy version. Review and observation
    // accept the version the attempt was made under, as readState does, so a
    // revoked or expired grant can still be reconciled rather than stranded.
    requireThat(claimed.grantPolicyVersion===(purpose==='prepare' ? grant.grantPolicyVersion
      : values[okey]?.binding?.grantPolicyVersion ?? (grant.status==='revoked'
        ? (BigInt(grant.grantPolicyVersion)-1n).toString() : grant.grantPolicyVersion)),
    'TASK_RECEIPT_GRANT_BINDING_REFUSED',403);
    const slot=receiptPhaseScope(grant.task,claimed.phase);
    requireThat(slot.planDigest===claimed.planDigest && slot.journalBindingHash===claimed.journalBindingHash,
      'TASK_RECEIPT_PLAN_BINDING_REFUSED',403);
    const attempts=normalizeReceiptAttempts(grant.task,grant.receiptAttempts??[]);
    if(purpose==='prepare'){
      // A plan may only be created while the phase is still unspent. Review and
      // observation stay available after revoke or expiry for reconciliation.
      requireActive(grant,credential);
      requireThat(!attempts.some(r=>r.phase===claimed.phase) && values[okey]===null && values[nkey]===null,
        'TASK_RECEIPT_ALREADY_ATTEMPTED');
    }
    const scope=immutable(structuredClone({phase:slot.phase,nonce:slot.nonce,planDigest:slot.planDigest,
      journalBindingHash:slot.journalBindingHash,actor:grant.task.policy.actor,chainId:grant.task.policy.chainId,
      escrow:grant.task.policy.intent.escrow,runtimeCodeHash:grant.task.policy.intent.runtimeCodeHash,
      segmentId:grant.task.policy.intent.segmentId,
      maximumFeeWei:(BigInt(slot.gasLimit)*BigInt(slot.maxFeePerGasWei)).toString()}));
    const snapshot=immutable(structuredClone({task:grant.task,executor:grant.executor,scope,
      expiresAtMs:Number(BigInt(grant.task.policy.expiresAt)*1000n)}));
    requireThat(Number.isSafeInteger(snapshot.expiresAtMs),'TASK_RECEIPT_EXPIRY_REFUSED');
    return snapshot;
  }
  const receiptAuthorization=Object.freeze({
    assertIndependentStore(candidate){requireThat(candidate!==store,'TASK_RECEIPT_STORE_REENTRY_REFUSED',500);},

    /** Opens the grant read gate without writing, so the ArtFi native journal can
     * create or re-read its plan for a phase before the one permitted send. */
    async withPreparation(rawClaimed,purpose,action){
      requireThat(['prepare','review','observe'].includes(purpose),'TASK_RECEIPT_PURPOSE_REFUSED',400);
      requireThat(typeof action==='function','TASK_RECEIPT_ACTION_REFUSED',400);
      const claimed=immutable(structuredClone(rawClaimed)),found=await locateReceipt(claimed);
      const keys=[queueKey,found.ckey,found.gkey,found.okey,found.nkey];
      return store.withReadGate(keys,async values=>{
        const current=()=>receiptPreparation(values,found,claimed,purpose);
        const snapshot=current();
        return action(snapshot,()=>{current();return snapshot;});
      });
    },

    async readState(rawClaimed){
      const claimed=immutable(structuredClone(rawClaimed)),found=await locateReceipt(claimed);
      const values=await store.readMany([queueKey,found.ckey,found.gkey,found.okey,found.nkey]);
      requireThat(values[queueKey]?.entries?.includes(found.gkey),'TASK_BACKGROUND_GRANT_REFUSED',403);
      const grant=readGrant(values[found.gkey],found.context,claimed.taskDigest);
      const principal=assertPrincipal(found.context,values[found.ckey]);
      requireThat(!principal || typeof principal.then!=='function','TASK_BACKGROUND_CONFIG_REFUSED',500);
      requireThat(grant.task.policy.intent.kind==='artfi-receipt'&&grant.task.policy.taskId===claimed.taskId&&
        grant.reference===claimed.grantReference&&grant.executor.digest===claimed.executorDigest,'TASK_RECEIPT_GRANT_BINDING_REFUSED',403);
      const slot=receiptPhaseScope(grant.task,claimed.phase);
      requireThat(slot.planDigest===claimed.planDigest&&slot.journalBindingHash===claimed.journalBindingHash,'TASK_RECEIPT_PLAN_BINDING_REFUSED',403);
      const attempts=normalizeReceiptAttempts(grant.task,grant.receiptAttempts??[]),op=values[found.okey];
      if(op===null){
        requireThat(!attempts.some(r=>r.phase===claimed.phase),'TASK_RECEIPT_JOURNAL_REFUSED');
        return immutable({phase:claimed.phase,status:'not-attempted',transactionHash:null,executable:false});
      }
      requireThat(op.grantKey===found.gkey&&JSON.stringify(op.binding)===JSON.stringify(claimed)&&
        values[found.nkey]?.permanent===true&&values[found.nkey]?.operationKey===found.okey,'TASK_RECEIPT_JOURNAL_REFUSED');
      const attempt=attempts.find(r=>r.phase===claimed.phase&&r.operationId===claimed.operationId);
      requireThat(attempt&&attempt.status===op.status,'TASK_RECEIPT_JOURNAL_REFUSED');
      return immutable({phase:claimed.phase,status:attempt.status,transactionHash:attempt.transactionHash,executable:false});
    },

    async withAuthorization(rawClaimed,rawWire,action,assertActive=()=>{}){
      requireThat(typeof action==='function','TASK_RECEIPT_ACTION_REFUSED',400);
      requireThat(typeof assertActive==='function','TASK_RECEIPT_ACTION_REFUSED',400);
      const claimed=immutable(structuredClone(rawClaimed)),wire=immutable(structuredClone(rawWire));
      const found=await locateReceipt(claimed),{ckey,gkey,okey,nkey}=found;
      const keys=[queueKey,ckey,gkey,okey,nkey];
      await store.transactionMany(keys,values=>{
        // Server-owned lifecycle fence, inside the serialized reservation.
        // A stopped queued call must not consume a phase or occupy its nonce.
        const activeResult=assertActive();
        requireThat(!activeResult||typeof activeResult.then!=='function','TASK_RECEIPT_ACTION_REFUSED',400);
        const {grant,scope,spent,phases}=receiptCapability(values,found,claimed,wire);
        requireThat(!phases.has(claimed.phase)&&values[okey]===null,'TASK_RECEIPT_ALREADY_ATTEMPTED');
        requireThat(values[nkey]===null,'TASK_NONCE_OCCUPIED');
        requireThat(spent+BigInt(scope.maximumFeeWei)<=BigInt(grant.task.policy.fees.totalWei),'TASK_TOTAL_FEE_LIMIT');
        const attempt={phase:claimed.phase,nonce:scope.nonce,operationId:claimed.operationId,
          maximumFeeWei:scope.maximumFeeWei,status:'outcome-unknown',transactionHash:null};
        return {...values,[gkey]:{...grant,receiptAttempts:[...(grant.receiptAttempts??[]),attempt]},
          [okey]:{schema:'8415-task-receipt-operation/1',grantKey:gkey,binding:claimed,status:'outcome-unknown'},
          [nkey]:{operationKey:okey,taskDigest:claimed.taskDigest,nonce:scope.nonce,permanent:true}};
      });
      let transactionHash;
      try {
        transactionHash=await store.withReadGate(keys,async values=>{
          const current=()=>receiptCapability(values,found,claimed,wire);
          const {grant,scope}=current();
          requireThat(values[okey]?.status==='outcome-unknown'&&values[okey]?.grantKey===gkey&&
            values[nkey]?.permanent===true&&values[nkey]?.operationKey===okey,'TASK_SEND_ATTEMPT_REFUSED');
          const snapshot=immutable(structuredClone({task:grant.task,executor:grant.executor,scope,
            expiresAtMs:Number(BigInt(grant.task.policy.expiresAt)*1000n)}));
          requireThat(Number.isSafeInteger(snapshot.expiresAtMs),'TASK_RECEIPT_EXPIRY_REFUSED');
          return action(snapshot,()=>{current();return snapshot;});
        });
      } catch { throw new TaskAuthorizationError('TASK_RECEIPT_OUTCOME_UNKNOWN_RECONCILE_ONLY'); }
      if(typeof transactionHash!=='string'||!/^0x[0-9a-f]{64}$/.test(transactionHash)||/^0x0+$/.test(transactionHash))
        throw new TaskAuthorizationError('TASK_RECEIPT_OUTCOME_UNKNOWN_RECONCILE_ONLY');
      // Record already attempted progress even after revoke/expiry. Never resend.
      await store.transactionMany([gkey,okey],values=>{
        const grant=readGrant(values[gkey],found.context,claimed.taskDigest),op=values[okey];
        requireThat(op?.grantKey===gkey&&op.status==='outcome-unknown'&&
          JSON.stringify(op.binding)===JSON.stringify(claimed),'TASK_RECEIPT_JOURNAL_REFUSED');
        return {[gkey]:{...grant,receiptAttempts:grant.receiptAttempts.map(r=>r.operationId===claimed.operationId?
          {...r,status:'submitted',transactionHash}:r)},[okey]:{...op,status:'submitted',transactionHash}};
      });
      return immutable({transactionHash,phase:claimed.phase,taskDigest:claimed.taskDigest,operationId:claimed.operationId});
    }
  });

  const background = Object.freeze({
    async list({ cursor = '0', limit = 10 } = {}) {
      await principalReady;
      requireThat(assertPrincipal !== null, 'TASK_BACKGROUND_PRINCIPAL_NOT_CONFIGURED', 503);
      const offset = Number(version(cursor));
      requireThat(Number.isSafeInteger(offset) && offset >= 0 && Number.isSafeInteger(limit) && limit >= 1 && limit <= 50,
        'TASK_BACKGROUND_PAGE_REFUSED', 400);
      const queue = await store.read(queueKey) ?? { schema: '8415-task-queue/1', entries: [] };
      requireThat(queue.schema === '8415-task-queue/1' && Array.isArray(queue.entries) && offset <= queue.entries.length &&
        queue.entries.every(entry => typeof entry === 'string' && /^task-grant:[0-9a-f]{64}$/.test(entry)), 'TASK_QUEUE_STATE_REFUSED', 503);
      const entries = queue.entries.slice(offset, offset + limit);
      return { entries, nextCursor: offset + entries.length < queue.entries.length ? String(offset + entries.length) : null };
    },
    async resume(entry) {
      await principalReady;
      requireThat(assertPrincipal !== null && typeof entry === 'string' && /^task-grant:[0-9a-f]{64}$/.test(entry), 'TASK_BACKGROUND_GRANT_REFUSED', 403);
      const snapshot = await store.readMany([queueKey, entry]), raw = snapshot[entry], queue = snapshot[queueKey];
      requireThat(queue?.schema === '8415-task-queue/1' && Array.isArray(queue.entries) && queue.entries.includes(entry) &&
        ['8415-task-grant/1', '8415-task-grant/2'].includes(raw?.schema) && raw.status !== 'pending', 'TASK_BACKGROUND_GRANT_REFUSED', 403);
      let owner; try { owner = JSON.parse(raw.principal); } catch { throw new TaskAuthorizationError('TASK_BACKGROUND_PRINCIPAL_REFUSED', 503); }
      requireThat(Array.isArray(owner) && owner.length === 5 && owner[0] === origin && owner[1] === tenant &&
        typeof owner[2] === 'string' && typeof owner[3] === 'string' && typeof owner[4] === 'string', 'TASK_BACKGROUND_PRINCIPAL_REFUSED', 503);
      const context = Object.freeze({ username: owner[2], account: owner[3], chainId: owner[4] });
      requireThat(grantKey(context, raw.task?.digest) === entry, 'TASK_BACKGROUND_GRANT_REFUSED', 403);
      readGrant(raw, context, raw.task.digest); internalContexts.add(context);
      // This is the only internal operation. No prepare, approve or mutation API
      // is exposed to a worker, and the normal atomic send gates stay in force.
      return resume({ taskDigest: raw.task.digest }, context);
    },
  });
  return { handler, cancel, background, listingAuthorization, receiptAuthorization };
}

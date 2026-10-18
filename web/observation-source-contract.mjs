/** Separate expected-source contract for PRD6.5.1. The expected descriptor must
 * come from an independently authenticated, account/operation-scoped resolver.
 * This module cannot authenticate a descriptor, register a source, invent a
 * trusted capability or replace the existing strict legacy observation decoder.
 */
export function createObservationSourceContract({ observerContextCodec, normalizeObservationVerifier, normalizeTaskObservation, fail }) {
  const insist = ok => { if (!ok) fail('OBSERVATION_BINDING_REFUSED'); };
  const fields = (value, names) => {
    insist(value && typeof value === 'object' && !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)));
    const d = Object.getOwnPropertyDescriptors(value);
    insist(Reflect.ownKeys(d).length === names.length && names.every(k => d[k] && Object.hasOwn(d[k], 'value')));
  };
  const uint = value => typeof value === 'string' && /^[1-9][0-9]{0,77}$/.test(value) && BigInt(value) < (1n << 256n);
  const reference = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(value);
  const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const freeze = value => { for (const child of Object.values(value)) if (child && typeof child === 'object') freeze(child); return Object.freeze(value); };
  function verifier(raw) {
    fields(raw, ['verifierId','verifierVersion','verifierImplementationDigest']);
    return normalizeObservationVerifier(raw);
  }
  function normalizeExpectedSource(raw, { context, originalAttempt }) {
    fields(raw, ['schema','sourceReference','sourceRevision','principal','attempt','verifier',
      'verificationPolicy','capabilityReference','capabilityRevision','canExecute']);
    insist(raw.schema === '8415-observation-source/1' && raw.canExecute === false &&
      reference(raw.sourceReference) && uint(raw.sourceRevision) &&
      reference(raw.capabilityReference) && uint(raw.capabilityRevision));
    fields(raw.principal, ['tenant','origin','account','chainId']);
    insist(['tenant','origin','account','chainId'].every(k => raw.principal[k] === context[k]));
    const expected = observerContextCodec.normalizeAttempt(originalAttempt), attempt = observerContextCodec.normalizeAttempt(raw.attempt);
    insist(same(attempt, expected) && attempt.operationId === context.operationId &&
      attempt.taskDigest === context.taskDigest && attempt.childDigest === context.childDigest &&
      attempt.actor === context.account && attempt.chainId === context.chainId);
    const verificationPolicy = observerContextCodec.normalizePolicy(raw.verificationPolicy);
    // Compatibility never weakens the originally approved observation floor.
    insist(BigInt(verificationPolicy.policy.minimumConfirmations) >= BigInt(attempt.observationPolicy.policy.minimumConfirmations));
    return freeze({ schema: raw.schema, sourceReference: raw.sourceReference, sourceRevision: raw.sourceRevision,
      principal: { tenant: context.tenant, origin: context.origin, account: context.account, chainId: context.chainId },
      attempt, verifier: verifier(raw.verifier), verificationPolicy,
      capabilityReference: raw.capabilityReference, capabilityRevision: raw.capabilityRevision, canExecute: false });
  }
  function decodeBoundEntry(raw, { expectedSource, context, originalAttempt, minimumSavedRevision = '0' }) {
    // expectedSource is deliberately a separate required argument: never extract
    // it from raw, a response-provided expected-verifier flag or the raw digest.
    const source = normalizeExpectedSource(expectedSource, { context, originalAttempt });
    fields(raw, ['schema','operationId','sourceReference','sourceRevision','capabilityReference',
      'capabilityRevision','observationRevision','acceptedObserverContext','observation','available']);
    insist(raw.schema === '8415-bound-observation-entry/1' && raw.operationId === context.operationId &&
      raw.sourceReference === source.sourceReference && raw.sourceRevision === source.sourceRevision &&
      raw.capabilityReference === source.capabilityReference && raw.capabilityRevision === source.capabilityRevision &&
      uint(raw.observationRevision) && typeof raw.available === 'boolean' &&
      raw.observation !== null && raw.acceptedObserverContext !== null);
    insist(typeof minimumSavedRevision === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(minimumSavedRevision) &&
      BigInt(minimumSavedRevision) < (1n << 256n) && BigInt(raw.observationRevision) >= BigInt(minimumSavedRevision));
    const observation = normalizeTaskObservation(raw.observation);
    const accepted = observerContextCodec.normalize(raw.acceptedObserverContext, { observation,
      attempt: source.attempt, currentObservationRevision: raw.observationRevision });
    insist(same(accepted.verifier, source.verifier) &&
      accepted.verificationPolicy.digest === source.verificationPolicy.digest);
    return freeze({ schema: raw.schema, operationId: raw.operationId,
      sourceReference: source.sourceReference, sourceRevision: source.sourceRevision,
      capabilityReference: source.capabilityReference, capabilityRevision: source.capabilityRevision,
      observationRevision: raw.observationRevision, available: raw.available,
      taskDigest: source.attempt.taskDigest, childDigest: source.attempt.childDigest,
      savedRevision: raw.observationRevision, observedAt: observation.observedAt,
      availability: raw.available ? 'available' : 'unavailable', outcome: observation.state, fresh: false,
      acceptedObserverContext: accepted,
      approvedVerifier: source.attempt.receiptVerifier, observedBy: source.verifier,
      observation,
      fullObservationDigest: accepted.fullObservationDigest, canExecute: false });
  }
  return Object.freeze({ normalizeExpectedSource, decodeBoundEntry });
}

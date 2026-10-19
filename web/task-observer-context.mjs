/** Read-only accepted observer provenance codec.
 * This digest is a binding, not a signature or independent chain proof.
 * Only a trusted server's successful observation CAS may call capture().
 * A response or legacy observation must never be used to invent acceptance.
 * Pure helpers are injected by the existing server/browser composition.
 */
export function createTaskObserverContextCodec({ normalizeTaskObservation, normalizeObservationVerifier,
  freezeTaskObservationPolicy, hashCanonical, fail }) {
  const refuse = ok => { if (!ok) fail('TASK_OBSERVER_CONTEXT_REFUSED'); };
  const exact = (value, names) => {
    refuse(value && typeof value === 'object' && !Array.isArray(value) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(value)));
    const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
    refuse(keys.length === names.length && names.every(name => Object.hasOwn(d, name) && Object.hasOwn(d[name], 'value')));
  };
  const version = value => { refuse(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < (1n << 256n)); return value; };
  const hash = value => { refuse(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value)); return value; };
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  const freeze = value => { for (const v of Object.values(value)) if (v && typeof v === 'object') freeze(v); return Object.freeze(value); };
  function policy(value) {
    exact(value, ['policy', 'digest']);
    const normalized = freezeTaskObservationPolicy(value.policy);
    refuse(normalized.digest === value.digest); return normalized;
  }
  function attempt(value) {
    exact(value, ['taskDigest','operationId','childDigest','chainId','actor','nonce','transactionHash',
      'executorDigest','grantPolicyVersion','observationPolicy','receiptVerifier']);
    hash(value.taskDigest); hash(value.childDigest); hash(value.transactionHash); hash(value.executorDigest);
    version(value.chainId); version(value.nonce); version(value.grantPolicyVersion);
    refuse(value.chainId !== '0' && typeof value.operationId === 'string' &&
      /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value.operationId) &&
      typeof value.actor === 'string' && /^0x[0-9a-f]{40}$/.test(value.actor));
    return { taskDigest: value.taskDigest, operationId: value.operationId, childDigest: value.childDigest,
      chainId: value.chainId, actor: value.actor, nonce: value.nonce, transactionHash: value.transactionHash,
      executorDigest: value.executorDigest, grantPolicyVersion: value.grantPolicyVersion,
      observationPolicy: policy(value.observationPolicy), receiptVerifier: verifier(value.receiptVerifier) };
  }
  const verifier = value => {
    exact(value, ['verifierId', 'verifierVersion', 'verifierImplementationDigest']);
    return normalizeObservationVerifier(value);
  };
  function bound(observation, original) {
    refuse(observation.taskDigest === original.taskDigest && observation.childDigest === original.childDigest &&
      observation.chainId === original.chainId && observation.actor === original.actor && observation.nonce === original.nonce &&
      observation.originalTransactionHash === original.transactionHash && observation.attemptExecutorDigest === original.executorDigest &&
      observation.attemptGrantPolicyVersion === original.grantPolicyVersion &&
      observation.observationPolicyDigest === original.observationPolicy.digest &&
      equal(observation.observationPolicy, original.observationPolicy.policy));
  }
  function normalize(value, expected) {
    exact(value, ['schema','acceptedObservationRevision','verifier','verificationPolicy','attempt','fullObservationDigest','canExecute']);
    refuse(value.schema === '8415-accepted-observer-context/1' && value.canExecute === false);
    const accepted = version(value.acceptedObservationRevision), current = version(expected.currentObservationRevision);
    refuse(BigInt(accepted) > 0n && BigInt(accepted) <= BigInt(current));
    const observation = normalizeTaskObservation(expected.observation), original = attempt(value.attempt);
    refuse(equal(original, attempt(expected.attempt))); bound(observation, original);
    const actual = verifier(value.verifier), verifiedPolicy = policy(value.verificationPolicy);
    refuse(observation.verifierId === actual.verifierId && observation.verifierVersion === actual.verifierVersion &&
      observation.verifierImplementationDigest === actual.verifierImplementationDigest);
    const digest = hash(hashCanonical(observation));
    refuse(value.fullObservationDigest === digest);
    if (['confirmed-at-depth','reverted-at-depth','superseded-at-depth'].includes(observation.state))
      refuse(BigInt(observation.confirmations) >= BigInt(original.observationPolicy.policy.minimumConfirmations) &&
        BigInt(observation.confirmations) >= BigInt(verifiedPolicy.policy.minimumConfirmations));
    return freeze({ schema: value.schema, acceptedObservationRevision: accepted, verifier: actual,
      verificationPolicy: verifiedPolicy, attempt: original, fullObservationDigest: digest, canExecute: false });
  }
  function capture({ observation, originalAttempt, acceptedObservationRevision, capturedVerifier, capturedVerificationPolicy }) {
    const normalized = normalizeTaskObservation(observation), original = attempt(originalAttempt);
    const value = { schema: '8415-accepted-observer-context/1', acceptedObservationRevision,
      verifier: verifier(capturedVerifier), verificationPolicy: policy(capturedVerificationPolicy),
      attempt: original, fullObservationDigest: hash(hashCanonical(normalized)), canExecute: false };
    return normalize(value, { observation: normalized, attempt: original, currentObservationRevision: acceptedObservationRevision });
  }
  return Object.freeze({ normalize, capture, normalizeAttempt: attempt, normalizePolicy: policy });
}

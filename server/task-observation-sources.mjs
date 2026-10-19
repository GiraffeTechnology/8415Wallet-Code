/** Trusted service-owned observation source records.
 * This module is server-only. Capture receives actual configured read-only
 * methods, never request JSON. Digests locate records; they do not admit them.
 * Registry values are persisted separately from evidence under the SAME
 * authoritative grant transaction. No signer, send, approval or release port.
 */
export function createTaskObservationSources({ observerContextCodec, normalizeObservationVerifier,
  normalizeTaskObservation, freezeTaskObservationPolicy, hashCanonical, fail }) {
  const insist = (ok, code = 'TASK_OBSERVATION_SOURCE_REFUSED') => { if (!ok) fail(code); };
  const exact = (v, keys) => {
    insist(v && typeof v === 'object' && !Array.isArray(v) &&
      [Object.prototype, null].includes(Object.getPrototypeOf(v)));
    const d = Object.getOwnPropertyDescriptors(v);
    insist(Reflect.ownKeys(d).length === keys.length && keys.every(k => d[k] && Object.hasOwn(d[k], 'value')));
  };
  const freeze = v => { for (const x of Object.values(v)) if (x && typeof x === 'object') freeze(x); return Object.freeze(v); };
  const same = (a,b) => JSON.stringify(a) === JSON.stringify(b);
  const uint = v => typeof v === 'string' && /^[1-9][0-9]{0,77}$/.test(v) && BigInt(v) < (1n<<256n);
  const hash = v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v);
  const reference = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,191}$/.test(v);
  const captures = new WeakMap();
  const METHODS = ['observe','observeHistorical','observeReplacement','observeReplacementHistorical',
    'observeMintResult','observeMintResultHistorical'];
  function scope(value) {
    exact(value,['principal','grantReference','taskDigest']);
    insist(typeof value.principal === 'string' && typeof value.grantReference === 'string' &&
      value.grantReference.length > 0 && value.grantReference.length <= 256 && hash(value.taskDigest));
    let p; try { p = JSON.parse(value.principal); } catch { insist(false); }
    let canonicalOrigin = false;
    try { canonicalOrigin = Array.isArray(p) && new URL(p[0]).origin === p[0]; } catch { /* sanitized below */ }
    insist(Array.isArray(p) && p.length === 5 && p.every(v=>typeof v === 'string') &&
      canonicalOrigin && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(p[1]) &&
      p[2].length > 0 && /^0x[0-9a-f]{40}$/.test(p[3]) &&
      /^(0|[1-9][0-9]{0,77})$/.test(p[4]) && BigInt(p[4])>0n && BigInt(p[4])<(1n<<256n) &&
      JSON.stringify(p) === value.principal);
    return freeze({principal:value.principal,grantReference:value.grantReference,taskDigest:value.taskDigest});
  }
  function attempt(value, scoped) {
    const a = observerContextCodec.normalizeAttempt(value), p = JSON.parse(scoped.principal);
    insist(a.taskDigest === scoped.taskDigest && a.actor === p[3] && a.chainId === p[4]);
    return a;
  }
  function policy(value) {
    return observerContextCodec.normalizePolicy(value);
  }
  function refs(scoped, original, verifier, verificationPolicy) {
    const digest = hashCanonical({scope:scoped,attempt:original,verifier,verificationPolicy});
    insist(hash(digest));
    return {sourceReference:'observation-source:'+digest.slice(2),capabilityReference:'observation-capability:'+digest.slice(2)};
  }
  function record(value, scoped) {
    exact(value,['schema','sourceReference','sourceRevision','capabilityReference','capabilityRevision',
      'status','attempt','verifier','verificationPolicy','purpose','canExecute']);
    insist(value.schema === '8415-task-observation-source-record/1' &&
      ['admitted','revoked'].includes(value.status) && uint(value.sourceRevision) && uint(value.capabilityRevision) &&
      reference(value.sourceReference) && reference(value.capabilityReference) &&
      value.purpose === 'read-only-exact-observation' && value.canExecute === false);
    const original = attempt(value.attempt,scoped), verifier = normalizeObservationVerifier(value.verifier),
      verificationPolicy = policy(value.verificationPolicy), expected = refs(scoped,original,verifier,verificationPolicy);
    insist(value.sourceReference === expected.sourceReference && value.capabilityReference === expected.capabilityReference &&
      BigInt(verificationPolicy.policy.minimumConfirmations) >= BigInt(original.observationPolicy.policy.minimumConfirmations));
    return freeze({schema:value.schema,...expected,sourceRevision:value.sourceRevision,capabilityRevision:value.capabilityRevision,
      status:value.status,attempt:original,verifier,verificationPolicy,purpose:value.purpose,canExecute:false});
  }
  function registry(value, requestedScope) {
    const scoped = scope(requestedScope);
    if (value === undefined || value === null)
      return freeze({schema:'8415-task-observation-sources/1',...scoped,records:[]});
    exact(value,['schema','principal','grantReference','taskDigest','records']);
    insist(value.schema === '8415-task-observation-sources/1' &&
      same(scope({principal:value.principal,grantReference:value.grantReference,taskDigest:value.taskDigest}),scoped) &&
      Array.isArray(value.records));
    const result = [], ids = new Set(), caps = new Set();
    for(let i=0;i<value.records.length;i++) {
      insist(Object.hasOwn(value.records,i));
      const r = record(value.records[i],scoped);
      insist(!ids.has(r.sourceReference) && !caps.has(r.capabilityReference));
      ids.add(r.sourceReference);caps.add(r.capabilityReference);result.push(r);
    }
    return freeze({schema:value.schema,...scoped,records:result});
  }
  /** Call only with an actual server-configured, identity-bound receipt port. */
  function capture({verifier,verificationPolicy,methods}) {
    const id = normalizeObservationVerifier(verifier), frozenPolicy = policy(verificationPolicy);
    insist(methods && typeof methods.observe === 'function');
    const copied = {};
    for(const name of METHODS) if(typeof methods[name] === 'function') copied[name]=methods[name].bind(methods);
    const handle = freeze({verifier:id,verificationPolicy:frozenPolicy});
    captures.set(handle,Object.freeze(copied));return handle;
  }
  function register(value, requestedScope, originalAttempt, handle) {
    insist(captures.has(handle),'TASK_OBSERVATION_SOURCE_CAPTURE_REQUIRED');
    const scoped=scope(requestedScope), original=attempt(originalAttempt,scoped), current=registry(value,scoped);
    // The existing read-only method must honor both floors. The original policy
    // is NEVER rewritten in the observation. This is an effective verification
    // floor for this exact old attempt, not a newly weakened authorization.
    const minimumConfirmations = (BigInt(handle.verificationPolicy.policy.minimumConfirmations) >
      BigInt(original.observationPolicy.policy.minimumConfirmations) ?
      handle.verificationPolicy.policy.minimumConfirmations : original.observationPolicy.policy.minimumConfirmations);
    const verificationPolicy=freezeTaskObservationPolicy({minimumConfirmations});
    const references=refs(scoped,original,handle.verifier,verificationPolicy);
    const prior=current.records.find(r=>r.sourceReference===references.sourceReference);
    if(prior) {
      insist(prior.status==='admitted','TASK_OBSERVATION_SOURCE_REVOKED');
      insist(same(prior.attempt,original)&&same(prior.verifier,handle.verifier)&&
        same(prior.verificationPolicy,verificationPolicy));
      return freeze({registry:current,source:descriptor(prior,scoped)});
    }
    const admitted=record({schema:'8415-task-observation-source-record/1',...references,
      sourceRevision:'1',capabilityRevision:'1',status:'admitted',attempt:original,verifier:handle.verifier,
      verificationPolicy,purpose:'read-only-exact-observation',canExecute:false},scoped);
    return freeze({registry:{...current,records:[...current.records,admitted]},source:descriptor(admitted,scoped)});
  }
  function descriptor(value, requestedScope) {
    const scoped=scope(requestedScope), r=record(value,scoped), p=JSON.parse(scoped.principal);
    insist(r.status==='admitted','TASK_OBSERVATION_SOURCE_REVOKED');
    return freeze({schema:'8415-observation-source/1',sourceReference:r.sourceReference,sourceRevision:r.sourceRevision,
      principal:{tenant:p[1],origin:p[0],account:p[3],chainId:p[4]},attempt:r.attempt,
      verifier:r.verifier,verificationPolicy:r.verificationPolicy,capabilityReference:r.capabilityReference,
      capabilityRevision:r.capabilityRevision,canExecute:false});
  }
  /** references locate only a record in the durable trusted registry. */
  function resolve(value, requestedScope, references, originalAttempt = null) {
    const scoped=scope(requestedScope), current=registry(value,scoped);
    exact(references,['sourceReference','sourceRevision','capabilityReference','capabilityRevision']);
    insist(reference(references.sourceReference)&&reference(references.capabilityReference)&&
      uint(references.sourceRevision)&&uint(references.capabilityRevision));
    const found=current.records.find(r=>r.sourceReference===references.sourceReference);
    insist(found && found.sourceRevision===references.sourceRevision &&
      found.capabilityReference===references.capabilityReference &&
      found.capabilityRevision===references.capabilityRevision,'TASK_OBSERVATION_SOURCE_REVISION_CONFLICT');
    const source=descriptor(found,scoped);
    if(originalAttempt!==null)insist(same(source.attempt,attempt(originalAttempt,scoped)));
    return source;
  }
  function assertCurrent(value, requestedScope, captured, originalAttempt) {
    const source=resolve(value,requestedScope,{sourceReference:captured.sourceReference,sourceRevision:captured.sourceRevision,
      capabilityReference:captured.capabilityReference,capabilityRevision:captured.capabilityRevision},originalAttempt);
    insist(same(source,captured),'TASK_OBSERVATION_SOURCE_REVISION_CONFLICT');return source;
  }
  function entryReferences(entry) {
    return {sourceReference:entry.sourceReference,sourceRevision:entry.sourceRevision,
      capabilityReference:entry.capabilityReference,capabilityRevision:entry.capabilityRevision};
  }
  function checkEntry(entry, value, requestedScope, originalAttempt = null) {
    insist(entry && typeof entry === 'object' && !Array.isArray(entry));
    const mint=Object.hasOwn(entry,'mintResult');
    exact(entry,['schema','operationId','observation','available','observationRevision','acceptedObserverContext',
      'sourceReference','sourceRevision','capabilityReference','capabilityRevision',...(mint?['mintResult']:[])]);
    insist(entry.schema==='8415-task-observation-record/3' && uint(entry.observationRevision) &&
      typeof entry.available==='boolean' && entry.observation!==null && entry.acceptedObserverContext!==null);
    const source=resolve(value,requestedScope,entryReferences(entry),originalAttempt);
    insist(entry.operationId===source.attempt.operationId);
    const observation=normalizeTaskObservation(entry.observation);
    const accepted=observerContextCodec.normalize(entry.acceptedObserverContext,{observation,attempt:source.attempt,
      currentObservationRevision:entry.observationRevision});
    insist(same(accepted.verifier,source.verifier)&&same(accepted.verificationPolicy,source.verificationPolicy));
    return freeze({source,observation,acceptedObserverContext:accepted});
  }
  function bindEntry({value,scope:requestedScope,source,observation,revision,mintResult}) {
    const trusted=assertCurrent(value,requestedScope,source,source.attempt);
    insist(uint(revision));
    const normalized=normalizeTaskObservation(observation), accepted=observerContextCodec.capture({
      observation:normalized,originalAttempt:trusted.attempt,acceptedObservationRevision:revision,
      capturedVerifier:trusted.verifier,capturedVerificationPolicy:trusted.verificationPolicy});
    const row={schema:'8415-task-observation-record/3',operationId:trusted.attempt.operationId,observation:normalized,
      available:true,observationRevision:revision,acceptedObserverContext:accepted,...entryReferences(trusted),
      ...(mintResult===undefined?{}:{mintResult})};
    checkEntry(row,value,requestedScope,trusted.attempt);return freeze(row);
  }
  function boundView(entry,value,requestedScope,originalAttempt=null) {
    const checked=checkEntry(entry,value,requestedScope,originalAttempt);
    return freeze({schema:'8415-bound-observation-entry/1',operationId:entry.operationId,
      ...entryReferences(checked.source),observationRevision:entry.observationRevision,
      acceptedObserverContext:checked.acceptedObserverContext,observation:checked.observation,available:entry.available});
  }
  async function invoke(handle, method, ...args) {
    const methods=captures.get(handle);
    insist(methods && METHODS.includes(method) && typeof methods[method]==='function',
      'TASK_OBSERVATION_SOURCE_CAPTURE_REQUIRED');
    return await methods[method](...args);
  }
  return Object.freeze({registry,capture,register,resolve,assertCurrent,checkEntry,bindEntry,boundView,
    entryReferences,invoke});
}


/** Human read-only observation-details lifecycle. No signing, grant mutation,
 * dispatch, automatic retries, storage or endpoint selection exists here.
 * Composition must supply authenticated independent source resolution and the
 * strict source/evidence decoder. Neither is inferred from the evidence body.
 */
export class ObservationDetailsError extends Error {
  constructor(code) { super(code); this.code = code; this.name = 'ObservationDetailsError'; }
}
const requireThat = (ok, code) => { if (!ok) throw new ObservationDetailsError(code); };
const exact = (value, keys) => {
  requireThat(value && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)), 'OBSERVATION_CONTEXT_REFUSED');
  const d = Object.getOwnPropertyDescriptors(value);
  requireThat(Reflect.ownKeys(d).length === keys.length && keys.every(k => d[k] && Object.hasOwn(d[k], 'value')),
    'OBSERVATION_CONTEXT_REFUSED');
};
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < (1n << 256n);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
function scope(input) {
  exact(input, ['tenant','origin','account','chainId','taskDigest','operationId','childDigest']);
  requireThat(typeof input.tenant === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.tenant) &&
    typeof input.origin === 'string' && new URL(input.origin).origin === input.origin &&
    typeof input.account === 'string' && /^0x[0-9a-f]{40}$/.test(input.account) &&
    uint(input.chainId) && input.chainId !== '0' && hash(input.taskDigest) && hash(input.childDigest) &&
    typeof input.operationId === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(input.operationId),
  'OBSERVATION_CONTEXT_REFUSED');
  return Object.freeze({ ...input });
}
const errors = new Set(['OBSERVATION_SOURCE_UNAVAILABLE','OBSERVATION_SOURCE_UNSUPPORTED',
  'OBSERVATION_BINDING_REFUSED','OBSERVATION_REVISION_STALE','OBSERVATION_EVIDENCE_UNAVAILABLE',
  'OBSERVATION_SESSION_CHANGED']);
// Preserve the service refusal; translate only known presentation categories.
// A missing independent source must not look like missing owner permission.
const serviceErrors = Object.freeze({
  TASK_OBSERVATION_SOURCE_UNSUPPORTED: 'OBSERVATION_SOURCE_UNSUPPORTED',
  TASK_OBSERVATION_SOURCE_UNAVAILABLE: 'OBSERVATION_SOURCE_UNAVAILABLE',
  TASK_OBSERVATION_BINDING_REFUSED: 'OBSERVATION_BINDING_REFUSED',
  TASK_OBSERVATION_REVISION_STALE: 'OBSERVATION_REVISION_STALE',
});

export class ObservationDetailsFlow {
  #resolve; #read; #decode; #assert; #notify; #generation = 0; #binding = null;
  #context = null; #abort = null; #busy = false; #state;
  constructor({ resolveSource, readEvidence, decodeEvidence, assertSession, onChange = () => {} }) {
    requireThat([resolveSource, readEvidence, decodeEvidence, assertSession, onChange].every(v => typeof v === 'function'),
      'OBSERVATION_SERVICE_NOT_CONNECTED');
    this.#resolve = resolveSource; this.#read = readEvidence; this.#decode = decodeEvidence;
    this.#assert = assertSession; this.#notify = onChange;
    this.#state = Object.freeze({ phase: 'closed', loading: false, stale: false, evidence: null, error: null });
  }
  snapshot() { return this.#state; }
  #paint(value) { this.#state = Object.freeze(value); this.#notify(this.#state); }
  #samePrincipal() {
    let session;
    try { session = this.#assert(this.#binding); }
    catch { throw new ObservationDetailsError('OBSERVATION_SESSION_CHANGED'); }
    const c = this.#context;
    requireThat(session && c && ['tenant','origin','account','chainId'].every(k => session[k] === c[k]),
      'OBSERVATION_SESSION_CHANGED');
  }
  #cancel() { this.#generation++; this.#abort?.abort(); this.#abort = null; this.#busy = false; }
  close() {
    this.#cancel(); this.#context = null; this.#binding = null;
    this.#paint({ phase: 'closed', loading: false, stale: false, evidence: null, error: null });
  }
  logout() { this.close(); }
  async open(input, sessionBinding) {
    let next;
    try { next = scope(input); } catch (error) { this.close(); throw error; }
    const same = this.#binding === sessionBinding &&
      this.#context !== null && JSON.stringify(next) === JSON.stringify(this.#context);
    this.#cancel();
    const prior = same ? this.#state.evidence : null;
    this.#context = next; this.#binding = sessionBinding;
    this.#paint({ phase: 'loading', loading: true, stale: prior !== null, evidence: prior, error: null });
    return this.#load(false);
  }
  async refresh() {
    if (this.#busy || this.#context === null) return;
    this.#paint({ ...this.#state, phase: 'loading', loading: true, stale: this.#state.evidence !== null, error: null });
    return this.#load(true);
  }
  async #load(refresh) {
    const generation = this.#generation, context = this.#context, binding = this.#binding;
    const previous = this.#state.evidence;
    this.#busy = true; this.#abort = new AbortController(); const signal = this.#abort.signal;
    try {
      this.#samePrincipal();
      // Resolve independently, before obtaining evidence. The resolver is bound
      // to the authenticated service, never to a browser-selected source URL.
      // Cached reads resolve the durable accepted source (for example O2), not
      // whichever observer is current now (O3). Only an explicit refresh selects
      // the trusted current capability. Both are resolved before reading data.
      const mode = refresh ? 'refresh' : 'cache';
      const source = await this.#resolve(context, { mode, signal, sessionBinding: binding });
      if (generation !== this.#generation) return;
      this.#samePrincipal();
      requireThat(source && typeof source === 'object' && Object.isFrozen(source),
        'OBSERVATION_SOURCE_UNSUPPORTED');
      const raw = await this.#read(context, { source, refresh, signal, sessionBinding: binding });
      if (generation !== this.#generation) return;
      this.#samePrincipal();
      const evidence = this.#decode(raw, { expectedSource: source, context });
      requireThat(evidence && Object.isFrozen(evidence) && uint(evidence.savedRevision) &&
        evidence.taskDigest === context.taskDigest && evidence.operationId === context.operationId &&
        evidence.childDigest === context.childDigest, 'OBSERVATION_BINDING_REFUSED');
      requireThat(previous === null || BigInt(evidence.savedRevision) >= BigInt(previous.savedRevision),
        'OBSERVATION_REVISION_STALE');
      requireThat(evidence.availability === 'available' || evidence.availability === 'unavailable',
        'OBSERVATION_BINDING_REFUSED');
      this.#paint({ phase: evidence.availability === 'available' ? 'ready' : 'unavailable', loading: false,
        stale: evidence.availability !== 'available' || evidence.fresh !== true,
        evidence, error: evidence.availability === 'available' ? null : 'OBSERVATION_EVIDENCE_UNAVAILABLE' });
    } catch (error) {
      if (generation !== this.#generation) return;
      // A rejected asynchronous read may hide a concurrent session/account
      // change. Revalidate before retaining any prior principal's evidence,
      // even when no logout notification reached this flow.
      try { this.#samePrincipal(); }
      catch { this.close(); return; }
      const failureCode = error?.code ?? error?.message ?? '';
      if (failureCode === 'OBSERVATION_SESSION_CHANGED' || failureCode === 'TASK_PRINCIPAL_BINDING_REFUSED' ||
        /^(?:AUTH|LOGIN|WALLET_LOGIN)_/.test(failureCode)) {
        this.close(); return;
      }
      const code = errors.has(error?.code) ? error.code :
        Object.hasOwn(serviceErrors, failureCode) ? serviceErrors[failureCode] : 'OBSERVATION_EVIDENCE_UNAVAILABLE';
      // Keep the actual old source/time/revision as one immutable pair, not the
      // failed refresh's descriptor or request timestamp.
      this.#paint({ phase: 'unavailable', loading: false, stale: previous !== null, evidence: previous, error: code });
    } finally {
      if (generation === this.#generation) { this.#busy = false; this.#abort = null; }
    }
  }
}

/** Funded V3 content/state contract. Never a grant, balance source or payment port.
 * Only the original server authority and purpose-limited funds/evidence adapters
 * may apply these transitions to their own durable state. Imported JSON and this
 * reducer's output establish no financial authority or completed asset movement.
 * Unfunded/control-driven paths do not depend on this optional contract. */
import { keccak256Utf8 } from '../codec/keccak.ts';

export class ReceiptPrincipalError extends Error {
  readonly code: string;
  constructor(code = 'RECEIPT_PRINCIPAL_REFUSED') { super(code); this.code = code; }
}
function requireThat(ok: unknown, code?: string): asserts ok {
  if (!ok) throw new ReceiptPrincipalError(code);
}
function fields(input: unknown, keys: readonly string[]): Record<string, any> {
  requireThat(input && [Object.prototype, null].includes(Object.getPrototypeOf(input)));
  const d = Object.getOwnPropertyDescriptors(input);
  requireThat(Reflect.ownKeys(d).length === keys.length && keys.every(k =>
    Object.hasOwn(d[k] ?? {}, 'value') && d[k]!.enumerable));
  return Object.fromEntries(keys.map(k => [k, d[k]!.value]));
}
function uint(value: unknown, positive = false): string {
  requireThat(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value));
  requireThat(BigInt(value) >= (positive ? 1n : 0n) && BigInt(value) < 1n << 256n); return value;
}
function id(value: unknown): string {
  requireThat(typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(value)); return value;
}
function address(value: unknown): string {
  requireThat(typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && !/^0x0+$/.test(value)); return value;
}
function hash(value: unknown): string {
  requireThat(typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value)); return value;
}
function freeze<T>(value: T): Readonly<T> {
  if (value && typeof value === 'object') { Object.values(value).forEach(freeze); Object.freeze(value); }
  return value;
}
function list(input: unknown, maximum: number): unknown[] {
  requireThat(Array.isArray(input) && input.length <= maximum);
  const d = Object.getOwnPropertyDescriptors(input); requireThat(Reflect.ownKeys(d).length === input.length + 1);
  return Array.from({ length: input.length }, (_, n) => {
    requireThat(Object.hasOwn(d[String(n)] ?? {}, 'value')); return d[String(n)]!.value;
  });
}
export function normalizeReceiptPrincipalPurpose(input: unknown) {
  const p = fields(input, ['schema','reservationId','tenant','origin','account','chainId','currency',
    'amountBaseUnits','payee','task','receipt','lineage','mintTerms']);
  requireThat(p.schema === '8415-receipt-principal-purpose/1');
  const tenant = id(p.tenant); requireThat(/^[a-z][a-z0-9-]{0,47}$/.test(tenant));
  requireThat(typeof p.origin === 'string'); const origin = new URL(p.origin);
  requireThat(origin.origin === p.origin && origin.protocol === 'https:');
  const c = fields(p.currency, ['kind','contract','decimals']);
  requireThat(c.kind === 'native' ? c.contract === null : c.kind === 'erc20' && typeof c.contract === 'string');
  requireThat(Number.isSafeInteger(c.decimals) && c.decimals >= 0 && c.decimals <= 255);
  const currency = { kind: c.kind as 'native' | 'erc20', contract: c.kind === 'native' ? null : address(c.contract), decimals: c.decimals as number };
  const t = fields(p.task, ['taskId','taskDigest','executorDigest','grantReference','grantPolicyVersion','operationId']);
  const task = { taskId: id(t.taskId), taskDigest: hash(t.taskDigest), executorDigest: hash(t.executorDigest),
    grantReference: id(t.grantReference), grantPolicyVersion: uint(t.grantPolicyVersion, true), operationId: id(t.operationId) };
  const r = fields(p.receipt, ['collection','tokenId','segmentId','planDigest','journalBindingHash']);
  const receipt = { collection: address(r.collection), tokenId: uint(r.tokenId), segmentId: hash(r.segmentId),
    planDigest: hash(r.planDigest), journalBindingHash: hash(r.journalBindingHash) };
  const l = fields(p.lineage, ['id','index','previousReservationId']); const index = uint(l.index);
  requireThat(BigInt(index) <= BigInt(Number.MAX_SAFE_INTEGER));
  requireThat(index === '0' ? l.previousReservationId === null : typeof l.previousReservationId === 'string');
  const lineage = { id: id(l.id), index, previousReservationId: l.previousReservationId === null ? null : id(l.previousReservationId) };
  const m = fields(p.mintTerms, ['version','commitment','registrationDeadline']);
  const mintTerms = { version: uint(m.version, true), commitment: hash(m.commitment), registrationDeadline: uint(m.registrationDeadline, true) };
  requireThat(BigInt(mintTerms.registrationDeadline) < 1n << 64n);
  const account = address(p.account), payee = address(p.payee); requireThat(account !== payee);
  return freeze({ schema: '8415-receipt-principal-purpose/1' as const, reservationId: id(p.reservationId), tenant,
    origin: p.origin as string, account, chainId: uint(p.chainId, true), currency,
    amountBaseUnits: uint(p.amountBaseUnits, true), payee, task, receipt, lineage, mintTerms });
}
export type ReceiptPrincipalPurpose = ReturnType<typeof normalizeReceiptPrincipalPurpose>;
export type ReceiptPrincipalAction = 'freeze' | 'settle' | 'release';
export type ReceiptPrincipalStatus = 'unreserved' | 'freeze-pending' | 'held' | 'settle-pending' | 'settled' | 'release-pending' | 'released' | 'unknown';
/** Internal application-facing facts. Only an original server-owned evidence
 * adapter may establish their provenance; accepting this shape does not do so. */
export type ReceiptRegistrationFacts = Readonly<{
  sourceReference: string; purposeDigest: string; mintTermsCommitment: string;
  chainId: string; collection: string; tokenId: string; registeredHolder: string; registeredAt: string;
}>;
export type ReceiptRollbackFacts = Readonly<{
  sourceReference: string; purposeDigest: string; mintTermsCommitment: string;
  chainId: string; collection: string; tokenId: string; validHolder: string;
  observedAt: string; firstUnresolvedIndex: string; registrationCompleted: false;
}>;
export type ReceiptPrincipalEffectFacts = Readonly<{
  action: ReceiptPrincipalAction; effectId: string; reference: string; purposeDigest: string;
  amountBaseUnits: string; recipient: string;
}>;
export type ReceiptPrincipalEvent =
  | Readonly<{kind: 'freeze-started'}>
  | Readonly<{kind: 'settle-started'; registration: ReceiptRegistrationFacts}>
  | Readonly<{kind: 'release-started'; rollback: ReceiptRollbackFacts}>
  | Readonly<{kind: 'effect-unknown'; action: ReceiptPrincipalAction}>
  | (Readonly<{kind: 'effect-confirmed' | 'effect-reconciled'}> & ReceiptPrincipalEffectFacts);
export type ReceiptPrincipalTransition = Readonly<{
  expectedRevision: string; eventId: string; event: ReceiptPrincipalEvent;
}>;
export type ReceiptPrincipalState = Readonly<{
  schema: '8415-receipt-principal-state/1'; purpose: ReceiptPrincipalPurpose; purposeDigest: string;
  revision: string; status: ReceiptPrincipalStatus; holdReference: string | null;
  activeEffect: ReceiptPrincipalAction | null; attemptedActions: readonly ReceiptPrincipalAction[];
  history: readonly Readonly<{ eventId: string; digest: string }>[];
}>;
export function receiptPrincipalPurposeDigest(input: unknown): string {
  return keccak256Utf8(JSON.stringify(normalizeReceiptPrincipalPurpose(input)));
}
export function newReceiptPrincipalState(input: unknown): ReceiptPrincipalState {
  const purpose = normalizeReceiptPrincipalPurpose(input);
  return freeze({ schema: '8415-receipt-principal-state/1' as const, purpose,
    purposeDigest: receiptPrincipalPurposeDigest(purpose), revision: '0', status: 'unreserved' as const,
    holdReference: null, activeEffect: null, attemptedActions: [], history: [] });
}
const actions = ['freeze','settle','release'] as const;
const statuses = ['unreserved','freeze-pending','held','settle-pending','settled','release-pending','released','unknown'] as const;
export function normalizeReceiptPrincipalState(input: unknown): ReceiptPrincipalState {
  const s = fields(input, ['schema','purpose','purposeDigest','revision','status','holdReference','activeEffect','attemptedActions','history']);
  requireThat(s.schema === '8415-receipt-principal-state/1');
  const purpose = normalizeReceiptPrincipalPurpose(s.purpose), purposeDigest = receiptPrincipalPurposeDigest(purpose);
  requireThat(s.purposeDigest === purposeDigest && statuses.includes(s.status));
  const attemptedActions = list(s.attemptedActions, 3).map(a => { requireThat(actions.includes(a as ReceiptPrincipalAction)); return a as ReceiptPrincipalAction; });
  requireThat(new Set(attemptedActions).size === attemptedActions.length && !(attemptedActions.includes('settle') && attemptedActions.includes('release') && s.status === 'settled'));
  const history = list(s.history, 64).map(v => { const h = fields(v, ['eventId','digest']); return { eventId: id(h.eventId), digest: hash(h.digest) }; });
  requireThat(new Set(history.map(h => h.eventId)).size === history.length && BigInt(uint(s.revision)) === BigInt(history.length));
  requireThat(s.holdReference === null || typeof s.holdReference === 'string');
  const holdReference = s.holdReference === null ? null : id(s.holdReference);
  const pending = s.status.endsWith('-pending') || s.status === 'unknown';
  requireThat(pending ? actions.includes(s.activeEffect) && attemptedActions.includes(s.activeEffect) : s.activeEffect === null);
  const pathAction = pending ? s.activeEffect : s.status === 'settled' ? 'settle' : s.status === 'released' ? 'release' : null;
  const expectedActions = s.status === 'unreserved' ? [] : pathAction === null || pathAction === 'freeze' ? ['freeze'] : ['freeze',pathAction];
  requireThat(attemptedActions.length === expectedActions.length && attemptedActions.every((a,n) => a === expectedActions[n]));
  requireThat(s.status === 'unreserved' || pathAction === 'freeze' ? holdReference === null : holdReference !== null);
  requireThat(s.status !== 'unreserved' || attemptedActions.length === 0 && history.length === 0 && holdReference === null);
  return freeze({ schema: '8415-receipt-principal-state/1' as const, purpose, purposeDigest, revision: s.revision as string,
    status: s.status as ReceiptPrincipalStatus, holdReference, activeEffect: s.activeEffect as ReceiptPrincipalAction | null, attemptedActions, history });
}

/** Verified adapter outputs are checked AGAIN for exact purpose/asset binding by
 * the server. These shape checks alone never verify Oracle or financial evidence. */
function registrationFacts(raw: unknown, p: ReceiptPrincipalPurpose, digest: string) {
  const e = fields(raw, ['sourceReference','purposeDigest','mintTermsCommitment','chainId','collection','tokenId','registeredHolder','registeredAt']);
  id(e.sourceReference); requireThat(e.purposeDigest === digest && e.mintTermsCommitment === p.mintTerms.commitment &&
    e.chainId === p.chainId && e.collection === p.receipt.collection && e.tokenId === p.receipt.tokenId && e.registeredHolder === p.account);
  requireThat(BigInt(uint(e.registeredAt)) <= BigInt(p.mintTerms.registrationDeadline), 'RECEIPT_PRINCIPAL_LATE_REGISTRATION_REFUSED');
  return e;
}
function rollbackFacts(raw: unknown, p: ReceiptPrincipalPurpose, digest: string) {
  const e = fields(raw, ['sourceReference','purposeDigest','mintTermsCommitment','chainId','collection','tokenId','validHolder','observedAt','firstUnresolvedIndex','registrationCompleted']);
  id(e.sourceReference); address(e.validHolder);
  requireThat(e.purposeDigest === digest && e.mintTermsCommitment === p.mintTerms.commitment && e.chainId === p.chainId &&
    e.collection === p.receipt.collection && e.tokenId === p.receipt.tokenId && e.registrationCompleted === false);
  requireThat(BigInt(uint(e.observedAt)) > BigInt(p.mintTerms.registrationDeadline), 'RECEIPT_PRINCIPAL_MINT_DEADLINE_REQUIRED');
  requireThat(BigInt(uint(e.firstUnresolvedIndex)) <= BigInt(p.lineage.index), 'RECEIPT_PRINCIPAL_SETTLED_PREFIX_REFUSED');
  return e;
}
export function advanceReceiptPrincipalState(input: unknown, raw: unknown): ReceiptPrincipalState {
  const state = normalizeReceiptPrincipalState(input), r = fields(raw, ['expectedRevision','eventId','event']);
  const eventId = id(r.eventId); uint(r.expectedRevision);
  const kind = Object.getOwnPropertyDescriptor(r.event ?? {}, 'kind'); requireThat(kind && Object.hasOwn(kind,'value'));
  let event: Record<string, any>;
  if (kind.value === 'freeze-started') event = fields(r.event, ['kind']);
  else if (kind.value === 'settle-started') { event = fields(r.event, ['kind','registration']); event.registration = registrationFacts(event.registration,state.purpose,state.purposeDigest); }
  else if (kind.value === 'release-started') { event = fields(r.event, ['kind','rollback']); event.rollback = rollbackFacts(event.rollback,state.purpose,state.purposeDigest); }
  else if (kind.value === 'effect-unknown') event = fields(r.event, ['kind','action']);
  else { requireThat(['effect-confirmed','effect-reconciled'].includes(kind.value)); event = fields(r.event, ['kind','action','effectId','reference','purposeDigest','amountBaseUnits','recipient']); }
  // Normalize nested facts before hashing: only canonical fields are retained.
  const digest = keccak256Utf8(JSON.stringify(event)), previous = state.history.find(h => h.eventId === eventId);
  if (previous) { requireThat(previous.digest === digest,'RECEIPT_PRINCIPAL_IDEMPOTENCY_CONFLICT'); return state; }
  requireThat(r.expectedRevision === state.revision,'RECEIPT_PRINCIPAL_REVISION_CONFLICT');
  requireThat(state.history.length < 64,'RECEIPT_PRINCIPAL_HISTORY_LIMIT');
  let status = state.status, holdReference = state.holdReference, activeEffect = state.activeEffect;
  const attemptedActions = [...state.attemptedActions];
  if (event.kind.endsWith('-started')) {
    const action = event.kind.slice(0,-8) as ReceiptPrincipalAction;
    requireThat(actions.includes(action) && !attemptedActions.includes(action),'RECEIPT_PRINCIPAL_EFFECT_ALREADY_ATTEMPTED');
    requireThat(action === 'freeze' ? status === 'unreserved' : status === 'held','RECEIPT_PRINCIPAL_STATE_REFUSED');
    attemptedActions.push(action); activeEffect = action; status = (action + '-pending') as ReceiptPrincipalStatus;
  } else {
    requireThat(actions.includes(event.action) && activeEffect === event.action,'RECEIPT_PRINCIPAL_EFFECT_BINDING_REFUSED');
    if (event.kind === 'effect-unknown') {
      requireThat(status === event.action + '-pending' || status === 'unknown'); status = 'unknown';
    } else {
      requireThat(event.kind === 'effect-reconciled' ? status === 'unknown' : status === event.action + '-pending');
      requireThat(event.effectId === state.purpose.reservationId + ':' + event.action && event.purposeDigest === state.purposeDigest &&
        event.amountBaseUnits === state.purpose.amountBaseUnits && event.recipient === (event.action === 'settle' ? state.purpose.payee : state.purpose.account));
      id(event.reference);
      if (event.action === 'freeze') holdReference = event.reference;
      else requireThat(holdReference !== null,'RECEIPT_PRINCIPAL_EXISTING_HOLD_REQUIRED');
      status = event.action === 'freeze' ? 'held' : event.action === 'settle' ? 'settled' : 'released'; activeEffect = null;
    }
  }
  return normalizeReceiptPrincipalState({ ...state, revision: (BigInt(state.revision)+1n).toString(), status,
    holdReference, activeEffect, attemptedActions, history: [...state.history,{eventId,digest}] });
}

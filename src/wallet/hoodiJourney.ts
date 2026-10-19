import type { Erc8415Reader } from '../sdk/port.ts';
import type { RegisterEntry } from '../sdk/types.ts';
import { buildTemporalView, type TemporalView } from './temporalQuery.ts';

export const HOODI_JOURNEY_CHAIN = 560048n;
export const HOODI_JOURNEY_GENESIS =
  '0xbbe312868b376a3001692a646dd2d7d1e4406380dfd86b98aa8a34d1557c971b';
/** Opaque private binding supplied by the authenticated deployment, never a public roster. */
export type JourneyTenant = string;
export type JourneyManifest = {
  readonly chainId: bigint;
  readonly genesisHash: string;
  readonly contract: string;
  readonly tokenId: bigint;
  readonly registerId: string;
  readonly verificationProfile: string;
  /** Existing approved bindings only; this module never discovers or creates accounts. */
  readonly wallets: readonly { readonly tenant: JourneyTenant; readonly account: string }[];
};
export type ChainRecord = {
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly transactionHash: string;
  /** Actual chain admission/receipt time, never the entry's effectiveAt. */
  readonly recordedAt: bigint;
};
export type AdmittedEntryEvidence = {
  readonly entry: RegisterEntry;
  readonly admission: ChainRecord;
};
export type ReleaseObservation = {
  readonly legId: string;
  readonly controlId: string;
  readonly buyerTenant: JourneyTenant;
  readonly buyerOccurrence: bigint;
  readonly ownerOccurrence: bigint;
  readonly holderOccurrence: bigint;
  readonly owner: string;
  readonly holder: string;
  readonly acceptedConditions: readonly string[];
  readonly termsDigest: string;
  readonly release: ChainRecord;
  readonly tokenResult: { readonly owner: string; readonly transactionHash: string };
  readonly v2: AdmittedEntryEvidence;
};
export type OriginalReleaseRecord = {
  readonly schema: 'hoodi-three-wallet-release/1';
  readonly manifest: JourneyManifest;
  readonly observation: ReleaseObservation;
  /** Evidence only. Imported records do not authenticate a control decision or authorize execution. */
  readonly authority: 'EVIDENCE_ONLY';
};
/**
 * Supplied by the authorized chain reader. All its calls MUST use this exact block.
 * A latest/pending reader is not a conforming implementation of this interface.
 */
export type PinnedJourneyRead = {
  readonly reader: Erc8415Reader;
  readonly blockNumber: bigint;
  readonly blockHash: string;
  readonly recordedAt: bigint;
  readonly genesisHash: string;
  readBlockHash(blockNumber: bigint): Promise<string>;
};
export type ReleaseHistoryComparison = {
  readonly schema: 'hoodi-three-wallet-history-comparison/1';
  readonly original: OriginalReleaseRecord;
  readonly laterV3: AdmittedEntryEvidence;
  readonly query: { readonly tokenId: bigint; readonly instant: bigint;
    readonly blockNumber: bigint; readonly blockHash: string; readonly recordedAt: bigint };
  readonly current: TemporalView;
  readonly interpretation: 'CURRENT_HISTORY_DIFFERS_ORIGINAL_RELEASE_PRESERVED';
  readonly canExecute: false;
  readonly notes: readonly string[];
};
export class JourneyEvidenceError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'JourneyEvidenceError'; this.code = code; }
}
function requireEvidence(ok: boolean, code: string): asserts ok {
  if (!ok) throw new JourneyEvidenceError(code);
}
function hash(value: string): boolean {
  return typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value);
}
function address(value: string): boolean {
  return typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && !/^0x0+$/.test(value);
}
function uint(value: bigint, bits = 256): boolean {
  return typeof value === 'bigint' && value >= 0n && value < (1n << BigInt(bits));
}
function validateChainRecord(value: ChainRecord): void {
  requireEvidence(uint(value.blockNumber) && hash(value.blockHash) &&
    hash(value.transactionHash) && uint(value.recordedAt, 64), 'CHAIN_RECORD_INVALID');
}
function copyChainRecord(value: ChainRecord): ChainRecord {
  validateChainRecord(value);
  return Object.freeze({ blockNumber: value.blockNumber, blockHash: value.blockHash,
    transactionHash: value.transactionHash, recordedAt: value.recordedAt });
}
function copyEntry(value: AdmittedEntryEvidence): AdmittedEntryEvidence {
  const e = value.entry;
  validateChainRecord(value.admission);
  requireEvidence(hash(e.recordCommitment) &&
    /^0x[0-9a-f]{64}$/.test(e.previousCommitment) &&
    /^0x[0-9a-f]{64}$/.test(e.registryReference) &&
    address(e.holder) && uint(e.version, 64) && e.version > 0n &&
    uint(e.effectiveAt, 64) && uint(e.supersededAt, 64), 'ENTRY_INVALID');
  return Object.freeze({ entry: Object.freeze({
    recordCommitment: e.recordCommitment, previousCommitment: e.previousCommitment,
    registryReference: e.registryReference, holder: e.holder, version: e.version,
    effectiveAt: e.effectiveAt, supersededAt: e.supersededAt,
  }), admission: copyChainRecord(value.admission) });
}
function copyManifest(value: JourneyManifest): JourneyManifest {
  requireEvidence(value.chainId === HOODI_JOURNEY_CHAIN &&
    value.genesisHash === HOODI_JOURNEY_GENESIS, 'HOODI_BINDING_REQUIRED');
  requireEvidence(address(value.contract) && uint(value.tokenId) &&
    hash(value.registerId) && hash(value.verificationProfile), 'ASSET_BINDING_INVALID');
  requireEvidence(Array.isArray(value.wallets) && value.wallets.length === 3, 'THREE_WALLETS_REQUIRED');
  const tenants = new Set(value.wallets.map(w => w.tenant));
  const accounts = new Set(value.wallets.map(w => w.account));
  requireEvidence(tenants.size === 3 && accounts.size === 3 && value.wallets.every(w =>
    typeof w.tenant === 'string' && /^[a-z][a-z0-9-]{0,63}$/.test(w.tenant) && address(w.account)),
    'WALLET_BINDING_INVALID');
  return Object.freeze({
    chainId: value.chainId, genesisHash: value.genesisHash, contract: value.contract,
    tokenId: value.tokenId, registerId: value.registerId, verificationProfile: value.verificationProfile,
    wallets: Object.freeze(value.wallets.map(w => Object.freeze({ tenant: w.tenant, account: w.account }))),
  });
}

/** Capture already-observed release evidence, never issue or execute a release. */
export function captureHoodiRelease(
  manifestInput: JourneyManifest, input: ReleaseObservation,
): OriginalReleaseRecord {
  const manifest = copyManifest(manifestInput);
  const v2 = copyEntry(input.v2);
  validateChainRecord(input.release);
  const buyer = manifest.wallets.find(w => w.tenant === input.buyerTenant);
  requireEvidence(buyer !== undefined && hash(input.legId) && hash(input.controlId) &&
    hash(input.termsDigest), 'RELEASE_BINDING_INVALID');
  requireEvidence(uint(input.buyerOccurrence) && input.buyerOccurrence > 0n &&
    uint(input.ownerOccurrence) && uint(input.holderOccurrence) &&
    input.ownerOccurrence >= input.buyerOccurrence &&
    input.holderOccurrence >= input.buyerOccurrence, 'DUAL_OCCURRENCE_REQUIRED');
  requireEvidence([input.owner, input.holder, input.tokenResult.owner].every(
    a => manifest.wallets.some(w => w.account === a)), 'WALLET_RESULT_UNBOUND');
  requireEvidence(input.holder === v2.entry.holder &&
    input.tokenResult.owner === input.owner &&
    input.tokenResult.transactionHash === input.release.transactionHash, 'RELEASE_RESULT_MISMATCH');
  requireEvidence(Array.isArray(input.acceptedConditions) &&
    input.acceptedConditions.length > 0 && input.acceptedConditions.length <= 128 &&
    input.acceptedConditions.every(hash), 'ACCEPTED_CONDITIONS_REQUIRED');
  requireEvidence(v2.entry.version === 2n && v2.entry.supersededAt === 0n &&
    v2.admission.recordedAt <= input.release.recordedAt &&
    v2.admission.blockNumber <= input.release.blockNumber &&
    v2.entry.effectiveAt <= input.release.recordedAt, 'V2_NOT_KNOWN_AT_RELEASE');
  const observation = Object.freeze({
    legId: input.legId, controlId: input.controlId, buyerTenant: input.buyerTenant,
    buyerOccurrence: input.buyerOccurrence, ownerOccurrence: input.ownerOccurrence,
    holderOccurrence: input.holderOccurrence, owner: input.owner, holder: input.holder,
    termsDigest: input.termsDigest, v2, release: copyChainRecord(input.release),
    tokenResult: Object.freeze({ owner: input.tokenResult.owner,
      transactionHash: input.tokenResult.transactionHash }),
    acceptedConditions: Object.freeze([...input.acceptedConditions]),
  });
  return Object.freeze({ schema: 'hoodi-three-wallet-release/1', manifest, observation,
    authority: 'EVIDENCE_ONLY' });
}

/**
 * Read today's historical explanation at exactly the original release instant.
 * Never changes the original record, changes a control outcome, signs, or broadcasts.
 * The caller must enforce verified wallet login before displaying protected data.
 */
export async function compareHoodiReleaseHistory(
  originalInput: OriginalReleaseRecord,
  laterInput: AdmittedEntryEvidence,
  pinned: PinnedJourneyRead,
): Promise<ReleaseHistoryComparison> {
  requireEvidence(originalInput.schema === 'hoodi-three-wallet-release/1' &&
    originalInput.authority === 'EVIDENCE_ONLY', 'RELEASE_SCHEMA_INVALID');
  const original = captureHoodiRelease(originalInput.manifest, originalInput.observation);
  const laterV3 = copyEntry(laterInput);
  const release = original.observation.release;
  const v2 = original.observation.v2;
  requireEvidence(original.manifest.wallets.some(w => w.account === laterV3.entry.holder),
    'V3_HOLDER_UNBOUND');
  requireEvidence(laterV3.entry.version === 3n &&
    laterV3.entry.previousCommitment === v2.entry.recordCommitment &&
    laterV3.entry.effectiveAt > v2.entry.effectiveAt &&
    laterV3.entry.effectiveAt <= release.recordedAt &&
    laterV3.admission.recordedAt > release.recordedAt &&
    laterV3.admission.blockNumber > release.blockNumber, 'LATE_V3_CONDITIONS_REQUIRED');
  requireEvidence(uint(pinned.blockNumber) && hash(pinned.blockHash) &&
    uint(pinned.recordedAt, 64) && pinned.genesisHash === original.manifest.genesisHash &&
    pinned.blockNumber >= laterV3.admission.blockNumber &&
    pinned.recordedAt >= laterV3.admission.recordedAt, 'QUERY_ANCHOR_INVALID');
  const expected = original.manifest;
  const sameSource = () => pinned.reader.source.chainId === expected.chainId &&
    pinned.reader.source.address.toLowerCase() === expected.contract;
  requireEvidence(sameSource(), 'QUERY_ASSET_MISMATCH');
  requireEvidence(await pinned.readBlockHash(pinned.blockNumber) === pinned.blockHash,
    'QUERY_BLOCK_CHANGED');
  const current = await buildTemporalView(pinned.reader, expected.tokenId, release.recordedAt);
  requireEvidence(current.observedAt === pinned.recordedAt, 'QUERY_CLOCK_MISMATCH');
  requireEvidence(sameSource() && current.identity.chainId === expected.chainId &&
    current.identity.address.toLowerCase() === expected.contract &&
    current.identity.registerId === expected.registerId &&
    current.identity.verificationProfile === expected.verificationProfile, 'QUERY_IDENTITY_MISMATCH');
  requireEvidence(current.resolution.kind === 'resolved', 'HISTORICAL_QUERY_UNAVAILABLE');
  const actual = current.resolution.entry;
  const wanted = laterV3.entry;
  requireEvidence(actual.version === wanted.version && actual.holder === wanted.holder &&
    actual.recordCommitment === wanted.recordCommitment &&
    actual.previousCommitment === wanted.previousCommitment &&
    actual.registryReference === wanted.registryReference &&
    actual.effectiveAt === wanted.effectiveAt && actual.supersededAt === wanted.supersededAt &&
    current.resolution.holderAgreesWithEntry, 'HISTORICAL_V3_MISMATCH');
  requireEvidence(await pinned.readBlockHash(pinned.blockNumber) === pinned.blockHash,
    'QUERY_BLOCK_CHANGED');
  return Object.freeze({
    schema: 'hoodi-three-wallet-history-comparison/1', original, laterV3,
    query: Object.freeze({ tokenId: expected.tokenId, instant: release.recordedAt,
      blockNumber: pinned.blockNumber, blockHash: pinned.blockHash, recordedAt: pinned.recordedAt }),
    current: { ...current, resolution: { ...current.resolution, entry: laterV3.entry } }, interpretation: 'CURRENT_HISTORY_DIFFERS_ORIGINAL_RELEASE_PRESERVED',
    canExecute: false,
    notes: Object.freeze([
      'Original release used the v2 commitment known then; later admission is not evidence that v3 existed then.',
      'The current historical interpretation may be v3. It does not rewrite the original release or revive a detached leg.',
      'Occurrence and execution evidence must be independently verified by the existing control adapter; this report grants no authority.',
      'Protocol finality and contest remain separate from commercial completion. No legal-title conclusion is made.',
    ]),
  });
}

/** Lossless, explicit evidence serialization; never persists credentials or signs a transaction. */
export function serialiseHoodiJourney(value: OriginalReleaseRecord | ReleaseHistoryComparison): string {
  return JSON.stringify(value, (_key, item: unknown) =>
    typeof item === 'bigint' ? item.toString() : item, 2) + '\n';
}
export function renderHoodiReleaseHistory(value: ReleaseHistoryComparison): string {
  const original = value.original.observation;
  return [
    'Hoodi — same-asset evidence, not execution authority',
    'Asset: ' + value.original.manifest.contract + ':' + value.query.tokenId,
    'Original release time: ' + original.release.recordedAt,
    'Then-known v2 commitment: ' + original.v2.entry.recordCommitment,
    'Later v3 commitment: ' + value.laterV3.entry.recordCommitment,
    'v3 effectiveAt: ' + value.laterV3.entry.effectiveAt,
    'v3 actually admitted at: ' + value.laterV3.admission.recordedAt,
    'Current historical query instant: ' + value.query.instant,
    'Query block: ' + value.query.blockNumber + ' / ' + value.query.blockHash,
    'Protocol finality: ' + value.current.finality.display,
    'Contest: ' + value.current.contest.display,
    'Original release evidence is preserved, not retroactively replaced.',
    ...value.notes,
  ].join('\n');
}

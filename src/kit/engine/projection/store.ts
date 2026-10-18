import { TokenProjection, validateCandidateShape } from './kernel.ts';
import { reject, ProjectionError } from './errors.ts';
import { ZERO_BYTES32, type Address, type Bytes32, type CandidateEntry, type Instant, type ProjectionEntry, type Settlement, type TokenId } from './types.ts';
import type { ProofMaterial, ProofProfile, ProofProfileRegistry } from '../proof/profile.ts';
import type { RemoteChainAdapter } from '../ports.ts';

export interface AdmissionResult {
  readonly entry: ProjectionEntry;
  readonly gapClosed: boolean;
  readonly remoteHeight: bigint;
}

export interface StoreOptions {
  /** bytes32, as `registerId()` returns. */
  readonly registerId: Bytes32;
  /** bytes32, as `verificationProfile()` returns. */
  readonly verificationProfile: Bytes32;
  readonly profiles: ProofProfileRegistry;
  readonly adapter: RemoteChainAdapter;
}

/**
 * One register's projections: the per-token append-only histories, the gap
 * records beside them, and the admission path that writes to both.
 *
 * Reads never mutate. Admission is the only writer, and it is atomic: proof
 * verification, entry admission, remote-height advancement and gap closure
 * either all happen or none do.
 */
export class ProjectionStore {
  readonly #projections = new Map<string, TokenProjection>();
  readonly #openGaps = new Map<string, Bytes32>();
  readonly #settlements = new Map<Bytes32, Settlement>();
  readonly #options: StoreOptions;
  readonly #profile: ProofProfile;

  constructor(options: StoreOptions) {
    const profile = options.profiles.get(options.verificationProfile);
    if (profile === undefined) throw new Error('configured verification profile is not registered');
    this.#options = Object.freeze({ ...options });
    this.#profile = profile;
  }

  get registerId(): Bytes32 {
    return this.#options.registerId;
  }

  get verificationProfile(): Bytes32 {
    return this.#options.verificationProfile;
  }

  tokens(): readonly TokenId[] {
    return [...this.#projections.keys()].map((key) => BigInt(key)).sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
  }

  entryCount(tokenId: TokenId): number {
    return this.#projections.get(key(tokenId))?.length ?? 0;
  }

  /** By version, as the interface specifies. Reverts for an unknown version. */
  entryAt(tokenId: TokenId, version: bigint): ProjectionEntry {
    return this.#require(tokenId).entryAt(version);
  }

  currentEntry(tokenId: TokenId): ProjectionEntry {
    return this.#require(tokenId).currentEntry();
  }

  entries(tokenId: TokenId): readonly ProjectionEntry[] {
    return this.#projections.get(key(tokenId))?.entries() ?? [];
  }

  entryAsOf(tokenId: TokenId, instant: Instant): ProjectionEntry {
    return this.#require(tokenId).entryAsOf(instant);
  }

  holderAsOf(tokenId: TokenId, instant: Instant): Address {
    return this.#require(tokenId).holderAsOf(instant);
  }

  /** Never reverts. An uncovered instant is not final; it is not an error. */
  isFinalAsOf(tokenId: TokenId, instant: Instant): boolean {
    return this.#projections.get(key(tokenId))?.isFinalAsOf(instant) ?? false;
  }

  /** The open settlement id for a token, or the zero word if none is open. */
  openGapOf(tokenId: TokenId): Bytes32 {
    return this.#openGaps.get(key(tokenId)) ?? ZERO_BYTES32;
  }

  /** Every settlement recorded for a token, open or closed, oldest first. */
  settlementsFor(tokenId: TokenId): readonly Settlement[] {
    return [...this.#settlements.values()]
      .filter((record) => record.tokenId === tokenId)
      .sort((a, b) => (a.openedAt < b.openedAt ? -1 : a.openedAt > b.openedAt ? 1 : 0));
  }

  /** Internal workflow existence query; an absent record is not a settlement. */
  hasSettlement(settlementId: Bytes32): boolean {
    return this.#settlements.has(settlementId);
  }

  settlement(settlementId: Bytes32): Settlement {
    const record = this.#settlements.get(settlementId);
    if (record === undefined) {
      return reject('NO_OPEN_GAP', `settlement ${settlementId} does not exist`);
    }
    return record;
  }

  /**
   * Record an open gap, superseding the previous one. At most one per token.
   *
   * Opening a gap does not touch the projection and does not block any
   * transfer. The settlement workflow that drives this is Stage 4; the record
   * lives here because admission has to be able to close it atomically.
   */
  openGap(tokenId: TokenId, gap: Omit<Settlement, 'status' | 'tokenId'>): Settlement {
    const record: Settlement = Object.freeze({ ...gap, tokenId, status: 'OPEN' });
    if (this.#settlements.has(record.settlementId)) {
      reject('SETTLEMENT_EXISTS', `settlement ${record.settlementId} already exists`);
    }
    const previousId = this.#openGaps.get(key(tokenId));
    const superseded: Settlement | undefined = previousId === undefined
      ? undefined : Object.freeze({ ...this.settlement(previousId), status: 'SUPERSEDED' });

    // All caller validation and record construction precede this synchronous
    // commit. Preserve the old record; replacement admits no entry, consumes
    // no proof and advances no remote height.
    if (superseded !== undefined) this.#settlements.set(superseded.settlementId, superseded);
    this.#settlements.set(record.settlementId, record);
    this.#openGaps.set(key(tokenId), record.settlementId);
    return record;
  }

  /**
   * Close an open gap without admitting anything.
   *
   * This settles nothing. The projection is unchanged and every instant that
   * was provisional stays provisional.
   */
  cancelGap(tokenId: TokenId): Settlement {
    const settlementId = this.#openGaps.get(key(tokenId));
    if (settlementId === undefined) {
      return reject('NO_OPEN_GAP', `token ${tokenId} has no open gap`);
    }
    const cancelled: Settlement = Object.freeze({ ...this.settlement(settlementId), status: 'CANCELLED' });
    this.#openGaps.delete(key(tokenId));
    this.#settlements.set(settlementId, cancelled);
    return cancelled;
  }

  /**
   * Admit a candidate entry.
   *
   * Order matters. Everything that can refuse runs before anything mutates:
   * the profile must exist, the remote height must be finalized and must not
   * go backwards, the proof must verify, and the candidate must satisfy every
   * append-only invariant. Only then are the entry, the height and the gap
   * written, and none of those three can fail.
   */
  admit(tokenId: TokenId, candidate: CandidateEntry, material: ProofMaterial): AdmissionResult {
    validateCandidateShape(candidate);
    const profile = this.#resolveProfile(material.profile);
    const adapter = this.#options.adapter;
    const acceptedRemoteHeight = adapter.acceptedHeight(tokenId);

    if (!adapter.isFinalized(material.remoteHeight)) {
      reject('PROOF_PROFILE_REJECTED', `remote height ${material.remoteHeight} is not finalized`);
    }
    if (material.remoteHeight <= acceptedRemoteHeight) {
      reject(
        'PROOF_PROFILE_REJECTED',
        `remote height must exceed the accepted height ${acceptedRemoteHeight}`,
      );
    }

    const openId = this.#openGaps.get(key(tokenId));
    const projection = this.#projections.get(key(tokenId));
    const priorCommitment = projection?.length ? projection.currentEntry().recordCommitment : candidate.previousCommitment;

    const verdict = profile.verify(material, {
      binding: {
        chainId: adapter.chainId,
        contract: adapter.contract,
        tokenId,
        settlementId: openId ?? ZERO_BYTES32,
        snapshotHash: openId === undefined ? ZERO_BYTES32 : this.settlement(openId).snapshotHash,
        holder: candidate.holder,
        priorCommitment,
        nextCommitment: candidate.recordCommitment,
        version: candidate.version,
        effectiveAt: candidate.effectiveAt,
      },
      candidate,
      acceptedRemoteHeight,
      remoteFinalized: true,
    });

    if (!verdict.admitted) {
      reject('PROOF_PROFILE_REJECTED', verdict.reason);
    }

    // Past this line nothing refuses: the kernel validates before it appends,
    // so a rejected candidate leaves the height and the gap untouched.
    const target = this.#projections.get(key(tokenId)) ?? new TokenProjection();
    const entry = target.admit(candidate);
    this.#projections.set(key(tokenId), target);
    adapter.advanceHeight(tokenId, material.remoteHeight);

    let gapClosed = false;
    if (openId !== undefined) {
      this.#openGaps.delete(key(tokenId));
      this.#settlements.set(openId, Object.freeze({ ...this.settlement(openId), status: 'ADMITTED' }));
      gapClosed = true;
    }

    return { entry, gapClosed, remoteHeight: material.remoteHeight };
  }

  #resolveProfile(id: string): ProofProfile {
    if (id !== this.#profile.id) {
      return reject('PROOF_PROFILE_REJECTED', `proof profile does not match the configured verifier: ${id}`);
    }
    return this.#profile;
  }

  #require(tokenId: TokenId): TokenProjection {
    const projection = this.#projections.get(key(tokenId));
    if (projection === undefined) {
      return reject('UNKNOWN_TOKEN', `no projection for token ${tokenId}`);
    }
    return projection;
  }
}

const key = (tokenId: TokenId): string => tokenId.toString();

export { ProjectionError };

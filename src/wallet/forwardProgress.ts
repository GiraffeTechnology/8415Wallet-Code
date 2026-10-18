import { buildLinkedChainView } from './linkedChainView.ts';
import type { LinkedChainSnapshot, LinkedCompletionEvidence } from '../sdk/linked.ts';

/** Server-side privacy projection. Source authentication and own-occurrence binding
 * must be supplied by the existing trusted reader/session, never by browser JSON.
 * This strips all preceding/subsequent parties before a frontend/API response.
 */
export function buildForwardProgress(snapshot: LinkedChainSnapshot, evidence: LinkedCompletionEvidence, ownOccurrenceId: string) {
  const view = buildLinkedChainView(snapshot, evidence);
  const offset = snapshot.offChainDetached ?? 0n;
  if (typeof offset !== 'bigint' || offset < 0n || offset >= 1n << 256n ||
      offset > 0n && (!/^0x[0-9a-f]{64}$/.test(snapshot.detachedCommitment ?? '') || /^0x0+$/.test(snapshot.detachedCommitment ?? '')))
    throw Error('PENDING_PROGRESS_SOURCE_REFUSED');
  const ids = [snapshot.initialOccurrenceId, ...snapshot.legs.map(leg => leg.buyerOccurrenceId)];
  const ownIndex = ids.indexOf(ownOccurrenceId as typeof snapshot.initialOccurrenceId);
  if (ownIndex < 0) throw Error('PENDING_OWN_OCCURRENCE_NOT_IN_SNAPSHOT');
  const userPosition = offset + BigInt(ownIndex), knownEnd = offset + BigInt(snapshot.legs.length);
  const denominator = knownEnd + 1n; // One explicitly untraded white tail; never crop at the user.
  if (denominator >= 1n << 256n) throw Error('PENDING_PROGRESS_SCALE_REFUSED');
  function position(id: string): bigint {
    const index = ids.indexOf(id as typeof snapshot.initialOccurrenceId);
    if (index < 0) throw Error('PENDING_PROGRESS_SOURCE_REFUSED'); return offset + BigInt(index);
  }
  const owner = evidence.kind === 'bound' ? position(evidence.owner.occurrenceId) : null;
  const holder = evidence.kind === 'bound' ? position(evidence.admittedHolder.occurrenceId) : null;
  const done = owner !== null && holder !== null && owner >= userPosition && holder === userPosition;
  const track = (current: bigint | null) => Object.freeze({
    state: current === null ? 'unavailable' as const : 'observed' as const,
    position: current?.toString() ?? null, changedThrough: current?.toString() ?? null,
    unchangedThrough: knownEnd.toString(), untradedThrough: denominator.toString(),
    ratio: current === null ? null : Object.freeze({ numerator: current.toString(), denominator: denominator.toString() }),
  });
  return Object.freeze({
    schema: '8415-forward-progress/1' as const,
    asset: Object.freeze({ chainId: snapshot.asset.chainId.toString(), contract: snapshot.asset.contract, tokenId: snapshot.asset.tokenId.toString() }),
    sequenceId: snapshot.sequenceId, userPosition: userPosition.toString(),
    sourceRevision: snapshot.revision.toString(), blockNumber: snapshot.blockNumber.toString(), blockHash: snapshot.blockHash,
    knownEnd: knownEnd.toString(), scaleEnd: denominator.toString(),
    state: done ? 'DONE' as const : evidence.kind === 'bound' ? 'PENDING' as const : 'UNAVAILABLE' as const,
    owner: track(owner), holder: track(holder),
    // A holder observation alone does not prove financial movement, and this
    // source is not the coordinated rollback execution/financial verifier.
    funds: Object.freeze({ state: 'not-evaluated' as const }),
    rollback: Object.freeze({ state: 'not-evaluated' as const }),
    protocolFinality: view.protocolFinality, commercialExecution: 'not-evaluated' as const, canExecute: false as const,
  });
}


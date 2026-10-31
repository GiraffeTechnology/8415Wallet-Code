import type { LinkedChainView } from './linkedChainView.ts';

export type LinkedChainTranslate = (template: string, values?: Readonly<Record<string, string>>) => string;
const literal: LinkedChainTranslate = (template, values = {}) => template.replace(/\{([a-z]+)\}/g, (match, key: string) => values[key] ?? match);
const NOTE = 'Read-only snapshot, not obligation completion or recall authorization. The condition/execution control must revalidate atomically and enforce accepted terms. Commercial completion is separate from ERC temporal finality and legal title.';
/** Only fixed first-party templates enter translation. Parameter values remain opaque. */
export function renderLinkedChain(view: LinkedChainView, translate: LinkedChainTranslate = literal): string {
  const lines = [
    translate('Linked responsibility — READ-ONLY SNAPSHOT'),
    translate('Chain {chain}, contract {contract}, token {token}', { chain: String(view.asset.chainId), contract: view.asset.contract, token: String(view.asset.tokenId) }),
    translate('Sequence {sequence}, revision {revision}', { sequence: view.sequenceId, revision: String(view.revision) }),
    translate('Observed block {block} ({hash})', { block: String(view.blockNumber), hash: view.blockHash }),
    translate('Evidence: {evidence}', { evidence: view.evidenceStatus }),
    translate('ERC temporal finality: {finality}', { finality: translate(view.protocolFinality === null ? 'unavailable' : view.protocolFinality ? 'final' : 'provisional') }),
  ];
  for (const leg of view.legs) lines.push(
    translate('Leg {id}: {seller} -> {buyer}', { id: leg.id, seller: leg.seller, buyer: leg.buyer }),
    translate('  Recorded outcome: {outcome}; completion predicate: {predicate}', { outcome: leg.outcome, predicate: String(leg.completionPredicate) }),
    translate('  Control: {control}; acceptance: {acceptance}', { control: leg.control.controlId, acceptance: leg.control.acceptanceHash }),
  );
  lines.push(
    translate('Detached history in this snapshot: {count}', { count: String(view.detachedLegIds.length) }),
    ...(view.offChainDetached > 0n ? [translate('Detached and held off chain: {count} (records at the register; commitment {commitment})', { count: String(view.offChainDetached), commitment: String(view.detachedCommitment) })] : []),
    translate('Predicate-satisfying prefix (not executed): {count}', { count: String(view.completionPrefix.length) }),
    translate('Return boundary: {account} (occurrence {occurrence})', { account: view.returnBoundary.account, occurrence: view.returnBoundary.occurrenceId }),
    view.note === NOTE ? translate(NOTE) : view.note,
  );
  return lines.join('\n');
}

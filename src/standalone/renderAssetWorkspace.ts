import type { RendererMessageFormatter } from '../wallet/renderMessages.ts';
import type { AssetWorkspace, WorkspaceSection } from './assetWorkspace.ts';
import { renderAssetView } from '../wallet/renderAssetView.ts';
import { renderTemporalQuery } from '../wallet/renderTemporalQuery.ts';
import { renderOwnershipHistory } from '../wallet/renderHolderViews.ts';
import { renderSettlementLog } from '../wallet/renderGapView.ts';

export type WorkspaceTab = 'asset' | 'temporal' | 'register-history' | 'dual-history';
function renderSection<T>(value: WorkspaceSection<T>, render: (value: T) => string, translate: (text: string) => string): string {
  return value.state === 'ready' ? render(value.value)
    : value.state === 'not-requested' ? translate('NOT REQUESTED — no absence claim is made.')
    : translate('UNAVAILABLE — ') + value.reason + translate('; no cached or empty-success substitute.');
}
export function renderAssetWorkspace(view: AssetWorkspace, tab: WorkspaceTab, translate: (text: string) => string = text => text, nativeFormat?: RendererMessageFormatter): string {
  const lines = [
    translate('Asset workspace — READ ONLY, not transaction authority'),
    translate('Chain ') + view.source.chainId + ' / ' + view.source.contract + ':' + view.source.tokenId,
    translate('Requested instant: ') + view.instant,
  ];
  if (tab === 'asset') lines.push(renderSection(view.asset, value => renderAssetView(value, undefined, nativeFormat), translate));
  else if (tab === 'temporal') lines.push(renderSection(view.temporal, value => renderTemporalQuery(value, undefined, nativeFormat), translate));
  else if (tab === 'register-history') lines.push(renderSection(view.registerHistory, page => [
    translate('Register history — admission order, not a sorted or filtered history'),
    translate('Versions from ') + page.startVersion + translate(' / total ') + page.totalEntries,
    ...page.entries.map(entry => [
      'v' + entry.version + translate(' holder ') + entry.holder,
      'effectiveAt ' + entry.effectiveAt + ' / supersededAt ' + entry.supersededAt,
      translate('commitment ') + entry.recordCommitment,
      translate('previous ') + entry.previousCommitment,
      translate('opaque registry reference ') + entry.registryReference,
    ].join('\n')),
    page.nextVersion === null ? translate('End of this observed entry count.') : translate('Next admission version: ') + page.nextVersion,
    page.readSemantics,
  ].join('\n\n'), translate));
  else if (tab === 'dual-history') lines.push(
    renderSection(view.ownershipHistory, value => renderOwnershipHistory(value, undefined, nativeFormat), translate),
    renderSection(view.settlementLog, value => renderSettlementLog(value, undefined, nativeFormat), translate),
  );
  else throw new Error('WORKSPACE_TAB_REFUSED');
  // Only known SDK-owned disclosures enter translation; arbitrary notes stay opaque.
  const knownNotes = new Set(['Standalone and linked observations keep their own read semantics; this workspace is not an atomic execution snapshot.', 'Unknown or unavailable sections are not empty successful histories. No owner/holder, freshness/finality or legal-title substitution.']);
  lines.push(...view.notes.map(note => knownNotes.has(note) ? translate(note) : note));
  return lines.join('\n\n');
}

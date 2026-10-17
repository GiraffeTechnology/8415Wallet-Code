import type { AssetWorkspace, WorkspaceSection } from './assetWorkspace.ts';
import { renderAssetView } from './renderAssetView.ts';
import { renderTemporalQuery } from './renderTemporalQuery.ts';
import { renderOwnershipHistory } from './renderHolderViews.ts';
import { renderSettlementLog } from './renderGapView.ts';
import { renderLinkedChain } from './renderLinkedChain.ts';

export type WorkspaceTab = 'asset' | 'temporal' | 'register-history' | 'dual-history' | 'responsibility' | 'payments';
function renderSection<T>(value: WorkspaceSection<T>, render: (value: T) => string): string {
  return value.state === 'ready' ? render(value.value)
    : value.state === 'not-requested' ? 'NOT REQUESTED — no absence claim is made.'
    : 'UNAVAILABLE — ' + value.reason + '; no cached or empty-success substitute.';
}
export function renderAssetWorkspace(view: AssetWorkspace, tab: WorkspaceTab): string {
  const lines = [
    'Asset workspace — READ ONLY, not transaction authority',
    'Chain ' + view.source.chainId + ' / ' + view.source.contract + ':' + view.source.tokenId,
    'Requested instant: ' + view.instant,
  ];
  if (tab === 'asset') lines.push(renderSection(view.asset, renderAssetView));
  else if (tab === 'temporal') lines.push(renderSection(view.temporal, renderTemporalQuery));
  else if (tab === 'register-history') lines.push(renderSection(view.registerHistory, page => [
    'Register history — admission order, not a sorted or filtered history',
    'Versions from ' + page.startVersion + ' / total ' + page.totalEntries,
    ...page.entries.map(entry => [
      'v' + entry.version + ' holder ' + entry.holder,
      'effectiveAt ' + entry.effectiveAt + ' / supersededAt ' + entry.supersededAt,
      'commitment ' + entry.recordCommitment,
      'previous ' + entry.previousCommitment,
      'opaque registry reference ' + entry.registryReference,
    ].join('\n')),
    page.nextVersion === null ? 'End of this observed entry count.' : 'Next admission version: ' + page.nextVersion,
    page.readSemantics,
  ].join('\n\n')));
  else if (tab === 'dual-history') lines.push(
    renderSection(view.ownershipHistory, renderOwnershipHistory),
    renderSection(view.settlementLog, renderSettlementLog),
  );
  else if (tab === 'responsibility') lines.push(renderSection(view.linked, renderLinkedChain));
  else if (tab === 'payments') {
    lines.push(view.paymentMode === 'not-configured'
      ? 'No payment adapter configured. Responsibility does not require escrow or payment.'
      : 'Optional native-payment records — separate from responsibility and protocol finality.');
    if (view.paymentMode === 'configured' && view.linked.state !== 'ready') {
      lines.push('Payment read unavailable: no bound responsibility snapshot to associate with.');
    }
    for (const row of view.payments) lines.push('Leg ' + row.legId + '\n' + renderSection(row.result,
      payment => 'State ' + payment.state + '\nPayer ' + payment.payer + '\nPayee ' + payment.payee +
        '\nAmount (base units) ' + payment.amount));
  }
  else throw new Error('WORKSPACE_TAB_REFUSED');
  lines.push(...view.notes);
  return lines.join('\n\n');
}

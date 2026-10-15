import { detectConformance, requireProjectionConformance } from '../sdk/conformance.ts';
import { ContractRevertError, ProjectionNotInitialized, TransportError } from '../sdk/errors.ts';
import type { LinkedControlReader } from '../sdk/linked.ts';
import type { RegisterEntry } from '../sdk/types.ts';
import type { PaymentSnapshot } from '../controls/payments.ts';
import type { WalletSession } from './session.ts';
import type { AssetView } from './assetView.ts';
import type { TemporalView } from './temporalQuery.ts';
import type { OwnershipHistoryView } from './ownershipHistory.ts';
import type { SettlementLogView } from './settlementLog.ts';
import { buildLinkedChainView, type LinkedChainView } from './linkedChainView.ts';

export type WorkspaceSection<T> =
  | { readonly state: 'ready'; readonly value: T }
  | { readonly state: 'unavailable'; readonly reason: 'transport' | 'contract-revert' | 'uninitialized' | 'invalid-or-unsupported' }
  | { readonly state: 'not-requested' };
export type RegisterHistoryPage = {
  readonly tokenId: bigint;
  readonly totalEntries: bigint;
  readonly startVersion: bigint;
  readonly nextVersion: bigint | null;
  readonly entries: readonly RegisterEntry[];
  readonly order: 'admission-order';
  readonly readSemantics: 'display-read-not-atomic-execution';
};
export type WorkspaceLinkedInput = {
  readonly sequenceId: string;
  readonly reader: LinkedControlReader;
  readBlockHash(blockNumber: bigint): Promise<string>;
  /** A readAt-only seam. Never pass an execution method or infer control state from it. */
  readonly payments?: {
    readAt(sequenceId: string, legId: string, blockHash: string): Promise<PaymentSnapshot>;
  };
  /** Optional explicitly selected detached leg IDs; never window-relative positions. */
  readonly detachedPaymentLegIds?: readonly string[];
};
export type AssetWorkspace = {
  readonly source: { readonly chainId: bigint; readonly contract: string; readonly tokenId: bigint };
  readonly instant: bigint;
  readonly asset: WorkspaceSection<AssetView>;
  readonly temporal: WorkspaceSection<TemporalView>;
  readonly registerHistory: WorkspaceSection<RegisterHistoryPage>;
  readonly ownershipHistory: WorkspaceSection<OwnershipHistoryView>;
  readonly settlementLog: WorkspaceSection<SettlementLogView>;
  readonly linked: WorkspaceSection<LinkedChainView>;
  readonly paymentMode: 'not-configured' | 'configured';
  readonly payments: readonly { readonly legId: string; readonly result: WorkspaceSection<PaymentSnapshot> }[];
  readonly canExecute: false;
  readonly notes: readonly string[];
};
const hash = (value: string) => /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value);
function requireWorkspace(ok: boolean): asserts ok {
  if (!ok) throw new Error('WORKSPACE_INPUT_REFUSED');
}
async function section<T>(read: () => Promise<T>): Promise<WorkspaceSection<T>> {
  try { return { state: 'ready', value: await read() }; }
  catch (error) {
    return { state: 'unavailable', reason: error instanceof TransportError ? 'transport'
      : error instanceof ContractRevertError ? 'contract-revert'
      : error instanceof ProjectionNotInitialized ? 'uninitialized' : 'invalid-or-unsupported' };
  }
}

/** Bounded navigation of the existing append-only register; no sorting/filtering or holder inference. */
export async function readRegisterHistoryPage(
  wallet: WalletSession, tokenId: bigint, startVersion = 1n, limit = 16,
): Promise<RegisterHistoryPage> {
  requireWorkspace(typeof tokenId === 'bigint' && tokenId >= 0n &&
    typeof startVersion === 'bigint' && startVersion >= 1n &&
    Number.isSafeInteger(limit) && limit >= 1 && limit <= 64);
  const reader = wallet.reader;
  const conformance = await detectConformance(reader);
  requireProjectionConformance(reader, conformance);
  await wallet.identity.read(conformance);
  const count = await reader.entryCount(tokenId);
  requireWorkspace(typeof count === 'bigint' && count >= 0n && count < (1n << 64n));
  if (count === 0n) throw new ProjectionNotInitialized(tokenId);
  requireWorkspace(startVersion <= count);
  const entries: RegisterEntry[] = [];
  const end = startVersion + BigInt(limit) - 1n < count
    ? startVersion + BigInt(limit) - 1n : count;
  for (let version = startVersion; version <= end; version++) {
    const entry = await reader.entryAt(tokenId, version);
    requireWorkspace(entry.version === version);
    entries.push({ recordCommitment: entry.recordCommitment,
      previousCommitment: entry.previousCommitment, registryReference: entry.registryReference,
      holder: entry.holder, version: entry.version, effectiveAt: entry.effectiveAt,
      supersededAt: entry.supersededAt });
  }
  await wallet.identity.read(conformance);
  return { tokenId, totalEntries: count, startVersion,
    nextVersion: end < count ? end + 1n : null, entries,
    order: 'admission-order', readSemantics: 'display-read-not-atomic-execution' };
}

/**
 * One consumer workspace over existing standalone and linked read surfaces.
 * Per-section failures remain explicit; no fallback value, optimistic completion or action.
 * Callers must enforce verified login before starting and before publishing any result.
 */
export async function readAssetWorkspace(
  wallet: WalletSession, tokenId: bigint, instant: bigint,
  options: { readonly historyStart?: bigint; readonly historyLimit?: number;
    readonly includeLogs?: boolean; readonly linked?: WorkspaceLinkedInput } = {},
): Promise<AssetWorkspace> {
  requireWorkspace(typeof tokenId === 'bigint' && tokenId >= 0n &&
    typeof instant === 'bigint' && instant >= 0n && instant < (1n << 64n));
  const source = { chainId: wallet.reader.source.chainId,
    contract: wallet.reader.source.address, tokenId };
  const sameSource = () => wallet.reader.source.chainId === source.chainId &&
    wallet.reader.source.address.toLowerCase() === source.contract.toLowerCase();
  const asset = await section(() => wallet.assetView(tokenId));
  const temporal = await section(() => wallet.temporalQuery(tokenId, instant));
  const registerHistory = await section(() => readRegisterHistoryPage(wallet, tokenId,
    options.historyStart ?? 1n, options.historyLimit ?? 16));
  let ownershipHistory: WorkspaceSection<OwnershipHistoryView> = { state: 'not-requested' };
  let settlementLog: WorkspaceSection<SettlementLogView> = { state: 'not-requested' };
  // Existing full dual-history walks are deliberately opt-in and bounded by entry count.
  if (options.includeLogs) {
    const count = await section(() => wallet.reader.entryCount(tokenId));
    if (count.state === 'ready' && typeof count.value === 'bigint' && count.value >= 0n && count.value <= 512n) {
      ownershipHistory = await section(() => wallet.ownershipHistory(tokenId));
      settlementLog = await section(() => wallet.settlementLog(tokenId));
    } else {
      ownershipHistory = { state: 'unavailable', reason: 'invalid-or-unsupported' };
      settlementLog = { state: 'unavailable', reason: 'invalid-or-unsupported' };
    }
  }
  let linked: WorkspaceSection<LinkedChainView> = { state: 'not-requested' };
  const payments: { legId: string; result: WorkspaceSection<PaymentSnapshot> }[] = [];
  if (options.linked) {
    const input = options.linked;
    linked = await section(async () => {
      requireWorkspace(hash(input.sequenceId));
      const observed = await input.reader.observe(input.sequenceId);
      requireWorkspace(observed.snapshot.sequenceId === input.sequenceId &&
        observed.snapshot.asset.chainId === source.chainId &&
        observed.snapshot.asset.contract.toLowerCase() === source.contract.toLowerCase() &&
        observed.snapshot.asset.tokenId === tokenId);
      // A window with off-chain history remains distinct from a never-detached chain.
      const detached = observed.snapshot.offChainDetached ?? 0n;
      requireWorkspace(typeof detached === 'bigint' && detached >= 0n &&
        detached < (1n << 256n) && (detached === 0n || hash(observed.snapshot.detachedCommitment ?? '')));
      requireWorkspace(await input.readBlockHash(observed.snapshot.blockNumber) === observed.snapshot.blockHash);
      return buildLinkedChainView(observed.snapshot, observed.evidence);
    });
    if (input.payments && linked.state === 'ready') {
      const detachedIds = input.detachedPaymentLegIds ?? [];
      requireWorkspace(detachedIds.length <= 128 && detachedIds.every(hash));
      const ids = [...new Set([...linked.value.legs.map(leg => leg.id), ...detachedIds])];
      requireWorkspace(ids.length <= 256);
      for (const legId of ids) {
        const blockHash = linked.value.blockHash;
        payments.push({ legId, result: await section(async () => {
          const result = await input.payments!.readAt(input.sequenceId, legId, blockHash);
          requireWorkspace(result.sequenceId === input.sequenceId && result.legId === legId &&
            typeof result.amount === 'bigint' && result.amount >= 0n && result.amount < (1n << 256n) &&
            /^0x[0-9a-f]{40}$/.test(result.payer) && /^0x[0-9a-f]{40}$/.test(result.payee) &&
            ['unfunded', 'funded', 'settlement-due', 'refund-due', 'settled', 'refunded', 'reserved'].includes(result.state));
          return result;
        }) });
      }
    }
  }
  if (options.linked && linked.state === 'ready') {
    requireWorkspace(await options.linked.readBlockHash(linked.value.blockNumber) === linked.value.blockHash);
  }
  requireWorkspace(sameSource());
  return {
    source, instant, asset, temporal, registerHistory, ownershipHistory, settlementLog, linked,
    paymentMode: options.linked?.payments ? 'configured' : 'not-configured', payments, canExecute: false,
    notes: [
      'Standalone and linked observations keep their own read semantics; this workspace is not an atomic execution snapshot.',
      'No payment adapter is required for responsibility. Payment success/failure never changes a control outcome here.',
      'A completion predicate is not executed completion. Detached history and return boundaries come from the control.',
      'Unknown or unavailable sections are not empty successful histories. No owner/holder, freshness/finality or legal-title substitution.',
    ],
  };
}

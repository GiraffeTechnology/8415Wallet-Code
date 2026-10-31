import { detectConformance, requireProjectionConformance } from '../sdk/conformance.ts';
import { ContractRevertError, ProjectionNotInitialized, TransportError } from '../sdk/errors.ts';
import type { RegisterEntry } from '../sdk/types.ts';
import type { WalletSession } from '../wallet/session.ts';
import type { AssetView } from '../wallet/assetView.ts';
import type { TemporalView } from '../wallet/temporalQuery.ts';
import type { OwnershipHistoryView } from '../wallet/ownershipHistory.ts';
import type { SettlementLogView } from '../wallet/settlementLog.ts';

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
export type AssetWorkspace = {
  readonly source: { readonly chainId: bigint; readonly contract: string; readonly tokenId: bigint };
  readonly instant: bigint;
  readonly asset: WorkspaceSection<AssetView>;
  readonly temporal: WorkspaceSection<TemporalView>;
  readonly registerHistory: WorkspaceSection<RegisterHistoryPage>;
  readonly ownershipHistory: WorkspaceSection<OwnershipHistoryView>;
  readonly settlementLog: WorkspaceSection<SettlementLogView>;
  readonly linked: { readonly state: 'not-requested' };
  readonly paymentMode: 'not-configured' | 'configured';
  readonly payments: readonly never[];
  readonly canExecute: false;
  readonly notes: readonly string[];
};
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

/**
 * Work limits for one interactive page, not protocol or chain-lifetime limits.
 * They are exported and refused by name so a caller is told which bound it met.
 */
export const REGISTER_HISTORY_DEFAULT_LIMIT = 16;
export const REGISTER_HISTORY_MAX_LIMIT = 64;

/** Bounded navigation of the existing append-only register; no sorting/filtering or holder inference. */
export async function readRegisterHistoryPage(
  wallet: WalletSession, tokenId: bigint, startVersion = 1n,
  limit = REGISTER_HISTORY_DEFAULT_LIMIT,
): Promise<RegisterHistoryPage> {
  // The page size is its own refusal: it is the one input here a caller can
  // reasonably retry smaller, and a shared code left it indistinguishable from
  // a malformed token id.
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > REGISTER_HISTORY_MAX_LIMIT) {
    throw new Error(
      `WORKSPACE_PAGE_LIMIT_REFUSED: 1 to ${REGISTER_HISTORY_MAX_LIMIT} entries per page, asked ${limit}`,
    );
  }
  requireWorkspace(typeof tokenId === 'bigint' && tokenId >= 0n &&
    typeof startVersion === 'bigint' && startVersion >= 1n);
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
    readonly includeLogs?: boolean; readonly linked?: never } = {},
): Promise<AssetWorkspace> {
  requireWorkspace(options.linked === undefined);
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
  const linked = { state: 'not-requested' } as const;
  const payments: never[] = [];
  requireWorkspace(sameSource());
  return {
    source, instant, asset, temporal, registerHistory, ownershipHistory, settlementLog, linked,
    paymentMode: 'not-configured', payments, canExecute: false,
    notes: [
      'Standalone and linked observations keep their own read semantics; this workspace is not an atomic execution snapshot.',
      'Unknown or unavailable sections are not empty successful histories. No owner/holder, freshness/finality or legal-title substitution.',
    ],
  };
}

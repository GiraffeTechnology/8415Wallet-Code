/** Additive browser entry, no filesystem store or automatically connecting transport. */
export * from './controls/index.ts';
export { WalletSession } from './wallet/session.ts';
export { RpcErc8415Reader } from './adapters/rpc/rpcReader.ts';
export { Eip1193ReadTransport } from './adapters/signing/eip1193ReadTransport.ts';
export { renderAssetView } from './wallet/renderAssetView.ts';
export { renderTemporalQuery, renderHistory } from './wallet/renderTemporalQuery.ts';
export { renderRiskSurfaces, renderSettlementLog } from './wallet/renderGapView.ts';
export { renderRegistration, renderAcquisitionDisclosure, renderOwnershipHistory, renderPosture } from './wallet/renderHolderViews.ts';
export { verifyControlDeployment, controlRpc } from './controls/authorization.ts';
export { renderCollisions } from './wallet/renderHolderViews.ts';
export { CollisionScanError } from './wallet/collisions.ts';
export { reviewAgentRequest, XIONGAN_PROFILE } from './xiongan/agentRequest.ts';
export { recoveryGuidance } from './xiongan/recoveryView.ts';
export { ExternalAssetSession, ASSET_CHAINS, parseAssetState, formatWeiAsEth, formatTokenUnits } from './xiongan/externalAssets.ts';

export { StandaloneSettlementSession, parseSettlementState, serializeSettlementState } from './wallet/standaloneSettlement.ts';
export { isAddressInput } from './xiongan/address.ts';
export { TransactionWouldRevertError } from './sdk/transactions.ts';
export { LegacyClearingSession, parseLegacyClearingState, parseLegacyClearingDeployment, legacyTradeKey, CLEARING_NOTES } from './wallet/legacyClearingSession.ts';
export type { Erc20Balance, Erc20Metadata, AssetReview, AssetState, AssetStore, AssetTransaction, AssetReceipt } from './xiongan/externalAssets.ts';
export * from './agent/taskContract.ts';
export { assetBoundedTaskFees, committedFeeWei, AssetBudgetError } from './agent/assetBudget.ts';
export type { AssetBoundedFees } from './agent/assetBudget.ts';
export * from './agent/receiptObservation.ts';

export { ReceiptTaskError, freezeReceiptTask, receiptPhaseScope, normalizeReceiptAttempts } from './agent/receiptTask.ts';
export type { FrozenReceiptTask, ReceiptPhase } from './agent/receiptTask.ts';

export { captureHoodiRelease, compareHoodiReleaseHistory, renderHoodiReleaseHistory,
  serialiseHoodiJourney, HOODI_JOURNEY_CHAIN, HOODI_JOURNEY_GENESIS } from './wallet/hoodiJourney.ts';
export { openHoodiJourneyRead } from './wallet/hoodiJourneyProvider.ts';

export { readAssetWorkspace, readRegisterHistoryPage } from './wallet/assetWorkspace.ts';
export { renderAssetWorkspace } from './wallet/renderAssetWorkspace.ts';

// Optional read-only watchtower presentation; never projection finality or transaction authority.
export { RpcWatchtowerReader } from './adapters/rpc/watchtowerRpcReader.ts';
export { buildFreshnessView } from './wallet/freshness.ts';
export { renderFreshness } from './wallet/renderFreshness.ts';


// Optional projection acceleration composed with the selected direct-chain reader.
export { KitProjectionApi } from './adapters/kit/kitApi.ts';
export { KitErc8415Reader } from './adapters/kit/kitReader.ts';


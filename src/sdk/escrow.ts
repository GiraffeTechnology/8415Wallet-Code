import { encodeWords } from '../codec/abi.ts';
import { keccak256 } from '../codec/keccak.ts';
import type { Address, Bytes32, Instant, TokenId, Version } from './types.ts';

/**
 * The read surface of a `ProjectionEscrow` deployment.
 *
 * The escrow is an application built on the projection, not part of the
 * standard, so it sits in its own port rather than being folded into
 * `Erc8415Reader`. Nothing in the projection knows the escrow exists, and
 * nothing here may be mistaken for a protocol fact.
 *
 * As with the projection, the wallet holds no write path: `open`, `fund`,
 * `release`, `refund` and `abandon` are transactions a user's own key sends.
 */

/** Lifecycle of one trade. Mirrors the contract's enum ordering. */
export type TradeState =
  | 'NONE'
  | 'AWAITING_PAYMENT'
  | 'FUNDED'
  | 'RELEASED'
  | 'REFUNDED'
  | 'ABANDONED';

export const TRADE_STATE_BY_INDEX: readonly TradeState[] = [
  'NONE',
  'AWAITING_PAYMENT',
  'FUNDED',
  'RELEASED',
  'REFUNDED',
  'ABANDONED',
];

/** The terms of a trade, as recorded when it was opened and funded. */
export type Trade = {
  readonly projection: Address;
  readonly tokenId: TokenId;
  readonly seller: Address;
  readonly buyer: Address;
  /** In wei. */
  readonly price: bigint;
  /** `entryCount` at the moment the trade was funded; zero before that. */
  readonly entryCountAtFunding: Version;
  readonly admissionDeadline: Instant;
  readonly maxEffectiveAt: Instant;
  readonly state: TradeState;
};

/**
 * One atomic reading of a trade against its register.
 *
 * Every field arrives from a single `observe` call, so the facts cannot be
 * taken from different states. They stay separate values on purpose:
 * `confirmed` is whether the escrow's release condition holds, `confirmedHolder`
 * is who the register records, and `positionHolder` is `ownerOf` — which is the
 * escrow itself while a trade is live, and is never the same fact as the
 * confirmed holder.
 */
export type TradeObservation = {
  readonly state: TradeState;
  /** Whether release would succeed if called now. Not a claim of finality. */
  readonly confirmed: boolean;
  /** Version and effective time of the confirming entry; zero when there is none. */
  readonly version: Version;
  readonly effectiveAt: Instant;
  /** The register's latest holder. Zero when the projection has no entries. */
  readonly confirmedHolder: Address;
  /** `ownerOf`. Zero when the token does not exist. */
  readonly positionHolder: Address;
  readonly entryCount: Version;
};

/** Historical release evidence supplied from a separately verified receipt.
 * Never populate this from the latest observation or a query as of release time:
 * a later admission may change that query. Old event ABIs lack the commitment. */
export type ReleaseConfirmation = {
  readonly version: Version;
  readonly effectiveAt: Instant;
  readonly recordCommitment?: Bytes32;
  /** Canonical receipt/event position, never a timestamp-derived position. */
  readonly position?: EscrowTransactionPosition & { readonly logIndex: bigint };
};

export type EscrowTransactionPosition = {
  readonly blockNumber: bigint;
  readonly blockHash: Bytes32;
  readonly transactionHash: Bytes32;
  readonly transactionIndex: bigint;
};

/** A reverted attempt has no release confirmation. Its prepared version is an
 * old client assumption, not proof of the entry read inside execution. */
export type ReleaseAttemptEvidence = {
  readonly position: EscrowTransactionPosition;
  readonly outcome: 'released' | 'reverted';
  readonly basisVersion: Version;
  readonly basisSource: 'release-event' | 'prepared-observation';
  readonly basisCommitment?: Bytes32;
};

/** Same-block successor event corroborated with both stored entries, the
 * admitting transaction's successful receipt and the pinned runtime identity.
 * This is not an execution trace or a block-end reconstruction of release. */
export type ReleaseSupersessionEvidence = {
  readonly source: 'canonical-receipt-and-entry';
  readonly scope: 'release-block-only';
  readonly position: EscrowTransactionPosition & { readonly logIndex: bigint };
  readonly supersededVersion: Version;
  readonly supersededCommitment: Bytes32;
  readonly successorVersion: Version;
  readonly successorCommitment: Bytes32;
  readonly effectiveAt: Instant;
};

export type ReleaseOrderingEvidence = {
  readonly attempt: ReleaseAttemptEvidence;
  readonly supersession?: ReleaseSupersessionEvidence;
};

/**
 * The key a trade is stored under.
 *
 * One escrow deployment is meant to be shared — a wallet, a marketplace, an
 * OTC desk and an exchange all opening trades against it — and a
 * caller-chosen identifier in one flat namespace does not survive that. Two
 * venues numbering their orders from one collide by accident, and anyone who
 * can guess the next identifier can take it first and make the real party's
 * `open` revert.
 *
 * So the stored key is the opener's address together with their own
 * identifier, and no one can write into anyone else's namespace. `open`
 * returns it and `TradeOpened` carries it; this computes it ahead of time,
 * which is what a venue needs in order to show a trade it has not sent yet.
 */
export function tradeKey(opener: Address, localId: Bytes32): Bytes32 {
  const encoded = encodeWords(['address', 'bytes32'], [opener, localId]).slice(2);
  return `0x${Buffer.from(keccak256(Uint8Array.from(Buffer.from(encoded, 'hex')))).toString('hex')}`;
}

export type EscrowReader = {
  tradeOf(tradeKey: Bytes32): Promise<Trade>;
  observe(tradeKey: Bytes32): Promise<TradeObservation>;
  readonly source: { readonly chainId: bigint; readonly address: Address };
};

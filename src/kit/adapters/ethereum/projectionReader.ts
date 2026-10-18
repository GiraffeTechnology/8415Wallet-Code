import { SELECTOR, decodeEntry, encodeCall, toAddress, toBigInt, toBool, toBytes32, words } from './abi.ts';
import type { JsonRpcTransport } from './transport.ts';
import { EvmChainIdentity } from './chainIdentity.ts';
import type { Address, Bytes32, Instant, ProjectionEntry, TokenId } from '../../engine/projection/types.ts';

export class ConformanceError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ConformanceError';
  }
}

export interface ReaderOptions {
  readonly transport: JsonRpcTransport;
  readonly contract: Address;
  /** Explicit expected EVM chain. Defaults to Ethereum, never the RPC's chain. */
  readonly chainId?: bigint;
  /** Block tag reads are pinned to. Defaults to the finalized head. */
  readonly block?: string;
}

/**
 * Reads a conforming contract through the frozen interfaces.
 *
 * Conformance is discovered, never assumed: `supportsInterface` is asked
 * before any projection data is claimed for a contract, and a contract that
 * advertises the projection identifier but not the settlement one simply has
 * no gaps — that is a property of the contract, not an error.
 *
 * Reads are pinned to a block tag. A read-then-act consumer should be calling
 * the contract inside its own transaction instead; this reader exists for
 * display and indexing, where the standard's own guidance is not to cache an
 * answer across transactions.
 */
export class EthereumProjectionReader {
  readonly #transport: JsonRpcTransport;
  readonly #network: EvmChainIdentity;
  readonly #contract: Address;
  readonly #block: string;

  constructor(options: ReaderOptions) {
    this.#transport = options.transport;
    this.#network = new EvmChainIdentity(options.transport, options.chainId ?? 1n);
    this.#contract = options.contract;
    this.#block = options.block ?? 'finalized';
  }

  get chainId(): bigint {
    return this.#network.chainId;
  }

  supportsProjection(): Promise<boolean> {
    return this.#publishCurrent(() => this.#supports('0x6309e170'));
  }

  supportsSettlement(): Promise<boolean> {
    return this.#publishCurrent(() => this.#supports('0xf4a7d71b'));
  }

  registerId(): Promise<Bytes32> {
    return this.#publishCurrent(async () => toBytes32(await this.#slot(SELECTOR.registerId, [])));
  }

  verificationProfile(): Promise<Bytes32> {
    return this.#publishCurrent(async () => toBytes32(await this.#slot(SELECTOR.verificationProfile, [])));
  }

  entryCount(tokenId: TokenId): Promise<bigint> {
    return this.#publishCurrent(async () => toBigInt(await this.#slot(SELECTOR.entryCount, [tokenId])));
  }

  currentEntry(tokenId: TokenId): Promise<ProjectionEntry> {
    return this.#publishCurrent(async () => decodeEntry(await this.#call(SELECTOR.currentEntry, [tokenId])));
  }

  entryAt(tokenId: TokenId, version: bigint): Promise<ProjectionEntry> {
    return this.#publishCurrent(async () => decodeEntry(await this.#call(SELECTOR.entryAt, [tokenId, version])));
  }

  entryAsOf(tokenId: TokenId, instant: Instant): Promise<ProjectionEntry> {
    return this.#publishCurrent(async () => decodeEntry(await this.#call(SELECTOR.entryAsOf, [tokenId, instant])));
  }

  holderAsOf(tokenId: TokenId, instant: Instant): Promise<Address> {
    return this.#publishCurrent(async () => toAddress(await this.#slot(SELECTOR.holderAsOf, [tokenId, instant])));
  }

  isFinalAsOf(tokenId: TokenId, instant: Instant): Promise<boolean> {
    return this.#publishCurrent(async () => toBool(await this.#slot(SELECTOR.isFinalAsOf, [tokenId, instant])));
  }

  openGapOf(tokenId: TokenId): Promise<Bytes32> {
    return this.#publishCurrent(async () => toBytes32(await this.#slot(SELECTOR.openGapOf, [tokenId])));
  }

  isSettlementAuthority(tokenId: TokenId, account: Address): Promise<boolean> {
    return this.#publishCurrent(async () => toBool(await this.#slot(SELECTOR.isSettlementAuthority, [tokenId, account])));
  }

  /** Public methods return this exact promise, with no outer async adoption. */
  async #publishCurrent<T>(read: () => Promise<T>): Promise<T> {
    // Capture at public invocation, before any provider-bound work starts.
    const revision = this.#network.revision;
    const result = await read();
    // Decoding and every private helper have finished. No await follows this
    // check before the public operation's promise is fulfilled.
    this.#network.assertCurrent(revision);
    return result;
  }

  async #supports(interfaceId: string): Promise<boolean> {
    const padded = `${interfaceId}${'0'.repeat(56)}`;
    return toBool(await this.#slot(SELECTOR.supportsInterface, [padded]));
  }

  async #slot(selector: string, args: readonly (bigint | string)[]): Promise<string> {
    const slots = words(await this.#call(selector, args));
    const first = slots[0];
    if (first === undefined) throw new ConformanceError(`${selector} returned no data`);
    return first;
  }

  async #call(selector: string, args: readonly (bigint | string)[]): Promise<string> {
    const revision = this.#network.revision;
    const result = await this.#network.read(() => this.#transport.send({
      method: 'eth_call',
      params: [{ to: this.#contract, data: encodeCall(selector, args) }, this.#block],
    }));
    this.#network.assertCurrent(revision);
    if (typeof result !== 'string') throw new ConformanceError(`eth_call returned ${typeof result}`);
    return result;
  }
}

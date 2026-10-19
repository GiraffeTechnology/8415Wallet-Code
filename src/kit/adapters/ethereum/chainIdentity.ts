import type { JsonRpcTransport } from './transport.ts';

const providerStates = new WeakMap<JsonRpcTransport, { revision: number }>();

/** A configured EVM identity is an expectation, never an RPC-discovered default. */
export class ChainIdentityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChainIdentityError';
  }
}

/**
 * Verifies both sides of an asynchronous read. An observed mismatch or an
 * unavailable identity invalidates every in-flight read from this instance.
 * This is provider verification, not a declaration of network capabilities.
 */
export class EvmChainIdentity {
  readonly #transport: JsonRpcTransport;
  readonly #expected: bigint;
  readonly #invalidate: () => void;
  readonly #state: { revision: number };

  constructor(transport: JsonRpcTransport, expected: bigint = 1n, invalidate: () => void = () => {}) {
    if (typeof expected !== 'bigint' || expected <= 0n || expected >= (1n << 256n)) {
      throw new ChainIdentityError('expected chain ID must be a positive uint256');
    }
    this.#transport = transport;
    const state = providerStates.get(transport) ?? { revision: 0 };
    providerStates.set(transport, state);
    this.#state = state;
    this.#expected = expected;
    this.#invalidate = invalidate;
  }

  get chainId(): bigint {
    return this.#expected;
  }

  get revision(): number {
    return this.#state.revision;
  }

  /** Revalidate immediately before publishing data after an awaited read. */
  assertCurrent(revision: number): void {
    this.#assertRevision(revision);
  }

  async read<T>(read: () => Promise<T>): Promise<T> {
    const revision = this.#state.revision;
    await this.#verify();
    this.#assertRevision(revision);
    try {
      return await read();
    } finally {
      // Check even when the data read fails: a switch must quarantine cached
      // roots and pending reads, rather than leave the previous provider live.
      await this.#verify();
      this.#assertRevision(revision);
    }
  }

  async #verify(): Promise<void> {
    try {
      const observed = await this.#transport.send({ method: 'eth_chainId', params: [] });
      if (typeof observed !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(observed) || observed.length > 66) {
        throw new ChainIdentityError('eth_chainId returned an invalid EVM chain identity');
      }
      if (BigInt(observed) !== this.#expected) {
        throw new ChainIdentityError(`provider chain ${BigInt(observed)} does not match expected chain ${this.#expected}`);
      }
    } catch (error) {
      this.#state.revision += 1;
      this.#invalidate();
      throw error;
    }
  }

  #assertRevision(revision: number): void {
    if (revision !== this.#state.revision) {
      throw new ChainIdentityError('provider identity changed while the read was in flight');
    }
  }
}

import { ContractRevertError, TransportError } from '../../sdk/errors.ts';
import type { Address } from '../../sdk/types.ts';

/**
 * A minimal transport.
 *
 * `call` raises `ContractRevertError` when the contract reverted, and
 * `TransportError` when the node did not answer. Every other method raises
 * only `TransportError`: a revert is something a contract does, and nothing
 * but `eth_call` executes contract code.
 */
export type CallTransport = {
  /** Actual network identity, when the transport can independently obtain it. */
  getChainId?(): Promise<bigint>;
  call(to: Address, data: string): Promise<string>;
  /** `block.timestamp` of the latest block. */
  blockTimestamp(): Promise<bigint>;
  /** `eth_getLogs`, with the filter passed through as given. */
  getLogs(filter: Record<string, unknown>): Promise<unknown[]>;
  /** `block.timestamp` of one block, by number. */
  blockTimestampAt(blockNumber: bigint): Promise<bigint>;
  /** The latest block number, for bounding a log scan. */
  blockNumber(): Promise<bigint>;
  /** Deployed code at an address, at one block. `0x` where there is none. */
  codeAt(address: Address, blockNumber: bigint): Promise<string>;
};

/**
 * Bind every read to one network when chain discovery is available.
 *
 * Legacy custom/in-memory transports without getChainId remain compatible;
 * their supplied source is not independently verified by this wrapper.
 * Pre/post checks detect observed network changes, not a malicious node or an
 * atomic snapshot: a provider that changes away and back can still evade them.
 */
export function bindChainTransport(transport: CallTransport, expectedChainId: bigint): CallTransport {
  const getChainId = transport.getChainId?.bind(transport);
  if (getChainId === undefined) return transport;

  const checkChainId = async (): Promise<bigint> => {
    let actual: bigint;
    try {
      actual = await getChainId();
    } catch (error) {
      if (error instanceof TransportError) throw error;
      throw new TransportError('eth_chainId', 'could not verify chain identity');
    }
    if (typeof actual !== 'bigint' || actual <= 0n) {
      throw new TransportError('eth_chainId', 'returned an invalid chain id');
    }
    if (actual !== expectedChainId) {
      throw new TransportError('eth_chainId', `chain mismatch: expected ${expectedChainId}, received ${actual}`);
    }
    return actual;
  };
  const checked = async <T>(read: () => Promise<T>): Promise<T> => {
    await checkChainId();
    try {
      return await read();
    } finally {
      // A wrong-chain revert is not evidence of contract non-conformance.
      // Check even when the business request failed, before that error escapes.
      await checkChainId();
    }
  };

  const call = transport.call.bind(transport);
  const blockTimestamp = transport.blockTimestamp.bind(transport);
  const blockTimestampAt = transport.blockTimestampAt.bind(transport);
  const blockNumber = transport.blockNumber.bind(transport);
  const getLogs = transport.getLogs.bind(transport);
  const codeAt = transport.codeAt.bind(transport);
  return Object.freeze({
    getChainId: checkChainId,
    call: (to: Address, data: string) => checked(() => call(to, data)),
    blockTimestamp: () => checked(blockTimestamp),
    blockTimestampAt: (block: bigint) => checked(() => blockTimestampAt(block)),
    blockNumber: () => checked(blockNumber),
    getLogs: (filter: Record<string, unknown>) => checked(() => getLogs(filter)),
    codeAt: (address: Address, block: bigint) => checked(() => codeAt(address, block)),
  });
}

/**
 * JSON-RPC transport over HTTP.
 *
 * Calls are made at `latest`. The wallet does not pin a historical block: an
 * ERC-8415 question is asked with an `instant` argument against current state,
 * not by rewinding the chain, and answering it from an old block would report
 * what the projection used to say rather than what it says about that instant.
 */
export class HttpCallTransport implements CallTransport {
  readonly #endpoint: string;
  #nextId = 1;

  constructor(endpoint: string) {
    this.#endpoint = endpoint;
  }

  async getChainId(): Promise<bigint> {
    const result = await this.#request('eth_chainId', []);
    if (typeof result !== 'string' || !/^0x[1-9a-fA-F][0-9a-fA-F]*$/.test(result)) {
      throw new TransportError('eth_chainId', 'returned an invalid positive chain id quantity');
    }
    return BigInt(result);
  }

  async call(to: Address, data: string): Promise<string> {
    const result = await this.#request('eth_call', [{ to, data }, 'latest']);
    if (typeof result !== 'string') {
      throw new Error('eth_call returned no result');
    }
    return result;
  }

  async blockTimestamp(): Promise<bigint> {
    const block = await this.#request('eth_getBlockByNumber', ['latest', false]);
    const timestamp = (block as { timestamp?: string } | null)?.timestamp;
    if (typeof timestamp !== 'string') {
      throw new Error('eth_getBlockByNumber returned no timestamp');
    }
    return BigInt(timestamp);
  }

  async blockTimestampAt(blockNumber: bigint): Promise<bigint> {
    const block = await this.#request('eth_getBlockByNumber', [
      `0x${blockNumber.toString(16)}`,
      false,
    ]);
    const timestamp = (block as { timestamp?: string } | null)?.timestamp;
    if (typeof timestamp !== 'string') {
      throw new Error(`no timestamp for block ${blockNumber}`);
    }
    return BigInt(timestamp);
  }

  async getLogs(filter: Record<string, unknown>): Promise<unknown[]> {
    const result = await this.#request('eth_getLogs', [filter]);
    if (!Array.isArray(result)) {
      throw new TransportError('eth_getLogs', 'returned a non-array log result');
    }
    return result;
  }

  async blockNumber(): Promise<bigint> {
    const result = await this.#request('eth_blockNumber', []);
    if (typeof result !== 'string' || !/^0x(?:0|[1-9a-fA-F][0-9a-fA-F]*)$/.test(result)) {
      throw new TransportError('eth_blockNumber', 'returned an invalid nonnegative block number quantity');
    }
    return BigInt(result);
  }

  async codeAt(address: Address, blockNumber: bigint): Promise<string> {
    const result = await this.#request('eth_getCode', [
      address,
      `0x${blockNumber.toString(16)}`,
    ]);
    if (typeof result !== 'string') {
      throw new TransportError('eth_getCode', `returned no code for ${address}`);
    }
    return result;
  }

  async #request(method: string, params: unknown[]): Promise<unknown> {
    const id = this.#nextId++;
    let response: Response;
    try {
      response = await fetch(this.#endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ jsonrpc: '2.0', id, method, params }),
      });
    } catch (error) {
      throw new TransportError(method, `did not complete: ${String(error)}`);
    }

    if (!response.ok) {
      throw new TransportError(method, `HTTP ${response.status}`);
    }

    let decoded: unknown;
    try {
      decoded = await response.json();
    } catch (error) {
      throw new TransportError(method, `reply is not JSON: ${String(error)}`);
    }

    if (decoded === null || typeof decoded !== 'object' || Array.isArray(decoded)) {
      throw new TransportError(method, 'reply is not a JSON-RPC response object');
    }
    const payload = decoded as Record<string, unknown>;
    if (payload.jsonrpc !== '2.0' || payload.id !== id) {
      throw new TransportError(method, 'reply has an invalid JSON-RPC version or request id');
    }
    const hasResult = Object.hasOwn(payload, 'result');
    const hasError = Object.hasOwn(payload, 'error');
    if (hasResult === hasError) {
      throw new TransportError(method, 'reply must contain exactly one of result or error');
    }

    if (hasError) {
      const error = payload.error;
      if (error === null || typeof error !== 'object' || Array.isArray(error)) {
        throw new TransportError(method, 'reply has an invalid JSON-RPC error object');
      }
      const detail = error as Record<string, unknown>;
      if (typeof detail.code !== 'number' || !Number.isInteger(detail.code) ||
          typeof detail.message !== 'string') {
        throw new TransportError(method, 'reply has an invalid JSON-RPC error code or message');
      }
      const code = detail.code;
      const message = detail.message;
      // JSON-RPC permits structured error data; only string data is suitable
      // for the existing EVM revert decoder.
      const data = typeof detail.data === 'string' ? detail.data : undefined;
      // A revert is something a contract does, and only `eth_call` executes
      // contract code. Every other method's error is the node declining to
      // answer — a rate limit, an over-wide range, an outage — and reporting
      // one as a revert states something about the contract that the contract
      // never said.
      if (method === 'eth_call' && isExecutionRevert(code, message)) {
        throw new ContractRevertError(message, data);
      }
      throw new TransportError(method, message, code);
    }
    return payload.result;
  }
}

/**
 * Whether an `eth_call` error is the contract reverting.
 *
 * Geth signals a revert with code 3 and carries the ABI-encoded error in
 * `data`; the reference implementation's seventeen custom errors all arrive
 * that way. Other valid node errors may say so in the message. Anything
 * else on `eth_call` — a rate limit, a timeout, an invalid-params complaint —
 * is the node, not the contract.
 *
 * Erring towards `TransportError` is the safe direction: a revert misread as a
 * transport fault fails loudly, while a transport fault misread as a revert is
 * silently absorbed by every caller that treats a revert as an answer.
 */
function isExecutionRevert(
  code: number | undefined,
  message: string | undefined,
): boolean {
  if (code === 3) return true;
  // Hex diagnostic data and incidental revert wording are not EVM evidence.
  // Retain the explicit legacy execution-revert spelling only for its server code.
  return code === -32000 && /^execution reverted(?::|\s|$)/i.test(message ?? '');
}

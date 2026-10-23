import { encodeCall, encodeWords, REGISTER_ENTRY_TYPES } from '../codec/abi.ts';
import { keccak256Utf8 } from '../codec/keccak.ts';
import { detectConformance } from '../sdk/conformance.ts';
import type { Address, Bytes32 } from '../sdk/types.ts';
import type { Eip1193Provider } from '../adapters/signing/eip1193Signer.ts';
import { ResponsibilityControlClient, decodeControlWords } from './client.ts';
import { controlHex, controlRpc, hashControlBytes, requireControlAdapter as check,
  verifyControlDeployment, type ControlDeploymentPin } from './authorization.ts';

const ADMISSION_EVENT = keccak256Utf8('AdmissionBound(bytes32,uint64,uint256,bytes32,uint256)');
const ZERO = /^0x0+$/i;
const uint = (value: unknown, bits = 256n): value is bigint =>
  typeof value === 'bigint' && value >= 0n && value < 1n << bits;
const hash = (value: unknown): value is Bytes32 => controlHex(value, 32) && !ZERO.test(value);
const object = (value: unknown): Record<string, unknown> => {
  check(value !== null && typeof value === 'object' && !Array.isArray(value), 'CONTROL_HISTORY_SCHEMA_REFUSED');
  return value as Record<string, unknown>;
};
const quantity = (value: unknown): bigint => {
  check(typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value),
    'CONTROL_HISTORY_QUANTITY_REFUSED');
  const n = BigInt(value);
  check(uint(n), 'CONTROL_HISTORY_QUANTITY_REFUSED');
  return n;
};
const hexQuantity = (value: bigint): string => '0x' + value.toString(16);

export type ControlHistoryAnchor = {
  readonly blockNumber: bigint; readonly blockHash: Bytes32;
};
export type AdmissionEventLocation = {
  readonly blockNumber: bigint; readonly blockHash: Bytes32; readonly blockTimestamp: bigint;
  readonly transactionHash: Bytes32; readonly transactionIndex: bigint; readonly logIndex: bigint;
  readonly controllerRevision: bigint;
};
export type LocatedAdmission = {
  readonly kind: 'located-control-admission'; readonly readOnly: true;
  readonly protocolFinality: 'not-evaluated'; readonly displayMilestone: 'not-evaluated';
  readonly principalEntitlement: 'not-evaluated'; readonly chainId: bigint; readonly controller: Address;
  readonly sequenceId: Bytes32; readonly token: Address; readonly tokenId: bigint;
  readonly version: bigint; readonly occurrence: bigint; readonly immutableEntryHash: Bytes32;
  readonly anchor: ControlHistoryAnchor; readonly location: AdmissionEventLocation;
};
export type UnboundAdmission = {
  readonly kind: 'not-bound-at-anchor'; readonly readOnly: true; readonly chainId: bigint;
  readonly controller: Address; readonly sequenceId: Bytes32; readonly version: bigint;
  readonly anchor: ControlHistoryAnchor;
};
type CanonicalLog = {
  readonly address: Address; readonly topics: readonly string[]; readonly data: string;
  readonly blockNumber: bigint; readonly blockHash: Bytes32; readonly transactionHash: Bytes32;
  readonly transactionIndex: bigint; readonly logIndex: bigint;
};

/** Read-only locator, not an entitlement, Pending milestone or transaction API.
 * The caller supplies an explicit canonical anchor and a bounded search range.
 * A bound version must have exactly one matching event; an incomplete/missing
 * search can never become an empty or successful historical milestone.
 * Requires the explicit snapshotAt primitive; never rewrites latest on a provider.
 */
export class ControlAdmissionHistoryLocator {
  readonly #provider: Eip1193Provider;
  readonly #client: ResponsibilityControlClient;
  readonly #blocksPerRequest: bigint;
  readonly #maximumWindows: bigint;
  constructor(provider: Eip1193Provider, pin: ControlDeploymentPin,
    limits: { readonly blocksPerRequest?: bigint; readonly maximumWindows?: bigint } = {}) {
    this.#provider = provider;
    this.#client = new ResponsibilityControlClient(provider, pin);
    const page = limits.blocksPerRequest ?? 2_048n, windows = limits.maximumWindows ?? 512n;
    check(uint(page) && page > 0n && page <= 10_000n &&
      uint(windows) && windows > 0n && windows <= 4_096n, 'CONTROL_HISTORY_LIMIT_REFUSED');
    this.#blocksPerRequest = page; this.#maximumWindows = windows;
  }

  async locateVersion(sequenceId: Bytes32, version: bigint, fromBlock: bigint,
    anchor: ControlHistoryAnchor): Promise<LocatedAdmission | UnboundAdmission> {
    // Snapshot arguments before the first await. Returned proof fields never
    // retain the caller's anchor object or provider-owned RPC objects.
    check(hash(sequenceId) && uint(version, 64n) && version > 0n && uint(fromBlock),
      'CONTROL_HISTORY_QUERY_REFUSED');
    const a = object(anchor);
    const number = a.blockNumber, blockHash = a.blockHash;
    check(Object.keys(a).sort().join(',') === 'blockHash,blockNumber' &&
      uint(number) && hash(blockHash) && fromBlock <= number,
      'CONTROL_HISTORY_ANCHOR_REFUSED');
    const fixed = Object.freeze({ blockNumber: number, blockHash: blockHash.toLowerCase() });
    sequenceId = sequenceId.toLowerCase();
    const windows = (fixed.blockNumber - fromBlock) / this.#blocksPerRequest + 1n;
    check(windows <= this.#maximumWindows, 'CONTROL_HISTORY_RANGE_UNAVAILABLE');
    const pin = this.#client.deployment;
    const snapshot = await this.#client.snapshotAt(sequenceId, fixed.blockNumber, fixed.blockHash);
    const block = Object.freeze({ blockHash: fixed.blockHash, requireCanonical: true });
    const binding = decodeControlWords(['bool', 'uint256', 'bytes32'],
      await controlRpc(this.#provider, 'eth_call', [{ to: pin.controller,
        data: encodeCall('admissionBinding(bytes32,uint64)', ['bytes32', 'uint64'], [sequenceId, version]) }, block]));
    if (binding[0] === false) {
      check(binding[1] === 0n && ZERO.test(binding[2] as string), 'CONTROL_HISTORY_BINDING_REFUSED');
      await this.#canonical(fixed);
      await verifyControlDeployment(this.#provider, pin);
      await this.#canonical(fixed);
      return Object.freeze({ kind: 'not-bound-at-anchor', readOnly: true, chainId: pin.chainId,
        controller: pin.controller.toLowerCase(), sequenceId, version, anchor: fixed });
    }
    const occurrence = binding[1] as bigint, entryHash = binding[2] as string;
    check(occurrence <= snapshot.sequence.appended && hash(entryHash), 'CONTROL_HISTORY_BINDING_REFUSED');
    const token = snapshot.sequence.token;
    const code = await controlRpc(this.#provider, 'eth_getCode', [token, block]);
    check(controlHex(code) && code.length > 2 &&
      hashControlBytes(code) === snapshot.sequence.tokenCodeHash, 'CONTROL_TOKEN_RUNTIME_PIN_MISMATCH');
    const call = async (signature: string, types: Parameters<typeof encodeCall>[1],
      values: Parameters<typeof encodeCall>[2], returns: Parameters<typeof decodeControlWords>[0]) =>
      decodeControlWords(returns, await controlRpc(this.#provider, 'eth_call',
        [{ to: token, data: encodeCall(signature, types, values) }, block]));
    // Advertised conformance is asked independently, before any projection read.
    const conformance = await detectConformance({ supportsInterface: async id =>
      (await call('supportsInterface(bytes4)', ['bytes4'], [id], ['bool']))[0] as boolean });
    check(conformance.erc165 && conformance.projection, 'CONTROL_HISTORY_PROJECTION_UNSUPPORTED');
    const register = (await call('registerId()', [], [], ['bytes32']))[0];
    check(register === snapshot.sequence.registerId, 'CONTROL_REGISTER_PIN_MISMATCH');
    if (conformance.settlement) {
      const profile = (await call('verificationProfile()', [], [], ['bytes32']))[0];
      check(profile === snapshot.sequence.verificationProfile, 'CONTROL_PROFILE_PIN_MISMATCH');
    } else {
      // This controller bound a settlement authority and verification profile
      // when it opened the sequence. Missing that surface is not a no-gap fact.
      check(false, 'CONTROL_HISTORY_SETTLEMENT_UNSUPPORTED');
    }
    const entry = await call('entryAt(uint256,uint64)', ['uint256', 'uint64'],
      [snapshot.sequence.tokenId, version], REGISTER_ENTRY_TYPES);
    check(entry[4] === version && hash(entry[0]) &&
      hashControlBytes(encodeWords(REGISTER_ENTRY_TYPES.slice(0, 6), entry.slice(0, 6))) === entryHash,
      'CONTROL_HISTORY_ENTRY_BINDING_REFUSED');

    const topics = Object.freeze([ADMISSION_EVENT, sequenceId, encodeWords(['uint64'], [version])]);
    let found: CanonicalLog | undefined;
    for (let start = fromBlock; start <= fixed.blockNumber; start += this.#blocksPerRequest) {
      const end = start + this.#blocksPerRequest - 1n < fixed.blockNumber
        ? start + this.#blocksPerRequest - 1n : fixed.blockNumber;
      const rows = await controlRpc(this.#provider, 'eth_getLogs', [{ address: pin.controller,
        fromBlock: hexQuantity(start), toBlock: hexQuantity(end), topics: [...topics] }]);
      check(Array.isArray(rows), 'CONTROL_HISTORY_LOGS_REFUSED');
      // A unique immutable binding cannot legitimately emit twice. No provider
      // truncation/overload becomes a partial-result success.
      check(rows.length <= 1, 'CONTROL_HISTORY_EVENT_DUPLICATE');
      if (rows.length === 0) continue;
      check(Object.hasOwn(rows, 0) && found === undefined, 'CONTROL_HISTORY_EVENT_DUPLICATE');
      const log = this.#log(rows[0]);
      check(log.address === pin.controller.toLowerCase() && log.blockNumber >= start && log.blockNumber <= end &&
        log.topics.length === 4 && topics.every((v, i) => log.topics[i] === v),
        'CONTROL_HISTORY_EVENT_BINDING_REFUSED');
      const indexedOccurrence = decodeControlWords(['uint256'], log.topics[3])[0];
      const event = decodeControlWords(['bytes32', 'uint256'], log.data);
      check(indexedOccurrence === occurrence && event[0] === entryHash &&
        (event[1] as bigint) > 0n && (event[1] as bigint) <= snapshot.sequence.revision,
        'CONTROL_HISTORY_EVENT_BINDING_REFUSED');
      found = log;
    }
    check(found !== undefined, 'CONTROL_HISTORY_BOUND_EVENT_UNAVAILABLE');
    const located = found;
    const header = await this.#canonical({ blockNumber: located.blockNumber, blockHash: located.blockHash });
    const eventBlock = Object.freeze({ blockHash: located.blockHash, requireCanonical: true });
    const eventCode = await controlRpc(this.#provider, 'eth_getCode', [pin.controller, eventBlock]);
    check(controlHex(eventCode) && eventCode.length > 2 &&
      hashControlBytes(eventCode) === pin.runtimeCodeHash.toLowerCase(), 'CONTROL_HISTORY_EVENT_RUNTIME_REFUSED');
    const eventBinding = decodeControlWords(['bool', 'uint256', 'bytes32'],
      await controlRpc(this.#provider, 'eth_call', [{ to: pin.controller,
        data: encodeCall('admissionBinding(bytes32,uint64)', ['bytes32', 'uint64'], [sequenceId, version]) }, eventBlock]));
    check(eventBinding[0] === true && eventBinding[1] === occurrence && eventBinding[2] === entryHash,
      'CONTROL_HISTORY_EVENT_BINDING_REFUSED');
    const receipt = object(await controlRpc(this.#provider, 'eth_getTransactionReceipt', [located.transactionHash]));
    check(receipt.status === '0x1' && typeof receipt.transactionHash === 'string' &&
      receipt.transactionHash.toLowerCase() === located.transactionHash &&
      typeof receipt.blockHash === 'string' && receipt.blockHash.toLowerCase() === located.blockHash &&
      quantity(receipt.blockNumber) === located.blockNumber &&
      quantity(receipt.transactionIndex) === located.transactionIndex && Array.isArray(receipt.logs),
      'CONTROL_HISTORY_RECEIPT_REFUSED');
    let matching = 0;
    for (let i = 0; i < receipt.logs.length; i++) {
      check(Object.hasOwn(receipt.logs, i), 'CONTROL_HISTORY_RECEIPT_REFUSED');
      const row = object(receipt.logs[i]);
      if (quantity(row.logIndex) !== located.logIndex) continue;
      const saved = this.#log(row);
      check(saved.address === located.address && saved.data === located.data &&
        saved.topics.length === located.topics.length &&
        saved.topics.every((v, index) => v === located.topics[index]) &&
        saved.blockNumber === located.blockNumber && saved.blockHash === located.blockHash &&
        saved.transactionHash === located.transactionHash && saved.transactionIndex === located.transactionIndex,
        'CONTROL_HISTORY_RECEIPT_REFUSED');
      matching++;
    }
    check(matching === 1, 'CONTROL_HISTORY_RECEIPT_REFUSED');
    await verifyControlDeployment(this.#provider, pin);
    await this.#canonical({ blockNumber: located.blockNumber, blockHash: located.blockHash });
    await this.#canonical(fixed);
    const revision = decodeControlWords(['bytes32', 'uint256'], located.data)[1] as bigint;
    return Object.freeze({ kind: 'located-control-admission', readOnly: true, protocolFinality: 'not-evaluated',
      displayMilestone: 'not-evaluated', principalEntitlement: 'not-evaluated', chainId: pin.chainId,
      controller: pin.controller.toLowerCase(), sequenceId, token, tokenId: snapshot.sequence.tokenId,
      version, occurrence, immutableEntryHash: entryHash, anchor: fixed,
      location: Object.freeze({ blockNumber: located.blockNumber, blockHash: located.blockHash,
        blockTimestamp: header.timestamp, transactionHash: located.transactionHash,
        transactionIndex: located.transactionIndex, logIndex: located.logIndex, controllerRevision: revision }) });
  }

  #log(value: unknown): CanonicalLog {
    const row = object(value);
    check(controlHex(row.address, 20) && hash(row.blockHash) && hash(row.transactionHash) &&
      row.removed === false && Array.isArray(row.topics) && row.topics.length === 4 &&
      controlHex(row.data, 64), 'CONTROL_HISTORY_LOG_REFUSED');
    const topics: string[] = [];
    for (let i = 0; i < row.topics.length; i++) {
      check(Object.hasOwn(row.topics, i) && controlHex(row.topics[i], 32), 'CONTROL_HISTORY_LOG_REFUSED');
      topics.push(row.topics[i].toLowerCase());
    }
    return Object.freeze({ address: row.address.toLowerCase(), topics: Object.freeze(topics), data: row.data.toLowerCase(),
      blockNumber: quantity(row.blockNumber), blockHash: row.blockHash.toLowerCase(),
      transactionHash: row.transactionHash.toLowerCase(), transactionIndex: quantity(row.transactionIndex),
      logIndex: quantity(row.logIndex) });
  }
  async #canonical(anchor: ControlHistoryAnchor): Promise<{ readonly timestamp: bigint }> {
    const header = object(await controlRpc(this.#provider, 'eth_getBlockByNumber', [hexQuantity(anchor.blockNumber), false]));
    check(quantity(header.number) === anchor.blockNumber && typeof header.hash === 'string' &&
      header.hash.toLowerCase() === anchor.blockHash, 'CONTROL_HISTORY_REORGED');
    return { timestamp: quantity(header.timestamp) };
  }
}


import { encodeCall, encodeWords } from '../codec/abi.ts';
import { keccak256Utf8 } from '../codec/keccak.ts';
import type { Eip1193Provider } from '../adapters/signing/eip1193Signer.ts';
import type { Bytes32 } from '../sdk/types.ts';
import type { DetachedHistoryRecord } from './detachedHistory.ts';
import { ResponsibilityControlClient, decodeControlWords } from './client.ts';
import { controlHex, controlRpc, hashControlBytes, requireControlAdapter as check,
  verifyControlDeployment, type ControlDeploymentPin } from './authorization.ts';

const TOPIC = keccak256Utf8('LegDetached(bytes32,bytes32,uint256,address,address,bytes32,bytes32,address,bytes32,bytes32)');
const SEED = keccak256Utf8('8415Wallet/DetachedResponsibilities/v1');
const ZERO = '0x' + '0'.repeat(64);
const uint = (v: unknown): v is bigint => typeof v === 'bigint' && v >= 0n && v < 1n << 256n;
const hash = (v: unknown): v is string => controlHex(v, 32) && !/^0x0+$/i.test(v);
const object = (v: unknown): Record<string, unknown> => {
  check(v !== null && typeof v === 'object' && !Array.isArray(v), 'CONTROL_PREFIX_SCHEMA_REFUSED');
  return v as Record<string, unknown>;
};
const quantity = (v: unknown): bigint => {
  check(typeof v === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(v), 'CONTROL_PREFIX_QUANTITY_REFUSED');
  const n = BigInt(v); check(uint(n), 'CONTROL_PREFIX_QUANTITY_REFUSED'); return n;
};
const hexQuantity = (v: bigint): string => '0x' + v.toString(16);
export type DetachedPrefixAnchor = { readonly blockNumber: bigint; readonly blockHash: Bytes32 };
export type LocatedDetachedRecord = DetachedHistoryRecord & {
  readonly location: { readonly blockNumber: bigint; readonly blockHash: Bytes32;
    readonly transactionHash: Bytes32; readonly transactionIndex: bigint; readonly logIndex: bigint };
};
export type LocatedDetachedPrefix = {
  readonly kind: 'located-detached-prefix'; readonly readOnly: true; readonly protocolFinality: 'not-evaluated';
  readonly principalEntitlement: 'not-evaluated'; readonly displayMilestone: 'not-evaluated';
  readonly chainId: bigint; readonly controller: string; readonly sequenceId: Bytes32;
  readonly token: string; readonly tokenId: bigint; readonly revision: bigint; readonly anchor: DetachedPrefixAnchor;
  readonly detachedCount: bigint; readonly detachedCommitment: Bytes32; readonly boundaryAccount: string;
  readonly records: readonly LocatedDetachedRecord[];
};

/** Retrieves actual detachment logs and verifies the entire prefix against the
 * controller at one explicit historical anchor. It does not accept an imported
 * history document, infer user entitlement or change a commercial/payment state.
 * Resource bounds are read availability limits, never a 128-leg lifetime limit.
 */
export class RpcDetachedHistoryLocator {
  readonly #provider: Eip1193Provider;
  readonly #client: ResponsibilityControlClient;
  readonly #page: bigint;
  readonly #windows: bigint;
  readonly #records: bigint;
  constructor(provider: Eip1193Provider, pin: ControlDeploymentPin,
    limits: { readonly blocksPerRequest?: bigint; readonly maximumWindows?: bigint;
      readonly maximumRecords?: bigint } = {}) {
    this.#provider = provider; this.#client = new ResponsibilityControlClient(provider, pin);
    const page = limits.blocksPerRequest ?? 2_048n, windows = limits.maximumWindows ?? 512n,
      records = limits.maximumRecords ?? 16_384n;
    check(uint(page) && page > 0n && page <= 10_000n && uint(windows) && windows > 0n &&
      windows <= 4_096n && uint(records) && records > 0n && records <= 1_000_000n,
      'CONTROL_PREFIX_LIMIT_REFUSED');
    this.#page = page; this.#windows = windows; this.#records = records;
  }

  async locate(sequenceId: Bytes32, fromBlock: bigint, anchor: DetachedPrefixAnchor): Promise<LocatedDetachedPrefix> {
    const a = object(anchor), number = a.blockNumber, blockHash = a.blockHash;
    check(hash(sequenceId) && uint(fromBlock) && uint(number) && hash(blockHash) && fromBlock <= number &&
      Object.keys(a).sort().join(',') === 'blockHash,blockNumber', 'CONTROL_PREFIX_QUERY_REFUSED');
    const fixed = Object.freeze({ blockNumber: number, blockHash: blockHash.toLowerCase() });
    sequenceId = sequenceId.toLowerCase();
    check((number - fromBlock) / this.#page + 1n <= this.#windows, 'CONTROL_PREFIX_RANGE_UNAVAILABLE');
    const pin = this.#client.deployment;
    const snapshot = await this.#client.snapshotAt(sequenceId, fixed.blockNumber, fixed.blockHash);
    const s = snapshot.sequence, block = Object.freeze({ blockHash: fixed.blockHash, requireCanonical: true });
    check(s.completedCount <= this.#records, 'CONTROL_PREFIX_RECORDS_UNAVAILABLE');
    const boundary = decodeControlWords(['address'], await controlRpc(this.#provider, 'eth_call',
      [{ to: pin.controller, data: encodeCall('boundaryAccount(bytes32)', ['bytes32'], [sequenceId]) }, block]))[0] as string;
    check(boundary === (snapshot.legs[0]?.fromAccount ?? s.currentAccount), 'CONTROL_PREFIX_BOUNDARY_REFUSED');
    const rows: LocatedDetachedRecord[] = [];
    if (s.completedCount > 0n) {
      for (let start = fromBlock; start <= number; start += this.#page) {
        const end = start + this.#page - 1n < number ? start + this.#page - 1n : number;
        const logs = await controlRpc(this.#provider, 'eth_getLogs', [{ address: pin.controller,
          fromBlock: hexQuantity(start), toBlock: hexQuantity(end), topics: [TOPIC, sequenceId] }]);
        check(Array.isArray(logs) && BigInt(logs.length) <= s.completedCount - BigInt(rows.length),
          'CONTROL_PREFIX_LOGS_REFUSED');
        for (let i = 0; i < logs.length; i++) {
          check(Object.hasOwn(logs, i), 'CONTROL_PREFIX_LOGS_REFUSED');
          const row = this.#decode(logs[i], sequenceId);
          check(row.location.blockNumber >= start && row.location.blockNumber <= end,
            'CONTROL_PREFIX_EVENT_RANGE_REFUSED');
          rows.push(row);
        }
      }
    }
    check(BigInt(rows.length) === s.completedCount, 'CONTROL_PREFIX_INCOMPLETE');
    // Sort only locally created immutable records, never provider-owned arrays.
    // Occurrence order must agree with canonical execution order afterwards.
    rows.sort((a, b) => a.occurrence < b.occurrence ? -1 : a.occurrence > b.occurrence ? 1 : 0);
    let commitment = hashControlBytes(encodeWords(['bytes32', 'bytes32'], [SEED, sequenceId]));
    let predecessor = s.initialAccount;
    const legIds = new Set<string>(), blocks = new Map<bigint, string>();
    let previous: LocatedDetachedRecord | undefined;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]!, l = row.location;
      check(row.occurrence === BigInt(i) && row.fromAccount === predecessor && !legIds.has(row.legId),
        'CONTROL_PREFIX_ORDER_REFUSED');
      if (previous) {
        const p = previous.location;
        check(l.blockNumber > p.blockNumber || l.blockNumber === p.blockNumber &&
          l.logIndex > p.logIndex && l.transactionIndex >= p.transactionIndex, 'CONTROL_PREFIX_ORDER_REFUSED');
        check(l.transactionHash !== p.transactionHash || l.blockNumber === p.blockNumber &&
          l.transactionIndex === p.transactionIndex, 'CONTROL_PREFIX_ORDER_REFUSED');
      }
      const known = blocks.get(l.blockNumber);
      check(known === undefined || known === l.blockHash, 'CONTROL_PREFIX_BLOCK_CONFLICT');
      blocks.set(l.blockNumber, l.blockHash); legIds.add(row.legId);
      commitment = hashControlBytes(encodeWords(
        ['bytes32','uint256','bytes32','address','address','bytes32','bytes32','address','bytes32'],
        [commitment,row.occurrence,row.legId,row.fromAccount,row.toAccount,row.termsHash,
          row.acceptanceHash,row.returnAuthority,row.returnConditionHash]));
      check(commitment === row.detachedCommitment, 'CONTROL_PREFIX_COMMITMENT_REFUSED');
      predecessor = row.toAccount; previous = row;
    }
    check((rows.length === 0 ? ZERO : commitment) === s.detachedCommitment,
      'CONTROL_PREFIX_COMMITMENT_REFUSED');
    check(predecessor === boundary, 'CONTROL_PREFIX_BOUNDARY_REFUSED');

    for (const [blockNumber, blockHash] of blocks) {
      await this.#canonical({ blockNumber, blockHash });
      const eventCode = await controlRpc(this.#provider, 'eth_getCode',
        [pin.controller, { blockHash, requireCanonical: true }]);
      check(controlHex(eventCode) && eventCode.length > 2 && hashControlBytes(eventCode) === pin.runtimeCodeHash.toLowerCase(),
        'CONTROL_PREFIX_EVENT_RUNTIME_REFUSED');
    }
    // Index each receipt once: a completed batch may contain many detached
    // records. Do not rescan the same log array once per record (quadratic),
    // or keep mutable provider-owned evidence across later awaited reads.
    const receipts = new Map<string, {
      readonly status: unknown; readonly transactionHash: unknown; readonly blockHash: unknown;
      readonly blockNumber: bigint; readonly transactionIndex: bigint;
      readonly logs: ReadonlyMap<bigint, LocatedDetachedRecord | null>;
    }>();
    for (const row of rows) {
      const l = row.location;
      let receipt = receipts.get(l.transactionHash);
      if (!receipt) {
        const raw = object(await controlRpc(this.#provider, 'eth_getTransactionReceipt', [l.transactionHash]));
        check(Array.isArray(raw.logs) && raw.logs.length <= 1_000_000, 'CONTROL_PREFIX_RECEIPT_UNAVAILABLE');
        const indexed = new Map<bigint, LocatedDetachedRecord | null>();
        for (let i = 0; i < raw.logs.length; i++) {
          check(Object.hasOwn(raw.logs, i), 'CONTROL_PREFIX_RECEIPT_REFUSED');
          const log = object(raw.logs[i]), index = quantity(log.logIndex);
          check(!indexed.has(index), 'CONTROL_PREFIX_RECEIPT_REFUSED');
          const topics = log.topics;
          const ours = typeof log.address === 'string' && log.address.toLowerCase() === pin.controller.toLowerCase() &&
            Array.isArray(topics) && typeof topics[0] === 'string' && typeof topics[1] === 'string' &&
            topics[0].toLowerCase() === TOPIC && topics[1].toLowerCase() === sequenceId;
          indexed.set(index, ours ? this.#decode(log, sequenceId) : null);
        }
        receipt = Object.freeze({ status: raw.status, transactionHash: raw.transactionHash, blockHash: raw.blockHash,
          blockNumber: quantity(raw.blockNumber), transactionIndex: quantity(raw.transactionIndex), logs: indexed });
        receipts.set(l.transactionHash, receipt);
      }
      check(receipt.status === '0x1' && typeof receipt.transactionHash === 'string' &&
        receipt.transactionHash.toLowerCase() === l.transactionHash && typeof receipt.blockHash === 'string' &&
        receipt.blockHash.toLowerCase() === l.blockHash && receipt.blockNumber === l.blockNumber &&
        receipt.transactionIndex === l.transactionIndex,
        'CONTROL_PREFIX_RECEIPT_REFUSED');
      const saved = receipt.logs.get(l.logIndex);
      check(saved !== undefined && saved !== null && this.#sameRecord(saved, row), 'CONTROL_PREFIX_RECEIPT_REFUSED');
      const terminal = decodeControlWords(['uint8'], await controlRpc(this.#provider, 'eth_call', [{
        to: pin.controller, data: encodeCall('legTerminalOutcome(bytes32,bytes32)', ['bytes32','bytes32'],
          [sequenceId,row.legId]) }, block]))[0];
      check(terminal === 1n, 'CONTROL_PREFIX_TERMINAL_REFUSED');
    }
    await verifyControlDeployment(this.#provider, pin);
    for (const [blockNumber, blockHash] of blocks) await this.#canonical({ blockNumber, blockHash });
    await this.#canonical(fixed);
    return Object.freeze({ kind: 'located-detached-prefix', readOnly: true, protocolFinality: 'not-evaluated',
      principalEntitlement: 'not-evaluated', displayMilestone: 'not-evaluated', chainId: pin.chainId,
      controller: pin.controller.toLowerCase(), sequenceId, token: s.token, tokenId: s.tokenId, revision: s.revision,
      anchor: fixed, detachedCount: s.completedCount, detachedCommitment: s.detachedCommitment,
      boundaryAccount: boundary, records: Object.freeze(rows) });
  }
  #decode(value: unknown, sequenceId: string): LocatedDetachedRecord {
    const row = object(value), topics = row.topics;
    check(controlHex(row.address,20) && row.address.toLowerCase() === this.#client.deployment.controller.toLowerCase() &&
      Array.isArray(topics) && topics.length === 4 && [0,1,2,3].every(i=>Object.hasOwn(topics,i)&&controlHex(topics[i],32)) &&
      topics[0].toLowerCase() === TOPIC && topics[1].toLowerCase() === sequenceId && hash(topics[2]) &&
      row.removed === false && hash(row.blockHash) && hash(row.transactionHash) && controlHex(row.data,224),
      'CONTROL_PREFIX_EVENT_REFUSED');
    const fields = decodeControlWords(['address','address','bytes32','bytes32','address','bytes32','bytes32'],row.data);
    check(!/^0x0+$/i.test(fields[0] as string) && !/^0x0+$/i.test(fields[1] as string) &&
      !/^0x0+$/i.test(fields[4] as string), 'CONTROL_PREFIX_EVENT_REFUSED');
    return Object.freeze({ occurrence: decodeControlWords(['uint256'],topics[3])[0] as bigint,
      legId: topics[2].toLowerCase(), fromAccount: fields[0] as string, toAccount: fields[1] as string,
      termsHash: fields[2] as string, acceptanceHash: fields[3] as string, returnAuthority: fields[4] as string,
      returnConditionHash: fields[5] as string, detachedCommitment: fields[6] as string,
      location: Object.freeze({ blockNumber:quantity(row.blockNumber), blockHash:row.blockHash.toLowerCase(),
        transactionHash:row.transactionHash.toLowerCase(),transactionIndex:quantity(row.transactionIndex),logIndex:quantity(row.logIndex) }) });
  }
  #sameRecord(a: LocatedDetachedRecord, b: LocatedDetachedRecord): boolean {
    return a.occurrence===b.occurrence && a.legId===b.legId && a.fromAccount===b.fromAccount &&
      a.toAccount===b.toAccount && a.termsHash===b.termsHash && a.acceptanceHash===b.acceptanceHash &&
      a.returnAuthority===b.returnAuthority && a.returnConditionHash===b.returnConditionHash &&
      a.detachedCommitment===b.detachedCommitment && a.location.blockNumber===b.location.blockNumber &&
      a.location.blockHash===b.location.blockHash && a.location.transactionHash===b.location.transactionHash &&
      a.location.transactionIndex===b.location.transactionIndex && a.location.logIndex===b.location.logIndex;
  }
  async #canonical(at: DetachedPrefixAnchor): Promise<void> {
    const header=object(await controlRpc(this.#provider,'eth_getBlockByNumber',[hexQuantity(at.blockNumber),false]));
    check(quantity(header.number)===at.blockNumber && typeof header.hash==='string' &&
      header.hash.toLowerCase()===at.blockHash,'CONTROL_PREFIX_REORGED');
  }
}


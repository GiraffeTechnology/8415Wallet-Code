/** Public V2 account factory client. No linked responsibility execution surface. */
import { decodeResult, encodeCall, type AbiValue, type StaticType } from '../codec/abi.ts';
import { keccak256Utf8 } from '../codec/keccak.ts';
import type { Eip1193Provider } from '../adapters/signing/eip1193Signer.ts';
import type { Address, Bytes32 } from '../sdk/types.ts';
import {
  controlHex, controlRpc, controlPendingNonce, hashControlBytes,
  requireControlAdapter as requireValue, validateControlPin, verifyControlDeployment,
  type ControlDeploymentPin,
} from './authorization.ts';

export type ControlAction = { readonly kind: 'create-account' };

/** Safe persistence surface: intentionally excludes calldata, consent signatures and RPC endpoints. */
export type ControlSubmission = {
  readonly schema: '8415-control-submission/1'; readonly deployment: ControlDeploymentPin;
  readonly kind: ControlAction['kind']; readonly transactionHash: Bytes32; readonly actor: Address;
  readonly nonce: bigint;
  readonly calldataHash: Bytes32; readonly sequenceId: Bytes32 | null; readonly legId: Bytes32 | null;
  readonly expectedRevision: bigint | null; readonly acceptanceHash: Bytes32 | null;
};
export type ControlReceipt = {
  readonly state: 'pending' | 'reorged' | 'reverted' | 'confirming' | 'confirmed';
  readonly transactionHash: Bytes32; readonly blockNumber: bigint | null;
  readonly blockHash: Bytes32 | null; readonly confirmations: bigint;
  readonly executionEventObserved: boolean;
  /** Reorg depth is never ERC-8415 temporal finality. */
  readonly protocolFinality: 'not-evaluated';
};
function object(value: unknown): Record<string, unknown> {
  requireValue(value !== null && typeof value === 'object' && !Array.isArray(value), 'CONTROL_RPC_SCHEMA_REFUSED');
  return value as Record<string, unknown>;
}
function quantity(value: unknown): bigint {
  requireValue(typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), 'CONTROL_RPC_QUANTITY_REFUSED');
  return BigInt(value);
}
export function decodeControlWords(types: readonly StaticType[], value: unknown): AbiValue[] {
  requireValue(controlHex(value, types.length * 32), 'CONTROL_ABI_LENGTH_REFUSED');
  const values = decodeResult(types, value);
  for (const [i, type] of types.entries()) {
    const word = value.slice(2 + i * 64, 2 + (i + 1) * 64);
    if (type === 'address') requireValue(/^0{24}/.test(word), 'CONTROL_ABI_PADDING_REFUSED');
    if (type === 'bool') requireValue(BigInt(`0x${word}`) <= 1n, 'CONTROL_ABI_BOOLEAN_REFUSED');
    if (type === 'uint8' || type === 'uint64') requireValue(BigInt(`0x${word}`) < 1n << (type === 'uint8' ? 8n : 64n), 'CONTROL_ABI_INTEGER_REFUSED');
  }
  return values;
}
const strictDecode = decodeControlWords;
/** No raw-key support, automatic signing, transaction retries, or fallback to unpinned reads. */
export class AccountFactoryClient {
  readonly deployment: ControlDeploymentPin;
  readonly #provider: Eip1193Provider;
  readonly #beforeSend: ((template: ControlSubmission) => Promise<void>) | undefined;
  constructor(provider: Eip1193Provider, deployment: ControlDeploymentPin, beforeSend?: (template: ControlSubmission) => Promise<void>) {
    validateControlPin(deployment);
    this.#provider = provider;
    this.#beforeSend = beforeSend;
    this.deployment = Object.freeze({ ...deployment });
  }

  /** Explicit transaction submission; a returned hash is only pending, never completion. */
  async submit(action: ControlAction, actor: Address): Promise<ControlSubmission> {
    const fixed = structuredClone(action);
    requireValue(fixed !== null && typeof fixed === 'object' && Object.keys(fixed).length === 1 && fixed.kind === 'create-account', 'CONTROL_ACTION_REFUSED');
    const data = encodeCall('createAccount()', [], []);
    requireValue(controlHex(actor, 20), 'CONTROL_ACTOR_REFUSED');
    const accounts = async () => {
      const result = await controlRpc(this.#provider, 'eth_accounts', []);
      requireValue(Array.isArray(result) && typeof result[0] === 'string' && result[0].toLowerCase() === actor.toLowerCase(), 'CONTROL_SIGNER_MISMATCH');
    };
    await verifyControlDeployment(this.#provider, this.deployment); await accounts();
    const tx = { from: actor, to: this.deployment.controller, data, value: '0x0', chainId: `0x${this.deployment.chainId.toString(16)}` };
    const simulated = await controlRpc(this.#provider, 'eth_call', [tx, 'latest']);
    requireValue(controlHex(simulated), 'CONTROL_PREFLIGHT_RESPONSE_REFUSED');
    await verifyControlDeployment(this.#provider, this.deployment); await accounts();
    const nonce = controlPendingNonce(await controlRpc(this.#provider, 'eth_getTransactionCount', [actor, 'pending']));
    const template: ControlSubmission = { schema: '8415-control-submission/1', deployment: { ...this.deployment }, kind: fixed.kind,
      transactionHash: `0x${'0'.repeat(64)}`, actor: actor.toLowerCase(), nonce, calldataHash: hashControlBytes(data),
      sequenceId: null, legId: null, expectedRevision: null, acceptanceHash: null };
    if (this.#beforeSend) await this.#beforeSend(structuredClone(template));
    const hash = await controlRpc(this.#provider, 'eth_sendTransaction', [{ ...tx, nonce: `0x${nonce.toString(16)}` }]);
    requireValue(controlHex(hash, 32), 'CONTROL_TRANSACTION_HASH_REFUSED');
    return { ...template, transactionHash: hash.toLowerCase() };
  }

  /** One bounded observation; no automatic resubmission when pending, failed or reorged. */
  async receipt(record: ControlSubmission, minimumConfirmations = 1n): Promise<ControlReceipt> {
    record = parseControlSubmission(serializeControlSubmission(record));
    requireValue(record.schema === '8415-control-submission/1' && record.kind === 'create-account' &&
      controlHex(record.transactionHash, 32) && controlHex(record.calldataHash, 32) &&
      record.deployment.chainId === this.deployment.chainId &&
      record.deployment.controller.toLowerCase() === this.deployment.controller.toLowerCase() &&
      record.deployment.runtimeCodeHash.toLowerCase() === this.deployment.runtimeCodeHash.toLowerCase(), 'CONTROL_SUBMISSION_BINDING_REFUSED');
    requireValue(typeof minimumConfirmations === 'bigint' && minimumConfirmations >= 1n && minimumConfirmations <= 1024n,
      'CONTROL_CONFIRMATION_POLICY_REFUSED');
    await verifyControlDeployment(this.#provider, this.deployment);
    const raw = await controlRpc(this.#provider, 'eth_getTransactionReceipt', [record.transactionHash]);
    const base = { transactionHash: record.transactionHash, protocolFinality: 'not-evaluated' as const };
    if (raw === null) return { ...base, state: 'pending', blockNumber: null, blockHash: null, confirmations: 0n, executionEventObserved: false };
    const receipt = object(raw);
    requireValue(typeof receipt.transactionHash === 'string' && receipt.transactionHash.toLowerCase() === record.transactionHash &&
      typeof receipt.to === 'string' && receipt.to.toLowerCase() === this.deployment.controller.toLowerCase() &&
      typeof receipt.from === 'string' && receipt.from.toLowerCase() === record.actor && controlHex(receipt.blockHash, 32), 'CONTROL_RECEIPT_BINDING_REFUSED');
    const number = quantity(receipt.blockNumber); const blockHash = receipt.blockHash.toLowerCase();
    const at = { ...base, blockNumber: number, blockHash };
    const headerValue = await controlRpc(this.#provider, 'eth_getBlockByNumber', [`0x${number.toString(16)}`, false]);
    const header = headerValue === null ? {} : object(headerValue);
    if (typeof header.hash !== 'string' || header.hash.toLowerCase() !== blockHash)
      return { ...at, state: 'reorged', confirmations: 0n, executionEventObserved: false };
    const transaction = object(await controlRpc(this.#provider, 'eth_getTransactionByHash', [record.transactionHash]));
    requireValue(controlHex(transaction.input) && hashControlBytes(transaction.input) === record.calldataHash &&
      typeof transaction.hash === 'string' && transaction.hash.toLowerCase() === record.transactionHash &&
      typeof transaction.blockHash === 'string' && transaction.blockHash.toLowerCase() === blockHash &&
      quantity(transaction.blockNumber) === number && quantity(transaction.chainId) === this.deployment.chainId &&
      quantity(transaction.value) === 0n && quantity(transaction.nonce) === record.nonce &&
      typeof transaction.from === 'string' && transaction.from.toLowerCase() === record.actor &&
      typeof transaction.to === 'string' && transaction.to.toLowerCase() === this.deployment.controller.toLowerCase(), 'CONTROL_TRANSACTION_BINDING_REFUSED');
    const head = quantity(await controlRpc(this.#provider, 'eth_blockNumber', []));
    if (head < number) return { ...at, state: 'reorged', confirmations: 0n, executionEventObserved: false };
    const confirmations = head - number + 1n;
    const status = quantity(receipt.status);
    requireValue(status === 0n || status === 1n, 'CONTROL_RECEIPT_STATUS_REFUSED');
    const canonical = async () => {
      const headerValue = await controlRpc(this.#provider, 'eth_getBlockByNumber', [`0x${number.toString(16)}`, false]);
      const finalHeader = headerValue === null ? {} : object(headerValue);
      const chain = quantity(await controlRpc(this.#provider, 'eth_chainId', []));
      requireValue(chain === this.deployment.chainId, 'CONTROL_CHAIN_MISMATCH');
      return typeof finalHeader.hash === 'string' && finalHeader.hash.toLowerCase() === blockHash;
    };
    if (status === 0n) return { ...at, state: await canonical() ?
      (confirmations >= minimumConfirmations ? 'reverted' : 'confirming') : 'reorged', confirmations, executionEventObserved: false };
    requireValue(Array.isArray(receipt.logs), 'CONTROL_RECEIPT_LOGS_REFUSED');
    const topic = keccak256Utf8('AccountCreated(address,address)');
    const events = receipt.logs.map(object).filter(log => typeof log.address === 'string' &&
      log.address.toLowerCase() === this.deployment.controller.toLowerCase() && Array.isArray(log.topics) && log.topics[0] === topic);
    requireValue(events.length === 1, 'CONTROL_EXECUTION_EVENT_MISSING');
    const event = events[0]!; const topics = event.topics as unknown[];
    const topicCount = 3;
    requireValue(topics.length === topicCount && topics.every(t => controlHex(t, 32)) && event.removed !== true &&
      typeof event.transactionHash === 'string' && event.transactionHash.toLowerCase() === record.transactionHash &&
      typeof event.blockHash === 'string' && event.blockHash.toLowerCase() === blockHash, 'CONTROL_EVENT_SHAPE_REFUSED');
    strictDecode([], event.data);
    requireValue(strictDecode(['address'], topics[1])[0] === record.actor, 'CONTROL_EVENT_ACTOR_MISMATCH');
    strictDecode(['address'], topics[2]);
    if (!await canonical()) return { ...at, state: 'reorged', confirmations: 0n, executionEventObserved: false };
    return { ...at, state: confirmations >= minimumConfirmations ? 'confirmed' : 'confirming', confirmations, executionEventObserved: true };
  }
}

/** Safe recovery journal only. Consumers must still re-read canonical receipts after restart. */
export function serializeControlSubmission(record: ControlSubmission): string {
  return JSON.stringify({ schema: record.schema, deployment: { chainId: record.deployment.chainId.toString(),
    controller: record.deployment.controller, runtimeCodeHash: record.deployment.runtimeCodeHash },
    kind: record.kind, transactionHash: record.transactionHash, actor: record.actor, nonce: record.nonce.toString(), calldataHash: record.calldataHash,
    sequenceId: record.sequenceId, legId: record.legId,
    expectedRevision: record.expectedRevision?.toString() ?? null, acceptanceHash: record.acceptanceHash });
}

/** Strict, bounded recovery input. A journal is not authority: receipt() rechecks the chain. */
export function parseControlSubmission(json: string): ControlSubmission {
  requireValue(typeof json === 'string' && json.length <= 4096, 'CONTROL_JOURNAL_SIZE_REFUSED');
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { throw new Error('CONTROL_JOURNAL_JSON_REFUSED'); }
  const r = object(parsed);
  const keys = ['schema', 'deployment', 'kind', 'transactionHash', 'actor', 'nonce', 'calldataHash',
    'sequenceId', 'legId', 'expectedRevision', 'acceptanceHash'];
  requireValue(Object.keys(r).length === keys.length && keys.every(k => Object.hasOwn(r, k)) &&
    r.schema === '8415-control-submission/1' && r.kind === 'create-account',
  'CONTROL_JOURNAL_SCHEMA_REFUSED');
  const d = object(r.deployment);
  requireValue(Object.keys(d).length === 3 && ['chainId', 'controller', 'runtimeCodeHash'].every(k => Object.hasOwn(d, k)),
    'CONTROL_JOURNAL_DEPLOYMENT_REFUSED');
  const decimal = (value: unknown) => {
    requireValue(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 1n << 256n,
      'CONTROL_JOURNAL_INTEGER_REFUSED');
    return BigInt(value);
  };
  const hex = (value: unknown, bytes: number) => {
    requireValue(controlHex(value, bytes), 'CONTROL_JOURNAL_HEX_REFUSED'); return value.toLowerCase();
  };
  const deployment = { chainId: decimal(d.chainId), controller: hex(d.controller, 20), runtimeCodeHash: hex(d.runtimeCodeHash, 32) };
  validateControlPin(deployment);
  const kind = r.kind as ControlAction['kind'];
  requireValue(r.sequenceId === null && r.expectedRevision === null && r.legId === null && r.acceptanceHash === null, 'CONTROL_JOURNAL_ACTION_REFUSED');
  requireValue(hashControlBytes(encodeCall('createAccount()', [], [])) === r.calldataHash, 'CONTROL_JOURNAL_ACTION_REFUSED');
  return Object.freeze({ schema: '8415-control-submission/1', deployment: Object.freeze(deployment), kind,
    transactionHash: hex(r.transactionHash, 32), actor: hex(r.actor, 20), nonce: decimal(r.nonce), calldataHash: hex(r.calldataHash, 32),
    sequenceId: null, expectedRevision: null, legId: null, acceptanceHash: null });
}

import { RpcBlockEndHistoryDiscovery } from '../src/controls/historyDiscovery.ts';
import { RpcHistoryMilestoneValidator } from '../src/controls/historyMilestone.ts';
import { ResponsibilityControlClient } from '../src/controls/client.ts';
import { controlRpc } from '../src/controls/authorization.ts';
import { ForwardProgressError } from './forward-progress-service.mjs';

const refuse = (condition, code = 'FORWARD_PROGRESS_READER_REFUSED') => {
  if (!condition) throw new ForwardProgressError(code);
};
const uint = v => typeof v === 'bigint' && v >= 0n && v < 1n << 256n;
const decimal = v => typeof v === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 1n << 256n;
const hash = v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
const address = v => typeof v === 'string' && /^0x[0-9a-f]{40}$/.test(v) && !/^0x0+$/.test(v);
const METHODS = new Set(['eth_chainId', 'eth_getCode', 'eth_getBlockByNumber', 'eth_call', 'eth_getLogs', 'eth_getTransactionReceipt']);
function fields(value, required, optional = []) {
  refuse(value !== null && typeof value === 'object' && !Array.isArray(value) &&
    [Object.prototype, null].includes(Object.getPrototypeOf(value)));
  const d = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(d);
  refuse(required.every(k => Object.hasOwn(d, k)) && keys.every(k => typeof k === 'string' &&
    [...required, ...optional].includes(k) && Object.hasOwn(d[k], 'value')));
  return Object.fromEntries(keys.map(k => [k, d[k].value]));
}
function immutable(value) {
  if (value !== null && typeof value === 'object') {
    for (const v of Object.values(value)) immutable(v);
    Object.freeze(value);
  }
  return value;
}
function quantity(value) {
  refuse(typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value));
  const n = BigInt(value); refuse(uint(n)); return n;
}
function bound(value, q) {
  return value?.kind === 'bound' && value.readOnly === true && value.canExecute === false &&
    value.displayMilestone === 'not-evaluated' && value.ownOccurrenceId &&
    Object.keys(q.principal).every(k => value.principal?.[k] === q.principal[k]) &&
    value.asset?.chainId === BigInt(q.asset.chainId) && value.asset.contract === q.asset.contract &&
    value.asset.tokenId === BigInt(q.asset.tokenId) && value.sequenceId === q.sequenceId &&
    uint(value.anchor?.blockNumber) && hash(value.anchor.blockHash) &&
    value.source?.snapshot && value.source.evidence;
}

/** Server-only composition of the actual H6/H8 reader and H7 validator.
 * Construct from existing approved provider/deployment/scan-origin capabilities,
 * NEVER request JSON. It adds no signer, session, grant or funds authority.
 * Only positive canonical DONE discovery is admitted. Block-end no-found is
 * not complete intra-block history and must never become historical:[] success.
 * Raw snapshots remain private to the authenticated service's whitelist/CAS.
 */
export function createRpcForwardProgressReader(options) {
  const c = fields(options, ['provider', 'pin', 'tenant', 'origin', 'fromBlock'], ['limits']);
  refuse(typeof c.tenant === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(c.tenant) && typeof c.origin === 'string');
  let originOk = false;
  try { const u = new URL(c.origin); originOk = u.origin === c.origin && ['http:', 'https:'].includes(u.protocol); } catch {}
  refuse(originOk && uint(c.fromBlock), 'FORWARD_PROGRESS_READER_CONFIG_REFUSED');
  const limits = fields(c.limits ?? {}, [], ['blocksPerRequest', 'maximumWindows', 'maximumRecords', 'maximumRetainedLegs', 'maximumBlocks']);
  refuse(Object.values(limits).every(v => uint(v) && v > 0n), 'FORWARD_PROGRESS_READER_CONFIG_REFUSED');
  Object.freeze(limits);
  // Copy descriptors before constructing a client; caller accessors cannot run.
  const pinInput = fields(c.pin, ['chainId', 'controller', 'runtimeCodeHash']);
  const descriptor = Object.getOwnPropertyDescriptor(c.provider ?? {}, 'request');
  refuse(descriptor && Object.hasOwn(descriptor, 'value') && typeof descriptor.value === 'function',
    'FORWARD_PROGRESS_READER_CONFIG_REFUSED');
  const capturedRequest = descriptor.value.bind(c.provider);
  const provider = Object.freeze({ request: async args => {
    const a = fields(args, ['method'], ['params']);
    refuse(METHODS.has(a.method), 'FORWARD_PROGRESS_RPC_METHOD_REFUSED');
    return capturedRequest(Object.freeze({method: a.method, ...(Object.hasOwn(a, 'params') ? {params: a.params} : {})}));
  }});
  const pin = immutable(new ResponsibilityControlClient(provider, pinInput).deployment);
  const namespace = Object.freeze({tenant: c.tenant, origin: c.origin}), fromBlock = c.fromBlock;
  const discovery = new RpcBlockEndHistoryDiscovery(provider, pin, namespace, fromBlock, limits);
  const validator = new RpcHistoryMilestoneValidator(provider, pin, namespace, fromBlock, limits);
  function query(input, extra = []) {
    const q = fields(input, ['principal', 'asset', 'sequenceId', ...extra]);
    const p = fields(q.principal, ['tenant', 'origin', 'username', 'account', 'chainId']);
    const a = fields(q.asset, ['chainId', 'contract', 'tokenId']);
    refuse(p.tenant === namespace.tenant && p.origin === namespace.origin &&
      typeof p.username === 'string' && p.username.length > 0 && p.username.length <= 256 &&
      address(p.account) && decimal(p.chainId) && p.chainId !== '0' &&
      BigInt(p.chainId) === pin.chainId && a.chainId === p.chainId &&
      address(a.contract) && decimal(a.tokenId) && hash(q.sequenceId));
    return Object.freeze({...q, principal: Object.freeze(p), asset: Object.freeze(a)});
  }
  return Object.freeze({
    async readForPrincipal(input) {
      const q = query(input);
      try {
        const h = await controlRpc(provider, 'eth_getBlockByNumber', ['latest', false]);
        const anchor = Object.freeze({blockNumber: quantity(h?.number), blockHash: h?.hash});
        refuse(hash(anchor.blockHash) && fromBlock <= anchor.blockNumber);
        const result = await discovery.discoverAt({principal: q.principal,
          asset: {chainId: BigInt(q.asset.chainId), contract: q.asset.contract, tokenId: BigInt(q.asset.tokenId)},
          sequenceId: q.sequenceId, anchor});
        refuse(result?.kind === 'found', 'FORWARD_PROGRESS_HISTORY_UNAVAILABLE');
        const {current, candidate, coverage, progress} = result;
        refuse(bound(current, q) && bound(candidate, q) && hash(current.ownOccurrenceId) &&
          current.ownOccurrenceId === candidate.ownOccurrenceId && current.ownPosition === candidate.ownPosition &&
          current.anchor.blockNumber === anchor.blockNumber && current.anchor.blockHash === anchor.blockHash &&
          candidate.anchor.blockNumber <= anchor.blockNumber && progress?.state === 'DONE' && progress.canExecute === false &&
          progress.blockNumber === candidate.anchor.blockNumber.toString() && progress.blockHash === candidate.anchor.blockHash &&
          coverage?.kind === 'canonical-block-end-only' && coverage.intraBlockStates === 'not-established' &&
          coverage.canExecute === false && uint(coverage.checkedBlocks) && coverage.checkedBlocks > 0n &&
          uint(coverage.from?.blockNumber) && hash(coverage.from.blockHash) &&
          coverage.from.blockNumber >= fromBlock && coverage.through?.blockNumber === candidate.anchor.blockNumber &&
          coverage.through.blockHash === candidate.anchor.blockHash &&
          coverage.checkedBlocks === coverage.through.blockNumber - coverage.from.blockNumber + 1n);
        // This port is private: service reprojects, independently validates and
        // atomically freezes the public milestone with credential revision CAS.
        return immutable(structuredClone({snapshot: current.source.snapshot, evidence: current.source.evidence,
          ownOccurrenceId: current.ownOccurrenceId,
          historical: [{snapshot: candidate.source.snapshot, evidence: candidate.source.evidence}]}));
      } catch (error) {
        throw new ForwardProgressError('FORWARD_PROGRESS_HISTORY_UNAVAILABLE');
      }
    },
    async validateMilestone(input) {
      const q = query(input, ['ownOccurrenceId', 'milestone']);
      refuse(hash(q.ownOccurrenceId));
      try { return await validator.validateMilestone(q) === true; }
      catch (error) {
        throw new ForwardProgressError('FORWARD_PROGRESS_MILESTONE_UNAVAILABLE');
      }
    },
  });
}

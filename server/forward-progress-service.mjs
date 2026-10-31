import { validateCoordinationView } from '../web/coordination-view.mjs';
import { createHash } from 'node:crypto';
import { buildForwardProgress } from '../src/wallet/forwardProgress.ts';

export class ForwardProgressError extends Error {
  constructor(code = 'FORWARD_PROGRESS_UNAVAILABLE', status = 503) { super(code); this.status = status; }
}
const refuse = (condition, code = 'FORWARD_PROGRESS_SOURCE_REFUSED', status = 503) => {
  if (!condition) throw new ForwardProgressError(code, status);
};
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value) && value.length <= 78 && BigInt(value) < 1n << 256n;
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value);
function fields(value, names) {
  refuse(value !== null && typeof value === 'object' && !Array.isArray(value), 'FORWARD_PROGRESS_REQUEST_REFUSED', 400);
  const descriptors = Object.getOwnPropertyDescriptors(value), keys = Reflect.ownKeys(descriptors);
  refuse(keys.length === names.length && names.every(name => descriptors[name] && 'value' in descriptors[name]) &&
    keys.every(key => typeof key === 'string' && names.includes(key)), 'FORWARD_PROGRESS_REQUEST_REFUSED', 400);
}
function request(body, session) {
  fields(body, ['asset', 'sequenceId']); fields(body.asset, ['chainId', 'contract', 'tokenId']);
  const { chainId, contract, tokenId } = body.asset;
  refuse(uint(chainId) && chainId !== '0' && chainId === session.chainId && uint(tokenId) &&
    typeof contract === 'string' && /^0x[0-9a-f]{40}$/.test(contract) && !/^0x0+$/.test(contract) && hash(body.sequenceId),
  'FORWARD_PROGRESS_REQUEST_REFUSED', 400);
  return Object.freeze({ asset: Object.freeze({ chainId, contract, tokenId }), sequenceId: body.sequenceId });
}
function bound(projection, input) {
  return projection.asset.chainId === input.asset.chainId && projection.asset.contract.toLowerCase() === input.asset.contract &&
    projection.asset.tokenId === input.asset.tokenId && projection.sequenceId === input.sequenceId;
}
function projection(source, input, ownOccurrenceId) {
  refuse(source && source.snapshot && source.evidence && hash(ownOccurrenceId));
  let result;
  try { result = buildForwardProgress(source.snapshot, source.evidence, ownOccurrenceId); }
  catch { throw new ForwardProgressError('FORWARD_PROGRESS_SOURCE_REFUSED'); }
  refuse(bound(result, input)); return result;
}
function record(value, binding) {
  if (value === null) return null;
  refuse(value?.schema === '8415-forward-progress-record/1' && value.binding === binding && uint(value.revision) &&
    value.progress?.schema === '8415-forward-progress/1' && typeof value.frozen === 'boolean' &&
    (value.progress.state === 'DONE') === value.frozen && value.progress.canExecute === false,
  'FORWARD_PROGRESS_RECORD_REFUSED');
  if(value.coordinated) {try {validateCoordinationView(value.coordinated,value.progress.userPosition);}catch {throw new ForwardProgressError('FORWARD_PROGRESS_RECORD_REFUSED');}}
  return value;
}
// A persisted row is never serialized wholesale to the API. This whitelist is
// also applied after reload, so unrelated record fields cannot leak identities.
function publicProgress(value) {
  refuse(value?.schema === '8415-forward-progress/1' && hash(value.sequenceId) && hash(value.blockHash) &&
    [value.userPosition, value.sourceRevision, value.blockNumber, value.knownEnd, value.scaleEnd].every(uint) &&
    BigInt(value.knownEnd) + 1n === BigInt(value.scaleEnd) && BigInt(value.userPosition) <= BigInt(value.knownEnd) &&
    ['DONE', 'PENDING', 'UNAVAILABLE'].includes(value.state) &&
    (value.protocolFinality === null || typeof value.protocolFinality === 'boolean'), 'FORWARD_PROGRESS_RECORD_REFUSED');
  for (const item of [value.owner, value.holder]) {
    refuse(item && item.unchangedThrough === value.knownEnd && item.untradedThrough === value.scaleEnd &&
      (item.state === 'unavailable' ? item.position === null && item.changedThrough === null && item.ratio === null :
        item.state === 'observed' && uint(item.position) && BigInt(item.position) <= BigInt(value.knownEnd) &&
        item.changedThrough === item.position && item.ratio?.numerator === item.position && item.ratio?.denominator === value.scaleEnd),
    'FORWARD_PROGRESS_RECORD_REFUSED');
  }
  const done = value.owner.position !== null && value.holder.position !== null &&
    BigInt(value.owner.position) >= BigInt(value.userPosition) && value.holder.position === value.userPosition;
  refuse((value.state === 'DONE') === done && (value.state === 'UNAVAILABLE') === (value.owner.position === null || value.holder.position === null),
    'FORWARD_PROGRESS_RECORD_REFUSED');
  const track = item => ({ state: item.state, position: item.position, changedThrough: item.changedThrough,
    unchangedThrough: item.unchangedThrough, untradedThrough: item.untradedThrough,
    ratio: item.ratio === null ? null : { numerator: item.ratio.numerator, denominator: item.ratio.denominator } });
  return { schema: value.schema, asset: { chainId: value.asset.chainId, contract: value.asset.contract, tokenId: value.asset.tokenId },
    sequenceId: value.sequenceId, userPosition: value.userPosition, sourceRevision: value.sourceRevision,
    blockNumber: value.blockNumber, blockHash: value.blockHash, knownEnd: value.knownEnd, scaleEnd: value.scaleEnd,
    state: value.state, owner: track(value.owner), holder: track(value.holder),
    funds: { state: 'not-evaluated' }, rollback: { state: 'not-evaluated' },
    protocolFinality: value.protocolFinality, commercialExecution: 'not-evaluated', canExecute: false };
}

/** Server-owned trusted reader port. Never construct this reader from a request.
 * readForPrincipal MUST authorize the authenticated principal's own occurrence,
 * verify the chain/register snapshot and admitted evidence, and return only that
 * occurrence plus bounded canonical historical snapshots needed after missed reads.
 * validateMilestone MUST independently revalidate canonical milestone provenance;
 * a client's `verified`/`complete` flag cannot implement either method.
 * The existing encrypted store supplies serialized credential+record CAS/durability.
 * No financial completion, grant, token transfer or transaction send is performed.
 */
export function createForwardProgressService({ store, reader = null, assertSession, tenant, origin }) {
  refuse(store && typeof store.read === 'function' && typeof store.transactionMany === 'function' && typeof assertSession === 'function');
  refuse(typeof tenant === 'string' && /^[a-z][a-z0-9-]{0,47}$/.test(tenant) && typeof origin === 'string' && origin.length > 0);
  const readForPrincipal = reader?.readForPrincipal, validateMilestone = reader?.validateMilestone, readCoordination = reader?.readCoordination;
  refuse(readCoordination===undefined||typeof readCoordination==='function','FORWARD_PROGRESS_READER_CONFIG_REFUSED');
  refuse(reader === null || typeof readForPrincipal === 'function' && typeof validateMilestone === 'function', 'FORWARD_PROGRESS_READER_CONFIG_REFUSED');
  async function read(body, session) {
    assertSession(session);
    const input = request(body, session);
    refuse(reader !== null, 'FORWARD_PROGRESS_NOT_ENABLED');
    // Only server-authenticated identity reaches the trusted entitlement reader.
    const principal = Object.freeze({ tenant, origin, username: session.username,
      account: session.account.toLowerCase(), chainId: session.chainId });
    const source = structuredClone(await readForPrincipal.call(reader, Object.freeze({ principal, ...input })));
    assertSession(session);
    refuse(source && hash(source.ownOccurrenceId) && Array.isArray(source.historical) && source.historical.length <= 128);
    const current = projection(source, input, source.ownOccurrenceId);
    const binding = createHash('sha256').update(JSON.stringify({ principal, ...input, ownOccurrenceId: source.ownOccurrenceId })).digest('hex');
    const progressKey = `forward-progress:${binding}`, credentialKey = `${tenant}:${session.username}`;
    const previous = record(await store.read(progressKey), binding); assertSession(session);
    if (previous) refuse(bound(previous.progress, input) && previous.progress.userPosition === current.userPosition,
      'FORWARD_PROGRESS_RECORD_BINDING_REFUSED');
    let selected = current;
    if (previous?.frozen) {
      // Retain the stored milestone bytes. A changed read must not move DONE.
      // Unverifiable/reorged provenance is an error, never an optimistic response.
      refuse(await validateMilestone.call(reader, Object.freeze({ principal, ...input, ownOccurrenceId: source.ownOccurrenceId,
        milestone: publicProgress(previous.progress) })) === true, 'FORWARD_PROGRESS_MILESTONE_UNAVAILABLE');
      selected = previous.progress;
    } else {
      const completed = [];
      if (current.state === 'DONE') completed.push(current);
      for (const historical of source.historical) {
        const candidate = projection(historical, input, source.ownOccurrenceId);
        refuse(candidate.userPosition === current.userPosition && BigInt(candidate.blockNumber) <= BigInt(current.blockNumber) &&
          BigInt(candidate.sourceRevision) <= BigInt(current.sourceRevision));
        if (candidate.state === 'DONE') completed.push(candidate);
      }
      completed.sort((a, b) => BigInt(a.blockNumber) < BigInt(b.blockNumber) ? -1 : BigInt(a.blockNumber) > BigInt(b.blockNumber) ? 1 : 0);
      if (completed.length) {
        selected = completed[0];
        refuse(await validateMilestone.call(reader, Object.freeze({ principal, ...input, ownOccurrenceId: source.ownOccurrenceId,
          milestone: publicProgress(selected) })) === true, 'FORWARD_PROGRESS_MILESTONE_UNAVAILABLE');
      }
    }
    refuse(!previous?.coordinated||typeof readCoordination==='function','FORWARD_PROGRESS_COORDINATION_READER_REQUIRED');
    let coordinated=null;
    if(readCoordination){
      const old=previous?.coordinated;
      const anchor=old?.rollback.state==='DONE'?{blockNumber:old.coordination.blockNumber,blockHash:old.coordination.blockHash}:{blockNumber:current.blockNumber,blockHash:current.blockHash};
      let raw;try {raw=await readCoordination.call(reader,Object.freeze({principal,...input,ownOccurrenceId:source.ownOccurrenceId,anchor:Object.freeze(anchor)}));}catch {throw new ForwardProgressError('FORWARD_PROGRESS_COORDINATION_UNAVAILABLE');}
      assertSession(session);
      refuse(raw&&Object.keys(principal).every(k=>raw.principal?.[k]===principal[k])&&raw.asset?.chainId===input.asset.chainId&&raw.asset.contract===input.asset.contract&&raw.asset.tokenId===input.asset.tokenId&&raw.sequenceId===input.sequenceId&&raw.ownOccurrenceId===source.ownOccurrenceId,'FORWARD_PROGRESS_COORDINATION_BINDING_REFUSED');
      try {coordinated=structuredClone(validateCoordinationView(raw.view,current.userPosition));}catch {throw new ForwardProgressError('FORWARD_PROGRESS_COORDINATION_SOURCE_REFUSED');}
      refuse(coordinated.coordination.blockNumber===anchor.blockNumber&&coordinated.coordination.blockHash===anchor.blockHash,'FORWARD_PROGRESS_COORDINATION_BLOCK_REFUSED');
      if(old?.rollback.state==='DONE')refuse(JSON.stringify(coordinated)===JSON.stringify(old),'FORWARD_PROGRESS_COORDINATION_MILESTONE_UNAVAILABLE');
      else {
        refuse(coordinated.coordination.sourceRevision===current.sourceRevision&&coordinated.coordination.knownEnd===current.knownEnd,'FORWARD_PROGRESS_COORDINATION_SNAPSHOT_REFUSED');
        if(old)refuse(BigInt(coordinated.coordination.blockNumber)>=BigInt(old.coordination.blockNumber)&&BigInt(coordinated.coordination.sourceRevision)>=BigInt(old.coordination.sourceRevision),'FORWARD_PROGRESS_COORDINATION_STALE_SOURCE');
      }
    }
    assertSession(session);
    const result = await store.transactionMany([credentialKey, progressKey], values => {
      assertSession(session, values[credentialKey]);
      const live = record(values[progressKey], binding);
      // Concurrent read completion cannot overwrite or borrow another completion.
      // Retry only this read when the original record changed; never replay a send.
      refuse(JSON.stringify(live) === JSON.stringify(previous), 'FORWARD_PROGRESS_REVISION_CHANGED', 409);
      if (live?.frozen && JSON.stringify(live.coordinated??null)===JSON.stringify(coordinated)) return { [credentialKey]: values[credentialKey], [progressKey]: live };
      if (live) refuse(BigInt(current.sourceRevision) >= BigInt(live.progress.sourceRevision) &&
        BigInt(current.blockNumber) >= BigInt(live.progress.blockNumber), 'FORWARD_PROGRESS_STALE_SOURCE', 409);
      const revision = (BigInt(live?.revision ?? '0') + 1n).toString();
      refuse(uint(revision), 'FORWARD_PROGRESS_REVISION_REFUSED');
      const next = { schema: '8415-forward-progress-record/1', binding,
        revision, frozen: selected.state === 'DONE', progress: publicProgress(selected),...(coordinated?{coordinated}:{}) };
      return { [credentialKey]: values[credentialKey], [progressKey]: next };
    });
    assertSession(session);
    const saved = record(result[progressKey], binding);
    // No adjacent identities, own-occurrence ID, credential or reader object is returned.
    return { ...publicProgress(saved.progress),...(saved.coordinated?{schema:'8415-forward-progress/2',...saved.coordinated}:{}), recordRevision: saved.revision, frozen: saved.frozen };
  }
  return Object.freeze({ read });
}

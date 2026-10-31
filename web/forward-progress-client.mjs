import {validateCoordinationView} from './coordination-view.mjs';
/** Strict own-occurrence API contract. No chain reads or execution authority. */
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < (1n << 256n);
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value) && !/^0x0+$/.test(value);
const address = value => typeof value === 'string' && /^0x[0-9a-f]{40}$/.test(value) && !/^0x0+$/.test(value);
const refuse = ok => { if (!ok) throw new Error('FORWARD_PROGRESS_RESPONSE_REFUSED'); };
function exact(value, fields) {
  refuse(value !== null && typeof value === 'object' && !Array.isArray(value));
  const keys = Object.keys(value);
  refuse(keys.length === fields.length && fields.every(key => Object.hasOwn(value, key)));
}
export function forwardProgressRequest(input, chainId) {
  exact(input, ['asset', 'sequenceId']); exact(input.asset, ['chainId', 'contract', 'tokenId']);
  refuse(uint(chainId) && chainId !== '0' && input.asset.chainId === chainId && address(input.asset.contract) &&
    uint(input.asset.tokenId) && hash(input.sequenceId));
  return { asset: { chainId, contract: input.asset.contract, tokenId: input.asset.tokenId }, sequenceId: input.sequenceId };
}
export function validateForwardProgress(value, input) {
  exact(value, ['schema','asset','sequenceId','userPosition','sourceRevision','blockNumber','blockHash','knownEnd','scaleEnd',
    'state','owner','holder','funds','rollback','protocolFinality','commercialExecution','canExecute','recordRevision','frozen',...(value?.schema==='8415-forward-progress/2'?['coordination']:[])]);
  exact(value.asset, ['chainId', 'contract', 'tokenId']);
  refuse(['8415-forward-progress/1','8415-forward-progress/2'].includes(value.schema) && value.asset.chainId === input.asset.chainId &&
    value.asset.contract === input.asset.contract && value.asset.tokenId === input.asset.tokenId && value.sequenceId === input.sequenceId &&
    [value.userPosition,value.sourceRevision,value.blockNumber,value.knownEnd,value.scaleEnd,value.recordRevision].every(uint) &&
    hash(value.blockHash) && BigInt(value.recordRevision) > 0n && BigInt(value.knownEnd) + 1n === BigInt(value.scaleEnd) &&
    BigInt(value.userPosition) <= BigInt(value.knownEnd) && value.canExecute === false && value.commercialExecution === 'not-evaluated' &&
    (value.protocolFinality === null || typeof value.protocolFinality === 'boolean'));
  for (const track of [value.owner, value.holder]) {
    exact(track, ['state','position','changedThrough','unchangedThrough','untradedThrough','ratio']);
    refuse(track.unchangedThrough === value.knownEnd && track.untradedThrough === value.scaleEnd);
    if (track.state === 'unavailable') refuse(track.position === null && track.changedThrough === null && track.ratio === null);
    else {
      exact(track.ratio, ['numerator','denominator']);
      refuse(track.state === 'observed' && uint(track.position) && BigInt(track.position) <= BigInt(value.knownEnd) &&
        track.changedThrough === track.position && track.ratio.numerator === track.position && track.ratio.denominator === value.scaleEnd);
    }
  }
  const unavailable = value.owner.position === null || value.holder.position === null;
  const done = !unavailable && BigInt(value.owner.position) >= BigInt(value.userPosition) && value.holder.position === value.userPosition;
  refuse(value.state === (unavailable ? 'UNAVAILABLE' : done ? 'DONE' : 'PENDING') && value.frozen === done);
  if(value.schema==='8415-forward-progress/2')validateCoordinationView({coordination:value.coordination,funds:value.funds,rollback:value.rollback},value.userPosition);
  else {exact(value.funds, ['state']); exact(value.rollback, ['state']);
  refuse(value.funds.state === 'not-evaluated' && value.rollback.state === 'not-evaluated');}
  return value;
}

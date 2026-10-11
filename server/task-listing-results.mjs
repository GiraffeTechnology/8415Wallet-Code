/** Server-owned connection from the native order to the durable observation consumer.
 * read() revalidates persisted anchors; only scan() discovers one bounded page set.
 * Neither method signs, publishes, releases budget or interprets depth as finality. */
import { createHash } from 'node:crypto';
import { freezeNftListingChild, freezeTaskPolicy } from '../src/agent/taskContract.ts';
import { createTaskListingObservationConsumer } from './task-listing-observation-consumer.mjs';
const check = ok => { if (!ok) throw Error('TASK_LISTING_RESULTS_BINDING_REFUSED'); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const canonical = value => Array.isArray(value) ? value.map(canonical) : value && typeof value === 'object'
  ? Object.fromEntries(Object.keys(value).sort().map(key => [key, canonical(value[key])])) : value;
const digest = value => createHash('sha256').update(JSON.stringify(canonical(value))).digest('hex');
export function createTaskListingResults({ store, observationSource, canonicalReader, observationPolicyId, now = Date.now }) {
  check(typeof store?.readMany === 'function' && typeof store?.transactionMany === 'function' &&
    typeof observationSource === 'function' && typeof canonicalReader?.request === 'function' && typeof now === 'function' &&
    /^[A-Za-z0-9_-]{1,128}$/.test(observationPolicyId ?? ''));
  const source = observationSource, reader = Object.freeze({ sourceId: canonicalReader.sourceId, request: canonicalReader.request.bind(canonicalReader) });
  async function consumer(input) {
    const captured = structuredClone(input), task = freezeTaskPolicy(captured.task.policy), child = freezeNftListingChild(captured.child.child), c = child.child;
    check(task.digest === captured.task.digest && child.digest === captured.child.digest && c.taskDigest === task.digest &&
      task.policy.intent.kind === 'nft-sale' && c.chainId === task.policy.chainId && c.seller === task.policy.actor &&
      c.nft.standard === task.policy.intent.standard && c.nft.contract === task.policy.intent.contract &&
      c.nft.tokenId === task.policy.intent.tokenId && c.nft.quantity === task.policy.intent.quantity && c.executorDigest === captured.executor.digest && c.grantReference === captured.grantReference &&
      c.grantPolicyVersion === captured.grantPolicyVersion && c.valuationPolicyDigest === captured.valuationPolicy.digest);
    const minimum = Number(captured.observationPolicy?.policy.minimumConfirmations);
    check(Number.isSafeInteger(minimum) && minimum >= 1);
    const { order, observer } = await source(captured);
    check(order?.schema === 'artfi-nft-sale-order/1' && order.nativeAction === 'list' &&
      order.binding.taskDigest === task.digest && order.binding.orderHash.toLowerCase() === c.orderHash &&
      order.binding.nativePlanId === c.nativePlanId && order.binding.nativeOperationId === c.nativeOperationId &&
      order.binding.reviewDigest === c.reviewDigest && same(order.binding.typedDataDigest, c.typedDataDigest) &&
      order.binding.valuationPolicyDigest === c.valuationPolicyDigest && order.binding.quoteEvidenceDigest === c.quoteEvidenceDigest &&
      order.chainId === c.chainId && same(order.protocol, c.protocol) && same(order.seller, c.seller) &&
      order.nft.standard === (c.nft.standard === 'ERC-1155' ? 'erc1155' : 'erc721') && same(order.nft.contract, c.nft.contract) && order.nft.tokenId === c.nft.tokenId &&
      order.nft.quantity === c.nft.quantity && order.nft.quantity === task.policy.intent.quantity &&
      Array.isArray(order.components?.offer) && order.components.offer.length === 1);
    return createTaskListingObservationConsumer({ store, observer, canonicalReader: reader, now, binding: {
      taskDigest: task.digest, childDigest: child.digest, chainId: c.chainId, orderHash: c.orderHash, orderDigest: digest(order),
      sourceId: reader.sourceId, observationPolicyId, minimumConfirmations: minimum,
      requestedQuantity: task.policy.intent.quantity, orderQuantity: order.components.offer[0].startAmount,
    } });
  }
  return Object.freeze({ read: async input => (await consumer(input)).readSummary(), scan: async input => (await consumer(input)).scan() });
}

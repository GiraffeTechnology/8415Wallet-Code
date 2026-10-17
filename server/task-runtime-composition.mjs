/** Server-only composition. Each port keeps its own approval identity/policy. */
import { freezeTaskExecutorIdentity } from './task-authorization.mjs';
import { freezeTaskObservationPolicy } from '../src/agent/receiptObservation.ts';
const fields = {
  exact: ['taskExecution', 'taskReceipt', 'taskExecutorIdentity', 'taskObservationPolicy'],
  listing: ['taskListingExecution', 'taskListingResults', 'taskListingRuntimeStatus', 'taskExecutorIdentity', 'taskObservationPolicy'],
  artfi: ['taskReceiptHandlerId', 'taskExecutorIdentity'],
};
const refuse = code => { throw Error(code); };
export function composeTaskAuthOptions({ exact = {}, listing = {}, artfi = {} } = {}) {
  const result = {}, bindings = {}, identities = new Set();
  for (const [channel, options] of Object.entries({ exact, listing, artfi })) {
    if (!options || ![Object.prototype, null].includes(Object.getPrototypeOf(options))) refuse('TASK_RUNTIME_OPTIONS_REFUSED');
    const descriptors = Object.getOwnPropertyDescriptors(options), values = {};
    for (const key of Reflect.ownKeys(descriptors)) {
      if (!fields[channel].includes(key) || !Object.hasOwn(descriptors[key], 'value')) refuse('TASK_RUNTIME_OPTIONS_REFUSED');
      values[key] = descriptors[key].value;
    }
    const active = channel === 'exact' ? values.taskExecution != null :
      channel === 'listing' ? values.taskListingExecution != null : values.taskReceiptHandlerId != null;
    if (!active) {
      if (values.taskExecutorIdentity != null || values.taskObservationPolicy != null ||
          values.taskReceipt != null || values.taskListingResults != null) refuse('TASK_RUNTIME_UNUSED_BINDING_REFUSED');
    } else {
      if (values.taskExecutorIdentity == null) refuse('TASK_RUNTIME_EXECUTOR_REQUIRED');
      const executor = freezeTaskExecutorIdentity(values.taskExecutorIdentity);
      if (identities.has(executor.digest)) refuse('TASK_RUNTIME_EXECUTOR_REUSE_REFUSED');
      identities.add(executor.digest);
      let policy = null;
      if (channel !== 'artfi') {
        if (values.taskObservationPolicy == null) refuse('TASK_RUNTIME_OBSERVATION_REQUIRED');
        policy = freezeTaskObservationPolicy(values.taskObservationPolicy).policy;
      } else if (values.taskReceiptHandlerId !== 'artfi:whole-receipt:v1') refuse('TASK_RUNTIME_RECEIPT_HANDLER_REFUSED');
      const kind = channel === 'exact' ? 'exact-operation' : channel === 'listing' ? 'nft-sale' : 'artfi-receipt';
      bindings[kind] = Object.freeze({ executorIdentity: executor.identity, observationPolicy: policy });
    }
    for (const [key, value] of Object.entries(values)) {
      if (key === 'taskExecutorIdentity' || key === 'taskObservationPolicy') continue;
      if (Object.hasOwn(result, key)) refuse('TASK_RUNTIME_OPTIONS_CONFLICT');
      result[key] = value;
    }
  }
  // Do not fabricate a composite identity or rewrite any adapter's executor.
  if (Object.keys(bindings).length) result.taskChannelBindings = Object.freeze(bindings);
  return Object.freeze(result);
}

/** Server-only construction of the existing exact executor and read-only observer.
 * This is not a capability loader: HTTP/config JSON cannot supply the ports.
 * The standard entry still needs an approved, fixed installation binding.
 */
import { createTaskExactSignerAdapter } from './task-exact-signer-adapter.mjs';
import { createTaskReceiptAdapter } from './task-receipt-adapter.mjs';
import { freezeTaskObservationPolicy } from '../src/agent/receiptObservation.ts';

const refuse = () => { throw Error('TASK_EXACT_RUNTIME_CONFIG_REFUSED'); };
function configuration(value) {
  if (!value || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) refuse();
  const required = ['provider', 'externalSigner', 'signerIdentity', 'maxPriorityFeePerGasWei',
    'agentId', 'agentVersion', 'observationPolicy'];
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).some(key => ![...required, 'plannerFeeRule', 'testAssetPins'].includes(key)) ||
      required.some(key => !Object.hasOwn(descriptors, key)) ||
      Object.values(descriptors).some(field => !Object.hasOwn(field, 'value'))) refuse();
  return value;
}

export function createTaskExactRuntime({ store, serverConfiguration = null, now = Date.now } = {}) {
  if (serverConfiguration === null) return Object.freeze({ state: 'disabled', code: 'TASK_EXACT_NOT_CONFIGURED',
    authOptions: Object.freeze({}) });
  const c = configuration(serverConfiguration);
  // One captured request port is used by both adapters. Each adapter retains its
  // existing method allowlist. The observer is never given the sign-only port.
  if (typeof c.provider?.request !== 'function' || typeof c.externalSigner?.signExactTransaction !== 'function') refuse();
  const provider = Object.freeze({ request: c.provider.request.bind(c.provider) });
  const externalSigner = Object.freeze({ signExactTransaction: c.externalSigner.signExactTransaction.bind(c.externalSigner) });
  const policy = freezeTaskObservationPolicy(c.observationPolicy);
  const execution = createTaskExactSignerAdapter({ provider, externalSigner, store, now,
    signerIdentity: structuredClone(c.signerIdentity), maxPriorityFeePerGasWei: c.maxPriorityFeePerGasWei,
    agentId: c.agentId, agentVersion: c.agentVersion, testAssetPins: c.testAssetPins ?? [],
    plannerFeeRule: c.plannerFeeRule === undefined ? null : structuredClone(c.plannerFeeRule) });
  const receipt = createTaskReceiptAdapter({ provider, observationPolicy: policy.policy, testAssetPins: c.testAssetPins ?? [], now });
  return Object.freeze({ state: 'configured', code: null, authOptions: Object.freeze({
    taskExecution: execution, taskExecutorIdentity: execution.identity,
    taskReceipt: receipt, taskObservationPolicy: policy.policy,
  }) });
}


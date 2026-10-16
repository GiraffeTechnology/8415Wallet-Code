/** Non-executable deployment contract for the fixed exact JSON-RPC bridge. */
import { isAbsolute, normalize } from 'node:path';
const fail = () => { throw Error('TASK_EXACT_DEPLOYMENT_CONFIG_REFUSED'); };
function fields(v, names) {
  if (!v || Object.getPrototypeOf(v) !== Object.prototype) fail();
  const d = Object.getOwnPropertyDescriptors(v);
  if (Reflect.ownKeys(d).length !== names.length || names.some(k => !Object.hasOwn(d, k) || !Object.hasOwn(d[k], 'value'))) fail();
}
const hash = v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
const id = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v);
function endpoint(v) {
  fields(v, ['url', 'timeoutMs', 'tls']);
  let u; try { u = new URL(v.url); } catch { fail(); }
  if (typeof v.url !== 'string' || u.href !== v.url || u.protocol !== 'https:' || u.username || u.password || u.search || u.hash ||
      !Number.isSafeInteger(v.timeoutMs) || v.timeoutMs < 1 || v.timeoutMs > 60000) fail();
  fields(v.tls, ['certFile', 'keyFile', 'caFile', 'serverFingerprint256']);
  if (!['certFile', 'keyFile', 'caFile'].every(k => typeof v.tls[k] === 'string' && isAbsolute(v.tls[k]) &&
      normalize(v.tls[k]) === v.tls[k] && !v.tls[k].includes('\0')) ||
      typeof v.tls.serverFingerprint256 !== 'string' || !/^[a-f0-9]{64}$/.test(v.tls.serverFingerprint256)) fail();
}
export function validateTaskExactConfig(value) {
  if (value === null || value === undefined) return null;
  if (Object.getOwnPropertyDescriptor(value, 'enabled')?.value === false) {
    fields(value, ['schema', 'enabled']);
    if (value.schema !== '8415-task-exact-runtime/1') fail();
    return { schema: value.schema, enabled: false };
  }
  fields(value, ['schema', 'enabled', 'chainId', 'rpc', 'wallet', 'signerIdentity',
    'maxPriorityFeePerGasWei', 'agentId', 'agentVersion', 'observationPolicy', 'plannerFeeRule']);
  if (value.schema !== '8415-task-exact-runtime/1' || value.enabled !== true || value.chainId !== '560048') fail();
  endpoint(value.rpc); endpoint(value.wallet);
  fields(value.signerIdentity, ['signerId', 'signerVersion', 'implementationDigest']);
  if (!id(value.signerIdentity.signerId) || !id(value.signerIdentity.signerVersion) || !hash(value.signerIdentity.implementationDigest) ||
      !id(value.agentId) || !id(value.agentVersion) || typeof value.maxPriorityFeePerGasWei !== 'string' ||
      !/^(0|[1-9][0-9]{0,77})$/.test(value.maxPriorityFeePerGasWei) || BigInt(value.maxPriorityFeePerGasWei) >= 1n << 256n) fail();
  fields(value.observationPolicy, ['minimumConfirmations']);
  if (typeof value.observationPolicy.minimumConfirmations !== 'string' ||
      !/^[1-9][0-9]{0,3}$/.test(value.observationPolicy.minimumConfirmations) ||
      Number(value.observationPolicy.minimumConfirmations) > 1024) fail();
  // The existing exact planner performs strict rule validation at construction.
  // JSON clone refuses functions/accessors before any endpoint or credential use.
  const assertJSON = v => {
    if (v === null || ['string', 'boolean'].includes(typeof v)) return;
    if (typeof v === 'number' && Number.isSafeInteger(v)) return;
    if (!v || Object.getPrototypeOf(v) !== Object.prototype) fail();
    for (const key of Reflect.ownKeys(v)) {
      const d = Object.getOwnPropertyDescriptor(v, key);
      if (typeof key !== 'string' || !Object.hasOwn(d, 'value') || ['__proto__', 'constructor', 'toJSON'].includes(key)) fail();
      assertJSON(d.value);
    }
  };
  assertJSON(value.plannerFeeRule);
  return structuredClone(value);
}


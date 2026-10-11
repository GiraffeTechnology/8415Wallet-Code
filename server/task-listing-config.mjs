/** Non-secret deployment schema. It never accepts executable factories or module paths. */
import { isAbsolute, normalize } from 'node:path';
export const TASK_LISTING_RUNTIME_SCHEMA = '8415-task-listing-runtime/1';
const check = (ok, code = 'TASK_LISTING_CONFIG_REFUSED') => { if (!ok) throw Error(code); };
const plain = value => value && Object.getPrototypeOf(value) === Object.prototype;
const keys = (value, allowed) => check(plain(value) && Object.keys(value).every(key => allowed.includes(key)));
const text = value => typeof value === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
const file = value => typeof value === 'string' && isAbsolute(value) && normalize(value) === value && !value.includes('\0') && value.length <= 1024;
const fingerprint = value => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const timeout = value => Number.isSafeInteger(value) && value >= 1 && value <= 60000;
function url(value) {
  let parsed; try { parsed = new URL(value); } catch { return false; }
  return typeof value === 'string' && parsed.protocol === 'https:' && !parsed.username && !parsed.password && !parsed.search && !parsed.hash && parsed.href === value;
}
function tls(value) {
  keys(value, ['certFile', 'keyFile', 'caFile', 'serverFingerprint256']);
  check(['certFile', 'keyFile', 'caFile'].every(key => file(value[key])) && fingerprint(value.serverFingerprint256));
}
function jsonOnly(value, depth = 0) {
  check(depth <= 24);
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return;
  if (typeof value === 'number') { check(Number.isSafeInteger(value)); return; }
  check(Array.isArray(value) ? Object.getPrototypeOf(value) === Array.prototype : plain(value));
  check(Object.getOwnPropertySymbols(value).length === 0);
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Array.isArray(value)) check(Object.keys(descriptors).length === value.length + 1 && Object.keys(value).every((key, index) => key === String(index)));
  for (const [key, descriptor] of Object.entries(descriptors)) {
    if (Array.isArray(value) && key === 'length') continue;
    check(!['__proto__', 'prototype', 'constructor', 'toJSON'].includes(key) && Object.hasOwn(descriptor, 'value') && descriptor.enumerable);
    jsonOnly(descriptor.value, depth + 1);
  }
}
export function validateTaskListingConfig(value) {
  if (value === undefined || value === null) return null;
  jsonOnly(value);
  keys(value, ['schema', 'enabled', 'artfi', 'executor', 'observationPolicy', 'stores', 'peer', 'gateways']);
  check(value.schema === TASK_LISTING_RUNTIME_SCHEMA && typeof value.enabled === 'boolean');
  if (!value.enabled) { check(Object.keys(value).length === 2); return structuredClone(value); }
  // Missing operational setup is handled as disabled by the bootstrap. Unknown
  // keys and executable values are never silently accepted as configuration.
  if (['artfi', 'executor', 'observationPolicy', 'stores', 'peer', 'gateways'].some(key => value[key] === undefined))
    throw Error('TASK_LISTING_CONFIGURATION_REQUIRED');
  keys(value.executor, ['agentId', 'agentVersion']); check(text(value.executor.agentId) && text(value.executor.agentVersion));
  keys(value.observationPolicy, ['minimumConfirmations']);
  check(typeof value.observationPolicy.minimumConfirmations === 'string' && /^[1-9][0-9]{0,3}$/.test(value.observationPolicy.minimumConfirmations) && Number(value.observationPolicy.minimumConfirmations) <= 1024);
  keys(value.stores, ['bridge', 'observation']);
  for (const store of [value.stores.bridge, value.stores.observation]) { keys(store, ['path', 'keyFile']); check(file(store.path) && file(store.keyFile)); }
  check(value.stores.bridge.path !== value.stores.observation.path, 'TASK_LISTING_STORE_REENTRY_REFUSED');
  keys(value.peer, ['id', 'journalUrl', 'tls', 'capabilityListener']);
  check(typeof value.peer.id === 'string' && /^spiffe:\/\/[^\s,]{1,240}$/.test(value.peer.id) && url(value.peer.journalUrl));
  check(new URL(value.peer.journalUrl).pathname === '/internal/v1/nft/operations'); tls(value.peer.tls);
  const listener = value.peer.capabilityListener;
  keys(listener, ['peerId', 'host', 'port', 'certFile', 'keyFile', 'caFile', 'clientFingerprint256']);
  check(typeof listener.peerId === 'string' && /^spiffe:\/\/[A-Za-z0-9._/-]{1,240}$/.test(listener.peerId) && listener.peerId !== value.peer.id && ['127.0.0.1', '::1'].includes(listener.host) && Number.isInteger(listener.port) && listener.port >= 1 && listener.port <= 65535 &&
    ['certFile', 'keyFile', 'caFile'].every(key => file(listener[key])) && fingerprint(listener.clientFingerprint256));
  keys(value.gateways, ['signer', 'quote', 'request']);
  for (const name of ['signer', 'quote', 'request']) {
    const gateway = value.gateways[name];
    keys(gateway, ['url', 'timeoutMs', 'tls', ...(name === 'signer' ? ['protocol', 'capabilityId', 'version'] : [])]);
    check(url(gateway.url) && timeout(gateway.timeoutMs)); tls(gateway.tls);
  }
  check(value.gateways.signer.protocol === '8415-sign-only-http/1' && text(value.gateways.signer.capabilityId) && text(value.gateways.signer.version));
  check(plain(value.artfi));
  // Native configuration is validated by the fixed installed ArtFi package.
  // Require a JSON round trip now to exclude functions, accessors and prototypes.
  const json = JSON.stringify(value); check(json.length <= 262144);
  return JSON.parse(json);
}

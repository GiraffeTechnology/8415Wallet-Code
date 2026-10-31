/** Durable capability floor, not an authorization grant or a policy default. */
export const ASSET_CONTROL_CAPABILITY = 'credential.assetControlPolicies/1';
export const CREDENTIAL_STORE_GENERATIONS = Object.freeze({ LEGACY: 1, ASSET_CONTROL: 2 });
const schema = '8415wallet-credential-state/2';
const recordMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function requiredStoreGeneration(records, minimum = 1) {
  if (!recordMap(records)) throw new Error('AUTH_STORE_INVALID');
  if (minimum !== 1 && minimum !== 2) throw new Error('AUTH_STORE_VERSION_REFUSED');
  const hasAssetControl = Object.values(records).some(record => recordMap(record) && Object.hasOwn(record, 'assetControlPolicies'));
  return minimum === 2 || hasAssetControl ? 2 : 1;
}
export function encodeStorePayload(records, generation) {
  if (requiredStoreGeneration(records, generation) !== generation) throw new Error('AUTH_STORE_GENERATION_UPGRADE_REQUIRED');
  return generation === 1 ? records : { schema, requiredCapabilities: [ASSET_CONTROL_CAPABILITY], records };
}
export function decodeStorePayload(payload, generation) {
  if (generation === 1) {
    if (requiredStoreGeneration(payload) !== 1) throw new Error('AUTH_STORE_GENERATION_UPGRADE_REQUIRED');
    return payload;
  }
  if (generation !== 2) throw new Error('AUTH_STORE_VERSION_REFUSED');
  if (!recordMap(payload) || Object.keys(payload).length !== 3 || payload.schema !== schema ||
      !Object.hasOwn(payload, 'records') || !Array.isArray(payload.requiredCapabilities) ||
      payload.requiredCapabilities.length !== 1 || payload.requiredCapabilities[0] !== ASSET_CONTROL_CAPABILITY ||
      !recordMap(payload.records)) throw new Error('AUTH_STORE_CAPABILITY_REFUSED');
  return payload.records;
}

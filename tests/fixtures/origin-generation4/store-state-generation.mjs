/** Durable capability floor, not an authorization grant or a policy default. */
export const ASSET_CONTROL_CAPABILITY = 'credential.assetControlPolicies/1';
export const WALLET_BINDING_CAPABILITY = 'credential.walletBindings/1';
export const CA_BINDING_CAPABILITY = 'credential.caBindings/1';
export const CREDENTIAL_STORE_GENERATIONS = Object.freeze({ LEGACY: 1, ASSET_CONTROL: 2, CA_BINDING: 3, WALLET_BINDING: 4 });
const schema = generation => `8415wallet-credential-state/${generation}`;
const recordMap = value => value !== null && typeof value === 'object' && !Array.isArray(value);
export function requiredStoreGeneration(records, minimum = 1) {
  if (!recordMap(records)) throw new Error('AUTH_STORE_INVALID');
  if (![1, 2, 3, 4].includes(minimum)) throw new Error('AUTH_STORE_VERSION_REFUSED');
  if (minimum === 4 || Object.values(records).some(record => recordMap(record) && Object.hasOwn(record, 'walletBindings'))) return 4;
  const hasCa = Object.values(records).some(record => recordMap(record) && Object.hasOwn(record, 'caBindings'));
  if (minimum === 3 || hasCa) return 3;
  const hasAssetControl = Object.values(records).some(record => recordMap(record) && (Object.hasOwn(record, 'assetControlPolicies') || Object.hasOwn(record, 'passwordBinding')));
  return minimum === 2 || hasAssetControl ? 2 : 1;
}
export function encodeStorePayload(records, generation) {
  if (requiredStoreGeneration(records, generation) !== generation) throw new Error('AUTH_STORE_GENERATION_UPGRADE_REQUIRED');
  return generation === 1 ? records : { schema: schema(generation), requiredCapabilities: generation === 4 ? [ASSET_CONTROL_CAPABILITY, CA_BINDING_CAPABILITY, WALLET_BINDING_CAPABILITY] : generation === 3 ? [ASSET_CONTROL_CAPABILITY, CA_BINDING_CAPABILITY] : [ASSET_CONTROL_CAPABILITY], records };
}
export function decodeStorePayload(payload, generation) {
  if (generation === 1) {
    if (requiredStoreGeneration(payload) !== 1) throw new Error('AUTH_STORE_GENERATION_UPGRADE_REQUIRED');
    return payload;
  }
  if (generation !== 2 && generation !== 3 && generation !== 4) throw new Error('AUTH_STORE_VERSION_REFUSED');
  if (!recordMap(payload) || Object.keys(payload).length !== 3 || payload.schema !== schema(generation) ||
      !Object.hasOwn(payload, 'records') || !Array.isArray(payload.requiredCapabilities) ||
      payload.requiredCapabilities.length !== (generation - 1) || payload.requiredCapabilities[0] !== ASSET_CONTROL_CAPABILITY ||
      (generation >= 3 && payload.requiredCapabilities[1] !== CA_BINDING_CAPABILITY) ||
      (generation === 4 && payload.requiredCapabilities[2] !== WALLET_BINDING_CAPABILITY) ||
      !recordMap(payload.records)) throw new Error('AUTH_STORE_CAPABILITY_REFUSED');
  if (requiredStoreGeneration(payload.records, generation) !== generation) throw new Error('AUTH_STORE_GENERATION_UPGRADE_REQUIRED');
  return payload.records;
}

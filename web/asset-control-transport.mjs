/** Human settings transport only. Reuses the authenticated same-origin client.
 * No endpoint selection, credential storage, task grants or automatic saves.
 */
const actions = new Set(['status', 'catalog', 'prepare', 'verify', 'confirm', 'cancel', 'reconcile']);
const operations = new Set([
  'erc8183:createJob', 'erc8183:setProvider', 'erc8183:setBudget', 'erc8183:fund',
  'erc8183:submit', 'erc8183:complete', 'erc8183:reject', 'erc8183:claimRefund',
  'wallet:native-transfer', 'wallet:erc20-transfer', 'wallet:erc721-transfer',
  'wallet:erc1155-transfer', 'wallet:receive',
]);
const fail = () => { throw new Error('ASSET_CONTROL_INPUT_REFUSED'); };
function record(value, keys) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
      ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail();
  const descriptors = Object.getOwnPropertyDescriptors(value);
  if (Reflect.ownKeys(descriptors).length !== keys.length || keys.some(key =>
    !Object.hasOwn(descriptors, key) || !Object.hasOwn(descriptors[key], 'value') || !descriptors[key].enumerable)) fail();
}
function revision(value) {
  if (typeof value !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(value) || BigInt(value) >= 1n << 256n) fail();
  return value;
}
export function assetControlTarget(value) {
  const kind = Object.getOwnPropertyDescriptor(value ?? {}, 'kind');
  if (!kind || !Object.hasOwn(kind, 'value')) fail();
  if (kind.value === 'allow-agent') { record(value, ['kind']); return { kind: 'allow-agent' }; }
  if (!['asset', 'operation'].includes(kind.value)) fail();
  record(value, kind.value === 'asset' ? ['kind', 'path'] : ['kind', 'path', 'operation']);
  const path = value.path;
  if (!Array.isArray(path) || path.length < 1 || path.length > 4) fail();
  const descriptors = Object.getOwnPropertyDescriptors(path);
  if (Reflect.ownKeys(descriptors).length !== path.length + 1) fail();
  for (let index = 0; index < path.length; index++) {
    const property = descriptors[index];
    if (!property || !Object.hasOwn(property, 'value') || !property.enumerable ||
        typeof property.value !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(property.value)) fail();
  }
  if (new Set(path).size !== path.length || path[0] !== 'all') fail();
  if (kind.value === 'operation' && !operations.has(value.operation)) fail();
  return { kind: kind.value, path: [...path], ...(kind.value === 'operation' ? { operation: value.operation } : {}) };
}
export function assetControlBody(action, value = {}) {
  if (!actions.has(action)) fail();
  if (['status', 'catalog'].includes(action)) { record(value, []); return {}; }
  if (['cancel', 'reconcile'].includes(action)) {
    record(value, ['changeId', 'changeDigest', 'expectedRevision']);
    if (typeof value.changeId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.changeId) ||
        typeof value.changeDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.changeDigest)) fail();
    return { changeId: value.changeId, changeDigest: value.changeDigest, expectedRevision: revision(value.expectedRevision) };
  }
  if (action === 'prepare') {
    const continued=Object.hasOwn(value,'protocol');
    record(value, ['expectedRevision', 'identityMethod', 'patch',...(continued?['protocol']:[])]);
    if(continued && value.protocol!=='8415-asset-control-change-wire/2')fail();
    record(value.patch, ['target', 'value', 'expectedFieldRevision']);
    if (!['password', 'wallet'].includes(value.identityMethod) || typeof value.patch.value !== 'boolean') fail();
    return { expectedRevision: revision(value.expectedRevision), identityMethod: value.identityMethod,
      ...(continued?{protocol:value.protocol}:{}),
      patch: { target: assetControlTarget(value.patch.target), value: value.patch.value,
        expectedFieldRevision: revision(value.patch.expectedFieldRevision) } };
  }
  if (action === 'verify') {
    const password = Object.hasOwn(value, 'password');
    record(value, ['changeId', 'changeDigest', password ? 'password' : 'signature']);
    if (password ? typeof value.password !== 'string' || !value.password.length || value.password.length > 1024 :
      typeof value.signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(value.signature)) fail();
  } else {
    record(value, ['changeId', 'changeDigest', 'code']);
    if (typeof value.code !== 'string' || !/^\d{8}$/.test(value.code)) fail();
  }
  if (typeof value.changeId !== 'string' || !/^[A-Za-z0-9_-]{43}$/.test(value.changeId) ||
      typeof value.changeDigest !== 'string' || !/^[a-f0-9]{64}$/.test(value.changeDigest)) fail();
  return { ...value };
}
export function createAssetControlTransport({ client, walletLogin }) {
  if (!client || typeof client.request !== 'function' || !walletLogin) fail();
  return Object.freeze({
    async request(action, input, { binding, signal } = {}) {
      if (signal?.aborted || !walletLogin.assert(binding)?.serverId) fail();
      const body = assetControlBody(action, input);
      try {
        const result = await client.request(`account/asset-controls/${action}`, body, { signal });
        if (signal?.aborted) fail();
        walletLogin.assert(binding);
        // The caller must decode the response against its independently captured
        // account/scope and exact reviewed patch before displaying or confirming.
        return result;
      } finally {
        for (const key of ['password', 'signature', 'code']) if (Object.hasOwn(body, key)) body[key] = '';
      }
    },
  });
}

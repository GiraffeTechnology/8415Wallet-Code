/** Server-owned scoped test inventory. It is not a browser registration API.
 * Mint evidence is checked by the fixed server verifier before NFT exemptions
 * become available. Planned mints require no future receipt or token ID.
 */
import { digest } from './crypto.mjs';
export const testMintInventoryKey = (chainId, collection, sourceHash) =>
  'task-test-mint:' + digest(JSON.stringify([chainId, collection, sourceHash]));
const fail = () => { throw Error('TASK_TEST_ASSET_CONFIG_REFUSED'); };
const keys = (v, expected) => {
  if (!v || ![Object.prototype, null].includes(Object.getPrototypeOf(v))) fail();
  const d = Object.getOwnPropertyDescriptors(v);
  if (Reflect.ownKeys(d).length !== expected.length || expected.some(k => !Object.hasOwn(d, k) || !Object.hasOwn(d[k], 'value'))) fail();
};
const id = v => { if (typeof v !== 'string' || !/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(v)) fail(); return v; };
const addr = v => { if (typeof v !== 'string' || !/^0x[0-9a-f]{40}$/.test(v) || /^0x0+$/.test(v)) fail(); return v; };
const hash = v => { if (typeof v !== 'string' || !/^0x[0-9a-f]{64}$/.test(v) || /^0x0+$/.test(v)) fail(); return v; };
const uint = v => { if (typeof v !== 'string' || !/^(0|[1-9][0-9]{0,77})$/.test(v) || BigInt(v) >= 1n << 256n) fail(); return v; };
const array = v => { if (!Array.isArray(v) || v.length > 10000) fail(); return v; };
export function normalizeTestAssetPins(input = []) {
  const rows = new Map();
  for (const row of array(input)) {
    keys(row, ['taskId','actor','chainId','contract','runtimeCodeHash']);
    const pin = { taskId:id(row.taskId), actor:addr(row.actor), chainId:row.chainId,
      contract:addr(row.contract), runtimeCodeHash:hash(row.runtimeCodeHash) };
    if (!['560048','11155111'].includes(pin.chainId)) fail();
    const key = JSON.stringify([pin.taskId,pin.actor,pin.chainId,pin.contract]);
    if (rows.has(key) && rows.get(key).runtimeCodeHash !== pin.runtimeCodeHash) fail();
    rows.set(key, Object.freeze(pin));
  }
  return Object.freeze([...rows].sort(([a],[b])=>a<b?-1:a>b?1:0).map(([,pin])=>pin));
}
export function testAssetPinForTask(pins, task) {
  const p = task.policy, op = p.intent.operation;
  if (p.intent.kind !== 'exact-operation' || !['erc721-transfer','erc1155-transfer'].includes(op.kind)) return null;
  return pins.find(pin => pin.taskId === p.taskId && pin.actor === p.actor && pin.chainId === p.chainId && pin.contract === op.contract) ?? null;
}
export async function createTaskTestAssetAuthorization({ inventory, authorizedWallets, verifyMintEvidence = null,
  store = null, verifyInventoryRecord = null, now = Date.now }) {
  keys(inventory, ['schema', 'chainId', 'origin', 'tenant', 'expiresAt', 'wallets', 'assets']);
  if (inventory.schema !== '8415-agent-test-assets/1' || !['560048', '11155111'].includes(inventory.chainId) ||
      typeof inventory.origin !== 'string' || new URL(inventory.origin).origin !== inventory.origin ||
      !inventory.origin.startsWith('https://') || typeof now !== 'function') fail();
  // One inventory belongs to one explicitly selected approved test chain and
  // this instance's original wallet bindings; never union project identities.
  const chainId = inventory.chainId;
  const expiresAt = uint(inventory.expiresAt), tenant = id(inventory.tenant), origin = inventory.origin;
  const wallets = array(inventory.wallets).map(addr);
  if (!wallets.length || new Set(wallets).size !== wallets.length ||
      wallets.some(a => !authorizedWallets.some(w => w.chainId === chainId && w.account.toLowerCase() === a))) fail();
  const source = structuredClone(inventory), assets = [], seen = new Set(), verified = new Map();
  for (const a of array(source.assets)) {
    keys(a, ['taskId', 'actor', 'standard', 'contract', 'runtimeCodeHash', 'issuer', 'sourceHash', 'mint']);
    id(a.taskId); addr(a.actor); addr(a.contract); hash(a.runtimeCodeHash); addr(a.issuer); hash(a.sourceHash);
    if (!wallets.includes(a.actor) || !wallets.includes(a.issuer) || !['ERC-721', 'ERC-1155'].includes(a.standard)) fail();
    const k = JSON.stringify([a.taskId, a.actor, a.contract, a.sourceHash]);
    if (seen.has(k)) fail(); seen.add(k);
    if (a.mint?.state === 'planned') {
      keys(a.mint, ['state']); // No invented future transaction, block or ID.
    } else {
      keys(a.mint, ['state', 'transactionHash', 'blockHash', 'tokenIds']);
      if (a.mint.state !== 'confirmed' || typeof verifyMintEvidence !== 'function') fail();
      hash(a.mint.transactionHash); hash(a.mint.blockHash);
      const ids = array(a.mint.tokenIds).map(uint);
      if (!ids.length || new Set(ids).size !== ids.length) fail();
      // The server-only verifier must check canonical receipt/log/code/issuer
      // evidence against this exact detached record, not merely its UI label.
      if (await verifyMintEvidence(structuredClone({ chainId, ...a })) !== true) fail();
    }
    assets.push(a);
  }
  // Reconcile only inventory-declared sources, never scan unrelated credentials.
  if (store !== null) {
    if (typeof store.read !== 'function') fail();
    for (const a of assets) if (a.mint.state === 'planned') {
      const key = testMintInventoryKey(chainId, a.contract, a.sourceHash), record = await store.read(key);
      if (record?.available === true && typeof verifyInventoryRecord === 'function' &&
          record.schema === '8415-task-test-mint-inventory/1' &&
          await verifyInventoryRecord(structuredClone(record)) === true) verified.set(key, structuredClone(record));
    }
  }
  const live = () => { const time = now(); return Number.isSafeInteger(time) && time >= 0 && BigInt(Math.floor(time / 1000)) < BigInt(expiresAt); };
  const principal = (p) => live() && p?.chainId === chainId && p.origin === origin && p.tenant === tenant && wallets.includes(p.actor);
  const matchingAssets = p => assets.filter(a => a.taskId === p.taskId && a.actor === p.actor && a.contract === p.intent.operation.contract);
  return Object.freeze({
    executionPins: normalizeTestAssetPins(assets.map(a => ({ taskId:a.taskId, actor:a.actor, chainId,
      contract:a.contract, runtimeCodeHash:a.runtimeCodeHash }))),
    allows(task) {
      const p = task?.policy, op = p?.intent?.operation;
      if (!principal(p) || typeof p.expiresAt !== 'string' || !/^[1-9][0-9]{0,19}$/.test(p.expiresAt) ||
          BigInt(p.expiresAt) > BigInt(expiresAt) || p.intent.kind !== 'exact-operation' || !op ||
          op.chainId !== p.chainId || op.actor !== p.actor) return false;
      if (op.kind === 'artfi-test-series-mint') return chainId === '560048' && op.taskId === p.taskId &&
        wallets.includes(op.distributionWallet) && assets.some(a => a.taskId === p.taskId && a.actor === p.actor &&
          a.issuer === p.actor && a.standard === 'ERC-1155' && a.contract === op.collection?.contract &&
          a.runtimeCodeHash === op.collection?.runtimeCodeHash && a.sourceHash === op.masterArtworkHash && a.mint.state === 'planned');
      if (!wallets.includes(op.recipient)) return false;
      // The native-ETH exemption is Hoodi-only. Sepolia inventory is for the
      // corresponding task-minted valueless NFTs, not native funds or gas policy.
      if (op.kind === 'native-transfer') return chainId === '560048';
      if (!['erc721-transfer', 'erc1155-transfer'].includes(op.kind)) return false;
      return matchingAssets(p).some(a => {
        if (a.standard !== (op.kind === 'erc721-transfer' ? 'ERC-721' : 'ERC-1155')) return false;
        if (a.mint.state === 'confirmed') return a.mint.tokenIds.includes(op.tokenId);
        const record = verified.get(testMintInventoryKey(chainId, a.contract, a.sourceHash)), result = record?.result;
        return Boolean(record?.available === true && result?.chainId === chainId && result.collection === a.contract &&
          result.runtimeCodeHash === a.runtimeCodeHash && result.issuer === a.issuer && result.masterArtworkHash === a.sourceHash &&
          result.standard === a.standard && result.tokenId === op.tokenId);
      });
    },
    // Called only by the server task service AFTER its durable transaction. It
    // never writes state or accepts an HTTP registration. Startup rechecks chain
    // evidence before reusing a persisted record under a new process.
    acceptCommittedMintRecord(record) {
      if (!record || record.schema !== '8415-task-test-mint-inventory/1' || !record.result) return;
      const r = record.result, key = testMintInventoryKey(r.chainId, r.collection, r.masterArtworkHash);
      if (!assets.some(a => a.contract === r.collection && a.sourceHash === r.masterArtworkHash && a.issuer === r.issuer &&
          a.runtimeCodeHash === r.runtimeCodeHash && a.standard === r.standard) || r.chainId !== chainId) return;
      if (record.available === true) verified.set(key, structuredClone(record)); else verified.delete(key);
    },
    allowsPlannedMint(p) {
      return Boolean(principal(p) && assets.some(a => a.taskId === p.taskId && a.actor === p.actor &&
        a.issuer === p.actor && a.contract === p.contract && a.runtimeCodeHash === p.runtimeCodeHash &&
        a.sourceHash === p.sourceHash && a.mint.state === 'planned'));
    },
  });
}


import test from 'node:test';
import assert from 'node:assert/strict';
import { createTaskTestAssetAuthorization, testMintInventoryKey } from '../server/task-test-asset-authorization.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
const actor = '0x' + '1'.repeat(40), recipient = '0x' + '2'.repeat(40), contract = '0x' + '3'.repeat(40);
const h = n => '0x' + n.repeat(64), origin = 'https://wallet.example.invalid';
const wallets = [{ chainId: '560048', account: actor }, { chainId: '560048', account: recipient }];
const inventory = () => ({ schema: '8415-agent-test-assets/1', chainId: '560048', origin, tenant: 'synthetic-tenant',
  expiresAt: '2000000000', wallets: [actor, recipient], assets: [] });
const task = (kind = 'native-transfer') => ({ policy: { origin, tenant: 'synthetic-tenant', chainId: '560048', actor,
  taskId: 'synthetic:test', expiresAt: '1950000000', intent: { kind: 'exact-operation', operation: { kind, chainId: '560048', actor, recipient,
    ...(kind === 'native-transfer' ? { valueWei: '1' } : { contract, tokenId: '7', ...(kind === 'erc1155-transfer' ? { amount: '1' } : {}) }) } } } });
const asset = standard => ({ taskId: 'synthetic:test', actor, standard, contract, runtimeCodeHash: h('4'),
  issuer: actor, sourceHash: h('5'), mint: { state: 'confirmed', transactionHash: h('6'), blockHash: h('7'), tokenIds: ['7'] } });
const create = (i, extra = {}) => createTaskTestAssetAuthorization({ inventory: i, authorizedWallets: wallets, now: () => 1900000000000, ...extra });
test('Hoodi native ETH test scope requires no mint evidence but stays wallet bound', async () => {
  const mode = await create(inventory());
  assert.equal(mode.allows(task()), true);
  const p = task(); p.policy.intent.operation.recipient = '0x' + '8'.repeat(40);
  assert.equal(mode.allows(p), false);
});
test('registered ERC721 and ERC1155 test mints become eligible only after fixed verifier checks', async () => {
  for (const [standard, kind] of [['ERC-721', 'erc721-transfer'], ['ERC-1155', 'erc1155-transfer']]) {
    const i = inventory(); i.assets.push(asset(standard)); let checks = 0;
    const mode = await create(i, { verifyMintEvidence: async record => { checks++; assert.equal(record.chainId, '560048'); return true; } });
    assert.equal(checks, 1); assert.equal(mode.allows(task(kind)), true);
    i.assets[0].mint.tokenIds.push('8');
    const other = task(kind); other.policy.intent.operation.tokenId = '8';
    assert.equal(mode.allows(other), false, 'caller mutation cannot add registered tokens');
  }
});
test('label-only or unverified minted asset cannot gain the factor exemption', async () => {
  const i = inventory(); i.assets.push(asset('ERC-721'));
  await assert.rejects(create(i), /CONFIG_REFUSED/);
  await assert.rejects(create(i, { verifyMintEvidence: async () => false }), /CONFIG_REFUSED/);
});
test('planned mint binds known issuer/contract/source without invented future token IDs', async () => {
  const i = inventory(), a = asset('ERC-721'); a.mint = { state: 'planned' }; i.assets.push(a);
  const mode = await create(i);
  assert.equal(mode.allowsPlannedMint({ origin, tenant: 'synthetic-tenant', actor, taskId: a.taskId, chainId: '560048',
    contract, runtimeCodeHash: a.runtimeCodeHash, sourceHash: a.sourceHash }), true);
  assert.equal(mode.allows(task('erc721-transfer')), false, 'planned is not a minted token');
});
test('wrong chain, actor, task, asset and expired test mode never inherit exemption', async () => {
  const mode = await create(inventory());
  for (const change of [p => p.chainId = '1', p => p.actor = '0x' + '8'.repeat(40),
    p => p.intent.operation.kind = 'erc20-transfer', p => p.intent.kind = 'nft-sale']) {
    const t = task(); change(t.policy); assert.equal(mode.allows(t), false);
  }
  const expired = await create(inventory(), { now: () => 2100000000000 });
  assert.equal(expired.allows(task()), false);
});
test('configuration cannot enroll a wallet outside original server account bindings', async () => {
  const i = inventory(); i.wallets.push('0x' + '8'.repeat(40));
  await assert.rejects(create(i), /CONFIG_REFUSED/);
});
test('separate Sepolia instance can exempt its own verified NFT, never native ETH', async () => {
  const i = inventory(); i.chainId = '11155111'; i.tenant = 'ex-test';
  i.origin = 'https://ex.example.invalid'; i.assets.push(asset('ERC-721'));
  const mode = await create(i, { authorizedWallets: wallets.map(w => ({ ...w, chainId: '11155111' })),
    verifyMintEvidence: async evidence => { assert.equal(evidence.chainId, '11155111'); return true; } });
  const own = kind => { const t = task(kind); t.policy.chainId = '11155111'; t.policy.tenant = i.tenant;
    t.policy.origin = i.origin; t.policy.intent.operation.chainId = '11155111'; return t; };
  assert.equal(mode.allows(own('erc721-transfer')), true);
  assert.equal(mode.allows(own('native-transfer')), false);
  assert.equal(mode.allows(task('erc721-transfer')), false, 'Hoodi identity does not inherit EX scope');
});
test('Hoodi wallet bindings cannot be relabelled as Sepolia, or enable an unapproved chain', async () => {
  const i = inventory(); i.chainId = '11155111';
  await assert.rejects(create(i), /CONFIG_REFUSED/);
  i.chainId = '8453';
  await assert.rejects(create(i, { authorizedWallets: wallets.map(w => ({ ...w, chainId: '8453' })) }), /CONFIG_REFUSED/);
});
test('committed actual mint token enables only its declared source; reorg revokes availability', async () => {
  const i = inventory(), a = asset('ERC-1155'); a.mint = { state: 'planned' }; i.assets.push(a);
  const mode = await create(i), t = task('erc1155-transfer');
  assert.equal(mode.allows(t), false);
  const record = { schema: '8415-task-test-mint-inventory/1', available: true, result: {
    chainId: '560048', collection: contract, runtimeCodeHash: a.runtimeCodeHash, issuer: actor,
    masterArtworkHash: a.sourceHash, standard: 'ERC-1155', tokenId: '7' } };
  mode.acceptCommittedMintRecord(record);
  assert.equal(mode.allows(t), true);
  record.result.tokenId = '8'; assert.equal(mode.allows(t), true, 'record is detached');
  mode.acceptCommittedMintRecord({ ...record, available: false });
  assert.equal(mode.allows(t), false);
});
test('restart checks original store facts through fixed read-only verifier before eligibility', async () => {
  const i = inventory(), a = asset('ERC-1155'); a.mint = { state: 'planned' }; i.assets.push(a);
  const store = new MemoryCredentialStore();
  await store.transaction(testMintInventoryKey('560048', contract, a.sourceHash), () => ({
    schema: '8415-task-test-mint-inventory/1', available: true, result: { chainId: '560048', collection: contract,
      runtimeCodeHash: a.runtimeCodeHash, issuer: actor, masterArtworkHash: a.sourceHash, standard: 'ERC-1155', tokenId: '7' } }));
  const missing = await create(i, { store }); assert.equal(missing.allows(task('erc1155-transfer')), false);
  const reorg = await create(i, { store, verifyInventoryRecord: async () => false });
  assert.equal(reorg.allows(task('erc1155-transfer')), false);
  const verified = await create(i, { store, verifyInventoryRecord: async () => true });
  assert.equal(verified.allows(task('erc1155-transfer')), true);
});
test('two different declared master sources in one collection remain independently matched', async () => {
  const i = inventory(), first = asset('ERC-1155'), second = asset('ERC-1155');
  second.sourceHash = h('8'); second.mint.tokenIds = ['8']; i.assets.push(first, second);
  const mode = await create(i, { verifyMintEvidence: async () => true });
  const t = task('erc1155-transfer'); t.policy.intent.operation.tokenId = '8';
  assert.equal(mode.allows(t), true);
});


for (const [standard, kind, sourceField] of [
  ['ERC-721', 'erc721-transfer', 'sourceHash'],
  ['ERC-1155', 'erc1155-transfer', 'masterArtworkHash'],
]) {
  const planned = () => {
    const i = inventory(), a = asset(standard);
    a.mint = { state: 'planned' }; i.assets.push(a);
    const record = { schema: '8415-task-test-mint-inventory/1', available: true, result: {
      chainId: i.chainId, collection: contract, runtimeCodeHash: a.runtimeCodeHash,
      issuer: actor, [sourceField]: a.sourceHash, standard, tokenId: '7',
    } };
    return { i, a, record };
  };
  test(standard + ' committed mint uses its canonical source and reorg invalidates it', async () => {
    const { i, record } = planned(), mode = await create(i), t = task(kind);
    assert.equal(mode.allows(t), false);
    mode.acceptCommittedMintRecord(record);
    assert.equal(mode.allows(t), true);
    record.result.tokenId = '8';
    assert.equal(mode.allows(t), true, 'committed record is detached from caller mutation');
    mode.acceptCommittedMintRecord({ ...record, available: false });
    assert.equal(mode.allows(t), false, 'source invalidation removes cached eligibility');
    mode.acceptCommittedMintRecord(record);
    assert.equal(mode.allows(t), false, 'a different observed token cannot authorize the former token');
    t.policy.intent.operation.tokenId = '8';
    assert.equal(mode.allows(t), true);
  });
  test(standard + ' restart requires verifier and exact declared source identity', async () => {
    for (const mutation of [null, r => r[sourceField] = h('8'),
      r => r.runtimeCodeHash = h('8'), r => r.issuer = recipient,
      r => r.chainId = '11155111', r => r.collection = recipient,
      r => r.standard = 'unknown']) {
      const { i, a, record } = planned();
      if (mutation) mutation(record.result);
      const store = new MemoryCredentialStore();
      await store.transaction(testMintInventoryKey(i.chainId, contract, a.sourceHash), () => record);
      let checks = 0;
      const mode = await create(i, { store, verifyInventoryRecord: async () => { checks++; return true; } });
      assert.equal(mode.allows(task(kind)), mutation === null);
      assert.equal(checks, mutation === null ? 1 : 0, 'mismatched identity never enters the verifier');
      const unchecked = await create(i, { store });
      assert.equal(unchecked.allows(task(kind)), false, 'persisted data alone is not verified chain evidence');
    }
  });
  test(standard + ' startup-loaded mint loses eligibility after committed reorg observation', async () => {
    const { i, a, record } = planned(), store = new MemoryCredentialStore();
    await store.transaction(testMintInventoryKey(i.chainId, contract, a.sourceHash), () => record);
    let checks = 0;
    const mode = await create(i, { store, verifyInventoryRecord: async () => { checks++; return true; } });
    assert.equal(checks, 1);
    assert.equal(mode.allows(task(kind)), true, 'startup verification admitted the exact source');
    mode.acceptCommittedMintRecord({ ...record, available: false });
    assert.equal(mode.allows(task(kind)), false, 'same-process invalidation must remove startup-loaded eligibility');
  });
  test(standard + ' conflicting source aliases cannot admit a mint by commit or restart', async () => {
    const { i, a, record } = planned();
    const alias = sourceField === 'sourceHash' ? 'masterArtworkHash' : 'sourceHash';
    record.result[alias] = h('8');
    const mode = await create(i);
    mode.acceptCommittedMintRecord(record);
    assert.equal(mode.allows(task(kind)), false);
    const store = new MemoryCredentialStore();
    await store.transaction(testMintInventoryKey(i.chainId, contract, a.sourceHash), () => record);
    let checks = 0;
    const restarted = await create(i, { store, verifyInventoryRecord: async () => { checks++; return true; } });
    assert.equal(checks, 0);
    assert.equal(restarted.allows(task(kind)), false);
  });
  test(standard + ' missing canonical source cannot borrow the other schema field', async () => {
    const { i, record } = planned();
    const alias = sourceField === 'sourceHash' ? 'masterArtworkHash' : 'sourceHash';
    record.result[alias] = record.result[sourceField];
    delete record.result[sourceField];
    const mode = await create(i);
    mode.acceptCommittedMintRecord(record);
    assert.equal(mode.allows(task(kind)), false);
  });
}

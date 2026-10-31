/** Startup wiring tests only. Synthetic in-memory I/O and capability identities;
 * never evidence of a deployed reader, complete inventory, real RPC or credentials. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import ts from 'typescript';
import { createAuthRuntime as v3Runtime } from '../server/main.mjs';
import { createAuthRuntime as v2Runtime } from '../server/v2/main.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
const names = ['forwardProgressReader', 'assetControlCatalogReader', 'fundsReader', 'nftInventoryReader', 'testAssetEvidenceVerifier', 'readSources'];
const config = { origin: 'https://wallet.example.invalid', tenant: 'fixture', port: 18000,
  statePath: '/synthetic-only/credentials.enc', accounts: [] };
function startup(profile, fail = false, guardFailureAt = null) {
  const file = profile === 'v2' ? 'server/v2/main.mjs' : 'server/main.mjs';
  const source = readFileSync(new URL('../' + file, import.meta.url), 'utf8');
  const ast = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const declaration = ast.statements.find(n => ts.isFunctionDeclaration(n) && n.name?.text === 'startAuthFromEnvironment');
  assert.ok(declaration, 'actual exported startup implementation required');
  const body = declaration.getText(ast).replace(/^export /, '');
  let captured, closed = 0, started = 0, guardChecks = 0, storeOpens = 0, stopped = 0;
  const store = { async close() { closed++; } };
  const runtime = { server: { on() {} }, async start() { started++; }, async stop() { stopped++; }, exactState: 'configured', listingState: 'configured' };
  const values = {
    process: { env: { WALLET_AUTH_CONFIG: '/synthetic-only/auth.json', WALLET_AUTH_STORE_KEY: 'a'.repeat(64) },
      stdout: { write() {} }, stderr: { write() {} }, once() {} },
    readFile: async () => JSON.stringify(config), validateAuthConfig: value => assert.deepEqual(value, config),
    ensureTaskListingServerCondition: async () => {}, ensureStandaloneListingCondition: async () => {},
    assertAuthConfigurationStable: async path => { assert.equal(path, '/synthetic-only/auth.json'); if (++guardChecks === guardFailureAt) throw Error('AUTH_CONFIG_TRANSITION_IN_PROGRESS'); },
    openEncryptedStore: async () => { storeOpens++; return store; }, createCaVerifier: async () => { throw Error('UNEXPECTED_CA'); },
    createOtpSenderFromEnvironment: () => null,
    createAuthRuntime: async options => { captured = options; if (fail) throw Error('COMPOSITION_FAILURE'); return runtime; },
  };
  return { run: new Function(...Object.keys(values), `${body}; return startAuthFromEnvironment;`)(...Object.values(values)),
    get captured() { return captured; }, get closed() { return closed; }, get started() { return started; },
    get storeOpens() { return storeOpens; }, get stopped() { return stopped; }, get guardChecks() { return guardChecks; }, store };
}
for (const profile of ['v2', 'v3']) {
  test(`${profile} startup forwards only the explicit process-owned reader identities`, async () => {
    const h = startup(profile), readers = Object.fromEntries(names.map(name => [name, name === 'testAssetEvidenceVerifier' ? async () => { throw Error('MUST_NOT_VERIFY_AT_STARTUP'); } : Object.freeze({ marker: name })]));
    await h.run(readers);
    for (const name of names) assert.equal(h.captured[name], readers[name]);
    assert.equal(h.captured.store, h.store); assert.equal(h.started, 1); assert.equal(h.closed, 0);
    assert.equal(h.guardChecks, 3);
  });
  test(`${profile} startup never listens through an unresolved transition and drains an opened store`, async () => {
    for (const boundary of [1, 2, 3]) {
      const h = startup(profile, false, boundary);
      await assert.rejects(h.run(), /AUTH_CONFIG_TRANSITION_IN_PROGRESS/);
      assert.equal(h.started, 0); assert.equal(h.storeOpens, boundary === 3 ? 1 : 0);
      assert.equal(h.closed, boundary === 3 ? 1 : 0); assert.equal(h.stopped, boundary === 3 ? 1 : 0);
    }
  });
  test(`${profile} startup has no fabricated default readers and closes its store on composition failure`, async () => {
    const h = startup(profile, true);
    await assert.rejects(h.run(), /COMPOSITION_FAILURE/);
    for (const name of names) assert.equal(h.captured[name], null);
    assert.equal(h.started, 0); assert.equal(h.closed, 1);
  });
}
for (const [profile, create] of [['v2', v2Runtime], ['v3', v3Runtime]]) {
  test(`${profile} actual runtime propagates invalid funds and NFT readers to existing validators`, async () => {
    await assert.rejects(create({ config, store: new MemoryCredentialStore(), fundsReader: {} }), /FUNDS_CONFIG_REFUSED/);
    await assert.rejects(create({ config, store: new MemoryCredentialStore(), nftInventoryReader: {} }), /NFT_INVENTORY_CONFIG_REFUSED/);
  });
}
test('V2 actual composition still rejects linked progress rather than claiming standalone parity', async () => {
  await assert.rejects(v2Runtime({ config, store: new MemoryCredentialStore(), forwardProgressReader: {} }), /AUTH_V2_LINKED_CAPABILITY_REFUSED/);
});
for (const [profile, create] of [['v2', v2Runtime], ['v3', v3Runtime]]) {
  test(`${profile} actual runtime requires the injected verifier for claimed confirmed test assets`, async () => {
    const actor = '0x' + '1'.repeat(40), hash = n => '0x' + n.repeat(64);
    const minted = { taskId: 'synthetic:test', actor, standard: 'ERC-721', contract: '0x' + '2'.repeat(40),
      runtimeCodeHash: hash('3'), issuer: actor, sourceHash: hash('4'),
      mint: { state: 'confirmed', transactionHash: hash('5'), blockHash: hash('6'), tokenIds: ['1'] } };
    const c = { ...config, accounts: [{ username: 'owner', wallets: [{ account: actor, chainId: '560048' }] }],
      taskTestAssets: { schema: '8415-agent-test-assets/1', chainId: '560048', origin: config.origin, tenant: config.tenant,
        expiresAt: '2000000000', wallets: [actor], assets: [minted] } };
    await assert.rejects(create({ config: c, store: new MemoryCredentialStore() }), /TASK_TEST_ASSET_CONFIG_REFUSED/);
    let calls = 0;
    await assert.rejects(create({ config: c, store: new MemoryCredentialStore(), testAssetEvidenceVerifier: async record => {
      calls++; assert.deepEqual(record, { chainId: '560048', ...minted }); return false;
    } }), /TASK_TEST_ASSET_CONFIG_REFUSED/);
    assert.equal(calls, 1, 'the real authorization constructor must ask the supplied verifier and retain its refusal');
  });
}

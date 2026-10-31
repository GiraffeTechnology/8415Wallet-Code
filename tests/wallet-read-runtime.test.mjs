/** Actual V2/V3 runtime handlers over synthetic loopback HTTP. No live authority. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { once } from 'node:events';
import { createAuthRuntime as createV3 } from '../server/main.mjs';
import { createAuthRuntime as createV2 } from '../server/v2/main.mjs';
import { composeWalletReadRuntime } from '../server/wallet-read-runtime.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { hashPassword } from '../server/crypto.mjs';
import { AccountAuthClient } from '../web/account-auth.mjs';
const account = '0x' + '1'.repeat(40), contract = '0x' + '2'.repeat(40), blockHash = '0x' + '3'.repeat(64);
const password = 'synthetic-runtime-composition-only', passwordHash = await hashPassword(password);
async function fixture(t, create, enabled = true) {
  let runtime; const calls = [];
  const server = createServer((req, res) => runtime.handler(req, res));
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(async () => { server.closeAllConnections(); await new Promise(resolve => server.close(resolve)); await runtime?.stop(); });
  const origin = 'http://127.0.0.1:' + server.address().port;
  const registration = { version: 1, email: 'owner@example.invalid', verifiedAt: 1 };
  const store = new MemoryCredentialStore({ 'fixture:owner': { registration },
    '@registration:fixture': { version: 1, records: [{ username: 'owner', email: registration.email, verifiedAt: 1 }] } });
  const sources = { rpcForPrincipal: async principal => { assert.equal(principal.account, account);
    return { async request(c) { calls.push(c);
      if (c.method === 'eth_chainId') return '0x1';
      if (c.method === 'eth_getBlockByNumber') return { number: '0x10', hash: blockHash };
      if (c.method === 'eth_getLogs') return [];
      assert.equal(c.method, 'eth_getBalance'); assert.equal(c.params[0], account); assert.equal(c.params[1], '0x10'); return '0x46';
    } }; },
    ledgerReader: { async readForPrincipal(c) {
      const currency = { chainId: '1', kind: 'native', contract: null, decimals: 18 };
      return { scope: { ...c.principal }, readId: c.readId, observedAt: Date.now() - 10, validUntil: Date.now() + 10000,
        inventoryState: 'complete', blockNumber: c.blockNumber, blockHash: c.blockHash,
        currencies: [{ currency, escrowState: 'complete', escrows: [{ kind: 'financial-principal', currency,
          reservationId: 'principal-one', nftId: 'opaque-nft', amountBaseUnits: '30', state: 'held', blockHash: c.blockHash }] }] };
    } }, nftLogDiscovery: { contracts: [contract], fromBlock: '0xf' } };
  runtime = await create({ config: { origin, tenant: 'fixture', port: 18000, statePath: '/synthetic/credentials.enc',
    accounts: [{ username: 'owner', passwordHash, wallets: [{ account, chainId: '1' }] }] }, store,
    readSources: enabled ? sources : null });
  const jar = new Map(), transport = async (url, input) => {
    const response = await fetch(url, { ...input, headers: { ...input.headers, Origin: origin,
      Cookie: [...jar].map(([k, v]) => k + '=' + v).join('; ') } });
    for (const cookie of response.headers.getSetCookie()) { const [k, v] = cookie.split(';')[0].split('='); if (v) jar.set(k, v); else jar.delete(k); }
    return response;
  };
  const client = new AccountAuthClient({ origin, tenant: 'fixture', fetcher: transport });
  await client.adapter('password', { username: 'owner', password }).authenticate({ account, chainId: '1' }, null);
  return { runtime, client, calls, sources };
}
for (const [profile, create] of [['v2', createV2], ['v3', createV3]]) {
  test(`${profile} actual runtime composes RPC funds and bounded discovery into authenticated endpoints`, async t => {
    const f = await fixture(t, create), info = await f.client.account();
    assert.equal(f.runtime.readState, 'configured'); assert.deepEqual(f.runtime.readCodes, []);
    assert.equal(info.fundsAvailable, true); assert.equal(info.nftInventoryAvailable, true);
    const funds = await f.client.readFunds(); assert.equal(funds.currencies[0].totalBaseUnits, '100');
    assert.equal(funds.currencies[0].availableBaseUnits, '70'); assert.equal(funds.currencies[0].unreleasedBaseUnits, '30');
    const nft = await f.client.readNftInventory(); assert.equal(nft.inventoryState, 'partial'); assert.deepEqual(nft.records, []);
    assert.ok(f.calls.length > 0); assert.ok(f.calls.every(c => ['eth_chainId', 'eth_getBlockByNumber', 'eth_getBalance', 'eth_getLogs'].includes(c.method)));
    await assert.rejects(f.client.request('assets/funds', { readId: 'a'.repeat(32), readSources: {} }), /FUNDS_REQUEST_REFUSED/);
  });
  test(`${profile} actual runtime without authority reports unavailable and never invents zero balances`, async t => {
    const f = await fixture(t, create, false), info = await f.client.account();
    assert.equal(f.runtime.readState, 'unavailable'); assert.equal(info.fundsAvailable, false); assert.equal(info.nftInventoryAvailable, false);
    await assert.rejects(f.client.readFunds(), /FUNDS_NOT_ENABLED/);
    await assert.rejects(f.client.readNftInventory(), /NFT_INVENTORY_NOT_ENABLED/); assert.equal(f.calls.length, 0);
  });
}
test('partial source configuration cannot manufacture missing ledger or discovery authority', () => {
  const value = composeWalletReadRuntime({ sources: { rpcForPrincipal: async () => { throw Error('must not be called at startup'); } } });
  assert.equal(value.state, 'unavailable'); assert.equal(value.fundsReader, null); assert.equal(value.nftInventoryReader, null);
});
test('source composition refuses module URLs, duplicate capability origins and malformed authority', () => {
  assert.throws(() => composeWalletReadRuntime({ sources: { module: 'https://untrusted.invalid' } }), /WALLET_READ_COMPOSITION_REFUSED/);
  assert.throws(() => composeWalletReadRuntime({ sources: { ledgerReader: {} } }), /WALLET_READ_COMPOSITION_REFUSED/);
  assert.throws(() => composeWalletReadRuntime({ fundsReader: { readForPrincipal() {} },
    sources: { rpcForPrincipal() {}, ledgerReader: { readForPrincipal() {} } } }), /WALLET_READ_COMPOSITION_REFUSED/);
  assert.throws(() => composeWalletReadRuntime({ sources: { nftDiscovery: { listForPrincipal() {} }, nftLogDiscovery: {} } }), /WALLET_READ_COMPOSITION_REFUSED/);
});

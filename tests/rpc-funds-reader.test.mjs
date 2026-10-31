/** Synthetic provider and original-ledger transcripts. No network or chain writes. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { createRpcFundsReader } from '../server/rpc-funds-reader.mjs';
import { createFundsService } from '../server/funds-service.mjs';
import { encodeCall } from '../src/codec/abi.ts';
const account = '0x' + '1'.repeat(40), contract = '0x' + '2'.repeat(40);
const blockHash = '0x' + '3'.repeat(64), otherHash = '0x' + '4'.repeat(64);
const currency = { chainId: '1', kind: 'native', contract: null, decimals: 18 };
const principal = { tenant: 'fixture', origin: 'https://wallet.example', username: 'owner', account, chainId: '1' };
const context = { principal, readId: 'a'.repeat(32) };
const word = n => '0x' + BigInt(n).toString(16).padStart(64, '0');
function fixture() {
  const state = { now: 1000, calls: [], chain: '0x1', reorg: false, decimals: 18, balance: 100n,
    mutate: x => x, ledgerContext: null };
  const source = { scope: { ...principal }, readId: context.readId, observedAt: 900, validUntil: 2000,
    inventoryState: 'partial', blockNumber: '0x10', blockHash, currencies: [{ currency: { ...currency }, escrowState: 'complete',
      escrows: [{ kind: 'financial-principal', reservationId: 'reservation-one', nftId: 'opaque-nft', currency: { ...currency }, amountBaseUnits: '20', state: 'held', blockHash }] }] };
  const ledgerReader = { async readForPrincipal(c) { state.ledgerContext = c; return state.mutate(structuredClone(source)); } };
  const reader = createRpcFundsReader({ ledgerReader, now: () => state.now, rpcForPrincipal: async p => {
    assert.deepEqual(p, principal); return { async request(c) {
      state.calls.push(c);
      if (c.method === 'eth_chainId') return state.chain;
      if (c.method === 'eth_getBlockByNumber') return { number: '0x10', hash: state.reorg && c.params[0] !== 'finalized' ? otherHash : blockHash };
      assert.equal(c.params[1], '0x10');
      if (c.method === 'eth_getBalance') { assert.equal(c.params[0], account); return '0x' + state.balance.toString(16); }
      if (c.method === 'eth_getCode') return '0x6000';
      assert.equal(c.method, 'eth_call'); assert.equal(c.params[0].to, contract);
      if (c.params[0].data === encodeCall('decimals()', [], [])) return word(state.decimals);
      assert.equal(c.params[0].data, encodeCall('balanceOf(address)', ['address'], [account])); return word(state.balance);
    } };
  } });
  const service = createFundsService({ reader, origin: principal.origin, tenant: principal.tenant,
    now: () => state.now, validateSession: async () => {} });
  return { reader, state, source, ledgerReader, service, read: () => service.read({ readId: context.readId }, principal) };
}
test('native liquid balance joins original escrow without double subtraction or complete inflation', async () => {
  const f = fixture(), value = await f.read();
  assert.equal(value.inventoryState, 'partial'); assert.equal(value.state, 'partial');
  assert.equal(value.currencies[0].totalBaseUnits, '120'); assert.equal(value.currencies[0].unreleasedBaseUnits, '20');
  assert.equal(value.currencies[0].availableBaseUnits, '100'); assert.equal(value.currencies[0].canExecute, false);
  assert.equal(value.observedAt, 900); assert.equal(value.validUntil, 2000);
  assert.equal(f.state.ledgerContext.blockHash, blockHash); assert.equal(f.state.ledgerContext.readId, context.readId);
});
test('ERC20 balance preserves bigint and verifies token decimals at the same block', async () => {
  const f = fixture(); f.state.balance = 9007199254740993n;
  const token = { ...currency, kind: 'erc20', contract };
  f.state.mutate = s => { s.currencies[0].currency = token; s.currencies[0].escrows[0].currency = token; return s; };
  assert.equal((await f.read()).currencies[0].availableBaseUnits, '9007199254740993');
  f.state.decimals = 6; await assert.rejects(f.reader.readForPrincipal(context), /FUNDS_RPC_READER_REFUSED/);
});
test('UNKNOWN original outcome suppresses totals but retains ledger evidence', async () => {
  const f = fixture(); f.source.currencies[0].escrows[0].state = 'unknown'; const value = await f.read();
  assert.equal(value.currencies[0].availableBaseUnits, null);
  assert.equal(value.currencies[0].reason, 'PRINCIPAL_OUTCOME_UNKNOWN');
  assert.equal(value.currencies[0].principalRecords[0].state, 'unknown');
});
test('missing or stale escrow never becomes a spendable zero', async () => {
  for (const status of ['unavailable', 'stale']) {
    const f = fixture(); f.source.currencies[0].escrowState = status; f.source.currencies[0].escrows = [];
    const row = (await f.read()).currencies[0]; assert.equal(row.availableBaseUnits, null); assert.equal(row.principalRecords, null);
  }
});
test('expired ledger is not refreshed by an RPC balance read', async () => {
  const f = fixture(); f.state.now = 2500; const value = await f.read();
  assert.equal(value.inventoryState, 'stale'); assert.equal(value.observedAt, 900); assert.equal(value.validUntil, 2000);
  assert.equal(value.currencies[0].totalBaseUnits, null); assert.equal(f.state.calls.some(c => c.method === 'eth_getBalance'), false);
});
test('wrong chain, reorg and cross-principal or cross-block ledger refuse', async () => {
  for (const change of [f => f.state.chain = '0x2', f => f.state.reorg = true,
    f => f.source.scope.account = contract, f => f.source.blockHash = otherHash,
    f => f.source.readId = 'b'.repeat(32), f => f.source.currencies[0].escrows[0].blockHash = otherHash]) {
    const f = fixture(); change(f); await assert.rejects(f.reader.readForPrincipal(context));
  }
});
test('identical reservations deduplicate, conflicting reservations and currencies refuse', async () => {
  const f = fixture(); f.source.currencies[0].escrows.push(structuredClone(f.source.currencies[0].escrows[0]));
  assert.equal((await f.read()).currencies[0].unreleasedBaseUnits, '20');
  f.source.currencies[0].escrows[1].amountBaseUnits = '21'; await assert.rejects(f.reader.readForPrincipal(context));
  const g = fixture(); g.source.currencies.push(structuredClone(g.source.currencies[0])); await assert.rejects(g.reader.readForPrincipal(context));
});
test('source exceptions propagate and configured ledger capability cannot be replaced', async () => {
  const f = fixture(); f.ledgerReader.readForPrincipal = async () => { throw Error('replaced'); };
  assert.equal((await f.read()).currencies[0].availableBaseUnits, '100');
  f.state.mutate = () => { throw Error('ledger offline'); }; await assert.rejects(f.reader.readForPrincipal(context), /ledger offline/);
});
test('unavailable source cannot manufacture ready empty inventory', async () => {
  const f = fixture(); f.source.inventoryState = 'unavailable'; f.source.currencies = [];
  const value = await f.read(); assert.equal(value.state, 'unavailable'); assert.deepEqual(value.currencies, []);
});

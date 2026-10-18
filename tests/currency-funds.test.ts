import test from 'node:test';
import assert from 'node:assert/strict';
import { buildCurrencyFunds, buildCurrencyFundsList, formatFundsUnits, type CurrencyFundsInput, type PrincipalFundsLine } from '../src/wallet/currencyFunds.ts';
const block = '0x' + '1'.repeat(64);
function snapshot(): CurrencyFundsInput {
  return { currency: { chainId: '560048', kind: 'native', contract: null, decimals: 18 },
    state: 'ready', balanceBasis: 'total-includes-escrow', balanceBaseUnits: '1000000000000000000',
    blockHash: block, escrowState: 'complete', escrows: [] };
}
function held(overrides: Partial<PrincipalFundsLine> = {}): PrincipalFundsLine {
  return { kind: 'financial-principal', reservationId: 'reservation-a', nftId: 'nft-a', currency: snapshot().currency,
    amountBaseUnits: '200000000000000000', state: 'held', blockHash: block, ...overrides };
}
test('available equals total minus original unreleased principal with exact units and NFT reconciliation', () => {
  const a = buildCurrencyFunds({ ...snapshot(), escrows: [held()] });
  assert.equal(a.totalBaseUnits, '1000000000000000000'); assert.equal(a.unreleasedBaseUnits, '200000000000000000');
  assert.equal(a.availableBaseUnits, '800000000000000000');
  assert.deepEqual(a.nftEscrows, [{ nftId: 'nft-a', unreleasedBaseUnits: '200000000000000000' }]); assert.equal(a.canExecute, false);
});
test('liquid balances add held principal once instead of subtracting it twice', () => {
  const a = buildCurrencyFunds({ ...snapshot(), balanceBasis: 'wallet-liquid', balanceBaseUnits: '800000000000000000', escrows: [held(), held()] });
  assert.equal(a.totalBaseUnits, '1000000000000000000'); assert.equal(a.availableBaseUnits, '800000000000000000');
  assert.throws(() => buildCurrencyFunds({ ...snapshot(), escrows: [held(), held({ amountBaseUnits: '1' })] }));
});
test('released and refunded records do not remain unreleased or increase available twice', () => {
  const a = buildCurrencyFunds({ ...snapshot(), escrows: [held({ state: 'released' }), held({ reservationId: 'reservation-b', state: 'refunded' })] });
  assert.equal(a.unreleasedBaseUnits, '0'); assert.equal(a.availableBaseUnits, a.totalBaseUnits);
});
test('unknown financial results and stale/incomplete inventories never appear as successful zero escrow', () => {
  assert.equal(buildCurrencyFunds({ ...snapshot(), escrows: [held({ state: 'unknown' })] }).availableBaseUnits, null);
  for (const escrowState of ['stale', 'unavailable'] as const)
    assert.equal(buildCurrencyFunds({ ...snapshot(), escrowState }).unreleasedBaseUnits, null);
  for (const state of ['loading', 'stale', 'unavailable'] as const)
    assert.equal(buildCurrencyFunds({ ...snapshot(), state, balanceBaseUnits: null }).totalBaseUnits, null);
});
test('currencies and networks remain independent without conversion or a grand total', () => {
  const token: CurrencyFundsInput = { ...snapshot(), currency: { chainId: '560048', kind: 'erc20', contract: '0x' + '2'.repeat(40), decimals: 6 }, balanceBaseUnits: '250000000' };
  const result = buildCurrencyFundsList([snapshot(), token]);
  assert.equal(result.length, 2); assert.equal(result[1]!.availableBaseUnits, '250000000');
  assert.equal('grandTotal' in result, false); assert.throws(() => buildCurrencyFundsList([snapshot(), snapshot()]));
});
test('foreign denominations, cross-block records, grant metadata and overdrawn totals refuse', () => {
  assert.throws(() => buildCurrencyFunds({ ...snapshot(), escrows: [held({ currency: { ...snapshot().currency, chainId: '1' } })] }));
  assert.throws(() => buildCurrencyFunds({ ...snapshot(), escrows: [held({ blockHash: '0x' + '3'.repeat(64) })] }));
  assert.throws(() => buildCurrencyFunds({ ...snapshot(), escrows: [held({ kind: 'grant-reservation' as never })] }));
  assert.throws(() => buildCurrencyFunds({ ...snapshot(), balanceBaseUnits: '1', escrows: [held()] }));
});
test('display formatting retains exact decimals above MAX_SAFE_INTEGER without floating point', () => {
  assert.equal(formatFundsUnits('9007199254740993123456', 6), '9007199254740993.123456');
  assert.equal(formatFundsUnits('1', 18), '0.000000000000000001'); assert.equal(formatFundsUnits('1', 0), '1');
  assert.throws(() => formatFundsUnits('01', 18)); assert.throws(() => formatFundsUnits('1', -1));
});
test('summary is a whitelist and contains no private source identities or counterparties', () => {
  const input = { ...snapshot(), escrows: [{ ...held(), payer: 'private-payer', payee: 'private-payee' }], endpoint: 'private-endpoint' };
  const text = JSON.stringify(buildCurrencyFunds(input));
  assert.equal(/private-payer|private-payee|private-endpoint|reservation-a/.test(text), false);
});


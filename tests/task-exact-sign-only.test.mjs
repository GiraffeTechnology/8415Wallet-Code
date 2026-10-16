import test from 'node:test';
import assert from 'node:assert/strict';
import { Wallet, Transaction } from 'ethers';
import { createTaskExactSignOnly } from '../server/task-exact-sign-only.mjs';
function fixture({ chain = '0x88bb0', selected = null, mutate = null, unsupported = false } = {}) {
  const wallet = Wallet.createRandom(), calls = [];
  const tx = Transaction.from({ type: 2, chainId: 560048n, nonce: 3, to: '0x' + '2'.repeat(40),
    value: 1n, data: '0x', gasLimit: 21000n, maxFeePerGas: 10n, maxPriorityFeePerGas: 1n, accessList: [] });
  const input = { requestId: 'exact:synthetic', unsignedSerialized: tx.unsignedSerialized,
    unsignedDigest: tx.unsignedHash, binding: { actor: wallet.address.toLowerCase(), chainId: '560048', nonce: '3' } };
  const walletProvider = { async request({ method, params }) {
    calls.push({ method, params });
    if (method === 'eth_chainId') return chain;
    if (method === 'eth_accounts') return [selected ?? wallet.address];
    if (method === 'eth_signTransaction') {
      if (unsupported) throw Object.assign(Error('Unsupported'), { code: -32601 });
      const p = params[0];
      return wallet.signTransaction({ type: 2, chainId: BigInt(p.chainId), nonce: Number(BigInt(p.nonce)),
        to: p.to, data: p.data, value: BigInt(p.value), gasLimit: BigInt(p.gas),
        maxFeePerGas: BigInt(p.maxFeePerGas), maxPriorityFeePerGas: BigInt(p.maxPriorityFeePerGas),
        accessList: [], ...(mutate ?? {}) });
    }
    assert.fail('Unexpected method ' + method);
  } };
  return { adapter: createTaskExactSignOnly({ walletProvider }), walletProvider, wallet, calls, tx, input };
}
test('existing wallet signs exact bytes without nonce/fee filling or broadcast', async () => {
  const f = fixture(), raw = await f.adapter.signExactTransaction(f.input), tx = Transaction.from(raw);
  assert.equal(tx.unsignedSerialized, f.tx.unsignedSerialized);
  assert.equal(tx.from.toLowerCase(), f.input.binding.actor);
  assert.equal(f.calls.filter(c => c.method === 'eth_signTransaction').length, 1);
  assert.equal(f.calls.some(c => /send|requestAccounts/.test(c.method)), false);
});
test('unsupported sign-only method never falls back to provider broadcast', async () => {
  const f = fixture({ unsupported: true });
  await assert.rejects(f.adapter.signExactTransaction(f.input), /Unsupported/);
  assert.equal(f.calls.some(c => c.method === 'eth_sendTransaction' || c.method === 'eth_sendRawTransaction'), false);
});
test('wrong selected account or chain refuses before the signing prompt', async () => {
  for (const options of [{ chain: '0x1' }, { selected: '0x' + '3'.repeat(40) }]) {
    const f = fixture(options);
    await assert.rejects(f.adapter.signExactTransaction(f.input), /WALLET_BINDING_REFUSED/);
    assert.equal(f.calls.some(c => c.method === 'eth_signTransaction'), false);
  }
});
test('changed nonce or fee in signed result is rejected without broadcast', async () => {
  for (const mutate of [{ nonce: 4 }, { maxFeePerGas: 11n }]) {
    const f = fixture({ mutate });
    await assert.rejects(f.adapter.signExactTransaction(f.input), /RESULT_REFUSED/);
    assert.equal(f.calls.some(c => /send/.test(c.method)), false);
  }
});
test('captured provider cannot be replaced during an approved attempt', async () => {
  const f = fixture();
  f.walletProvider.request = () => assert.fail('replacement must not run');
  assert.ok(await f.adapter.signExactTransaction(f.input));
});
test('nonmatching unsigned digest or nonce binding never reaches wallet', async () => {
  for (const field of ['unsignedDigest', 'nonce']) {
    const f = fixture();
    if (field === 'nonce') f.input.binding.nonce = '4'; else f.input.unsignedDigest = '0x' + '4'.repeat(64);
    await assert.rejects(f.adapter.signExactTransaction(f.input), /BINDING_REFUSED/);
    assert.equal(f.calls.length, 0);
  }
});


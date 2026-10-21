import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveLoginIdentifier, authenticatedWalletRoute, validWalletName } from '../server/login-identifier.mjs';

const first = '0x' + '1'.repeat(40), second = '0x' + '2'.repeat(40);
const alice = { username: 'account-one', walletName: 'example-one', wallets: [{ account: first, chainId: '1' }] };
const bob = { username: 'account-two', walletName: 'example-two', wallets: [{ account: second, chainId: '1' }] };
const users = new Map([[alice.username, alice], [bob.username, bob]]);
const emailAlias = value => value.toLowerCase() === 'one@example.invalid' ? alice.username : null;
const resolve = (identifier, extra = {}) => resolveLoginIdentifier({ identifier, users, emailAlias, selected: { account: first, chainId: '1' }, ...extra });

for (const identifier of ['account-one', 'example-one', 'one@example.invalid', first, '  example-one  ']) {
  test(`private identifier resolution accepts a bound ${identifier.includes('@') ? 'email' : 'identifier'}`, () => {
    assert.equal(resolve(identifier), alice);
  });
}
test('unknown, other-wallet and wrong-chain identifiers never resolve', () => {
  for (const identifier of ['unknown', 'example-two', second, '', '\u0000example-one', 'x'.repeat(255)]) assert.equal(resolve(identifier), null);
  assert.equal(resolve('example-one', { selected: { account: first, chainId: '8453' } }), null);
  assert.equal(resolve('example-one', { selected: { account: second, chainId: '1' } }), null);
});
test('an address-shaped username cannot shadow a different account address', () => {
  const shadow = { ...bob, username: first };
  const collisions = new Map([[alice.username, alice], [shadow.username, shadow]]);
  assert.equal(resolve(first, { users: collisions }), null);
  assert.equal(resolve(first, { users: collisions, selected: { account: second, chainId: '1' } }), null);
});
test('same-address records on separate chains use the exact requested chain', () => {
  const otherChain = { ...bob, wallets: [{ account: first, chainId: '8453' }] };
  const separated = new Map([[alice.username, alice], [otherChain.username, otherChain]]);
  assert.equal(resolve(first, { users: separated }), alice);
  assert.equal(resolve(first, { users: separated, selected: { account: first, chainId: '8453' } }), otherChain);
});
test('a wallet-name or email collision is not resolved by guessing the connected account', () => {
  const shadow = { ...bob, walletName: 'example-one' };
  assert.equal(resolve('example-one', { users: new Map([[alice.username, alice], [shadow.username, shadow]]) }), null);
  assert.equal(resolve('account-one', { emailAlias: () => bob.username }), null);
});
test('canonical routes require an explicit valid server-owned wallet name', () => {
  assert.deepEqual(authenticatedWalletRoute(alice), { walletName: 'example-one', walletPath: '/example-one' });
  assert.equal(authenticatedWalletRoute({ username: 'account-one' }), null);
  for (const value of ['auth', 'web', 'default', '../other', 'https://other.invalid', 'a%2fb', 'a/b', 'Upper', '__proto__']) {
    assert.equal(validWalletName(value), false);
    assert.equal(authenticatedWalletRoute({ walletName: value }), null);
  }
});

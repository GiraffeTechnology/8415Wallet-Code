// Synthetic public identities only. No store key, credential store or service activation.
import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAuthConfig, validateAccountBindings } from '../server/config-validation.mjs';
import { initialRegistrationConfig, initialTenantConfig, runOperatorInit } from '../server/operator-init.mjs';
import { createAuthService } from '../server/auth-service.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { readFileSync } from 'node:fs';
const address = `0x${'1'.repeat(40)}`;
const binding = Object.freeze({ tenant: 'synthetic-tenant', origin: 'https://synthetic.example:9446', port: 21001 });
const config = () => initialTenantConfig('synthetic-user', address, ['1', '8453'], binding);
test('explicit empty accounts support ordinary registration without creating a bound account', () => {
  const template = JSON.parse(readFileSync(new URL('../config/auth.tenant.preparation.json', import.meta.url)));
  assert.deepEqual(validateAuthConfig(template), { accountCount: 0, bindingCount: 0 });
  assert.deepEqual(validateAccountBindings([]), { accountCount: 0, bindingCount: 0 });
  assert.equal(typeof createAuthService({ ...template, store: new MemoryCredentialStore() }), 'function');
});
test('absent, null and non-array account configuration still refuse', () => {
  for (const accounts of [undefined, null, {}, '', false]) {
    assert.throws(() => validateAccountBindings(accounts), /AUTH_ACCOUNTS_REQUIRED/);
    assert.throws(() => createAuthService({ ...config(), accounts, store: new MemoryCredentialStore() }), /AUTH_CONFIG_REFUSED/);
  }
});
test('initial wallet-only binding has no fabricated password, CA or secret', () => {
  const value = config(); assert.deepEqual(validateAuthConfig(value), { accountCount: 1, bindingCount: 2 });
  assert.deepEqual(Object.keys(value.accounts[0]), ['username', 'wallets']);
});
for (const username of ['__proto__', 'constructor', 'prototype', 'aa', 'UPPERCASE']) test(`refuse invalid username ${username}`, () => {
  assert.throws(() => initialTenantConfig(username, address, ['1'], binding), /AUTH_USERNAME_REFUSED/);
});
test('the same address and chain cannot be bound to another account', () => {
  const value = config(); value.accounts.push({ username: 'other-user', wallets: [{ account: address.toUpperCase().replace('0X','0x'), chainId: '1' }] });
  assert.throws(() => validateAuthConfig(value), /AUTH_DUPLICATE_WALLET_CHAIN_BINDING/);
  assert.throws(() => createAuthService({ ...value, store: new MemoryCredentialStore() }), /AUTH_CONFIG_REFUSED/);
});
test('duplicate within one account is refused but distinct chains remain distinct', () => {
  const value = config(); value.accounts[0].wallets.push(value.accounts[0].wallets[0]);
  assert.throws(() => validateAccountBindings(value.accounts), /AUTH_DUPLICATE/);
});
for (const chain of [1, '01', '0x1', '31337', 'unknown']) test(`operator Ethereum/Base selection refuses ${chain}`, () => {
  assert.throws(() => initialTenantConfig('synthetic-user', address, [chain], binding), /AUTH_CONFIRMED_CHAIN_SCOPE_REQUIRED/);
});
test('zero address, numeric chain and empty binding are refused', () => {
  assert.throws(() => initialTenantConfig('synthetic-user', `0x${'0'.repeat(40)}`, ['1'], binding), /AUTH_WALLET_BINDING_REFUSED/);
  const value = config(); value.accounts[0].wallets[0].chainId = 1;
  assert.throws(() => validateAuthConfig(value), /AUTH_WALLET_BINDING_REFUSED/);
});
test('unknown client identity fields are not authentication configuration', () => {
  assert.throws(() => validateAuthConfig({ ...config(), operatorIdentifier: 'unverified' }), /AUTH_CONFIG_FIELD_REFUSED/);
});
test('invalid port, noncanonical origin and traversal state path are refused', () => {
  for (const delta of [{ port: 0 }, { origin: 'https://synthetic.example:9446/web/' }, { statePath: '/var/lib/../tmp/state' }]) {
    assert.throws(() => validateAuthConfig({ ...config(), ...delta }));
  }
});
test('help has no filesystem or listener side effect', async () => {
  let output = ''; await runOperatorInit(['--help'], {}, { write: text => { output += text; } });
  assert.match(output, /No secret input/);
});

test('initial public binding requires explicit deployment metadata without defaults', () => {
  for (const value of [undefined, null, {}, { ...binding, tenant: '' }, { ...binding, tenant: 'synthetic-tenant\n' }, { ...binding, port: '21001' }, { ...binding, extra: true }]) {
    assert.throws(() => initialTenantConfig('synthetic-user', address, ['1'], value));
  }
});
test('initialization refuses missing tenant arguments before any platform or filesystem work', async () => {
  for (const args of [[], ['--initialize'], ['--check'], ['--help', '--tenant', 'synthetic-tenant'], ['--initialize', '--tenant', '../fixture']]) {
    await assert.rejects(runOperatorInit(args, {}, {}), /AUTH_OPERATOR_(ARGUMENT|TENANT)_REFUSED/);
  }
});



test('registration-only initialization carries explicit deployment scope and no account prerequisite', () => {
  const config = initialRegistrationConfig(binding);
  assert.deepEqual(config.accounts, []);
  assert.deepEqual(validateAuthConfig(config), { accountCount: 0, bindingCount: 0 });
  assert.equal(config.tenant, binding.tenant); assert.equal(config.origin, binding.origin);
});
test('registration initialization still rejects missing or malformed deployment scope', () => {
  for (const candidate of [null, undefined, {}, { ...binding, tenant: '../other' }, { ...binding, port: 0 }, { ...binding, extra: true }]) {
    assert.throws(() => initialRegistrationConfig(candidate));
  }
});
test('existing explicit Ethereum and Base bindings keep their identifiers and exact scope', () => {
  const account = `0x${'1'.repeat(40)}`;
  const value = initialTenantConfig('existing-user', account, ['1', '8453'], binding);
  assert.deepEqual(value.accounts, [{ username: 'existing-user', wallets: [{ account, chainId: '1' }, { account, chainId: '8453' }] }]);
});

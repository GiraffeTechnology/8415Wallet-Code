import test from 'node:test';
import assert from 'node:assert/strict';
import { kitDisplayBase, readKitDisplay } from '../web/kit-read.mjs';

const hash = n => '0x' + n.repeat(64);
function setup() {
  const identity = { registerId: hash('1'), verificationProfile: hash('2') };
  const wallet = { reader: { source: { chainId: 560048n, address: '0x' + '3'.repeat(40) } },
    assetView: async () => ({ identity: { ...identity }, owner: 'direct-chain' }) };
  let calls = 0;
  const args = { wallet, tokenId: 1n, instant: '100', basePath: '/existing-kit', origin: 'https://wallet.example', guard: () => {},
    compose: input => {
      calls++; assert.equal(input.chain, wallet.reader); assert.equal(input.source.chainId, 560048n);
      return { assetView: async () => ({ identity: { ...identity }, owner: 'direct-chain' }),
        temporalQuery: async () => ({ finality: 'provisional', holder: 'register-holder' }) };
    } };
  return { args, wallet, get calls() { return calls; } };
}
test('same-origin existing path only with no query, fragment, credentials or parent traversal', () => {
  assert.equal(kitDisplayBase('/existing-kit/tenant', 'https://wallet.example:9446'), 'https://wallet.example:9446/existing-kit/tenant');
  for (const path of ['', '/', '//remote.example', 'https://remote.example', '/a/../b', '/a?key=x', '/a#x', '/a%2fb']) {
    assert.throws(() => kitDisplayBase(path, 'https://wallet.example'));
  }
  assert.throws(() => kitDisplayBase('/kit', 'http://wallet.example'));
  assert.throws(() => kitDisplayBase('/kit', 'https://user:secret@wallet.example'));
});
test('composed display preserves separate chain position and projection holder without mutating session', async () => {
  const f = setup(), reader = f.wallet.reader, value = await readKitDisplay(f.args);
  assert.equal(f.calls, 1); assert.equal(f.wallet.reader, reader);
  assert.equal(value.asset.owner, 'direct-chain'); assert.equal(value.temporal.holder, 'register-holder');
  assert.equal(value.canExecute, false); assert.equal(value.changesRuntimeConfiguration, false);
});
test('invalid instant fails before composition', async () => {
  for (const instant of ['01', '-1', '18446744073709551616']) {
    const f = setup(); await assert.rejects(readKitDisplay({ ...f.args, instant })); assert.equal(f.calls, 0);
  }
});
test('chain conformance/identity failure is not bypassed with Kit', async () => {
  const f = setup(); f.wallet.assetView = async () => { throw new Error('chain refused'); };
  await assert.rejects(readKitDisplay(f.args)); assert.equal(f.calls, 0);
});
test('backend disagreement is not replaced by a direct-chain answer', async () => {
  const f = setup();
  await assert.rejects(readKitDisplay({ ...f.args, compose: () => ({ assetView: async () => { throw new Error('disagreed'); } }) }));
});
test('mismatching register or verification profile prevents publication', async () => {
  for (const field of ['registerId', 'verificationProfile']) {
    const f = setup();
    await assert.rejects(readKitDisplay({ ...f.args, compose: () => ({
      assetView: async () => ({ identity: { registerId: hash('1'), verificationProfile: hash('2'), [field]: hash('4') } }),
      temporalQuery: async () => ({ finality: 'provisional' }),
    }) }));
  }
});
test('logout guard during read prevents late result', async () => {
  const f = setup(); let revoked = false;
  await assert.rejects(readKitDisplay({ ...f.args, guard: () => { if (revoked) throw new Error('revoked'); },
    compose: () => ({ assetView: async () => { revoked = true; return {}; } }) }));
});
test('reader replacement during asynchronous Kit read prevents publication', async () => {
  const f = setup();
  await assert.rejects(readKitDisplay({ ...f.args, compose: () => ({ assetView: async () => {
    f.wallet.reader = { source: { ...f.wallet.reader.source } }; return {};
  } }) }));
});

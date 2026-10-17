import assert from 'node:assert/strict';
import { test } from 'node:test';
import { divergentToken, projectionOnlyToken, TOKEN, commitment } from '../src/adapters/memory/scenarios.ts';
import { IdentityChangedError } from '../src/sdk/errors.ts';
import { WalletSession } from '../src/wallet/session.ts';
const methods = ['ownershipHistory', 'settlementLog', 'riskSurfaces'] as const;

for (const method of methods) {
  test(`${method} shares the identity established by another session view`, async () => {
    const { reader } = divergentToken();
    const wallet = new WalletSession(reader);
    await wallet.assetView(TOKEN);
    reader.registerId = async () => commitment('e');
    await assert.rejects(() => wallet[method](TOKEN), IdentityChangedError);
  });
  test(`${method} refuses identity drift during its asynchronous data reads`, async () => {
    const { reader } = divergentToken();
    const logs = reader.getLogs.bind(reader);
    reader.getLogs = async filter => {
      const result = await logs(filter);
      reader.registerId = async () => commitment('e');
      return result;
    };
    const wallet = new WalletSession(reader);
    await assert.rejects(() => wallet[method](TOKEN), IdentityChangedError);
  });
}
test('projection-only settlement history neither probes logs nor reports a no-gap fact', async () => {
  const { reader } = projectionOnlyToken();
  reader.getLogs = async () => { assert.fail('unadvertised settlement logs queried'); };
  const view = await new WalletSession(reader).settlementLog(TOKEN);
  assert.equal(view.available, false);
  assert.deepEqual(view.episodes, []);
  assert.match(view.note, /no settlement interface/);
  assert.match(view.note, /not an assertion that no gaps occurred/);
});
test('stable identity permits all three legacy read views', async () => {
  const { reader } = divergentToken();
  const wallet = new WalletSession(reader);
  for (const method of methods) {
    const value = await wallet[method](TOKEN);
    assert.equal(value.tokenId, TOKEN);
  }
});

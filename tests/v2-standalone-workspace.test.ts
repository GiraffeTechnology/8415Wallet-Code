import assert from 'node:assert/strict';
import { test } from 'node:test';
import { divergentToken, TOKEN, T } from '../src/adapters/memory/scenarios.ts';
import { WalletSession } from '../src/wallet/session.ts';
import { readAssetWorkspace, readRegisterHistoryPage } from '../src/standalone/assetWorkspace.ts';
import { renderAssetWorkspace } from '../src/standalone/renderAssetWorkspace.ts';
import { readAssetWorkspace as baseline } from '../src/wallet/assetWorkspace.ts';

test('V2 workspace retains exact ordinary observations, paged history and unavailable semantics', async () => {
  const wallet = new WalletSession(divergentToken().reader);
  const actual = await readAssetWorkspace(wallet, TOKEN, T.asOf, { includeLogs: true });
  const expected = await baseline(wallet, TOKEN, T.asOf, { includeLogs: true });
  for (const key of ['source','instant','asset','temporal','registerHistory','ownershipHistory','settlementLog','linked','payments','paymentMode','canExecute'] as const)
    assert.deepEqual(actual[key], expected[key], key);
  const page = await readRegisterHistoryPage(wallet, TOKEN, 1n, 2);
  assert.equal(page.nextVersion, 3n); assert.deepEqual(page.entries.map(e=>e.version),[1n,2n]);
  for (const tab of ['asset','temporal','register-history','dual-history'] as const) assert.equal(typeof renderAssetWorkspace(actual,tab),'string');
});
test('V2 refuses linked input before any ordinary or linked read and refuses linked render', async () => {
  let reads=0;
  const wallet = { get reader(){ reads++; throw Error('read'); } } as unknown as WalletSession;
  await assert.rejects(readAssetWorkspace(wallet, TOKEN, T.asOf, { linked: {} as never }), /WORKSPACE_INPUT_REFUSED/);
  assert.equal(reads,0);
  const actual=await readAssetWorkspace(new WalletSession(divergentToken().reader), TOKEN,T.asOf);
  assert.throws(()=>renderAssetWorkspace(actual,'responsibility' as never),/WORKSPACE_TAB_REFUSED/);
  assert.throws(()=>renderAssetWorkspace(actual,'payments' as never),/WORKSPACE_TAB_REFUSED/);
});

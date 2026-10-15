import assert from 'node:assert/strict';
import { test } from 'node:test';
import { divergentToken, TOKEN, T, ALICE } from '../src/adapters/memory/scenarios.ts';
import { TransportError } from '../src/sdk/errors.ts';
import { WalletSession } from '../src/wallet/session.ts';
import { readAssetWorkspace, readRegisterHistoryPage, type WorkspaceLinkedInput } from '../src/wallet/assetWorkspace.ts';
import { renderAssetWorkspace } from '../src/wallet/renderAssetWorkspace.ts';
import { delegateReader } from './support/delegateReader.ts';

const h = (letter: string) => '0x' + letter.repeat(64);
function fixture() {
  const { reader } = divergentToken();
  const wallet = new WalletSession(reader);
  const linked: WorkspaceLinkedInput = {
    sequenceId: h('1'),
    reader: { observe: async sequenceId => ({
      snapshot: {
        asset: { chainId: reader.source.chainId, contract: reader.source.address, tokenId: TOKEN },
        sequenceId, revision: 3n, blockNumber: 10n, blockHash: h('2'),
        initialOccurrenceId: h('3'), initialHolder: ALICE,
        legs: [], offChainDetached: 2n, detachedCommitment: h('4'),
      },
      evidence: { kind: 'unavailable' },
    }) },
    readBlockHash: async () => h('2'),
  };
  return { wallet, reader, linked };
}

test('register pages preserve exact admission order and lossless version cursors', async () => {
  const { wallet } = fixture();
  const first = await readRegisterHistoryPage(wallet, TOKEN, 1n, 2);
  assert.deepEqual(first.entries.map(e => e.version), [1n, 2n]);
  assert.equal(first.nextVersion, 3n);
  const last = await readRegisterHistoryPage(wallet, TOKEN, first.nextVersion!, 2);
  assert.deepEqual(last.entries.map(e => e.version), [3n]);
  assert.equal(last.nextVersion, null);
  assert.equal(last.totalEntries, 3n);
});

test('oversized history pages and nonconsecutive returned versions are refused', async () => {
  const { wallet, reader } = fixture();
  await assert.rejects(readRegisterHistoryPage(wallet, TOKEN, 1n, 65), /WORKSPACE_INPUT_REFUSED/);
  const wrong = new WalletSession(delegateReader(reader, {
    entryAt: async (id, version) => ({ ...await reader.entryAt(id, version), version: 99n }),
  }));
  await assert.rejects(readRegisterHistoryPage(wrong, TOKEN), /WORKSPACE_INPUT_REFUSED/);
});

test('standalone operation does not require a control or payment adapter', async () => {
  const { wallet } = fixture();
  const result = await readAssetWorkspace(wallet, TOKEN, T.asOf);
  assert.equal(result.asset.state, 'ready');
  assert.equal(result.temporal.state, 'ready');
  assert.equal(result.linked.state, 'not-requested');
  assert.equal(result.paymentMode, 'not-configured');
  assert.equal(result.canExecute, false);
});

test('no-payment responsibility retains the detached window and boundary', async () => {
  const { wallet, linked } = fixture();
  const result = await readAssetWorkspace(wallet, TOKEN, T.asOf, { linked });
  assert.equal(result.linked.state, 'ready');
  if (result.linked.state !== 'ready') return;
  assert.equal(result.linked.value.offChainDetached, 2n);
  assert.equal(result.linked.value.returnBoundary.account, ALICE);
  assert.match(renderAssetWorkspace(result, 'payments'), /does not require escrow or payment/);
  assert.match(renderAssetWorkspace(result, 'responsibility'), /Detached and held off chain: 2/);
});

test('detached payment is read by leg ID at the linked block, never a window index', async () => {
  const { wallet, linked } = fixture();
  const calls: unknown[] = [];
  const result = await readAssetWorkspace(wallet, TOKEN, T.asOf, {
    linked: { ...linked, detachedPaymentLegIds: [h('5')],
      payments: { readAt: async (sequenceId, legId, blockHash) => {
        calls.push([sequenceId, legId, blockHash]);
        return { sequenceId, legId, payer: ALICE, payee: ALICE, amount: 7n, state: 'settlement-due' };
      } },
    },
  });
  assert.deepEqual(calls, [[h('1'), h('5'), h('2')]]);
  assert.equal(result.payments[0]?.result.state, 'ready');
  assert.equal(result.linked.state, 'ready');
});

test('payment failure remains separate from responsibility status', async () => {
  const { wallet, linked } = fixture();
  const result = await readAssetWorkspace(wallet, TOKEN, T.asOf, {
    linked: { ...linked, detachedPaymentLegIds: [h('5')],
      payments: { readAt: async () => { throw new TransportError('payment', 'unavailable'); } },
    },
  });
  assert.equal(result.linked.state, 'ready');
  assert.equal(result.payments[0]?.result.state, 'unavailable');
  assert.equal(result.paymentMode, 'configured');
});

test('failure of one standalone panel is not a cached successful substitute', async () => {
  const { reader } = fixture();
  const wallet = new WalletSession(delegateReader(reader, {
    entryAsOf: async () => { throw new TransportError('entryAsOf', 'unavailable'); },
  }));
  const result = await readAssetWorkspace(wallet, TOKEN, T.asOf);
  assert.equal(result.asset.state, 'ready');
  assert.equal(result.temporal.state, 'unavailable');
  assert.equal(result.registerHistory.state, 'ready');
  assert.match(renderAssetWorkspace(result, 'temporal'), /UNAVAILABLE/);
});

test('a canonical block change after payment reads refuses publication', async () => {
  const { wallet, linked } = fixture();
  let reads = 0;
  await assert.rejects(readAssetWorkspace(wallet, TOKEN, T.asOf, {
    linked: { ...linked, readBlockHash: async () => ++reads === 1 ? h('2') : h('6') },
  }), /WORKSPACE_INPUT_REFUSED/);
});

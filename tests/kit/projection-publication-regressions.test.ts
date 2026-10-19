import { test } from 'node:test';
import assert from 'node:assert/strict';
import { EthereumProjectionReader } from '../../src/kit/adapters/ethereum/projectionReader.ts';
import { ChainIdentityError } from '../../src/kit/adapters/ethereum/chainIdentity.ts';
import { SELECTOR } from '../../src/kit/adapters/ethereum/abi.ts';
import type { JsonRpcTransport } from '../../src/kit/adapters/ethereum/transport.ts';

// Synthetic shared-provider publication regression. No real endpoint, wallet
// or transaction is used. Execute through the authorized Linux CI.
const CONTRACT = `0x${'ee'.repeat(20)}`;
const ACCOUNT = `0x${'aa'.repeat(20)}`;
const word = (value: bigint): string => value.toString(16).padStart(64, '0');
const entry = `0x${[1n, 0n, 0n, 1n, 1n, 100n, 0n].map(word).join('')}`;
const operations: readonly [string, (reader: EthereumProjectionReader) => Promise<unknown>][] = [
  ['supportsProjection', reader => reader.supportsProjection()],
  ['supportsSettlement', reader => reader.supportsSettlement()],
  ['registerId', reader => reader.registerId()],
  ['verificationProfile', reader => reader.verificationProfile()],
  ['entryCount', reader => reader.entryCount(1n)],
  ['currentEntry', reader => reader.currentEntry(1n)],
  ['entryAt', reader => reader.entryAt(1n, 1n)],
  ['entryAsOf', reader => reader.entryAsOf(1n, 100n)],
  ['holderAsOf', reader => reader.holderAsOf(1n, 100n)],
  ['isFinalAsOf', reader => reader.isFinalAsOf(1n, 100n)],
  ['openGapOf', reader => reader.openGapOf(1n)],
  ['isSettlementAuthority', reader => reader.isSettlementAuthority(1n, ACCOUNT)],
];

for (const [name, operation] of operations) {
  test(`Kit ${name} rejects a shared mismatch queued after its private publication check`, async () => {
    let identityCalls = 0;
    let dataCalls = 0;
    let concurrentRejection: Promise<void> | undefined;
    let other!: EthereumProjectionReader;
    const transport: JsonRpcTransport = {
      // Deliberately non-async: return fulfilled native promises without adding
      // another async-function adoption layer to the documented queue order.
      send(request) {
        if (request.method === 'eth_chainId') {
          identityCalls += 1;
          if (identityCalls === 2) {
            // At A's final identity request, enqueue M1 before #verify awaits
            // its fulfilled response. FIFO jobs then alternate:
            // M1, A.#verify, M2, A.read.finally, M3, A.#call, B.#verify.
            // B increments the revision after A.#call's guard but before A's
            // queued decoder/#slot continuation. The public promise is pending.
            queueMicrotask(() => queueMicrotask(() => queueMicrotask(() => {
              concurrentRejection = assert.rejects(other.entryCount(1n), ChainIdentityError);
            })));
          }
          return Promise.resolve(identityCalls <= 2 ? '0x1' : '0x2');
        }
        if (request.method === 'eth_call') {
          dataCalls += 1;
          const selector = (request.params[0] as { data: string }).data.slice(0, 10);
          const isEntry = selector === SELECTOR.currentEntry ||
            selector === SELECTOR.entryAt || selector === SELECTOR.entryAsOf;
          return Promise.resolve(isEntry ? entry : `0x${word(1n)}`);
        }
        return Promise.reject(new Error(`unexpected RPC method: ${request.method}`));
      },
    };
    const reader = new EthereumProjectionReader({ transport, contract: CONTRACT });
    other = new EthereumProjectionReader({ transport, contract: CONTRACT });
    await assert.rejects(operation(reader), ChainIdentityError);
    assert.ok(concurrentRejection, 'the concurrent mismatch was launched');
    await concurrentRejection;
    assert.equal(identityCalls, 3);
    assert.equal(dataCalls, 1, 'only A reaches eth_call; B fails its first identity check');
  });
}

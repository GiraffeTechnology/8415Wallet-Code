import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RpcErc8415Reader } from '../src/adapters/rpc/rpcReader.ts';
import type { CallTransport } from '../src/adapters/rpc/transport.ts';
import { ValueOutOfRangeError } from '../src/sdk/errors.ts';

const address = '0x1111111111111111111111111111111111111111';

function unusedTransport(): CallTransport {
  const unexpected = async (): Promise<never> => {
    assert.fail('invalid scan options must be refused before transport use');
  };
  return {
    call: unexpected,
    blockTimestamp: unexpected,
    blockTimestampAt: unexpected,
    blockNumber: unexpected,
    codeAt: unexpected,
    getLogs: unexpected,
  };
}

for (const logWindow of [0n, -1n]) {
  test(`refuses non-positive logWindow ${logWindow} at construction`, () => {
    assert.throws(
      () => new RpcErc8415Reader(unusedTransport(), 1n, address, { logWindow }),
      ValueOutOfRangeError,
    );
  });
}

test('refuses a negative configured starting block', () => {
  assert.throws(
    () => new RpcErc8415Reader(unusedTransport(), 1n, address, { fromBlock: -1n }),
    ValueOutOfRangeError,
  );
});

test('preserves defaults and the smallest valid scan configuration', () => {
  assert.doesNotThrow(() => new RpcErc8415Reader(unusedTransport(), 1n, address));
  assert.doesNotThrow(
    () => new RpcErc8415Reader(unusedTransport(), 1n, address, { logWindow: 1n, fromBlock: 0n }),
  );
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { RpcErc8415Reader } from '../src/adapters/rpc/rpcReader.ts';
import type { CallTransport } from '../src/adapters/rpc/transport.ts';
import { TransportError } from '../src/sdk/errors.ts';

const address = '0x1111111111111111111111111111111111111111';
const topic = '0x' + 'a'.repeat(64);
function validLog(): Record<string, unknown> {
  return { address, topics: [topic], data: '0x', blockNumber: '0x1', logIndex: '0x0' };
}
function readerFor(logs: unknown[]): RpcErc8415Reader {
  const unused = async (): Promise<never> => { assert.fail('unexpected transport request'); };
  const transport: CallTransport = {
    call: unused, blockTimestamp: unused, blockTimestampAt: unused, codeAt: unused,
    blockNumber: async () => 1n,
    getLogs: async () => logs,
  };
  return new RpcErc8415Reader(transport, 1n, address, { fromBlock: 0n });
}
const invalid: [string, unknown][] = [
  ['null entry', null],
  ['missing block number', { ...validLog(), blockNumber: undefined }],
  ['missing log index', { ...validLog(), logIndex: undefined }],
  ['missing data', { ...validLog(), data: undefined }],
  ['odd data bytes', { ...validLog(), data: '0x1' }],
  ['non-word topic', { ...validLog(), topics: ['0x01'] }],
  ['noncanonical quantity', { ...validLog(), logIndex: '0x00' }],
  ['wrong contract', { ...validLog(), address: '0x' + '2'.repeat(40) }],
  ['outside requested window', { ...validLog(), blockNumber: '0x2' }],
  ['removed log', { ...validLog(), removed: true }],
];
for (const [label, payload] of invalid) {
  test(`refuses ${label} rather than inventing history fields`, async () => {
    await assert.rejects(
      () => readerFor([validLog(), payload]).getLogs({ address, topics: [] }),
      TransportError,
    );
  });
}
test('preserves a complete valid log including zero index and empty data', async () => {
  const result = await readerFor([validLog()]).getLogs({ address, topics: [] });
  assert.deepEqual(result, [{ address, topics: [topic], data: '0x', blockNumber: 1n, logIndex: 0n }]);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeResult, encodeWords } from '../src/codec/abi.ts';
import { ValueOutOfRangeError } from '../src/sdk/errors.ts';
import { RpcErc8415Reader } from '../src/adapters/rpc/rpcReader.ts';
import type { CallTransport } from '../src/adapters/rpc/transport.ts';

const word = (value: bigint) => '0x' + value.toString(16).padStart(64, '0');

test('only canonical boolean zero and one decode as booleans', () => {
  assert.deepEqual(decodeResult(['bool'], word(0n)), [false]);
  assert.deepEqual(decodeResult(['bool'], word(1n)), [true]);
});
test('other boolean words are rejected instead of treated as true', () => {
  for (const value of [2n, (1n << 256n) - 1n]) {
    assert.throws(() => decodeResult(['bool'], word(value)), ValueOutOfRangeError);
  }
});
test('uint8 accepts its maximum and rejects nonzero high bits', () => {
  assert.deepEqual(decodeResult(['uint8'], word(255n)), [255n]);
  assert.throws(() => decodeResult(['uint8'], word(256n)), ValueOutOfRangeError);
});
test('uint64 preserves its maximum without accepting a larger word', () => {
  assert.deepEqual(decodeResult(['uint64'], word((1n << 64n) - 1n)), [(1n << 64n) - 1n]);
  assert.throws(() => decodeResult(['uint64'], word(1n << 64n)), ValueOutOfRangeError);
});
test('address cannot silently discard nonzero high padding', () => {
  assert.throws(() => decodeResult(['address'], `0x${'01'.repeat(12)}${'ab'.repeat(20)}`),
    ValueOutOfRangeError);
});
test('bytes4 cannot silently discard nonzero trailing padding', () => {
  assert.throws(() => decodeResult(['bytes4'], `0x6309e170${'00'.repeat(27)}01`),
    ValueOutOfRangeError);
});
test('nonhex, odd and partial-word payloads fail before decoding', () => {
  for (const value of [`0x${'00'.repeat(31)}gg`, `0x${'0'.repeat(63)}`,
    `0x${'00'.repeat(33)}`, `0x${'0'.repeat(63)}\n`]) {
    assert.throws(() => decodeResult(['bytes32'], value), ValueOutOfRangeError);
  }
});
test('canonical mixed tuples retain their exact typed values', () => {
  const types = ['uint256', 'uint64', 'uint8', 'address', 'bool', 'bytes32', 'bytes4'] as const;
  const values = [(1n << 256n) - 1n, (1n << 64n) - 1n, 255n,
    `0x${'ab'.repeat(20)}`, true, `0x${'cd'.repeat(32)}`, '0x6309e170'] as const;
  assert.deepEqual(decodeResult(types, encodeWords(types, values)), [...values]);
});
test('existing bare-hex and uppercase-prefix inputs remain supported', () => {
  assert.deepEqual(decodeResult(['uint8'], word(15n).slice(2).toUpperCase()), [15n]);
  assert.deepEqual(decodeResult(['uint8'], '0X' + word(15n).slice(2).toUpperCase()), [15n]);
});
test('extra complete words retain the existing decoder compatibility policy', () => {
  assert.deepEqual(decodeResult(['bool'], word(1n) + word(7n).slice(2)), [true]);
});
test('empty static tuples still decode an empty payload', () => {
  assert.deepEqual(decodeResult([], '0x'), []);
});
test('the RPC reader cannot convert an invalid boolean word into finality or conformance', async () => {
  const transport: CallTransport = {
    call: async () => word(2n),
    blockTimestamp: async () => 1n,
    blockTimestampAt: async () => 1n,
    blockNumber: async () => 1n,
    getLogs: async () => [],
    codeAt: async () => '0x6000',
  };
  const reader = new RpcErc8415Reader(transport, 560048n, `0x${'ab'.repeat(20)}`);
  await assert.rejects(reader.isFinalAsOf(1n, 1n), ValueOutOfRangeError);
  await assert.rejects(reader.supportsInterface('0x6309e170'), ValueOutOfRangeError);
});

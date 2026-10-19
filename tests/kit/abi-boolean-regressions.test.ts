import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toBigInt, toBool, word } from '../../src/kit/adapters/ethereum/abi.ts';
import { EthereumProjectionReader } from '../../src/kit/adapters/ethereum/projectionReader.ts';
import type { JsonRpcTransport } from '../../src/kit/adapters/ethereum/transport.ts';

test('Kit ABI boolean decoder accepts only canonical zero and one', () => {
  assert.equal(toBool(word(0n)), false);
  assert.equal(toBool(word(1n)), true);
  for (const value of [2n, 255n, (1n << 256n) - 1n]) {
    assert.throws(() => toBool(word(value)), /ABI bool must be 0 or 1/);
  }
  for (const malformed of ['', '1', '-1', '0'.repeat(63), '0'.repeat(65), 'g'.repeat(64)]) {
    assert.throws(() => toBool(malformed), /exactly one hexadecimal word/);
  }
  // The stricter boolean boundary must not redefine unrelated uint decoding.
  assert.equal(toBigInt(word(2n)), 2n);
  assert.equal(toBigInt(word((1n << 256n) - 1n)), (1n << 256n) - 1n);
});

test('Kit rejects ABI uint2 from all three boolean reader paths', async () => {
  const transport: JsonRpcTransport = { send: async (request) => {
    if (request.method === 'eth_chainId') return '0x1';
    return `0x${word(2n)}`;
  } };
  const reader = new EthereumProjectionReader({ transport, contract: `0x${'11'.repeat(20)}` });
  await assert.rejects(() => reader.supportsProjection(), /ABI bool must be 0 or 1/);
  await assert.rejects(() => reader.supportsSettlement(), /ABI bool must be 0 or 1/);
  await assert.rejects(() => reader.isFinalAsOf(1n, 100n), /ABI bool must be 0 or 1/);
  await assert.rejects(() => reader.isSettlementAuthority(1n, `0x${'22'.repeat(20)}`), /ABI bool must be 0 or 1/);
});

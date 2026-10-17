import assert from 'node:assert/strict';
import { test } from 'node:test';
import { divergentToken } from '../src/adapters/memory/scenarios.ts';
import { detectConformance } from '../src/sdk/conformance.ts';
import { ContractRevertError, TransportError } from '../src/sdk/errors.ts';
import { INTERFACE_ID_ERC165, INTERFACE_ID_REGISTER_PROJECTION } from '../src/sdk/interfaceIds.ts';
const none = { erc165: false, projection: false, settlement: false };

test('always-true fallback is not accepted as ERC165 and no product IDs are probed', async () => {
  const { reader } = divergentToken();
  const seen: string[] = [];
  reader.supportsInterface = async id => { seen.push(id); return true; };
  assert.deepEqual(await detectConformance(reader), none);
  assert.deepEqual(seen, [INTERFACE_ID_ERC165, '0xffffffff']);
});
test('invalid-ID revert does not stand in for a successful false reply', async () => {
  const { reader } = divergentToken();
  reader.supportsInterface = async id => {
    if (id === '0xffffffff') throw new ContractRevertError('invalid probe reverted');
    return true;
  };
  assert.deepEqual(await detectConformance(reader), none);
});
test('invalid-ID transport failure propagates rather than declaring nonconformance', async () => {
  const { reader } = divergentToken();
  const failure = new TransportError('eth_call', 'node unavailable');
  reader.supportsInterface = async id => { if (id === '0xffffffff') throw failure; return true; };
  await assert.rejects(detectConformance(reader), error => error === failure);
});
test('non-boolean first reply is a malformed transport response, not truthy support', async () => {
  const { reader } = divergentToken();
  reader.supportsInterface = async () => 'true' as unknown as boolean;
  await assert.rejects(detectConformance(reader), TransportError);
});
test('non-boolean invalid-ID reply is not accepted as false', async () => {
  const { reader } = divergentToken();
  reader.supportsInterface = async id => id === '0xffffffff' ? 0 as unknown as boolean : true;
  await assert.rejects(detectConformance(reader), TransportError);
});
test('first-probe revert stops discovery without querying the invalid ID', async () => {
  const { reader } = divergentToken();
  let calls = 0;
  reader.supportsInterface = async () => { calls++; throw new ContractRevertError('no ERC165'); };
  assert.deepEqual(await detectConformance(reader), none);
  assert.equal(calls, 1);
});
test('valid invalid-ID refusal preserves independent projection and settlement discovery', async () => {
  const { reader } = divergentToken();
  const supports = reader.supportsInterface.bind(reader);
  reader.supportsInterface = async id => {
    if (id === INTERFACE_ID_REGISTER_PROJECTION) throw new ContractRevertError('not offered');
    return supports(id);
  };
  assert.deepEqual(await detectConformance(reader), { erc165: true, projection: false, settlement: true });
});

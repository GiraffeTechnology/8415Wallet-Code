import assert from 'node:assert/strict';
import { test } from 'node:test';
import { divergentToken } from '../src/adapters/memory/scenarios.ts';
import { detectConformance } from '../src/sdk/conformance.ts';
import { ContractIdentityPin } from '../src/sdk/identity.ts';
import { IdentityChangedError } from '../src/sdk/errors.ts';
import { ZERO_BYTES32, type Bytes32 } from '../src/sdk/types.ts';
const invalid = [undefined, null, '', '0x1', '0x' + 'g'.repeat(64), ZERO_BYTES32, 7n];
for (const method of ['registerId', 'verificationProfile'] as const) {
  test(`malformed ${method} cannot establish the first pin`, async () => {
    for (const value of invalid) {
      const { reader } = divergentToken();
      reader[method] = async () => value as unknown as Bytes32;
      const pin = new ContractIdentityPin(reader);
      await assert.rejects(pin.read(await detectConformance(reader)), IdentityChangedError);
      assert.equal(pin.pinned, undefined);
    }
  });
  test(`malformed ${method} cannot replace an existing pin`, async () => {
    const { reader } = divergentToken();
    const pin = new ContractIdentityPin(reader);
    const conformance = await detectConformance(reader);
    const first = await pin.read(conformance);
    reader[method] = async () => undefined as unknown as Bytes32;
    await assert.rejects(pin.read(conformance), IdentityChangedError);
    assert.equal(pin.pinned, first);
    assert.ok(Object.isFrozen(first));
  });
}
test('valid nonzero register/profile fields remain unchanged in a frozen snapshot', async () => {
  const { reader } = divergentToken();
  const registerId = await reader.registerId();
  const profile = await reader.verificationProfile();
  const pin = new ContractIdentityPin(reader);
  const result = await pin.read(await detectConformance(reader));
  assert.equal(result.registerId, registerId);
  assert.equal(result.verificationProfile, profile);
  assert.ok(Object.isFrozen(result));
});

import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { MemoryErc8415Reader } from '../src/adapters/memory/memoryReader.ts';
import { MemoryRegisterContract } from '../src/adapters/memory/register.ts';
import {
  ALICE,
  DAVE,
  OPEN_GAP_ID,
  T,
  TOKEN,
  commitment,
  divergentToken,
  projectionOnlyToken,
} from '../src/adapters/memory/scenarios.ts';
import { detectConformance } from '../src/sdk/conformance.ts';
import { IdentityChangedError } from '../src/sdk/errors.ts';
import { ContractIdentityPin } from '../src/sdk/identity.ts';
import { ZERO_BYTES32 } from '../src/sdk/types.ts';

describe('contract identity', () => {
  test('is nonzero and carries the chain and address it came from', async () => {
    const { reader } = divergentToken();
    const identity = await new ContractIdentityPin(reader).read(await detectConformance(reader));

    assert.notEqual(identity.registerId, ZERO_BYTES32);
    assert.notEqual(identity.verificationProfile, ZERO_BYTES32);
    assert.equal(identity.chainId, reader.source.chainId);
    assert.equal(identity.address, reader.source.address);
  });

  test('is unchanged across admissions', async () => {
    const { contract, reader } = divergentToken();
    const pin = new ContractIdentityPin(reader);
    const conformance = await detectConformance(reader);
    const before = await pin.read(conformance);

    contract.finalizeSettlement(OPEN_GAP_ID, {
      recordCommitment: commitment('d'),
      registryReference: `0x${'fd'.repeat(32)}`,
      effectiveAt: T.asOf + 1n,
      proofData: '0x',
    });
    assert.equal(contract.currentEntry(TOKEN).holder, DAVE);

    assert.deepEqual(await pin.read(conformance), before);
  });

  test('omits the verification profile when there is no settlement interface', async () => {
    const { reader } = projectionOnlyToken();
    const identity = await new ContractIdentityPin(reader).read(await detectConformance(reader));

    assert.notEqual(identity.registerId, ZERO_BYTES32);
    assert.equal(identity.verificationProfile, undefined);
  });

  test('a changed registerId is rejected, not displayed', async () => {
    const { reader } = divergentToken();

    // A reader whose immutable identity drifts between reads. The ERC says
    // this cannot happen; if it does, the wallet is not talking to the
    // contract it pinned, and nothing it returns can be shown.
    let reads = 0;
    const drifting = {
      ...reader,
      source: reader.source,
      supportsInterface: (id: string) => reader.supportsInterface(id),
      verificationProfile: () => reader.verificationProfile(),
      registerId: async () => {
        reads += 1;
        return reads === 1 ? await reader.registerId() : `0x${'ab'.repeat(32)}`;
      },
    } as typeof reader;

    const pin = new ContractIdentityPin(drifting);
    const conformance = await detectConformance(drifting);
    await pin.read(conformance);

    await assert.rejects(() => pin.read(conformance), IdentityChangedError);
  });

  test('rejects a zero identifier', async () => {
    const contract = new MemoryRegisterContract({
      now: T.beforeFirstEntry,
      registerId: ZERO_BYTES32,
    });
    contract.mint(TOKEN, ALICE);
    const reader = new MemoryErc8415Reader(contract);
    const conformance = await detectConformance(reader);

    await assert.rejects(
      () => new ContractIdentityPin(reader).read(conformance),
      IdentityChangedError,
    );
  });
});

for (const field of ['chainId', 'address'] as const) for (const when of ['before-first-read','after-pin']) {
  test(`identity pin boundary: ${field} drift ${when} is refused`,async()=>{
    const {reader}=divergentToken(), pin=new ContractIdentityPin(reader), conformance=await detectConformance(reader);
    if(when==='after-pin')await pin.read(conformance);
    Object.assign(reader.source,field==='chainId'?{chainId:reader.source.chainId+1n}:{address:`0x${'9'.repeat(40)}`});
    await assert.rejects(()=>pin.read(conformance),IdentityChangedError);
  });
}
test('identity pin boundary: returned identity cannot rewrite the session pin',async()=>{
  const {reader}=divergentToken(), pin=new ContractIdentityPin(reader), conformance=await detectConformance(reader);
  const observed=await pin.read(conformance), original=observed.registerId;
  assert.equal(Reflect.set(observed,'registerId',`0x${'9'.repeat(64)}`),false);
  assert.equal(Reflect.set(pin.pinned!,'chainId',999n),false);
  assert.equal(pin.pinned?.registerId,original);
  assert.deepEqual(await pin.read(conformance),observed);
});
test('identity pin boundary: source drift during identity await cannot publish mixed evidence',async()=>{
  const {reader}=divergentToken(), original=reader.registerId.bind(reader);
  reader.registerId=async()=>{Object.assign(reader.source,{chainId:reader.source.chainId+1n});return original();};
  const pin=new ContractIdentityPin(reader),conformance=await detectConformance(reader);
  await assert.rejects(()=>pin.read(conformance),IdentityChangedError);
  assert.equal(pin.pinned,undefined);
});

for (const field of ['registerId', 'verificationProfile'] as const) {
  for (const bad of [undefined, null, '0x12']) {
    test(`identity pin malformed: ${field} ${String(bad)} rejects without pinning and permits retry`, async () => {
      const { reader } = divergentToken();
      const original = reader[field].bind(reader);
      let malformed = true;
      reader[field] = async () => malformed ? bad as never : original();
      const pin = new ContractIdentityPin(reader);
      const conformance = await detectConformance(reader);
      await assert.rejects(() => pin.read(conformance), IdentityChangedError);
      assert.equal(pin.pinned, undefined);
      malformed = false;
      assert.ok(await pin.read(conformance));
    });
  }
}

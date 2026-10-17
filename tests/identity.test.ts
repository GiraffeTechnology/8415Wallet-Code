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
import { delegateReader } from './support/delegateReader.ts';

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

describe('identity pins cannot be rewritten by consumers', () => {
  test('the first returned identity and getter expose a frozen primitive snapshot', async () => {
    const { reader } = divergentToken();
    const pin = new ContractIdentityPin(reader);
    const conformance = await detectConformance(reader);
    const first = await pin.read(conformance);
    const original = { ...first };
    assert.equal(pin.pinned, first);
    assert.equal(Object.isFrozen(first), true);
    for (const [field, replacement] of [
      ['chainId', 999n],
      ['address', ALICE],
      ['registerId', commitment('f')],
      ['verificationProfile', commitment('e')],
    ] as const) {
      assert.equal(Reflect.set(first, field, replacement), false);
    }
    assert.deepEqual(pin.pinned, original);
    assert.deepEqual(await pin.read(conformance), original);
  });

  test('the getter cannot be used to bless a changed register identifier', async () => {
    const { reader } = divergentToken();
    let registerId = await reader.registerId();
    const bound = delegateReader(reader, { registerId: async () => registerId });
    const pin = new ContractIdentityPin(bound);
    const conformance = await detectConformance(bound);
    const first = await pin.read(conformance);
    registerId = commitment('f');
    assert.equal(Reflect.set(pin.pinned!, 'registerId', registerId), false);
    await assert.rejects(pin.read(conformance), IdentityChangedError);
    assert.equal(pin.pinned, first);
  });

  test('a returned object cannot bless a changed verification profile', async () => {
    const { reader } = divergentToken();
    let profile = await reader.verificationProfile();
    const bound = delegateReader(reader, { verificationProfile: async () => profile });
    const pin = new ContractIdentityPin(bound);
    const conformance = await detectConformance(bound);
    const first = await pin.read(conformance);
    profile = commitment('e');
    assert.equal(Reflect.set(first, 'verificationProfile', profile), false);
    await assert.rejects(pin.read(conformance), IdentityChangedError);
    assert.equal(pin.pinned, first);
  });

  test('projection-only snapshots stay frozen with an absent profile', async () => {
    const { reader } = projectionOnlyToken();
    const pin = new ContractIdentityPin(reader);
    const conformance = await detectConformance(reader);
    const first = await pin.read(conformance);
    assert.equal(first.verificationProfile, undefined);
    assert.equal(Object.isFrozen(first), true);
    assert.equal(Reflect.set(first, 'verificationProfile', commitment('e')), false);
    assert.deepEqual(await pin.read(conformance), first);
  });
});

describe('identity pins remain bound to their reader source', () => {
  for (const field of ['chainId', 'address'] as const) {
    for (const phase of ['before first read', 'after pinning'] as const) {
      test(`rejects changed ${field} ${phase} even with identical register facts`, async () => {
        const { reader } = divergentToken();
        const source = { ...reader.source };
        let identityReads = 0;
        const bound = delegateReader(reader, {
          source,
          registerId: async () => { identityReads += 1; return reader.registerId(); },
        });
        const pin = new ContractIdentityPin(bound);
        const conformance = await detectConformance(bound);
        if (phase === 'after pinning') await pin.read(conformance);
        const originalPin = pin.pinned;
        const priorReads = identityReads;
        if (field === 'chainId') source.chainId += 1n;
        else source.address = ALICE;
        await assert.rejects(pin.read(conformance), (error: unknown) => {
          assert.ok(error instanceof IdentityChangedError);
          assert.match(error.message, new RegExp(field + ' changed'));
          return true;
        });
        assert.equal(identityReads, priorReads, 'refuse before new identity reads');
        assert.equal(pin.pinned, originalPin);
      });
    }
  }

  for (const method of ['registerId', 'verificationProfile'] as const) {
    test(`a source change during awaited ${method} cannot establish a pin`, async () => {
      const { reader } = divergentToken();
      const source = { ...reader.source };
      const changeSource = async () => {
        const value = await reader[method]();
        source.chainId += 1n;
        return value;
      };
      const bound = delegateReader(reader, {
        source,
        ...(method === 'registerId'
          ? { registerId: changeSource }
          : { verificationProfile: changeSource }),
      });
      const pin = new ContractIdentityPin(bound);
      const conformance = await detectConformance(bound);
      await assert.rejects(pin.read(conformance), IdentityChangedError);
      assert.equal(pin.pinned, undefined);
    });
  }

  test('address case alone remains compatible and the captured label is stable', async () => {
    const { reader } = divergentToken();
    const source = { ...reader.source };
    const bound = delegateReader(reader, { source });
    const pin = new ContractIdentityPin(bound);
    const conformance = await detectConformance(bound);
    const first = await pin.read(conformance);
    source.address = '0x' + source.address.slice(2).toUpperCase();
    const next = await pin.read(conformance);
    assert.deepEqual(next, first);
    assert.equal(next.address, first.address);
    assert.equal(Object.isFrozen(next), true);
  });
});

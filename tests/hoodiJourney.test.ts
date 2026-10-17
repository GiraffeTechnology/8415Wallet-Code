import assert from 'node:assert/strict';
import { test } from 'node:test';
import { ALICE, CAROL, DAVE, T, TOKEN, divergentToken } from '../src/adapters/memory/scenarios.ts';
import { delegateReader } from './support/delegateReader.ts';
import { captureHoodiRelease, compareHoodiReleaseHistory, renderHoodiReleaseHistory,
  serialiseHoodiJourney, HOODI_JOURNEY_GENESIS,
  type JourneyManifest, type ReleaseObservation, type PinnedJourneyRead,
} from '../src/wallet/hoodiJourney.ts';

const h = (letter: string) => '0x' + letter.repeat(64);
async function fixture() {
  const { reader } = divergentToken();
  const manifest: JourneyManifest = {
    chainId: 560048n, genesisHash: HOODI_JOURNEY_GENESIS,
    contract: reader.source.address, tokenId: TOKEN,
    registerId: await reader.registerId(), verificationProfile: await reader.verificationProfile(),
    wallets: [
      { tenant: 'xiongan', account: ALICE }, { tenant: 'giraffe', account: CAROL },
      { tenant: 'lala', account: DAVE },
    ],
  };
  const v2 = await reader.entryAt(TOKEN, 2n);
  const release: ReleaseObservation = {
    legId: h('1'), controlId: h('2'), buyerTenant: 'giraffe',
    buyerOccurrence: 1n, ownerOccurrence: 2n, holderOccurrence: 1n,
    owner: DAVE, holder: CAROL, termsDigest: h('3'), acceptedConditions: [h('4')],
    release: { blockNumber: 20n, blockHash: h('5'), transactionHash: h('6'), recordedAt: T.asOf },
    tokenResult: { owner: DAVE, transactionHash: h('6') },
    v2: {
      entry: { ...v2, supersededAt: 0n },
      admission: { blockNumber: 10n, blockHash: h('7'), transactionHash: h('8'), recordedAt: T.v2 },
    },
  };
  const v3 = {
    entry: await reader.entryAt(TOKEN, 3n),
    admission: { blockNumber: 30n, blockHash: h('9'), transactionHash: h('a'),
      recordedAt: T.asOf + 100n },
  };
  const anchor: PinnedJourneyRead = {
    reader: delegateReader(reader, {
      source: { chainId: 560048n, address: reader.source.address },
      chainInstant: async () => T.asOf + 200n,
    }),
    blockNumber: 40n, blockHash: h('b'), recordedAt: T.asOf + 200n,
    genesisHash: HOODI_JOURNEY_GENESIS, readBlockHash: async () => h('b'),
  };
  return { manifest, release, v3, anchor };
}

test('then-known v2 stays separate from current v3 historical interpretation', async () => {
  const f = await fixture();
  const original = captureHoodiRelease(f.manifest, f.release);
  const before = serialiseHoodiJourney(original);
  const result = await compareHoodiReleaseHistory(original, f.v3, f.anchor);
  assert.equal(result.original.observation.v2.entry.version, 2n);
  assert.equal(result.current.resolution.kind, 'resolved');
  assert.equal(result.query.instant, f.release.release.recordedAt);
  assert.equal(result.laterV3.entry.version, 3n);
  assert.equal(result.canExecute, false);
  assert.equal(serialiseHoodiJourney(original), before);
  assert.match(renderHoodiReleaseHistory(result), /Then-known v2 commitment/);
  assert.match(renderHoodiReleaseHistory(result), /actually admitted at/);
});

test('captured release evidence does not retain mutable input aliases', async () => {
  const f = await fixture();
  const original = captureHoodiRelease(f.manifest, f.release);
  assert.equal(Object.isFrozen(original.observation.v2.entry), true);
  assert.equal(Object.isFrozen(original.manifest.wallets), true);
  assert.equal(Reflect.set(original.observation.release, 'recordedAt', 0n), false);
  assert.equal(Reflect.set(original.observation.acceptedConditions, '0', h('f')), false);
});

test('missing or repeated wallet bindings are refused without guessed replacements', async () => {
  const f = await fixture();
  assert.throws(() => captureHoodiRelease(
    { ...f.manifest, wallets: f.manifest.wallets.slice(0, 2) }, f.release,
  ), /THREE_WALLETS_REQUIRED/);
  assert.throws(() => captureHoodiRelease({ ...f.manifest, wallets: [
    { tenant: 'xiongan', account: ALICE }, { tenant: 'giraffe', account: ALICE },
    { tenant: 'lala', account: DAVE },
  ] }, f.release), /WALLET_BINDING_INVALID/);
});

test('a non-Hoodi manifest cannot be substituted', async () => {
  const f = await fixture();
  assert.throws(() => captureHoodiRelease({ ...f.manifest, chainId: 1n }, f.release),
    /HOODI_BINDING_REQUIRED/);
});

test('owner-only progress and mismatched actual token result are refused', async () => {
  const f = await fixture();
  assert.throws(() => captureHoodiRelease(f.manifest, { ...f.release, holderOccurrence: 0n }),
    /DUAL_OCCURRENCE_REQUIRED/);
  assert.throws(() => captureHoodiRelease(f.manifest, { ...f.release,
    tokenResult: { owner: ALICE, transactionHash: h('6') } }), /RELEASE_RESULT_MISMATCH/);
});

test('v2 not admitted by the release time cannot become original evidence', async () => {
  const f = await fixture();
  assert.throws(() => captureHoodiRelease(f.manifest, { ...f.release,
    v2: { ...f.release.v2, admission: { ...f.release.v2.admission, recordedAt: T.asOf + 1n } },
  }), /V2_NOT_KNOWN_AT_RELEASE/);
});

test('v3 effective after release or admitted before release cannot satisfy this scenario', async () => {
  const f = await fixture();
  const original = captureHoodiRelease(f.manifest, f.release);
  await assert.rejects(compareHoodiReleaseHistory(original,
    { ...f.v3, entry: { ...f.v3.entry, effectiveAt: T.asOf + 1n } }, f.anchor),
    /LATE_V3_CONDITIONS_REQUIRED/);
  await assert.rejects(compareHoodiReleaseHistory(original,
    { ...f.v3, admission: { ...f.v3.admission, recordedAt: T.asOf } }, f.anchor),
    /LATE_V3_CONDITIONS_REQUIRED/);
});

test('wrong predecessor commitment refuses a different register chain', async () => {
  const f = await fixture();
  await assert.rejects(compareHoodiReleaseHistory(captureHoodiRelease(f.manifest, f.release),
    { ...f.v3, entry: { ...f.v3.entry, previousCommitment: h('f') } }, f.anchor),
    /LATE_V3_CONDITIONS_REQUIRED/);
});

test('a changed block hash at the final reread refuses the report', async () => {
  const f = await fixture();
  let calls = 0;
  await assert.rejects(compareHoodiReleaseHistory(captureHoodiRelease(f.manifest, f.release),
    f.v3, { ...f.anchor, readBlockHash: async () => ++calls === 1 ? h('b') : h('c') }),
    /QUERY_BLOCK_CHANGED/);
  assert.equal(calls, 2);
});

test('an unavailable historical query propagates without rewriting the original', async () => {
  const f = await fixture();
  const original = captureHoodiRelease(f.manifest, f.release);
  const before = serialiseHoodiJourney(original);
  const failure = new Error('offline pinned reader');
  await assert.rejects(compareHoodiReleaseHistory(original, f.v3, { ...f.anchor,
    reader: delegateReader(f.anchor.reader, {
      entryAsOf: async () => { throw failure; },
    }),
  }), (error: unknown) => error === failure);
  assert.equal(serialiseHoodiJourney(original), before);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { divergentToken, TOKEN, commitment } from '../src/adapters/memory/scenarios.ts';
import { detectCollisions, COLLISION_SCAN_MAX_ENTRIES, COLLISION_SCAN_MAX_TOKENS } from '../src/wallet/collisions.ts';
import { NonConformantContractError, IdentityChangedError, ProjectionNotInitialized } from '../src/sdk/errors.ts';
import { WalletSession } from '../src/wallet/session.ts';

test('duplicate input is refused before reading rather than inventing repeated entries', async () => {
  const { reader } = divergentToken();
  let calls = 0;
  reader.supportsInterface = async () => { calls++; return true; };
  await assert.rejects(detectCollisions(reader, [TOKEN, TOKEN]), /COLLISION_DUPLICATE_TOKEN_REFUSED/);
  assert.equal(calls, 0);
});

test('empty, excessive, negative and overflowing token inputs are refused before RPC', async () => {
  const { reader } = divergentToken();
  reader.supportsInterface = async () => { throw new Error('must not read'); };
  for (const ids of [[], Array.from({ length: 33 }, (_, i) => BigInt(i)), [-1n], [1n << 256n]]) {
    await assert.rejects(detectCollisions(reader, ids), /COLLISION_TOKEN_/);
  }
});

test('projection conformance is established before entry reads', async () => {
  const { reader } = divergentToken();
  reader.supportsInterface = async () => false;
  reader.entryCount = async () => { throw new Error('must not read projection'); };
  await assert.rejects(detectCollisions(reader, [TOKEN]), NonConformantContractError);
});

test('entry budget fails before a large token is walked', async () => {
  const { reader } = divergentToken();
  reader.entryCount = async () => BigInt(COLLISION_SCAN_MAX_ENTRIES + 1);
  reader.entryAt = async () => { throw new Error('must not walk entries'); };
  await assert.rejects(detectCollisions(reader, [TOKEN]), /COLLISION_ENTRY_BUDGET_REFUSED/);
});

test('total entry budget spans tokens and never returns an earlier partial report', async () => {
  const { reader } = divergentToken();
  const sample = await reader.entryAt(TOKEN, 1n);
  let reads = 0;
  reader.entryCount = async () => BigInt(COLLISION_SCAN_MAX_ENTRIES);
  reader.entryAt = async () => { reads++; return sample; };
  await assert.rejects(detectCollisions(reader, [1n, 2n]), /COLLISION_ENTRY_BUDGET_REFUSED/);
  assert.equal(reads, COLLISION_SCAN_MAX_ENTRIES);
});

test('uninitialized and invalid counts are not empty successful scans', async () => {
  const { reader } = divergentToken();
  reader.entryCount = async () => 0n;
  await assert.rejects(detectCollisions(reader, [TOKEN]), ProjectionNotInitialized);
  for (const count of [-1n, 1n << 64n]) {
    reader.entryCount = async () => count;
    await assert.rejects(detectCollisions(reader, [TOKEN]), /COLLISION_ENTRY_COUNT_REFUSED/);
  }
});

test('entry read failure propagates instead of returning no collisions', async () => {
  const { reader } = divergentToken();
  const failure = new Error('unavailable');
  reader.entryAt = async () => { throw failure; };
  await assert.rejects(detectCollisions(reader, [TOKEN]), error => error === failure);
});

test('the token set is copied before the first asynchronous read', async () => {
  const { reader } = divergentToken();
  const ids = [TOKEN];
  const original = reader.supportsInterface.bind(reader);
  reader.supportsInterface = async id => { ids[0] = 999n; return original(id); };
  const report = await detectCollisions(reader, ids);
  assert.deepEqual(report.tokensExamined, [TOKEN]);
  assert.equal(report.entriesExamined, 3);
  assert.match(report.scopeNote, /not an atomic snapshot/);
});

test('identity drift during a scan is rejected before a report is returned', async () => {
  const { reader } = divergentToken();
  let reads = 0;
  reader.registerId = async () => commitment(++reads === 1 ? 'a' : 'b');
  await assert.rejects(detectCollisions(reader, [TOKEN]), IdentityChangedError);
});

test('session collision reads share the identity established by earlier views', async () => {
  const { reader } = divergentToken();
  const wallet = new WalletSession(reader);
  await wallet.assetView(TOKEN);
  reader.registerId = async () => commitment('e');
  await assert.rejects(wallet.collisions([TOKEN]), IdentityChangedError);
});

test('a refused scan budget states the limit it refused at', async () => {
  // The code already named which budget; the number it enforced was only in
  // the source, so a caller could not see how much smaller to ask.
  const { reader } = divergentToken();
  const tooMany = Array.from({ length: COLLISION_SCAN_MAX_TOKENS + 1 }, (_, index) => BigInt(index + 1));
  await assert.rejects(detectCollisions(reader, tooMany), (error: any) => {
    assert.equal(error.code, 'COLLISION_TOKEN_BUDGET_REFUSED');
    assert.equal(error.limit, COLLISION_SCAN_MAX_TOKENS);
    assert.match(error.message, new RegExp(`limit ${COLLISION_SCAN_MAX_TOKENS}`));
    return true;
  });
  const { reader: wide } = divergentToken();
  wide.entryCount = async () => BigInt(COLLISION_SCAN_MAX_ENTRIES + 1);
  await assert.rejects(detectCollisions(wide, [TOKEN]), (error: any) => {
    assert.equal(error.code, 'COLLISION_ENTRY_BUDGET_REFUSED');
    assert.equal(error.limit, COLLISION_SCAN_MAX_ENTRIES);
    return true;
  });
});

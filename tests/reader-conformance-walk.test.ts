import assert from 'node:assert/strict';
import { test } from 'node:test';
import { divergentToken, T, TOKEN } from '../src/adapters/memory/scenarios.ts';
import { checkReaderConformance } from '../src/sdk/readerConformance.ts';
import { delegateReader } from './support/delegateReader.ts';

const probe = { tokenId: TOKEN, coveredInstant: T.finalInstant,
  instantBeforeFirstEntry: T.beforeFirstEntry };
const upper = (value: string) => '0x' + value.slice(2).toUpperCase();

test('a complete conforming walk has no findings', async () => {
  const report = await checkReaderConformance(divergentToken().reader, probe);
  assert.deepEqual(report.findings, []);
  assert.equal(report.conforms, true);
});

for (const count of [-1n, 1n << 64n, 1 as unknown as bigint]) {
  test(`refuses an invalid count before walking (${String(count)} / ${typeof count})`, async () => {
    const { reader } = divergentToken();
    const report = await checkReaderConformance(delegateReader(reader, {
      entryCount: async () => count,
      entryAt: async () => { throw new Error('ENTRY_WALK_MUST_NOT_START'); },
    }), probe);
    assert.equal(report.conforms, false);
    assert.ok(report.findings.some(({ check }) => check === 'entryCount'));
  });
}

test('finds a middle entry returned for the wrong requested version', async () => {
  const { reader } = divergentToken();
  const report = await checkReaderConformance(delegateReader(reader, {
    entryAt: async (token, version) => {
      const entry = await reader.entryAt(token, version);
      return version === 2n ? { ...entry, version: 1n } : entry;
    },
  }), probe);
  assert.ok(report.findings.some(({ check }) => check === 'entryAt.version'));
  assert.equal(report.conforms, false);
});

test('finds a broken previous-commitment link', async () => {
  const { reader } = divergentToken();
  const report = await checkReaderConformance(delegateReader(reader, {
    entryAt: async (token, version) => {
      const entry = await reader.entryAt(token, version);
      return version === 2n ? { ...entry, previousCommitment: `0x${'ef'.repeat(32)}` } : entry;
    },
  }), probe);
  assert.ok(report.findings.some(({ check }) => check === 'previousCommitment'));
});

test('finds an interval that does not close at the successor', async () => {
  const { reader } = divergentToken();
  const report = await checkReaderConformance(delegateReader(reader, {
    entryAt: async (token, version) => {
      const entry = await reader.entryAt(token, version);
      return version === 2n ? { ...entry, supersededAt: entry.supersededAt + 1n } : entry;
    },
  }), probe);
  assert.ok(report.findings.some(({ check }) => check === 'supersededAt'));
});

test('finds a repeated registry reference even when its hex case changes', async () => {
  const { reader } = divergentToken();
  const first = await reader.entryAt(TOKEN, 1n);
  const report = await checkReaderConformance(delegateReader(reader, {
    entryAt: async (token, version) => {
      const entry = await reader.entryAt(token, version);
      return version === 2n ? { ...entry, registryReference: upper(first.registryReference) } : entry;
    },
  }), probe);
  assert.ok(report.findings.some(({ check }) => check === 'registryReference'));
});

test('finds a current summary differing from the complete last entry', async () => {
  const { reader } = divergentToken();
  const report = await checkReaderConformance(delegateReader(reader, {
    currentEntry: async (token) => ({ ...await reader.currentEntry(token),
      recordCommitment: `0x${'ef'.repeat(32)}` }),
  }), probe);
  assert.ok(report.findings.some(({ check }) => check === 'currentEntry'));
});

test('finds a closed last entry even if currentEntry claims an open interval', async () => {
  const { reader } = divergentToken();
  const count = await reader.entryCount(TOKEN);
  const report = await checkReaderConformance(delegateReader(reader, {
    entryAt: async (token, version) => {
      const entry = await reader.entryAt(token, version);
      return version === count ? { ...entry, supersededAt: T.v3 + 1n } : entry;
    },
  }), probe);
  assert.ok(report.findings.some(({ check }) => check === 'entryAt(last).supersededAt'));
});

test('equivalent byte casing does not create a broken predecessor link', async () => {
  const { reader } = divergentToken();
  const report = await checkReaderConformance(delegateReader(reader, {
    entryAt: async (token, version) => {
      const entry = await reader.entryAt(token, version);
      return { ...entry, previousCommitment: upper(entry.previousCommitment) };
    },
  }), probe);
  assert.deepEqual(report.findings, []);
});

test('finds a repeated commitment despite changed hex casing', async () => {
  const { reader } = divergentToken();
  const first = await reader.entryAt(TOKEN, 1n);
  const report = await checkReaderConformance(delegateReader(reader, {
    entryAt: async (token, version) => {
      const entry = await reader.entryAt(token, version);
      return version === 2n ? { ...entry, recordCommitment: upper(first.recordCommitment) } : entry;
    },
  }), probe);
  assert.ok(report.findings.some(({ check }) => check === 'recordCommitment'));
});

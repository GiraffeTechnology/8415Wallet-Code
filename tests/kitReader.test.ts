import assert from 'node:assert/strict';
import { describe, test } from 'node:test';

import { KitProjectionApi, KitTransportError } from '../src/adapters/kit/kitApi.ts';
import { KitErc8415Reader } from '../src/adapters/kit/kitReader.ts';
import { divergentToken, OPEN_GAP_ID, T, TOKEN } from '../src/adapters/memory/scenarios.ts';
import {
  BackendDisagreementError,
  ContractRevertError,
  InvariantViolationError,
} from '../src/sdk/errors.ts';
import type { Erc8415Reader } from '../src/sdk/port.ts';
import { checkReaderConformance, type ConformanceProbe } from '../src/sdk/readerConformance.ts';
import { ZERO_BYTES32 } from '../src/sdk/types.ts';
import { delegateReader } from './support/delegateReader.ts';
import { fakeKitFetch, type FakeKitOptions } from './support/fakeKit.ts';

const PROBE: ConformanceProbe = {
  tokenId: TOKEN,
  coveredInstant: T.finalInstant,
  instantBeforeFirstEntry: T.beforeFirstEntry,
};

const BASE_URL = 'http://localhost:8415';

/**
 * A Kit-backed reader over the same contract the rest of the suite reads, with
 * that contract's own reader standing in for the chain half.
 *
 * This is the shape a deployment actually takes: the projection reads come
 * from the indexer, the position, the clock and conformance stay on chain.
 */
function kitReader(
  chain: Erc8415Reader,
  options: FakeKitOptions = {},
): KitErc8415Reader {
  const api = new KitProjectionApi({ baseUrl: BASE_URL, fetch: fakeKitFetch(chain, options) });
  return new KitErc8415Reader(api, chain, chain.source, { chainIdentity: chain });
}

describe('the Kit adapter is held to the same port as the chain adapter', () => {
  test('it conforms, over the Kit wire format', async () => {
    const { reader } = divergentToken();
    const report = await checkReaderConformance(kitReader(reader), PROBE);
    assert.deepEqual(report.findings, []);
    assert.equal(report.conforms, true);
  });

  test('it answers the projection identically to the chain', async () => {
    const { reader } = divergentToken();
    const kit = kitReader(reader);

    assert.deepEqual(await kit.currentEntry(TOKEN), await reader.currentEntry(TOKEN));
    assert.deepEqual(await kit.entryAt(TOKEN, 2n), await reader.entryAt(TOKEN, 2n));
    assert.deepEqual(await kit.entryAsOf(TOKEN, T.asOf), await reader.entryAsOf(TOKEN, T.asOf));
    assert.equal(await kit.holderAsOf(TOKEN, T.asOf), await reader.holderAsOf(TOKEN, T.asOf));
    assert.equal(await kit.isFinalAsOf(TOKEN, T.asOf), await reader.isFinalAsOf(TOKEN, T.asOf));
    assert.equal(await kit.entryCount(TOKEN), await reader.entryCount(TOKEN));
    assert.equal(await kit.registerId(), await reader.registerId());
    assert.equal(await kit.openGapOf(TOKEN), OPEN_GAP_ID);
  });

  test('the position still comes from the chain, never from the index', async () => {
    const { reader } = divergentToken();
    const kit = kitReader(reader);

    // The scenario's whole point: these two disagree, and must keep
    // disagreeing. An indexer that served both would be asserting the
    // identity ERC-8415 exists to deny.
    const position = await kit.ownerOf(TOKEN);
    const confirmed = (await kit.currentEntry(TOKEN)).holder;
    assert.notEqual(position, confirmed);
    assert.equal(position, await reader.ownerOf(TOKEN));
  });
});

describe('a backend that cannot answer is never read as an answer', () => {
  test('an unreachable Kit is a transport failure, not a claim about the register', async () => {
    const { reader } = divergentToken();
    const kit = kitReader(reader, { failWith: { status: 503, error: 'UNAVAILABLE' } });

    await assert.rejects(() => kit.holderAsOf(TOKEN, T.asOf), (error: unknown) => {
      assert.ok(error instanceof KitTransportError);
      assert.equal(error.status, 503);
      // Emphatically not a revert: a revert would be reported as the
      // projection declining to answer, which it did not do.
      assert.ok(!(error instanceof ContractRevertError));
      return true;
    });
  });

  test('an unauthenticated Kit is a transport failure too', async () => {
    const { reader } = divergentToken();
    const kit = kitReader(reader, { failWith: { status: 401, error: 'UNAUTHENTICATED' } });
    await assert.rejects(() => kit.entryCount(TOKEN), KitTransportError);
  });

  test('an instant the projection does not cover is a revert, as on chain', async () => {
    const { reader } = divergentToken();
    const kit = kitReader(reader);
    await assert.rejects(() => kit.entryAsOf(TOKEN, T.beforeFirstEntry), ContractRevertError);
    await assert.rejects(() => kit.holderAsOf(TOKEN, T.beforeFirstEntry), ContractRevertError);
    // And the one call that must not revert for it, does not.
    assert.equal(await kit.isFinalAsOf(TOKEN, T.beforeFirstEntry), false);
  });
});

describe('the two backends are checked against each other', () => {
  test('an index pointed at another register is refused, not preferred', async () => {
    const { reader } = divergentToken();
    const kit = kitReader(reader, { registerId: `0x${'9'.repeat(64)}` });
    await assert.rejects(() => kit.entryCount(TOKEN), BackendDisagreementError);
  });

  test('a mismatched verification profile is refused as well', async () => {
    const { reader } = divergentToken();
    const kit = kitReader(reader, { verificationProfile: `0x${'7'.repeat(64)}` });
    await assert.rejects(() => kit.registerId(), BackendDisagreementError);
  });

  test('the check can be declined, and then nothing cross-checks it', async () => {
    const { reader } = divergentToken();
    const api = new KitProjectionApi({
      baseUrl: BASE_URL,
      fetch: fakeKitFetch(reader, { registerId: `0x${'9'.repeat(64)}` }),
    });
    const kit = new KitErc8415Reader(api, reader, reader.source, { crossCheckIdentity: false });
    assert.equal(await kit.registerId(), `0x${'9'.repeat(64)}`);
  });
});

describe('the derived reads are checked rather than assumed', () => {
  test('currentEntry refuses an entry whose interval is already closed', async () => {
    const { reader } = divergentToken();
    // An index one entry behind the register: `entryAt(2)` answers, and the
    // answer is a superseded entry. Labelling it "current" would report a
    // holder the register has already moved past.
    const lagging = delegateReader(reader, { entryCount: async () => 2n });
    const kit = new KitErc8415Reader(
      new KitProjectionApi({ baseUrl: BASE_URL, fetch: fakeKitFetch(lagging) }),
      reader,
      reader.source,
      { crossCheckIdentity: false },
    );
    await assert.rejects(() => kit.currentEntry(TOKEN), InvariantViolationError);
  });

  test('currentEntry refuses a version that does not match the count', async () => {
    const { reader } = divergentToken();
    const honest = fakeKitFetch(reader);
    // The count says three entries; the version route serves the second. The
    // two reads disagree, so neither can be trusted to be the latest.
    const inconsistent: typeof honest = async (url, init) =>
      url.endsWith('/entry/version/3') ? honest(`${BASE_URL}/projection/${TOKEN}/entry/version/2`, init) : honest(url, init);
    const kit = new KitErc8415Reader(
      new KitProjectionApi({ baseUrl: BASE_URL, fetch: inconsistent }),
      reader,
      reader.source,
      { crossCheckIdentity: false },
    );
    await assert.rejects(() => kit.currentEntry(TOKEN), InvariantViolationError);
  });
});

describe('integers survive the wire', () => {
  test('an instant beyond a double is carried exactly', async () => {
    // 2^53 + 1 is the first instant a JSON number cannot hold. An entry that
    // takes effect far enough in the future blocks every later entry whose
    // effective time is not greater than it, which is exactly the value worth
    // reporting accurately.
    const beyondDouble = (1n << 53n) + 1n;
    const fetchOne = async () => ({
      status: 200,
      json: async () => ({
        entry: {
          version: '1',
          holder: `0x${'a'.repeat(40)}`,
          effectiveAt: beyondDouble.toString(),
          supersededAt: '0',
          recordCommitment: `0x${'1'.repeat(64)}`,
          previousCommitment: ZERO_BYTES32,
          registryReference: `0x${'2'.repeat(64)}`,
        },
      }),
    });
    const api = new KitProjectionApi({ baseUrl: BASE_URL, fetch: fetchOne });
    const entry = await api.entryAt(TOKEN, 1n);
    assert.equal(entry.effectiveAt, beyondDouble);
    assert.notEqual(entry.effectiveAt, BigInt(Number(beyondDouble)));
  });

  test('an integer that is not a decimal string is refused', async () => {
    const fetchOne = async () => ({
      status: 200,
      json: async () => ({ entry: { version: 1, holder: `0x${'a'.repeat(40)}` } }),
    });
    const api = new KitProjectionApi({ baseUrl: BASE_URL, fetch: fetchOne });
    await assert.rejects(() => api.entryAt(TOKEN, 1n), KitTransportError);
  });
});

describe('the base URL is refused before a key can leak', () => {
  test('plain http to a remote host is refused', () => {
    assert.throws(
      () => new KitProjectionApi({ baseUrl: 'http://kit.example.com', apiKey: 'secret' }),
      KitTransportError,
    );
  });

  test('embedded credentials are refused', () => {
    assert.throws(
      () => new KitProjectionApi({ baseUrl: 'https://user:pass@kit.example.com' }),
      KitTransportError,
    );
  });
});

type ReaderGateIdentity = {
  registerId(): Promise<string>;
  verificationProfile?(): Promise<string>;
};

function readerGateDeferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

async function readerGateWithin<T>(promise: Promise<T>): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([promise, new Promise<never>((_yes, no) => {
      timer = setTimeout(() => no(new Error('READER_GATE_TEST_TIMEOUT')), 1500);
    })]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

function readerGateOutcome<T>(promise: Promise<T>) {
  return promise.then(value => ({ kind: 'fulfilled' as const, value }),
    error => ({ kind: 'rejected' as const, error }));
}

function readerGateIdentity(reader: Erc8415Reader): ReaderGateIdentity {
  return { registerId: () => reader.registerId(),
    verificationProfile: () => reader.verificationProfile!() };
}

function readerGateMake(reader: Erc8415Reader, identity: ReaderGateIdentity,
  fetch = fakeKitFetch(reader), crossCheckIdentity = true) {
  return new KitErc8415Reader(new KitProjectionApi({ baseUrl: BASE_URL, fetch }),
    reader, reader.source, { chainIdentity: identity, crossCheckIdentity });
}

const readerGateDirect: readonly [string, (kit: KitErc8415Reader) => Promise<unknown>][] = [
  ['entryAt', kit => kit.entryAt(TOKEN, 1n)],
  ['entryAsOf', kit => kit.entryAsOf(TOKEN, T.asOf)],
  ['holderAsOf', kit => kit.holderAsOf(TOKEN, T.asOf)],
  ['isFinalAsOf', kit => kit.isFinalAsOf(TOKEN, T.asOf)],
];

describe('Reader-IDENTITY-01 failure recovery and current summary binding', () => {
  for (const field of ['registerId', 'verificationProfile'] as const) {
    test(`repeated ${field} disagreement never becomes cached success`, async () => {
      const { reader } = divergentToken();
      const fetch = fakeKitFetch(reader, { [field]: `0x${(field === 'registerId' ? '9' : '7').repeat(64)}` });
      const kit = readerGateMake(reader, readerGateIdentity(reader), fetch);
      await assert.rejects(kit.entryCount(TOKEN), BackendDisagreementError);
      await assert.rejects(kit.entryCount(TOKEN), BackendDisagreementError);
      await assert.rejects(kit.registerId(), BackendDisagreementError);
    });

    test(`failed chain ${field} read is not latched and can recover`, async () => {
      const { reader } = divergentToken();
      const failure = new Error(`synthetic chain ${field} unavailable`);
      const good = readerGateIdentity(reader);
      let registerCalls = 0;
      let profileCalls = 0;
      const kit = readerGateMake(reader, {
        registerId: async () => {
          registerCalls++;
          if (field === 'registerId' && registerCalls === 1) throw failure;
          return good.registerId();
        },
        verificationProfile: async () => {
          profileCalls++;
          if (field === 'verificationProfile' && profileCalls === 1) throw failure;
          return good.verificationProfile!();
        },
      });
      await assert.rejects(kit.entryCount(TOKEN), error => error === failure);
      assert.equal(await kit.entryCount(TOKEN), await reader.entryCount(TOKEN));
      assert.equal(registerCalls, 2);
      assert.equal(profileCalls, field === 'registerId' ? 1 : 2);
      await kit.entryCount(TOKEN);
      assert.equal(registerCalls, 2, 'successful chain facts are reused');
    });

    test(`a later changed index ${field} is checked against cached chain facts`, async () => {
      const { reader } = divergentToken();
      const honest = fakeKitFetch(reader);
      const wrong = fakeKitFetch(reader, { [field]: `0x${(field === 'registerId' ? '9' : '7').repeat(64)}` });
      let changed = false;
      const fetch: ReturnType<typeof fakeKitFetch> = (url, init) =>
        (changed ? wrong : honest)(url, init);
      const kit = readerGateMake(reader, readerGateIdentity(reader), fetch);
      await kit.entryCount(TOKEN);
      changed = true;
      await assert.rejects(kit.entryCount(TOKEN), BackendDisagreementError);
      changed = false;
      assert.equal(await kit.entryCount(TOKEN), await reader.entryCount(TOKEN));
    });
  }
});

describe('Reader-IDENTITY-01 deferred concurrent first reads', () => {
  for (const failureMode of [false, true]) {
    test(`concurrent readers wait for one chain pair; failure=${failureMode}`, { timeout: 6000 }, async () => {
      const { reader } = divergentToken();
      const reachedChain = readerGateDeferred<void>();
      const releaseProfile = readerGateDeferred<string>();
      const reachedSecondSummary = readerGateDeferred<void>();
      const good = readerGateIdentity(reader);
      const failure = new Error('synthetic deferred profile failure');
      let registerCalls = 0;
      let profileCalls = 0;
      let summaries = 0;
      let secondSettled = false;
      const honest = fakeKitFetch(reader);
      const fetch: ReturnType<typeof fakeKitFetch> = async (url, init) => {
        const result = await honest(url, init);
        if (/\/projection\/\d+$/.test(new URL(url).pathname) && ++summaries === 2) {
          reachedSecondSummary.resolve();
        }
        return result;
      };
      const kit = readerGateMake(reader, {
        registerId: async () => { registerCalls++; return good.registerId(); },
        verificationProfile: async () => {
          profileCalls++;
          reachedChain.resolve();
          return releaseProfile.promise;
        },
      }, fetch);
      const first = readerGateOutcome(kit.entryCount(TOKEN));
      let second: ReturnType<typeof readerGateOutcome> | undefined;
      try {
        await readerGateWithin(reachedChain.promise);
        second = readerGateOutcome(kit.entryCount(TOKEN));
        void second.then(() => { secondSettled = true; });
        await readerGateWithin(reachedSecondSummary.promise);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
        assert.equal(secondSettled, false, 'no result may escape a pending identity check');
        if (failureMode) releaseProfile.reject(failure);
        else releaseProfile.resolve(await good.verificationProfile!());
        const results = await readerGateWithin(Promise.all([first, second]));
        for (const result of results) {
          if (failureMode) {
            assert.equal(result.kind, 'rejected');
            if (result.kind === 'rejected') assert.equal(result.error, failure);
          } else {
            assert.equal(result.kind, 'fulfilled');
            if (result.kind === 'fulfilled') assert.equal(result.value, await reader.entryCount(TOKEN));
          }
        }
        assert.equal(registerCalls, 1);
        assert.equal(profileCalls, 1);
      } finally {
        releaseProfile.resolve(await good.verificationProfile!());
        await readerGateWithin(Promise.all([first, ...(second === undefined ? [] : [second])]));
      }
    });
  }

  test('different summaries waiting on one chain pair are compared independently', { timeout: 6000 }, async () => {
    const { reader } = divergentToken();
    const reached = readerGateDeferred<void>();
    const release = readerGateDeferred<string>();
    const good = readerGateIdentity(reader);
    const honest = fakeKitFetch(reader);
    const wrong = fakeKitFetch(reader, { registerId: `0x${'9'.repeat(64)}` });
    let summaries = 0;
    const fetch: ReturnType<typeof fakeKitFetch> = (url, init) =>
      (++summaries === 1 ? honest : wrong)(url, init);
    const kit = readerGateMake(reader, {
      registerId: async () => { reached.resolve(); return release.promise; },
      verificationProfile: () => good.verificationProfile!(),
    }, fetch);
    const first = readerGateOutcome(kit.entryCount(TOKEN));
    let second: ReturnType<typeof readerGateOutcome> | undefined;
    try {
      await readerGateWithin(reached.promise);
      second = readerGateOutcome(kit.entryCount(TOKEN));
      release.resolve(await good.registerId());
      const [a, b] = await readerGateWithin(Promise.all([first, second]));
      assert.equal(a.kind, 'fulfilled');
      assert.equal(b.kind, 'rejected');
      if (b.kind === 'rejected') assert(b.error instanceof BackendDisagreementError);
    } finally {
      release.resolve(await good.registerId());
      await readerGateWithin(Promise.all([first, ...(second === undefined ? [] : [second])]));
    }
  });
});

describe('Reader-IDENTITY-01 direct projection first-read gates', () => {
  for (const [name, read] of readerGateDirect) {
    for (const field of ['registerId', 'verificationProfile'] as const) {
      test(`${name} first-read refuses wrong ${field} before fetching its data`, async () => {
        const { reader } = divergentToken();
        const wrong = fakeKitFetch(reader, { [field]: `0x${(field === 'registerId' ? '9' : '7').repeat(64)}` });
        let dataCalls = 0;
        const fetch: ReturnType<typeof fakeKitFetch> = (url, init) => {
          if (!/\/projection\/\d+$/.test(new URL(url).pathname)) dataCalls++;
          return wrong(url, init);
        };
        const kit = readerGateMake(reader, readerGateIdentity(reader), fetch);
        await assert.rejects(read(kit), BackendDisagreementError);
        assert.equal(dataCalls, 0);
      });
    }

    test(`${name} first-read preserves the honest projection result`, async () => {
      const { reader } = divergentToken();
      const kit = readerGateMake(reader, readerGateIdentity(reader));
      const expected = name === 'entryAt' ? await reader.entryAt(TOKEN, 1n)
        : name === 'entryAsOf' ? await reader.entryAsOf(TOKEN, T.asOf)
        : name === 'holderAsOf' ? await reader.holderAsOf(TOKEN, T.asOf)
        : await reader.isFinalAsOf(TOKEN, T.asOf);
      assert.deepEqual(await read(kit), expected);
    });

    test(`${name} explicit opt-out retains its direct route and skips chain identity`, async () => {
      const { reader } = divergentToken();
      const honest = fakeKitFetch(reader);
      const fetch: ReturnType<typeof fakeKitFetch> = (url, init) => {
        assert(!/\/projection\/\d+$/.test(new URL(url).pathname), 'opt-out must not add a summary');
        return honest(url, init);
      };
      const kit = readerGateMake(reader, {
        registerId: async () => { throw new Error('OPT_OUT_IDENTITY_WAS_CALLED'); },
      }, fetch, false);
      assert.deepEqual(await read(kit), await read(kitReader(reader)));
    });
  }
});

describe('Reader-IDENTITY-01 compatibility and error classification', () => {
  test('uncovered instant remains a revert and finality false, never a transport fact', async () => {
    const { reader } = divergentToken();
    const kit = readerGateMake(reader, readerGateIdentity(reader));
    await assert.rejects(kit.entryAsOf(TOKEN, T.beforeFirstEntry), ContractRevertError);
    await assert.rejects(kit.holderAsOf(TOKEN, T.beforeFirstEntry), ContractRevertError);
    assert.equal(await kit.isFinalAsOf(TOKEN, T.beforeFirstEntry), false);
  });

  test('summary transport failure blocks direct projection and stays KitTransportError', async () => {
    const { reader } = divergentToken();
    const kit = readerGateMake(reader, readerGateIdentity(reader),
      fakeKitFetch(reader, { failWith: { status: 503, error: 'UNAVAILABLE' } }));
    await assert.rejects(kit.holderAsOf(TOKEN, T.asOf), error => {
      assert(error instanceof KitTransportError);
      assert.equal(error.status, 503);
      assert(!(error instanceof ContractRevertError));
      return true;
    });
  });

  test('chain-only facts never call Kit or projection identity', async () => {
    const { reader } = divergentToken();
    const kit = readerGateMake(reader, {
      registerId: async () => { throw new Error('CHAIN_ONLY_IDENTITY_WAS_CALLED'); },
    }, async () => { throw new Error('CHAIN_ONLY_KIT_WAS_CALLED'); });
    assert.equal(await kit.ownerOf(TOKEN), await reader.ownerOf(TOKEN));
    assert.equal(await kit.chainInstant(), await reader.chainInstant());
    assert.equal(await kit.supportsInterface('0x6309e170'), await reader.supportsInterface('0x6309e170'));
  });

  test('omitted optional profile verifier is not invented', async () => {
    const { reader } = divergentToken();
    let calls = 0;
    const kit = readerGateMake(reader, {
      registerId: async () => { calls++; return reader.registerId(); },
    });
    await kit.entryCount(TOKEN);
    await kit.entryAt(TOKEN, 1n);
    assert.equal(calls, 1);
  });

  test('no-chain-identity legacy mode does not gain an extra summary request', async () => {
    const { reader } = divergentToken();
    const honest = fakeKitFetch(reader);
    const fetch: ReturnType<typeof fakeKitFetch> = (url, init) => {
      assert(!/\/projection\/\d+$/.test(new URL(url).pathname));
      return honest(url, init);
    };
    const kit = new KitErc8415Reader(new KitProjectionApi({ baseUrl: BASE_URL, fetch }), reader, reader.source);
    assert.deepEqual(await kit.entryAt(TOKEN, 1n), await reader.entryAt(TOKEN, 1n));
  });
});


describe('Reader-IDENTITY-01 comparison-failure recovery', () => {
  for (const field of ['registerId', 'verificationProfile'] as const) {
    test(`first chain ${field} disagreement is retried, not permanently cached`, async () => {
      const { reader } = divergentToken();
      const good = readerGateIdentity(reader);
      const wrong = `0x${(field === 'registerId' ? '9' : '7').repeat(64)}`;
      let registerCalls = 0;
      let profileCalls = 0;
      const kit = readerGateMake(reader, {
        registerId: async () => {
          registerCalls++;
          return field === 'registerId' && registerCalls === 1 ? wrong : good.registerId();
        },
        verificationProfile: async () => {
          profileCalls++;
          return field === 'verificationProfile' && profileCalls === 1
            ? wrong : good.verificationProfile!();
        },
      });
      await assert.rejects(kit.entryCount(TOKEN), error => {
        assert(error instanceof BackendDisagreementError);
        assert.equal(error.field, field);
        return true;
      });
      assert.equal(registerCalls, 1);
      assert.equal(profileCalls, 1);
      assert.equal(await kit.entryCount(TOKEN), await reader.entryCount(TOKEN));
      assert.equal(registerCalls, 2, 'comparison failure must cause an explicit chain re-read');
      assert.equal(profileCalls, 2, 'the complete pair must be revalidated');
      await kit.entryCount(TOKEN);
      assert.equal(registerCalls, 2, 'a matched pair is cached after successful validation');
      assert.equal(profileCalls, 2);
    });
  }
});

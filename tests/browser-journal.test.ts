import { hashControlBytes } from '../src/controls/authorization.ts';
import { parseOperation, serializeOperation } from '../src/controls/operationJournal.ts';
import { parseAssetState } from '../src/xiongan/externalAssets.ts';
import { parseLegacyClearingState } from '../src/wallet/legacyClearingSession.ts';
import { browserJournalSuite } from './helpers/browser-journal-fixture.ts';

const controller = `0x${'1'.repeat(40)}`, actor = `0x${'2'.repeat(40)}`;

browserJournalSuite({ label: 'public operation journal', module: 'public-store.mjs',
  className: 'BrowserPublicOperationStore', parse: parseOperation as never, serialize: serializeOperation as never,
  args: [560048n, controller, actor],
  state: { schema: '8415-operation/1', revision: 0n, status: 'idle',
    deployment: { chainId: 560048n, controller, runtimeCodeHash: hashControlBytes('0x6000') },
    actor, requestDigest: null, submission: null } as never });

// The same contract over the number-revision journals, whose own callers never
// exercise the shared durability, legacy-record and revision refusals directly.
browserJournalSuite({ label: 'external asset journal', module: 'external-store.mjs',
  className: 'BrowserExternalAssetStore', parse: parseAssetState as never, serialize: JSON.stringify as never,
  args: [560048n, actor],
  state: { schema: 'xiongan-asset-operation/1', revision: 0, chainId: '560048', actor, status: 'idle',
    transaction: null, transactionHash: null, digest: null } as never });

browserJournalSuite({ label: 'legacy clearing journal', module: 'legacy-clearing-store.mjs',
  className: 'BrowserLegacyClearingStore', parse: parseLegacyClearingState as never, serialize: JSON.stringify as never,
  args: [560048n, actor],
  state: { schema: '8415-legacy-operation/1', revision: 0, chainId: '560048', actor, status: 'idle',
    review: null, transactionHash: null } as never });

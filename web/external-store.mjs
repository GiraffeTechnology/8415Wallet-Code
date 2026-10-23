import { parseAssetState as parseOperation } from '../dist/browser/browser.js';
import { BrowserJournalStore } from './browser-journal-store.mjs';

/** Public asset-operation journal. The shared strict-durability CAS boundary,
 * refusal codes and legacy-record reconciliation live in the journal base.
 */
export class BrowserExternalAssetStore extends BrowserJournalStore {
  constructor(chainId, actor) {
    super({ name: 'xiongan-public-assets-v1', key: `xiongan-asset-v1:${chainId}:${actor.toLowerCase()}`,
      parse: parseOperation, serialize: JSON.stringify,
      nextRevision: expected => expected === null ? 0 : expected + 1 });
  }
}

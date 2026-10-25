import { parseLegacyClearingState as parseOperation } from '../dist/browser/browser.js';
import { BrowserJournalStore } from './browser-journal-store.mjs';

/** Legacy-clearing operation journal. The shared strict-durability CAS boundary,
 * refusal codes and legacy-record reconciliation live in the journal base.
 */
export class BrowserLegacyClearingStore extends BrowserJournalStore {
  constructor(chainId, actor) {
    super({ name: '8415-legacy-clearing-v1', key: `8415-legacy-clearing-v1:${chainId}:${actor.toLowerCase()}`,
      parse: parseOperation, serialize: JSON.stringify,
      nextRevision: expected => expected === null ? 0 : expected + 1 });
  }
}

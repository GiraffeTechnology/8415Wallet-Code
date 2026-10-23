import { parseSettlementState as parseOperation, serializeSettlementState as serializeOperation } from '../dist/browser/browser.js';
import { BrowserJournalStore } from './browser-journal-store.mjs';

/** Standalone settlement journal with bigint revisions. The shared
 * strict-durability CAS boundary and refusal codes live in the journal base.
 * No credentials, consent signatures or calldata are stored.
 */
export class BrowserSettlementStore extends BrowserJournalStore {
  constructor(chainId, controller, actor) {
    super({ name: '8415-public-settlement-v1',
      key: `8415-settlement-v1:${chainId}:${controller.toLowerCase()}:${actor.toLowerCase()}`,
      parse: parseOperation, serialize: serializeOperation,
      nextRevision: expected => expected === null ? 0n : expected + 1n });
  }
}

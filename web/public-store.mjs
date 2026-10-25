import { parseOperation, serializeOperation } from '../dist/browser/controls/operationJournal.js';
import { BrowserJournalStore } from './browser-journal-store.mjs';

/** Public controller-operation journal with bigint revisions. The shared
 * strict-durability CAS boundary and refusal codes live in the journal base.
 * No credentials, consent signatures or calldata are stored.
 */
export class BrowserPublicOperationStore extends BrowserJournalStore {
  constructor(chainId, controller, actor) {
    super({ name: '8415-public-operation-v2',
      key: `8415-operation-v1:${chainId}:${controller.toLowerCase()}:${actor.toLowerCase()}`,
      parse: parseOperation, serialize: serializeOperation,
      nextRevision: expected => expected === null ? 0n : expected + 1n });
  }
}

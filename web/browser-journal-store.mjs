import { requireLegacyJournalLocation } from './tenant-path.mjs';
/** Strict-durability IndexedDB transaction is the cross-tab CAS boundary shared by
 * every browser operation journal. Only public unsigned transaction data is stored.
 * No credentials or signatures. Unsupported browser durability is refused, never
 * downgraded to localStorage or a memory journal.
 *
 * Each journal keeps its own database name, record key, exact state codec and
 * revision domain. Nothing here widens a scope, chooses an endpoint or signs.
 */
export function requireBrowserJournal() {
  requireLegacyJournalLocation(import.meta.url);
  if (!globalThis.indexedDB || !globalThis.isSecureContext) throw new Error('CONTROL_BROWSER_DURABILITY_REQUIRED');
}

export class BrowserJournalStore {
  constructor({ name, key, parse, serialize, nextRevision }) {
    requireBrowserJournal();
    this.name = name; this.key = key;
    this.parse = parse; this.serialize = serialize; this.nextRevision = nextRevision;
  }
  async database() {
    // Never silently drop an earlier uncertain legacy record. Reconciliation or
    // migration of that record requires a separate explicit recovery procedure.
    if (localStorage.getItem(this.key) !== null) throw new Error('CONTROL_LEGACY_JOURNAL_RECONCILIATION_REQUIRED');
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.name, 1);
      let settled = false;
      const fail = () => { settled = true; reject(new Error('CONTROL_JOURNAL_OPEN_REFUSED')); };
      request.onupgradeneeded = () => request.result.createObjectStore('operations');
      request.onerror = fail; request.onblocked = fail;
      request.onsuccess = () => {
        if (settled) { request.result.close(); return; }
        request.result.onversionchange = () => request.result.close(); resolve(request.result);
      };
    });
  }
  async read() {
    const db = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        const tx = db.transaction('operations', 'readonly');
        let value = null;
        tx.onabort = tx.onerror = () => reject(new Error('CONTROL_JOURNAL_READ_REFUSED'));
        const request = tx.objectStore('operations').get(this.key);
        request.onsuccess = () => {
          try { value = request.result === undefined ? null : this.parse(request.result); }
          catch { tx.abort(); }
        };
        tx.oncomplete = () => resolve(value);
      });
    } finally { db.close(); }
  }
  async compareAndSwap(expected, next) {
    if (next.revision !== this.nextRevision(expected)) throw new Error('CONTROL_JOURNAL_REVISION_REFUSED');
    const text = this.serialize(this.parse(this.serialize(next))), db = await this.database();
    try {
      return await new Promise((resolve, reject) => {
        let tx;
        try {
          tx = db.transaction('operations', 'readwrite', { durability: 'strict' });
          if (tx.durability !== 'strict') { tx.abort(); throw new Error('CONTROL_BROWSER_DURABILITY_REQUIRED'); }
        } catch { reject(new Error('CONTROL_BROWSER_DURABILITY_REQUIRED')); return; }
        let changed = false;
        tx.onabort = tx.onerror = () => reject(new Error('CONTROL_JOURNAL_COMMIT_REFUSED'));
        const store = tx.objectStore('operations'), request = store.get(this.key);
        request.onsuccess = () => {
          try {
            const before = request.result === undefined ? null : this.parse(request.result);
            if ((before?.revision ?? null) !== expected) return;
            store.put(text, this.key); changed = true;
          } catch { tx.abort(); }
        };
        // Request success is not a durable commit. Authorize only after the
        // strict transaction completes; any quota/abort failure prevents send.
        tx.oncomplete = () => resolve(changed);
      });
    } finally { db.close(); }
  }
}

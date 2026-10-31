/** Shared transaction-event contract fixture for the browser operation journals.
 * NOT a genuine browser/IndexedDB test: it models the strict-durability contract
 * and loads each store from its exact served source bytes, base included.
 */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

type Codec = (value: unknown) => unknown;
// Keep the real path guard; only module metadata is supplied by this isolated source loader.
const { requireLegacyJournalLocation } = await import(new URL('../../web/tenant-path.mjs', import.meta.url).href);
const plain = (path: string, moduleURL?: string) => readFileSync(new URL(path, import.meta.url), 'utf8')
  .replace(/^import .*;\r?\n/gm, '').replace(/^export /gm, '')
  .replaceAll('import.meta.url', JSON.stringify(moduleURL ?? new URL(path, import.meta.url).href));

export function browserJournalSuite({ label, module, className, parse, serialize, state, args }: {
  label: string; module: string; className: string; parse: Codec; serialize: Codec;
  state: { revision: number | bigint }; args: readonly unknown[];
}) {
  function fixture(options: { relaxed?: boolean; abort?: boolean; legacy?: boolean; moduleURL?: string } = {}) {
    const source = `${plain('../../web/browser-journal-store.mjs', options.moduleURL)}\n${plain(`../../web/${module}`)}`;
    let record: string | undefined, completed = 0, writes = 0, aborted = false;
    const db = { close() {}, transaction(_store: string, mode: string, durability?: { durability: string }) {
      if (mode === 'readwrite') assert.equal(durability?.durability, 'strict');
      let pending: string | undefined;
      const tx: any = { durability: options.relaxed ? 'relaxed' : 'strict',
        abort() { aborted = true; queueMicrotask(() => tx.onabort?.()); },
        objectStore() { return {
          get() {
            const request: any = { result: record };
            queueMicrotask(() => { request.onsuccess?.(); queueMicrotask(() => {
              if (aborted || options.abort) { tx.onabort?.(); return; }
              if (pending !== undefined) record = pending;
              completed++; tx.oncomplete?.();
            }); });
            return request;
          },
          put(text: string) { writes++; pending = text; },
        }; },
      };
      return tx;
    } };
    const indexedDB = { open() { const r: any = { result: db }; queueMicrotask(() => r.onsuccess?.()); return r; } };
    const factory = new Function('parseOperation', 'serializeOperation', 'globalThis', 'indexedDB', 'localStorage', 'requireLegacyJournalLocation',
      `${source}\nreturn ${className};`);
    const Store = factory(parse, serialize, { indexedDB, isSecureContext: true }, indexedDB,
      { getItem: () => options.legacy ? 'legacy-record' : null }, requireLegacyJournalLocation);
    return { store: new Store(...args), stats: () => ({ completed, writes, record }) };
  }
  test(`${label}: a tenant journal URL cannot create a fresh empty legacy journal`, () => {
    for (const tenant of ['example-one', 'example-two']) {
      assert.throws(() => fixture({ moduleURL: `https://wallet.example/${tenant}/web/browser-journal-store.mjs` }),
        /CONTROL_TENANT_JOURNAL_MIGRATION_REQUIRED/);
    }
  });
  test(`${label}: browser CAS resolves only after strict durable transaction completion and roundtrips`, async () => {
    const { store, stats } = fixture();
    assert.equal(await store.compareAndSwap(null, state), true); assert.equal(stats().completed, 1);
    assert.deepEqual(await store.read(), state);
    assert.equal(await store.compareAndSwap(null, state), false); assert.equal(stats().writes, 1);
  });
  test(`${label}: browser relaxed durability and post-write transaction abort never authorize a send`, async () => {
    const relaxed = fixture({ relaxed: true });
    await assert.rejects(relaxed.store.compareAndSwap(null, state), /CONTROL_BROWSER_DURABILITY_REQUIRED/);
    assert.equal(relaxed.stats().writes, 0);
    const failed = fixture({ abort: true });
    await assert.rejects(failed.store.compareAndSwap(null, state), /CONTROL_JOURNAL_COMMIT_REFUSED/);
    assert.equal(failed.stats().record, undefined);
  });
  test(`${label}: legacy browser journal is not silently discarded during durability upgrade`, async () => {
    const { store, stats } = fixture({ legacy: true });
    await assert.rejects(store.read(), /CONTROL_LEGACY_JOURNAL_RECONCILIATION_REQUIRED/);
    await assert.rejects(store.compareAndSwap(null, state), /CONTROL_LEGACY_JOURNAL_RECONCILIATION_REQUIRED/);
    assert.equal(stats().writes, 0);
  });
  test(`${label}: a revision that does not continue the journal is refused before any write`, async () => {
    const { store, stats } = fixture();
    const ahead = typeof state.revision === 'bigint' ? state.revision + 1n : state.revision + 1;
    await assert.rejects(store.compareAndSwap(null, { ...state, revision: ahead }), /CONTROL_JOURNAL_REVISION_REFUSED/);
    assert.equal(stats().writes, 0);
  });
}

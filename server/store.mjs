/** Single-writer encrypted credential state. Sessions/challenges intentionally die on restart. */
import { createCipheriv, createDecipheriv, randomBytes, createHash } from 'node:crypto';
import { open, readFile, rename, unlink, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';
import { requiredStoreGeneration, encodeStorePayload, decodeStorePayload } from './store-state-generation.mjs';
import { inspectOriginIndependentState } from './origin-transition-state.mjs';
import { readOriginContinuation, originContinuationKey } from './origin-continuation.mjs';
// Only transactionMany owns a persistence snapshot. The identity capability is
// module-private and preserves existing subclass persistence hooks.
const persistenceSnapshots = new WeakMap();
export const MAX_STORE_BYTES = 4 * 1024 * 1024;
const envelopeOverhead = Buffer.byteLength(JSON.stringify({ version: 1, iv: 'A'.repeat(16), tag: 'A'.repeat(24), data: '' }));
function checkStoreSize(data, generation = requiredStoreGeneration(data)) {
  const bytes = Buffer.byteLength(JSON.stringify(encodeStorePayload(data, generation)));
  if (4 * Math.ceil(bytes / 3) + envelopeOverhead > MAX_STORE_BYTES) throw new Error('AUTH_STORE_CAPACITY');
}
export class MemoryCredentialStore {
  #data; #queue = Promise.resolve(); #failed = false; #closing = false; #closePromise;
  #assertOpen() { if (this.#closing) throw new Error('AUTH_STORE_CLOSED'); }
  constructor(data = {}) { this.#data = structuredClone(data); }
  async read(username) { this.#assertOpen(); if (this.#failed) throw new Error('AUTH_STORE_UNHEALTHY'); return structuredClone(Object.hasOwn(this.#data, username) ? this.#data[username] : null); }
  async readMany(keys) {
    this.#assertOpen();
    if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== 'string' || !key ||
      ['__proto__', 'constructor', 'prototype'].includes(key)) || new Set(keys).size !== keys.length) throw new Error('AUTH_STORE_KEYS_REFUSED');
    const run = this.#queue.then(() => {
      if (this.#failed) throw new Error('AUTH_STORE_UNHEALTHY');
      return structuredClone(Object.fromEntries(keys.map(key => [key, Object.hasOwn(this.#data, key) ? this.#data[key] : null])));
    });
    this.#queue = run.catch(() => {}); return run;
  }
  /** Read-only serialized boundary for a server-owned immediate side effect.
   * The callback runs synchronously inside the same queue as credential/grant
   * writes. It receives a detached snapshot, cannot update stored values, and
   * must not await or re-enter this store. Use only after required durable data
   * has already committed; this method itself performs no persistence. */
  async withReadSnapshot(keys, inspect) {
    this.#assertOpen();
    if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== 'string' || !key ||
      ['__proto__', 'constructor', 'prototype'].includes(key)) || new Set(keys).size !== keys.length ||
      typeof inspect !== 'function') throw new Error('AUTH_STORE_KEYS_REFUSED');
    const run = this.#queue.then(() => {
      if (this.#failed) throw new Error('AUTH_STORE_UNHEALTHY');
      const values = structuredClone(Object.fromEntries(keys.map(key => [key, Object.hasOwn(this.#data, key) ? this.#data[key] : null])));
      const result = inspect(values);
      if (result && typeof result.then === 'function') throw new Error('AUTH_STORE_ASYNC_SNAPSHOT_REFUSED');
      return result;
    });
    this.#queue = run.catch(() => {}); return run;
  }
  /** Server-owned asynchronous read capability. Shares the exact credential/grant
   * write queue. The lock is retained until the callback actually settles; a timeout
   * must never race/drop its promise and imply that a side effect was not attempted.
   * The callback MUST NOT re-enter this store. Use a separate native task journal.
   * This is additive: the synchronous withReadSnapshot contract is unchanged. */
  async withReadGate(keys, inspect) {
    this.#assertOpen();
    if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== 'string' || !key ||
      ['__proto__', 'constructor', 'prototype'].includes(key)) || new Set(keys).size !== keys.length ||
      typeof inspect !== 'function') throw new Error('AUTH_STORE_KEYS_REFUSED');
    const run = this.#queue.then(async () => {
      if (this.#failed) throw new Error('AUTH_STORE_UNHEALTHY');
      const values = structuredClone(Object.fromEntries(keys.map(key => [key, Object.hasOwn(this.#data, key) ? this.#data[key] : null])));
      return await inspect(values);
    });
    this.#queue = run.catch(() => {}); return run;
  }
  /** Offline transition only. Drain admitted writes and close admission before
   * inspecting the WHOLE authoritative state. No credential snapshot is exported,
   * no state is persisted, and the callback must never re-enter this store.
   * The caller closes the store afterward, including a rejected transition. */
  async withOriginTransition(input, transition) {
    this.#assertOpen();
    if (typeof transition !== 'function') throw Error('AUTH_ORIGIN_TRANSITION_CALLBACK_REQUIRED');
    this.#closing = true;
    const run = this.#queue.then(async () => {
      if (this.#failed) throw Error('AUTH_STORE_UNHEALTHY');
      const proof = inspectOriginIndependentState(this.#data, input);
      return await transition(proof);
    });
    this.#queue = run.catch(() => {}); return run;
  }
  async transaction(username, update) {
    const result = await this.transactionMany([username], async values => ({ [username]: await update(values[username]) }));
    return result[username];
  }
  // One queue entry and durable replace cover every index/credential involved.
  // Keys cannot escape the explicit selection; failures leave all old values intact.
  async transactionMany(keys, update) {
    this.#assertOpen();
    if (!Array.isArray(keys) || !keys.length || keys.some(key => typeof key !== 'string' || !key ||
      ['__proto__', 'constructor', 'prototype'].includes(key)) || new Set(keys).size !== keys.length) throw new Error('AUTH_STORE_KEYS_REFUSED');
    const run = this.#queue.then(async () => {
      if (this.#failed) throw new Error('AUTH_STORE_UNHEALTHY');
      const next = structuredClone(this.#data);
      const values = Object.fromEntries(keys.map(key => [key, Object.hasOwn(next, key) ? next[key] : null]));
      const changed = await update(values);
      if (!changed || typeof changed !== 'object' || Array.isArray(changed) ||
        Object.keys(changed).length !== keys.length || keys.some(key => !Object.hasOwn(changed, key))) throw new Error('AUTH_STORE_UPDATE_REFUSED');
      for (const key of keys) next[key] = structuredClone(changed[key]);
      this.validatePersistence(next); // Rejected capacity is not a failed/uncertain durable write.
      persistenceSnapshots.set(this, next);
      try { await this.persist(next); } catch (error) { this.#failed = true; throw error; }
      finally { persistenceSnapshots.delete(this); }
      this.#data = next; return structuredClone(changed);
    });
    this.#queue = run.catch(() => {}); return run;
  }
  /** Metadata-only prestate plan. A later drain independently compares this hash;
   * this read never authorizes a mapping or freezes concurrent writes. */
  async inspectOriginContinuationState() {
    this.#assertOpen();
    if (typeof this.originTransitionBinding !== 'function' || this.originTransitionBinding().stateEstablished !== true)
      throw Error('AUTH_ORIGIN_EXISTING_STATE_REQUIRED');
    const run = this.#queue.then(() => {
      if (this.#failed) throw Error('AUTH_STORE_UNHEALTHY');
      return Object.freeze({ schema: '8415wallet-origin-continuation-plan/1',
        stateSha256: createHash('sha256').update(JSON.stringify(this.#data)).digest('hex'),
        originalRecordCount: Object.keys(this.#data).length, minimumGeneration: this.originTransitionBinding().minimumGeneration });
    });
    this.#queue = run.catch(() => {}); return run;
  }
  /** Offline continuation primitive. The existing authenticated store is drained
   * and admission stays closed, including failures. The caller must hold the
   * service/configuration fence, durably journal `prepared` before returning,
   * finish forward recovery after `committed`, then close this store. No original
   * record or plaintext snapshot leaves this boundary. Never exposed over HTTP. */
  async withOriginContinuation(input, checkpoint) {
    this.#assertOpen();
    const record = readOriginContinuation(input), reference = originContinuationKey(record);
    if (typeof checkpoint !== 'function' || typeof this.originTransitionBinding !== 'function' ||
        this.originTransitionBinding().stateEstablished !== true) throw Error('AUTH_ORIGIN_EXISTING_STATE_REQUIRED');
    this.#closing = true;
    const run = this.#queue.then(async () => {
      if (this.#failed) throw Error('AUTH_STORE_UNHEALTHY');
      const before = structuredClone(this.#data), existing = Object.hasOwn(before, reference);
      if (existing) {
        if (readOriginContinuation(before[reference]).digest !== record.digest) throw Error('AUTH_ORIGIN_CONTINUATION_CONFLICT');
        delete before[reference];
      }
      const hash = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
      if (hash(before) !== record.priorStateSha256) throw Error('AUTH_ORIGIN_CONTINUATION_STATE_CHANGED');
      const next = existing ? structuredClone(this.#data) : { ...before, [reference]: record };
      this.validatePersistence(next);
      const proof = Object.freeze({ schema: '8415wallet-origin-continuation-state/1', reference,
        mappingDigest: record.digest, revision: record.revision, beforeStateSha256: record.priorStateSha256,
        afterStateSha256: hash(next), originalRecordCount: Object.keys(before).length, minimumGeneration: 5 });
      if (existing) {
        if (this.originTransitionBinding().minimumGeneration !== 5) throw Error('AUTH_ORIGIN_CONTINUATION_CONFLICT');
        await checkpoint('recovered', proof); return proof;
      }
      await checkpoint('prepared', proof);
      persistenceSnapshots.set(this, next);
      try { await this.persist(next); } catch (error) { this.#failed = true; throw error; }
      finally { persistenceSnapshots.delete(this); }
      this.#data = next;
      await checkpoint('committed', proof); return proof;
    });
    this.#queue = run.catch(() => {}); return run;
  }
  validatePersistence(data) { checkStoreSize(data); }
  async persist(_data) {}
  close() {
    // Stop admitting work synchronously, but drain work already admitted before
    // releasing the durable writer lock. Concurrent closes share one outcome.
    this.#closing = true;
    return this.#closePromise ??= this.#queue.then(() => {});
  }
}
export async function openEncryptedStore(path, key, { firstWriteLifecycle = null } = {}) {
  if (!Buffer.isBuffer(key) || key.length !== 32) throw new Error('AUTH_STORE_KEY_REQUIRED');
  if (firstWriteLifecycle !== null && !['recover','opened','prepare','committed','syncDirectory'].every(name => typeof firstWriteLifecycle[name] === 'function'))
    throw Error('AUTH_STORE_FIRST_WRITE_LIFECYCLE_REFUSED');
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  // Never infer that an existing lock is stale. Operators must establish that the
  // prior process stopped before removing it; concurrent replicas are unsupported.
  const lock = await open(`${path}.lock`, 'wx', 0o600);
  let initial = {}, minimumGeneration = 1, stateEstablished = false;
  try {
    await firstWriteLifecycle?.recover({ statePath: path });
    try {
      const raw = await readFile(path, 'utf8');
      if (Buffer.byteLength(raw) > MAX_STORE_BYTES) throw new Error('AUTH_STORE_TOO_LARGE');
      const envelope = JSON.parse(raw);
      if (![1, 2, 3, 4, 5].includes(envelope.version)) throw new Error('AUTH_STORE_VERSION_REFUSED');
      const decrypt = createDecipheriv('aes-256-gcm', key, Buffer.from(envelope.iv, 'base64'));
      decrypt.setAAD(Buffer.from(`8415wallet-auth-store/${envelope.version}`)); decrypt.setAuthTag(Buffer.from(envelope.tag, 'base64'));
      initial = decodeStorePayload(JSON.parse(Buffer.concat([decrypt.update(Buffer.from(envelope.data, 'base64')), decrypt.final()]).toString('utf8')), envelope.version);
      minimumGeneration = envelope.version;
      stateEstablished = true;
    } catch (error) { if (error.code !== 'ENOENT') throw error; }
    await firstWriteLifecycle?.opened({ statePath: path, stateEstablished });
  } catch (error) { await lock.close(); await unlink(`${path}.lock`); throw error; }
  class EncryptedStore extends MemoryCredentialStore {
    #releasePromise;
    originTransitionBinding() { return Object.freeze({ statePath: path, minimumGeneration, stateEstablished }); }
    validatePersistence(data) { checkStoreSize(data, requiredStoreGeneration(data, minimumGeneration)); }
    async persist(data) {
      if (!persistenceSnapshots.has(this) || persistenceSnapshots.get(this) !== data) throw new Error('AUTH_STORE_PERSISTENCE_SCOPE_REFUSED');
      const generation = requiredStoreGeneration(data, minimumGeneration);
      checkStoreSize(data, generation);
      const iv = randomBytes(12), encrypt = createCipheriv('aes-256-gcm', key, iv);
      encrypt.setAAD(Buffer.from(`8415wallet-auth-store/${generation}`));
      const ciphertext = Buffer.concat([encrypt.update(JSON.stringify(encodeStorePayload(data, generation))), encrypt.final()]);
      const temp = `${path}.${randomBytes(12).toString('hex')}.tmp`;
      const file = await open(temp, 'wx', 0o600);
      let firstWritePrepared = false;
      try {
        const raw = JSON.stringify({ version: generation, iv: iv.toString('base64'), tag: encrypt.getAuthTag().toString('base64'), data: ciphertext.toString('base64') });
        await file.writeFile(raw);
        await file.sync(); await file.close();
        if (!stateEstablished && firstWriteLifecycle !== null) {
          // Once first-write durability is attempted, an uncertain sync or
          // metadata acknowledgement must not delete its encrypted candidate.
          firstWritePrepared = true;
          await firstWriteLifecycle.syncDirectory({ statePath: path, phase: 'candidate-before-prepare' });
          await firstWriteLifecycle.prepare({ statePath: path, temporaryPath: temp, sha256: createHash('sha256').update(raw).digest('hex'), bytes: Buffer.byteLength(raw) });
        }
        await rename(temp, path);
        if (firstWritePrepared) await firstWriteLifecycle.syncDirectory({ statePath: path, phase: 'state-after-replace' });
        else { const directory = await open(dirname(path), 'r'); try { await directory.sync(); } finally { await directory.close(); } }
        if (firstWritePrepared) await firstWriteLifecycle.committed({ statePath: path });
        minimumGeneration = generation;
        stateEstablished = true;
      } catch (error) { await file.close().catch(() => {}); if (!firstWritePrepared) await unlink(temp).catch(() => {}); throw error; }
    }
    close() {
      const drained = super.close();
      return this.#releasePromise ??= drained.then(async () => {
        await lock.close(); await unlink(`${path}.lock`);
      });
    }
  }
  return new EncryptedStore(initial);
}

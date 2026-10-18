import test from 'node:test';
import assert from 'node:assert/strict';
import { ObservationDetailsFlow } from '../web/observation-details-flow.mjs';
// Synthetic lifecycle definitions only. No authenticated source registry,
// canonical RPC proof, browser layout or remote acceptance is supplied here.
const h = n => `0x${n.repeat(64)}`;
const context = { tenant: 'fixture', origin: 'https://wallet.example.invalid',
  account: `0x${'a'.repeat(40)}`, chainId: '560048', taskDigest: h('b'), operationId: 'op-1', childDigest: h('c') };
const binding = Object.freeze({});
function fixture() {
  const state = { revision: '2', hold: null, fail: false, authenticated: true, reads: 0, resolves: 0, decodes: 0 };
  const source = Object.freeze({ reference: 'fixture-source', revision: '1' });
  const flow = new ObservationDetailsFlow({
    assertSession(b) { assert.equal(b, binding); if (!state.authenticated) throw Error('LOGIN_REQUIRED'); return context; },
    async resolveSource() { state.resolves++; if (state.fail) throw Object.assign(Error(), { code: 'OBSERVATION_SOURCE_UNAVAILABLE' }); return source; },
    async readEvidence(c) { state.reads++; if (state.hold) await state.hold; return { ...c, savedRevision: state.revision }; },
    decodeEvidence(raw, { expectedSource, context: c }) {
      state.decodes++; assert.equal(expectedSource, source); assert.equal(raw.operationId, c.operationId);
      return Object.freeze({ ...raw, availability: 'available', fresh: true, observedAt: '100',
        observedBy: 'fixture-observer', sourceReference: source.reference, sourceRevision: source.revision });
    },
  });
  return { state, flow };
}
test('service missing-source refusal is unsupported, not an authorization request', async () => {
  const flow = new ObservationDetailsFlow({ assertSession: () => context,
    resolveSource: async () => { throw Object.assign(Error(), { code: 'TASK_OBSERVATION_SOURCE_UNSUPPORTED' }); },
    readEvidence: async () => { assert.fail('no evidence read without independent source'); },
    decodeEvidence: () => { assert.fail('no fabricated evidence'); } });
  await flow.open(context, binding);
  assert.equal(flow.snapshot().error, 'OBSERVATION_SOURCE_UNSUPPORTED');
  assert.equal(flow.snapshot().evidence, null);
});

test('service principal refusal clears rather than retaining another principal view', async () => {
  const flow = new ObservationDetailsFlow({ assertSession: () => context,
    resolveSource: async () => { throw Object.assign(Error(), { code: 'TASK_PRINCIPAL_BINDING_REFUSED' }); },
    readEvidence: async () => { assert.fail('principal refused'); }, decodeEvidence: () => null });
  await flow.open(context, binding);
  assert.equal(flow.snapshot().phase, 'closed');
  assert.equal(flow.snapshot().evidence, null);
});

test('independent source resolution precedes evidence and cannot become execution', async () => {
  const f = fixture(); await f.flow.open(context, binding);
  assert.equal(f.state.resolves, 1); assert.equal(f.state.reads, 1); assert.equal(f.state.decodes, 1);
  assert.equal(f.flow.snapshot().phase, 'ready');
  assert.equal('execute' in f.flow, false); assert.equal('authorize' in f.flow, false);
});
test('missing source on first load has no invented observation or evidence request', async () => {
  const f = fixture(); f.state.fail = true; await f.flow.open(context, binding);
  assert.equal(f.flow.snapshot().phase, 'unavailable'); assert.equal(f.flow.snapshot().evidence, null);
  assert.equal(f.state.reads, 0); assert.equal(f.state.decodes, 0);
});
test('failed refresh preserves the exact old evidence source and timestamp as stale', async () => {
  const f = fixture(); await f.flow.open(context, binding); const before = f.flow.snapshot().evidence;
  f.state.fail = true; await f.flow.refresh();
  assert.equal(f.flow.snapshot().evidence, before); assert.equal(f.flow.snapshot().evidence.observedAt, '100');
  assert.equal(f.flow.snapshot().stale, true); assert.equal(f.flow.snapshot().phase, 'unavailable');
});
test('refresh is single-flight and cancel discards late completion', async () => {
  const f = fixture(); await f.flow.open(context, binding); let release;
  f.state.hold = new Promise(resolve => { release = resolve; });
  const pending = f.flow.refresh(); await Promise.resolve(); await f.flow.refresh();
  assert.equal(f.state.reads, 2); f.flow.close(); release(); await pending;
  assert.equal(f.flow.snapshot().phase, 'closed'); assert.equal(f.flow.snapshot().evidence, null);
});
test('operation switch clears old evidence before the new read completes', async () => {
  const f = fixture(); await f.flow.open(context, binding); let release;
  f.state.hold = new Promise(resolve => { release = resolve; });
  const pending = f.flow.open({ ...context, operationId: 'op-2' }, binding);
  assert.equal(f.flow.snapshot().evidence, null); f.flow.close(); release(); await pending;
  assert.equal(f.flow.snapshot().evidence, null);
});
test('an older saved revision cannot replace a newer snapshot', async () => {
  const f = fixture(); await f.flow.open(context, binding); const before = f.flow.snapshot().evidence;
  f.state.revision = '1'; await f.flow.refresh();
  assert.equal(f.flow.snapshot().evidence, before); assert.equal(f.flow.snapshot().error, 'OBSERVATION_REVISION_STALE');
});
test('any session assertion failure clears cached evidence instead of retaining another session view', async () => {
  const f = fixture(); await f.flow.open(context, binding); f.state.authenticated = false;
  await f.flow.refresh(); assert.equal(f.flow.snapshot().phase, 'closed');
  assert.equal(f.flow.snapshot().evidence, null);
});
test('malformed new context clears the old view before refusing the selection', async () => {
  const f = fixture(); await f.flow.open(context, binding);
  await assert.rejects(f.flow.open({ ...context, extra: true }, binding), /OBSERVATION_CONTEXT_REFUSED/);
  assert.equal(f.flow.snapshot().phase, 'closed'); assert.equal(f.flow.snapshot().evidence, null);
});
test('cache resolves durable O2 independently while explicit refresh selects trusted current O3', async () => {
  const modes = [], reads = [], oldSource = Object.freeze({ reference: 'O2', revision: '2' }),
    currentSource = Object.freeze({ reference: 'O3', revision: '3' });
  const flow = new ObservationDetailsFlow({
    assertSession: () => context,
    async resolveSource(_context, { mode }) { modes.push(mode); return mode === 'cache' ? oldSource : currentSource; },
    async readEvidence(c, { source, refresh }) {
      reads.push({ source, refresh }); return { ...c, savedRevision: refresh ? '3' : '2' };
    },
    decodeEvidence(raw, { expectedSource }) { return Object.freeze({ ...raw, availability: 'available',
      fresh: false, observedBy: expectedSource.reference, observedAt: expectedSource.revision }); },
  });
  await flow.open(context, binding);
  assert.equal(flow.snapshot().evidence.observedBy, 'O2');
  await flow.refresh();
  assert.deepEqual(modes, ['cache','refresh']);
  assert.equal(reads[0].source, oldSource); assert.equal(reads[0].refresh, false);
  assert.equal(reads[1].source, currentSource); assert.equal(reads[1].refresh, true);
  assert.equal(flow.snapshot().evidence.observedBy, 'O3');
});
test('failed current O3 refresh retains saved O2 source and original timestamp', async () => {
  const oldSource = Object.freeze({ reference: 'O2', revision: '2' }), modes = [];
  const flow = new ObservationDetailsFlow({
    assertSession: () => context,
    async resolveSource(_context, { mode }) {
      modes.push(mode);
      if (mode === 'refresh') throw Object.assign(Error(), { code: 'OBSERVATION_SOURCE_UNAVAILABLE' });
      return oldSource;
    },
    async readEvidence(c) { return { ...c, savedRevision: '2' }; },
    decodeEvidence: raw => Object.freeze({ ...raw, availability: 'available', fresh: false, observedBy: 'O2', observedAt: '100' }),
  });
  await flow.open(context, binding); const before = flow.snapshot().evidence; await flow.refresh();
  assert.deepEqual(modes, ['cache','refresh']); assert.equal(flow.snapshot().evidence, before);
  assert.equal(flow.snapshot().evidence.observedBy, 'O2'); assert.equal(flow.snapshot().evidence.observedAt, '100');
  assert.equal(flow.snapshot().stale, true); assert.equal(flow.snapshot().phase, 'unavailable');
});

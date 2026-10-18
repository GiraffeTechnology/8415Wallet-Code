import test from 'node:test';
import assert from 'node:assert/strict';
import { AbiCoder, keccak256 } from 'ethers';
import { encodeCall, REGISTER_ENTRY_TYPES } from '../src/codec/abi.ts';
import { ResponsibilityControlClient } from '../src/controls/client.ts';
import { RpcResponsibilityControlReader } from '../src/controls/view.ts';
import type { Eip1193Provider } from '../src/adapters/signing/eip1193Signer.ts';

// Synthetic RPC definitions only; not archived-node, chain or deployment evidence.
const a = (n: string) => '0x' + n.repeat(40), h = (n: string) => '0x' + n.repeat(64);
const abi = AbiCoder.defaultAbiCoder(), code = '0x60006000', tokenCode = '0x60006001';
const sequenceId = h('1'), blockHash = h('b'), latestHash = h('c');
const pin = { chainId: 560048n, controller: a('1'), runtimeCodeHash: keccak256(code) };
const token = a('2'), first = a('3'), second = a('4');
const sequenceTypes = ['address', 'uint256', 'address', 'address', 'address', 'bytes32', 'bytes32', 'bytes32',
  'uint256', 'uint256', 'uint256', 'uint256', 'uint256', 'bytes32', 'bool'];
const legTypes = ['bytes32', 'address', 'address', 'bytes32', 'bytes32', 'address', 'bytes32', 'uint8'];
function fixture(repeated = false) {
  const calls: { method: string; params: readonly unknown[] }[] = [];
  const flags = { headerHash: blockHash, headerNumber: '0x10', missing: false, endHash: blockHash, endNumber: '0x10',
    reorgAtRead: Infinity, chainSwitchAt: Infinity, controllerCode: code, tokenCode,
    archiveUnavailable: false, badAdmission: false, bindingAvailable: true, wrongRegister: false,
    erc165: true, invalidInterface: false, projectionInterface: true, settlementInterface: true,
    malformedInterface: false, interfaceTransportFailure: false };
  let blockReads = 0, chains = 0, latestSelected = false;
  const current = first, occurrence = repeated ? 2n : 0n;
  const entry = [h('5'), h('6'), h('7'), first, 1n, 64n, 0n];
  const provider: Eip1193Provider = { async request({ method, params = [] }) {
    calls.push({ method, params: structuredClone(params) });
    if (method === 'eth_chainId') return ++chains >= flags.chainSwitchAt ? '0x1' : '0x88bb0';
    if (method === 'eth_getCode') {
      if (params[1] !== 'latest') assert.deepEqual(params[1], { blockHash: latestSelected ? latestHash : flags.headerHash.toLowerCase(), requireCanonical: true });
      return params[0] === pin.controller ? flags.controllerCode : flags.tokenCode;
    }
    if (method === 'eth_getBlockByNumber') {
      if (params[0] === 'latest') { latestSelected = true; return { number: '0x20', timestamp: '0x100', hash: latestHash }; }
      assert.equal(params[0], latestSelected ? '0x20' : '0x10');
      blockReads++;
      if (flags.missing) return null;
      if (latestSelected) return { number: '0x20', timestamp: '0x100', hash: latestHash };
      return { number: blockReads >= flags.reorgAtRead ? flags.endNumber : flags.headerNumber,
        timestamp: '0x80', hash: blockReads >= flags.reorgAtRead ? flags.endHash : flags.headerHash };
    }
    if (method === 'eth_call') {
      const block = params[1] as { blockHash: string; requireCanonical: boolean };
      assert.deepEqual(block, { blockHash: latestSelected ? latestHash : flags.headerHash.toLowerCase(), requireCanonical: true });
      if (flags.archiveUnavailable) throw Error('synthetic missing archive state');
      const tx = params[0] as { to: string; data: string };
      const is = (signature: string, types: readonly string[], values: readonly any[]) =>
        tx.data === encodeCall(signature, types as any, values);
      for (const [id, supported] of [['0x01ffc9a7', flags.erc165], ['0xffffffff', flags.invalidInterface],
        ['0x6309e170', flags.projectionInterface], ['0xf4a7d71b', flags.settlementInterface]] as const) {
        if (tx.to === token && is('supportsInterface(bytes4)', ['bytes4'], [id])) {
          if (flags.interfaceTransportFailure) throw Error('synthetic interface transport failure');
          return abi.encode(['uint256'], [flags.malformedInterface ? 2 : supported ? 1 : 0]);
        }
      }
      if (tx.to === pin.controller && is('sequence(bytes32)', ['bytes32'], [sequenceId])) return abi.encode(sequenceTypes,
        [token, 7n, first, current, a('5'), h('8'), h('9'), keccak256(tokenCode), 2n, occurrence, 0n, 0n, occurrence, h('0'), false]);
      if (is('legCount(bytes32)', ['bytes32'], [sequenceId])) return abi.encode(['uint256'], [occurrence]);
      for (let i = 0n; i < occurrence; i++) {
        if (is('legAt(bytes32,uint256)', ['bytes32', 'uint256'], [sequenceId, i])) return abi.encode(legTypes,
          [h(i === 0n ? 'a' : 'd'), i === 0n ? first : second, i === 0n ? second : first,
            h('2'), h('3'), a('5'), h('4'), 0n]);
      }
      if (is('inheritedHash(bytes32)', ['bytes32'], [sequenceId])) return abi.encode(['bytes32'], [h('e')]);
      if (tx.to === token && is('registerId()', [], [])) return abi.encode(['bytes32'], [flags.wrongRegister ? h('f') : h('8')]);
      if (tx.to === token && is('verificationProfile()', [], [])) return abi.encode(['bytes32'], [h('9')]);
      if (tx.to === token && is('ownerOf(uint256)', ['uint256'], [7n])) return abi.encode(['address'], [current]);
      const instant = latestSelected ? 256n : 128n;
      if (tx.to === token && is('entryAsOf(uint256,uint64)', ['uint256', 'uint64'], [7n, instant])) return abi.encode([...REGISTER_ENTRY_TYPES], entry);
      if (tx.to === token && is('holderAsOf(uint256,uint64)', ['uint256', 'uint64'], [7n, instant])) return abi.encode(['address'], [first]);
      if (tx.to === token && is('isFinalAsOf(uint256,uint64)', ['uint256', 'uint64'], [7n, instant])) return abi.encode(['bool'], [false]);
      if (tx.to === token && is('openGapOf(uint256)', ['uint256'], [7n])) return abi.encode(['bytes32'], [h('0')]);
      if (tx.to === pin.controller && is('admissionBinding(bytes32,uint64)', ['bytes32', 'uint64'], [sequenceId, 1n])) {
        const immutableHash = keccak256(abi.encode([...REGISTER_ENTRY_TYPES].slice(0, 6), entry.slice(0, 6)));
        return abi.encode(['bool', 'uint256', 'bytes32'], [flags.bindingAvailable, occurrence, flags.badAdmission ? h('f') : immutableHash]);
      }
    }
    throw Error('UNEXPECTED_READ_ONLY_RPC');
  } };
  return { calls, flags, client: new ResponsibilityControlClient(provider, pin),
    reader: new RpcResponsibilityControlReader(provider, pin) };
}
test('explicit historical snapshot binds the requested height/hash and never substitutes latest', async () => {
  const f = fixture(true), result = await f.client.snapshotAt(sequenceId, 16n, blockHash);
  assert.equal(result.blockNumber, 16n); assert.equal(result.blockHash, blockHash);
  assert.equal(result.timestamp, 128n); assert.equal(result.legs.length, 2);
  assert.deepEqual(f.calls.filter(c => c.method === 'eth_getBlockByNumber').map(c => c.params), [['0x10', false], ['0x10', false]]);
  assert.ok(f.calls.every(c => ['eth_chainId', 'eth_getCode', 'eth_getBlockByNumber', 'eth_call'].includes(c.method)));
});
test('ordinary snapshot and projection retain explicit latest reads', async () => {
  const f = fixture(), snapshot = await f.client.snapshot(sequenceId);
  assert.equal(snapshot.blockNumber, 32n); assert.equal(snapshot.blockHash, latestHash);
  assert.deepEqual(f.calls.filter(c => c.method === 'eth_getBlockByNumber').map(c => c.params), [['latest', false], ['0x20', false]]);
  const g = fixture(), observed = await g.reader.observe(sequenceId);
  assert.equal(observed.snapshot.blockNumber, 32n); assert.equal(observed.projection.instant, 256n);
  assert.equal(g.calls.filter(c => c.method === 'eth_chainId').length, 3);
  assert.deepEqual(g.calls.at(-1), { method: 'eth_chainId', params: [] });
});
test('malformed historical anchors are refused before any provider call', async () => {
  for (const [number, hash] of [[-1n, blockHash], [1n << 256n, blockHash], [16, blockHash], ['16', blockHash],
    [16n, h('0')], [16n, 'latest'], [16n, null]] as const) {
    const f = fixture();
    await assert.rejects(f.client.snapshotAt(sequenceId, number as bigint, hash as string), /CONTROL_HISTORICAL_ANCHOR_REFUSED/);
    assert.equal(f.calls.length, 0);
  }
});
test('historical snapshot refuses missing, wrong-height and wrong-hash initial headers', async () => {
  for (const change of [{ missing: true }, { headerNumber: '0x11' }, { headerHash: h('f') }]) {
    const f = fixture(); Object.assign(f.flags, change);
    await assert.rejects(f.client.snapshotAt(sequenceId, 16n, blockHash));
    assert.ok(!f.calls.some(c => c.method === 'eth_call'));
  }
});
test('historical snapshot refuses a late canonical hash or height change', async () => {
  for (const change of [{ endHash: h('f') }, { endNumber: '0x11' }]) {
    const f = fixture(); Object.assign(f.flags, change, { reorgAtRead: 2 });
    await assert.rejects(f.client.snapshotAt(sequenceId, 16n, blockHash), /CONTROL_SNAPSHOT_REORGED/);
  }
});
test('historical snapshot rechecks the actual chain after all sequence reads', async () => {
  const f = fixture(); f.flags.chainSwitchAt = 2;
  await assert.rejects(f.client.snapshotAt(sequenceId, 16n, blockHash), /CONTROL_CHAIN_MISMATCH/);
});
test('an unavailable archive state cannot fall back to a current snapshot', async () => {
  const f = fixture(); f.flags.archiveUnavailable = true;
  await assert.rejects(f.client.snapshotAt(sequenceId, 16n, blockHash), /CONTROL_RPC_REFUSED/);
  assert.ok(!f.calls.some(c => c.method === 'eth_getBlockByNumber' && c.params[0] === 'latest'));
});
test('historical projection independently reads protocol answers at the exact historical timestamp', async () => {
  const f = fixture(), result = await f.reader.observeAt(sequenceId, 16n, blockHash);
  assert.equal(result.snapshot.blockNumber, 16n); assert.equal(result.snapshot.blockHash, blockHash);
  assert.equal(result.projection.instant, 128n); assert.equal(result.projection.protocolFinality, false);
  assert.equal(result.evidence.kind, 'bound');
  const blockCalls = f.calls.filter(c => c.method === 'eth_call' || c.method === 'eth_getCode' && c.params[1] !== 'latest');
  assert.ok(blockCalls.length > 6);
  for (const c of blockCalls) assert.deepEqual(c.params[1], { blockHash, requireCanonical: true });
  assert.deepEqual(f.calls.at(-2), { method: 'eth_getBlockByNumber', params: ['0x10', false] });
  assert.deepEqual(f.calls.at(-1), { method: 'eth_chainId', params: [] });
});
test('repeated accounts remain distinct occurrences at the historical block', async () => {
  const f = fixture(true), { snapshot, evidence } = await f.reader.observeAt(sequenceId, 16n, blockHash);
  assert.equal(snapshot.initialHolder, snapshot.legs[1]!.buyer);
  assert.notEqual(snapshot.initialOccurrenceId, snapshot.legs[1]!.buyerOccurrenceId);
  assert.equal(evidence.kind, 'bound');
  if (evidence.kind !== 'bound') assert.fail('synthetic canonical binding expected');
  assert.equal(evidence.admittedHolder.occurrenceId, snapshot.legs[1]!.buyerOccurrenceId);
  assert.notEqual(evidence.admittedHolder.occurrenceId, snapshot.initialOccurrenceId);
});
test('historical projection refuses a mismatched register or admitted entry binding', async () => {
  for (const change of [{ badAdmission: true }, { wrongRegister: true }]) {
    const f = fixture(); Object.assign(f.flags, change);
    await assert.rejects(f.reader.observeAt(sequenceId, 16n, blockHash));
  }
});
test('no historical admission proof means unavailable evidence, never guessed holder position', async () => {
  const f = fixture(); f.flags.bindingAvailable = false;
  const result = await f.reader.observeAt(sequenceId, 16n, blockHash);
  assert.deepEqual(result.evidence, { kind: 'unavailable' });
  assert.equal(result.projection.holder, first);
});
test('historical projection refuses token runtime drift despite a bound controller', async () => {
  const f = fixture(); f.flags.tokenCode = '0x6001';
  await assert.rejects(f.reader.observeAt(sequenceId, 16n, blockHash), /CONTROL_TOKEN_IDENTITY_CHANGED/);
});
test('historical projection catches chain switch or reorg after the later protocol reads', async () => {
  for (const change of [{ chainSwitchAt: 3 }, { reorgAtRead: 3, endHash: h('f') }, { reorgAtRead: 3, endNumber: '0x11' }]) {
    const f = fixture(); Object.assign(f.flags, change);
    await assert.rejects(f.reader.observeAt(sequenceId, 16n, blockHash));
  }
});
test('historical reads never acquire accounts, sign, broadcast or evaluate commercial completion', async () => {
  const f = fixture(), result = await f.reader.observeAt(sequenceId, 16n, blockHash);
  assert.ok(f.calls.every(c => ['eth_chainId', 'eth_getCode', 'eth_getBlockByNumber', 'eth_call'].includes(c.method)));
  assert.equal(result.projection.freshness, 'not-evaluated');
  assert.equal(result.evidence.kind === 'bound' && result.evidence.protocolFinality, false);
});

test('historical conformance asks all four identifiers independently before projection facts', async () => {
  const f = fixture(); await f.reader.observeAt(sequenceId, 16n, blockHash);
  const inputs = f.calls.filter(c => c.method === 'eth_call').map(c => c.params[0] as { to: string; data: string });
  const calls = inputs.filter(c => c.to === token);
  const ids = ['0x01ffc9a7', '0xffffffff', '0x6309e170', '0xf4a7d71b'];
  assert.deepEqual(calls.slice(0, 4).map(c => c.data), ids.map(id => encodeCall('supportsInterface(bytes4)', ['bytes4'], [id])));
  const ordinary = fixture(); await ordinary.reader.observe(sequenceId);
  const latestCalls = ordinary.calls.filter(c => c.method === 'eth_call')
    .map(c => c.params[0] as { to: string; data: string }).filter(c => c.to === token);
  assert.deepEqual(latestCalls.slice(0, 4).map(c => c.data),
    ids.map(id => encodeCall('supportsInterface(bytes4)', ['bytes4'], [id])));
});
test('historical non-ERC165 or always-true fallback cannot disclose projection answers', async () => {
  for (const change of [{ erc165: false }, { invalidInterface: true }]) {
    const f = fixture(); Object.assign(f.flags, change);
    await assert.rejects(f.reader.observeAt(sequenceId, 16n, blockHash), /CONTROL_ERC165_UNSUPPORTED/);
    assert.ok(!f.calls.some(c => c.method === 'eth_call' &&
      (c.params[0] as { data: string }).data === encodeCall('registerId()', [], [])));
  }
});
test('historical projection support cannot be inferred from another advertised interface', async () => {
  const f = fixture(); f.flags.projectionInterface = false;
  await assert.rejects(f.reader.observeAt(sequenceId, 16n, blockHash), /CONTROL_PROJECTION_INTERFACE_UNSUPPORTED/);
  assert.ok(!f.calls.some(c => c.method === 'eth_call' &&
    (c.params[0] as { data: string }).data === encodeCall('entryAsOf(uint256,uint64)', ['uint256', 'uint64'], [7n, 128n])));
});
test('historical projection-only asset is explicitly unsupported by linked gap/profile reader, not gap zero', async () => {
  const f = fixture(); f.flags.settlementInterface = false;
  await assert.rejects(f.reader.observeAt(sequenceId, 16n, blockHash), /CONTROL_LINKED_SETTLEMENT_UNSUPPORTED/);
  assert.ok(!f.calls.some(c => c.method === 'eth_call' &&
    [encodeCall('openGapOf(uint256)', ['uint256'], [7n]), encodeCall('verificationProfile()', [], [])]
      .includes((c.params[0] as { data: string }).data)));
});
test('historical interface transport failure stays unavailable and is never an unsupported verdict', async () => {
  const f = fixture(); f.flags.interfaceTransportFailure = true;
  await assert.rejects(f.reader.observeAt(sequenceId, 16n, blockHash), /CONTROL_RPC_REFUSED/);
});
test('historical noncanonical interface boolean is refused instead of truthy coercion', async () => {
  const f = fixture(); f.flags.malformedInterface = true;
  await assert.rejects(f.reader.observeAt(sequenceId, 16n, blockHash), /ABI bool must be 0 or 1/);
});

// Regression definitions: synthetic provider switches only; never real-chain evidence.
test('latest control snapshot refuses a chain switch before publication', async () => {
  const f = fixture(); f.flags.chainSwitchAt = 2;
  await assert.rejects(f.client.snapshot(sequenceId), /CONTROL_CHAIN_MISMATCH/);
  assert.deepEqual(f.calls.at(-1), { method: 'eth_chainId', params: [] });
});
test('latest projection refuses a later switch after the control snapshot passed', async () => {
  const f = fixture(); f.flags.chainSwitchAt = 3;
  await assert.rejects(f.reader.observe(sequenceId), /CONTROL_CHAIN_MISMATCH/);
  assert.deepEqual(f.calls.at(-1), { method: 'eth_chainId', params: [] });
});
test('a stable latest chain preserves the exact snapshot and projection facts', async () => {
  const f = fixture(), result = await f.reader.observe(sequenceId);
  assert.equal(result.snapshot.asset.chainId, pin.chainId);
  assert.equal(result.snapshot.blockHash, latestHash);
  assert.equal(result.projection.holder, first);
  assert.equal(result.projection.protocolFinality, false);
  assert.equal(result.evidence.kind, 'bound');
});

// P06 regression definitions only: synthetic RPC responses, not live-node acceptance.
test('latest conformance checks all four identifiers at the exact selected snapshot', async () => {
  const f = fixture(); await f.reader.observe(sequenceId);
  const ids = ['0x01ffc9a7', '0xffffffff', '0x6309e170', '0xf4a7d71b'];
  const probes = f.calls.filter(c => c.method === 'eth_call' &&
    (c.params[0] as { to: string }).to === token &&
    ids.some(id => (c.params[0] as { data: string }).data === encodeCall('supportsInterface(bytes4)', ['bytes4'], [id])));
  assert.equal(probes.length, 4);
  for (const probe of probes) assert.deepEqual(probe.params[1], { blockHash: latestHash, requireCanonical: true });
});
for (const [change, error] of [
  [{ erc165: false }, /CONTROL_ERC165_UNSUPPORTED/],
  [{ invalidInterface: true }, /CONTROL_ERC165_UNSUPPORTED/],
  [{ projectionInterface: false }, /CONTROL_PROJECTION_INTERFACE_UNSUPPORTED/],
  [{ settlementInterface: false }, /CONTROL_LINKED_SETTLEMENT_UNSUPPORTED/],
  [{ malformedInterface: true }, /ABI bool must be 0 or 1/],
  [{ interfaceTransportFailure: true }, /CONTROL_RPC_REFUSED/],
] as const) {
  test('latest conformance fails before projection facts: ' + Object.keys(change)[0], async () => {
    const f = fixture(); Object.assign(f.flags, change);
    await assert.rejects(f.reader.observe(sequenceId), error);
    const protocolFacts = ['registerId()', 'verificationProfile()', 'ownerOf(uint256)',
      'entryAsOf(uint256,uint64)', 'holderAsOf(uint256,uint64)', 'isFinalAsOf(uint256,uint64)', 'openGapOf(uint256)'];
    const selectors = protocolFacts.map(signature => encodeCall(signature, [], []).slice(0, 10));
    assert.ok(!f.calls.some(c => c.method === 'eth_call' &&
      (c.params[0] as { to: string }).to === token &&
      selectors.includes((c.params[0] as { data: string }).data.slice(0, 10))));
    assert.ok(f.calls.every(c => ['eth_chainId', 'eth_getCode', 'eth_getBlockByNumber', 'eth_call'].includes(c.method)));
  });
}

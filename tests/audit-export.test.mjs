import test from 'node:test';
import assert from 'node:assert/strict';
import { encodeAuditDownload, readAuditDownload } from '../web/audit-export.mjs';
const hash = '0x' + '1'.repeat(64), zero = '0x' + '0'.repeat(64), address = '0x' + '1'.repeat(40);
const expected = { chainId: '560048', contract: address, tokenId: '1' };
const trail = () => ({
  schema: 'erc8415-wallet-audit/1', exportedAt: '2026-10-16T00:00:00.000Z',
  source: { chainId: '560048', contract: address, registerId: hash, verificationProfile: null },
  tokenId: '1', observedAt: '9007199254740993', tradeablePosition: { owner: address },
  entries: [{ version: '1', holder: address, effectiveAt: '1', supersededAt: '0',
    recordCommitment: hash, previousCommitment: zero, registryReference: zero, linkFaults: [] }],
  chainIntact: true, settlementLog: { available: false, episodes: [], events: [] }, notes: []
});
function wallet(counts = [1n,1n]) {
  const calls = []; let index = 0;
  return { calls, reader: { source: { chainId: 560048n, address },
    entryCount: async () => { calls.push('count'); return counts[index++]; } },
    assetView: async () => { calls.push('identity'); },
    auditTrail: async () => { calls.push('audit'); return trail(); } };
}
test('preserves decimal strings and unavailable history without claiming atomicity', () => {
  const value = encodeAuditDownload(trail(), expected);
  assert.equal(JSON.parse(value.json).observedAt, '9007199254740993');
  assert.equal(value.gapsAvailable, false);
  assert.match(value.semantics, /not an atomic/);
  assert.equal(value.filename, 'erc8415-audit-1.json');
});
test('rejects source, token substitution and undeclared private fields', () => {
  for (const change of [
    value => { value.tokenId = '2'; },
    value => { value.source.chainId = '1'; },
    value => { value.secret = 'must not serialize'; },
    value => { value.entries[0].signature = 'must not serialize'; }
  ]) { const value = trail(); change(value); assert.throws(() => encodeAuditDownload(value, expected)); }
});
test('rejects narrowed/coercible integers and oversized history', () => {
  const value = trail(); value.observedAt = 9007199254740992;
  assert.throws(() => encodeAuditDownload(value, expected));
  value.observedAt = '01'; assert.throws(() => encodeAuditDownload(value, expected));
  value.observedAt = '1'; value.entries = Array.from({ length: 513 }, () => trail().entries[0]);
  assert.throws(() => encodeAuditDownload(value, expected));
});
test('read enters existing conformance/identity path before history and rechecks afterward', async () => {
  const value = wallet(); await readAuditDownload({ wallet: value, tokenId: 1n, guard() {} });
  assert.deepEqual(value.calls, ['identity','count','audit','identity','count']);
});
test('preflight work ceiling refuses without walking history', async () => {
  const value = wallet([513n]); await assert.rejects(readAuditDownload({ wallet: value, tokenId: 1n, guard() {} }));
  assert.equal(value.calls.includes('audit'), false);
});
test('changed entry count and source drift cannot publish an export', async () => {
  const value = wallet([1n,2n]);
  await assert.rejects(readAuditDownload({ wallet: value, tokenId: 1n, guard() {} }));
  const drift = wallet(); drift.auditTrail = async () => { drift.reader.source.chainId = 1n; return trail(); };
  await assert.rejects(readAuditDownload({ wallet: drift, tokenId: 1n, guard() {} }));
});
test('session cancellation after await refuses the result', async () => {
  const value = wallet(); let active = true;
  value.auditTrail = async () => { active = false; return trail(); };
  await assert.rejects(readAuditDownload({ wallet: value, tokenId: 1n,
    guard() { if (!active) throw new Error('session invalid'); } }));
});
test('failed gap read is not replaced by an empty successful export', async () => {
  const value = wallet(); value.auditTrail = async () => { throw new Error('transport'); };
  await assert.rejects(readAuditDownload({ wallet: value, tokenId: 1n, guard() {} }));
});

/** DApp consumer of the existing custody audit export; never an execution proof. */
const fail = () => { throw new Error('AUDIT_EXPORT_REFUSED'); };
const insist = value => { if (!value) fail(); };
const uint = value => typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value) && BigInt(value) < 1n << 256n;
const hash = value => typeof value === 'string' && /^0x[0-9a-f]{64}$/.test(value);
const address = value => typeof value === 'string' && /^0x[0-9a-fA-F]{40}$/.test(value);
const text = value => typeof value === 'string' && value.length <= 2048;
function exact(value, keys) {
  insist(value && Object.getPrototypeOf(value) === Object.prototype &&
    Object.keys(value).sort().join(',') === [...keys].sort().join(','));
}
function strings(value, maximum = 512) {
  insist(Array.isArray(value) && value.length <= maximum && value.every(text));
}
/** Validate and copy the existing public audit schema, rejecting undeclared fields. */
export function encodeAuditDownload(trail, expected) {
  exact(trail, ['schema','exportedAt','source','tokenId','observedAt','tradeablePosition','entries','chainIntact','settlementLog','notes']);
  insist(trail.schema === 'erc8415-wallet-audit/1' && text(trail.exportedAt) &&
    Number.isFinite(Date.parse(trail.exportedAt)) && uint(trail.tokenId) && uint(trail.observedAt));
  exact(trail.source, ['chainId','contract','registerId','verificationProfile']);
  insist(uint(trail.source.chainId) && address(trail.source.contract) && hash(trail.source.registerId) &&
    (trail.source.verificationProfile === null || hash(trail.source.verificationProfile)));
  insist(trail.source.chainId === expected.chainId && trail.source.contract.toLowerCase() === expected.contract.toLowerCase() &&
    trail.tokenId === expected.tokenId);
  exact(trail.tradeablePosition, ['owner']); insist(address(trail.tradeablePosition.owner));
  insist(typeof trail.chainIntact === 'boolean' && Array.isArray(trail.entries) && trail.entries.length > 0 && trail.entries.length <= 512);
  for (const entry of trail.entries) {
    exact(entry, ['version','holder','effectiveAt','supersededAt','recordCommitment','previousCommitment','registryReference','linkFaults']);
    insist(uint(entry.version) && uint(entry.effectiveAt) && uint(entry.supersededAt) && address(entry.holder) &&
      hash(entry.recordCommitment) && hash(entry.previousCommitment) && hash(entry.registryReference));
    strings(entry.linkFaults, 32);
  }
  exact(trail.settlementLog, ['available','episodes','events']);
  insist(typeof trail.settlementLog.available === 'boolean' && Array.isArray(trail.settlementLog.episodes) &&
    Array.isArray(trail.settlementLog.events) && trail.settlementLog.episodes.length <= 8192 && trail.settlementLog.events.length <= 32768);
  for (const item of trail.settlementLog.episodes) {
    exact(item, ['settlementId','openedAt','deadline','expectedHolder','initiator','closure','admittedVersion','replacedBy']);
    insist(hash(item.settlementId) && (item.openedAt === null || uint(item.openedAt)) && uint(item.deadline) &&
      address(item.expectedHolder) && address(item.initiator) && text(item.closure) &&
      (item.admittedVersion === null || uint(item.admittedVersion)) && (item.replacedBy === null || hash(item.replacedBy)));
  }
  for (const event of trail.settlementLog.events) {
    exact(event, ['kind','blockNumber','logIndex']);
    insist(text(event.kind) && uint(event.blockNumber) && uint(event.logIndex));
  }
  strings(trail.notes, 32);
  const json = JSON.stringify(trail, null, 2) + '\n';
  insist(new TextEncoder().encode(json).byteLength <= 2 * 1024 * 1024);
  return Object.freeze({ json, filename: 'erc8415-audit-' + expected.tokenId + '.json',
    semantics: 'Sequential live reads; not an atomic block snapshot, authority, certificate or proof of finality.',
    entries: trail.entries.length, gapsAvailable: trail.settlementLog.available });
}
/** The 512-entry ceiling is an interactive work limit, never a protocol limit. */
export async function readAuditDownload({ wallet, tokenId, guard }) {
  insist(typeof tokenId === 'bigint' && tokenId >= 0n && tokenId < 1n << 256n && typeof guard === 'function');
  guard();
  const reader = wallet.reader;
  const expected = Object.freeze({ chainId: reader.source.chainId.toString(), contract: reader.source.address, tokenId: tokenId.toString() });
  const same = () => { guard(); insist(wallet.reader === reader &&
    reader.source.chainId.toString() === expected.chainId && reader.source.address === expected.contract); };
  await wallet.assetView(tokenId); same(); // Existing conformance and pinned-identity gate before projection reads.
  const count = await reader.entryCount(tokenId); same();
  insist(typeof count === 'bigint' && count > 0n && count <= 512n);
  const trail = await wallet.auditTrail(tokenId); same();
  await wallet.assetView(tokenId); same(); // Recheck the same immutable register/profile after the export.
  const after = await reader.entryCount(tokenId); same();
  insist(after === count && trail.entries?.length === Number(count));
  return encodeAuditDownload(trail, expected);
}

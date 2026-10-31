/** Exact privacy projection decoder; no provider, execution or financial authority. */
const check = ok => { if (!ok) throw Error('FUNDS_RESPONSE_REFUSED'); };
const exact = (v, keys) => v && typeof v === 'object' && !Array.isArray(v) && Object.keys(v).length === keys.length && keys.every(k => Object.hasOwn(v,k));
const uint = v => typeof v === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(v) && BigInt(v) < 1n << 256n;
const hash = v => typeof v === 'string' && /^0x[0-9a-f]{64}$/.test(v) && !/^0x0+$/.test(v);
const id = v => typeof v === 'string' && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,159}$/.test(v);
export function fundsReadId() {
  const bytes = new Uint8Array(16); globalThis.crypto.getRandomValues(bytes);
  return [...bytes].map(v => v.toString(16).padStart(2,'0')).join('');
}
export function validateFunds(value, { scope, readId }, now = Date.now()) {
  check(exact(value,['schema','scope','readId','state','inventoryState','observedAt','validUntil','currencies']) && value.schema === '8415-currency-funds/1');
  check(exact(value.scope,['tenant','origin','account','chainId']) && Object.keys(value.scope).every(k => value.scope[k] === scope[k]) && value.readId === readId);
  check(['complete','partial','stale','unavailable'].includes(value.inventoryState) && ['ready','partial','stale','unavailable'].includes(value.state));
  check(Number.isSafeInteger(value.observedAt) && value.observedAt >= 0 && value.observedAt <= now && Number.isSafeInteger(value.validUntil) && value.validUntil >= value.observedAt);
  check(Array.isArray(value.currencies) && value.currencies.length <= 256);
  const seen = new Set();
  for (const row of value.currencies) {
    check(exact(row,['currency','canExecute','state','reason','totalBaseUnits','unreleasedBaseUnits','availableBaseUnits','nftEscrows','blockHash','principalRecords']) && row.canExecute === false);
    const c = row.currency;
    check(exact(c,['chainId','kind','contract','decimals']) && c.chainId === scope.chainId && uint(c.chainId) && c.chainId !== '0' && Number.isInteger(c.decimals) && c.decimals >= 0 && c.decimals <= 255);
    check(c.kind === 'native' ? c.contract === null : c.kind === 'erc20' && typeof c.contract === 'string' && /^0x[0-9a-f]{40}$/.test(c.contract) && !/^0x0+$/.test(c.contract));
    const key = c.kind+':'+c.contract; check(!seen.has(key)); seen.add(key);
    check(Array.isArray(row.nftEscrows) && row.nftEscrows.length <= 4096);
    check(row.principalRecords === null || Array.isArray(row.principalRecords) && row.principalRecords.length <= 4096);
    if (row.principalRecords !== null) {
      check(value.inventoryState !== 'stale' && value.inventoryState !== 'unavailable');
      check(row.state === 'ready' || row.state === 'unavailable' && row.reason === 'PRINCIPAL_OUTCOME_UNKNOWN' && row.principalRecords.some(r => r.state === 'unknown'));
      const reservations = new Set(), held = new Map(); let commonHash = null;
      for (const record of row.principalRecords) {
        check(exact(record,['reservationId','nftId','amountBaseUnits','state','blockHash']) && id(record.reservationId) && id(record.nftId) && uint(record.amountBaseUnits) && hash(record.blockHash) && ['held','released','refunded','unknown'].includes(record.state));
        check(!reservations.has(record.reservationId)); reservations.add(record.reservationId);
        check(commonHash === null || commonHash === record.blockHash); commonHash = record.blockHash;
        if (row.state === 'ready') check(record.blockHash === row.blockHash && record.state !== 'unknown');
        if (record.state === 'held') held.set(record.nftId,(held.get(record.nftId) ?? 0n)+BigInt(record.amountBaseUnits));
      }
      if (row.state === 'ready') check(held.size === row.nftEscrows.length && row.nftEscrows.every(nft => held.get(nft.nftId) === BigInt(nft.unreleasedBaseUnits)));
    }
    if (row.state === 'ready') {
      check(row.principalRecords !== null);
      check(value.inventoryState !== 'stale' && value.inventoryState !== 'unavailable' && value.validUntil > now);
      check(row.reason === null && hash(row.blockHash) && [row.totalBaseUnits,row.unreleasedBaseUnits,row.availableBaseUnits].every(uint));
      check(BigInt(row.totalBaseUnits) === BigInt(row.unreleasedBaseUnits) + BigInt(row.availableBaseUnits));
      const nfts = new Set(); let sum = 0n;
      for (const nft of row.nftEscrows) {
        check(exact(nft,['nftId','unreleasedBaseUnits']) && id(nft.nftId) && !nfts.has(nft.nftId) && uint(nft.unreleasedBaseUnits));
        nfts.add(nft.nftId); sum += BigInt(nft.unreleasedBaseUnits);
      }
      check(sum === BigInt(row.unreleasedBaseUnits));
    } else {
      check(['loading','stale','unavailable'].includes(row.state) && ['BALANCE_LOADING','BALANCE_STALE','BALANCE_UNAVAILABLE','ESCROW_STALE','ESCROW_UNAVAILABLE','PRINCIPAL_OUTCOME_UNKNOWN'].includes(row.reason));
      check([row.totalBaseUnits,row.unreleasedBaseUnits,row.availableBaseUnits,row.blockHash].every(v => v === null) && row.nftEscrows.length === 0);
    }
  }
  const expected = value.inventoryState === 'complete' ? value.currencies.every(r => r.state === 'ready') ? 'ready' : 'partial' : value.inventoryState;
  check(value.state === expected && (!(value.state === 'ready' || value.state === 'partial') || value.validUntil > now));
  return value;
}

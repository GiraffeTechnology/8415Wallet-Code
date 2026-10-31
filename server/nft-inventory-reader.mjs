/** Bounded read-only RPC verification of server-discovered candidates, never a catalog.
 * Discovery completeness is a separate trusted capability; RPC verification does
 * not turn a partial token list into a complete wallet. No URL is fetched here. */
import { encodeCall } from '../src/codec/abi.ts';
import { exactNftKeys as exact, validateNftRecord } from '../web/nft-inventory-client.mjs';
const check=ok=>{if(!ok)throw Error('NFT_INVENTORY_READER_REFUSED');};
const uint=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<1n<<256n;
const address=v=>typeof v==='string'&&/^0x[0-9a-f]{40}$/.test(v)&&!/^0x0+$/.test(v);
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&!/^0x0+$/.test(v);
const quantity=v=>typeof v==='string'&&/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/.test(v);
const word=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v);
export function createRpcNftInventoryReader({discovery, rpcForPrincipal, detailsReader=null, now=Date.now}) {
 check(discovery&&typeof discovery.listForPrincipal==='function'&&typeof rpcForPrincipal==='function'&&(detailsReader===null||typeof detailsReader.readForPrincipal==='function'));
 const discover=discovery.listForPrincipal.bind(discovery),readDetails=detailsReader===null?null:detailsReader.readForPrincipal.bind(detailsReader);
 return Object.freeze({async readForPrincipal(context){
  const {principal,readId}=context;
  const d=await discover(context);
  check(exact(d,['scope','readId','observedAt','validUntil','inventoryState','blockNumber','blockHash','tokens'])&&exact(d.scope,Object.keys(principal))&&Object.keys(principal).every(k=>d.scope[k]===principal[k])&&d.readId===readId);
  check(['complete','partial','stale','unavailable'].includes(d.inventoryState)&&Number.isSafeInteger(d.observedAt)&&d.observedAt>=0&&d.observedAt<=now()&&Number.isSafeInteger(d.validUntil)&&d.validUntil>=d.observedAt&&quantity(d.blockNumber)&&hash(d.blockHash)&&Array.isArray(d.tokens)&&d.tokens.length<=1024);
  const base={schema:'8415-authoritative-nft-inventory/1',scope:{...principal},readId,observedAt:d.observedAt,validUntil:d.validUntil,inventoryState:d.inventoryState,records:[]};
  if(d.inventoryState==='unavailable'||d.inventoryState==='stale'||d.validUntil<=now())return {...base,inventoryState:d.inventoryState==='unavailable'?'unavailable':'stale'};
  // Snapshot trusted input before async I/O; candidate mutation cannot swap a later call.
  const tokens=structuredClone(d.tokens),blockNumber=d.blockNumber,blockHash=d.blockHash;
  const rpc=await rpcForPrincipal(principal);check(rpc&&typeof rpc.request==='function');
  const request=rpc.request.bind(rpc);
  const read=(method,params)=>request({method,params});
  const verify=async()=>{const chain=await read('eth_chainId',[]);check(quantity(chain)&&BigInt(chain).toString()===principal.chainId);const block=await read('eth_getBlockByNumber',[blockNumber,false]);check(block&&block.number===blockNumber&&block.hash===blockHash);};
  await verify();const seen=new Set();
  for(const t of tokens){
   check(exact(t,['contract','tokenId','standard','metadata'])&&address(t.contract)&&uint(t.tokenId)&&['ERC-721','ERC-1155'].includes(t.standard));
   const key=t.contract+':'+t.tokenId;check(!seen.has(key));seen.add(key);
   const code=await read('eth_getCode',[t.contract,blockNumber]);check(typeof code==='string'&&/^0x(?:[0-9a-f]{2})+$/.test(code));
   const call=(signature,types,values)=>read('eth_call',[{to:t.contract,data:encodeCall(signature,types,values)},blockNumber]);
   const iface=async iid=>{const v=await call('supportsInterface(bytes4)',['bytes4'],[iid]);check(v==='0x'+'0'.repeat(64)||v==='0x'+'0'.repeat(63)+'1');return v.endsWith('1');};
   check(await iface('0x01ffc9a7'));check(!await iface('0xffffffff'));check(await iface(t.standard==='ERC-721'?'0x80ac58cd':'0xd9b67a26'));
   let balanceRaw;
   if(t.standard==='ERC-721') {const owner=await call('ownerOf(uint256)',['uint256'],[BigInt(t.tokenId)]);check(word(owner)&&/^0x0{24}/.test(owner)&&!/^0x0+$/.test(owner));balanceRaw=('0x'+owner.slice(26))===principal.account?'1':'0';}
   else {const balance=await call('balanceOf(address,uint256)',['address','uint256'],[principal.account,BigInt(t.tokenId)]);check(word(balance));balanceRaw=BigInt(balance).toString();}
   if(balanceRaw==='0')continue;
   const native=await iface('0x6309e170');
   const row={chainId:principal.chainId,contract:t.contract,tokenId:t.tokenId,standard:t.standard,balanceRaw,blockNumber,blockHash,metadata:t.metadata,native:{state:native?'unavailable':'not-applicable'},escrow:{state:'unavailable'},pending:{state:'unavailable'}};
   if(detailsReader!==null){
    const asset=Object.freeze({chainId:principal.chainId,contract:t.contract,tokenId:t.tokenId,standard:t.standard});
    const details=await readDetails(Object.freeze({principal,readId,asset,blockNumber,blockHash}));
    check(exact(details,['scope','readId','asset','blockNumber','blockHash','native','escrow','pending'])&&exact(details.scope,Object.keys(principal))&&Object.keys(principal).every(k=>details.scope[k]===principal[k])&&details.readId===readId&&exact(details.asset,Object.keys(asset))&&Object.keys(asset).every(k=>details.asset[k]===asset[k])&&details.blockNumber===blockNumber&&details.blockHash===blockHash);
    check(native ? details.native?.state!=='not-applicable' : details.native?.state==='not-applicable');
    row.native=details.native;row.escrow=details.escrow;row.pending=details.pending;
   }
   validateNftRecord(row,principal.chainId);base.records.push(structuredClone(row));
  }
  await verify();return base;
 }});
}

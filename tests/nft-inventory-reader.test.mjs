/** Synthetic read-only RPC transcript. No real network or chain side effects. */
import test from 'node:test';import assert from 'node:assert/strict';
import { createRpcNftInventoryReader } from '../server/nft-inventory-reader.mjs';
import { encodeCall } from '../src/codec/abi.ts';
const account='0x0000000000000000000000000000000000000001',contract='0x0000000000000000000000000000000000000010',other='0x0000000000000000000000000000000000000002',blockHash='0x'+'1'.repeat(64);
const context={principal:{tenant:'fixture',origin:'https://wallet.example.com',username:'owner',account,chainId:'1'},readId:'a'.repeat(32)};
const metadata={state:'unavailable',name:null,description:null,imageUrl:null};
const bool=b=>'0x'+'0'.repeat(63)+(b?'1':'0');
function fixture(detailsReader=null){
 const state={calls:[],chain:'0x1',owner:account,balance:'9007199254740993',native:false,reorg:false,transform:s=>s};let blockReads=0;
 const discovery={async listForPrincipal(c){return state.transform({scope:{...c.principal},readId:c.readId,observedAt:Date.now()-1,validUntil:Date.now()+60000,inventoryState:'partial',blockNumber:'0x10',blockHash,tokens:[{contract,tokenId:'9007199254740993',standard:'ERC-721',metadata}]});}};
 const reader=createRpcNftInventoryReader({discovery,detailsReader,rpcForPrincipal:async p=>{assert.deepEqual(p,context.principal);return {async request({method,params}){state.calls.push({method,params});
  if(method==='eth_chainId')return state.chain;
  if(method==='eth_getBlockByNumber')return {number:'0x10',hash:state.reorg&&++blockReads>1?'0x'+'2'.repeat(64):blockHash};
  if(method==='eth_getCode')return '0x6000';
  assert.equal(method,'eth_call');assert.equal(params[1],'0x10');const data=params[0].data;
  for(const iid of ['0x01ffc9a7','0xffffffff','0x80ac58cd','0xd9b67a26','0x6309e170'])if(data===encodeCall('supportsInterface(bytes4)',['bytes4'],[iid]))return bool(iid==='0x6309e170'?state.native:iid!=='0xffffffff');
  if(data===encodeCall('ownerOf(uint256)',['uint256'],[9007199254740993n]))return '0x'+'0'.repeat(24)+state.owner.slice(2);
  if(data===encodeCall('balanceOf(address,uint256)',['address','uint256'],[account,9007199254740993n]))return '0x'+BigInt(state.balance).toString(16).padStart(64,'0');
  throw Error('unexpected RPC');
 }};}});return {reader,state};
}
test('trusted discovery is RPC verified at pinned block, without inflating partial completeness',async()=>{
 const f=fixture(),v=await f.reader.readForPrincipal(context);assert.equal(v.inventoryState,'partial');assert.equal(v.records[0].tokenId,'9007199254740993');assert.equal(v.records[0].native.state,'not-applicable');assert.equal(v.records[0].balanceRaw,'1');assert.doesNotMatch(JSON.stringify(v.records),/owner|holder|username/);assert.ok(f.state.calls.every(c=>['eth_chainId','eth_getBlockByNumber','eth_getCode','eth_call'].includes(c.method)));
});
test('non-owned ERC721 is excluded rather than shown as zero holding',async()=>{const f=fixture();f.state.owner=other;assert.deepEqual((await f.reader.readForPrincipal(context)).records,[]);});
test('ERC1155 balance preserves bigint and native parameters remain unavailable when detected',async()=>{
 const f=fixture();f.state.native=true;f.state.transform=s=>({...s,tokens:s.tokens.map(t=>({...t,standard:'ERC-1155'}))});const v=await f.reader.readForPrincipal(context);assert.equal(v.records[0].balanceRaw,'9007199254740993');assert.equal(v.records[0].native.state,'unavailable');
});
test('wrong network, reorg, cross account discovery, duplicates refuse',async()=>{
 for(const mutate of [s=>s.chain='0x2',s=>s.reorg=true,s=>s.transform=d=>({...d,scope:{...d.scope,account:other}}),s=>s.transform=d=>({...d,tokens:[...d.tokens,...d.tokens]})]){const f=fixture();mutate(f.state);await assert.rejects(f.reader.readForPrincipal(context),/NFT_INVENTORY_READER_REFUSED/);}
});
test('stale and unavailable discovery never performs RPC or returns fresh holdings',async()=>{
 for(const inventoryState of ['stale','unavailable']){const f=fixture();f.state.transform=s=>({...s,inventoryState});const v=await f.reader.readForPrincipal(context);assert.equal(v.inventoryState,inventoryState);assert.deepEqual(v.records,[]);assert.equal(f.state.calls.length,0);}
});
test('server-only detail capability correlates exact principal NFT block and nonce before merge',async()=>{
 let contexts=[];const detailsReader={async readForPrincipal(c){contexts.push(c);return {...c,scope:{...c.principal},principal:undefined};}};
 detailsReader.readForPrincipal=async c=>{contexts.push(c);return {scope:{...c.principal},readId:c.readId,asset:{...c.asset},blockNumber:c.blockNumber,blockHash:c.blockHash,native:{state:'not-applicable'},escrow:{state:'ready',inventoryState:'complete',records:[{reservationId:'reservation-one',currency:{chainId:'1',kind:'native',contract:null,decimals:18},amountBaseUnits:'12',state:'held',blockHash:c.blockHash}]},pending:{state:'unavailable'}};};
 const f=fixture(detailsReader);const v=await f.reader.readForPrincipal(context);assert.equal(v.records[0].escrow.records[0].amountBaseUnits,'12');assert.equal(contexts[0].asset.tokenId,'9007199254740993');assert.equal(contexts[0].principal.account,account);
 const valid=detailsReader.readForPrincipal;for(const corrupt of [d=>d.asset.tokenId='42',d=>d.scope.account=other,d=>d.blockHash='0x'+'3'.repeat(64),d=>d.readId='b'.repeat(32)]){detailsReader.readForPrincipal=async c=>{const d=await valid(c);corrupt(d);return d;};await assert.rejects(fixture(detailsReader).reader.readForPrincipal(context),/NFT_INVENTORY_READER_REFUSED/);}
});
test('configured discovery and detail capabilities cannot be replaced by mutating object methods',async()=>{
 const discovery={async listForPrincipal(c){return {scope:{...c.principal},readId:c.readId,observedAt:Date.now()-1,validUntil:Date.now()+1000,inventoryState:'unavailable',blockNumber:'0x10',blockHash,tokens:[]};}};
 const reader=createRpcNftInventoryReader({discovery,rpcForPrincipal:async()=>{throw Error('must not run');}});
 discovery.listForPrincipal=async()=>{throw Error('replaced');};assert.equal((await reader.readForPrincipal(context)).inventoryState,'unavailable');
});

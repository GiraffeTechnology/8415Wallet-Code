import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
const walletRequire = createRequire(import.meta.url);
const root = dirname(walletRequire.resolve('@artfi/task-listing-runtime/package.json'));
const require = createRequire(join(root, 'server.mjs'));
const ethers = require('ethers');
const { SeaportABI } = require('@opensea/seaport-js/lib/abi/Seaport');
const { EIP_712_ORDER_TYPE } = require('@opensea/seaport-js/lib/constants');
const { NFT_SALE_NATIVE_POLICY } = await import(pathToFileURL(join(root,'dist/scripts/agent/nft-sale-evidence.mjs')));
const hex = v => `0x${BigInt(v).toString(16)}`, hash = c => `0x${c.repeat(64)}`;
const zeroHash = hash('0'), buyer = `0x${'4'.repeat(40)}`, zero = `0x${'0'.repeat(40)}`;
const iface = new ethers.Interface(SeaportABI);
const tokenIface = new ethers.Interface(['event TransferSingle(address indexed operator,address indexed from,address indexed to,uint256 id,uint256 value)', 'event Transfer(address indexed from,address indexed to,uint256 indexed tokenId)']);
const runtimeCode = '0x6000600055';
export function createFillProvider(now) {
  const state = { order: null, fills: [], calls: [], head: 105, duplicates: false, reorg: false, offline: false };
  function block(n) { return { number: hex(n), hash: n === 100 ? hash(state.reorg ? 'c' : 'b') : ethers.keccak256(ethers.toUtf8Bytes(`synthetic-${n}`)), timestamp: hex(Math.floor(now()/1000)) }; }
  const rawLog = l => ({ ...l, chainId: hex(l.chainId), blockNumber: hex(l.blockNumber), logIndex: hex(l.index) });
  const reader = { sourceId: 'synthetic-receipt-reader', async request(req) {
    state.calls.push(structuredClone(req)); if (state.offline) throw Error('SYNTHETIC_READ_OFFLINE');
    const [arg] = req.params ?? []; let result;
    switch(req.method) {
      case 'eth_chainId': result = '0x1'; break;
      case 'eth_getBlockByNumber': result = block(arg === 'latest' ? state.head : Number(BigInt(arg))); break;
      case 'eth_getLogs': result = state.fills.flatMap(f=>f.receipt.logs.slice(0,1)).filter(l=>l.blockNumber>=Number(BigInt(arg.fromBlock))&&l.blockNumber<=Number(BigInt(arg.toBlock))).map(rawLog); if(state.duplicates) result=[...result,...result]; break;
      case 'eth_getTransactionByHash': { const t=state.fills.find(f=>f.transaction.hash===arg)?.transaction; result=t?{...t,chainId:hex(t.chainId),blockNumber:hex(t.blockNumber),nonce:hex(t.nonce),value:hex(t.value),input:t.data}:null; break; }
      case 'eth_getTransactionReceipt': { const r=state.fills.find(f=>f.receipt.transactionHash===arg)?.receipt; result=r?{...r,chainId:hex(r.chainId),blockNumber:hex(r.blockNumber),status:hex(r.status),logs:r.logs.map(rawLog)}:null; break; }
      case 'eth_getCode': result=runtimeCode; break;
      default: throw Error(`REAL OR WRITE RPC FORBIDDEN: ${req.method}`);
    }
    return structuredClone(result);
  }};
  function addFill(order) {
    state.order=structuredClone(order);
    const p=order.components, parameters={...p,totalOriginalConsiderationItems:p.consideration.length},txHash=hash('a'),blockHash=hash('b');
    const context={chainId:'1',transactionHash:txHash,blockHash,blockNumber:100,removed:false};
    const log=(abi,name,address,args,index)=>({...context,...abi.encodeEventLog(abi.getEvent(name),args),address,index});
    const item=(i,cons)=>[i.itemType,i.token,i.identifierOrCriteria,i.startAmount,...(cons?[i.recipient]:[])];
    const sale=log(iface,'OrderFulfilled',order.protocol,[order.binding.orderHash,order.seller,zero,buyer,p.offer.map(i=>item(i,false)),p.consideration.map(i=>item(i,true))],0);
    const transfer=order.nft.standard==='erc1155'?log(tokenIface,'TransferSingle',order.nft.contract,[order.protocol,order.seller,buyer,order.nft.tokenId,order.nft.quantity],1):log(tokenIface,'Transfer',order.nft.contract,[order.seller,buyer,order.nft.tokenId],1);
    const transaction={chainId:'1',hash:txHash,blockHash,blockNumber:100,from:buyer,to:order.protocol,data:iface.encodeFunctionData('fulfillOrder',[{parameters,signature:'0x'},zeroHash]),value:order.amounts.gross,nonce:17};
    const receipt={transactionHash:txHash,chainId:'1',from:buyer,to:order.protocol,blockHash,blockNumber:100,status:1,logs:[sale,transfer]};state.fills.push({transaction,receipt});
  }
  const dependencies={ ethers, orderTypes:EIP_712_ORDER_TYPE, seaportABI:SeaportABI, readOnlyProvider:reader,
    policyId:'synthetic-listing-observation', allowedDeployments:[{chainId:'1',address:'0x0000000000000068F116a894984e2DB1123eB395',runtimeCodeHash:ethers.keccak256(runtimeCode),proxyOrUpgradeAllowed:false,reviewEvidenceSha256:'1'.repeat(64),nativeConsiderationPolicy:NFT_SALE_NATIVE_POLICY}],
    scanPolicy:{fromBlock:100,throughBlock:103,blocksPerPage:2,maxPagesPerRun:2,maxLogsPerPage:20,maxCandidatesPerRun:20}};
  return {state,reader,dependencies,addFill};
}

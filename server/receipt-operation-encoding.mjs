/** Fixed ArtFi receipt encoding only. Never a generic RPC/call adapter. */
import { Interface, AbiCoder, TypedDataEncoder, keccak256 } from 'ethers';
import { receiptTaskCopy, receiptPhaseScope } from '../src/agent/receiptTask.ts';
const saleTuple='(address seller,address collection,uint256 tokenId,address paymentToken,uint256 price,address buyer,uint256 salt,uint48 startsAt,uint48 endsAt,uint256 epoch)';
const correspondenceTuple='(bytes32 settlementId,bytes32 assetRecordHash,bytes32 oracleSourceId,bytes32 requestHash,bytes32 executionReferenceHash,bytes32 previousSegment,bytes32 oldCertificateHash,bytes32 warehouseReceiptHash)';
const abi=new Interface(['function fund('+saleTuple+' sale,'+correspondenceTuple+' correspondence,bytes signature)',
  'function confirmRegistration(bytes32 id,bytes evidence)','function paySeller(bytes32 id)']);
const coder=AbiCoder.defaultAbiCoder();
const saleFields=[['seller','address'],['collection','address'],['tokenId','uint256'],['paymentToken','address'],['price','uint256'],['buyer','address'],['salt','uint256'],['startsAt','uint48'],['endsAt','uint48'],['epoch','uint256']].map(([name,type])=>({name,type}));
const correspondenceFields=['settlementId','assetRecordHash','oracleSourceId','requestHash','executionReferenceHash','previousSegment','oldCertificateHash','warehouseReceiptHash'];
const outerFields=[{name:'saleIntentHash',type:'bytes32'},...correspondenceFields.map(name=>({name,type:'bytes32'}))];
const fail=()=>{throw Error('TASK_RECEIPT_WIRE_REFUSED');};
export function validateReceiptWire(input,phase,wire,contentContext=null) {
  const task=receiptTaskCopy(input,contentContext),slot=receiptPhaseScope(task,phase,contentContext),p=task.policy,s=p.intent;
  if(!wire || Object.getPrototypeOf(wire)!==Object.prototype || Reflect.ownKeys(wire).length!==9 ||
    !['account','chainId','to','data','value','nonce','gasLimit','maxFeePerGasWei','maxPriorityFeePerGasWei'].every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(wire,k)??{},'value')))fail();
  if(wire.account!==p.actor || wire.chainId!==p.chainId || wire.to!==s.escrow || wire.value!=='0' ||
    wire.nonce!==slot.nonce || wire.gasLimit!==slot.gasLimit || wire.maxFeePerGasWei!==slot.maxFeePerGasWei ||
    wire.maxPriorityFeePerGasWei!==slot.maxPriorityFeePerGasWei || typeof wire.data!=='string' ||
    !/^0x(?:[0-9a-fA-F]{2}){4,16384}$/.test(wire.data) || keccak256(wire.data)!==slot.calldataHash)fail();
  const expectedSegment=TypedDataEncoder.hash({name:'ArtFi Whole Artwork Receipt Settlement',version:'1',
    chainId:p.chainId,verifyingContract:s.escrow},{ReceiptAuthorization:outerFields},{
      saleIntentHash:TypedDataEncoder.hashStruct('SaleIntent',{SaleIntent:saleFields},s.sale),...s.correspondence});
  if(expectedSegment!==s.segmentId)fail();
  const decoded=abi.parseTransaction({data:wire.data});
  if(!decoded)fail();
  const name={funded:'fund',registered:'confirmRegistration',paid:'paySeller'}[phase];
  if(decoded.name!==name)fail();
  let expected;
  if(phase==='funded')expected=abi.encodeFunctionData(name,[s.sale,s.correspondence,decoded.args[2]]);
  else if(phase==='registered'){
    const [, ,version,proof]=coder.decode([saleTuple,correspondenceTuple,'uint64','bytes'],decoded.args[1]);
    if(version<2n || !/^0x(?:[0-9a-fA-F]{2}){1,4096}$/.test(proof))fail();
    expected=abi.encodeFunctionData(name,[s.segmentId,coder.encode([saleTuple,correspondenceTuple,'uint64','bytes'],[s.sale,s.correspondence,version,proof])]);
  }else expected=abi.encodeFunctionData(name,[s.segmentId]);
  if(expected!==wire.data.toLowerCase())fail();
  if(phase==='funded' && !/^0x(?:[0-9a-fA-F]{2}){1,4096}$/.test(decoded.args[2]))fail();
  return Object.freeze(structuredClone({phase,nonce:slot.nonce,planDigest:slot.planDigest,journalBindingHash:slot.journalBindingHash,
    actor:p.actor,chainId:p.chainId,escrow:s.escrow,runtimeCodeHash:s.runtimeCodeHash,segmentId:s.segmentId,
    maximumFeeWei:(BigInt(slot.gasLimit)*BigInt(slot.maxFeePerGasWei)).toString()}));
}

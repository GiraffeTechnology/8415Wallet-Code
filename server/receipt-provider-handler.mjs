/** Installation-only fixed receipt provider composition. No default signer or HTTP route. */
import { keccak256 } from 'ethers';
import { receiptTaskCopy, receiptPhaseScope } from '../src/agent/receiptTask.ts';
const refuse=()=>{throw Error('TASK_RECEIPT_PROVIDER_REFUSED');};
function codeSnapshot(raw){
  if(!raw||![Object.prototype,null].includes(Object.getPrototypeOf(raw)))refuse();
  const fields=Object.getOwnPropertyDescriptors(raw),hash=fields.hash,number=fields.number;
  if(!Object.hasOwn(hash??{},'value')||!Object.hasOwn(number??{},'value')||
    typeof hash.value!=='string'||!/^0x[0-9a-f]{64}$/i.test(hash.value)||/^0x0+$/i.test(hash.value)||
    typeof number.value!=='string'||!/^0x(?:0|[1-9a-f][0-9a-f]{0,63})$/i.test(number.value))refuse();
  return Object.freeze({hash:hash.value.toLowerCase(),number:number.value.toLowerCase()});
}
export function createReceiptProviderHandler({authorization,provider,task,claimed,now=Date.now}){
  if(typeof authorization?.withAuthorization!=='function'||typeof provider?.request!=='function'||typeof now!=='function')refuse();
  const frozen=receiptTaskCopy(task),binding=Object.freeze(structuredClone(claimed)),slot=receiptPhaseScope(frozen,binding.phase);
  const p=frozen.policy,request=provider.request.bind(provider),authorize=authorization.withAuthorization.bind(authorization);
  if(binding.taskDigest!==frozen.digest||binding.taskId!==p.taskId||binding.planDigest!==slot.planDigest||
    binding.journalBindingHash!==slot.journalBindingHash)refuse();
  const same=(x,y)=>typeof x==='string'&&x.toLowerCase()===y;
  const identity=async()=>{
    const accounts=await request({method:'eth_accounts'}),chain=await request({method:'eth_chainId'});
    if(!Array.isArray(accounts)||!same(accounts[0],p.actor)||typeof chain!=='string'||!/^0x[0-9a-f]+$/i.test(chain)||
      BigInt(chain)!==BigInt(p.chainId))refuse();
    return Object.freeze({account:p.actor,chainId:Number(p.chainId)});
  };
  return Object.freeze({
    identity,
    async sendTransaction(input){
      if(!input||Object.getPrototypeOf(input)!==Object.prototype||Reflect.ownKeys(input).length!==5||
        !['account','chainId','to','data','value'].every(k=>Object.hasOwn(Object.getOwnPropertyDescriptor(input,k)??{},'value')))refuse();
      const selected=structuredClone(input);
      if(!same(selected.account,p.actor)||selected.chainId!==Number(p.chainId)||!same(selected.to,p.intent.escrow)||selected.value!==0n)refuse();
      const wire=Object.freeze({account:p.actor,chainId:p.chainId,to:p.intent.escrow,data:selected.data,value:'0',
        nonce:slot.nonce,gasLimit:slot.gasLimit,maxFeePerGasWei:slot.maxFeePerGasWei,maxPriorityFeePerGasWei:slot.maxPriorityFeePerGasWei});
      const result=await authorize(binding,wire,async(snapshot,revalidate)=>{
        const current=()=>{revalidate();if(!Number.isSafeInteger(now())||now()>=snapshot.expiresAtMs)refuse();};
        current();await identity();current();
        // Bind the original provider's actual EVM bytes to one canonical block.
        // No latest-tag fallback or independent provider/source is substituted.
        const at=codeSnapshot(await request({method:'eth_getBlockByNumber',params:['latest',false]}));current();
        const code=await request({method:'eth_getCode',params:[p.intent.escrow,{blockHash:at.hash,requireCanonical:true}]});current();
        if(typeof code!=='string'||!/^0x(?:[0-9a-f]{2})+$/i.test(code)||keccak256(code)!==p.intent.runtimeCodeHash)refuse();
        const after=codeSnapshot(await request({method:'eth_getBlockByNumber',params:[at.number,false]}));current();
        if(after.hash!==at.hash||after.number!==at.number)refuse();
        await identity();current();
        const nonce=await request({method:'eth_getTransactionCount',params:[p.actor,'pending']});current();
        if(typeof nonce!=='string'||!/^0x[0-9a-f]+$/i.test(nonce)||BigInt(nonce)!==BigInt(slot.nonce))refuse();
        const tx=Object.freeze({from:p.actor,to:p.intent.escrow,data:wire.data,value:'0x0',chainId:'0x'+BigInt(p.chainId).toString(16),
          nonce:'0x'+BigInt(slot.nonce).toString(16),type:'0x2',gas:'0x'+BigInt(slot.gasLimit).toString(16),
          maxFeePerGas:'0x'+BigInt(slot.maxFeePerGasWei).toString(16),maxPriorityFeePerGas:'0x'+BigInt(slot.maxPriorityFeePerGasWei).toString(16)});
        const simulated=await request({method:'eth_call',params:[tx,'pending']});current();
        if(typeof simulated!=='string'||!/^0x(?:[0-9a-f]{2})*$/i.test(simulated))refuse();
        // The provider's personal signing/confirmation surface remains intact.
        await identity();current();
        const latestNonce=await request({method:'eth_getTransactionCount',params:[p.actor,'pending']});current();
        if(typeof latestNonce!=='string'||!/^0x[0-9a-f]+$/i.test(latestNonce)||BigInt(latestNonce)!==BigInt(slot.nonce))refuse();
        const hash=await request({method:'eth_sendTransaction',params:[tx]});
        if(typeof hash!=='string'||!/^0x[0-9a-f]{64}$/i.test(hash)||/^0x0+$/i.test(hash))refuse();
        return hash.toLowerCase();
      });
      return result.transactionHash;
    }
  });
}

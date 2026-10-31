import test from 'node:test';import assert from 'node:assert/strict';import {validateNftDetails} from '../web/nft-details-client.mjs';
const h=n=>'0x'+String(n).repeat(64),asset={chainId:'1',contract:'0x'+'a'.repeat(40),tokenId:'1'};
function row(){const track={state:'observed',position:'1',changedThrough:'1',unchangedThrough:'2',untradedThrough:'3',ratio:{numerator:'1',denominator:'3'}};
 return {...asset,standard:'ERC-721',blockNumber:'0x2',blockHash:h(2),native:{state:'unavailable'},escrow:{state:'unavailable'},pending:{state:'ready',progress:{schema:'8415-forward-progress/2',asset,sequenceId:h(3),userPosition:'1',sourceRevision:'1',blockNumber:'1',blockHash:h(1),knownEnd:'2',scaleEnd:'3',state:'DONE',owner:{...track},holder:{...track},protocolFinality:false,commercialExecution:'not-evaluated',canExecute:false,recordRevision:'1',frozen:true,coordination:{blockNumber:'2',blockHash:h(2),sourceRevision:'2',knownEnd:'2',scaleEnd:'3'},funds:{state:'unknown',legs:[]},rollback:{state:'unknown',tokenState:'unknown',fundsState:'unknown',boundaryPosition:null,nftPosition:null,holderPosition:null,fundsPosition:null,frozen:false}}}};
}
test('NFT /2 compares live coordination anchor independently from frozen forward milestone',()=>{
 const value=row();assert.equal(validateNftDetails(value),value);const bad=structuredClone(value);bad.pending.progress.coordination.blockHash=h(4);assert.throws(()=>validateNftDetails(bad),/NFT_DETAILS_REFUSED/);
 const future=structuredClone(value);future.pending.progress.coordination.blockNumber='3';assert.throws(()=>validateNftDetails(future),/NFT_DETAILS_REFUSED/);
});
test('NFT permits a validated historical frozen coordinated return but never future anchor',()=>{
 const value=row(),p=value.pending.progress;p.coordination={...p.coordination,blockNumber:'1',blockHash:h(1)};p.rollback={state:'DONE',tokenState:'returned',fundsState:'not-required',boundaryPosition:'0',nftPosition:'0',holderPosition:'0',fundsPosition:null,frozen:true};assert.equal(validateNftDetails(value),value);
 p.coordination.blockNumber='3';assert.throws(()=>validateNftDetails(value),/NFT_DETAILS_REFUSED/);
});

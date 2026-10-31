/** Pure versioned read DTO decoder. No controller, RPC, signer or execution imports. */
const uint=v=>typeof v==='string'&&/^(0|[1-9][0-9]{0,77})$/.test(v)&&BigInt(v)<1n<<256n;
const hash=v=>typeof v==='string'&&/^0x[0-9a-f]{64}$/.test(v)&&!/^0x0+$/.test(v);
const refuse=ok=>{if(!ok)throw Error('COORDINATION_RESPONSE_REFUSED');};
const exact=(v,keys)=>{refuse(v!==null&&typeof v==='object'&&!Array.isArray(v));const d=Object.getOwnPropertyDescriptors(v);refuse(Reflect.ownKeys(d).length===keys.length&&keys.every(k=>d[k]&&Object.hasOwn(d[k],'value')));};
export function validateCoordinationView(v,userPosition){
 exact(v,['coordination','funds','rollback']);
 const c=v.coordination,f=v.funds,r=v.rollback;
 exact(c,['blockNumber','blockHash','sourceRevision','knownEnd','scaleEnd']);
 refuse([c.blockNumber,c.sourceRevision,c.knownEnd,c.scaleEnd,userPosition].every(uint)&&hash(c.blockHash)&&BigInt(c.scaleEnd)===BigInt(c.knownEnd)+1n&&BigInt(userPosition)<=BigInt(c.knownEnd));
 const pos=x=>x===null||uint(x)&&BigInt(x)<=BigInt(c.knownEnd);
 exact(f,['state','legs']);refuse(['unknown','observed'].includes(f.state)&&Array.isArray(f.legs)&&f.legs.length<=2&&(f.state!=='unknown'||f.legs.length===0));
 const roles=new Set();for(const l of f.legs){exact(l,['role','position','state','amountBaseUnits','locationPosition']);
  refuse(['incoming','outgoing'].includes(l.role)&&!roles.has(l.role));roles.add(l.role);
  refuse(uint(l.position)&&BigInt(l.position)>0n&&BigInt(l.position)<=BigInt(c.knownEnd)&&BigInt(l.position)===BigInt(userPosition)+(l.role==='outgoing'?1n:0n)&&uint(l.amountBaseUnits)&&pos(l.locationPosition));
  refuse(['unfunded','funded','settlement-due','refund-due','settled','refunded','reserved'].includes(l.state));
  const expected=l.state==='settled'?(BigInt(l.position)-1n).toString():l.state==='refunded'?l.position:null;
  refuse(l.locationPosition===expected&&(l.state==='unfunded'?l.amountBaseUnits==='0':BigInt(l.amountBaseUnits)>0n));
 }
 exact(r,['state','tokenState','fundsState','boundaryPosition','nftPosition','holderPosition','fundsPosition','frozen']);
 refuse(['unknown','not-applicable','PENDING','DONE'].includes(r.state)&&['unknown','not-applicable','returning','returned'].includes(r.tokenState)&&['unknown','not-applicable','pending','returned','not-required'].includes(r.fundsState)&&[r.boundaryPosition,r.nftPosition,r.holderPosition,r.fundsPosition].every(pos)&&typeof r.frozen==='boolean');
 if(r.state==='unknown'||r.state==='not-applicable')refuse(r.tokenState===r.state&&r.fundsState===r.state&&r.boundaryPosition===null&&r.nftPosition===null&&r.holderPosition===null&&r.fundsPosition===null&&!r.frozen);
 else{refuse(r.boundaryPosition!==null&&BigInt(r.boundaryPosition)<=BigInt(userPosition)&&['returning','returned','unknown'].includes(r.tokenState)&&['pending','returned','not-required','unknown'].includes(r.fundsState));
  const done=r.tokenState==='returned'&&r.holderPosition===r.boundaryPosition&&['returned','not-required'].includes(r.fundsState);
  refuse((r.state==='DONE')===done&&r.frozen===done&&(!done||r.nftPosition===r.boundaryPosition)&&r.fundsPosition===null);
 }
 return v;
}

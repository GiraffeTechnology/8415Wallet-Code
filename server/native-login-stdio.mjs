import {validateNativeLoginChallenge} from '../web/native-login-challenge.mjs';
const refuse=()=>{throw Error('NATIVE_LOGIN_STDIO_INPUT_REFUSED');};
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
function strictJson(bytes){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 const parsed=JSON.parse(text); // Validate grammar first; walk tokens to reject duplicate keys.
 let i=0;
 const ws=()=>{while(/\s/.test(text[i]??'')&&i<text.length)i++;};
 const string=()=>{const start=i++;while(i<text.length){const c=text[i++];if(c==='\\'){i++;continue;}if(c==='"')return JSON.parse(text.slice(start,i));}throw Error('NATIVE_LOGIN_STDIO_INPUT_REFUSED');};
 const value=depth=>{
  if(depth>32)throw Error('NATIVE_LOGIN_STDIO_INPUT_REFUSED');ws();
  if(text[i]==='"'){string();return;}
  if(text[i]==='{'){
   i++;ws();const keys=new Set();if(text[i]==='}'){i++;return;}
   while(true){ws();const key=string();if(keys.has(key))throw Error('NATIVE_LOGIN_STDIO_INPUT_REFUSED');keys.add(key);ws();i++;value(depth+1);ws();if(text[i++]==='}')return;}
  }
  if(text[i]==='['){i++;ws();if(text[i]===']'){i++;return;}while(true){value(depth+1);ws();if(text[i++]===']')return;}}
  while(i<text.length&&!/[\s,}\]]/.test(text[i]))i++;
 };
 value(0);ws();if(i!==text.length)throw Error('NATIVE_LOGIN_STDIO_INPUT_REFUSED');return parsed;
}

/** Installation owns bindings and bridgeFactory. Neither is read from stdin.
 * Validate the complete request before constructing custody or reading any key. */
export function createNativeLoginStdioHandler({bindings,bridgeFactory=null,now=Date.now}){
 if(!Array.isArray(bindings)||bindings.length<1||bindings.length>256||typeof now!=='function'||(bridgeFactory!==null&&typeof bridgeFactory!=='function'))refuse();
 const fixed=bindings.map(b=>{if(!b||typeof b!=='object')refuse();return Object.freeze({...b,loginEntry:b.loginEntry?Object.freeze({...b.loginEntry}):null});});
 const ids=fixed.map(b=>JSON.stringify([b.origin,b.tenant,b.account,b.chainId]));if(new Set(ids).size!==ids.length)refuse();
 const bridges=new Map();
 return async function handle(bytes,{signal}={}){
  if(signal?.aborted||!(typeof bytes==='string'||Buffer.isBuffer(bytes))||Buffer.byteLength(bytes)>16384)refuse();
  let request;try{request=strictJson(Buffer.from(bytes));}catch{refuse();}
  if(!exact(request,['schema','challenge'])||request.schema!=='8415wallet-native-login-request/1')refuse();
  const c=request.challenge;if(!exact(c,['origin','tenant','account','chainId','nonce','issuedAt','expiresAt','id','method','message']))refuse();
  const index=fixed.findIndex(b=>b.origin===c.origin&&b.tenant===c.tenant&&b.account===c.account&&b.chainId===c.chainId);if(index<0)refuse();
  const binding=fixed[index];
  await validateNativeLoginChallenge(c,{origin:binding.origin,tenant:binding.tenant,account:binding.account,chainId:binding.chainId,loginEntry:binding.loginEntry,requestedContext:binding.loginEntry,now});
  if(signal?.aborted)refuse();
  // Retain one bridge per installation binding: repeats cannot recreate a signer.
  if(!bridges.has(index)){const factory=bridgeFactory??(await import('./native-wallet-login.mjs')).createNativeLoginCustodyBridge;
   bridges.set(index,Promise.resolve().then(()=>factory({...binding,now})));}
  const bridge=await bridges.get(index);if(signal?.aborted)refuse();
  const proof=await bridge.handle(request,{signal});
  if(!exact(proof,['schema','requestId','signature'])||proof.schema!=='8415wallet-native-login-proof/1'||proof.requestId!==c.id||typeof proof.signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(proof.signature))refuse();
  if(signal?.aborted)refuse();return JSON.stringify(proof)+'\n';
 };
}
/** One bounded EOF-delimited request per process. No commands, paths or config
 * arrive over stdin. Deployment supplies and authenticates the fixed caller. */
export async function runNativeLoginStdio({bindings,input,output,bridgeFactory=null,now=Date.now,readTimeoutMs=5000,signal}){
 if(!input||typeof input[Symbol.asyncIterator]!=='function'||typeof output!=='function'||!Number.isSafeInteger(readTimeoutMs)||readTimeoutMs<1||readTimeoutMs>30000)refuse();
 const handle=createNativeLoginStdioHandler({bindings,bridgeFactory,now});let timer,total=0;const chunks=[];
 const read=async()=>{for await(const chunk of input){if(!(typeof chunk==='string'||Buffer.isBuffer(chunk)))refuse();const b=Buffer.from(chunk);total+=b.length;if(total>16384||signal?.aborted)refuse();chunks.push(b);}return Buffer.concat(chunks);};
 try{const bytes=await Promise.race([read(),new Promise((_,reject)=>{timer=setTimeout(()=>{input.destroy?.();reject(Error('NATIVE_LOGIN_STDIO_READ_TIMEOUT'));},readTimeoutMs);})]);
  const proof=await handle(bytes,{signal});await output(proof);
 }catch(error){input.destroy?.();throw error;}finally{clearTimeout(timer);}
}

/** Generic consumer adapter. Installation provides one fixed exchange capability;
 * no command, host, credentials or custody path can be supplied by a challenge. */
export function createNativeLoginProofSigner({origin,tenant,account,chainId,loginEntry=null,exchange,now=Date.now}){
 if(typeof exchange!=='function'||typeof now!=='function')refuse();
 const entry=loginEntry===null?null:Object.freeze({...loginEntry}),used=new Map();
 return Object.freeze({schema:'8415wallet-native-login-signer/1',account,chainId,
  async signLoginChallenge(challenge,{signal,requestedContext=null}={}){
   if(signal?.aborted)refuse();
   await validateNativeLoginChallenge(challenge,{origin,tenant,account,chainId,loginEntry:entry,requestedContext,now});
   const time=now();for(const [id,expiry] of used)if(time>=expiry)used.delete(id);
   const id=JSON.stringify([challenge.id,challenge.nonce]);if(used.size>=10000||used.has(id)||signal?.aborted)refuse();
   used.set(id,challenge.expiresAt);
   const request=JSON.stringify({schema:'8415wallet-native-login-request/1',challenge})+'\n';
   let response;try{response=await exchange(request,{signal});}catch{throw Error('NATIVE_LOGIN_STDIO_EXCHANGE_UNRESOLVED');}
   if(signal?.aborted||!(typeof response==='string'||Buffer.isBuffer(response))||Buffer.byteLength(response)>4096)refuse();
   let proof;try{proof=strictJson(Buffer.from(response));}catch{refuse();}
   if(!exact(proof,['schema','requestId','signature'])||proof.schema!=='8415wallet-native-login-proof/1'||proof.requestId!==challenge.id||typeof proof.signature!=='string'||!/^0x[0-9a-fA-F]{130}$/.test(proof.signature))refuse();
   await validateNativeLoginChallenge(challenge,{origin,tenant,account,chainId,loginEntry:entry,requestedContext,now});
   const {verifyMessage}=await import('ethers');let recovered;try{recovered=verifyMessage(challenge.message,proof.signature);}catch{refuse();}
   if(recovered.toLowerCase()!==account.toLowerCase()||signal?.aborted)refuse();
   return Object.freeze({signature:proof.signature});
  }
 });
}

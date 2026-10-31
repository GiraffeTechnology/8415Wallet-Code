/** Shared exact login-message contract for original local custody and native API.
 * No key loading, signing, network, transaction authority or helper selection. */
import {loginMessage,loginOrigin} from './login-core.mjs';
import {loginIdentifier,walletPath} from './wallet-entry.mjs';
const fail=code=>{throw Error(code);},check=(v,code='NATIVE_LOGIN_CHALLENGE_REFUSED')=>{if(!v)fail(code);};
function exact(v,keys){check(v && typeof v==='object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v)));
 const d=Object.getOwnPropertyDescriptors(v);check(Reflect.ownKeys(d).length===keys.length && keys.every(k=>d[k] && Object.hasOwn(d[k],'value') && d[k].enumerable));}
export async function validateNativeLoginChallenge(challenge,{origin,tenant,account,chainId,loginEntry=null,requestedContext=null,now=Date.now,crypto=globalThis.crypto}){
 loginOrigin(origin);check(typeof tenant==='string' && /^[a-z][a-z0-9-]{0,47}$/.test(tenant) &&
  typeof account==='string' && /^0x[0-9a-fA-F]{40}$/.test(account) && !/^0x0+$/i.test(account) &&
  typeof chainId==='string' && /^[1-9][0-9]{0,77}$/.test(chainId) && BigInt(chainId)<1n<<256n,'NATIVE_LOGIN_CONFIG_REFUSED');
 let entry=null;if(loginEntry!==null){exact(loginEntry,['identifier','requestedWalletPath']);
  check(loginIdentifier(loginEntry.identifier)===loginEntry.identifier && (loginEntry.requestedWalletPath===null || walletPath(loginEntry.requestedWalletPath)===loginEntry.requestedWalletPath),'NATIVE_LOGIN_CONFIG_REFUSED');entry={...loginEntry};}
 check(JSON.stringify(requestedContext)===JSON.stringify(entry),'NATIVE_LOGIN_REQUESTED_CONTEXT_REFUSED');
 exact(challenge,['origin','tenant','account','chainId','nonce','issuedAt','expiresAt','id','method','message']);
 check(challenge.origin===origin && challenge.tenant===tenant && challenge.account===account && challenge.chainId===chainId && challenge.method==='wallet');
 check(typeof challenge.id==='string' && /^[A-Za-z0-9_-]{43}$/.test(challenge.id) && typeof challenge.nonce==='string' && /^[A-Za-z0-9]{8,64}$/.test(challenge.nonce) &&
  Number.isSafeInteger(challenge.issuedAt) && Number.isSafeInteger(challenge.expiresAt) && challenge.issuedAt>=0 && challenge.expiresAt>challenge.issuedAt && challenge.expiresAt-challenge.issuedAt<=120000);
 let message=loginMessage(challenge)+`\nResources:\n- urn:8415wallet:tenant:${tenant}\n- urn:8415wallet:purpose:login\n- urn:8415wallet:request:${challenge.id}`;
 if(entry!==null){check(typeof crypto?.subtle?.digest==='function','NATIVE_LOGIN_CRYPTO_REQUIRED');
  const digest=await crypto.subtle.digest('SHA-256',new TextEncoder().encode(JSON.stringify([entry.identifier,entry.requestedWalletPath])));
  message+='\nRequested wallet context: '+Array.from(new Uint8Array(digest),b=>b.toString(16).padStart(2,'0')).join('');}
 check(challenge.message===message);const time=now();check(Number.isSafeInteger(time) && time>=challenge.issuedAt && time<challenge.expiresAt,'NATIVE_LOGIN_EXPIRED');
 return Object.freeze({message,requestId:challenge.id,expiresAt:challenge.expiresAt});
}

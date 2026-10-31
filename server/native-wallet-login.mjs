import { validateNativeLoginChallenge } from '../web/native-login-challenge.mjs';
import { loginIdentifier,walletPath } from '../web/wallet-entry.mjs';
import { open,realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { resolve } from 'node:path';
import { AccountAuthClient } from '../web/account-auth.mjs';
import { tenantBasePath } from '../web/tenant-path.mjs';
/** Product-native login signing, distinct from transaction signing. Composition
 * receives the existing custody account capability; no key/path/import/export API.
 * No public signing endpoint and no arbitrary message or transaction RPC. */
import { Wallet,getAddress,verifyMessage } from 'ethers';
import { loginMessage,loginOrigin } from '../web/login-core.mjs';
const fail=code=>{throw Error(code);};
const check=(ok,code='NATIVE_LOGIN_CHALLENGE_REFUSED')=>{if(!ok)fail(code);};
function exact(v,keys){
 check(v && typeof v==='object' && !Array.isArray(v) && [Object.prototype,null].includes(Object.getPrototypeOf(v)));
 const d=Object.getOwnPropertyDescriptors(v);
 check(Reflect.ownKeys(d).length===keys.length && keys.every(k=>d[k] && Object.hasOwn(d[k],'value') && d[k].enumerable));
}
export function createNativeWalletLoginSigner({origin,tenant,account,chainId,custodyAccount,now=Date.now,loginEntry=null}){
 loginOrigin(origin);
 check(typeof tenant==='string' && /^[a-z][a-z0-9-]{0,47}$/.test(tenant) &&
  typeof chainId==='string' && /^[1-9][0-9]{0,77}$/.test(chainId) && BigInt(chainId)<1n<<256n &&
  typeof custodyAccount?.signMessage==='function' && typeof now==='function','NATIVE_LOGIN_CONFIG_REFUSED');
 const selected=getAddress(account.toLowerCase());check(!/^0x0+$/i.test(selected),'NATIVE_LOGIN_CONFIG_REFUSED');
 let entry=null;
 if(loginEntry!==null){exact(loginEntry,['identifier','requestedWalletPath']);
  check(loginIdentifier(loginEntry.identifier)===loginEntry.identifier && (loginEntry.requestedWalletPath===null || walletPath(loginEntry.requestedWalletPath)===loginEntry.requestedWalletPath),'NATIVE_LOGIN_CONFIG_REFUSED');entry=Object.freeze({...loginEntry});}
 const sign=custodyAccount.signMessage.bind(custodyAccount),used=new Map();
 function current(challenge,signal){
  check(!signal?.aborted,'NATIVE_LOGIN_CANCELLED');
  const time=now();check(Number.isSafeInteger(time) && time>=challenge.issuedAt && time<challenge.expiresAt,'NATIVE_LOGIN_EXPIRED');
  check(typeof custodyAccount.address==='string' && getAddress(custodyAccount.address.toLowerCase())===selected,'NATIVE_LOGIN_ACCOUNT_CHANGED');
  return time;
 }
 return Object.freeze({schema:'8415wallet-native-login-signer/1',account:selected,chainId,
  async signLoginChallenge(challenge,{signal,requestedContext=null}={}){
   const {message:expected}=await validateNativeLoginChallenge(challenge,{origin,tenant,account:selected,chainId,loginEntry:entry,requestedContext,now});
   const time=current(challenge,signal);for(const [key,expiry] of used)if(time>=expiry)used.delete(key);
   check(used.size<10000,'NATIVE_LOGIN_BUSY');
   const key=JSON.stringify([origin,tenant,selected,chainId,challenge.id,challenge.nonce]);
   check(!used.has(key),'NATIVE_LOGIN_ALREADY_ATTEMPTED');
   // Reserve before the awaited custody call: error/unknown outcome cannot cause
   // an automatic repeat. A new service challenge is a different explicit login.
   used.set(key,challenge.expiresAt);
   let signature;try{signature=await sign(expected);}catch{fail('NATIVE_LOGIN_SIGNING_UNRESOLVED');}current(challenge,signal);
   check(typeof signature==='string' && /^0x[0-9a-fA-F]{130}$/.test(signature) &&
    getAddress(verifyMessage(expected,signature).toLowerCase())===selected,'NATIVE_LOGIN_SIGNATURE_REFUSED');
   return Object.freeze({signature});
  }
 });
}
/** The authenticated client owns cookie/CSRF/session state. No response is a
 * reusable task grant. Caller supplies no username, private key or manual token. */
export function createNativeWalletLogin({client,signer}){
 check(typeof client?.authenticateWallet==='function' && signer?.schema==='8415wallet-native-login-signer/1' &&
  typeof signer.signLoginChallenge==='function','NATIVE_LOGIN_CONFIG_REFUSED');
 return Object.freeze({authenticate:({signal}={})=>client.authenticateWallet({account:signer.account,chainId:signer.chainId,signer,signal}),
  logout:()=>client.logout()});
}

/** Native HTTP implementation, not the browser's implicit cookie jar. Redirects
 * are refused and cookies never leave the one bound origin/tenant instance. */
export function createNativeWalletAuthClient({origin,tenant,basePath='',loginEntry=null,fetcher=globalThis.fetch}){
 const url=loginOrigin(origin),normalized=tenantBasePath(tenant,basePath),suffix=normalized?'-'+tenant:'';
 check(typeof fetcher==='function','NATIVE_LOGIN_TRANSPORT_REQUIRED');
 const secure=url.protocol==='https:',names=new Set([(secure?'__Host-8415preauth':'8415preauth-local')+suffix,
  (secure?'__Host-8415session':'8415session-local')+suffix]),jar=new Map();
 return new AccountAuthClient({origin,tenant,basePath:normalized,loginEntry,fetcher:async(target,input)=>{
  check(target.origin===origin,'NATIVE_LOGIN_TRANSPORT_REFUSED');
  const headers=new Headers(input.headers);headers.set('Origin',origin);
  if(jar.size)headers.set('Cookie',[...jar].map(([k,v])=>k+'='+v).join('; '));
  const response=await fetcher(target,{...input,headers,redirect:'error'});
  check(!response.redirected && (!response.url || new URL(response.url).origin===origin),'NATIVE_LOGIN_TRANSPORT_REFUSED');
  check(typeof response.headers?.getSetCookie==='function','NATIVE_LOGIN_COOKIE_UNAVAILABLE');
  for(const cookie of response.headers.getSetCookie()){
   check(typeof cookie==='string' && cookie.length<=2048,'NATIVE_LOGIN_COOKIE_REFUSED');
   const parts=cookie.split(';').map(p=>p.trim()),separator=parts[0].indexOf('=');
   const name=parts[0].slice(0,separator),value=parts[0].slice(separator+1),attributes=parts.slice(1).map(p=>p.toLowerCase());
   check(separator>0 && names.has(name) && (value==='' || /^[A-Za-z0-9_-]{43}$/.test(value)) &&
    attributes.includes('path=/') && attributes.includes('httponly') && attributes.includes('samesite=strict') &&
    (!secure || attributes.includes('secure')) && !attributes.some(p=>p.startsWith('domain=')),'NATIVE_LOGIN_COOKIE_REFUSED');
   if(value)jar.set(name,value);else jar.delete(name);
  }
  return response;
 }});
}
async function originalPrivateFile(path,limit){
 check(process.platform==='linux' && typeof path==='string' && resolve(path)===path,'NATIVE_LOGIN_LOCAL_CUSTODY_REQUIRED');
 check(await realpath(path)===path,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
 const file=await open(path,constants.O_RDONLY|constants.O_NOFOLLOW);
 try{const stat=await file.stat();check(stat.isFile() && stat.nlink===1 && stat.uid===process.geteuid() &&
   (stat.mode&0o7077)===0 && stat.size>0 && stat.size<=limit,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
  return await file.readFile();}finally{await file.close();}
}
/** Concrete local custody composition for an EXISTING encrypted JSON keystore
 * and its EXISTING local unlock credential. Installation-owned paths only; never
 * HTTP inputs. Does not create/import/move keys, change custody or expose signing
 * methods to the API caller. All decrypt/sign activity stays in this process. */
async function createNativeKeystoreLoginSigner({origin,tenant,account,chainId,keystoreFile,unlockCredentialFile,now=Date.now,loginEntry=null}){
 let encrypted,credential,wallet;
 try{
  encrypted=await originalPrivateFile(keystoreFile,1000000);credential=await originalPrivateFile(unlockCredentialFile,4096);
  // Preserve exact credential bytes: no trimming, rewriting or password guess.
  wallet=await Wallet.fromEncryptedJson(encrypted.toString('utf8'),credential.toString('utf8'));
  check(getAddress(wallet.address.toLowerCase())===getAddress(account.toLowerCase()),'NATIVE_LOGIN_ACCOUNT_CHANGED');
 }catch(error){if(typeof error?.message==='string' && /^NATIVE_LOGIN_[A-Z_]+$/.test(error.message))throw error;
  fail('NATIVE_LOGIN_CUSTODY_UNAVAILABLE');}
 finally{encrypted?.fill(0);credential?.fill(0);}
 return createNativeWalletLoginSigner({origin,tenant,account,chainId,custodyAccount:wallet,now,loginEntry});
}
export async function createNativeKeystoreWalletLogin(binding){
 const signer=await createNativeKeystoreLoginSigner(binding);
 const client=createNativeWalletAuthClient(binding),login=createNativeWalletLogin({client,signer});
 return Object.freeze({authenticate:login.authenticate,logout:login.logout,client});
}

/** Existing raw-key custody compatibility. The file stays on its original host;
 * the key is never an HTTP/client argument. Linux uses owner-only files; Windows
 * composition must supply the ORIGINAL pinned ACL verifier capability. */
export async function createNativeRawKeyLoginSigner({origin,tenant,account,chainId,basePath='',keyFile,
 verifyOriginalAcl=null,fetcher=globalThis.fetch,now=Date.now,loginEntry=null}){
 let bytes,wallet,file;
 try{
  check(typeof keyFile==='string' && resolve(keyFile)===keyFile && await realpath(keyFile)===keyFile,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
  const {lstat}=await import('node:fs/promises');const before=await lstat(keyFile);
  check(before.isFile() && !before.isSymbolicLink() && before.nlink===1 && before.size>0 && before.size<=4096,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
  if(process.platform==='win32'){
   check(typeof verifyOriginalAcl==='function','NATIVE_LOGIN_ORIGINAL_ACL_REQUIRED');
   check(await verifyOriginalAcl(keyFile)===true,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
  }else check(process.platform==='linux' && before.uid===process.geteuid() && (before.mode&0o7077)===0,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
  file=await open(keyFile,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const held=await file.stat();
  check(held.isFile() && held.nlink===1 && held.ino===before.ino && held.dev===before.dev && held.size===before.size,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
  bytes=await file.readFile();check(bytes.length<=4096,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
  const text=bytes.toString('utf8').trim();check(/^(?:0x)?[a-fA-F0-9]{64}$/.test(text),'NATIVE_LOGIN_CUSTODY_FORMAT_REFUSED');
  wallet=new Wallet(text.startsWith('0x')?text:'0x'+text);
  check(getAddress(wallet.address.toLowerCase())===getAddress(account.toLowerCase()),'NATIVE_LOGIN_ACCOUNT_CHANGED');
  const after=await lstat(keyFile);check(!after.isSymbolicLink() && after.nlink===1 && after.ino===held.ino && after.dev===held.dev &&
   after.size===held.size && after.mtimeMs===held.mtimeMs,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
 }catch(error){if(typeof error?.message==='string' && /^NATIVE_LOGIN_[A-Z_]+$/.test(error.message))throw error;fail('NATIVE_LOGIN_CUSTODY_UNAVAILABLE');}
 finally{bytes?.fill(0);await file?.close();}
 return createNativeWalletLoginSigner({origin,tenant,account,chainId,custodyAccount:wallet,now,loginEntry});
}
export async function createNativeRawKeyWalletLogin(binding){
 const signer=await createNativeRawKeyLoginSigner(binding),client=createNativeWalletAuthClient(binding);
 const login=createNativeWalletLogin({client,signer});return Object.freeze({authenticate:login.authenticate,logout:login.logout,client});
}
/** Fixed-purpose local custody wire for the original Agent/consumer transport.
 * Paths/ACL/custody authority are installation-owned, never request fields. */
export async function createNativeLoginCustodyBridge(binding){
 const encrypted=binding.keystoreFile!==undefined||binding.unlockCredentialFile!==undefined;
 check(encrypted ? binding.keystoreFile!==undefined && binding.unlockCredentialFile!==undefined && binding.keyFile===undefined && binding.keyDirectory===undefined
  : (binding.keyFile!==undefined)!==(binding.keyDirectory!==undefined),'NATIVE_LOGIN_CUSTODY_BINDING_REFUSED');
 const signer=encrypted?await createNativeKeystoreLoginSigner(binding)
  :binding.keyDirectory===undefined?await createNativeRawKeyLoginSigner(binding):await createNativeRawKeyDirectoryLoginSigner(binding);
 return Object.freeze({schema:'8415wallet-native-login-custody/1',async handle(input,{signal}={}){
  exact(input,['schema','challenge']);check(input.schema==='8415wallet-native-login-request/1','NATIVE_LOGIN_INPUT_REFUSED');
  const {signature}=await signer.signLoginChallenge(input.challenge,{signal,requestedContext:binding.loginEntry??null});
  return Object.freeze({schema:'8415wallet-native-login-proof/1',requestId:input.challenge.id,signature});
 }});
}
export async function runNativeLoginCustodyRequest({binding,input,output}){
 check(typeof input==='string' && Buffer.byteLength(input,'utf8')<=16384 && typeof output==='function','NATIVE_LOGIN_INPUT_REFUSED');
 let request;try{request=JSON.parse(input);}catch{fail('NATIVE_LOGIN_INPUT_REFUSED');}
 const bridge=await createNativeLoginCustodyBridge(binding),result=await bridge.handle(request);
 await output(JSON.stringify(result)+'\n');
}


/** Original bounded directory-loader compatibility. The selected file reference
 * stays inside custody; the consumer never discovers keys or supplies a path. */
export async function createNativeRawKeyDirectoryLoginSigner(binding){
 const {keyDirectory,account,verifyOriginalAcl=null}=binding;
 check(binding.keyFile===undefined && typeof keyDirectory==='string' && resolve(keyDirectory)===keyDirectory &&
  await realpath(keyDirectory)===keyDirectory,'NATIVE_LOGIN_CUSTODY_DIRECTORY_REFUSED');
 const {lstat,readdir}=await import('node:fs/promises');let visited=0,selected=null;
 const expected=getAddress(account.toLowerCase());
 async function visit(path,depth){
  check(++visited<=256,'NATIVE_LOGIN_CUSTODY_LIMIT_REFUSED');if(depth>4)return;
  const stat=await lstat(path);if(stat.isSymbolicLink())return;
  if(stat.isDirectory()){
   if(process.platform==='linux')check(stat.uid===process.geteuid() && (stat.mode&0o7077)===0,'NATIVE_LOGIN_CUSTODY_DIRECTORY_REFUSED');
   const entries=await readdir(path);check(entries.length<=256,'NATIVE_LOGIN_CUSTODY_LIMIT_REFUSED');
   for(const name of entries.sort())await visit(resolve(path,name),depth+1);return;
  }
  if(!stat.isFile()||stat.nlink!==1||stat.size<64||stat.size>4096)return;
  let file,bytes;
  try{
   if(process.platform==='win32')check(typeof verifyOriginalAcl==='function' && await verifyOriginalAcl(path)===true,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
   else check(process.platform==='linux' && stat.uid===process.geteuid() && (stat.mode&0o7077)===0,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
   file=await open(path,constants.O_RDONLY|(constants.O_NOFOLLOW??0));const held=await file.stat();
   check(held.nlink===1 && held.ino===stat.ino && held.dev===stat.dev && held.size===stat.size,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
   bytes=await file.readFile();check(bytes.length<=4096,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');const text=bytes.toString('utf8').trim();
   if(!/^(?:0x)?[a-fA-F0-9]{64}$/.test(text))return;
   let candidate;try{candidate=new Wallet(text.startsWith('0x')?text:'0x'+text);}catch{return;}
   if(getAddress(candidate.address.toLowerCase())!==expected)return;
   const leaf=await lstat(path);check(!leaf.isSymbolicLink() && leaf.nlink===1 && leaf.ino===held.ino && leaf.dev===held.dev &&
    leaf.size===held.size && leaf.mtimeMs===held.mtimeMs,'NATIVE_LOGIN_CUSTODY_FILE_REFUSED');
   check(selected===null,'NATIVE_LOGIN_DUPLICATE_ACCOUNT_REFUSED');selected=path;
  }finally{bytes?.fill(0);await file?.close();}
 }
 await visit(keyDirectory,0);check(selected!==null,'NATIVE_LOGIN_ORIGINAL_ACCOUNT_UNAVAILABLE');
 return createNativeRawKeyLoginSigner({...binding,keyFile:selected});
}

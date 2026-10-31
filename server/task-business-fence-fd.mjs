import {Socket} from 'node:net';
import {createHash} from 'node:crypto';
import {readFileSync} from 'node:fs';

// Only a server-owned inherited AF_UNIX socketpair capability. No listener,
// address, reconnect, HTTP endpoint or browser-supplied descriptor is accepted.
// Source handshake checks version consistency, not peer authentication: the
// original host must establish and retain the socketpair capability itself.
const error=()=>Object.assign(Error('TASK_BUSINESS_FENCE_CHANNEL_REFUSED'),{code:'TASK_BUSINESS_FENCE_CHANNEL_REFUSED'});
function strictJson(bytes){
 const text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);
 const parsed=JSON.parse(text); // Validate grammar first; walk tokens to reject duplicate keys.
 let i=0;
 const ws=()=>{while(/\s/.test(text[i]??'')&&i<text.length)i++;};
 const string=()=>{const start=i++;while(i<text.length){const c=text[i++];if(c==='\\'){i++;continue;}if(c==='"')return JSON.parse(text.slice(start,i));}throw error();};
 const value=depth=>{
  if(depth>32)throw error();ws();
  if(text[i]==='"'){string();return;}
  if(text[i]==='{'){
   i++;ws();const keys=new Set();if(text[i]==='}'){i++;return;}
   while(true){ws();const key=string();if(keys.has(key))throw error();keys.add(key);ws();i++;value(depth+1);ws();if(text[i++]==='}')return;}
  }
  if(text[i]==='['){i++;ws();if(text[i]===']'){i++;return;}while(true){value(depth+1);ws();if(text[i++]===']')return;}}
  while(i<text.length&&!/[\s,}\]]/.test(text[i]))i++;
 };
 value(0);ws();if(i!==text.length)throw error();return parsed;
}
const exact=(v,keys)=>v&&Object.getPrototypeOf(v)===Object.prototype&&Object.keys(v).length===keys.length&&keys.every(k=>Object.hasOwn(v,k));
export async function createInheritedBusinessFence({fd,expectedSource,scope,timeoutMs=5000,maxFrameBytes=65536}){
 if(!Number.isSafeInteger(fd)||fd<3||!exact(expectedSource,['commit','tree'])||
   !/^[0-9a-f]{40}$/.test(expectedSource.commit)||!/^[0-9a-f]{40}$/.test(expectedSource.tree)||
   typeof scope!=='string'||!/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(scope)||
   !Number.isSafeInteger(timeoutMs)||timeoutMs<1||timeoutMs>60000||
   !Number.isSafeInteger(maxFrameBytes)||maxFrameBytes<1024||maxFrameBytes>65536)throw error();
 const source=Object.freeze({...expectedSource});
 const implementationDigest='0x'+createHash('sha256').update(readFileSync(new URL(import.meta.url))).update(JSON.stringify({source,scope})).digest('hex');
 const socket=new Socket({fd,readable:true,writable:true});
 let dead=false,pending=null,buffer=Buffer.alloc(0),sequence=0,tail=Promise.resolve();
 const poison=()=>{if(dead)return;dead=true;const p=pending;pending=null;if(p){clearTimeout(p.timer);p.reject(error());}socket.destroy();};
 socket.on('error',poison);socket.on('end',poison);socket.on('close',poison);
 socket.on('data',chunk=>{
  if(dead)return;
  buffer=Buffer.concat([buffer,chunk]);
  if(buffer.length>maxFrameBytes){poison();return;}
  const end=buffer.indexOf(10);if(end<0)return;
  // Exactly one response for one outstanding request. Extra frames are never
  // retained for a future request, including a future assertion.
  if(!pending||end!==buffer.length-1){poison();return;}
  let response;try{response=strictJson(buffer.subarray(0,end));}catch{poison();return;}
  buffer=Buffer.alloc(0);
  const p=pending;
  const key=p.action==='hello'?'channel':'receipt';
  if(!exact(response,['seq','ok',key])||response.seq!==p.seq||response.ok!==true){poison();return;}
  pending=null;clearTimeout(p.timer);p.resolve(response[key]);
 });
 const request=(action,event,receipt)=>{
  const run=()=>new Promise((resolve,reject)=>{
   if(dead||pending||buffer.length||!Number.isSafeInteger(sequence)||sequence===Number.MAX_SAFE_INTEGER){poison();reject(error());return;}
   const seq=sequence++;
   const body=action==='hello'?{seq,action}:{seq,action,event,receipt};
   let frame;try{frame=Buffer.from(JSON.stringify(body)+'\n','utf8');}catch{poison();reject(error());return;}
   if(frame.length>maxFrameBytes){poison();reject(error());return;}
   const timer=setTimeout(poison,timeoutMs);pending={seq,action,resolve,reject,timer};
   socket.write(frame,err=>{if(err)poison();});
  });
  const result=tail.then(run);tail=result.catch(()=>{});return result;
 };
 try{
  const channel=await request('hello');
  if(!exact(channel,['schema','source','scope'])||channel.schema!=='8415-ex-fence-channel/1'||channel.scope!==scope||
    !exact(channel.source,['commit','tree'])||channel.source.commit!==source.commit||channel.source.tree!==source.tree)throw error();
 }catch{poison();throw error();}
 const invoke=async(action,event,receipt)=>{
  const value=await request(action,structuredClone(event),receipt===null?null:structuredClone(receipt));
  if(!value||value.scope!==scope){poison();throw error();}
  return value; // Full receipt/binding/digest checks are in the original adapter.
 };
 return Object.freeze({identity:Object.freeze({fenceId:'ex-original-checkpoint',fenceVersion:'1',implementationDigest}),
  claim:event=>invoke('claim',event,null),assert:(event,receipt)=>invoke('assert',event,receipt)});
}

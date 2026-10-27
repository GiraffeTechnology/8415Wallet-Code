import test from 'node:test';
import assert from 'node:assert/strict';
import { createAuthRuntime } from '../server/main.mjs';
import { MemoryCredentialStore } from '../server/store.mjs';
import { disabledTaskListingRuntime } from '../server/task-listing-runtime.mjs';
import { readFileSync } from 'node:fs';
const config={origin:'https://wallet.example.invalid',tenant:'platform',statePath:'/synthetic/state',accounts:[]};
test('recoverable bind failure preserves current runtime and fatal teardown starts after binding',async()=>{
  const source=readFileSync(new URL('../server/main.mjs',import.meta.url),'utf8');
  const entry=source.slice(source.indexOf('export async function startAuthFromEnvironment'));
  assert.ok(entry.indexOf('await runtime.start();') < entry.indexOf("runtime.server.on('error'"));
  let stops=0, attempts=0;
  const runtime=await createAuthRuntime({config:{...config,port:19100},store:new MemoryCredentialStore(),listingRuntime:{runtime:disabledTaskListingRuntime(),async start(){},async stop(){stops++;}}});
  runtime.server.listen=function(){attempts++;queueMicrotask(()=>attempts===1?this.emit('error',Object.assign(Error('busy'),{code:'EADDRINUSE'})):this.emit('listening'));return this;};
  runtime.server.address=()=>({port:19101});
  try{await runtime.start();assert.equal(attempts,2);assert.equal(stops,0);assert.equal(runtime.server.listening,false);}finally{await runtime.stop();}
  assert.equal(stops,1);
});
test('real current runtime uses automatic TCP selection without opening a network listener',async()=>{
  let starts=0,stops=0;const calls=[];
  const runtime=await createAuthRuntime({config,store:new MemoryCredentialStore(),listingRuntime:{runtime:disabledTaskListingRuntime(),async start(){starts++;},async stop(){stops++;}}});
  runtime.server.listen=function(port,host){calls.push({port,host});queueMicrotask(()=>this.emit('listening'));return this;};
  runtime.server.address=()=>({port:19100});
  try{await runtime.start();assert.deepEqual(calls,[{port:0,host:'127.0.0.1'}]);assert.equal(starts,1);assert.equal(runtime.server.listening,false);}finally{await runtime.stop();}
  assert.equal(stops,1);
});
test('real current runtime retains listing shutdown on unexpected TCP error',async()=>{
  let stopped=0;const runtime=await createAuthRuntime({config,store:new MemoryCredentialStore(),listingRuntime:{runtime:disabledTaskListingRuntime(),async start(){},async stop(){stopped++;}}});
  runtime.server.listen=function(){queueMicrotask(()=>this.emit('error',Object.assign(Error('synthetic fail'),{code:'ENOTFOUND'})));return this;};
  await assert.rejects(runtime.start(),/synthetic fail/);assert.equal(stopped,1);assert.equal(runtime.server.listening,false);await runtime.stop();assert.equal(stopped,1);
});

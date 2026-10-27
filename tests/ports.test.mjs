import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { listenOnUsablePort, reservedPortSet, validateLoopbackPorts } from '../server/ports.mjs';
import { readFileSync } from 'node:fs';
test('optional TCP requests retain strict port types and bounded reservations',()=>{
  for(const config of [{},{port:null},{port:19100},{port:19100,reservedPorts:[19100]}])assert.doesNotThrow(()=>validateLoopbackPorts(config));
  for(const port of [0,-1,65536,'19100',NaN])assert.throws(()=>validateLoopbackPorts({port}),/LOOPBACK_PORT_REFUSED/);
  for(const reservedPorts of [null,[0],['19100'],Array(65).fill(19100)])assert.throws(()=>validateLoopbackPorts({reservedPorts}),/RESERVED_PORT_REFUSED/);
});
test('current runtime integration preserves socket path and unknown-field gates',()=>{
  const main=readFileSync(new URL('../server/main.mjs',import.meta.url),'utf8');
  const config=readFileSync(new URL('../server/config-validation.mjs',import.meta.url),'utf8');
  assert.match(main,/if \(config.socketPath\) await new Promise/);
  assert.match(main,/else await listenOnUsablePort\(server, \{ host: '127.0.0.1'/);
  assert.match(config,/AUTH_CONFIG_FIELD_REFUSED/);assert.match(config,/AUTH_SOCKET_PATH_REFUSED/);
  assert.doesNotMatch(config,/\['portFile'|\['trustedProxyHeader'/);
});
class Listener extends EventEmitter {
  constructor(outcomes) { super(); this.outcomes=outcomes; this.calls=[]; this.bound=null; this.closed=0; }
  listen(port,host) { this.calls.push({port,host}); const result=this.outcomes.shift(); queueMicrotask(()=>{ if(result instanceof Error)this.emit('error',result); else {this.bound=result;this.emit('listening');} }); }
  address(){return {port:this.bound};}
  close(done){this.closed++;done();}
}
test('reserved configuration validation preserves environment-only policy',()=>{
  assert.deepEqual([...reservedPortSet(undefined)],[]);
  assert.deepEqual([...reservedPortSet([19022,19023])],[19022,19023]);
  for(const v of [[0],[65536],['19022'],19022,Array(65).fill(19022)])assert.throws(()=>reservedPortSet(v),/RESERVED_PORTS_REFUSED/);
});
test('requested busy port falls back and removes event listeners',async()=>{
  const s=new Listener([Object.assign(Error('busy'),{code:'EADDRINUSE'}),19200]);
  assert.equal(await listenOnUsablePort(s,{host:'127.0.0.1',requested:19100}),19200);
  assert.deepEqual(s.calls.map(x=>x.port),[19100,0]); assert.equal(s.listenerCount('error'),0);assert.equal(s.listenerCount('listening'),0);
});
test('reserved requested and OS-selected ports are never returned',async()=>{
  const s=new Listener([19200,19201]);
  assert.equal(await listenOnUsablePort(s,{host:'127.0.0.1',requested:19100,reserved:new Set([19100,19200])}),19201);
  assert.deepEqual(s.calls.map(x=>x.port),[0,0]);assert.equal(s.closed,1);
});
test('unexpected failures fail closed without fallback',async()=>{
  const s=new Listener([Object.assign(Error('bad host'),{code:'ENOTFOUND'})]);
  await assert.rejects(listenOnUsablePort(s,{host:'127.0.0.1'}),/bad host/);assert.equal(s.calls.length,1);
});
test('invalid requested ports fail before opening a listener',async()=>{
  const s=new Listener([]);for(const p of [0,-1,65536,'19100'])await assert.rejects(listenOnUsablePort(s,{host:'127.0.0.1',requested:p}),/AUTH_PORT_REFUSED/);assert.equal(s.calls.length,0);
});
test('reserved OS selections exhaust bounded attempts rather than accepting a reserved port',async()=>{
  const s=new Listener(Array(16).fill(19100));await assert.rejects(listenOnUsablePort(s,{host:'127.0.0.1',reserved:new Set([19100])}),/NO_USABLE_PORT/);assert.equal(s.calls.length,16);assert.equal(s.closed,16);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { validateAuthConfig } from '../server/config-validation.mjs';
const base = {origin:'https://wallet.example',tenant:'platform',statePath:'/tmp/synthetic-state',accounts:[]};
test('current auth schema accepts automatic or explicit TCP only with validated values',()=>{
  for(const extra of [{},{port:null},{port:19100},{port:19100,reservedPorts:[19100]}])assert.doesNotThrow(()=>validateAuthConfig({...base,...extra}));
  for(const port of [0,-1,65536,'19100'])assert.throws(()=>validateAuthConfig({...base,port}),/LOOPBACK_PORT_REFUSED/);
});
test('current auth schema keeps socket configuration separate',()=>{
  assert.doesNotThrow(()=>validateAuthConfig({...base,socketPath:'/tmp/synthetic-auth.sock'}));
  for(const port of [null,19100])assert.throws(()=>validateAuthConfig({...base,socketPath:'/tmp/synthetic-auth.sock',port}),/SOCKET_PATH_REFUSED/);
});
test('unsupported legacy port-file and proxy settings remain refused',()=>{
  for(const extra of [{portFile:'/tmp/auth.port'},{trustedProxyHeader:'x-client-ip'}])assert.throws(()=>validateAuthConfig({...base,...extra}),/CONFIG_FIELD_REFUSED/);
});
test('account, origin, state-path and reservation validation remain fail-closed',()=>{
  for(const extra of [{statePath:'relative'},{origin:'bad'},{reservedPorts:null},{reservedPorts:[0]},{accounts:[{}]}])assert.throws(()=>validateAuthConfig({...base,...extra}));
});

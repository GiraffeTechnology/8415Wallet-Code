/** Synthetic browser wire verification. Not a live migrated authority record. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { webcrypto, createHash } from 'node:crypto';
import { validateAuthorizationContext } from '../web/authorization-context.mjs';
const origin = 'https://wallet.example';
const session = { origin,tenant:'fixture',username:'alice',account:'0x'+'1'.repeat(40),chainId:'560048' };
const reference = '@origin-continuation:'+createHash('sha256').update(JSON.stringify([session.tenant,origin])).digest('hex');
const value = () => ({schema:'8415wallet-authorization-context/1',tenant:session.tenant,transportOrigin:origin,
  authorizationOrigin:origin+':9446',username:session.username,account:session.account,chainId:session.chainId,
  continuation:{reference,digest:'a'.repeat(64),revision:'1'}});
const read = v => validateAuthorizationContext(v,session,origin,webcrypto);
test('independent session and fixed continuation reference bind the expected realm',async()=>{
  const context=await read(value());assert.equal(context.authorizationOrigin,origin+':9446');assert.equal(context.transportOrigin,origin);
  assert.ok(Object.isFrozen(context));assert.ok(Object.isFrozen(context.continuation));
  const canonical=await read({...value(),authorizationOrigin:origin,continuation:null});assert.equal(canonical.authorizationOrigin,origin);
});
test('wrong identity, tenant, chain, origin, mapping reference, revision and extra authority fields refuse',async()=>{
  const variants=[{username:'bob'},{account:'0x'+'2'.repeat(40)},{chainId:'1'},{tenant:'other'},
    {transportOrigin:'https://other.example'},{authorizationOrigin:'https://other.example:9446'},
    {authorizationOrigin:origin+':9446',continuation:null},{approved:true}];
  for(const patch of variants)await assert.rejects(read({...value(),...patch}),/AUTHORIZATION_CONTEXT_BINDING_REFUSED/);
  for(const patch of [{reference:'@origin-continuation:'+'b'.repeat(64)},{revision:'01'},{revision:'0'},{digest:'0'.repeat(64)},{grant:'untrusted'}])
    await assert.rejects(read({...value(),continuation:{...value().continuation,...patch}}),/AUTHORIZATION_CONTEXT_BINDING_REFUSED/);
});

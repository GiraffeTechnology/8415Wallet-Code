import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { AUTH_STATE_SEMANTICS, CA_AUTH_STATE_SEMANTICS, authStateSemantics, validateAuthStateTransition } from '../scripts/package/verify-auth.mjs';
import { decodeStorePayload, encodeStorePayload, requiredStoreGeneration } from '../server/store-state-generation.mjs';
const release=n=>({runtime:{authStateSemantics:`8415wallet-auth-state/${n}`}});
test('CA package generation admits forward 5-to-6 but refuses rollback or undeclared future semantics',()=>{
 assert.equal(AUTH_STATE_SEMANTICS,'8415wallet-auth-state/8');assert.equal(CA_AUTH_STATE_SEMANTICS,'8415wallet-auth-state/6');assert.equal(authStateSemantics(release(6)),'8415wallet-auth-state/6');assert.equal(authStateSemantics(release(5)),'8415wallet-auth-state/5');
 validateAuthStateTransition(release(5),release(6));assert.throws(()=>validateAuthStateTransition(release(6),release(5)),/DOWNGRADE/);
 assert.throws(()=>validateAuthStateTransition(release(5),release(6),{rollback:true}),/TRANSITION/);assert.throws(()=>authStateSemantics(release(9)),/REFUSED/);
 validateAuthStateTransition(release(6),release(7));assert.throws(()=>validateAuthStateTransition(release(7),release(6)),/DOWNGRADE/);assert.throws(()=>validateAuthStateTransition(release(6),release(7),{rollback:true}),/TRANSITION/);
 validateAuthStateTransition(release(7),release(8));assert.throws(()=>validateAuthStateTransition(release(8),release(7)),/DOWNGRADE/);assert.throws(()=>validateAuthStateTransition(release(7),release(8),{rollback:true}),/TRANSITION/);
 const build=readFileSync(new URL('../scripts/package/build-auth.mjs',import.meta.url),'utf8');assert.match(build,/credentialStoreFormat: 5/);
});
test('CA generation cannot be disguised under legacy or asset-only envelope',()=>{
 const records={user:{caBindings:{version:1,fingerprints:[]}}};assert.equal(requiredStoreGeneration(records),3);
 assert.throws(()=>encodeStorePayload(records,2),/UPGRADE/);assert.throws(()=>decodeStorePayload(records,1),/UPGRADE/);
 assert.throws(()=>decodeStorePayload({schema:'8415wallet-credential-state/2',requiredCapabilities:['credential.assetControlPolicies/1'],records},2),/UPGRADE/);
 const payload=encodeStorePayload(records,3);assert.deepEqual(decodeStorePayload(payload,3),records);
 assert.throws(()=>decodeStorePayload({...payload,requiredCapabilities:['credential.assetControlPolicies/1']},3),/CAPABILITY/);
});
test('installer recognizes generation 3 without dropping the monotonic upgrade and uncertain-start guards',()=>{
 const install=readFileSync(new URL('../deploy/auth-runtime/install.mjs',import.meta.url),'utf8');
 for(const variable of ['next','oldRelease','old','current'])assert.ok(install.includes(`[1, 2, 3, 4, 5].includes(${variable}.runtime.credentialStoreFormat)`));
 assert.ok(install.includes('validateAuthStateTransition(current, old, { rollback: true })'));
 assert.ok(install.includes('candidateStartAttempted && authStateSemantics(next) !== authStateSemantics(oldRelease)'));
});

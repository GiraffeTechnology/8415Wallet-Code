import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { TASK_RUNTIME_SOURCE_PATHS, runtimePackage, sourcePathAllowed, packagePathAllowed, verifyTaskListingArtifact } from '../scripts/package/verify-auth.mjs';
import { TASK_LISTING_PACKAGE_PIN } from '../server/task-listing-package-pin.mjs';
const read=path=>JSON.parse(readFileSync(new URL(`../${path}`,import.meta.url)));
const manifest=read('package.json'),lock=read('package-lock.json');
test('fixed reviewed ArtFi artifact and every new Wallet module are mandatory sources',()=>{
 verifyTaskListingArtifact(new URL('..',import.meta.url).pathname);
 const bytes=readFileSync(new URL(`../${TASK_LISTING_PACKAGE_PIN.artifactPath}`,import.meta.url));assert.equal('sha512-'+createHash('sha512').update(bytes).digest('base64'),TASK_LISTING_PACKAGE_PIN.artifactIntegrity);
 for(const path of ['server/task-listing-runtime.mjs','server/task-listing-bootstrap.mjs','server/task-listing-config.mjs','server/task-listing-installed.mjs','server/task-listing-package-pin.mjs','server/task-listing-transport.mjs','server/task-journal-capabilities.mjs','server/task-listing-results.mjs','web/task-listing-results.mjs']){assert.ok(TASK_RUNTIME_SOURCE_PATHS.includes(path));assert.ok(sourcePathAllowed(path));}
 assert.ok(sourcePathAllowed(TASK_LISTING_PACKAGE_PIN.artifactPath));assert.equal(sourcePathAllowed('vendor/arbitrary.tgz'),false);
 for(const path of ['node_modules/.env','node_modules/example/.npmrc','vendor/private.key'])assert.equal(packagePathAllowed(path),false);
});
test('local artifact and bundled metadata exceptions are exact, versioned and never allow install scripts',()=>{
 assert.doesNotThrow(()=>runtimePackage(manifest,lock));
 for(const mutate of [
  (p,l)=>{p.dependencies['@artfi/task-listing-runtime']='file:/tmp/other.tgz';l.packages[''].dependencies=structuredClone(p.dependencies);},
  (_p,l)=>l.packages['node_modules/@artfi/task-listing-runtime'].integrity='sha512-'+ 'A'.repeat(86)+'==',
  (_p,l)=>l.packages['node_modules/@artfi/task-listing-runtime'].dependencies['@opensea/sdk']='0.0.0',
  (_p,l)=>delete l.packages['node_modules/@artfi/task-listing-runtime'].dependencies.zod,
  (_p,l)=>l.packages['node_modules/@artfi/task-listing-runtime'].bundleDependencies.pop(),
  (_p,l)=>l.packages['node_modules/@artfi/task-listing-runtime/node_modules/ws'].version='0.0.0',
  (_p,l)=>l.packages['node_modules/@artfi/task-listing-runtime/node_modules/ws'].hasInstallScript=true,
  (_p,l)=>l.packages['node_modules/@artfi/task-listing-runtime/node_modules/unknown']={version:'1.0.0',inBundle:true},
  (_p,l)=>delete l.packages['node_modules/@artfi/task-listing-runtime/node_modules/ws'],
 ]){const p=structuredClone(manifest),l=structuredClone(lock);mutate(p,l);assert.throws(()=>runtimePackage(p,l));}
});

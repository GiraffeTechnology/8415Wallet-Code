/** Complete public package privacy contract; real served retirement is separate. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { DELIVERY_FILES } from '../scripts/package/verify-delivery.mjs';
import { validatePasswordRoutes } from '../web/tenant-password-routing.mjs';
const read = path => readFileSync(new URL('../' + path, import.meta.url), 'utf8');
test('outer delivery carries exact release receiver dependency and existing routing regressions', () => {
  assert.equal(DELIVERY_FILES.filter(path => path === 'web/tenant-password-routing.mjs').length, 1);
  assert.match(read('web/release-profile.mjs'), /tenant-password-routing\.mjs/);
  const script = JSON.parse(read('package.json')).scripts.test;
  for (const path of ['tests/tenant-password-routing.test.mjs', 'tests/tenant-password-package-closure.test.mjs'])
    assert.equal(script.split(' ').filter(value => value === path).length, 1);
});
test('nested V2/V3 and outer kit retain only empty historical directory tombstone', () => {
  assert.match(read('scripts/package/build-dapp.mjs'), /stagePublicWeb\(root, source, stage\)/);
  assert.match(read('scripts/package/dapp-release.mjs'), /entry\.path\.startsWith\('web\/'\)/);
  for (const path of ['web/tenant-password-routing.mjs', 'web/tenant-password-ui.mjs', 'web/tenant-password-routing.json']) {
    assert.ok(read(path).length > 0);
    assert.ok(read('scripts/package/verify-delivery.mjs').includes("'" + path + "'"));
  }
  assert.deepEqual(validatePasswordRoutes(JSON.parse(read('web/tenant-password-routing.json'))), []);
  assert.doesNotMatch(read('web/tenant-password-routing.json'), /tenant|url|Ready/);
});

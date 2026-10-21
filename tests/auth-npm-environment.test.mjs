import test from 'node:test';
import assert from 'node:assert/strict';
import { authNpmEnvironment } from '../scripts/package/build-auth.mjs';

test('auth packaging explicitly disables npm background update checks', () => {
  const result = authNpmEnvironment({}, '/private/build-logs');
  assert.equal(result.npm_config_update_notifier, 'false');
  assert.equal(result.NPM_CONFIG_UPDATE_NOTIFIER, 'false');
  assert.equal(result.npm_config_logs_dir, '/private/build-logs');
  assert.equal(result.NPM_CONFIG_LOGS_DIR, '/private/build-logs');
});
test('auth packaging overrides either inherited update-notifier spelling', () => {
  const result = authNpmEnvironment({ npm_config_update_notifier: 'true', NPM_CONFIG_UPDATE_NOTIFIER: 'true' }, '/logs');
  assert.equal(result.npm_config_update_notifier, 'false');
  assert.equal(result.NPM_CONFIG_UPDATE_NOTIFIER, 'false');
});
test('auth packaging preserves existing cache, offline, runtime and integrity settings', () => {
  const environment = { NODE_OPTIONS: '--max-old-space-size=160', npm_config_cache: '/existing/cache',
    npm_config_offline: 'true', npm_config_ignore_scripts: 'true', npm_config_registry: 'https://example.invalid/',
    npm_config_strict_ssl: 'true', PATH: '/approved/runtime/bin' };
  const result = authNpmEnvironment(environment, '/logs');
  for (const [key, value] of Object.entries(environment)) assert.equal(result[key], value);
});
test('auth packaging does not mutate the caller environment or retain stale log paths', () => {
  const environment = Object.freeze({ npm_config_logs_dir: '/old', NPM_CONFIG_LOGS_DIR: '/old', marker: 'retained' });
  const result = authNpmEnvironment(environment, '/current');
  assert.equal(environment.npm_config_logs_dir, '/old');
  assert.equal(result.npm_config_logs_dir, '/current');
  assert.equal(result.NPM_CONFIG_LOGS_DIR, '/current');
  assert.equal(result.marker, 'retained');
});

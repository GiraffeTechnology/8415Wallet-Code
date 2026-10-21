import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { authenticatedRoute, walletPath, loginIdentifier } from '../web/wallet-entry.mjs';
const require = createRequire(import.meta.url);
const { isCanonicalWalletRequest, canonicalEntryHtml } = require('../scripts/controls/canonical-entry.cjs');

test('canonical request syntax is independent of account existence and matches client rules', () => {
  for (const path of ['/example-one', '/unknown-name', '/name123']) {
    assert.equal(isCanonicalWalletRequest(path), true); assert.equal(walletPath(path), path);
  }
  for (const path of ['/auth','/web','//example-one','/example-one/','/example-one?x=1','/example-one#login','/%65xample-one','/../example-one','/Example-one']) {
    assert.equal(isCanonicalWalletRequest(path), false); assert.equal(walletPath(path), null);
  }
});
test('only exact authenticated route records become navigation destinations', () => {
  assert.deepEqual(authenticatedRoute({ walletName: 'example-one', walletPath: '/example-one' }), { walletName: 'example-one', walletPath: '/example-one' });
  for (const value of [{ walletName: 'example-one', walletPath: '//other.invalid' }, { walletName: 'example-one', walletPath: '/example-two' }, { walletName: 'example-one', walletPath: '/example-one', endpoint: 'private' }]) assert.equal(authenticatedRoute(value), null);
  assert.equal(loginIdentifier('  one@example.invalid '), 'one@example.invalid');
  assert.equal(loginIdentifier('one\n@example.invalid'), null);
});
test('canonical shell preserves CSP and resolves static assets without a base tag', async () => {
  const source = await readFile(new URL('../web/index.html', import.meta.url), 'utf8');
  const served = canonicalEntryHtml(source);
  assert.match(served, /base-uri 'none'/); assert.doesNotMatch(served, /<base\b/i);
  assert.match(served, /href="\/web\/wallet.css"/);
  assert.match(served, /src="\/web\/assets\/giraffe-original.jpg"/);
  assert.match(served, /src="\/web\/wallet-shell.mjs"/);
  assert.equal(canonicalEntryHtml(source), served); // No per-name existence branch.
  assert.match(canonicalEntryHtml(source, '/v3/web/index.html'), /src="\/v3\/web\/wallet-shell.mjs"/);
  assert.throws(() => canonicalEntryHtml(source, '//other.invalid/web/index.html'), /REFUSED/);
});

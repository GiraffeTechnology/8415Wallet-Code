import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';

test('package helper defers TypeScript until static validation and keeps syntax rejection', () => {
  const helper = new URL('../scripts/package/dapp-release.mjs', import.meta.url).href;
  const script = `
    import assert from 'node:assert/strict';
    import { createRequire } from 'node:module';
    import { mkdtempSync, mkdirSync, writeFileSync, rmSync } from 'node:fs';
    import { tmpdir } from 'node:os';
    import { join } from 'node:path';
    const require = createRequire(new URL('./package.json', 'file://' + process.cwd() + '/'));
    const parser = require.resolve('typescript');
    assert.equal(require.cache[parser], undefined);
    const { validateStaticTree } = await import(${JSON.stringify(helper)});
    assert.equal(require.cache[parser], undefined, 'source capture/build preparation must not retain the parser');
    const directory = mkdtempSync(join(tmpdir(), 'wallet-lazy-parser-test-'));
    try {
      mkdirSync(join(directory, 'web'));
      writeFileSync(join(directory, 'web', 'invalid.mjs'), 'export const = ;');
      assert.throws(() => validateStaticTree(directory), /DAPP_MODULE_SYNTAX_REFUSED/);
      assert.ok(require.cache[parser], 'static validation still loads and uses the real parser');
    } finally { rmSync(directory, { recursive: true, force: true }); }
  `;
  assert.doesNotThrow(() => execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    cwd: process.cwd(), encoding: 'utf8', timeout: 30000,
  }));
});

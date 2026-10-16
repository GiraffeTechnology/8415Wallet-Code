import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';

/**
 * Every regression file has to be reachable from something CI runs.
 *
 * A `.test.ts` file is picked up by the `tests/**\/*.test.ts` glob, so adding
 * one is enough. A `.test.mjs` file has to be named explicitly, and a file
 * nobody named is a file that never runs: nine were in exactly that state —
 * written, passing, and invisible to CI. A test that never runs is worse than
 * a missing one, because the coverage matrix cites it as evidence.
 */

const root = new URL('..', import.meta.url);
const pkg = JSON.parse(readFileSync(new URL('package.json', root), 'utf8')) as {
  scripts: Record<string, string>;
};
const workflow = readFileSync(new URL('.github/workflows/ci.yml', root), 'utf8');

/** Files a dedicated CI step or package script owns instead of `npm test`. */
const RUN_ELSEWHERE: Record<string, string> = {
  'auth-installed.test.mjs': 'test:auth:installed',
  'auth-legacy-installed.test.mjs': 'test:auth:installed',
  'dapp-release.test.mjs': 'test:package:dapp',
  // Named directly by a workflow step, not by any package script.
  'task-authorization-browser.test.mjs': 'ci.yml',
  'task-static-module-closure.test.mjs': 'ci.yml',
  // Imports dist/browser/browser.js, so it can only run after the build step.
  'readonly-panel-browser-lifecycle.test.mjs': 'ci.yml',
};

const files = readdirSync(new URL('tests', root)).filter((name) => name.endsWith('.test.mjs'));

/**
 * `npm test` chains to other scripts with `&& npm run x`, so a file named in
 * one of those is reached too. Follow the chain rather than only reading the
 * one script, or a reachable file reads as unreachable.
 */
function reachedFromNpmTest(): string {
  const seen = new Set<string>();
  const pending = ['test'];
  let text = '';
  while (pending.length > 0) {
    const name = pending.shift()!;
    if (seen.has(name)) continue;
    seen.add(name);
    const body = pkg.scripts[name];
    if (body === undefined) continue;
    text += `\n${body}`;
    for (const match of body.matchAll(/npm run ([a-zA-Z0-9:_-]+)/g)) pending.push(match[1]!);
  }
  return text;
}
const reachable = reachedFromNpmTest();
const namedByNpmTest = (name: string): boolean => reachable.includes(`tests/${name}`);
// Indexed access is optional under the compiler settings, so an absent script
// reads as the empty string and the assertions below fail on it rather than
// being skipped past a non-null assertion.
const npmTest = pkg.scripts['test'] ?? '';

test('the glob that carries every .ts regression is still in npm test', () => {
  assert.notEqual(npmTest, '', 'package.json has no test script');
  assert.match(npmTest, /tests\/\*\*\/\*\.test\.ts/);
  assert.ok(readdirSync(new URL('tests', root)).some((name) => name.endsWith('.test.ts')));
});

test('CI runs npm test, so being named there is sufficient', () => {
  assert.match(workflow, /run: npm test/);
});

test('the chain npm test depends on is still followed and still chained', () => {
  assert.match(npmTest, /&& npm run test:task-listing-runtime/);
  assert.ok(reachable.includes('tests/task-listing-bootstrap.test.mjs'),
    'a file named only in a chained script must still count as reached');
});

test('every .mjs regression is reachable from a script CI runs', () => {
  assert.ok(files.length > 0, 'no .mjs regressions were found at all');
  const unreachable = files.filter((name) => !namedByNpmTest(name) && !(name in RUN_ELSEWHERE));
  assert.deepEqual(unreachable, [], 'these .mjs regressions are named nowhere and never run');
});

test('each owner outside npm test really names its file, and CI really runs that owner', () => {
  for (const [name, owner] of Object.entries(RUN_ELSEWHERE)) {
    assert.ok(files.includes(name), `stale entry for a file that no longer exists: ${name}`);
    assert.equal(namedByNpmTest(name), false, `${name} is in npm test; drop its exemption`);
    if (owner === 'ci.yml') {
      assert.ok(workflow.includes(`tests/${name}`), `ci.yml no longer names ${name}`);
      continue;
    }
    const script = pkg.scripts[owner];
    assert.ok(script !== undefined, `${name} claims script ${owner}, which does not exist`);
    assert.ok(script.includes(`tests/${name}`), `script ${owner} no longer names ${name}`);
    assert.ok(workflow.includes(`npm run ${owner}`), `CI no longer runs ${owner}`);
  }
});

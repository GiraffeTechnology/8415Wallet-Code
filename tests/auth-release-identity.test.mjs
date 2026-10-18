// SOURCE-ONLY CANDIDATE. Run only in the authorized non-Windows execution environment.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { captureAuthSource, parseAuthBuildArguments, validateAuthReleaseCheckout } from '../scripts/package/build-auth.mjs';
import { authSourcePolicy, parseAuthVerifyArguments, verifyAuthSourcePolicy } from '../scripts/package/verify-auth.mjs';
const commit = '1'.repeat(40), tree = '2'.repeat(40);
const source = { commit, commitTree: tree, indexTree: tree, tree, dirty: false };
const release = { release: true, expectedCommit: commit, expectedTree: tree };
test('release mode requires external commit and tree pins; development remains selectable', () => {
  assert.deepEqual(authSourcePolicy(), { release: false, expectedCommit: undefined, expectedTree: undefined });
  for (const options of [{ release: true }, { release: true, expectedCommit: commit }, { release: true, expectedTree: tree }])
    assert.throws(() => authSourcePolicy(options), /RELEASE_EXTERNAL_PINS_REQUIRED/);
  for (const value of ['', 'main', 'A'.repeat(40), '1'.repeat(39), null])
    assert.throws(() => authSourcePolicy({ expectedCommit: value }), /EXPECTED_SOURCE_COMMIT_REFUSED/);
});
test('release verification rejects old commit, wrong tree and dirty/index-divergent input', () => {
  assert.doesNotThrow(() => verifyAuthSourcePolicy(source, release));
  for (const changed of [{ commit: '3'.repeat(40) }, { tree: '3'.repeat(40) }, { dirty: true }, { indexTree: '3'.repeat(40) }, { commitTree: '3'.repeat(40) }])
    assert.throws(() => verifyAuthSourcePolicy({ ...source, ...changed }, release));
  assert.doesNotThrow(() => verifyAuthSourcePolicy({ ...source, dirty: true }, {}));
});
test('build/verify parsers preserve old commands and require unambiguous release pins', () => {
  assert.equal(parseAuthBuildArguments(['--offline']).offline, true);
  const pins = ['--release', '--expected-commit', commit, '--expected-tree', tree];
  assert.deepEqual(parseAuthBuildArguments(pins), { ...release, offline: false });
  assert.deepEqual(parseAuthVerifyArguments(['--directory', '/synthetic/runtime', ...pins]),
    { target: { kind: 'directory', path: '/synthetic/runtime' }, policy: release });
  assert.equal(parseAuthVerifyArguments([]).target.path, 'dist/auth-package-manifest.json');
  for (const args of [['--release'], ['--release', '--release'], ['--expected-tree'], ['--unknown'], ['--offline', '--offline']])
    assert.throws(() => parseAuthBuildArguments(args));
  for (const args of [['--manifest', 'a', '--directory', 'b'], ['--manifest'], ['--release'], ['--release', '--release']])
    assert.throws(() => parseAuthVerifyArguments(args));
});
function fixture(t) {
  const root = mkdtempSync(join(tmpdir(), 'wallet-release-identity-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '-q']); writeFileSync(join(root, 'input.txt'), 'synthetic immutable source\n'); git(['add', '.']);
  git(['-c', 'user.name=Synthetic Test', '-c', 'user.email=test@example.invalid', 'commit', '-qm', 'synthetic source']);
  const snapshot = captureAuthSource(root), pins = { release: true, expectedCommit: snapshot.commit, expectedTree: snapshot.tree };
  return { root, git, snapshot, pins };
}
test('clean checkout succeeds and untracked source is refused in release mode', t => {
  const f = fixture(t); assert.doesNotThrow(() => validateAuthReleaseCheckout(f.root, f.snapshot, f.pins));
  writeFileSync(join(f.root, 'untracked.txt'), 'synthetic untracked input\n');
  assert.throws(() => validateAuthReleaseCheckout(f.root, f.snapshot, f.pins), /RELEASE_UNTRACKED_SOURCE_REFUSED/);
  assert.doesNotThrow(() => validateAuthReleaseCheckout(f.root, f.snapshot, {}));
});
for (const flag of ['--assume-unchanged', '--skip-worktree']) test(`direct bytes reject edits hidden by ${flag}`, t => {
  const f = fixture(t); f.git(['update-index', flag, 'input.txt']);
  writeFileSync(join(f.root, 'input.txt'), 'synthetic changed source\n');
  assert.throws(() => validateAuthReleaseCheckout(f.root, f.snapshot, f.pins), /RELEASE_WORKTREE_MISMATCH/);
});
test('staged content is not accepted as the approved clean commit', t => {
  const f = fixture(t); writeFileSync(join(f.root, 'input.txt'), 'staged successor\n'); f.git(['add', 'input.txt']);
  assert.throws(() => validateAuthReleaseCheckout(f.root, captureAuthSource(f.root), f.pins));
});

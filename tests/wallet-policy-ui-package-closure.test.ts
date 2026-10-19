import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync } from 'node:fs';
import { dirname, resolve, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

const root = fileURLToPath(new URL('..', import.meta.url));
const retainedPublicModules = [
  'about-entry.mjs', 'about.mjs', 'forward-progress-client.mjs', 'forward-progress-panel.mjs',
  'task-observer-context.mjs', 'observation-source-contract.mjs',
  'observation-details-flow.mjs', 'observation-details-ui.mjs',
  'task-verification-policy-startup.mjs', 'task-verification-policy-entry.mjs',
  'task-verification-policy-client.mjs', 'task-verification-policy-wire.mjs',
  'task-verification-policy-ceremony.mjs', 'task-verification-policy-ui.mjs',
  'wallet-identity-display.mjs',
];

// Source-only closure assertions: runtime policy enforcement and deployed UI
// acceptance have separate tests. This file is reached by the existing TS glob.
function moduleClosure(entries: string[]): Set<string> {
  const seen = new Set<string>();
  const visit = (path: string): void => {
    const normalized = relative(root, path).split('\\').join('/');
    assert.ok(!normalized.startsWith('../') && !normalized.startsWith('/'));
    if (seen.has(normalized)) return;
    seen.add(normalized);
    // npm test precedes browser emit. Stop at the established generated-code
    // boundary; validateStaticTree checks these actual files after packaging.
    // The policy UI must still be reachable as a web source module below.
    if (normalized.startsWith('dist/browser/')) return;
    const source = ts.createSourceFile(path, readFileSync(path, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
    const follow = (specifier: ts.Expression): void => {
      assert.ok(ts.isStringLiteral(specifier), 'runtime imports must be literal');
      assert.ok(specifier.text.startsWith('.'), 'UI dependency must be local');
      visit(resolve(dirname(path), specifier.text));
    };
    const scan = (node: ts.Node): void => {
      if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) follow(node.moduleSpecifier);
      if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) {
        assert.equal(node.arguments.length, 1);
        const specifier = node.arguments[0];
        assert.ok(specifier);
        follow(specifier);
      }
      ts.forEachChild(node, scan);
    };
    scan(source);
  };
  entries.forEach(entry => visit(resolve(root, entry)));
  return seen;
}

test('foundation page reaches read-only policy settings without mounting task execution', () => {
  const html = readFileSync(resolve(root, 'web/index.html'), 'utf8');
  assert.match(html, /id=["']task-verification-policy-settings["']/);
  const scripts = [...html.matchAll(/<script\b[^>]*\bsrc=["']([^"']+)["'][^>]*>/g)]
    .map(match => resolve(root, 'web', match[1]!));
  assert.ok(scripts.length > 0);
  const reached = moduleClosure(scripts);
  assert.match(html, /<body[^>]*data-wallet-composition="foundation"/);
  assert.equal(reached.has('web/task-verification-policy-ui.mjs'), true);
  assert.equal(reached.has('web/task-verification-policy-entry.mjs'), true);
  assert.equal(reached.has('web/task-verification-policy-client.mjs'), true);
  assert.equal(reached.has('web/task-verification-policy-startup.mjs'), true);
  assert.equal(reached.has('web/task-ui.mjs'), false);
  assert.ok(reached.has('web/wallet-auth.mjs'));
  assert.ok(reached.has('web/about-entry.mjs'));
});

test('retained unmounted policy and read-only modules have a complete independent source and dev-server closure', () => {
  // Explicit retained-module roots are not evidence of production page mounting.
  // Do not enable business modules merely to satisfy this packaging assertion.
  const reached = moduleClosure(['web/wallet-auth.mjs', 'web/wallet-shell.mjs',
    'web/about-entry.mjs', 'web/task-ui.mjs', 'web/task-verification-policy-startup.mjs',
    'web/forward-progress-panel.mjs']);
  assert.ok(reached.has('web/task-verification-policy-ui.mjs'), 'retained policy startup must reach its controller');
  assert.ok(reached.has('web/locales/task-verification-policy.mjs'), 'policy locale catalog must ship in the same module graph');
  // This source-level regression runs before browser emit and never starts a
  // server. The separate HTTP closure test checks actual served bytes after emit.
  const server = readFileSync(resolve(root, 'scripts/controls/serve-browser.cjs'), 'utf8');
  for (const module of retainedPublicModules) {
    assert.ok(reached.has('web/' + module), `${module} must remain reachable from the explicit retained-module roots`);
    assert.ok(server.includes(`web.add('${module}')`), `${module} needs an explicit development-server allowlist entry`);
  }
});

test('DApp packaging retains tracked policy UI and validates module closure', () => {
  const source = readFileSync(resolve(root, 'scripts/package/dapp-release.mjs'), 'utf8');
  assert.match(source, /entry\.path\.startsWith\('web\/'\)/);
  assert.match(source, /DAPP_UNTRACKED_SOURCE_STAGE_REQUIRED/);
  assert.match(source, /DAPP_UNRESOLVED_IMPORT/);
  const build = readFileSync(resolve(root, 'scripts/package/build-dapp.mjs'), 'utf8');
  assert.match(build, /stagePublicWeb\(root, source, stage\)/);
  assert.match(build, /validateStaticTree\(stage\)/);
  assert.match(build, /DAPP_SOURCE_CHANGED_DURING_BUILD/);
});

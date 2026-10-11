/** Real loopback GETs for the integrated static module graph; no browser launch. */
import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { createServer } from 'node:net';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

test('every HTML module entry and its closure is served exactly, while unlisted sources remain refused', { timeout: 30000 }, async t => {
  const socket = createServer(); socket.listen(0, '127.0.0.1'); await once(socket, 'listening');
  const port = socket.address().port; await new Promise(resolve => socket.close(() => resolve()));
  const root = fileURLToPath(new URL('..', import.meta.url)), origin = `http://127.0.0.1:${port}`;
  const server = spawn(process.execPath, ['scripts/controls/serve-browser.cjs'], { cwd: root,
    env: { ...process.env, WALLET_BROWSER_PORT: String(port) }, stdio: ['ignore', 'pipe', 'pipe'] });
  try {
    await once(server.stdout, 'data');
    const entry = new URL('/web/index.html', origin);
    const document = await fetch(entry); assert.equal(document.status, 200);
    const html = await document.text(), pending = [], visited = new Set();
    for (const [tag] of html.matchAll(/<script\b[^>]*>/gi)) {
      if (!/\btype\s*=\s*(['"])module\1/i.test(tag)) continue;
      const source = tag.match(/\bsrc\s*=\s*(['"])([^'"]+)\1/i);
      assert.ok(source, 'Module entry must have an explicit source');
      const url = new URL(source[2], entry); assert.equal(url.origin, origin);
      pending.push(url.pathname);
    }
    assert.ok(pending.includes('/web/wallet-auth.mjs'));
    assert.ok(pending.includes('/web/task-ui.mjs'));
    const entryCount = pending.length;
    while (pending.length) {
      const path = pending.shift(); if (visited.has(path)) continue; visited.add(path);
      assert.ok(visited.size < 256, 'Bound the public module graph');
      const response = await fetch(`${origin}${path}`); assert.equal(response.status, 200, path);
      assert.match(response.headers.get('content-type') ?? '', /javascript/); const source = await response.text();
      const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
      function scan(node) {
        let specifier;
        if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) specifier = node.moduleSpecifier;
        else if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword && node.arguments.length === 1) specifier = node.arguments[0];
        if (specifier && ts.isStringLiteralLike(specifier)) {
          assert.ok(specifier.text.startsWith('.'), `Unexpected external runtime import in ${path}`);
          const next = new URL(specifier.text, `${origin}${path}`); assert.equal(next.origin, origin); pending.push(next.pathname);
        }
        ts.forEachChild(node, scan);
      }
      scan(ast);
    }
    t.diagnostic(`Verified ${entryCount} HTML module entries and ${visited.size} served modules`);
    assert.ok(visited.has('/web/method-change-ui.mjs'));
    assert.ok(visited.has('/web/task-authorization.mjs'));
    assert.ok(visited.has('/web/task-listing-results.mjs'));
    assert.ok(visited.has('/web/task-authorization-ui.mjs'));
    assert.ok(visited.has('/dist/browser/agent/receiptObservation.js'));
    for (const path of ['/web/method-change-unsafe.mjs', '/server/task-authorization.mjs', '/server/task-listing-runtime.mjs', '/src/agent/taskContract.ts',
      '/vendor/artfi-task-listing-runtime-1.0.0.tgz'])
      assert.equal((await fetch(`${origin}${path}`)).status, 404, path);
  } finally {
    const stopped = once(server, 'exit'); server.kill('SIGTERM'); await stopped;
  }
});

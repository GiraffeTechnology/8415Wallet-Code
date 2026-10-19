/** Test-only HTML compositions for explicit loopback fixture URLs.
 * Never rewrite the production index, grant backend authority or inject a login.
 * These are retained component regressions, not enabled-production acceptance.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const assetIds = ['asset-connect','asset-balance','asset-kind','asset-recipient','asset-amount','asset-contract',
  'asset-token-balance','asset-token-id','asset-prepare','asset-request-file','asset-review-file','asset-ack','asset-send',
  'asset-dismiss','asset-reconcile','asset-ack-terminal','asset-recovery-hash','asset-recover','asset-replacement',
  'nft-standard','nft-contract','nft-token-id','nft-read'];
const settlementIds = ['deployment','connect','tokenId','instant','settlement-kind','settlement-id','settlement-holder',
  'settlement-snapshot','settlement-deadline','settlement-commitment','settlement-reference','settlement-effective',
  'settlement-proof','settlement-reason','settlement-prepare','settlement-ack','settlement-send','settlement-dismiss',
  'settlement-reconcile','settlement-ack-terminal','settlement-recovery-hash','settlement-recover','settlement-replacement'];
const taskIds = ['task-refresh','task-authorize-form','task-code','task-ack','task-authorize','task-recheck',
  'task-cancel','task-recover','task-revoke'];
const avatarIds = ['tenant-avatar-file','tenant-avatar-save','tenant-avatar-cancel','tenant-avatar-remove'];
const compositions = Object.freeze({
  assets: { modules: ['external-assets.mjs'], ids: assetIds, routes: ['transfer','receive','activity','review','nft'], reads: [] },
  presentation: { modules: ['external-assets.mjs'], ids: [...assetIds, ...avatarIds], routes: ['transfer','receive','activity','review','nft'], reads: [] },
  privacy: { modules: ['app.mjs','external-assets.mjs','legacy-clearing.mjs'], ids: [...assetIds,...settlementIds],
    routes: ['native','settlement','transfer','receive','activity','review','nft'], reads: ['asset','history','ownership'] },
  settlement: { modules: ['app.mjs'], ids: settlementIds, routes: ['native','settlement'], reads: ['asset','settlements'] },
  task: { modules: ['task-ui.mjs'], ids: taskIds, routes: ['tasks','activity'], reads: [] },
});
function definition(name) {
  assert.equal(typeof name, 'string');
  assert.ok(Object.hasOwn(compositions, name), 'UNKNOWN_SYNTHETIC_COMPOSITION');
  return compositions[name];
}
function fixturePath(name) { definition(name); return `/web/__test-enabled-${name}.html`; }
function compositionEvidence(name) {
  const value = definition(name);
  return { kind: 'explicit-synthetic-enabled-component', name, fixturePath: fixturePath(name),
    extraModules: [...value.modules], productionComposition: 'foundation', productionIntegrationAccepted: false };
}
function enabledCompositionHtml(html, name) {
  const value = definition(name), ids = new Set(value.ids), found = new Set();
  assert.match(html, /<body[^>]*data-wallet-composition="foundation"/);
  const privateTag = html.match(/<[^>]*\bid="wallet-private"[^>]*>/)?.[0];
  assert.ok(privateTag && /\bhidden\b/.test(privateTag) && /\binert\b/.test(privateTag));
  let result = html.replace('data-wallet-composition="foundation"', `data-wallet-composition="synthetic-${name}" data-test-composition="${name}"`);
  result = result.replace(/<([a-z][a-z0-9]*)\b([^>]*)>/g, (tag, kind, attrs) => {
    const id = attrs.match(/\bid="([^"]+)"/)?.[1];
    const route = attrs.match(/\bdata-route="([^"]+)"/)?.[1];
    const read = attrs.match(/\bdata-read="([^"]+)"/)?.[1];
    if (id === 'public-home' || /\bclass="foundation-public-nav"/.test(attrs)) return `<${kind}${attrs} hidden>`;
    if (!attrs.includes('data-foundation-placeholder="true"') ||
      !(ids.has(id) || value.routes.includes(route) || value.reads.includes(read))) return tag;
    if (ids.has(id)) found.add(id);
    // Only explicitly selected placeholder controls become component inputs.
    // In particular wallet-private's login-controlled hidden/inert is untouched.
    const enabled = attrs.replace(/\sdata-foundation-placeholder="true"/g, '')
      .replace(/\saria-disabled="true"/g, '').replace(/\sdisabled(?=\s|$)/g, '');
    return `<${kind}${kind === 'form' ? enabled.replace(/\sinert(?=\s|$)/g, '') : enabled}>`;
  });
  assert.deepEqual([...found].sort(), [...ids].sort(), 'SYNTHETIC_CONTROL_INVENTORY_CHANGED');
  for (const module of value.modules) assert.equal(result.includes(`src="${module}"`), false, 'MODULE_ALREADY_MOUNTED');
  result = result.replace(/<!-- Foundation composition:[\s\S]*?-->/, `<!-- Explicit synthetic ${name} component fixture; production foundation remains unmodified. -->`);
  assert.equal(result.split('</body>').length, 2, 'SYNTHETIC_BODY_BOUNDARY_CHANGED');
  result = result.replace('</body>', value.modules.map(module => `<script type="module" src="${module}"></script>`).join('') + '</body>');
  assert.equal(result.match(/<[^>]*\bid="wallet-private"[^>]*>/)?.[0], privateTag);
  return result;
}
function serveEnabledComposition(req, res, { root, composition }) {
  if (req.url !== fixturePath(composition)) return false;
  const peer = req.socket?.remoteAddress;
  if (!['127.0.0.1','::1','::ffff:127.0.0.1'].includes(peer) ||
    !/^(?:127\.0\.0\.1|localhost):[0-9]+$/.test(req.headers.host ?? '') || !['GET','HEAD'].includes(req.method)) {
    res.writeHead(403); res.end(); return true;
  }
  const html = enabledCompositionHtml(fs.readFileSync(path.join(root, 'web/index.html'), 'utf8'), composition);
  res.setHeader('Content-Type','text/html; charset=utf-8');
  res.setHeader('Cache-Control','no-store');
  res.setHeader('X-Wallet-Test-Composition', composition);
  res.end(req.method === 'HEAD' ? undefined : html); return true;
}
module.exports = { fixturePath, compositionEvidence, enabledCompositionHtml, serveEnabledComposition };

import {applyImagePolicy} from '../../web/image-policy.mjs';
/** Offline static UI release management. No services, networking or credential writes. */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
const { canonicalEntryHtml } = createRequire(import.meta.url)('../../scripts/controls/canonical-entry.cjs');
import { constants, closeSync, fsyncSync, lstatSync, mkdirSync, openSync, readFileSync, readdirSync, readlinkSync, realpathSync, renameSync, rmSync, symlinkSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomBytes } from 'node:crypto';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isPublicFile, sha256, verifyDeliveryArchive } from '../../scripts/package/verify-delivery.mjs';
import { resolveReleaseProfile } from '../../web/release-profile.mjs';
const fail = (condition, code) => { if (!condition) throw Error(`DAPP_INSTALL_${code}`); };
const json = value => JSON.stringify(value, null, 2) + '\n';
const token = () => randomBytes(8).toString('hex');
const tenantPattern = /^[a-z][a-z0-9-]{0,47}$/;
const releasePattern = /^v[23]-[0-9a-f]{12}-[0-9a-f]{16}$/;
const hashPattern = /^[0-9a-f]{64}$/;
function found(path) { try { return lstatSync(path); } catch (error) { if (error.code === 'ENOENT') return null; throw error; } }
export function protectPath(path, { directory = false, ancestors = false } = {}) {
  const stat = lstatSync(path), uid = process.getuid?.();
  fail(!stat.isSymbolicLink() && (directory ? stat.isDirectory() : stat.isFile() && stat.nlink === 1)
    && (uid === undefined || stat.uid === uid || (ancestors && stat.uid === 0))
    && (!(stat.mode & 0o022) || (ancestors && stat.isDirectory() && stat.uid === 0 && (stat.mode & 0o1000)))
    && !(stat.mode & 0o6000) && (ancestors || !(stat.mode & 0o1000)) && (directory || !(stat.mode & 0o111))
    && realpathSync(path) === resolve(path), 'UNSAFE_PATH');
  return stat;
}
function protectAncestors(path) { let cursor = resolve(path); while (true) { protectPath(cursor, { directory: true, ancestors: true }); const next = dirname(cursor); if (next === cursor) break; cursor = next; } }
function writeExclusive(path, bytes) {
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o644);
  try { writeFileSync(fd, bytes); fsyncSync(fd); } finally { closeSync(fd); }
}
function syncDirectory(path) { const fd = openSync(path, constants.O_RDONLY | constants.O_DIRECTORY); try { fsyncSync(fd); } finally { closeSync(fd); } }
function withTarget(target, initial, operation) {
  fail(typeof target === 'string' && isAbsolute(target) && resolve(target) === target && /^\/[A-Za-z0-9_./-]+$/.test(target), 'TARGET_REFUSED');
  protectAncestors(dirname(target));
  if (!found(target)) { fail(initial, 'TARGET_MISSING'); mkdirSync(target, { mode: 0o755 }); }
  protectPath(target, { directory: true });
  const lock = join(target, '.install.lock'); const fd = openSync(lock, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
  try {
    if (!found(join(target, 'IDENTITY.json'))) fail(initial && readdirSync(target).every(name => name === '.install.lock'), 'UNMANAGED_TARGET_REFUSED');
    return operation();
  } finally { closeSync(fd); unlinkSync(lock); }
}
function readProtectedJson(path) { protectPath(path); return JSON.parse(readFileSync(path, 'utf8')); }
function boundary(config, tenant, profile) {
  const value = resolveReleaseProfile(config);
  fail(tenantPattern.test(tenant ?? '') && ['v2', 'v3'].includes(profile), 'TENANT_PROFILE_REQUIRED');
  fail(value.tenant.id === tenant && value.id === profile && value.deployment.url !== null, 'CONFIG_BOUNDARY_REFUSED');
  const url = new URL(value.deployment.url);
  fail(/^\/[A-Za-z0-9_./-]+$/.test(url.pathname), 'URL_PATH_REFUSED');
  // Canonical tenant entry also needs reviewed routing and journal migration.
  // Configuration schema support alone must not generate an incomplete install.
  fail(url.pathname.endsWith('/web/index.html'), 'CANONICAL_ENTRY_REQUIRES_REVIEWED_MIGRATION');
  return { schema: '8415wallet-dapp-install-identity/1', tenant, profile, deployment: value.deployment, origin: url.origin };
}
export function createDappConfig({ tenant, label, profile, environment, url, output, reservedPorts }) {
  const config = { schema: '8415wallet-release/1', product: '8415wallet', platform: '8415wallet.com', profile,
    tenant: { id: tenant, label }, deployment: { environment, url, ...(reservedPorts === undefined ? {} : { reservedPorts }) } };
  boundary(config, tenant, profile);
  fail(typeof output === 'string' && isAbsolute(output) && resolve(output) === output, 'CONFIG_OUTPUT_REFUSED');
  protectAncestors(dirname(output));
  const bytes = json(config); writeExclusive(output, bytes); syncDirectory(dirname(output));
  return { file: output, sha256: sha256(bytes), tenant, profile, entryUrl: url };
}
function loadBoundary(target, tenant, profile) {
  const identity = readProtectedJson(join(target, 'IDENTITY.json'));
  fail(identity.schema === '8415wallet-dapp-install-identity/1' && identity.tenant === tenant && identity.profile === profile, 'IDENTITY_MISMATCH');
  return identity;
}
function ensureReleases(target) {
  const path = join(target, 'releases'); if (!found(path)) mkdirSync(path, { mode: 0o755 });
  protectPath(path, { directory: true }); return path;
}
function inventory(root, prefix = '') {
  protectPath(join(root, prefix), { directory: true });
  return readdirSync(join(root, prefix)).sort().flatMap(name => {
    const path = prefix ? `${prefix}/${name}` : name; const stat = found(join(root, path));
    if (stat?.isDirectory()) return inventory(root, path);
    protectPath(join(root, path)); return [path];
  });
}
export const CANONICAL_SHELL_FILE = 'web/canonical-entry.html';
// Route reservations are deployment paths, not changes to account naming rules.
const canonicalRoutePattern = '^/(?!(?:auth|api|web|assets|dist|docs|scripts|server|tests|config|login|logout|register|about|settings|default|__proto__|constructor|prototype|v2|v3)$)[a-z][a-z0-9-]{0,47}$';
export function defaultCanonicalShell(identity, enabled = false) {
  fail(typeof enabled === 'boolean', 'CANONICAL_SHELL_OPTION_REFUSED');
  if (!enabled) return null;
  const url = new URL(identity.deployment.url);
  fail(identity.tenant === 'default' && ['v2','v3'].includes(identity.profile) &&
    identity.origin === url.origin && url.protocol === 'https:' && url.hostname === '8415wallet.com', 'CANONICAL_SHELL_BOUNDARY_REFUSED');
  // Existing helper grammar is intentionally retained. Other legacy paths stay
  // usable with this explicit opt-in disabled; no origin or journal is moved.
  fail(/^\/(?:[a-zA-Z0-9_-]+\/)*web\/index\.html$/.test(url.pathname), 'CANONICAL_SHELL_ENTRY_PATH_REFUSED');
  return { schema: '8415wallet-default-canonical-shell/1', ownerProfile: identity.profile,
    origin: url.origin, assetEntryPath: url.pathname, file: CANONICAL_SHELL_FILE };
}
export function canonicalShellBytes(entry, identity) {
  const shell = defaultCanonicalShell(identity, true);
  return Buffer.from(canonicalEntryHtml(entry.toString('utf8'), shell.assetEntryPath));
}
export function canonicalShellRequestAllowed(rawRequestUri) {
  return typeof rawRequestUri === 'string' && !/[^\x20-\x7e]/.test(rawRequestUri) && new RegExp(canonicalRoutePattern).test(rawRequestUri);
}
export function nginxStaticAllowlist(target, identity, paths, { canonicalShell = null } = {}) {
  fail(/^\/[A-Za-z0-9_./-]+$/.test(target), 'NGINX_TARGET_REFUSED');
  const url = new URL(identity.deployment.url);
  fail(url.pathname.endsWith('/web/index.html'), 'CANONICAL_ENTRY_REQUIRES_REVIEWED_MIGRATION');
  const base = url.pathname.slice(0, -'web/index.html'.length);
  fail(/^\/[A-Za-z0-9_./-]*$/.test(base), 'NGINX_URL_REFUSED');
  paths = [...paths];
  if (canonicalShell !== null) assert.deepEqual(canonicalShell, defaultCanonicalShell(identity, true), 'DAPP_INSTALL_CANONICAL_SHELL_IDENTITY_MISMATCH');
  fail(paths.includes(CANONICAL_SHELL_FILE) === (canonicalShell !== null), 'CANONICAL_SHELL_INVENTORY_REFUSED');
  const types = { html: 'text/html', js: 'application/javascript', mjs: 'application/javascript', css: 'text/css', json: 'application/json', svg: 'image/svg+xml', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', ico: 'image/x-icon', woff: 'font/woff', woff2: 'font/woff2', ttf: 'font/ttf', txt: 'text/plain', md: 'text/plain' };
  // Replace any historical operator-owned public directory location in this
  // same vhost with this exact tombstone; never append duplicate locations.
  const retiredDirectory = 'location = /.well-known/8415wallet-password-routing.json {\n    default_type application/json;\n    add_header Cache-Control "no-store" always;\n    add_header X-Content-Type-Options nosniff always;\n    return 404 \'{"error":"UNAVAILABLE"}\';\n}\n';
  const staticPlan = `# Review and include only inside the existing exact TLS vhost for ${url.origin}.\n# Static file allowlist only. No listener, auth route, TLS or fallback rewrite.\n# Replace the retired public directory location; do not append a duplicate.\n` + retiredDirectory + [...paths].sort().map(path => {
    fail(isPublicFile(path), 'NGINX_PUBLIC_PATH_REFUSED');
    return `location = ${base}${path} {\n    alias ${target}/current/public/${path};\n${path === CANONICAL_SHELL_FILE ? '    internal;\n' : ''}    default_type ${types[path.split('.').at(-1)]};\n    add_header Cache-Control "no-store" always;\n    add_header X-Content-Type-Options nosniff always;\n}\n`;
  }).join('\n');
  if (!canonicalShell) return staticPlan;
  // Exact existing tenant locations keep nginx precedence. The operator must
  // select only one default shell owner per vhost (not both V2 and V3 plans).
  const shellPath = `${base}${CANONICAL_SHELL_FILE}`;
  return staticPlan + `\n# SINGLE CANONICAL SHELL OWNER: ${identity.profile}. Replace the prior owner plan; never include two.\n# Public shell only: no account lookup, tenant mutation, auth or journal migration.\nlocation ~ "${canonicalRoutePattern}" {\n    if ($request_uri !~ "${canonicalRoutePattern}") { return 404; }\n    rewrite ^ ${shellPath} last;\n}\n`;
}
function currentRelease(target) {
  const path = join(target, 'current'), stat = found(path); if (!stat) return null;
  fail(stat.isSymbolicLink(), 'CURRENT_NOT_SYMLINK');
  const link = readlinkSync(path); fail(/^releases\//.test(link) && releasePattern.test(link.slice(9)), 'CURRENT_LINK_REFUSED');
  protectPath(join(target, link), { directory: true }); return link.slice(9);
}
export function verifyInstalledRelease(target, id, { expectedReceiptSha256, expectedTree, identity, allowLegacyPlan = false } = {}) {
  fail(releasePattern.test(id), 'RELEASE_ID_REFUSED');
  protectPath(target, { directory: true }); protectPath(join(target, 'releases'), { directory: true });
  const root = join(target, 'releases', id); protectPath(root, { directory: true });
  const receiptFile = join(root, 'INSTALL.json'); protectPath(receiptFile);
  const bytes = readFileSync(receiptFile), receipt = JSON.parse(bytes);
  if (expectedReceiptSha256 !== undefined) fail(hashPattern.test(expectedReceiptSha256) && sha256(bytes) === expectedReceiptSha256, 'RECEIPT_DIGEST_MISMATCH');
  if (expectedTree !== undefined) fail(/^[0-9a-f]{40}$/.test(expectedTree) && receipt.sourceTree === expectedTree, 'SOURCE_TREE_MISMATCH');
  fail(['8415wallet-dapp-installed-release/1','8415wallet-dapp-installed-release/2'].includes(receipt.schema) && receipt.release === id && receipt.identity && receipt.files && !Array.isArray(receipt.files), 'RECEIPT_REFUSED');
  if (identity) assert.deepEqual(receipt.identity, identity, 'DAPP_INSTALL_BOUNDARY_CHANGE_REFUSED');
  const paths = Object.keys(receipt.files).sort();
  fail(paths.length > 0 && paths.every(isPublicFile), 'PUBLIC_INVENTORY_REFUSED');
  assert.deepEqual(inventory(root).sort(), ['INSTALL.json', 'static-allowlist.nginx.conf', ...paths.map(path => `public/${path}`)].sort(), 'DAPP_INSTALL_COMPLETE_INVENTORY_MISMATCH');
  for (const path of paths) fail(hashPattern.test(receipt.files[path]) && sha256(readFileSync(join(root, 'public', path))) === receipt.files[path], 'PUBLIC_DIGEST_MISMATCH');
  const configBytes = readFileSync(join(root, 'public/web/release-config.json'));
  fail(hashPattern.test(receipt.configSha256 ?? '') && sha256(configBytes) === receipt.configSha256, 'CONFIG_DIGEST_MISMATCH');
  const config = JSON.parse(configBytes.toString('utf8'));
  assert.deepEqual(boundary(config, receipt.identity.tenant, receipt.identity.profile), receipt.identity, 'DAPP_INSTALL_CONFIG_BOUNDARY_MISMATCH');
  const entryHtml=readFileSync(join(root,'public/web/index.html'),'utf8');
  fail(entryHtml===applyImagePolicy(entryHtml,resolveReleaseProfile(config).imageOrigins),'IMAGE_CSP_CONFIG_MISMATCH');
  fail(receipt.schema === '8415wallet-dapp-installed-release/2' ? Object.hasOwn(receipt, 'canonicalShell') && receipt.canonicalShell !== null : !Object.hasOwn(receipt, 'canonicalShell'), 'CANONICAL_SHELL_SCHEMA_REFUSED');
  const canonicalShell = Object.hasOwn(receipt, 'canonicalShell') ? receipt.canonicalShell : null;
  if (canonicalShell !== null) {
    assert.deepEqual(canonicalShell, defaultCanonicalShell(receipt.identity, true), 'DAPP_INSTALL_CANONICAL_SHELL_IDENTITY_MISMATCH');
    fail(paths.includes(CANONICAL_SHELL_FILE), 'CANONICAL_SHELL_MISSING');
    fail(readFileSync(join(root, 'public', CANONICAL_SHELL_FILE)).equals(canonicalShellBytes(Buffer.from(entryHtml), receipt.identity)), 'CANONICAL_SHELL_DERIVATION_MISMATCH');
  }
  fail(hashPattern.test(receipt.uiArchiveSha256 ?? '') && /^[0-9a-f]{40}$/.test(receipt.sourceTree ?? ''), 'RECEIPT_PINS_REQUIRED');
  const expectedId = `${receipt.identity.profile}-${receipt.sourceTree.slice(0,12)}-${sha256(`${receipt.uiArchiveSha256}\n${receipt.configSha256}${canonicalShell ? '\ncanonical-shell/1' : ''}`).slice(0,16)}`;
  fail(id === expectedId, 'RELEASE_ID_BINDING_MISMATCH');
  const expectedPlan = nginxStaticAllowlist(target, receipt.identity, paths, { canonicalShell });
  const oldPlan = expectedPlan.replace('# Replace the retired public directory location; do not append a duplicate.\n', '')
    .replace(/location = \/\.well-known\/8415wallet-password-routing\.json \{\n[\s\S]*?\n\}\n/, '');
  const actualPlan = readFileSync(join(root, 'static-allowlist.nginx.conf'), 'utf8');
  // Upgrade may validate the exact prior static-only format before replacing
  // it. New activation and rollback must use the privacy-preserving plan.
  fail(actualPlan === expectedPlan || allowLegacyPlan && actualPlan === oldPlan, 'NGINX_PLAN_MISMATCH');
  return { receipt, receiptSha256: sha256(bytes) };
}
function syncTree(path) {
  for (const name of readdirSync(path)) if (lstatSync(join(path, name)).isDirectory()) syncTree(join(path, name));
  syncDirectory(path);
}
function switchCurrent(target, release) {
  const pending = join(target, `.current-${token()}`); symlinkSync(`releases/${release}`, pending);
  try { renameSync(pending, join(target, 'current')); syncDirectory(target); } finally { if (found(pending)) unlinkSync(pending); }
}
function releaseInput({ archive, expectedSha256, expectedTree, tenant, profile, config, canonicalShell: enableCanonicalShell = false }) {
  const delivery = verifyDeliveryArchive(archive, { expectedSha256, expectedTree });
  if (typeof config === 'string') { fail(readFileSync(config).length <= 8192, 'CONFIG_TOO_LARGE'); config = JSON.parse(readFileSync(config, 'utf8')); }
  const identity = boundary(config, tenant, profile), configBytes = Buffer.from(json(config));
  fail(configBytes.length <= 8192, 'CONFIG_TOO_LARGE');
  const dapp = delivery.dapps[profile];
  const files = new Map(dapp.runtime); files.set('web/release-config.json', { bytes: configBytes, mode: 0o644 });
  const entry=files.get('web/index.html');fail(entry,'IMAGE_ENTRY_REQUIRED');
  files.set('web/index.html',{...entry,bytes:Buffer.from(applyImagePolicy(entry.bytes.toString('utf8'),resolveReleaseProfile(config).imageOrigins))});
  const canonicalShell = defaultCanonicalShell(identity, enableCanonicalShell);
  fail(!files.has(CANONICAL_SHELL_FILE), 'CANONICAL_SHELL_RESERVED_FILE');
  if (canonicalShell) files.set(CANONICAL_SHELL_FILE, { bytes: canonicalShellBytes(files.get('web/index.html').bytes, identity), mode: 0o644 });
  const id = `${profile}-${expectedTree.slice(0, 12)}-${sha256(`${delivery.release.artifacts[profile].sha256}\n${sha256(configBytes)}${canonicalShell ? '\ncanonical-shell/1' : ''}`).slice(0, 16)}`;
  return { delivery, identity, dapp, files, id, configBytes, canonicalShell };
}
export function planDapp(input) {
  const { identity, files, canonicalShell } = releaseInput(input), { target, output, tenant, profile } = input;
  fail(typeof target === 'string' && isAbsolute(target) && resolve(target) === target && /^\/[A-Za-z0-9_./-]+$/.test(target), 'TARGET_REFUSED');
  protectAncestors(dirname(target));
  if (found(target)) {
    protectPath(target, { directory: true });
    if (found(join(target, 'IDENTITY.json'))) assert.deepEqual(loadBoundary(target, tenant, profile), identity, 'DAPP_INSTALL_BOUNDARY_CHANGE_REFUSED');
    const prior = currentRelease(target);
    if (prior) {
      const checkedPrior = verifyInstalledRelease(target, prior, { identity, allowLegacyPlan: true });
      requireCanonicalShellUpgradeMode(checkedPrior.receipt, input.canonicalShell);
    }
  }
  fail(typeof output === 'string' && isAbsolute(output) && resolve(output) === output, 'PLAN_OUTPUT_REFUSED');
  protectAncestors(dirname(output));
  const plan = nginxStaticAllowlist(target, identity, files.keys(), { canonicalShell }); writeExclusive(output, plan); syncDirectory(dirname(output));
  return { file: output, sha256: sha256(plan), entryUrl: identity.deployment.url, target, changesApplied: false, canonicalShell };
}
export function requireCanonicalShellUpgradeMode(priorReceipt, requestedMode) {
  // Omitting the opt-in flag must not remove a shell still referenced by the
  // existing site plan. An explicit true/false is a deliberate role decision.
  fail(!priorReceipt.canonicalShell || requestedMode !== undefined, 'CANONICAL_SHELL_UPGRADE_MODE_REQUIRED');
}
export function installDapp(input) {
  const { target, tenant, profile, expectedSha256, expectedTree, upgrade = false } = input;
  const { delivery, identity, dapp, files, id, configBytes, canonicalShell } = releaseInput(input);
  return withTarget(target, !upgrade, () => {
    const prior = currentRelease(target);
    fail(upgrade ? prior !== null : prior === null, upgrade ? 'UPGRADE_REQUIRES_CURRENT' : 'USE_EXPLICIT_UPGRADE');
    const identityPath = join(target, 'IDENTITY.json');
    if (found(identityPath)) assert.deepEqual(loadBoundary(target, tenant, profile), identity, 'DAPP_INSTALL_BOUNDARY_CHANGE_REFUSED');
    if (prior) {
      const checkedPrior = verifyInstalledRelease(target, prior, { identity, allowLegacyPlan: true });
      requireCanonicalShellUpgradeMode(checkedPrior.receipt, input.canonicalShell);
    }
    const releases = ensureReleases(target), releasePath = join(releases, id);
    const receipt = { schema: canonicalShell ? '8415wallet-dapp-installed-release/2' : '8415wallet-dapp-installed-release/1', release: id, identity, sourceTree: expectedTree,
      ...(canonicalShell ? { canonicalShell } : {}),
      kitSha256: expectedSha256, uiArchiveSha256: delivery.release.artifacts[profile].sha256,
      baseConfigSha256: dapp.release.build.configSha256, configSha256: sha256(configBytes),
      files: Object.fromEntries([...files].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).map(([path, entry]) => [path, sha256(entry.bytes)])) };
    const receiptBytes = Buffer.from(json(receipt)), receiptSha256 = sha256(receiptBytes);
    if (!found(releasePath)) {
      const staging = join(releases, `.staging-${token()}`); mkdirSync(staging, { mode: 0o755 });
      try {
        for (const [path, entry] of files) { fail(isPublicFile(path), 'PUBLIC_PATH_REFUSED'); mkdirSync(dirname(join(staging, 'public', path)), { recursive: true, mode: 0o755 }); writeExclusive(join(staging, 'public', path), entry.bytes); }
        writeExclusive(join(staging, 'INSTALL.json'), receiptBytes);
        writeExclusive(join(staging, 'static-allowlist.nginx.conf'), nginxStaticAllowlist(target, identity, files.keys(), { canonicalShell }));
        syncTree(staging); renameSync(staging, releasePath); syncDirectory(releases);
      } finally { if (found(staging)) rmSync(staging, { recursive: true, force: true }); }
    }
    verifyInstalledRelease(target, id, { expectedReceiptSha256: receiptSha256, expectedTree, identity });
    if (!found(identityPath)) writeExclusive(identityPath, json(identity));
    switchCurrent(target, id);
    return { release: id, previous: prior, sourceTree: expectedTree, receiptSha256, entryUrl: identity.deployment.url, nginxPlan: join(releasePath, 'static-allowlist.nginx.conf'), canonicalShell };
  });
}
export function rollbackDapp({ target, tenant, profile, release, expectedReceiptSha256, expectedTree }) {
  fail(hashPattern.test(expectedReceiptSha256 ?? '') && /^[0-9a-f]{40}$/.test(expectedTree ?? ''), 'ROLLBACK_EXTERNAL_PINS_REQUIRED');
  return withTarget(target, false, () => {
    const identity = loadBoundary(target, tenant, profile), previous = currentRelease(target); fail(previous, 'CURRENT_REQUIRED');
    const checked = verifyInstalledRelease(target, release, { expectedReceiptSha256, expectedTree, identity });
    switchCurrent(target, release);
    return { release, previous, sourceTree: expectedTree, receiptSha256: checked.receiptSha256, entryUrl: identity.deployment.url };
  });
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const [command, ...args] = process.argv.slice(2), options = {};
  const common = ['--tenant', '--profile', '--target', '--tree'];
  const installKeys = [...common, '--archive', '--sha256', '--config', '--canonical-shell'];
  const keys = command === 'config' ? ['--tenant', '--label', '--profile', '--environment', '--url', '--output', '--reserved-ports']
    : command === 'rollback' ? [...common, '--release', '--receipt-sha256'] : command === 'plan' ? [...installKeys, '--output'] : installKeys;
  fail(['config', 'plan', 'install', 'upgrade', 'rollback'].includes(command), 'COMMAND_REFUSED');
  for (let i = 0; i < args.length; i += 2) { const key = args[i]; fail(keys.includes(key) && args[i + 1] && !options[key], 'ARGUMENT_REFUSED'); options[key] = args[i + 1]; }
  fail(keys.filter(key => key !== '--reserved-ports' && key !== '--canonical-shell').every(key => options[key]), 'EXPLICIT_ARGUMENTS_REQUIRED');
  fail(options['--canonical-shell'] === undefined || ['true','false'].includes(options['--canonical-shell']), 'CANONICAL_SHELL_OPTION_REFUSED');
  const input = { canonicalShell: options['--canonical-shell'] === undefined ? undefined : options['--canonical-shell'] === 'true', target: options['--target'], tenant: options['--tenant'], profile: options['--profile'], expectedTree: options['--tree'] };
  const result = command === 'config' ? createDappConfig({ tenant: options['--tenant'], label: options['--label'], profile: options['--profile'], environment: options['--environment'], url: options['--url'], output: options['--output'], reservedPorts: options['--reserved-ports'] === undefined ? undefined : options['--reserved-ports'] === 'none' ? [] : options['--reserved-ports'].split(',').map(Number) })
    : command === 'rollback' ? rollbackDapp({ ...input, release: options['--release'], expectedReceiptSha256: options['--receipt-sha256'] })
    : (command === 'plan' ? planDapp : installDapp)({ ...input, output: options['--output'], archive: resolve(options['--archive']), expectedSha256: options['--sha256'], config: resolve(options['--config']), upgrade: command === 'upgrade' });
  console.log(json(result));
}

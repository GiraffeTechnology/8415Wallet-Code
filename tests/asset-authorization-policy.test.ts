import test from 'node:test';
import assert from 'node:assert/strict';
import { ASSET_POLICY_OPERATIONS, normalizeAssetAuthorizationPolicy, resolveAssetAuthorization } from '../src/agent/assetAuthorization.ts';
const path = ['all', 'category-a', 'subcategory-a', 'asset-a'];
function policy() {
  return { schema: '8415-asset-authorization/1', revision: '7', allowAgent: true, revoked: false, expiresAt: '200',
    root: { id: 'all', level: 'all', enabled: false, operations: { 'erc8183:fund': true }, children: [
      { id: 'category-a', level: 'category', enabled: false, operations: {}, children: [
        { id: 'subcategory-a', level: 'subcategory', enabled: false, operations: {}, children: [
          { id: 'asset-a', level: 'asset', enabled: true, operations: {}, children: [] },
          { id: 'asset-b', level: 'asset', enabled: false, operations: {}, children: [] },
        ] },
      ] },
    ] } };
}
test('OFF branches expose children, an ON leaf authorizes only its own asset', () => {
  const p = policy(), a = resolveAssetAuthorization(p, path, 'erc8183:fund', 100n);
  assert.equal(a.policyAllows, true); assert.equal(a.assetAuthorizationSource, 'asset-a');
  assert.deepEqual(a.branchExpanded, [true, true, true]); assert.equal(a.executable, false);
  assert.equal(resolveAssetAuthorization(p, [...path.slice(0, 3), 'asset-b'], 'erc8183:fund', 100n).policyAllows, false);
});
test('ancestor blanket ON overrides stored descendant asset OFF, but never operation overrides', () => {
  const p = policy(); p.root.enabled = true;
  const category = p.root.children[0]!, sub = category.children[0]!, leaf = sub.children[0]!;
  leaf.enabled = false;
  assert.equal(resolveAssetAuthorization(p, path, 'erc8183:fund', 100n).policyAllows, true);
  leaf.operations = { 'erc8183:fund': false } as typeof leaf.operations;
  const a = resolveAssetAuthorization(p, path, 'erc8183:fund', 100n);
  assert.equal(a.assetAuthorized, true); assert.equal(a.operationEnabled, false); assert.equal(a.policyAllows, false);
  assert.equal(a.operationSettingSource, 'asset-a'); assert.equal(a.operationInherited, false);
  assert.deepEqual(a.branchExpanded, [false, false, false]);
});
test('operation settings inherit nearest explicit parent or child override independently', () => {
  const p = policy(), category = p.root.children[0]!, sub = category.children[0]!;
  category.operations = { 'erc8183:fund': false };
  assert.equal(resolveAssetAuthorization(p, path, 'erc8183:fund', 100n).policyAllows, false);
  sub.operations = { 'erc8183:fund': true };
  const a = resolveAssetAuthorization(p, path, 'erc8183:fund', 100n);
  assert.equal(a.policyAllows, true); assert.equal(a.operationSettingSource, 'subcategory-a'); assert.equal(a.operationInherited, true);
});
test('overall agent OFF, revoke and expiry cannot be overridden by an asset blanket', () => {
  for (const delta of [{ allowAgent: false }, { revoked: true }, { expiresAt: '100' }]) {
    const p = { ...policy(), ...delta }; p.root.enabled = true;
    assert.equal(resolveAssetAuthorization(p, path, 'erc8183:fund', 100n).policyAllows, false);
  }
});
test('unknown operations, substituted paths, duplicated nodes and malformed revisions refuse', () => {
  assert.throws(() => resolveAssetAuthorization(policy(), path, 'arbitrary-call' as never, 100n), /ASSET_POLICY_REFUSED/);
  assert.throws(() => resolveAssetAuthorization(policy(), ['all', 'other', 'subcategory-a', 'asset-a'], 'erc8183:fund', 100n));
  assert.throws(() => normalizeAssetAuthorizationPolicy({ ...policy(), revision: '07' }));
  const p = policy(); p.root.children[0]!.id = 'all'; assert.throws(() => normalizeAssetAuthorizationPolicy(p));
});
test('getters, sparse arrays and extra fields are rejected without invoking supplied code', () => {
  let called = false;
  assert.throws(() => normalizeAssetAuthorizationPolicy({ ...policy(), get allowAgent() { called = true; return true; } }));
  assert.equal(called, false);
  const accessorPath = [...path]; Object.defineProperty(accessorPath, '1', { get() { called = true; return 'category-a'; } });
  assert.throws(() => resolveAssetAuthorization(policy(), accessorPath, 'erc8183:fund', 100n));
  assert.equal(called, false);
  const p = policy(); delete p.root.children[0];
  assert.throws(() => normalizeAssetAuthorizationPolicy(p));
  assert.throws(() => normalizeAssetAuthorizationPolicy({ ...policy(), approved: true }));
});
test('normalization copies and freezes policy; no scope evaluation mutates grant or input', () => {
  const p = policy(), before = JSON.stringify(p), n = normalizeAssetAuthorizationPolicy(p);
  assert.ok(Object.isFrozen(n.root.children)); resolveAssetAuthorization(p, path, 'erc8183:fund', 100n);
  assert.equal(JSON.stringify(p), before); assert.notEqual(n.root, p.root);
});

/** Missing settings are defaults, not an authenticated owner-save or task grant. */
function initialPolicy() {
  return { schema: '8415-asset-authorization/1', revision: '0', revoked: false, expiresAt: '200',
    root: { id: 'all', level: 'all', children: [
      { id: 'category-a', level: 'category', children: [
        { id: 'subcategory-a', level: 'subcategory', children: [
          { id: 'asset-a', level: 'asset', children: [] },
        ] },
      ] },
    ] } };
}
test('omitted Allow Agent and every asset-tree toggle initially resolve ON', () => {
  const raw = initialPolicy(), before = JSON.stringify(raw);
  const n = normalizeAssetAuthorizationPolicy(raw);
  assert.equal(n.allowAgent, true); assert.equal(n.revision, '0');
  let node = n.root;
  for (let i = 0; i < path.length; i++) {
    assert.equal(node.id, path[i]); assert.equal(node.enabled, true);
    assert.deepEqual(node.operations, {});
    if (i < path.length - 1) node = node.children[0]!;
  }
  assert.equal(JSON.stringify(raw), before);
  assert.deepEqual(normalizeAssetAuthorizationPolicy(n), n);
});
test('every catalog operation defaults ON without inventing an explicit child override', () => {
  for (const operation of ASSET_POLICY_OPERATIONS) {
    const a = resolveAssetAuthorization(initialPolicy(), path, operation, 100n);
    assert.equal(a.operationEnabled, true, operation);
    assert.equal(a.operationSettingSource, null);
    assert.equal(a.assetAuthorizationSource, 'all');
    assert.equal(a.policyAllows, true); assert.equal(a.executable, false);
  }
});
test('default operation ON also applies to an explicit policy with empty operation maps', () => {
  const p = policy();
  const a = resolveAssetAuthorization({ ...p, root: { ...p.root, operations: {} } }, path, 'wallet:native-transfer', 100n);
  assert.equal(a.policyAllows, true); assert.equal(a.operationEnabled, true);
  assert.equal(a.operationSettingSource, null); assert.equal(a.assetAuthorizationSource, 'asset-a');
});
test('saved Allow Agent OFF and each explicit asset OFF survive normalization and reload', () => {
  const p = policy(); p.allowAgent = false;
  p.root.children[0]!.children[0]!.children[0]!.enabled = false;
  const n = normalizeAssetAuthorizationPolicy(JSON.parse(JSON.stringify(p)));
  assert.equal(n.allowAgent, false); assert.equal(n.root.enabled, false);
  assert.equal(n.root.children[0]!.enabled, false);
  assert.equal(n.root.children[0]!.children[0]!.enabled, false);
  assert.equal(n.root.children[0]!.children[0]!.children[0]!.enabled, false);
  assert.equal(resolveAssetAuthorization(n, path, 'erc8183:fund', 100n).policyAllows, false);
});
test('missing child operation inherits saved parent OFF instead of materializing default ON overrides', () => {
  const p = initialPolicy();
  const saved = { ...p, revision: '1', root: { ...p.root, operations: { 'wallet:native-transfer': false } } };
  const n = normalizeAssetAuthorizationPolicy(saved);
  assert.deepEqual(n.root.children[0]!.operations, {});
  const a = resolveAssetAuthorization(n, path, 'wallet:native-transfer', 100n);
  assert.equal(a.operationEnabled, false); assert.equal(a.operationSettingSource, 'all');
  assert.equal(a.operationInherited, true); assert.equal(a.policyAllows, false);
  // An unrelated operation retains its default rather than being overwritten.
  assert.equal(resolveAssetAuthorization(n, path, 'wallet:receive', 100n).operationEnabled, true);
});
test('default ON never fills lifecycle identity fields or accepts malformed present toggles', () => {
  for (const value of [null, undefined, 0, 1, 'ON', 'false']) {
    assert.throws(() => normalizeAssetAuthorizationPolicy({ ...initialPolicy(), allowAgent: value }));
    const p = initialPolicy();
    assert.throws(() => normalizeAssetAuthorizationPolicy({ ...p, root: { ...p.root, enabled: value } }));
    assert.throws(() => normalizeAssetAuthorizationPolicy({ ...p, root: { ...p.root, operations: { 'wallet:receive': value } } }));
  }
  for (const missing of ['revision', 'revoked', 'expiresAt', 'root']) {
    const p = { ...initialPolicy() } as Record<string, unknown>; delete p[missing];
    assert.throws(() => normalizeAssetAuthorizationPolicy(p));
  }
  for (const delta of [{ revoked: true }, { expiresAt: '100' }]) {
    assert.equal(resolveAssetAuthorization({ ...initialPolicy(), ...delta }, path, 'wallet:receive', 100n).policyAllows, false);
  }
});
test('optional default fields still reject accessors and unknown keys without invocation', () => {
  let called = false;
  const p = initialPolicy();
  assert.throws(() => normalizeAssetAuthorizationPolicy({ ...p, root: { ...p.root,
    get enabled() { called = true; return true; } } }));
  assert.equal(called, false);
  assert.throws(() => normalizeAssetAuthorizationPolicy({ ...p, extraDefault: true }));
  assert.throws(() => normalizeAssetAuthorizationPolicy({ ...p, root: { ...p.root, extraDefault: true } }));
});

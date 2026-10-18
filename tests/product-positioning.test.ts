import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';

const read = (path: string) => readFileSync(new URL(`../${path}`, import.meta.url), 'utf8');
const prose = (value: string) => value.replace(/\s+/g, ' ');

for (const path of ['README.md', 'AGENTS.md', 'docs/ERC-8415-Wallet-PRD.md']) {
  test(`${path}: general-wallet identity, standards compatibility and versioned DApp scope agree`, () => {
    const text = prose(read(path));
    assert.match(text, /8415wallet/);
    assert.match(text, /general-purpose (?:application-layer )?wallet/);
    assert.match(text, /existing wallet and asset standards/);
    assert.match(text, /native ERC-8415|native \[ERC-8415/);
    assert.match(text, /8415wallet\.com/);
    assert.match(text, /\bV2\b/);
    assert.match(text, /\bV3\b/);
    if (path === 'AGENTS.md') {
      assert.match(text, /Tenant deployments are configurations, not separate products/);
      assert.match(text, /Do not publish real tenant identities/);
    } else if (path === 'docs/ERC-8415-Wallet-PRD.md') {
      assert.match(text, /Wallet-specific deployment bindings remain private/);
    }
    assert.match(text, /DApp Beta|DApp[^.]*Beta/);
    assert.match(text, /STANDARDS-COMPATIBILITY\.md/);
    assert.doesNotMatch(text, /It is not a generic NFT wallet|a generic NFT wallet;/);
  });
}

test('compatibility matrix separates implemented operations from universal validation', () => {
  const text = prose(read('docs/STANDARDS-COMPATIBILITY.md'));
  for (const standard of ['ERC-20', 'ERC-721', 'ERC-1155', 'ERC-165', 'ERC-55', 'EIP-1193', 'EIP-712', 'ERC-1271', 'ERC-8415']) {
    assert.ok(text.includes(standard), standard);
  }
  assert.match(text, /does not claim exhaustive validation/);
  assert.match(text, /integer base units/);
  assert.match(text, /upgradeable proxy implementation/);
});

test('native PRD requirements hold, and port reservations stay out of them', () => {
  const prd = read('docs/ERC-8415-Wallet-PRD.md');
  for (const marker of ['# 1.', '# 2.', '# 3.', '# 4.', '# 5.', '# 6.', '# 7.', '# 8.', '# 9.', '# 10.']) assert.ok(prd.includes(marker), marker);
  for (let n = 1; n <= 24; n++) assert.ok(prd.includes(`| W-${String(n).padStart(2, '0')} |`));
  for (const identifier of ['0x6309e170', '0xf4a7d71b', 'beginSettlement', 'finalizeSettlement', 'cancelSettlement', '128']) assert.ok(prd.includes(identifier), identifier);
  // Which ports an environment reserves is deployment configuration, not a
  // product requirement. Product instructions must not prescribe a fixed list.
  const instructions = prose(read('AGENTS.md'));
  assert.doesNotMatch(instructions, /\b443\b/);
  assert.doesNotMatch(instructions, /reserved for SSH|port reservation/);

  // What the product does own is that the serving address is part of stored
  // state, which holds whatever port an environment happens to use.
  assert.match(instructions, /A web origin is scheme, host \*\*and port\*\*/);
  assert.match(instructions, /strands them all/);

  const installer = prose(read('docs/DAPP-INSTALL.md'));
  assert.match(installer, /deployment\.reservedPorts/);
  assert.doesNotMatch(installer, /For CTYun the list includes 443|CTYun reserves TCP 443/);
});

test('current complete PRD bytes and execution-entry pin stay synchronized', () => {
  const bytes = readFileSync(new URL('../docs/ERC-8415-Wallet-PRD.md', import.meta.url));
  const expectedHash = 'de80f078aead881a35f42c52b8aa99bd0d37dbbb36640f059f7eef134f9ef5e3';
  assert.equal(bytes.length, 110880);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), expectedHash);
  assert.ok(read('AGENTS.md').includes(expectedHash));
  const text = bytes.toString('utf8');
  for (const marker of ['# 8415wallet Beta 2.0 Product Requirements',
    '## 6.5.1 Historical observation identity and read-only compatibility',
    '### 10.7.1 Historical observation details and source states',
    '## 10.8 Confidentiality and release acceptance']) assert.ok(text.includes(marker), marker);
});

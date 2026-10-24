/** Run only after the corresponding private DApp build, with its full source archive. */
import { execFileSync } from 'node:child_process';
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { tmpdir } from 'node:os';
import { deterministicArchive } from './dapp-release.mjs';
import { componentInventory, loadPrivateProjection, verifyPublicComponent } from './public-component.mjs';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--profile' || !['v2', 'v3'].includes(args[1])) throw Error('PUBLIC_COMPONENT_ARGUMENT_REFUSED');
const profile = args[1], root = process.cwd();
execFileSync(process.execPath, ['scripts/package/verify-dapp.mjs', '--profile', profile], { cwd: root, stdio: 'inherit' });
const projection = loadPrivateProjection(root, profile);
const stage = mkdtempSync(join(tmpdir(), 'wallet-public-component-'));
try {
  for (const [path, entry] of projection.entries) {
    const target = join(stage, path); mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, entry.bytes); chmodSync(target, entry.mode);
  }
  const artifact = `8415wallet-install-${profile}-${projection.release.version}.tar.gz`;
  const output = join(root, 'dist', artifact), sha256 = deterministicArchive(stage, output);
  const bytes = readFileSync(output);
  const manifest = { artifact, bytes: bytes.length, sha256, release: projection.release, members: componentInventory(projection.entries) };
  verifyPublicComponent(bytes, manifest, projection);
  writeFileSync(join(root, 'dist', `public-${profile}-component-manifest.json`), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(JSON.stringify({ artifact, bytes: bytes.length, sha256, source: projection.release.source }));
} finally { rmSync(stage, { recursive: true, force: true }); }

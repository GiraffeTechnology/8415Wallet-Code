/** Private QA verification binds the public subset to the unchanged full-source proof. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { loadPrivateProjection, verifyPublicComponent } from './public-component.mjs';
const args = process.argv.slice(2);
if (args.length !== 2 || args[0] !== '--profile' || !['v2', 'v3'].includes(args[1])) throw Error('PUBLIC_COMPONENT_ARGUMENT_REFUSED');
const profile = args[1], root = process.cwd();
execFileSync(process.execPath, ['scripts/package/verify-dapp.mjs', '--profile', profile], { cwd: root, stdio: 'inherit' });
const manifest = JSON.parse(readFileSync(join(root, 'dist', `public-${profile}-component-manifest.json`)));
const projection = loadPrivateProjection(root, profile);
assert.equal(manifest.artifact, `8415wallet-install-${profile}-${projection.release.version}.tar.gz`);
console.log(JSON.stringify(verifyPublicComponent(readFileSync(join(root, 'dist', manifest.artifact)), manifest, projection)));

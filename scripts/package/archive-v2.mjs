/** Shared strict archive reader, copied without private product manifests. */
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
import {closeSync,fstatSync,lstatSync,mkdtempSync,openSync,readSync,rmSync,writeFileSync,writeSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,resolve} from 'node:path';
import {safePath} from './verify-auth-v2.mjs';
const fail=(ok,code)=>{if(!ok)throw Error('V2_ARCHIVE_'+code);};
export function withArchiveTar(archive, inspect, verifyDigest) {
  const spool = mkdtempSync(join(tmpdir(), 'wallet-auth-verify-spool-'));
  const tarPath = join(spool, 'payload.tar');
  let input, descriptor;
  try {
    const inputPath = join(spool, 'input.tar.gz');
    const digest = createHash('sha256');
    if (Buffer.isBuffer(archive)) {
      fail(archive.length <= 128 * 1024 * 1024, 'ARCHIVE_TOO_LARGE');
      writeFileSync(inputPath, archive, { flag: 'wx', mode: 0o600 }); digest.update(archive);
    } else {
      const source = openSync(resolve(archive), 'r');
      let copy;
      try {
        fail(fstatSync(source).isFile() && fstatSync(source).size <= 128 * 1024 * 1024, 'ARCHIVE_TOO_LARGE');
        copy = openSync(inputPath, 'wx', 0o600);
        const block = Buffer.allocUnsafe(65536); let total = 0;
        for (let count; (count = readSync(source, block, 0, block.length, null)) > 0;) {
          total += count; fail(total <= 128 * 1024 * 1024, 'ARCHIVE_TOO_LARGE');
          digest.update(block.subarray(0, count));
          for (let written = 0; written < count;) written += writeSync(copy, block, written, count - written);
        }
      } finally { if (copy !== undefined) closeSync(copy); closeSync(source); }
    }
    if (verifyDigest) verifyDigest(digest.digest('hex'));
    input = openSync(inputPath, 'r');
    const output = openSync(tarPath, 'wx', 0o600);
    try {
      const script = `const {createReadStream,createWriteStream}=require('node:fs');const {createGunzip}=require('node:zlib');const {Transform}=require('node:stream');const {pipeline}=require('node:stream/promises');let n=0;pipeline(createReadStream(null,{fd:0,autoClose:false}),createGunzip(),new Transform({transform(b,e,c){n+=b.length;c(n>268435456?Error('AUTH_PACKAGE_TAR_LENGTH_REFUSED'):null,b)}}),createWriteStream(null,{fd:1,autoClose:false})).catch(e=>{console.error(e.message);process.exitCode=1});`;
      const env = { ...process.env, NODE_OPTIONS: '--max-old-space-size=96' }; delete env.NODE_PATH;
      execFileSync(process.execPath, ['-e', script], { env, stdio: [input, output, 'pipe'], timeout: 60000, maxBuffer: 65536 });
    } finally { closeSync(output); }
    descriptor = openSync(tarPath, 'r');
    const read = (offset, size) => {
      const bytes = Buffer.allocUnsafe(size); let received = 0;
      while (received < size) { const n = readSync(descriptor, bytes, received, size - received, offset + received); fail(n > 0, 'TAR_LENGTH_REFUSED'); received += n; }
      return bytes;
    };
    return inspect(read, fstatSync(descriptor).size);
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
    if (input !== undefined) closeSync(input);
    rmSync(spool, { recursive: true, force: true });
  }
}
function scanDeliveryTar(read, length) {
  fail(length % 512 === 0, 'TAR_LENGTH_REFUSED');
  const zeroes = (start, end, code) => {
    for (let at = start; at < end; at += 65536) fail(read(at, Math.min(65536, end - at)).every(byte => byte === 0), code);
  };
  const entries = new Map(), seen = new Map(); let offset = 0, terminated = false;
  const string = buffer => {
    const end = buffer.indexOf(0); const value = end < 0 ? buffer : buffer.subarray(0, end);
    fail([...value].every(byte => byte >= 32 && byte <= 126), 'TAR_STRING_REFUSED');
    fail(end < 0 || buffer.subarray(end).every(byte => byte === 0), 'TAR_STRING_PADDING_REFUSED');
    return value.toString('ascii');
  };
  const octal = buffer => { const value = buffer.toString('ascii').replace(/[\0 ]+$/, '').trim(); fail(/^[0-7]+$/.test(value), 'TAR_NUMBER_REFUSED'); const n = parseInt(value, 8); fail(Number.isSafeInteger(n), 'TAR_NUMBER_REFUSED'); return n; };
  while (offset + 512 <= length) {
    const header = read(offset, 512); offset += 512;
    if (header.every(byte => byte === 0)) { fail(offset + 512 <= length, 'TAR_TRAILING_DATA_REFUSED'); zeroes(offset, length, 'TAR_TRAILING_DATA_REFUSED'); terminated = true; break; }
    fail(octal(header.subarray(148, 156)) === [...header].reduce((sum, byte, index) => sum + (index >= 148 && index < 156 ? 32 : byte), 0), 'TAR_CHECKSUM_MISMATCH');
    const gnu = header.subarray(257, 265).equals(Buffer.from('ustar  \0'));
    const ustar = header.subarray(257, 265).equals(Buffer.from('ustar\0' + '00'));
    fail(gnu || ustar, 'TAR_FORMAT_REFUSED');
    fail([0, 48, 53].includes(header[156]) && header.subarray(157, 257).every(byte => byte === 0), 'TAR_LINK_OR_TYPE_REFUSED');
    const directory = header[156] === 53;
    const mode = octal(header.subarray(100, 108));
    fail((directory ? mode === 0o755 : [0o644, 0o755].includes(mode)) && octal(header.subarray(108, 116)) === 0 && octal(header.subarray(116, 124)) === 0 && octal(header.subarray(136, 148)) === 0, 'TAR_METADATA_REFUSED');
    const name = string(header.subarray(0, 100));
    const prefix = ustar ? string(header.subarray(345, 500)) : '';
    if (gnu) fail(header.subarray(345).every(byte => byte === 0), 'TAR_EXTENSION_REFUSED');
    let path = prefix ? `${prefix}/${name}` : name;
    if (path.startsWith('./')) path = path.slice(2);
    if (directory && path.endsWith('/')) path = path.slice(0, -1);
    fail((directory && path === '') || safePath(path), 'TAR_PATH_REFUSED');
    fail(!seen.has(path), 'TAR_DUPLICATE_REFUSED'); seen.set(path, directory);
    const size = octal(header.subarray(124, 136)), padded = Math.ceil(size / 512) * 512;
    fail(size <= 96 * 1024 * 1024 && (!directory || size === 0) && offset + padded <= length, 'TAR_ENTRY_SIZE_REFUSED');
    if (!directory) entries.set(path, { bytes: read(offset, size), mode });
    zeroes(offset + size, offset + padded, 'TAR_PADDING_REFUSED'); offset += padded;
    fail(seen.size <= 25000, 'TAR_ENTRY_COUNT_REFUSED');
  }
  fail(terminated && entries.size > 0, 'TAR_TERMINATOR_REQUIRED');
  for (const path of seen.keys()) {
    const parts = path.split('/');
    for (let i = 1; i < parts.length; i++) fail(seen.get(parts.slice(0, i).join('/')) !== false, 'TAR_PATH_COLLISION_REFUSED');
  }
  return entries;
}
/** Keep only file payloads, never a second complete expanded TAR backing store. */
export function readDeliveryArchive(archive, expectedSha256) {
  fail(Buffer.isBuffer(archive) || typeof archive === 'string', 'ARCHIVE_SIZE_REFUSED');
  const size = Buffer.isBuffer(archive) ? archive.length : lstatSync(archive).size;
  fail(size <= 128 * 1024 * 1024, 'ARCHIVE_SIZE_REFUSED');
  return withArchiveTar(archive, scanDeliveryTar, expectedSha256 === undefined ? undefined : digest => fail(digest === expectedSha256, 'ARCHIVE_DIGEST_MISMATCH'));
}

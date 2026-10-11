/** Fixed mTLS transport; no browser/session fallback, redirects or ambient proxy. */
import { request as httpsRequest } from 'node:https';
import { checkServerIdentity } from 'node:tls';
import { open, lstat, realpath } from 'node:fs/promises';
import { constants } from 'node:fs';
import { dirname } from 'node:path';
const check = (ok, code) => { if (!ok) throw Error(code); };
export async function readTaskListingPrivateFile(path, maximum = 262144) {
  // Refuse symlink and writable-parent substitutions before any credential read.
  for (let parent = dirname(path); ; parent = dirname(parent)) {
    const stat = await lstat(parent);
    check(stat.isDirectory() && !stat.isSymbolicLink() && !(stat.mode & 0o022) && await realpath(parent) === parent, 'TASK_LISTING_PRIVATE_DIRECTORY_REFUSED');
    if (parent === dirname(parent)) break;
  }
  const file = await open(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = await file.stat();
    check(stat.isFile() && stat.nlink === 1 && !(stat.mode & 0o077) && stat.uid === process.geteuid?.() && stat.size >= 1 && stat.size <= maximum,
      'TASK_LISTING_PRIVATE_FILE_REFUSED');
    return await file.readFile();
  } finally { await file.close(); }
}
export async function readTaskListingTLS(configuration) {
  const [cert, key, ca] = await Promise.all(['certFile', 'keyFile', 'caFile'].map(name => readTaskListingPrivateFile(configuration[name])));
  return { cert, key, ca };
}
export function createTaskListingTransport({ url, tls, serverFingerprint256, timeoutMs, maximumBytes = 1048576 }) {
  const destination = new URL(url);
  check(destination.protocol === 'https:' && !destination.username && !destination.password && !destination.search && !destination.hash &&
    /^[a-f0-9]{64}$/.test(serverFingerprint256) && Number.isSafeInteger(timeoutMs) && timeoutMs >= 1 && timeoutMs <= 60000 && tls?.cert && tls.key && tls.ca,
  'TASK_LISTING_TRANSPORT_CONFIG_REFUSED');
  const fingerprint = cert => cert.fingerprint256?.replaceAll(':', '').toLowerCase();
  const fixedTLS = { cert: Buffer.from(tls.cert), key: Buffer.from(tls.key), ca: Buffer.from(tls.ca) };
  return async (requestedURL, init = {}) => {
    check(requestedURL === destination.href && init.method === 'POST' && typeof init.body === 'string' && Buffer.byteLength(init.body) <= maximumBytes,
      'TASK_LISTING_TRANSPORT_REQUEST_REFUSED');
    const headers = new Headers(init.headers);
    check([...headers.keys()].every(name => ['content-type', 'authorization', 'x-artfi-task-peer'].includes(name)), 'TASK_LISTING_TRANSPORT_HEADER_REFUSED');
    return new Promise((resolve, reject) => {
      let total = 0, timer, settled = false;
      const finish = (error, response) => { if (settled) return; settled = true; clearTimeout(timer); init.signal?.removeEventListener('abort', abort); error ? reject(Error('TASK_LISTING_TRANSPORT_UNAVAILABLE')) : resolve(response); };
      const req = httpsRequest(destination, { method: 'POST', headers: Object.fromEntries(headers), ...fixedTLS,
        rejectUnauthorized: true, minVersion: 'TLSv1.2', agent: false,
        checkServerIdentity(host, certificate) { return checkServerIdentity(host, certificate) || (fingerprint(certificate) !== serverFingerprint256 ? Error('TASK_LISTING_PEER_REFUSED') : undefined); } }, response => {
        const chunks = [];
        response.on('data', chunk => { total += chunk.length; if (total > maximumBytes) { response.destroy(); req.destroy(Error('TASK_LISTING_RESPONSE_TOO_LARGE')); } else chunks.push(chunk); });
        response.on('error', error => finish(error));
        response.on('end', () => { const status = response.statusCode ?? 503;
          // The native journal uses authenticated 404 to distinguish a new operation.
          // Preserve bounded error responses for that adapter; reject redirects and
          // bodyless success statuses rather than manufacturing a successful result.
          if (status !== 200 && !(status >= 400 && status <= 599)) return finish(Error('TASK_LISTING_REMOTE_REFUSED'));
          try { finish(null, new Response(Buffer.concat(chunks), { status, headers: { 'content-type': 'application/json' } })); } catch (error) { finish(error); } });
      });
      const abort = () => req.destroy(Error('TASK_LISTING_TRANSPORT_ABORTED'));
      req.on('error', error => finish(error));
      timer = setTimeout(() => req.destroy(Error('TASK_LISTING_TRANSPORT_TIMEOUT')), timeoutMs);
      init.signal?.addEventListener('abort', abort, { once: true });
      if (init.signal?.aborted) abort(); else req.end(init.body);
    });
  };
}

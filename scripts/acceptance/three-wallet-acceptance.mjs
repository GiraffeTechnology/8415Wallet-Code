#!/usr/bin/env node
/** Linux-only supervised test runner. Never signs, deploys, broadcasts or installs. */
import fs from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawn } from 'node:child_process';

const TASK = 'WALLET-3W-HOODI-20261015-01';
const PROMPT_FILE = '1NvTIC0hnoc9xCRt50zALq0z5qIJAC3kz';
const PROMPT_HASHES = Object.freeze({
  '1.0': '251e811836f26c05bc4a0a4b2e3f729b5e0fe1f7ea0f1a751fb7e14524ca3180',
  '1.1': '8d11cdca84445575b5e8ab3ae68d72df26dc6ce11ec1fee34095598ac951f59d',
});
const FINAL = '8415WALLET-THREE-WALLET-ONCHAIN-ACCEPTANCE-FINAL.md';
const GENESIS = '0xbbe312868b376a3001692a646dd2d7d1e4406380dfd86b98aa8a34d1557c971b';
const sha = value => createHash('sha256').update(value).digest('hex');
const utc = () => new Date().toISOString();
function requireThat(ok, code) { if (!ok) throw new Error(code); }
const hex = (value, bytes) => typeof value === 'string' && new RegExp(`^0x[0-9a-f]{${bytes * 2}}$`).test(value);
const decimal = value => typeof value === 'string' && /^(0|[1-9][0-9]*)$/.test(value);
const within = (root, target) => target !== root && !path.relative(root, target).startsWith('..') && !path.isAbsolute(path.relative(root, target));
const scripts = new Set(['typecheck', 'test', 'test:auth', 'test:auth:installed', 'test:package:dapp', 'test:package:auth', 'test:package:delivery', 'test:task-listing-runtime', 'test:evm']);
const modes = new Set(['preflight', 'chain-read', 'transaction-read', 'regress', 'verify-artifacts', 'finalize-blocked']);

async function jsonFile(file) { return JSON.parse(await fs.readFile(file, 'utf8')); }
async function hashFile(file) { return sha(await fs.readFile(file)); }
async function command(program, args, options = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = utc(); let size = 0, stdout = [], stderr = [], exceeded = false;
    const child = spawn(program, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'], ...options });
    const collect = list => chunk => { size += chunk.length; if (size > 16 * 1024 * 1024) { exceeded = true; child.kill('SIGTERM'); } else list.push(chunk); };
    child.stdout.on('data', collect(stdout)); child.stderr.on('data', collect(stderr));
    child.once('error', reject);
    child.once('close', (exitCode, signal) => resolve({ startedAt, endedAt: utc(), exitCode, signal, exceeded,
      stdout: Buffer.concat(stdout), stderr: Buffer.concat(stderr) }));
  });
}
async function git(root, ...args) {
  const result = await command('git', ['-C', root, ...args], { env: { ...process.env, GIT_OPTIONAL_LOCKS: '0' }, timeout: 30000 });
  requireThat(result.exitCode === 0 && !result.exceeded, 'SOURCE_GIT_READ_FAILED');
  return result.stdout.toString('utf8').trim();
}
async function directory(file) {
  requireThat(typeof file === 'string' && path.isAbsolute(file), 'ABSOLUTE_APPROVED_DIRECTORY_REQUIRED');
  const resolved = await fs.realpath(file), stat = await fs.stat(resolved);
  requireThat(stat.isDirectory() && resolved !== '/', 'EXISTING_POSIX_DIRECTORY_REQUIRED');
  return { resolved, device: stat.dev };
}
async function gates(manifest, mode) {
  requireThat(process.platform === 'linux', 'LINUX_ONLY_NO_WINDOWS_TESTS');
  const [major, minor] = process.versions.node.split('.').map(Number);
  requireThat(major > 22 || major === 22 && minor >= 18, 'EXISTING_NODE_22_18_OR_NEWER_REQUIRED');
  requireThat(manifest.schema === '8415wallet-three-wallet-run/1' && manifest.taskId === TASK && Object.hasOwn(PROMPT_HASHES, manifest.promptVersion), 'MANIFEST_IDENTITY_REFUSED');
  requireThat(manifest.prompt?.fileId === PROMPT_FILE && manifest.prompt.sha256 === PROMPT_HASHES[manifest.promptVersion], 'PROMPT_CONTENT_IDENTITY_REQUIRED');
  requireThat(/^[a-f0-9]{40}$/.test(manifest.source?.commit) && /^[a-f0-9]{40}$/.test(manifest.source?.tree) && /^[a-f0-9]{64}$/.test(manifest.source?.lockSha256), 'EXACT_SOURCE_PINS_REQUIRED');
  const offline = mode === 'regress';
  let approval, approvalSha256;
  if (offline) {
    // An existing scoped execution approval is not a whole-environment READY receipt.
    // Never fabricate either document, or treat this format as a grant of authority.
    requireThat(manifest.offlineApproval?.file && /^[a-f0-9]{64}$/.test(manifest.offlineApproval.sha256), 'OFFLINE_EXECUTION_APPROVAL_REFERENCE_REQUIRED');
    requireThat(await hashFile(manifest.offlineApproval.file) === manifest.offlineApproval.sha256, 'OFFLINE_EXECUTION_APPROVAL_HASH_MISMATCH');
    approval = await jsonFile(manifest.offlineApproval.file);
    approvalSha256 = manifest.offlineApproval.sha256;
    requireThat(approval.schema === '8415wallet-offline-execution-approval/1' && approval.status === 'APPROVED' &&
      approval.scope === 'offline-regression-only' && approval.taskId === TASK && approval.sourceCommit === manifest.source.commit &&
      approval.promptVersion === manifest.promptVersion &&
      approval.sourceTree === manifest.source.tree && approval.lockSha256 === manifest.source.lockSha256 &&
      typeof approval.authorizationRef === 'string' && approval.authorizationRef.trim().length > 0 && approval.authorizationRef !== 'UNRESOLVED',
      'EXACT_OFFLINE_EXECUTION_NOT_APPROVED');
    requireThat(Array.isArray(approval.allowedScripts) && approval.allowedScripts.length > 0 &&
      approval.allowedScripts.every(item => typeof item === 'string' && scripts.has(item)) &&
      new Set(approval.allowedScripts).size === approval.allowedScripts.length, 'OFFLINE_SCRIPT_SCOPE_REQUIRED');
  } else {
    requireThat(manifest.rpcEnv === 'HOODI_RPC_URL', 'EXISTING_RPC_BINDING_REQUIRED');
    requireThat(manifest.opsReady?.file && /^[a-f0-9]{64}$/.test(manifest.opsReady.sha256), 'OPS_READY_REFERENCE_REQUIRED');
    requireThat(await hashFile(manifest.opsReady.file) === manifest.opsReady.sha256, 'OPS_READY_HASH_MISMATCH');
    approval = await jsonFile(manifest.opsReady.file);
    approvalSha256 = manifest.opsReady.sha256;
    requireThat(approval.status === 'READY' && approval.taskId === TASK && approval.sourceCommit === manifest.source.commit && approval.sourceTree === manifest.source.tree,
      'EXACT_WALLET_ENVIRONMENT_NOT_READY');
    requireThat(typeof manifest.projectPrefix === 'string' && manifest.projectPrefix.length > 0 && manifest.projectPrefix === approval.projectPrefix, 'WALLET_PROJECT_PREFIX_REQUIRED');
  }
  const root = await directory(manifest.paths?.workspace), cache = await directory(manifest.paths?.cache),
    temporary = await directory(manifest.paths?.temporary), output = await directory(manifest.paths?.output);
  for (const [name, value] of [['workspace', root], ['cache', cache], ['temporary', temporary], ['output', output]]) {
    // Direct owner instruction on 2026-10-16 permits task writes on the system disk.
    // Exact existing task path approval remains mandatory; no automatic directory allocation.
    requireThat(approval.paths?.[name] === value.resolved, 'EXACT_APPROVED_POSIX_MAPPING_REQUIRED');
  }
  requireThat(await git(root.resolved, 'rev-parse', 'HEAD') === manifest.source.commit && await git(root.resolved, 'rev-parse', 'HEAD^{tree}') === manifest.source.tree, 'CHECKOUT_SOURCE_MISMATCH');
  const dirty = await git(root.resolved, 'status', '--porcelain=v1', '--untracked-files=normal');
  // Do not reset, stash, clean or silently test a different dirty tree.
  requireThat(dirty === '', 'DIRTY_CHECKOUT_REQUIRES_OWNER_RECONCILIATION');
  requireThat(await hashFile(path.join(root.resolved, 'package-lock.json')) === manifest.source.lockSha256, 'LOCK_HASH_MISMATCH');
  requireThat(/^[a-zA-Z0-9][a-zA-Z0-9_-]{0,79}$/.test(manifest.runId), 'UNIQUE_RUN_ID_REQUIRED');
  const runPath = path.join(output.resolved, TASK, manifest.runId);
  requireThat(within(output.resolved, runPath), 'OUTPUT_SCOPE_REFUSED');
  return { root: root.resolved, cache: cache.resolved, temporary: temporary.resolved, output: output.resolved, runPath,
    source: manifest.source, promptVersion: manifest.promptVersion, promptSha256: manifest.prompt.sha256,
    authorizationKind: offline ? 'offline-regression-only' : 'full-environment-ready',
    authorizationSha256: approvalSha256,
    ...(offline ? { offlineAllowedScripts: approval.allowedScripts, offlineAuthorizationRef: approval.authorizationRef }
      : { opsReadySha256: approvalSha256 }),
    node: process.version, platform: process.platform, checkedAt: utc() };
}
async function writeExclusive(file, value) {
  await fs.writeFile(file, typeof value === 'string' || Buffer.isBuffer(value) ? value : JSON.stringify(value, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
}
async function newRun(context, mode) {
  const parent = path.dirname(context.runPath);
  try { await fs.mkdir(parent, { mode: 0o700 }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
  requireThat(await fs.realpath(parent) === parent, 'OUTPUT_SYMLINK_REFUSED');
  await fs.mkdir(context.runPath, { mode: 0o700 }); // EEXIST intentionally refuses replay/overwrite.
  await writeExclusive(path.join(context.runPath, 'preflight.json'), { taskId: TASK, mode, ...context,
    threeWalletAcceptance: 'NOT_RUN', fullPrdDelivery: 'NOT_ACCEPTED', productionReady: false });
}
async function rpc(method, params) {
  const endpoint = process.env.HOODI_RPC_URL;
  requireThat(typeof endpoint === 'string' && endpoint.length > 0, 'HOODI_RPC_URL_NOT_BOUND_IN_MANAGED_CLI');
  let parsed; try { parsed = new URL(endpoint); } catch { throw new Error('RPC_BINDING_INVALID'); }
  requireThat(['https:', 'http:'].includes(parsed.protocol), 'RPC_SCHEME_REFUSED');
  const response = await fetch(endpoint, { method: 'POST', redirect: 'error', signal: AbortSignal.timeout(30000),
    headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }) });
  requireThat(response.ok, 'RPC_HTTP_FAILURE');
  requireThat(response.body, 'RPC_BODY_MISSING');
  const chunks = []; let bytes = 0;
  for await (const chunk of response.body) {
    bytes += chunk.length;
    requireThat(bytes <= 4 * 1024 * 1024, 'RPC_BODY_LIMIT');
    chunks.push(chunk);
  }
  const text = Buffer.concat(chunks).toString('utf8');
  let raw; try { raw = JSON.parse(text); } catch { throw new Error('RPC_JSON_FAILURE'); }
  requireThat(raw.jsonrpc === '2.0' && raw.id === 1 && !raw.error && Object.hasOwn(raw, 'result'), 'RPC_RESULT_REFUSED');
  // Never persist endpoint, HTTP headers, provider error strings or credentials.
  return { request: { method, params }, response: raw, observedAt: utc() };
}
async function chainRead(manifest, context) {
  requireThat(Array.isArray(manifest.wallets) && manifest.wallets.length === 3, 'THREE_PUBLIC_WALLET_BINDINGS_REQUIRED');
  const names = new Set(), accounts = new Set();
  for (const item of manifest.wallets) {
    requireThat(['Xiongan', 'Giraffe', 'Lala'].includes(item.name) && hex(item.address, 20) && !/^0x0+$/.test(item.address), 'WALLET_BINDING_REFUSED');
    names.add(item.name); accounts.add(item.address);
  }
  requireThat(names.size === 3 && accounts.size === 3, 'THREE_DISTINCT_WALLETS_REQUIRED');
  const captures = [], read = async (method, params) => { const item = await rpc(method, params); captures.push(item); return item.response.result; };
  requireThat(await read('eth_chainId', []) === '0x88bb0', 'HOODI_CHAIN_ID_MISMATCH');
  const genesis = await read('eth_getBlockByNumber', ['0x0', false]); requireThat(genesis?.hash === GENESIS, 'HOODI_GENESIS_MISMATCH');
  const finalized = await read('eth_getBlockByNumber', ['finalized', false]);
  requireThat(hex(finalized?.hash, 32) && /^0x[0-9a-f]+$/.test(finalized?.number) && /^0x[0-9a-f]+$/.test(finalized?.timestamp), 'FINALIZED_BLOCK_REQUIRED');
  const tag = { blockHash: finalized.hash, requireCanonical: true }, rows = [];
  for (const wallet of manifest.wallets) {
    const code = await read('eth_getCode', [wallet.address, tag]);
    requireThat(typeof code === 'string' && /^0x(?:[0-9a-f]{2})*$/.test(code), 'ACCOUNT_CODE_INVALID');
    const balance = await read('eth_getBalance', [wallet.address, tag]);
    const nonce = await read('eth_getTransactionCount', [wallet.address, tag]);
    requireThat(/^0x[0-9a-f]+$/.test(balance) && /^0x[0-9a-f]+$/.test(nonce), 'ACCOUNT_STATE_INVALID');
    rows.push({ name: wallet.name, address: wallet.address, code, balanceWei: BigInt(balance).toString(), nonce: BigInt(nonce).toString(),
      codeClassification: code === '0x' ? 'NO_CODE_NOT_CONTROL_PROOF' : /^0xef0100[0-9a-f]{40}$/.test(code) ? 'EIP7702_DELEGATION_NOT_CONTROL_PROOF' : 'CONTRACT_CODE_NOT_CONTROL_PROOF',
      controlVerified: false });
  }
  requireThat(Array.isArray(manifest.contracts) && manifest.contracts.length > 0, 'EXISTING_CONTRACT_BINDINGS_REQUIRED');
  for (const binding of manifest.contracts) {
    requireThat(hex(binding.address, 20) && hex(binding.runtimeCodeHash, 32) && typeof binding.role === 'string', 'CONTRACT_BINDING_REFUSED');
    const code = await read('eth_getCode', [binding.address, tag]);
    // Retain code for independent Keccak/runtime/proxy/ABI verification; SHA256 is not an EVM codehash.
    requireThat(typeof code === 'string' && /^0x(?:[0-9a-f]{2})+$/.test(code), 'EXPECTED_CONTRACT_HAS_NO_CODE');
    rows.push({ role: binding.role, address: binding.address, expectedRuntimeCodeHash: binding.runtimeCodeHash, code, runtimeHashVerified: false });
  }
  requireThat((await read('eth_getBlockByNumber', [finalized.number, false]))?.hash === finalized.hash, 'CANONICAL_BLOCK_CHANGED');
  await writeExclusive(path.join(context.runPath, 'chain-read.json'), { taskId: TASK, finalized, rows, captures,
    status: 'READ_CAPTURE_ONLY_NOT_ACCEPTANCE', chainId: '560048', controlProofs: 'NOT_RUN', contractHashAndProxyVerification: 'NOT_RUN',
    transactionsSent: 0, threeWalletAcceptance: 'NOT_RUN', fullPrdDelivery: 'NOT_ACCEPTED' });
}
async function transactionRead(manifest, context) {
  requireThat(Array.isArray(manifest.observedTransactions) && manifest.observedTransactions.length > 0 && manifest.observedTransactions.length <= 64,
    'EXPLICIT_OBSERVED_TRANSACTIONS_REQUIRED');
  const hashes = new Set(), ids = new Set();
  for (const item of manifest.observedTransactions) {
    requireThat(item && /^[A-Z0-9_-]+$/.test(item.caseId) && hex(item.hash, 32) && !/^0x0+$/.test(item.hash), 'TRANSACTION_REFERENCE_REFUSED');
    requireThat(!hashes.has(item.hash) && !ids.has(item.caseId), 'DUPLICATE_TRANSACTION_REFERENCE_REFUSED');
    requireThat(hex(item.expectedFrom, 20) && hex(item.expectedTo, 20) && decimal(item.expectedValueWei), 'EXACT_TRANSACTION_EXPECTATION_REQUIRED');
    requireThat(decimal(item.requiredConfirmations) && BigInt(item.requiredConfirmations) > 0n, 'EXACT_CONFIRMATION_REQUIREMENT_REQUIRED');
    hashes.add(item.hash); ids.add(item.caseId);
  }
  const captures = [], rows = [];
  const read = async (method, params) => { const capture = await rpc(method, params); captures.push(capture); return capture.response.result; };
  requireThat(await read('eth_chainId', []) === '0x88bb0', 'HOODI_CHAIN_ID_MISMATCH');
  requireThat((await read('eth_getBlockByNumber', ['0x0', false]))?.hash === GENESIS, 'HOODI_GENESIS_MISMATCH');
  const finalized = await read('eth_getBlockByNumber', ['finalized', false]);
  requireThat(hex(finalized?.hash, 32) && /^0x[0-9a-f]+$/.test(finalized?.number), 'FINALIZED_BLOCK_REQUIRED');
  for (const item of manifest.observedTransactions) {
    const tx = await read('eth_getTransactionByHash', [item.hash]);
    const receipt = await read('eth_getTransactionReceipt', [item.hash]);
    // Null is unresolved, never permission to resubmit the transaction.
    if (!tx || !receipt) {
      rows.push({ caseId: item.caseId, hash: item.hash, status: 'UNRESOLVED_DO_NOT_REPLAY', tx, receipt });
      continue;
    }
    requireThat(tx.hash === item.hash && receipt.transactionHash === item.hash && tx.blockHash === receipt.blockHash && tx.blockNumber === receipt.blockNumber,
      'TRANSACTION_RECEIPT_BINDING_MISMATCH');
    requireThat(hex(receipt.blockHash, 32) && /^0x[0-9a-f]+$/.test(receipt.blockNumber) && /^0x[0-9a-f]+$/.test(tx.value), 'TRANSACTION_BLOCK_OR_VALUE_INVALID');
    requireThat(typeof tx.from === 'string' && tx.from.toLowerCase() === item.expectedFrom && typeof tx.to === 'string' && tx.to.toLowerCase() === item.expectedTo &&
      BigInt(tx.value).toString() === item.expectedValueWei, 'TRANSACTION_EXPECTATION_MISMATCH');
    requireThat(typeof receipt.from === 'string' && receipt.from.toLowerCase() === item.expectedFrom && typeof receipt.to === 'string' && receipt.to.toLowerCase() === item.expectedTo,
      'RECEIPT_PARTICIPANT_MISMATCH');
    requireThat(['0x0', '0x1'].includes(receipt.status) && /^0x[0-9a-f]+$/.test(receipt.gasUsed) && /^0x[0-9a-f]+$/.test(receipt.effectiveGasPrice), 'RECEIPT_STATUS_OR_GAS_INVALID');
    const block = await read('eth_getBlockByNumber', [receipt.blockNumber, false]);
    requireThat(block?.hash === receipt.blockHash && block.number === receipt.blockNumber && Array.isArray(block.transactions) && block.transactions.includes(item.hash) && /^0x[0-9a-f]+$/.test(block.timestamp),
      'TRANSACTION_NOT_IN_CANONICAL_BLOCK');
    const finalizedDepth = BigInt(finalized.number) >= BigInt(receipt.blockNumber) ? BigInt(finalized.number) - BigInt(receipt.blockNumber) + 1n : 0n;
    rows.push({ caseId: item.caseId, hash: item.hash, tx, receipt, block,
      status: receipt.status === '0x0' ? 'CHAIN_REVERTED' : finalizedDepth >= BigInt(item.requiredConfirmations) ? 'FINALIZED_RECEIPT_CAPTURE_NOT_BUSINESS_ACCEPTANCE' : 'CONFIRMATIONS_INSUFFICIENT',
      finalizedDepth: finalizedDepth.toString(), requiredConfirmations: item.requiredConfirmations,
      executionFeeWei: (BigInt(receipt.gasUsed) * BigInt(receipt.effectiveGasPrice)).toString(),
      feeScope: 'EXECUTION_GAS_ONLY_NOT_TOTAL_OR_BUDGET_VERIFICATION', balanceDeltas: 'NOT_VERIFIED', logsDecoded: false });
  }
  for (const row of rows) if (row.block) requireThat((await read('eth_getBlockByNumber', [row.block.number, false]))?.hash === row.block.hash, 'TRANSACTION_BLOCK_CHANGED');
  requireThat((await read('eth_getBlockByNumber', [finalized.number, false]))?.hash === finalized.hash, 'CANONICAL_BLOCK_CHANGED');
  await writeExclusive(path.join(context.runPath, 'transaction-read.json'), { taskId: TASK, source: manifest.source, finalized, rows, captures,
    status: 'READ_CAPTURE_ONLY_NOT_ACCEPTANCE', transactionsSent: 0, threeWalletAcceptance: 'NOT_RUN', fullPrdDelivery: 'NOT_ACCEPTED' });
}
function secretOutput(value) {
  return /-----BEGIN (?:RSA |EC |ENCRYPTED )?PRIVATE KEY-----|(?:private[_ -]?key|seed[_ -]?phrase|bearer)\s*[:=]\s*["']?[a-zA-Z0-9+/=_ -]{24,}/i.test(value);
}
async function regress(manifest, context) {
  requireThat(Array.isArray(manifest.regressions) && manifest.regressions.length > 0, 'EXPLICIT_REGRESSION_SELECTION_REQUIRED');
  const pkg = await jsonFile(path.join(context.root, 'package.json')), results = [];
  const caseIds = new Set();
  // Validate the complete batch before starting its first command.
  for (const item of manifest.regressions) {
    requireThat(item && /^[A-Z0-9_-]+$/.test(item.caseId) && scripts.has(item.script) && typeof pkg.scripts?.[item.script] === 'string', 'REGRESSION_COMMAND_REFUSED');
    requireThat(context.authorizationKind === 'offline-regression-only' && context.offlineAllowedScripts.includes(item.script), 'REGRESSION_OUTSIDE_OFFLINE_APPROVAL');
    requireThat(!caseIds.has(item.caseId), 'DUPLICATE_REGRESSION_CASE_REFUSED');
    caseIds.add(item.caseId);
    requireThat(typeof item.executionAuthorizationRef === 'string' && item.executionAuthorizationRef.trim().length > 0 && item.executionAuthorizationRef !== 'UNRESOLVED' && item.priorRefusalCleared === true && Number.isSafeInteger(item.timeoutMs) && item.timeoutMs > 0 && item.timeoutMs <= 3600000,
      'EXACT_LINUX_ROUTE_AND_PRIOR_REFUSAL_RECONCILIATION_REQUIRED');
  }
  const env = Object.fromEntries(['PATH', 'LANG', 'LC_ALL', 'TZ', 'TERM'].filter(key => process.env[key] !== undefined).map(key => [key, process.env[key]]));
  Object.assign(env, { TMPDIR: context.temporary, TMP: context.temporary, TEMP: context.temporary,
    npm_config_cache: context.cache, XDG_CACHE_HOME: context.cache, GIT_OPTIONAL_LOCKS: '0' });
  // Do not inherit live RPC, signer, database, auth-store, bearer or Node-options bindings into regression subprocesses.
  // Never install, change config, rerun CI or invoke a signer. Extra fixture inputs require a reviewed source change.
  for (const item of manifest.regressions) {
    // A manifest flag is an operator attestation, not a way to override a tool/user refusal.
    const args = ['run', item.script, ...(item.script === 'test:evm' ? ['--', '--network', 'hardhat'] : [])];
    const result = await command('npm', args, { cwd: context.root, env, timeout: item.timeoutMs });
    const stdoutSha256 = sha(result.stdout), stderrSha256 = sha(result.stderr);
    requireThat(!secretOutput(result.stdout.toString()) && !secretOutput(result.stderr.toString()), 'SENSITIVE_LOG_REFUSED_NO_RAW_FILE_WRITTEN');
    await writeExclusive(path.join(context.runPath, item.caseId + '.stdout.log'), result.stdout);
    await writeExclusive(path.join(context.runPath, item.caseId + '.stderr.log'), result.stderr);
    const row = { caseId: item.caseId, command: ['npm', ...args], source: manifest.source,
      startedAt: result.startedAt, endedAt: result.endedAt, exitCode: result.exitCode, signal: result.signal, exceeded: result.exceeded,
      stdoutSha256, stderrSha256, status: result.exitCode === 0 && !result.exceeded ? 'COMMAND_EXIT_ZERO_NOT_CASE_ACCEPTANCE' : 'FAIL' };
    results.push(row); await writeExclusive(path.join(context.runPath, item.caseId + '.result.json'), row);
    // Preserve before-fix evidence and stop; no automatic retry or assertion relaxation.
    if (row.status === 'FAIL') break;
  }
  await writeExclusive(path.join(context.runPath, 'regressions.json'), { taskId: TASK, results,
    status: results.some(row => row.status === 'FAIL') ? 'FAIL' : 'COMMANDS_EXIT_ZERO_NOT_CASE_ACCEPTANCE',
    notRunCaseIds: manifest.regressions.slice(results.length).map(row => row.caseId),
    threeWalletAcceptance: 'NOT_RUN', fullPrdDelivery: 'NOT_ACCEPTED', ci: 'NOT_CHECKED' });
  requireThat(!results.some(row => row.status === 'FAIL'), 'REGRESSION_COMMAND_FAILED');
}
async function verifyArtifacts(manifest, context) {
  requireThat(Array.isArray(manifest.artifacts), 'ARTIFACT_MANIFEST_REQUIRED');
  const rows = [];
  for (const item of manifest.artifacts) {
    requireThat(item.caseId && path.isAbsolute(item.file) && /^[a-f0-9]{64}$/.test(item.sha256) && Number.isSafeInteger(item.bytes) && item.bytes > 0, 'ARTIFACT_IDENTITY_REQUIRED');
    const resolved = await fs.realpath(item.file); requireThat(within(context.output, resolved), 'ARTIFACT_OUTSIDE_APPROVED_OUTPUT');
    const stat = await fs.stat(resolved); requireThat(stat.isFile() && stat.size === item.bytes && await hashFile(resolved) === item.sha256, 'ARTIFACT_BYTES_OR_HASH_MISMATCH');
    rows.push({ caseId: item.caseId, bytes: stat.size, sha256: item.sha256, integrity: 'MATCHED', businessAcceptance: 'NOT_EVALUATED' });
  }
  await writeExclusive(path.join(context.runPath, 'artifact-integrity.json'), { taskId: TASK, rows, status: 'INTEGRITY_ONLY_NOT_ACCEPTANCE' });
}
async function blockedReport(manifest, context) {
  requireThat(manifest.formalBlockerEscalation === true && Array.isArray(manifest.blockers) && manifest.blockers.length > 0 && Array.isArray(manifest.cases), 'NO_FINAL_PLACEHOLDER_ALLOWED');
  const allowed = new Set(['PASS', 'FAIL', 'BLOCKED', 'NOT_RUN', 'NOT_APPLICABLE']);
  requireThat(manifest.cases.every(row => row.caseId && row.level && allowed.has(row.status) && row.actual && row.evidenceRefs &&
    (row.status !== 'PASS' || row.evidenceRefs.length > 0)), 'CASE_STATUS_OR_EVIDENCE_MISSING');
  requireThat(manifest.blockers.every(row => row.action && row.target && row.reason && row.owner && row.resumeCondition), 'PRECISE_BLOCKERS_REQUIRED');
  const data = { task_id: TASK, prompt_version: context.promptVersion, prompt_file_id: manifest.prompt?.fileId, prompt_sha256: context.promptSha256,
    prd_file_id: manifest.prd?.fileId, prd_sha256: manifest.prd?.sha256, generated_at_utc: utc(),
    status: 'BLOCKED', three_wallet_acceptance: 'BLOCKED', full_prd_delivery: 'NOT_ACCEPTED', production_ready: false,
    run_manifest: manifest, source_preflight: context,
    warning: 'Formal blocker escalation only. No tests, UI, Agent execution or on-chain flow is accepted by this report generator.' };
  await writeExclusive(path.join(context.runPath, FINAL), '# BLOCKED\n\n```json\n' + JSON.stringify(data, null, 2) + '\n```\n\nTesting is not full PRD delivery. Continue remaining authorized PRD work after the test/fix cycle.\n');
}

async function main() {
  const [mode, file] = process.argv.slice(2);
  requireThat(modes.has(mode) && file && process.argv.length === 4, 'USAGE_MODE_AND_EXACT_MANIFEST_REQUIRED');
  const manifest = await jsonFile(file), context = await gates(manifest, mode);
  await newRun(context, mode);
  if (mode === 'chain-read') await chainRead(manifest, context);
  if (mode === 'transaction-read') await transactionRead(manifest, context);
  if (mode === 'regress') await regress(manifest, context);
  if (mode === 'verify-artifacts') await verifyArtifacts(manifest, context);
  if (mode === 'finalize-blocked') await blockedReport(manifest, context);
  console.log(JSON.stringify({ taskId: TASK, mode, output: context.runPath, source: manifest.source,
    threeWalletAcceptance: 'NOT_ACCEPTED_BY_RUNNER', fullPrdDelivery: 'NOT_ACCEPTED', testsDoNotCompleteFullTask: true }));
}
main().catch(error => { console.error(JSON.stringify({ taskId: TASK, status: error.message === 'REGRESSION_COMMAND_FAILED' ? 'FAIL' : 'BLOCKED', code: /^[A-Z0-9_]+$/.test(error.message) ? error.message : 'RUNNER_IO_OR_NETWORK_FAILURE',
  rawErrorHidden: true, transactionsSent: 0, fullPrdDelivery: 'NOT_ACCEPTED' })); process.exitCode = 1; });

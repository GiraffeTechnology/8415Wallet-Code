/** Fixed standard-entry binding: existing pinned HTTPS/mTLS JSON-RPC only.
 * No module-path factories, endpoint discovery, key loading, retries or send fallback.
 */
import { createHash } from 'node:crypto';
import { validateTaskExactConfig } from './task-exact-config.mjs';
import { readTaskListingTLS, createTaskListingTransport } from './task-listing-transport.mjs';
import { createTaskExactSignOnly } from './task-exact-sign-only.mjs';
const READ = ['eth_chainId', 'eth_getTransactionCount', 'eth_getBlockByNumber', 'eth_getCode',
  'eth_call', 'eth_estimateGas', 'eth_getTransactionByHash', 'eth_getTransactionReceipt', 'eth_blockNumber'];
const WALLET = ['eth_chainId', 'eth_accounts', 'eth_signTransaction'];
export function createTaskExactRPCPort({ configuration, tls, methods, transport = null }) {
  const allowed = new Set(methods), send = transport ?? createTaskListingTransport({
    url: configuration.url, tls, serverFingerprint256: configuration.tls.serverFingerprint256,
    timeoutMs: configuration.timeoutMs });
  let sequence = 0;
  return Object.freeze({ async request({ method, params = [] }) {
    if (!allowed.has(method) || !Array.isArray(params) || sequence >= Number.MAX_SAFE_INTEGER) throw Error('TASK_EXACT_RPC_METHOD_REFUSED');
    const id = ++sequence;
    const response = await send(configuration.url, { method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id, method, params: structuredClone(params) }) });
    if (response.status !== 200) throw Error('TASK_EXACT_RPC_UNAVAILABLE');
    let body; try { body = await response.json(); } catch { throw Error('TASK_EXACT_RPC_RESPONSE_REFUSED'); }
    if (!body || Array.isArray(body) || body.jsonrpc !== '2.0' || body.id !== id ||
        Object.hasOwn(body, 'error') || !Object.hasOwn(body, 'result') ||
        Object.keys(body).sort().join() !== 'id,jsonrpc,result') throw Error('TASK_EXACT_RPC_RESPONSE_REFUSED');
    return structuredClone(body.result);
  } });
}
export async function bootstrapTaskExactConfiguration(configuration) {
  const c = validateTaskExactConfig(configuration);
  if (c === null || !c.enabled) return null;
  // Both endpoints use the same existing private-file protections as listing.
  const rpcTLS = await readTaskListingTLS(c.rpc.tls); let walletTLS = null;
  try {
    walletTLS = await readTaskListingTLS(c.wallet.tls);
    const provider = createTaskExactRPCPort({ configuration: c.rpc, tls: rpcTLS, methods: [...READ, 'eth_sendRawTransaction'] });
    const walletProvider = createTaskExactRPCPort({ configuration: c.wallet, tls: walletTLS, methods: WALLET });
    const binding = { chainId: c.chainId, rpc: { url: c.rpc.url, peer: c.rpc.tls.serverFingerprint256, timeoutMs: c.rpc.timeoutMs },
      wallet: { url: c.wallet.url, peer: c.wallet.tls.serverFingerprint256, timeoutMs: c.wallet.timeoutMs }, signer: c.signerIdentity };
    const signerIdentity = { ...c.signerIdentity, implementationDigest: '0x' + createHash('sha256').update(JSON.stringify(binding)).digest('hex') };
    return Object.freeze({ provider, externalSigner: createTaskExactSignOnly({ walletProvider }), signerIdentity,
      maxPriorityFeePerGasWei: c.maxPriorityFeePerGasWei, agentId: c.agentId, agentVersion: c.agentVersion,
      observationPolicy: c.observationPolicy, plannerFeeRule: c.plannerFeeRule });
  } finally { rpcTLS.key.fill(0); walletTLS?.key.fill(0); }
}


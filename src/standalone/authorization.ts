/** Shared standalone provider safety; contains no linked consent or execution algorithm. */
import { keccak256 } from '../codec/keccak.ts';
import type { Eip1193Provider } from '../adapters/signing/eip1193Signer.ts';
import type { Address, Bytes32 } from '../sdk/types.ts';
export type ControlDeploymentPin = {
  readonly chainId: bigint;
  readonly controller: Address;
  readonly runtimeCodeHash: Bytes32;
};
export class ControlAdapterError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.name = 'ControlAdapterError'; this.code = code; }
}
export function requireControlAdapter(ok: boolean, code: string): asserts ok {
  if (!ok) throw new ControlAdapterError(code);
}
export function controlHex(value: unknown, bytes?: number): value is string {
  return typeof value === 'string' && /^0x(?:[0-9a-fA-F]{2})*$/.test(value) &&
    (bytes === undefined || value.length === 2 + bytes * 2);
}
/** Some genuine EIP-1193 wallets return a number for the pending nonce only. */
export function controlPendingNonce(value: unknown): bigint {
  if (typeof value === 'number') {
    requireControlAdapter(Number.isSafeInteger(value) && value >= 0 && !Object.is(value, -0), 'CONTROL_RPC_QUANTITY_REFUSED');
    return BigInt(value);
  }
  requireControlAdapter(typeof value === 'string' && /^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value), 'CONTROL_RPC_QUANTITY_REFUSED');
  return BigInt(value);
}
export function hashControlBytes(value: string): Bytes32 {
  requireControlAdapter(controlHex(value), 'CONTROL_HEX_REFUSED');
  const bytes = Uint8Array.from(value.slice(2).match(/../g) ?? [], pair => Number.parseInt(pair, 16));
  return `0x${Array.from(keccak256(bytes), b => b.toString(16).padStart(2, '0')).join('')}`;
}
function address(value: unknown): value is Address {
  return controlHex(value, 20) && !/^0x0+$/i.test(value);
}
export function validateControlPin(pin: ControlDeploymentPin): void {
  requireControlAdapter(typeof pin.chainId === 'bigint' && pin.chainId > 0n && pin.chainId < 1n << 256n &&
    address(pin.controller) && controlHex(pin.runtimeCodeHash, 32) && !/^0x0+$/.test(pin.runtimeCodeHash), 'CONTROL_DEPLOYMENT_PIN_REFUSED');
}
const providerRejections = new WeakMap<object, string>();
export function isControlProviderRejection(error: unknown, method: string): boolean {
  return error !== null && typeof error === 'object' && providerRejections.get(error) === method;
}
function providerRejectedRequest(error: unknown): boolean {
  // EIP-1193 specifies the direct numeric code 4001. Do not guess from message
  // text, string codes, nested causes or transport-specific wrappers.
  try { return error !== null && typeof error === 'object' && (error as { code?: unknown }).code === 4001; }
  catch { return false; }
}

/** Errors deliberately do not echo provider payloads, endpoints, signatures or credentials. */
export async function controlRpc(provider: Eip1193Provider, method: string, params: readonly unknown[]): Promise<unknown> {
  // Timeout does not cancel a wallet prompt or prove a transaction was not sent.
  // Callers must reconcile uncertain submissions, never automatically resubmit.
  const interactive = method === 'eth_sendTransaction' || method === 'eth_signTypedData_v4' || method === 'eth_requestAccounts';
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      Promise.resolve().then(() => provider.request({ method, params })).catch(error => {
        if (interactive && providerRejectedRequest(error)) {
          const rejected = new ControlAdapterError('CONTROL_PROVIDER_REQUEST_REJECTED');
          providerRejections.set(rejected, method);
          throw rejected;
        }
        throw new ControlAdapterError(interactive ? 'CONTROL_PROVIDER_OUTCOME_UNCERTAIN' : 'CONTROL_RPC_REFUSED');
      }),
      new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new ControlAdapterError(
        interactive ? 'CONTROL_PROVIDER_OUTCOME_UNCERTAIN' : 'CONTROL_RPC_TIMEOUT',
      )), interactive ? 180_000 : 30_000); }),
    ]);
  } finally { if (timer !== undefined) clearTimeout(timer); }
}
export async function verifyControlDeployment(provider: Eip1193Provider, pin: ControlDeploymentPin): Promise<void> {
  validateControlPin(pin);
  const chain = await controlRpc(provider, 'eth_chainId', []);
  requireControlAdapter(typeof chain === 'string' && /^0x[0-9a-f]+$/i.test(chain) && BigInt(chain) === pin.chainId, 'CONTROL_CHAIN_MISMATCH');
  const code = await controlRpc(provider, 'eth_getCode', [pin.controller, 'latest']);
  requireControlAdapter(controlHex(code) && code.length > 2 && hashControlBytes(code) === pin.runtimeCodeHash.toLowerCase(), 'CONTROL_RUNTIME_PIN_MISMATCH');
}

export function sameDeployment(a: ControlDeploymentPin, b: ControlDeploymentPin): boolean {
  return a.chainId === b.chainId && a.controller.toLowerCase() === b.controller.toLowerCase() &&
    a.runtimeCodeHash.toLowerCase() === b.runtimeCodeHash.toLowerCase();
}

import { requireControlAdapter, controlHex, hashControlBytes, validateControlPin, verifyControlDeployment, controlRpc, type ControlDeploymentPin } from '../standalone/authorization.ts';
export { ControlAdapterError, requireControlAdapter, controlHex, controlPendingNonce, hashControlBytes, validateControlPin, isControlProviderRejection, controlRpc, verifyControlDeployment } from '../standalone/authorization.ts';
export type { ControlDeploymentPin } from '../standalone/authorization.ts';
import { encodeCall, encodeCallWithTail, encodeWords, type AbiValue, type StaticType } from '../codec/abi.ts';
import { keccak256Utf8 } from '../codec/keccak.ts';
import type { Eip1193Provider } from '../adapters/signing/eip1193Signer.ts';
import type { Address, Bytes32 } from '../sdk/types.ts';

/** Development candidate. No call occurs until the caller explicitly invokes a signer method. */
export type ForwardConsent = {
  readonly sequenceId: Bytes32;
  readonly expectedRevision: bigint;
  readonly legId: Bytes32;
  readonly token: Address;
  readonly tokenId: bigint;
  readonly fromAccount: Address;
  readonly toAccount: Address;
  readonly termsHash: Bytes32;
  readonly inheritedHash: Bytes32;
  readonly returnAuthority: Address;
  readonly returnConditionHash: Bytes32;
  readonly evidenceAuthority: Address;
  readonly deadline: bigint;
  readonly recipientNonce: bigint;
  readonly paymentAdapter: Address;
  readonly paymentAmount: bigint;
};
export const FORWARD_FIELDS = [
  { name: 'sequenceId', type: 'bytes32' }, { name: 'expectedRevision', type: 'uint256' },
  { name: 'legId', type: 'bytes32' }, { name: 'token', type: 'address' },
  { name: 'tokenId', type: 'uint256' }, { name: 'fromAccount', type: 'address' },
  { name: 'toAccount', type: 'address' }, { name: 'termsHash', type: 'bytes32' },
  { name: 'inheritedHash', type: 'bytes32' }, { name: 'returnAuthority', type: 'address' },
  { name: 'returnConditionHash', type: 'bytes32' }, { name: 'evidenceAuthority', type: 'address' },
  { name: 'deadline', type: 'uint64' }, { name: 'recipientNonce', type: 'uint256' },
  { name: 'paymentAdapter', type: 'address' }, { name: 'paymentAmount', type: 'uint256' },
] as const;
for (const field of FORWARD_FIELDS) Object.freeze(field);
Object.freeze(FORWARD_FIELDS);
export const FORWARD_TYPE = `ForwardConsent(${FORWARD_FIELDS.map(f => `${f.type} ${f.name}`).join(',')})`;
export const FORWARD_TUPLE = `(${FORWARD_FIELDS.map(f => f.type).join(',')})`;
const FORWARD_TYPES = FORWARD_FIELDS.map(f => f.type) as readonly StaticType[];
const DOMAIN_FIELDS = [
  { name: 'name', type: 'string' }, { name: 'version', type: 'string' },
  { name: 'chainId', type: 'uint256' }, { name: 'verifyingContract', type: 'address' },
] as const;
const DOMAIN_TYPE = 'EIP712Domain(string name,string version,uint256 chainId,address verifyingContract)';
const NAME = '8415Wallet ResponsibilityControls';

function address(value: unknown): value is Address {
  return controlHex(value, 20) && !/^0x0+$/i.test(value);
}
export function validateForwardConsent(consent: ForwardConsent): void {
  requireControlAdapter(Object.keys(consent).length === FORWARD_FIELDS.length &&
    Object.keys(consent).every(k => FORWARD_FIELDS.some(f => f.name === k)), 'CONTROL_CONSENT_SCHEMA_REFUSED');
  for (const field of FORWARD_FIELDS) {
    const value = consent[field.name];
    if (field.type === 'address') requireControlAdapter(field.name === 'paymentAdapter' ? controlHex(value, 20) : address(value), 'CONTROL_CONSENT_ADDRESS_REFUSED');
    else if (field.type === 'bytes32') requireControlAdapter(controlHex(value, 32) && !/^0x0+$/i.test(value), 'CONTROL_CONSENT_HASH_REFUSED');
    else requireControlAdapter(typeof value === 'bigint' && value >= 0n &&
      value < 1n << (field.type === 'uint64' ? 64n : 256n), 'CONTROL_CONSENT_INTEGER_REFUSED');
  }
  requireControlAdapter(consent.fromAccount.toLowerCase() !== consent.toAccount.toLowerCase(), 'CONTROL_SELF_FORWARD_REFUSED');
  requireControlAdapter(/^0x0+$/i.test(consent.paymentAdapter) === (consent.paymentAmount === 0n), 'CONTROL_PAYMENT_PROFILE_REFUSED');
}
export function forwardConsentValues(consent: ForwardConsent): readonly AbiValue[] {
  validateForwardConsent(consent);
  return FORWARD_FIELDS.map(f => consent[f.name]);
}
export function controlDomainSeparator(pin: ControlDeploymentPin): Bytes32 {
  validateControlPin(pin);
  return hashControlBytes(encodeWords(['bytes32', 'bytes32', 'bytes32', 'uint256', 'address'],
    [keccak256Utf8(DOMAIN_TYPE), keccak256Utf8(NAME), keccak256Utf8('1'), pin.chainId, pin.controller]));
}
export function forwardConsentDigest(pin: ControlDeploymentPin, consent: ForwardConsent): Bytes32 {
  const structHash = hashControlBytes(encodeWords(['bytes32', ...FORWARD_TYPES],
    [keccak256Utf8(FORWARD_TYPE), ...forwardConsentValues(consent)]));
  return hashControlBytes(`0x1901${controlDomainSeparator(pin).slice(2)}${structHash.slice(2)}`);
}
export function forwardTypedData(pin: ControlDeploymentPin, consent: ForwardConsent) {
  validateControlPin(pin); validateForwardConsent(consent);
  const message = Object.fromEntries(FORWARD_FIELDS.map(f => {
    const value = consent[f.name];
    return [f.name, typeof value === 'bigint' ? value.toString() : value.toLowerCase()];
  }));
  return { types: { EIP712Domain: DOMAIN_FIELDS.map(f => ({ ...f })), ForwardConsent: FORWARD_FIELDS.map(f => ({ ...f })) },
    primaryType: 'ForwardConsent', domain: { name: NAME, version: '1', chainId: pin.chainId.toString(),
      verifyingContract: pin.controller.toLowerCase() }, message };
}
export function encodeForward(consent: ForwardConsent, signature: string): string {
  requireControlAdapter(controlHex(signature) && signature.length > 2 && signature.length <= 8194, 'CONTROL_SIGNATURE_SHAPE_REFUSED');
  return encodeCallWithTail(`forward(${FORWARD_TUPLE},bytes)`, [...FORWARD_TYPES, 'bytes'],
    [...forwardConsentValues(consent), signature]);
}

// Only errors observed at this provider boundary carry rejection evidence. A
// matching message/code from storage, a nested RPC error or another method is
// not sufficient evidence to clear a prepared transaction.
async function selectedAccount(provider: Eip1193Provider, expected: Address): Promise<void> {
  requireControlAdapter(address(expected), 'CONTROL_SIGNER_REFUSED');
  const accounts = await controlRpc(provider, 'eth_accounts', []);
  requireControlAdapter(Array.isArray(accounts) && typeof accounts[0] === 'string' &&
    accounts[0].toLowerCase() === expected.toLowerCase(), 'CONTROL_SIGNER_MISMATCH');
}

/** Explicit user-driven signing only. Returns in memory; no logging/persistence/raw-key support. */
export async function signForwardConsent(
  provider: Eip1193Provider, pin: ControlDeploymentPin, consent: ForwardConsent, recipientOwner: Address,
): Promise<string> {
  // Copy before the first await so a caller cannot mutate the displayed intent mid-prompt.
  const frozenPin = Object.freeze({ ...pin });
  const frozen = Object.freeze({ ...consent });
  const typed = forwardTypedData(frozenPin, frozen);
  const payload = JSON.stringify(typed);
  await verifyControlDeployment(provider, frozenPin);
  await selectedAccount(provider, recipientOwner);
  const registered = await controlRpc(provider, 'eth_call', [{ to: frozenPin.controller,
    data: encodeCall('registeredAccount(address)', ['address'], [frozen.toAccount]) }, 'latest']);
  requireControlAdapter(registered === `0x${'0'.repeat(63)}1`, 'CONTROL_RECIPIENT_UNREGISTERED');
  const owner = await controlRpc(provider, 'eth_call', [{ to: frozen.toAccount, data: encodeCall('owner()', [], []) }, 'latest']);
  requireControlAdapter(controlHex(owner, 32) && owner.toLowerCase() === `0x${'0'.repeat(24)}${recipientOwner.slice(2).toLowerCase()}`, 'CONTROL_RECIPIENT_OWNER_MISMATCH');
  const nonce = await controlRpc(provider, 'eth_call', [{ to: frozenPin.controller,
    data: encodeCall('recipientNonces(address)', ['address'], [recipientOwner]) }, 'latest']);
  requireControlAdapter(controlHex(nonce, 32) && BigInt(nonce) === frozen.recipientNonce, 'CONTROL_CONSENT_NONCE_STALE');
  const header = await controlRpc(provider, 'eth_getBlockByNumber', ['latest', false]);
  const timestamp = header && typeof header === 'object' ? (header as Record<string, unknown>).timestamp : undefined;
  requireControlAdapter(typeof timestamp === 'string' && /^0x[0-9a-f]+$/i.test(timestamp) &&
    BigInt(timestamp) <= frozen.deadline, 'CONTROL_CONSENT_EXPIRED');
  const signature = await controlRpc(provider, 'eth_signTypedData_v4', [recipientOwner, payload]);
  requireControlAdapter(controlHex(signature) && signature.length > 2 && signature.length <= 8194, 'CONTROL_SIGNATURE_SHAPE_REFUSED');
  await verifyControlDeployment(provider, frozenPin);
  await selectedAccount(provider, recipientOwner);
  const valid = await controlRpc(provider, 'eth_call', [{ to: frozenPin.controller,
    data: encodeCallWithTail(`validateRecipientSignature(${FORWARD_TUPLE},bytes)`, [...FORWARD_TYPES, 'bytes'],
      [...forwardConsentValues(frozen), signature]) }, 'latest']);
  requireControlAdapter(valid === `0x${'0'.repeat(63)}1`, 'CONTROL_SIGNATURE_INVALID');
  return signature;
}

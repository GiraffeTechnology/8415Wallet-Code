/** Exact sign-only bridge for an existing server-owned EIP-1193 wallet port.
 * No custody/key loader, account creation, fee/nonce filling or broadcast.
 * A wallet without eth_signTransaction fails closed; never falls back to send.
 */
import { Transaction } from 'ethers';
const fail = code => { throw Error(code); };
const same = (a, b) => typeof a === 'string' && typeof b === 'string' && a.toLowerCase() === b.toLowerCase();
const quantity = value => '0x' + BigInt(value).toString(16);
export function createTaskExactSignOnly({ walletProvider }) {
  if (typeof walletProvider?.request !== 'function') fail('TASK_SIGN_ONLY_PROVIDER_REQUIRED');
  const request = walletProvider.request.bind(walletProvider);
  return Object.freeze({
    async signExactTransaction(input) {
      if (!input || Object.getPrototypeOf(input) !== Object.prototype) fail('TASK_SIGN_ONLY_REQUEST_REFUSED');
      const d = Object.getOwnPropertyDescriptors(input);
      const fields = ['requestId', 'unsignedSerialized', 'unsignedDigest', 'binding'];
      if (Reflect.ownKeys(d).length !== fields.length || fields.some(k => !Object.hasOwn(d, k) || !Object.hasOwn(d[k], 'value')))
        fail('TASK_SIGN_ONLY_REQUEST_REFUSED');
      let tx;
      try { tx = Transaction.from(input.unsignedSerialized); } catch { fail('TASK_SIGN_ONLY_UNSIGNED_REFUSED'); }
      const b = input.binding;
      if (tx.isSigned() || tx.type !== 2 || tx.accessList?.length !== 0 || tx.to === null ||
          tx.unsignedSerialized !== input.unsignedSerialized || !same(tx.unsignedHash, input.unsignedDigest) ||
          !b || typeof b.actor !== 'string' || b.chainId !== tx.chainId.toString() || b.nonce !== String(tx.nonce))
        fail('TASK_SIGN_ONLY_BINDING_REFUSED');
      const actor = b.actor.toLowerCase(), chain = quantity(tx.chainId);
      async function selected() {
        const actualChain = await request({ method: 'eth_chainId', params: [] });
        const accounts = await request({ method: 'eth_accounts', params: [] });
        const finalChain = await request({ method: 'eth_chainId', params: [] });
        if (!same(actualChain, chain) || !same(finalChain, chain) || !Array.isArray(accounts) || !same(accounts[0], actor))
          fail('TASK_SIGN_ONLY_WALLET_BINDING_REFUSED');
      }
      await selected();
      // This is the standard sign-only method, not eth_sendTransaction.
      // Every nonce/fee/wire field is explicit; the provider may not fill them.
      const raw = await request({ method: 'eth_signTransaction', params: [{
        type: '0x2', chainId: chain, from: actor, to: tx.to, data: tx.data,
        value: quantity(tx.value), nonce: quantity(tx.nonce), gas: quantity(tx.gasLimit),
        maxFeePerGas: quantity(tx.maxFeePerGas), maxPriorityFeePerGas: quantity(tx.maxPriorityFeePerGas), accessList: [],
      }] });
      let signed;
      try { signed = Transaction.from(raw); } catch { fail('TASK_SIGN_ONLY_RESULT_REFUSED'); }
      if (typeof raw !== 'string' || !signed.isSigned() || signed.serialized !== raw ||
          signed.unsignedSerialized !== tx.unsignedSerialized || !same(signed.from, actor))
        fail('TASK_SIGN_ONLY_RESULT_REFUSED');
      await selected();
      return signed.serialized;
    },
  });
}


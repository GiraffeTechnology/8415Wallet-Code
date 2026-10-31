/** Standalone profile: keep all authentication and task-authority guards.
 * Linked-chain display is not a V2 capability, rather than a fabricated empty chain. */
import { createAuthServiceCore, AuthError } from '../auth-service-core.mjs';
export { AuthError, createNativeWalletLoginSigner, createNativeWalletLogin, createNativeWalletAuthClient, createNativeKeystoreWalletLogin, createNativeRawKeyWalletLogin, createNativeRawKeyLoginSigner, createNativeRawKeyDirectoryLoginSigner, createNativeLoginCustodyBridge, runNativeLoginCustodyRequest } from '../auth-service-core.mjs';
export function createAuthService(options) {
  if (options.forwardProgressReader != null || options.forwardProgressSource != null)
    throw new AuthError('AUTH_V2_LINKED_CAPABILITY_REFUSED', 500);
  return createAuthServiceCore(options, {
    createForwardProgressService: () => Object.freeze({ read() { throw new AuthError('FORWARD_PROGRESS_NOT_APPLICABLE', 404); } }),
    createRpcForwardProgressReader: () => { throw new AuthError('AUTH_V2_LINKED_CAPABILITY_REFUSED', 500); },
    isForwardProgressError: () => false,
  });
}

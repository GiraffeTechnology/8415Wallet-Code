/** Linked-profile composition. Shared authentication guards remain profile-independent. */
import { createAuthServiceCore } from './auth-service-core.mjs';
import { createForwardProgressService, ForwardProgressError } from './forward-progress-service.mjs';
import { createRpcCoordinatedForwardProgressReader as createRpcForwardProgressReader } from './coordinated-forward-progress-reader.mjs';
export { AuthError, createNativeWalletLoginSigner, createNativeWalletLogin, createNativeWalletAuthClient, createNativeKeystoreWalletLogin, createNativeRawKeyWalletLogin, createNativeRawKeyLoginSigner, createNativeRawKeyDirectoryLoginSigner, createNativeLoginCustodyBridge, runNativeLoginCustodyRequest } from './auth-service-core.mjs';
export function createAuthService(options) {
  return createAuthServiceCore(options, { createForwardProgressService, createRpcForwardProgressReader,
    isForwardProgressError: error => error instanceof ForwardProgressError });
}

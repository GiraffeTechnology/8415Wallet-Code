export {createReceiptPrincipalRuntime} from './receipt-principal-runtime.mjs';
export {createRpcNftInventoryReader} from './nft-inventory-reader.mjs';
export {createExSepoliaReceiptContent} from './receipt-software-content.mjs';
/** Explicitly configured auth service; listing is an additive server-only runtime. */
import { createServer } from 'node:http';
import { readFile, chmod, lstat } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { createAuthService } from './auth-service.mjs';
import { createTaskBackgroundRunner } from './task-background-runner.mjs';
import { openEncryptedStore } from './store.mjs';
import { createCaVerifier } from './ca-verifier.mjs';
import { protectSocketDirectory } from './socket-path.mjs';
import { validateAuthConfig } from './config-validation.mjs';
import { createOtpSenderFromEnvironment } from './mail-otp.mjs';
import { bootstrapTaskListingRuntime, ensureTaskListingServerCondition } from './task-listing-bootstrap.mjs';
import { createTaskExactRuntime } from './task-exact-runtime.mjs';
import { composeTaskAuthOptions } from './task-runtime-composition.mjs';
import { createTaskTestAssetAuthorization } from './task-test-asset-authorization.mjs';
import { bootstrapTaskExactConfiguration } from './task-exact-bootstrap.mjs';
import { createTaskReceiptAdapter } from './task-receipt-adapter.mjs';
import { composeWalletReadRuntime } from './wallet-read-runtime.mjs';
import { assertAuthConfigurationStable } from './configuration-transition.mjs';
import { createWholeReceiptHost } from './whole-receipt-host.mjs';
import {composeReceiptPrincipalRuntime} from './receipt-principal-composition.mjs';

/** Reusable process-level entry for an already reviewed server capability object.
 * HTTP request data is never passed as listingRuntime or auth options. */
export async function createAuthRuntime({ config, store, verifyCa = null, sendOtp = null, listingRuntime = null, exactServerConfiguration = null, testAssetEvidenceVerifier = null, forwardProgressReader = null, assetControlCatalogReader = null, fundsReader = null, nftInventoryReader = null, readSources = null, wholeReceipt = null, receiptTaskContentContext = null, receiptPrincipal = null, now = Date.now }) {
  validateAuthConfig(config);
  const reads = composeWalletReadRuntime({ sources: readSources, fundsReader, nftInventoryReader, now });
  if (exactServerConfiguration !== null && config.exact?.enabled) throw Error('TASK_EXACT_DUPLICATE_CONFIG_REFUSED');
  const fixedExact = exactServerConfiguration ?? await bootstrapTaskExactConfiguration(config.exact);
  let inventoryObserver=null;
  const testAuthorization = config.taskTestAssets == null ? null : await createTaskTestAssetAuthorization({
    inventory: config.taskTestAssets, authorizedWallets: config.accounts.flatMap(user => user.wallets),
    verifyMintEvidence: testAssetEvidenceVerifier, store,
    verifyInventoryRecord: async(record,scope)=>{
      if(fixedExact===null)return false;
      inventoryObserver??=createTaskReceiptAdapter({provider:fixedExact.provider,observationPolicy:fixedExact.observationPolicy,
        testMint721Bindings:scope.mint721Bindings,testNFT721Metadata:scope.metadataVerifier,now});
      return inventoryObserver.verifyMintInventoryRecord(record);
    }, now });
  const exact = createTaskExactRuntime({ store, serverConfiguration: fixedExact === null ? null : {
    ...fixedExact, testAssetPins: testAuthorization?.executionPins ?? [], testMint721Bindings: testAuthorization?.mint721Bindings ?? [],
    testNFT721Metadata: testAuthorization?.metadataVerifier ?? null }, now, testAuthorization });
  const listing = listingRuntime ?? await bootstrapTaskListingRuntime({ configuration: config.listing, store, authStatePath: config.statePath, now });
  let receipt = null, principal = null;
  try {
  receipt = createWholeReceiptHost({ binding: wholeReceipt, store, now, receiptTaskContentContext });
  const handler = createAuthService({ origin: config.origin, tenant: config.tenant, basePath: config.basePath ?? '', accounts: config.accounts, store, verifyCa, sendOtp, now,
    taskTestAuthorization: testAuthorization, forwardProgressReader, assetControlCatalogReader, fundsReader: reads.fundsReader, nftInventoryReader: reads.nftInventoryReader,
    ...composeTaskAuthOptions({ exact: exact.authOptions, listing: listing.runtime.authOptions, artfi: receipt?.authOptions ?? {} }),
    // The authenticated owner-policy API is part of the standard runtime.
    // Its persisted effective value and factors remain service-owned; this
    // exposes neither an execution capability nor a caller-selected flag.
    taskReceiptContentContext: receiptTaskContentContext,
    taskVerificationPolicyEnabled: true });
  listing.runtime.connectAuthorization(handler.taskListingAuthorization);
  receipt?.connectAuthorization(handler.taskReceiptAuthorization);
  principal=composeReceiptPrincipalRuntime({binding:receiptPrincipal,authorization:handler.receiptPrincipalAuthorization,fundsReader:reads.fundsReader,tenant:config.tenant,now});
  const background = createTaskBackgroundRunner({ store, continuation: handler.taskBackground, now });
  const server = createServer(handler);
  server.requestTimeout = 10000; server.headersTimeout = 10000; server.timeout = 15000; server.maxHeadersCount = 40;
  let started = false, closed = false, stopPromise = null;
  async function stop() {
    if (stopPromise) return stopPromise; closed = true;
    stopPromise = (async () => {
      // Begin listener closure before waiting for background or receipt work.
      const listenerClosed = server.listening ? new Promise((resolve, reject) =>
        server.close(error => error ? reject(error) : resolve())) : Promise.resolve();
      const ended = await Promise.allSettled([listenerClosed, background.stop(), receipt?.stop(), principal?.stop()]);
      const failure = ended.find(result => result.status === 'rejected');
      if (failure) throw failure.reason;
      await listing.stop();
    })();
    return stopPromise;
  }
  async function start() {
    if (started || closed) throw Error('AUTH_LISTENER_ALREADY_STARTED');
    try {
      if (config.socketPath) {
        await protectSocketDirectory(config.socketPath);
        try { await lstat(config.socketPath); throw Error('AUTH_EXISTING_SOCKET_REFUSED'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
      }
      await listing.start();
      await new Promise((resolve, reject) => {
        server.once('error', reject);
        const listening = () => { server.off('error', reject); resolve(); };
        if (config.socketPath) server.listen(config.socketPath, listening); else server.listen(config.port, '127.0.0.1', listening);
      });
      if (config.socketPath) await chmod(config.socketPath, 0o666);
      started = true; background.start();
    } catch (error) { await stop(); throw error; }
  }
  return Object.freeze({ handler, server, background, wholeReceipt: receipt, receiptPrincipal: principal, exactState: exact.state, exactCode: exact.code, listingState: listing.runtime.state, listingCode: listing.runtime.code, readState: reads.state, readCodes: reads.codes, start, stop });
  } catch (error) { try { await principal?.stop(); } catch { /* Preserve construction failure. */ }
    try { await receipt?.stop(); } catch { /* Preserve construction failure. */ }
    try { await listing.stop(); } catch { /* Preserve the original construction failure. */ } throw error; }
}
/** Ports can only come from reviewed server code, never the JSON configuration.
 * Read capabilities and confirmed-mint evidence verification likewise come only
 * from the reviewed process composition; configuration does not fabricate either.
 * CLI/installed defaults remain disabled until the fixed capability is bound. */
export async function startAuthFromEnvironment({ exactServerConfiguration = null, testAssetEvidenceVerifier = null, forwardProgressReader = null, assetControlCatalogReader = null, fundsReader = null, nftInventoryReader = null, readSources = null, wholeReceipt = null, receiptPrincipal = null } = {}) {
  const configPath = process.env.WALLET_AUTH_CONFIG;
  if (!configPath) throw Error('WALLET_AUTH_CONFIG_REQUIRED');
  await assertAuthConfigurationStable(configPath);
  const config = JSON.parse(await readFile(configPath, 'utf8'));
  validateAuthConfig(config);
  await ensureTaskListingServerCondition(config.listing);
  if (typeof config.statePath !== 'string' || !/^[a-fA-F0-9]{64}$/.test(process.env.WALLET_AUTH_STORE_KEY ?? '')) throw Error('AUTH_ENCRYPTED_STORE_CONFIG_REQUIRED');
  await assertAuthConfigurationStable(configPath);
  const store = await openEncryptedStore(config.statePath, Buffer.from(process.env.WALLET_AUTH_STORE_KEY, 'hex'));
  let runtime;
  try {
    const verifyCa = config.ca ? await createCaVerifier(config.ca) : null;
    const sendOtp = createOtpSenderFromEnvironment(process.env, config.mail);
    runtime = await createAuthRuntime({ config, store, verifyCa, sendOtp, exactServerConfiguration, testAssetEvidenceVerifier,
      forwardProgressReader, assetControlCatalogReader, fundsReader, nftInventoryReader, readSources, wholeReceipt, receiptPrincipal });
    runtime.server.on('error', async error => {
      process.stderr.write(`AUTH_LISTENER_FAILED_${/^[A-Z0-9_]+$/.test(error.code ?? '') ? error.code : 'UNKNOWN'}\n`);
      await runtime.stop(); await store.close(); process.exitCode = 1;
    });
    await assertAuthConfigurationStable(configPath);
    await runtime.start();
    process.stdout.write('8415wallet auth service listening. No credentials logged.\n');
    if (runtime.exactState === 'disabled') process.stdout.write(`${runtime.exactCode}\n`);
    if (runtime.listingState === 'disabled') process.stdout.write(`${runtime.listingCode}\n`);
    for (const signal of ['SIGTERM', 'SIGINT']) process.once(signal, async () => { await runtime.stop(); await store.close(); });
    return runtime;
  } catch (error) { await runtime?.stop(); await store.close(); throw error; }
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) await startAuthFromEnvironment();

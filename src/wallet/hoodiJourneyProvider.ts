import { RpcErc8415Reader } from '../adapters/rpc/rpcReader.ts';
import type { CallTransport } from '../adapters/rpc/transport.ts';
import { ContractRevertError, TransportError } from '../sdk/errors.ts';
import { HOODI_JOURNEY_CHAIN, HOODI_JOURNEY_GENESIS,
  type JourneyManifest, type PinnedJourneyRead } from './hoodiJourney.ts';

export type JourneyReadProvider = {
  request(args: { method: string; params: unknown[] }): Promise<unknown>;
};
function quantity(value: unknown, label: string): bigint {
  if (typeof value !== 'string' || !/^0x(?:0|[1-9a-f][0-9a-f]*)$/i.test(value)) {
    throw new TransportError(label, 'invalid RPC quantity');
  }
  return BigInt(value);
}
function block(value: unknown): { number: bigint; hash: string; time: bigint } {
  if (value === null || typeof value !== 'object') throw new TransportError('block', 'missing block');
  const b = value as Record<string, unknown>;
  if (typeof b.hash !== 'string' || !/^0x[0-9a-f]{64}$/i.test(b.hash) || /^0x0+$/i.test(b.hash)) {
    throw new TransportError('block', 'missing block hash');
  }
  return { number: quantity(b.number, 'block.number'), hash: b.hash.toLowerCase(),
    time: quantity(b.timestamp, 'block.timestamp') };
}

/**
 * Only a read-only provider already authorized by the application's login boundary.
 * No endpoint, account request, key, signer, transaction builder or latest fallback.
 */
export async function openHoodiJourneyRead(
  provider: JourneyReadProvider, manifest: JourneyManifest,
): Promise<PinnedJourneyRead> {
  if (manifest.chainId !== HOODI_JOURNEY_CHAIN ||
      manifest.genesisHash !== HOODI_JOURNEY_GENESIS ||
      !/^0x[0-9a-f]{40}$/.test(manifest.contract) || /^0x0+$/.test(manifest.contract)) {
    throw new TransportError('journey', 'approved Hoodi asset binding required');
  }
  const request = async (method: string, params: unknown[]): Promise<unknown> => {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        provider.request({ method, params }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(() => reject(new TransportError(method, 'bounded request expired')), 30000);
        }),
      ]);
    } catch (error) {
      if (error instanceof TransportError || error instanceof ContractRevertError) throw error;
      if (method === 'eth_call' && error !== null && typeof error === 'object' &&
          (error as Record<string, unknown>).code === 3) throw new ContractRevertError('eth_call');
      throw new TransportError(method, 'read-only provider request failed');
    } finally { if (timer !== undefined) clearTimeout(timer); }
  };
  const checkChain = async () => {
    if (quantity(await request('eth_chainId', []), 'eth_chainId') !== HOODI_JOURNEY_CHAIN) {
      throw new TransportError('eth_chainId', 'Hoodi chain mismatch');
    }
  };
  await checkChain();
  const genesis = block(await request('eth_getBlockByNumber', ['0x0', false]));
  if (genesis.hash !== HOODI_JOURNEY_GENESIS) {
    throw new TransportError('genesis', 'Hoodi genesis mismatch');
  }
  const anchor = block(await request('eth_getBlockByNumber', ['finalized', false]));
  const tag = Object.freeze({ blockHash: anchor.hash, requireCanonical: true });
  const code = await request('eth_getCode', [manifest.contract, tag]);
  if (typeof code !== 'string' || !/^0x(?:[0-9a-f]{2})+$/i.test(code)) {
    throw new TransportError('eth_getCode', 'projection contract code unavailable');
  }
  // Code presence is NOT wallet-control proof. ERC-165 is checked by temporalQuery.
  const transport: CallTransport = {
    async call(to, data) {
      if (to.toLowerCase() !== manifest.contract || !/^0x[0-9a-f]*$/i.test(data)) {
        throw new TransportError('eth_call', 'asset call binding refused');
      }
      await checkChain();
      const answer = await request('eth_call', [{ to, data }, tag]);
      if (typeof answer !== 'string' || !/^0x(?:[0-9a-f]{2})*$/i.test(answer)) {
        throw new TransportError('eth_call', 'invalid call result');
      }
      await checkChain();
      return answer;
    },
    async blockTimestamp() { return anchor.time; },
    async blockNumber() { return anchor.number; },
    async blockTimestampAt(number) {
      if (number > anchor.number || number < 0n) throw new TransportError('block', 'outside snapshot');
      return block(await request('eth_getBlockByNumber', ['0x' + number.toString(16), false])).time;
    },
    async codeAt(address, number) {
      if (address.toLowerCase() !== manifest.contract || number !== anchor.number) {
        throw new TransportError('eth_getCode', 'outside snapshot');
      }
      return code;
    },
    async getLogs() {
      throw new TransportError('eth_getLogs', 'this temporal evidence adapter does not expose log scans');
    },
  };
  await checkChain();
  return Object.freeze({
    reader: new RpcErc8415Reader(transport, HOODI_JOURNEY_CHAIN, manifest.contract),
    blockNumber: anchor.number, blockHash: anchor.hash, recordedAt: anchor.time,
    genesisHash: genesis.hash,
    async readBlockHash(number: bigint) {
      if (number !== anchor.number) throw new TransportError('block', 'snapshot number mismatch');
      await checkChain();
      return block(await request('eth_getBlockByNumber', ['0x' + number.toString(16), false])).hash;
    },
  });
}

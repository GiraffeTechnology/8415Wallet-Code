import assert from 'node:assert/strict';
import { test } from 'node:test';
import { MemoryErc8415Reader } from '../src/adapters/memory/memoryReader.ts';
import { divergentToken, TOKEN, DAVE } from '../src/adapters/memory/scenarios.ts';
import type { Erc8415Reader } from '../src/sdk/port.ts';
import { NonConformantContractError, TransportError } from '../src/sdk/errors.ts';
import { INTERFACE_ID_PROJECTION_SETTLEMENT } from '../src/sdk/interfaceIds.ts';
import { buildRiskSurfaces } from '../src/wallet/riskSurfaces.ts';

function masked(method: string): Erc8415Reader {
  const target = new MemoryErc8415Reader(divergentToken().contract);
  return new Proxy(target, {
    get(object, key) {
      if (key === method) return undefined;
      const value: unknown = Reflect.get(object, key);
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
}
test('nonconformant reader is refused before projection data requests', async () => {
  const target = new MemoryErc8415Reader(divergentToken().contract);
  const reader = new Proxy(target, {
    get(object, key) {
      if (key === 'supportsInterface') return async () => false;
      if (key === 'source') return object.source;
      assert.fail('projection data read before conformance refusal');
    },
  });
  await assert.rejects(() => buildRiskSurfaces(reader, TOKEN), NonConformantContractError);
});
for (const method of ['openGapOf', 'settlement', 'verificationProfile', 'isSettlementAuthority']) {
  test(`missing advertised ${method} is unavailable, not an absent fact`, async () => {
    await assert.rejects(() => buildRiskSurfaces(masked(method), TOKEN, { account: DAVE }), TransportError);
  });
}
test('authority capability is not required when no account is queried', async () => {
  const view = await buildRiskSurfaces(masked('isSettlementAuthority'), TOKEN);
  assert.match(view.surfaces.find((surface) => surface.id === 'authority-scope')!.finding, /No account was supplied/);
});
test('projection-only reader does not fetch settlement logs or report no gap open', async () => {
  const target = new MemoryErc8415Reader(divergentToken().contract);
  const reader = new Proxy(target, {
    get(object, key) {
      if (key === 'supportsInterface') return async (id: string) =>
        id === INTERFACE_ID_PROJECTION_SETTLEMENT ? false : object.supportsInterface(id);
      if (['getLogs', 'openGapOf', 'settlement', 'verificationProfile', 'isSettlementAuthority'].includes(String(key))) {
        return async () => { assert.fail('unadvertised settlement data read'); };
      }
      const value: unknown = Reflect.get(object, key);
      return typeof value === 'function' ? value.bind(object) : value;
    },
  });
  const view = await buildRiskSurfaces(reader, TOKEN, { account: DAVE });
  assert.match(view.surfaces.find((surface) => surface.id === 'held-open-gap')!.finding, /no settlement interface/);
});

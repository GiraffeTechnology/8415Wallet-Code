import test from 'node:test';
import assert from 'node:assert/strict';
import { KitProjectionApi, KitTransportError } from '../src/adapters/kit/kitApi.ts';
import { ContractRevertError } from '../src/sdk/errors.ts';

const domainCodes = ['INSTANT_NOT_COVERED', 'EMPTY_PROJECTION', 'UNKNOWN_VERSION', 'UNKNOWN_TOKEN'];
function response(status: number, error: string) {
  return new KitProjectionApi({ baseUrl: 'https://example.invalid',
    fetch: async () => ({ status, json: async () => ({ error, message: 'Synthetic domain-shaped body' }) }) });
}
for (const status of [400, 401, 403, 409, 429, 500, 502, 503]) {
  for (const code of domainCodes) {
    test(`HTTP ${status} with ${code} remains a backend failure`, async () => {
      await assert.rejects(response(status, code).entryAsOf(1n, 1n), (error: unknown) => {
        assert.ok(error instanceof KitTransportError);
        assert.equal(error.status, status); assert.equal(error.code, code);
        assert.ok(!(error instanceof ContractRevertError)); return true;
      });
    });
  }
}
for (const code of domainCodes) {
  test(`documented HTTP404 ${code} preserves the projection-domain refusal`, async () => {
    await assert.rejects(response(404, code).entryAsOf(1n, 1n), ContractRevertError);
  });
}
test('unknown HTTP404 error remains transport, not guessed protocol noncoverage', async () => {
  await assert.rejects(response(404, 'ROUTE_NOT_FOUND').entryAsOf(1n, 1n), KitTransportError);
});
test('malformed error body never becomes a projection-domain refusal', async () => {
  const api = new KitProjectionApi({ baseUrl: 'https://example.invalid', fetch: async () => ({
    status: 404, json: async () => { throw Error('synthetic invalid JSON'); } }) });
  await assert.rejects(api.entryAsOf(1n, 1n), (error: unknown) => {
    assert.ok(error instanceof KitTransportError); assert.equal(error.code, 'MALFORMED_BODY'); return true;
  });
});
test('successful false finality is preserved exactly', async () => {
  const api = new KitProjectionApi({ baseUrl: 'https://example.invalid',
    fetch: async () => ({ status: 200, json: async () => ({ final: false }) }) });
  assert.equal(await api.isFinalAsOf(1n, 1n), false);
});

import assert from 'node:assert/strict';
import { test } from 'node:test';
import { FRANK, STRANGER, T, TOKEN, cancelledGapToken, divergentToken,
  projectionOnlyToken } from '../src/adapters/memory/scenarios.ts';
import { WalletSession } from '../src/wallet/session.ts';
import { renderRegistration, renderAcquisitionDisclosure } from '../src/wallet/renderHolderViews.ts';

test('all registration variants scope the no-lock claim to lag alone', async () => {
  for (const scenario of [divergentToken(), cancelledGapToken(), projectionOnlyToken()]) {
    const view = await new WalletSession(scenario.reader).registration(TOKEN);
    assert.match(view.meaning, /not blocked by registration lag alone/);
    assert.match(view.meaning, /not a transfer approval/);
    assert.match(view.meaning, /active inherited conditions/);
    assert.doesNotMatch(view.meaning, /never will be|transferred at any time/);
  }
});

test('matching in-flight registration keeps its existing state without granting a transfer', async () => {
  const view = await new WalletSession(divergentToken().reader).registration(TOKEN);
  assert.equal(view.state, 'registering');
  assert.equal(view.furtherHopsBehind, false);
  assert.match(view.action, /^Wait\./);
  assert.match(view.action, /nothing to fix/);
  assert.match(view.action, /not a transfer approval/);
});

test('further hops remain distinct from enforceable downstream acceptance', async () => {
  const { contract, reader } = divergentToken();
  contract.transfer(TOKEN, STRANGER);
  const view = await new WalletSession(reader).registration(TOKEN);
  assert.equal(view.state, 'registering-with-more-behind');
  assert.equal(view.furtherHopsBehind, true);
  assert.match(view.meaning, /at least one more registration/);
  assert.match(view.action, /does not establish independent forwarding conditions/);
});

test('agreement does not certify independent transfer conditions', async () => {
  const { contract, reader } = cancelledGapToken();
  contract.transfer(TOKEN, FRANK);
  const view = await new WalletSession(reader).registration(TOKEN);
  assert.equal(view.state, 'level');
  assert.match(view.action, /Independent transfer conditions remain separate/);
});

test('an unexpired window is a deadline fact, not an all-clear assessment', async () => {
  const view = await new WalletSession(divergentToken().reader).registration(TOKEN);
  assert.equal(view.commitmentWindow?.passed, false);
  assert.match(view.commitmentWindow?.note ?? '', /deadline has not passed/);
  assert.match(view.commitmentWindow?.note ?? '', /not an assessment of the trade/);
  assert.doesNotMatch(view.commitmentWindow?.note ?? '', /Nothing is wrong/);
});

test('an expired window retains the separate agreed-terms boundary', async () => {
  const { contract, reader } = divergentToken();
  contract.advanceTo(T.openGapDeadline + 1n);
  const view = await new WalletSession(reader).registration(TOKEN);
  assert.equal(view.commitmentWindow?.passed, true);
  assert.match(view.commitmentWindow?.note ?? '', /terms you agreed with your counterparty/);
  assert.match(view.meaning, /must be established separately/);
});

test('rendered acquisition and registration disclose protection without inventing authority', async () => {
  const session = new WalletSession(divergentToken().reader);
  const acquisition = await session.acquisitionDisclosure(TOKEN);
  const text = renderAcquisitionDisclosure(acquisition);
  assert.match(acquisition.boundary, /This disclosure does not score the token/);
  assert.match(acquisition.boundary, /not a grant or an executable transfer approval/);
  assert.match(text, /explicit, enforceable acceptance/);
  assert.match(text, /payment approval alone does not establish/);
  assert.doesNotMatch(text, /Nothing is wrong/);
  assert.match(renderRegistration(await session.registration(TOKEN)), /registration lag alone/);
});

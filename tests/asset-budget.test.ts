import assert from 'node:assert/strict';
import { test } from 'node:test';

import { assetBoundedTaskFees, committedFeeWei } from '../src/agent/assetBudget.ts';
import { assessChildScope, freezeChildOperation, freezeTaskPolicy, type Reservation } from '../src/agent/taskContract.ts';

const a = (letter: string) => `0x${letter.repeat(40)}`;
const h = (letter: string) => `0x${letter.repeat(64)}`;
const actor = a('1'), contract = a('2'), buyer = a('3');
const operation = { kind: 'erc721-transfer', chainId: '11155111', actor, contract, recipient: buyer, tokenId: '7' };

/** A reservation as the budget journal records one. */
const reserved = (operationId: string, feeWei: string, status: Reservation['status'] = 'reserved'): Reservation =>
  ({ operationId, childDigest: h('9'), feeWei, units: '1', status, transactionHash: null });

const policyWith = (fees: { perOperationWei: string; totalWei: string }) => ({
  schema: '8415-agent-task/1', taskId: 'sell-token-7', tenant: 'xiongan',
  origin: 'https://xiongan.8415wallet.com:9446', chainId: '11155111', actor, expiresAt: '10000',
  fees, intent: { kind: 'exact-operation', operation },
});

test('the whole read total becomes the budget when no ceiling is given', () => {
  // This is the authorization the PRD calls asset-bounded: the total is read
  // and filled in, so no number is guessed and none is left unlimited.
  const total = (10n ** 18n).toString();
  const fees = assetBoundedTaskFees({ assetTotalWei: total });
  assert.deepEqual(fees, { perOperationWei: total, totalWei: total });
  // It has to satisfy the policy's own validation, not merely look plausible.
  assert.equal(freezeTaskPolicy(policyWith(fees)).policy.fees.totalWei, total);
});

test('amounts already committed come off the total, and a cancelled one comes back', () => {
  const total = '1000';
  const live = [reserved('op-1', '300'), reserved('op-2', '200', 'submitted'), reserved('op-3', '100', 'outcome-unknown')];
  assert.equal(committedFeeWei(live), 600n);
  assert.equal(assetBoundedTaskFees({ assetTotalWei: total, reservations: live }).totalWei, '400');
  // An unknown outcome may already have spent its fee, so it stays committed;
  // only a cancellation releases one.
  const cancelled = [...live, reserved('op-4', '150', 'cancelled')];
  assert.equal(committedFeeWei(cancelled), 600n);
  assert.equal(assetBoundedTaskFees({ assetTotalWei: total, reservations: cancelled }).totalWei, '400');
});

test('a per-operation ceiling is kept inside the spendable total, and equality is allowed', () => {
  const fees = assetBoundedTaskFees({ assetTotalWei: '1000', reservations: [reserved('op-1', '400')], perOperationWei: '600' });
  assert.deepEqual(fees, { perOperationWei: '600', totalWei: '600' });
  const smaller = assetBoundedTaskFees({ assetTotalWei: '1000', perOperationWei: '1' });
  assert.deepEqual(smaller, { perOperationWei: '1', totalWei: '1000' });
  assert.throws(
    () => assetBoundedTaskFees({ assetTotalWei: '1000', reservations: [reserved('op-1', '400')], perOperationWei: '601' }),
    /TASK_ASSET_BUDGET_PER_OPERATION_REFUSED: 601 wei per operation exceeds 600 wei spendable/,
  );
});

test('nothing spendable refuses, and says both figures rather than reading as a missing budget', () => {
  assert.throws(() => assetBoundedTaskFees({ assetTotalWei: '0' }),
    /TASK_ASSET_BUDGET_EMPTY: read total 0 wei, already committed 0 wei/);
  assert.throws(() => assetBoundedTaskFees({ assetTotalWei: '500', reservations: [reserved('op-1', '500')] }),
    /TASK_ASSET_BUDGET_EMPTY: read total 500 wei, already committed 500 wei/);
  assert.throws(() => assetBoundedTaskFees({ assetTotalWei: '500', reservations: [reserved('op-1', '600')] }),
    /TASK_ASSET_BUDGET_OVERCOMMITTED: read total 500 wei, already committed 600 wei/);
});

test('a total that is not a uint256 wei string is refused by field name', () => {
  for (const bad of ['0x10', '007', '', ' 1', '1.5', (1n << 256n).toString()]) {
    assert.throws(() => assetBoundedTaskFees({ assetTotalWei: bad }),
      /TASK_ASSET_BUDGET_INTEGER_REFUSED: assetTotalWei/);
  }
  assert.throws(() => assetBoundedTaskFees({ assetTotalWei: '10', perOperationWei: '0x1' }),
    /TASK_ASSET_BUDGET_INTEGER_REFUSED: perOperationWei/);
  assert.throws(() => assetBoundedTaskFees({ assetTotalWei: '10', perOperationWei: '0' }),
    /TASK_ASSET_BUDGET_PER_OPERATION_REFUSED: per-operation must be at least 1 wei/);
});

test('a child inside the filled budget passes scope, and one above it is refused on fees', () => {
  // The point of filling the number in: a real gas cost is inside the read
  // total, so the task does not stop for a budget nobody could have guessed.
  const fees = assetBoundedTaskFees({ assetTotalWei: (10n ** 18n).toString() });
  const task = freezeTaskPolicy(policyWith(fees));
  const child = (gasLimit: string, maxFeePerGasWei: string) => freezeChildOperation({
    schema: '8415-agent-child/1', operationId: 'operation-1', taskDigest: task.digest, operation,
    nonce: '5', expiresAt: '1500', wire: { to: contract, calldataHash: h('4'), valueWei: '0' },
    fees: { gasLimit, maxFeePerGasWei }, market: null,
  });
  assert.deepEqual(assessChildScope(task, child('21000', '2000000000'), 1000n).reasons, []);
  assert.ok(assessChildScope(task, child('21000', (10n ** 15n).toString()), 1000n).reasons.includes('TASK_CHILD_FEE_LIMIT'));
});

import type { Reservation } from './taskContract.ts';

/**
 * Fees for a task authorized against the whole of a wallet's relevant asset
 * total.
 *
 * PRD section 6.3.1 makes an authorization expressed as the entirety of a
 * specified asset balance a defined, asset-bounded limit rather than a missing
 * numeric budget, and requires execution to calculate available funds,
 * reserved amounts and actual fees instead of asking for a redundant numeric
 * authorization. The task policy carries numbers, so the number is read from
 * the wallet and filled in here: nobody guesses a ceiling, and nothing is left
 * effectively unlimited.
 *
 * The total itself is read by whoever holds the chain read for that asset;
 * this takes the figure it returned, in wei, and is pure so it can be tested
 * without a provider. Reading the total is not a claim on it: external state
 * can move after the read, which is why the execution path checks the actual
 * funds again against value plus gas before it signs. This fills the grant's
 * bounds; it does not replace that pre-sign check.
 */
const UINT256 = 1n << 256n;

export class AssetBudgetError extends Error {
  readonly code: string;
  constructor(code: string, detail: string) {
    super(`${code}: ${detail}`);
    this.name = 'AssetBudgetError';
    this.code = code;
  }
}
function refuse(ok: boolean, code: string, detail: string): asserts ok {
  if (!ok) throw new AssetBudgetError(code, detail);
}

/** The same decimal-string form the task policy accepts, so this round-trips. */
function uint256(value: string, field: string): bigint {
  refuse(typeof value === 'string' && /^(0|[1-9][0-9]{0,77})$/.test(value),
    'TASK_ASSET_BUDGET_INTEGER_REFUSED', `${field} must be a decimal wei string`);
  const parsed = BigInt(value);
  refuse(parsed < UINT256, 'TASK_ASSET_BUDGET_INTEGER_REFUSED', `${field} exceeds uint256`);
  return parsed;
}

/**
 * Amounts already committed against this task. A cancelled reservation
 * releases its amount; a submitted or unknown-outcome one does not, because an
 * unknown outcome may already have spent the fee.
 */
export function committedFeeWei(reservations: readonly Reservation[] = []): bigint {
  let committed = 0n;
  for (const reservation of reservations) {
    if (reservation.status === 'cancelled') continue;
    committed += uint256(reservation.feeWei, `reservation ${reservation.operationId} feeWei`);
    refuse(committed < UINT256, 'TASK_ASSET_BUDGET_INTEGER_REFUSED', 'committed fees exceed uint256');
  }
  return committed;
}

export type AssetBoundedFees = { readonly perOperationWei: string; readonly totalWei: string };

export function assetBoundedTaskFees(input: {
  /** The wallet's relevant asset total for this chain, as read. */
  readonly assetTotalWei: string;
  /** Reservations already recorded against the task, if any. */
  readonly reservations?: readonly Reservation[];
  /** A per-operation ceiling inside the total; the whole spendable total by default. */
  readonly perOperationWei?: string;
}): AssetBoundedFees {
  const total = uint256(input.assetTotalWei, 'assetTotalWei');
  const committed = committedFeeWei(input.reservations ?? []);
  // Refusing states both figures: they are public chain data, and a refusal
  // that withholds them is the kind of invisible bound this replaces.
  refuse(committed <= total, 'TASK_ASSET_BUDGET_OVERCOMMITTED',
    `read total ${total} wei, already committed ${committed} wei`);
  const spendable = total - committed;
  refuse(spendable > 0n, 'TASK_ASSET_BUDGET_EMPTY',
    `read total ${total} wei, already committed ${committed} wei, nothing spendable`);
  if (input.perOperationWei === undefined) {
    const whole = spendable.toString();
    return Object.freeze({ perOperationWei: whole, totalWei: whole });
  }
  const perOperation = uint256(input.perOperationWei, 'perOperationWei');
  refuse(perOperation > 0n, 'TASK_ASSET_BUDGET_PER_OPERATION_REFUSED', 'per-operation must be at least 1 wei');
  // A per-operation ceiling above the spendable total is a contradiction, not
  // something to clamp silently: the caller asked for authority it cannot have.
  refuse(perOperation <= spendable, 'TASK_ASSET_BUDGET_PER_OPERATION_REFUSED',
    `${perOperation} wei per operation exceeds ${spendable} wei spendable`);
  return Object.freeze({ perOperationWei: perOperation.toString(), totalWei: spendable.toString() });
}

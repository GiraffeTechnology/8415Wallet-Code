/** Pure, closed-list encoding shared by execution and receipt observation.
 * A resolved controlled account is supplied by the caller's trusted reader,
 * never selected from the child's wire target. No arbitrary calldata is input. */
import { encodeCall, encodeCallWithTail } from '../src/codec/abi.ts';
import { freezeChildOperation, normalizeExistingOperation } from '../src/agent/taskContract.ts';
import { hashControlBytes } from '../src/controls/authorization.ts';
import { isAddressInput } from '../src/xiongan/address.ts';

export function encodeTaskOperationCall(operation, resolvedAccount = null) {
  const op = normalizeExistingOperation(operation);
  let to, data, value = '0';
  switch (op.kind) {
    case 'native-transfer': to = op.recipient; data = '0x'; value = op.valueWei; break;
    case 'erc20-transfer': to = op.contract; data = encodeCall('transfer(address,uint256)', ['address', 'uint256'], [op.recipient, BigInt(op.amount)]); break;
    case 'erc721-transfer': to = op.contract; data = encodeCall('safeTransferFrom(address,address,uint256)', ['address', 'address', 'uint256'], [op.actor, op.recipient, BigInt(op.tokenId)]); break;
    case 'erc1155-transfer': to = op.contract; data = encodeCallWithTail('safeTransferFrom(address,address,uint256,uint256,bytes)',
      ['address', 'address', 'uint256', 'uint256', 'bytes'], [op.actor, op.recipient, BigInt(op.tokenId), BigInt(op.amount), '0x']); break;
    case 'create-account': to = op.controller.contract; data = encodeCall('createAccount()', [], []); break;
    case 'complete': case 'return-hop': to = op.controller.contract;
      data = encodeCall(op.kind === 'complete' ? 'completeThrough(bytes32,bytes32,uint256)' : 'returnHop(bytes32,bytes32,uint256)',
        ['bytes32', 'bytes32', 'uint256'], [op.sequenceId, op.legId, BigInt(op.expectedRevision)]); break;
    case 'deposit': case 'standalone-withdraw':
      if (!isAddressInput(resolvedAccount) || /^0x0+$/i.test(resolvedAccount)) throw new Error('TASK_OPERATION_ACCOUNT_REQUIRED');
      to = op.kind === 'deposit' ? op.token.contract : resolvedAccount.toLowerCase();
      data = op.kind === 'deposit' ? encodeCall('safeTransferFrom(address,address,uint256)', ['address', 'address', 'uint256'],
        [op.actor, resolvedAccount, BigInt(op.tokenId)]) : encodeCall('withdrawStandalone(address,uint256,address)',
        ['address', 'uint256', 'address'], [op.token.contract, BigInt(op.tokenId), op.destination]); break;
    default: throw new Error('TASK_OPERATION_NOT_SUPPORTED');
  }
  return Object.freeze({ to: to.toLowerCase(), data, value });
}

export function encodeExactTaskOperation(input, resolvedAccount = null) {
  const frozen = freezeChildOperation(input.child);
  if (frozen.digest !== input.digest) throw new Error('TASK_OPERATION_DIGEST_MISMATCH');
  const child = frozen.child, { to, data, value } = encodeTaskOperationCall(child.operation, resolvedAccount);
  if (child.wire.to !== to.toLowerCase() || child.wire.calldataHash !== hashControlBytes(data) || child.wire.valueWei !== value)
    throw new Error('TASK_RECEIPT_ENCODING_MISMATCH');
  return Object.freeze({ to: to.toLowerCase(), data, value });
}

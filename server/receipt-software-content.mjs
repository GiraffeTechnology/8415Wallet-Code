/** Fixed installed source composition. Content compatibility is not authority. */
import { loadInstalledTaskListingModules } from './task-listing-installed.mjs';
import { createReceiptTaskContentContext } from '../src/agent/receiptTask.ts';

export async function createExSepoliaReceiptContent(sourceText) {
  const runtime = await loadInstalledTaskListingModules();
  // The original factory verifies the complete pinned V1 bytes and brands this
  // exact boundary. No module path, chain selector or arbitrary resolver input.
  const softwareReceiptBoundary = runtime.createSimulatedRegistryReceiptBusinessBoundary(sourceText, 'ex-sepolia-simulation');
  if (softwareReceiptBoundary.view !== 'ex-sepolia-simulation' || softwareReceiptBoundary.chainId !== 11155111)
    throw Error('TASK_RECEIPT_CONTENT_SOURCE_REFUSED');
  const source = softwareReceiptBoundary.source, binding = source.association.journal;
  const sameFields = (actual, expected) => Object.keys(actual).every(key =>
    Object.hasOwn(expected, key) && String(actual[key]).toLowerCase() === String(expected[key]).toLowerCase());
  const receiptTaskContentContext = createReceiptTaskContentContext(policy => {
    if (policy.chainId !== '11155111' || policy.taskId !== binding.taskId || policy.tenant !== binding.tenant ||
      policy.origin !== binding.origin || policy.actor !== binding.actor ||
      policy.intent.escrow !== binding.escrow || policy.intent.runtimeCodeHash !== binding.runtimeCodeHash) return false;
    for (const slot of policy.intent.phases) {
      const business = structuredClone(source.business); business.wholeReceipt.phase = slot.phase;
      // Reuse the same original opaque instance on every freeze/reparse. Never
      // infer content validity from a chain number or from caller commitments.
      const commitment = runtime.createWholeReceiptApprovalCommitments(business, binding, softwareReceiptBoundary);
      const receipt = commitment.business.wholeReceipt;
      if (commitment.authorization !== 'NOT_ESTABLISHED' || policy.intent.segmentId !== receipt.segmentId ||
          !sameFields(policy.intent.sale, receipt.sale) || !sameFields(policy.intent.correspondence, receipt.correspondence) ||
          slot.planDigest !== commitment.receiptPlanDigest || slot.journalBindingHash !== commitment.receiptJournalBindingHash) return false;
    }
    return true;
  });
  return Object.freeze({ runtime, softwareReceiptBoundary, receiptTaskContentContext });
}

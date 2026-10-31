/** Ordinary NFT-sale provider is an optional, independently installed dependency.
 * Public V2 ships the generic Wallet adapter, NOT the private provider code.
 * No auto-install, dynamic module path, credential fallback or network discovery.
 * The fixed loader verifies the approved manifest and every provider file before
 * importing it. A missing/mismatching provider stays explicitly non-executable. */
import { bootstrapTaskListingRuntimeCore } from '../task-listing-bootstrap-core.mjs';
import { loadInstalledTaskListingModules } from './task-listing-installed.mjs';
export { ensureTaskListingServerCondition as ensureStandaloneListingCondition } from '../task-listing-bootstrap-core.mjs';
export function bootstrapStandaloneListing(options) {
  return bootstrapTaskListingRuntimeCore(options, { loadInstalledTaskListingModules });
}

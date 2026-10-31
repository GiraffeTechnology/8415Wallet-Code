/** Existing private-provider composition; shared bootstrap retains all gates. */
import { bootstrapTaskListingRuntimeCore } from './task-listing-bootstrap-core.mjs';
import { loadInstalledTaskListingModules } from './task-listing-installed.mjs';
export { ensureTaskListingServerCondition, createTaskJournalCapabilityListener, createTaskListingDependencyOwner } from './task-listing-bootstrap-core.mjs';
export function bootstrapTaskListingRuntime(options) {
  return bootstrapTaskListingRuntimeCore(options, { loadInstalledTaskListingModules });
}

/** Existing linked-profile credential entry. */
import { runCredentialEntry } from './runtime-entry-core.mjs';
import { ensureTaskListingServerCondition } from './task-listing-bootstrap.mjs';
await runCredentialEntry({ ensureRuntimeCondition: ensureTaskListingServerCondition,
  startAuthFromEnvironment: async options => (await import('./main.mjs')).startAuthFromEnvironment(options) });

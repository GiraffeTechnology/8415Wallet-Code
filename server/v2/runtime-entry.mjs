/** Standalone systemd credential entry; no private vendor or linked imports. */
import { runCredentialEntry } from '../runtime-entry-core.mjs';
import { ensureStandaloneListingCondition } from './listing-binding.mjs';
import { startAuthFromEnvironment } from './main.mjs';
await runCredentialEntry({ ensureRuntimeCondition: ensureStandaloneListingCondition, startAuthFromEnvironment });

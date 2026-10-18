import './task-exact-bootstrap.mjs';
import './task-exact-config.mjs';
import './task-exact-sign-only.mjs';
import './task-test-asset-authorization.mjs';
import './task-test-mint-contract.mjs';
import './task-test-nft721-contract.mjs';
/** Inert installed-runtime check. Import factories without invoking capabilities. */
import './task-exact-operation-planner.mjs';
import './task-exact-signer-adapter.mjs';
import './task-exact-runtime.mjs';
import './task-runtime-composition.mjs';
import './task-receipt-adapter.mjs';
import './receipt-provider-handler.mjs';
import './task-native-listing-composition.mjs';
import './task-listing-observation-consumer.mjs';

import './task-listing-runtime.mjs';
import './task-listing-bootstrap.mjs';
import './task-journal-capabilities.mjs';
import './task-receipt-runtime.mjs';
import './task-listing-results.mjs';
import '../web/task-listing-results.mjs';
import { loadInstalledTaskListingModules } from './task-listing-installed.mjs';
await loadInstalledTaskListingModules();
import './main.mjs';


import './task-exact-chain-state.mjs';


import './task-test-nft721-binding.mjs';
import './task-test-nft721-metadata.mjs';


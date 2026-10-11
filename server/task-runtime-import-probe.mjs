/** Inert installed-runtime check. Import factories without invoking capabilities. */
import './task-exact-operation-planner.mjs';
import './task-exact-signer-adapter.mjs';
import './task-receipt-adapter.mjs';
import './task-native-listing-composition.mjs';
import './task-listing-observation-consumer.mjs';

import './task-listing-runtime.mjs';
import './task-listing-bootstrap.mjs';
import './task-journal-capabilities.mjs';
import './task-listing-results.mjs';
import '../web/task-listing-results.mjs';
import { loadInstalledTaskListingModules } from './task-listing-installed.mjs';
await loadInstalledTaskListingModules();
import './main.mjs';

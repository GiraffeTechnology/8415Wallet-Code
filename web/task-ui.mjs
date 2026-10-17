import { mountTaskAuthorization } from './task-authorization-ui.mjs';
import { walletLogin, currentAccountClient } from './wallet-auth.mjs';
mountTaskAuthorization({ document, window: globalThis, walletLogin, getClient: currentAccountClient });

import { mountTaskActivity } from './task-activity-ui.mjs';
mountTaskActivity({ document, window: globalThis, walletLogin, getClient: currentAccountClient });

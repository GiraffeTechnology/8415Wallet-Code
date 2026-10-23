import { mountTaskVerificationPolicy } from './task-verification-policy-ui.mjs';
import { walletLogin, currentAccountClient, subscribeAgentPolicySettings } from './wallet-auth.mjs';
import { connectTaskVerificationPolicySettings } from './task-verification-policy-entry.mjs';
import { createTaskVerificationPolicyClient } from './task-verification-policy-client.mjs';
import { connectFoundationPolicySummary } from './foundation-policy-summary.mjs';

connectTaskVerificationPolicySettings({ document, window: globalThis, walletLogin,
  currentAccountClient, subscribeAccountSettings: subscribeAgentPolicySettings, mountTaskVerificationPolicy,
  createTaskVerificationPolicyClient, connectFoundationPolicySummary });

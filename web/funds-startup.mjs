import {walletLogin,currentAccountClient,currentAccountFeatures} from './wallet-auth.mjs';
import {mountFundsPanel} from './funds-panel.mjs';
mountFundsPanel({document,root:document.getElementById('wallet-private'),login:walletLogin,
 clientFor:currentAccountClient,available:()=>currentAccountFeatures()?.fundsAvailable===true});

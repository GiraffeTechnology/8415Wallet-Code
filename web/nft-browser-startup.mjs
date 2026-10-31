import {getReleaseProfile} from './release-profile.mjs';
import {walletLogin,currentAccountClient,currentAccountFeatures} from './wallet-auth.mjs';
import {mountNftBrowser} from './nft-browser.mjs';
let origins=Object.freeze([]);
const panel=mountNftBrowser({document,root:document.getElementById('wallet-private'),login:walletLogin,imageOrigins:()=>origins,clientFor:currentAccountClient,available:()=>currentAccountFeatures()?.nftInventoryAvailable===true});

getReleaseProfile().then(profile=>{origins=profile.imageOrigins;panel?.refreshPolicy();}).catch(()=>{});

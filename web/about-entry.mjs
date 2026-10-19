import { bindAbout } from './about.mjs';
const root = document.getElementById('wallet-about-content');
const selector = document.querySelector('[data-ui-locale-select]');
const label = document.getElementById('wallet-about-label');
// This fixed-text public disclosure has no login, wallet, network or task port.
// A missing menu/copy is a source/configuration mismatch, not an English fallback.
if (root && selector) bindAbout(root, selector, label);

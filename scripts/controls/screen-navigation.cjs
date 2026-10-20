/** Existing synthetic safety journeys use the real screen navigation introduced
 * by the approved UI. Never remove hidden/inert, call app internals, or bypass login. */
function installScreenNavigation(page) {
  const original = Object.fromEntries(['click', 'fill', 'check', 'selectOption', 'setInputFiles'].map(name => [name, page[name].bind(page)]));
  async function navigate(route) {
    const direct = page.locator(`.nav-item[data-route="${route}"]`);
    if (await direct.count() && await direct.isVisible()) { await direct.click(); return; }
    if (route === 'advanced') { await page.locator('.nav-item[data-route="settings"]').click(); }
    else if (route === 'review') { await navigate('transfer'); }
    else { await page.locator('.nav-item[data-route="overview"]').click(); }
    const button = page.locator(`[data-route="${route}"]:visible`).first();
    await button.click();
  }
  async function existingWallet() {
    if (await page.locator('#existing-user-panel').isVisible()) return;
    let entry = page.locator('[data-public-route="existing"]:visible').first();
    if (!await entry.count()) {
      const home = page.locator('.foundation-public-nav [data-public-route="home"]:visible');
      if (await home.count()) await home.click();
      entry = page.locator('#public-home [data-public-route="existing"]:visible');
    }
    if (await entry.count()) await entry.click();
  }
  async function reveal(selector) {
    const target = page.locator(selector).first(); if (!await target.count()) return;
    const context = await target.evaluate(node => ({
      locked: !!document.getElementById('wallet-private')?.hidden,
      page: node.closest('[data-page]')?.dataset.page,
      login: !!node.closest('#login-panel'),
      existing: !!node.closest('#existing-user-panel'),
      management: !!node.closest('#auth-management-view'),
      connection: !!node.closest('#asset-connection'),
      visible: !!node.getClientRects().length,
    }));
    if (context.locked) {
      // Follow the public hierarchy; never reveal private Settings or choose a
      // proof/operation for a test. Active management verification stays put.
      if (!context.visible && context.existing) await existingWallet();
      if (!context.visible && context.login) {
        await existingWallet();
        const entry = page.locator('#existing-login-open:visible');
        if (await entry.count()) await entry.click();
      }
      if (!context.visible && context.management && !await page.locator('#auth-management-view').isVisible()) {
        await existingWallet();
        const entry = page.locator('#auth-initial-open:visible');
        if (await entry.count()) await entry.click();
      }
      // Pending/refused profiles remain blocked by the real disabled controls.
      // No synthetic event, hidden/inert mutation or reauthentication is used.
      return; // Business controls still encounter the genuine display lock.
    }
    if (!context.visible) {
      if (context.management && !await page.locator('#auth-management-view').isVisible()) {
        await navigate('settings'); await page.locator('#auth-manage-open').click();
      }
      else if (context.login) await navigate('settings');
      else if (context.page) await navigate(context.page);
      else if (context.connection) await navigate('transfer');
    }
    if (context.connection && !await page.locator('#asset-connection').evaluate(node => node.open)) await page.locator('#asset-connection > summary').click();
  }
  for (const name of Object.keys(original)) page[name] = async (selector, ...args) => { await reveal(selector); return original[name](selector, ...args); };
  return page;
}
module.exports = { installScreenNavigation };

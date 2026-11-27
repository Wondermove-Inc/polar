const assert = require('node:assert/strict');
const {chromium} = require('playwright');

(async () => {
  const browser = await chromium.launch({executablePath: process.env.POLAR_CHROME, args: ['--no-sandbox']});
  try {
    const page = await browser.newPage({locale: 'en-US', reducedMotion: 'reduce'});
    await page.addInitScript(() => {
      window.__POLAR_WINDOWS__ = false;
      window.calls = [];
      window.__TAURI__ = {core: {invoke: async (cmd, args = {}) => {
        window.calls.push([cmd, args]);
        if (cmd === 'discover') return {items: [], warnings: [], complete: true, unresolvedEpic: ['/Games/Unresolved']};
        if (cmd === 'get_options') return {fullscreen: true};
        return null;
      }}};
    });
    await page.goto(process.env.POLAR_TEST_URL);
    await page.locator('#homeEmpty').waitFor();
    assert.deepEqual(await page.evaluate(() => window.calls.filter(([c]) => c === 'discover').map(([, a]) => a.source).sort()), ['epic', 'steam']);
    assert.equal(await page.locator('#addEmpty').isVisible(), false);
    assert.equal(await page.locator('#scanEmpty').isVisible(), true);
    await page.locator('#library').click();
    assert.equal(await page.locator('#addLib').isVisible(), false);
    assert.equal(await page.locator('[data-epic-folder]').count(), 0);
    assert.deepEqual(await page.locator('.filter').evaluateAll(items => items.map(e => e.dataset.key)), ['all', 'steam', 'epic', 'favorites']);
    await page.locator('#settings').click();
    assert.equal(await page.locator('[data-control="system"]').count(), 0);
    await page.locator('[data-control="sources"]').click();
    assert.equal(await page.locator('[data-control="addEpicFolder"]').count(), 0);
    assert.equal(await page.locator('.scanRow').count(), 2);
    assert.equal(await page.evaluate(() => window.calls.some(([c]) => c === 'epic_folders')), false);
  } finally {
    await browser.close();
  }
})().catch(e => { console.error(e); process.exitCode = 1; });

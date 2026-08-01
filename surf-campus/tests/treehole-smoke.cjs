const { chromium } = require('/Users/hanmingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  await page.goto(process.env.SURF_E2E_BASE_URL || 'http://127.0.0.1:8000', { waitUntil: 'networkidle' });
  await page.locator('.mobile-nav [data-route="treehole"]').click();
  await page.waitForSelector('#treehole-form');
  assert(await page.locator('#treehole-category').count() === 1, '树洞缺少场景分类');
  assert(await page.locator('.treehole-post').count() >= 1, '树洞没有脱敏内容');
  assert((await page.locator('.treehole-post').first().innerText()).includes('匿名同学'), '树洞未显示匿名身份');
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), '树洞移动端发生横向溢出');
  await browser.close();
  console.log(JSON.stringify({ anonymousSpace: 'ok', scenarioCategory: 'ok', mobile: 'ok' }));
})().catch(error => {
  console.error(error.stack || error.message);
  process.exit(1);
});

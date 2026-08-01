const { chromium } = require('/Users/hanmingyu/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright');

const BASE_URL = process.env.SURF_E2E_BASE_URL || 'http://127.0.0.1:8000';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
  const page = await context.newPage();
  try {
    const visitorResponse = await page.request.delete(`${BASE_URL}/api/auth/xjtlu/binding`);
    assert(visitorResponse.ok(), '无法切换到手机访客状态');
    await page.addInitScript(() => sessionStorage.setItem('surf-login-complete', 'true'));
    await page.goto(BASE_URL, { waitUntil: 'networkidle' });
    await page.waitForSelector('.post');
    const avatar = page.locator('.top-avatar');
    assert(await avatar.isVisible(), '移动端身份头像不可见');
    await avatar.click();
    await page.waitForSelector('h1');
    assert((await page.locator('h1').innerText()).includes('身份与登录'), '移动端头像没有进入身份页');
    assert((await page.locator('.identity-card').innerText()).includes('只能浏览'), '手机访客身份页未显示只读权限');
    await page.locator('.mobile-nav [data-route="feed"]').click();
    await page.waitForSelector('.composer-gate');
    assert((await page.locator('#view-root').innerText()).includes('绑定 XJTLU 账号后发布'), '手机访客发帖器未显示绑定入口');
    console.log(JSON.stringify({ mobileIdentityRoute: 'ok', visitorReadOnlyUI: 'ok' }));
  } finally {
    await page.request.post(`${BASE_URL}/api/auth/xjtlu/mock-bind`, { data: { account: 'zhang.san@student.xjtlu.edu.cn' } });
    await browser.close();
  }
})().catch(error => { console.error(error.stack || error.message); process.exit(1); });

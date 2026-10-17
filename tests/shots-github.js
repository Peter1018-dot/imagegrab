'use strict';
const { chromium } = require('playwright');
const path = require('path');

const SHOTS = path.resolve(__dirname, '../screenshots');
const PROXY = { server: 'http://127.0.0.1:7877' };
const REPO = 'https://github.com/Peter1018-dot/imagegrab';
const SITE = 'https://peter1018-dot.github.io/imagegrab/';

(async () => {
  const browser = await chromium.launch({
    headless: true,
    proxy: PROXY,
    args: ['--ignore-certificate-errors', '--disable-dev-shm-usage']
  });

  const repoPage = await browser.newPage({
    viewport: { width: 1440, height: 1000 },
    deviceScaleFactor: 1
  });
  await repoPage.goto(REPO, { waitUntil: 'domcontentloaded', timeout: 90000 });
  await repoPage.waitForTimeout(4000);
  // 关闭可能出现的 Cookie 提示
  for (const label of ['Reject', 'Accept', '拒绝', '接受']) {
    const button = repoPage.locator(`button:has-text("${label}")`).first();
    if (await button.count().catch(() => 0)) {
      await button.click({ timeout: 2000 }).catch(() => {});
      break;
    }
  }
  await repoPage.waitForTimeout(1200);
  console.log('repo title:', await repoPage.title());
  await repoPage.screenshot({ path: path.join(SHOTS, '04-GitHub仓库截图.png') });
  await repoPage.screenshot({ path: path.join(SHOTS, '04-GitHub仓库截图-全页.png'), fullPage: true });
  console.log('repo screenshots saved');

  const live = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    deviceScaleFactor: 1
  });
  await live.goto(SITE, { waitUntil: 'networkidle', timeout: 90000 });
  await live.waitForTimeout(1500);
  console.log('site title:', await live.title());
  // 触发滚动进入动画
  await live.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
  });
  const height = await live.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 700) {
    await live.evaluate((top) => window.scrollTo(0, top), y);
    await live.waitForTimeout(150);
  }
  await live.evaluate(() => window.scrollTo(0, 0));
  await live.waitForTimeout(900);
  await live.screenshot({ path: path.join(SHOTS, '06-GitHubPages-raw.png') });
  await live.screenshot({ path: path.join(SHOTS, '06-GitHubPages-全页.png'), fullPage: true });
  console.log('live site screenshots saved');

  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

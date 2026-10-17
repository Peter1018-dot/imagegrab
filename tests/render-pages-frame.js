'use strict';
const { chromium } = require('playwright');
const path = require('path');

(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage({ viewport: { width: 1600, height: 1180 }, deviceScaleFactor: 1 });
  const url = 'file:///' + path.resolve(__dirname, 'pages-frame.html').split(path.sep).join('/');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete), { timeout: 15000 });
  await page.waitForTimeout(500);
  await page.screenshot({ path: path.resolve(__dirname, '../screenshots/06-使用GitHubPages发布的官网截图.png'), fullPage: true });
  console.log('pages frame saved');
  await browser.close();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

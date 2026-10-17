'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: { width: 1720, height: 760 }
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1720, height: 760, deviceScaleFactor: 1 });
  const url = 'file:///' + path.resolve(__dirname, 'composite.html').split(path.sep).join('/');
  await page.goto(url, { waitUntil: 'load' });
  await page.waitForFunction(() => Array.from(document.images).every((img) => img.complete), { timeout: 15000 });
  await new Promise((r) => setTimeout(r, 600));
  await page.screenshot({ path: path.resolve(__dirname, '../screenshots/03-插件截图-合集.png'), fullPage: true });
  console.log('composite done');
  await browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

'use strict';
const puppeteer = require('puppeteer-core');
const path = require('path');

const SHOTS = path.resolve(__dirname, '../screenshots');
const url = 'file:///' + path.resolve(__dirname, '../docs/index.html').replace(/\\/g, '/');

async function triggerReveals(page) {
  await page.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
  });
  const height = await page.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < height; y += 700) {
    await page.evaluate((top) => window.scrollTo(0, top), y);
    await new Promise((r) => setTimeout(r, 140));
  }
  await page.evaluate(() => window.scrollTo(0, 0));
  await new Promise((r) => setTimeout(r, 800));
}

(async () => {
  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: { width: 1440, height: 900 }
  });

  const desktop = await browser.newPage();
  await desktop.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await desktop.goto(url, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 900));
  await desktop.screenshot({ path: path.join(SHOTS, '06-官网-首屏.png') });
  await triggerReveals(desktop);
  await desktop.screenshot({ path: path.join(SHOTS, '06-官网-全页.png'), fullPage: true });
  console.log('desktop shots done');

  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await mobile.goto(url, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 600));
  const check = await mobile.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth,
    h1: document.querySelector('.hero h1').getBoundingClientRect().toJSON(),
    container: document.querySelector('.hero-inner').getBoundingClientRect().toJSON()
  }));
  console.log('mobile layout:', JSON.stringify(check));
  await mobile.screenshot({ path: path.join(SHOTS, '06-官网-手机端.png') });
  await mobile.click('#navToggle');
  await new Promise((r) => setTimeout(r, 400));
  await mobile.screenshot({ path: path.join(SHOTS, 'extra-官网-手机菜单.png') });
  console.log('mobile shots done');

  const narrow = await browser.newPage();
  await narrow.setViewport({ width: 320, height: 720, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await narrow.goto(url, { waitUntil: 'load' });
  await new Promise((r) => setTimeout(r, 500));
  const narrowCheck = await narrow.evaluate(() => ({
    innerWidth: window.innerWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));
  console.log('320 layout:', JSON.stringify(narrowCheck));
  await narrow.screenshot({ path: path.join(SHOTS, 'extra-官网-320px.png') });

  await browser.disconnect();
})().catch((error) => {
  console.error(error);
  process.exit(1);
});

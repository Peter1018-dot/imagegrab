'use strict';
/**
 * 自动化验收（Puppeteer 连接手动启动的 Chromium）：
 *  - Playwright 会接管浏览器下载并覆盖文件名，因此下载测试改用 Puppeteer + 系统默认下载目录
 *  - 测试前清理 Downloads 中由本测试生成的「商品图_*.png」
 */
const puppeteer = require('puppeteer-core');
const path = require('path');
const fs = require('fs');

const ROOT = path.resolve(__dirname, '..');
const SHOTS = path.join(ROOT, 'screenshots');
const KEEP = path.join(__dirname, 'downloads');
const SYSTEM_DOWNLOADS = path.join('C:', 'Users', '95892', 'Downloads');
const EXPECTED = 13;

function resetDir(dir) {
  fs.rmSync(dir, { recursive: true, force: true });
  fs.mkdirSync(dir, { recursive: true });
}

function listTestDownloads() {
  if (!fs.existsSync(SYSTEM_DOWNLOADS)) return [];
  return fs
    .readdirSync(SYSTEM_DOWNLOADS)
    .filter((name) => /^商品图_\d+.*\.png$/i.test(name) || /^商品图_.*\.crdownload$/i.test(name))
    .map((name) => path.join(SYSTEM_DOWNLOADS, name));
}

function pngInfo(file) {
  const buffer = fs.readFileSync(file);
  if (buffer.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a') return null;
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20), size: buffer.length };
}

function assert(condition, message) {
  if (!condition) throw new Error('断言失败：' + message);
  console.log('  ✓ ' + message);
}

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function waitForFiles(baseline, expected, timeout = 180000) {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    const current = listTestDownloads();
    const created = current.filter((file) => !baseline.has(file));
    const files = created.filter((file) => file.endsWith('.png')).map((file) => path.basename(file)).sort();
    const pending = created.filter((file) => file.endsWith('.crdownload'));
    if (files.length >= expected && pending.length === 0) return files;
    await wait(500);
  }
  throw new Error(`等待下载完成超时（期望 ${expected} 个）`);
}

(async () => {
  resetDir(SHOTS);
  resetDir(KEEP);
  // 记录测试前已存在的文件，只处理本次新产生的下载，绝不删除用户原有文件
  const baseline = new Set(listTestDownloads());
  if (baseline.size) console.log('提示：Downloads 中已有同名测试文件，本次下载可能带 (1) 后缀');

  const browser = await puppeteer.connect({
    browserURL: 'http://127.0.0.1:9222',
    defaultViewport: { width: 1440, height: 900, deviceScaleFactor: 1 }
  });

  const pages = await browser.pages();
  for (const p of pages.slice(1)) await p.close().catch(() => {});

  const consoleErrors = [];

  /* ---------------- 1. 商品详情页 ---------------- */
  console.log('\n[1] 打开模拟淘宝商品详情页');
  const page = await browser.newPage();
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  await page.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await page.goto('https://item.taobao.com/item.htm?id=123456789', { waitUntil: 'load', timeout: 40000 });
  await page.waitForSelector('#imagegrab-fab', { timeout: 20000 });
  await page.waitForFunction(
    () => Array.from(document.images).every((img) => img.complete),
    { timeout: 20000 }
  );
  await wait(800);
  assert((await page.$$('#imagegrab-fab')).length === 1, '悬浮按钮已注入');
  await page.screenshot({ path: path.join(SHOTS, '03-插件截图-页面按钮.png') });
  console.log('  ✓ 页面截图已保存');

  /* ---------------- 2. 点击提取 ---------------- */
  console.log('\n[2] 点击「获取图片」');
  const galleryTargetPromise = browser.waitForTarget(
    (t) => t.type() === 'page' && t.url().includes('gallery.html'),
    { timeout: 30000 }
  );
  await page.click('#imagegrab-fab');
  const galleryTarget = await galleryTargetPromise;
  const gallery = await galleryTarget.page();
  if (!gallery) throw new Error('无法获取画廊页面');
  console.log('  扩展 ID:', new URL(gallery.url()).host);
  await gallery.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await gallery.waitForSelector('.card', { timeout: 30000 });
  await wait(1200);

  const cardCount = await gallery.$$eval('.card', (els) => els.length);
  console.log('  提取数量:', cardCount);
  assert(cardCount === EXPECTED, `提取到 ${EXPECTED} 张唯一图片（过滤图标/占位图/重复项）`);
  assert((await gallery.$eval('#selectedCount', (el) => el.textContent)) === String(EXPECTED), '默认全选');

  const title = await gallery.$eval('#pageTitle', (el) => el.textContent);
  const badge = await gallery.$eval('#siteBadge', (el) => el.textContent);
  assert(title.includes('收纳盒'), '画廊显示商品标题');
  assert(badge === '淘宝 / 天猫', '画廊显示来源平台');

  await gallery.waitForFunction(
    () => Array.from(document.querySelectorAll('.card img')).every((img) => img.complete),
    { timeout: 30000 }
  );

  /* ---------------- 3. 交互测试 ---------------- */
  console.log('\n[3] 全选 / 反选 / 预览');
  await gallery.click('#invert');
  await wait(250);
  assert((await gallery.$eval('#selectedCount', (el) => el.textContent)) === '0', '反选后已选数量为 0');
  assert(await gallery.$eval('#downloadBtn', (el) => el.disabled), '未选择时下载按钮禁用');

  await gallery.click('#selectAll');
  await wait(250);
  assert((await gallery.$eval('#selectedCount', (el) => el.textContent)) === String(EXPECTED), '全选恢复全部图片');

  await gallery.click('.card');
  await wait(200);
  assert(
    (await gallery.$eval('#selectedCount', (el) => el.textContent)) === String(EXPECTED - 1),
    '点击卡片可取消勾选'
  );
  await gallery.click('.card');
  await wait(200);

  await gallery.click('.preview-btn');
  await gallery.waitForFunction(() => {
    const preview = document.getElementById('preview');
    return preview && !preview.hidden;
  });
  assert(await gallery.$eval('#preview', (el) => !el.hidden), '大图预览弹窗打开');
  await gallery.screenshot({ path: path.join(SHOTS, 'extra-大图预览.png') });
  await gallery.keyboard.press('Escape');
  await wait(300);

  await gallery.screenshot({ path: path.join(SHOTS, '03-插件截图-图片画廊.png') });
  await gallery.screenshot({ path: path.join(SHOTS, '03-插件截图-图片画廊-全页.png'), fullPage: true });
  console.log('  ✓ 画廊截图已保存');

  /* ---------------- 4. 批量下载 ---------------- */
  console.log('\n[4] 批量下载并转换 PNG');
  await gallery.click('#downloadBtn');
  await gallery.waitForFunction(
    () => {
      const progress = document.getElementById('progress');
      return progress && !progress.hidden;
    },
    { timeout: 10000 }
  );

  const files = await waitForFiles(baseline, EXPECTED);
  console.log('  下载文件数:', files.length);
  assert(files.length === EXPECTED, `成功下载 ${EXPECTED} 个文件`);

  await gallery.waitForFunction(
    () => {
      const toast = document.getElementById('toast');
      return toast && /完成/.test(toast.textContent) && toast.classList.contains('is-show');
    },
    { timeout: 120000 }
  );
  const toastText = await gallery.$eval('#toast', (el) => el.textContent);
  console.log('  完成提示:', toastText.trim());
  assert(/13 张/.test(toastText), '下载完成反馈正确');
  await gallery.screenshot({ path: path.join(SHOTS, 'extra-下载完成.png') });

  console.log('\n[5] 校验 PNG 文件');
  if (!baseline.size) {
    assert(files[0] === '商品图_001.png', '文件名从 001 开始编号');
    assert(files[files.length - 1] === '商品图_013.png', '文件名按选择顺序编号');
  } else {
    assert(files.every((name) => /^商品图_\d+/.test(name)), '文件名符合「商品图_序号」规则');
  }
  for (const name of files) {
    const source = path.join(SYSTEM_DOWNLOADS, name);
    const info = pngInfo(source);
    assert(info, `${name} 是有效 PNG`);
    assert(info.width === 1200 && info.height === 1200, `${name} 为 1200×1200（${Math.round(info.size / 1024)} KB）`);
    // 仅移动本次测试新产生并已校验的文件
    fs.renameSync(source, path.join(KEEP, name));
  }
  console.log('  ✓ 测试文件已移动到 tests/downloads（未触碰原有文件）');

  /* ---------------- 6. 官网截图 ---------------- */
  console.log('\n[6] 官网页面截图');
  const docsUrl = 'file:///' + path.join(ROOT, 'docs', 'index.html').replace(/\\/g, '/');
  const docs = await browser.newPage();
  await docs.setViewport({ width: 1440, height: 900, deviceScaleFactor: 1 });
  await docs.goto(docsUrl, { waitUntil: 'load' });
  await wait(900);
  await docs.screenshot({ path: path.join(SHOTS, '06-官网-首屏.png') });

  await docs.evaluate(() => {
    document.documentElement.style.scrollBehavior = 'auto';
  });
  const docHeight = await docs.evaluate(() => document.documentElement.scrollHeight);
  for (let y = 0; y < docHeight; y += 700) {
    await docs.evaluate((top) => window.scrollTo(0, top), y);
    await wait(150);
  }
  await docs.evaluate(() => window.scrollTo(0, 0));
  await wait(800);
  await docs.screenshot({ path: path.join(SHOTS, '06-官网-全页.png'), fullPage: true });
  console.log('  ✓ 官网桌面截图已保存');

  const mobile = await browser.newPage();
  await mobile.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await mobile.goto(docsUrl, { waitUntil: 'load' });
  await wait(800);
  await mobile.screenshot({ path: path.join(SHOTS, '06-官网-手机端.png') });
  await mobile.click('#navToggle');
  await wait(500);
  assert(
    await mobile.$eval('#navLinks', (el) => el.classList.contains('is-open')),
    '移动端汉堡菜单可展开'
  );
  await mobile.screenshot({ path: path.join(SHOTS, 'extra-官网-手机菜单.png') });
  console.log('  ✓ 官网移动端截图已保存');

  // 画廊移动端
  await gallery.setViewport({ width: 390, height: 844, deviceScaleFactor: 1, isMobile: true, hasTouch: true });
  await wait(600);
  await gallery.screenshot({ path: path.join(SHOTS, 'extra-画廊-手机端.png') });

  console.log('\n控制台错误（可能含无关资源 404）:', consoleErrors.length ? consoleErrors : '无');
  console.log('\n全部测试通过 ✅');
  await browser.disconnect();
})().catch((error) => {
  console.error('\n测试失败 ❌', error);
  process.exit(1);
});

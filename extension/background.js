/**
 * 图提取 ImageGrab —— Service Worker
 * 职责：
 *   1. 接收内容脚本提取的图片列表，保存并打开画廊页
 *   2. 接收画廊页的下载请求，抓取原图并统一转换为 PNG
 *   3. 通过 chrome.downloads 保存文件，并实时广播下载进度
 */
'use strict';

const RESULT_KEY = 'imagegrab:lastResult';
const TAB_KEY = 'imagegrab:galleryTabId';
const GALLERY_PAGE = 'gallery.html';
const MAX_BATCH = 300;

let downloading = false;

/* ------------------------------------------------------------------
 * 工具函数
 * ------------------------------------------------------------------ */

/** 读取 storage.local（兼容 Promise / 回调两种 API 形态） */
function storageGet(key) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.get(key, (result) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(result || {});
    });
  });
}

function storageSet(value) {
  return new Promise((resolve, reject) => {
    chrome.storage.local.set(value, () => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve();
    });
  });
}

/** 向所有扩展页面（画廊页）广播消息；没有接收方时静默忽略 */
function broadcast(message) {
  try {
    const maybePromise = chrome.runtime.sendMessage(message);
    if (maybePromise && typeof maybePromise.catch === 'function') {
      maybePromise.catch(() => {});
    }
  } catch (_) {
    /* 画廊页已关闭，忽略 */
  }
}

/** Blob 转 data URL（Service Worker 中可用 FileReader） */
function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error('读取图片失败'));
    reader.readAsDataURL(blob);
  });
}

function guessMime(url) {
  const match = String(url).match(/\.(jpe?g|png|webp|gif|avif|bmp)(?:$|[?#_])/i);
  if (!match) return '';
  const ext = match[1].toLowerCase().replace('jpeg', 'jpg');
  return {
    jpg: 'image/jpeg',
    png: 'image/png',
    webp: 'image/webp',
    gif: 'image/gif',
    avif: 'image/avif',
    bmp: 'image/bmp'
  }[ext] || '';
}

/* ------------------------------------------------------------------
 * 图片抓取 + 转 PNG
 * ------------------------------------------------------------------ */

async function fetchImageBlob(url) {
  const response = await fetch(url, {
    credentials: 'omit',
    referrerPolicy: 'no-referrer',
    cache: 'force-cache',
    headers: {
      Accept: 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8'
    }
  });
  if (!response.ok) {
    throw new Error(`图片请求失败（HTTP ${response.status}）`);
  }
  const blob = await response.blob();
  if (!blob.size) throw new Error('图片内容为空');
  return blob;
}

/**
 * 将任意格式图片转换为 PNG data URL。
 * - 原图已是 PNG：直接复用二进制，避免二次压缩
 * - 其它格式：createImageBitmap + OffscreenCanvas 转 PNG
 */
async function toPngDataUrl(url) {
  const blob = await fetchImageBlob(url);
  const type = (blob.type || guessMime(url)).toLowerCase();

  if (type === 'image/png') {
    return blobToDataUrl(blob);
  }

  let bitmap;
  try {
    bitmap = await createImageBitmap(blob, { imageOrientation: 'from-image' });
  } catch (error) {
    throw new Error('图片解码失败，可能是不支持的格式');
  }

  try {
    const width = bitmap.width;
    const height = bitmap.height;
    if (!width || !height) throw new Error('图片尺寸无效');

    const canvas = new OffscreenCanvas(width, height);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('无法创建画布');
    ctx.drawImage(bitmap, 0, 0);

    const pngBlob = await canvas.convertToBlob({ type: 'image/png' });
    return await blobToDataUrl(pngBlob);
  } finally {
    if (bitmap && typeof bitmap.close === 'function') bitmap.close();
  }
}

function chromeDownload(options) {
  return new Promise((resolve, reject) => {
    chrome.downloads.download(options, (downloadId) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
        return;
      }
      if (typeof downloadId !== 'number') {
        reject(new Error('浏览器未能创建下载任务'));
        return;
      }
      resolve(downloadId);
    });
  });
}

/** 等待某个下载任务真正完成 / 失败，确保进度反馈准确 */
function waitForDownload(downloadId) {
  return new Promise((resolve, reject) => {
    let settled = false;
    let timer = 0;

    const finish = (error) => {
      if (settled) return;
      settled = true;
      chrome.downloads.onChanged.removeListener(onChanged);
      clearTimeout(timer);
      if (error) reject(error);
      else resolve();
    };

    const onChanged = (delta) => {
      if (!delta || delta.id !== downloadId) return;
      const state = delta.state && delta.state.current;
      if (state === 'complete') finish();
      else if (state === 'interrupted') finish(new Error((delta.error && delta.error.current) || '下载被浏览器中断'));
    };

    chrome.downloads.onChanged.addListener(onChanged);
    chrome.downloads.search({ id: downloadId }, (items) => {
      const item = items && items[0];
      if (!item) return;
      if (item.state === 'complete') finish();
      else if (item.state === 'interrupted') finish(new Error(item.error || '下载被浏览器中断'));
    });

    timer = setTimeout(() => finish(new Error('下载超时')), 120000);
  });
}

function padNumber(num, total) {
  const digits = Math.max(3, String(total).length);
  return String(num).padStart(digits, '0');
}

/**
 * 批量下载：逐张抓取 -> 转 PNG -> 保存
 */
async function downloadImages(items) {
  if (downloading) {
    throw new Error('已有下载任务正在进行，请稍候');
  }
  if (!Array.isArray(items) || !items.length) {
    throw new Error('没有选择任何图片');
  }
  if (items.length > MAX_BATCH) {
    throw new Error(`单次最多下载 ${MAX_BATCH} 张图片`);
  }

  downloading = true;
  const total = items.length;
  let ok = 0;
  let fail = 0;
  const failures = [];

  broadcast({ type: 'IMAGEGRAB_PROGRESS', phase: 'start', current: 0, total, ok, fail });

  try {
    for (let i = 0; i < total; i += 1) {
      const item = items[i] || {};
      const url = typeof item.url === 'string' ? item.url : '';
      const filename = `商品图_${padNumber(i + 1, total)}.png`;

      broadcast({
        type: 'IMAGEGRAB_PROGRESS',
        phase: 'converting',
        current: i + 1,
        total,
        ok,
        fail,
        filename,
        url
      });

      try {
        if (!/^https?:/i.test(url)) throw new Error('图片地址无效');
        const dataUrl = await toPngDataUrl(url);
        const downloadId = await chromeDownload({
          url: dataUrl,
          filename,
          conflictAction: 'uniquify',
          saveAs: false
        });
        await waitForDownload(downloadId);
        ok += 1;
      } catch (error) {
        fail += 1;
        failures.push({ url, reason: error.message });
        console.warn('[ImageGrab] 下载失败：', url, error);
      }

      broadcast({
        type: 'IMAGEGRAB_PROGRESS',
        phase: 'progress',
        current: i + 1,
        total,
        ok,
        fail,
        filename
      });
    }

    const result = { ok, fail, total, failures: failures.slice(0, 20) };
    broadcast({ type: 'IMAGEGRAB_DONE', ...result });
    return { ok: true, ...result };
  } finally {
    downloading = false;
  }
}

/* ------------------------------------------------------------------
 * 打开 / 复用画廊标签页
 * ------------------------------------------------------------------ */

async function openGalleryTab() {
  const galleryUrl = chrome.runtime.getURL(GALLERY_PAGE);

  // 优先复用上一次打开的画廊标签页
  let tabId = 0;
  try {
    if (chrome.storage.session) {
      const stored = await chrome.storage.session.get(TAB_KEY);
      tabId = stored && stored[TAB_KEY];
    }
  } catch (_) {
    /* ignore */
  }

  if (tabId) {
    try {
      const tab = await chrome.tabs.update(tabId, { active: true, url: galleryUrl });
      if (tab) return tab;
    } catch (_) {
      /* 标签页可能已被关闭，走新建流程 */
    }
  }

  const tab = await chrome.tabs.create({ url: galleryUrl });
  if (chrome.storage.session && tab && tab.id) {
    try {
      await chrome.storage.session.set({ [TAB_KEY]: tab.id });
    } catch (_) {
      /* ignore */
    }
  }
  return tab;
}

/* ------------------------------------------------------------------
 * 消息处理
 * ------------------------------------------------------------------ */

async function handleExtracted(payload) {
  if (!payload || !Array.isArray(payload.images) || !payload.images.length) {
    throw new Error('图片列表为空');
  }

  const cleaned = payload.images
    .filter((item) => item && typeof item.url === 'string' && /^https?:/i.test(item.url))
    .slice(0, MAX_BATCH)
    .map((item) => ({
      url: item.url,
      width: Number(item.width) || 0,
      height: Number(item.height) || 0,
      format: typeof item.format === 'string' ? item.format : '',
      alt: typeof item.alt === 'string' ? item.alt : '',
      source: typeof item.source === 'string' ? item.source : 'img'
    }));

  if (!cleaned.length) throw new Error('没有有效的图片地址');

  const result = {
    images: cleaned,
    pageUrl: String(payload.pageUrl || ''),
    pageTitle: String(payload.pageTitle || '未命名商品页'),
    platform: String(payload.platform || '电商平台'),
    extractedAt: Number(payload.extractedAt) || Date.now()
  };

  await storageSet({ [RESULT_KEY]: result });
  await openGalleryTab();
  return { ok: true, count: cleaned.length };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  const type = message && message.type;

  if (type === 'IMAGEGRAB_EXTRACTED') {
    handleExtracted(message.payload)
      .then(sendResponse)
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (type === 'IMAGEGRAB_DOWNLOAD') {
    downloadImages(message.items)
      .then((result) => sendResponse({ success: true, ...result }))
      .catch((error) => sendResponse({ success: false, error: error.message }));
    return true;
  }

  if (type === 'IMAGEGRAB_GET_RESULT') {
    storageGet(RESULT_KEY)
      .then((data) => sendResponse({ ok: true, result: data[RESULT_KEY] || null }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});

chrome.runtime.onInstalled.addListener((details) => {
  console.log('[ImageGrab] 扩展已安装 / 更新：', details.reason);
});

chrome.runtime.onStartup.addListener(() => {
  downloading = false;
});

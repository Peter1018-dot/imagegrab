/**
 * 图提取 ImageGrab —— 内容脚本
 * 职责：
 *   1. 在电商商品详情页右下角注入「获取图片」悬浮按钮
 *   2. 扫描页面中所有商品图片（img / srcset / 懒加载属性 / 背景图 / og:image）
 *   3. 过滤图标、logo、占位图与过小图片，去重后交给后台打开画廊页
 */
(() => {
  'use strict';

  // 防止脚本被重复注入
  if (window.__IMAGEGRAB_CONTENT_LOADED__) return;
  window.__IMAGEGRAB_CONTENT_LOADED__ = true;

  const BUTTON_ID = 'imagegrab-fab';
  const TOAST_ID = 'imagegrab-toast';
  const MAX_IMAGES = 300;
  const MIN_SIZE = 100; // 小于 100x100 的图片视为图标/占位图

  /* ------------------------------------------------------------------
   * 一、平台识别与商品详情页判断
   * ------------------------------------------------------------------ */

  const host = location.hostname;

  function detectPlatform() {
    if (/(^|\.)taobao\.com$|(^|\.)tmall\.com$/.test(host)) {
      return { key: 'taobao', name: '淘宝 / 天猫' };
    }
    if (/(^|\.)jd\.com$/.test(host)) {
      return { key: 'jd', name: '京东' };
    }
    if (/(^|\.)pinduoduo\.com$|(^|\.)yangkeduo\.com$/.test(host)) {
      return { key: 'pdd', name: '拼多多商家版' };
    }
    return null;
  }

  /**
   * 判断当前是否为商品详情页。
   * 各平台 URL 形式不同，这里做兼容处理；同时兜底识别 og:type=product。
   */
  function isProductDetailPage() {
    const path = location.pathname;
    const search = location.search;
    const platform = detectPlatform();
    if (!platform) return false;

    if (platform.key === 'taobao') {
      // item.taobao.com/item.htm?id=xxx / detail.tmall.com/item.htm?id=xxx
      if (/\/item\.htm|\/detail\.htm|\/i\d+\.htm/i.test(path)) return true;
      if (/[?&](id|itemId|item_id)=\d+/i.test(search)) return true;
    }

    if (platform.key === 'jd') {
      // item.jd.com/100012043978.html
      if (/(^|\.)item\.jd\.com$/i.test(host)) return true;
      if (/^\/\d+\.html$/i.test(path)) return true;
      if (/[?&](sku|skuId|wareId)=\d+/i.test(search)) return true;
    }

    if (platform.key === 'pdd') {
      // mobile.yangkeduo.com/goods.html?goods_id=xxx
      if (/goods|detail|product|item/i.test(path)) return true;
      if (/[?&](goods_id|goodsId|item_id|itemId|id)=\d+/i.test(search)) return true;
    }

    // 兜底：页面声明自己是一个商品
    const ogType = document.querySelector('meta[property="og:type"], meta[name="og:type"]');
    if (ogType && /product/i.test(ogType.getAttribute('content') || '')) return true;

    return false;
  }

  /* ------------------------------------------------------------------
   * 二、注入悬浮按钮与轻提示
   * ------------------------------------------------------------------ */

  let button = null;
  let toastEl = null;
  let toastTimer = 0;

  function createUi() {
    if (document.getElementById(BUTTON_ID)) {
      button = document.getElementById(BUTTON_ID);
      toastEl = document.getElementById(TOAST_ID);
      return;
    }

    button = document.createElement('button');
    button.id = BUTTON_ID;
    button.type = 'button';
    button.setAttribute('aria-label', '获取当前页面的所有商品图片');
    button.innerHTML = `
      <svg class="ig-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true">
        <path d="M4 16.5V18a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-1.5" stroke="#fff" stroke-width="2" stroke-linecap="round"/>
        <path d="M12 4v11m0 0 4-4m-4 4-4-4" stroke="#fff" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>
        <rect x="3" y="3" width="18" height="18" rx="5" stroke="#fff" stroke-width="1.6" opacity=".35"/>
      </svg>
      <span class="ig-spinner" aria-hidden="true"></span>
      <span class="ig-label">获取图片</span>
    `;
    button.addEventListener('click', onExtractClick);
    document.documentElement.appendChild(button);

    toastEl = document.createElement('div');
    toastEl.id = TOAST_ID;
    toastEl.setAttribute('role', 'status');
    toastEl.setAttribute('aria-live', 'polite');
    document.documentElement.appendChild(toastEl);
  }

  function showToast(message, duration = 2600) {
    if (!toastEl) return;
    toastEl.textContent = message;
    toastEl.classList.add('is-show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => toastEl.classList.remove('is-show'), duration);
  }

  function setButtonState(state, label) {
    if (!button) return;
    button.classList.remove('is-loading', 'is-success', 'is-error');
    if (state === 'loading') button.classList.add('is-loading');
    if (state === 'success') button.classList.add('is-success');
    if (state === 'error') button.classList.add('is-error');
    button.disabled = state === 'loading';
    const labelEl = button.querySelector('.ig-label');
    if (labelEl && label) labelEl.textContent = label;
  }

  function resetButtonLater(delay = 1800) {
    setTimeout(() => {
      setButtonState('idle', '获取图片');
    }, delay);
  }

  /* ------------------------------------------------------------------
   * 三、图片扫描与过滤
   * ------------------------------------------------------------------ */

  const IMAGE_ATTRS = [
    'src',
    'data-src',
    'data-lazy-src',
    'data-lazysrc',
    'data-original',
    'data-ks-lazyload',
    'data-lazyload',
    'data-url',
    'data-image',
    'data-img',
    'data-bimg',
    'data-large',
    'data-src-large',
    'data-zoom-image'
  ];

  // 明显的图标 / 占位图 / 装饰图特征
  const JUNK_URL_RE = /(?:^|[/_.\-])(?:sprite|icons?|logos?|avatar|placeholder|loading|lazy(?:load)?|blank|default|grey|gray|pixel|spacer|transparent|1x1|spacer\.gif)(?:[/_.\-?]|$)/i;

  function safeUrl(raw) {
    if (!raw || typeof raw !== 'string') return null;
    let value = raw.trim().replace(/^['"]|['"]$/g, '');
    if (!value) return null;
    if (/^(data|blob|javascript|about):/i.test(value)) return null;
    try {
      const url = new URL(value, document.baseURI);
      if (url.protocol !== 'http:' && url.protocol !== 'https:') return null;
      url.hash = '';
      return url.href;
    } catch (_) {
      return null;
    }
  }

  function formatFromUrl(url) {
    const pathname = (() => {
      try {
        return new URL(url).pathname;
      } catch (_) {
        return url;
      }
    })();
    const match = pathname.match(/\.(jpe?g|png|webp|gif|avif|bmp)(?:$|[_-])/i)
      || url.match(/[?&](?:format|fm|type)=(jpe?g|png|webp|gif|avif|bmp)/i);
    if (!match) return 'IMAGE';
    return match[1].toUpperCase().replace('JPEG', 'JPG');
  }

  /** 解析 srcset，返回按宽度/像素密度排序后的候选地址 */
  function parseSrcset(srcset) {
    if (!srcset) return [];
    return srcset
      .split(',')
      .map((part) => {
        const pieces = part.trim().split(/\s+/);
        if (!pieces[0]) return null;
        const descriptor = pieces[1] || '';
        let weight = 1;
        const widthMatch = descriptor.match(/^(\d+)w$/);
        const densityMatch = descriptor.match(/^([\d.]+)x$/);
        if (widthMatch) weight = Number(widthMatch[1]);
        else if (densityMatch) weight = Number(densityMatch[1]) * 1000;
        return { src: pieces[0], weight };
      })
      .filter(Boolean)
      .sort((a, b) => b.weight - a.weight);
  }

  function numericSize(value) {
    const num = parseInt(value, 10);
    return Number.isFinite(num) && num > 0 ? num : 0;
  }

  function extractImages() {
    const images = new Map(); // url -> image object

    const addImage = (rawUrl, meta = {}) => {
      const url = safeUrl(rawUrl);
      if (!url) return;
      if (images.has(url)) {
        // 后续来源若带来尺寸信息，则补全
        const exist = images.get(url);
        if (!exist.width && meta.width) exist.width = meta.width;
        if (!exist.height && meta.height) exist.height = meta.height;
        return;
      }
      if (JUNK_URL_RE.test(url)) return;

      const width = numericSize(meta.width);
      const height = numericSize(meta.height);

      // 已知尺寸且过小：直接过滤（加载失败的懒加载图尺寸为 0，不参与此判断）
      if (width && height && (width < MIN_SIZE || height < MIN_SIZE)) return;

      images.set(url, {
        url,
        width,
        height,
        format: formatFromUrl(url),
        alt: (meta.alt || '').slice(0, 80),
        source: meta.source || 'img'
      });
    };

    // 1) <img> 标签：src、懒加载属性、srcset/data-srcset
    const LAZY_ATTRS = IMAGE_ATTRS.filter((attr) => attr !== 'src');

    document.querySelectorAll('img').forEach((img) => {
      const naturalWidth = img.naturalWidth || 0;
      const naturalHeight = img.naturalHeight || 0;
      const attrWidth = numericSize(img.getAttribute('width'));
      const attrHeight = numericSize(img.getAttribute('height'));
      const alt = img.getAttribute('alt') || '';

      // 是否存在懒加载真实地址；存在时当前 src 可能只是 1x1 占位图
      const hasLazySource = LAZY_ATTRS.some((attr) => (img.getAttribute(attr) || '').trim());
      const naturalTooSmall = naturalWidth > 0 && naturalHeight > 0
        && (naturalWidth < MIN_SIZE || naturalHeight < MIN_SIZE);

      // 没有懒加载地址且尺寸过小：图标 / 占位图，整张跳过
      if (naturalTooSmall && !hasLazySource) return;

      // 已加载的真实图片用 natural 尺寸；占位图则使用标签属性尺寸
      const width = naturalTooSmall ? attrWidth : (naturalWidth || attrWidth);
      const height = naturalTooSmall ? attrHeight : (naturalHeight || attrHeight);

      // 当前渲染的 src 若只是小占位图，则不收录
      if (!naturalTooSmall) {
        if (img.currentSrc) addImage(img.currentSrc, { width, height, alt, source: 'img' });
        else if (img.getAttribute('src')) {
          addImage(img.getAttribute('src'), { width, height, alt, source: 'img' });
        }
      }

      // 懒加载地址与其它 data-* 属性始终扫描（它们的尺寸未知，不做小图过滤）
      LAZY_ATTRS.forEach((attr) => {
        const value = img.getAttribute(attr);
        if (value) addImage(value, { width: attrWidth, height: attrHeight, alt, source: 'img' });
      });

      // srcset 只取分辨率最高的一个，避免同一张图出现多个尺寸
      ['srcset', 'data-srcset'].forEach((attr) => {
        const candidates = parseSrcset(img.getAttribute(attr));
        if (candidates.length) {
          addImage(candidates[0].src, { width: attrWidth, height: attrHeight, alt, source: 'srcset' });
        }
      });
    });

    // 2) <picture><source srcset="...">
    document.querySelectorAll('picture source[srcset], source[data-srcset]').forEach((source) => {
      ['srcset', 'data-srcset'].forEach((attr) => {
        const candidates = parseSrcset(source.getAttribute(attr));
        if (candidates.length) addImage(candidates[0].src, { source: 'picture' });
      });
    });

    // 3) 背景图 background-image
    const skipTags = new Set(['SCRIPT', 'STYLE', 'LINK', 'META', 'HEAD', 'NOSCRIPT', 'TEMPLATE', 'TITLE']);
    document.querySelectorAll('body *').forEach((el) => {
      if (skipTags.has(el.tagName)) return;
      let background = '';
      try {
        background = getComputedStyle(el).backgroundImage || '';
      } catch (_) {
        return;
      }
      if (!background || background === 'none') return;
      const urlRe = /url\((['"]?)(.*?)\1\)/g;
      let match;
      while ((match = urlRe.exec(background))) {
        if (match[2]) addImage(match[2], { source: 'background' });
      }
    });

    // 4) og:image / itemprop=image
    document
      .querySelectorAll('meta[property="og:image"], meta[name="og:image"], meta[itemprop="image"]')
      .forEach((meta) => {
        const content = meta.getAttribute('content');
        if (content) addImage(content, { source: 'meta' });
      });

    // 5) JSON-LD 中的商品图（部分平台会使用）
    document.querySelectorAll('script[type="application/ld+json"]').forEach((script) => {
      try {
        const data = JSON.parse(script.textContent || '{}');
        const list = Array.isArray(data) ? data : [data];
        list.forEach((item) => {
          if (!item || typeof item !== 'object') return;
          const image = item.image;
          if (typeof image === 'string') addImage(image, { source: 'json-ld' });
          if (Array.isArray(image)) image.forEach((src) => addImage(src, { source: 'json-ld' }));
          if (image && typeof image === 'object' && image.url) addImage(image.url, { source: 'json-ld' });
        });
      } catch (_) {
        /* 忽略非法 JSON-LD */
      }
    });

    return Array.from(images.values()).slice(0, MAX_IMAGES);
  }

  /* ------------------------------------------------------------------
   * 四、点击提取并交给后台
   * ------------------------------------------------------------------ */

  let extracting = false;

  async function onExtractClick() {
    if (extracting) return;
    if (!isProductDetailPage()) {
      showToast('当前页面不是商品详情页，请打开商品详情后再试');
      return;
    }

    extracting = true;
    setButtonState('loading', '正在提取…');
    showToast('正在扫描页面中的商品图片…', 1600);

    try {
      // 给浏览器一帧时间渲染 loading 状态
      await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 60)));

      const images = extractImages();
      if (!images.length) {
        setButtonState('error', '未找到图片');
        showToast('没有找到可下载的商品图片，试试滚动页面加载更多图片后再试', 3600);
        resetButtonLater(2600);
        return;
      }

      const platform = detectPlatform();
      const payload = {
        images,
        pageUrl: location.href,
        pageTitle: document.title || '未命名商品页',
        platform: platform ? platform.name : '电商平台',
        extractedAt: Date.now()
      };

      const response = await chrome.runtime.sendMessage({
        type: 'IMAGEGRAB_EXTRACTED',
        payload
      });

      if (!response || !response.ok) {
        throw new Error((response && response.error) || '后台未响应');
      }

      setButtonState('success', `已提取 ${images.length} 张`);
      showToast(`已提取 ${images.length} 张图片，正在打开预览页…`, 2200);
      resetButtonLater(2200);
    } catch (error) {
      console.error('[ImageGrab] 提取失败：', error);
      setButtonState('error', '提取失败');
      const message = /context invalidated|Extension context/i.test(String(error))
        ? '插件已更新，请刷新当前页面后重试'
        : '提取失败，请刷新页面后重试';
      showToast(message, 3200);
      resetButtonLater(2600);
    } finally {
      extracting = false;
    }
  }

  /* ------------------------------------------------------------------
   * 五、初始化 & 单页应用路由变化监听
   * ------------------------------------------------------------------ */

  function syncVisibility() {
    if (!detectPlatform()) return;
    if (isProductDetailPage()) {
      if (!document.getElementById(BUTTON_ID)) createUi();
      if (button) button.style.display = '';
    } else if (button) {
      button.style.display = 'none';
    }
  }

  function init() {
    if (!detectPlatform()) return;
    if (!isProductDetailPage()) return;
    createUi();
    // 部分电商为单页应用，路由切换后重新判断按钮显隐
    window.addEventListener('popstate', syncVisibility);
    setInterval(syncVisibility, 3000);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init, { once: true });
  } else {
    init();
  }
})();

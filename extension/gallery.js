/**
 * 图提取 ImageGrab —— 画廊页脚本
 * 职责：展示提取结果、管理勾选状态、发起批量下载、显示下载进度与大图预览
 */
'use strict';

const RESULT_KEY = 'imagegrab:lastResult';

const state = {
  result: null,
  selected: new Set(),
  downloading: false,
  finished: false,
  toastTimer: 0,
  progressTimer: 0
};

const els = {
  siteBadge: document.getElementById('siteBadge'),
  pageTitle: document.getElementById('pageTitle'),
  pageLink: document.getElementById('pageLink'),
  pageHost: document.getElementById('pageHost'),
  selectedCount: document.getElementById('selectedCount'),
  totalCount: document.getElementById('totalCount'),
  countInline: document.getElementById('countInline'),
  selectedCountBottom: document.getElementById('selectedCountBottom'),
  selectAll: document.getElementById('selectAll'),
  invert: document.getElementById('invert'),
  downloadBtn: document.getElementById('downloadBtn'),
  downloadBtnBottom: document.getElementById('downloadBtnBottom'),
  selectAllBottom: document.getElementById('selectAllBottom'),
  grid: document.getElementById('grid'),
  empty: document.getElementById('empty'),
  progress: document.getElementById('progress'),
  progressBar: document.getElementById('progressBar'),
  progressText: document.getElementById('progressText'),
  toast: document.getElementById('toast'),
  preview: document.getElementById('preview'),
  previewImg: document.getElementById('previewImg'),
  previewDims: document.getElementById('previewDims'),
  previewOpen: document.getElementById('previewOpen')
};

/* ------------------------------------------------------------------
 * 初始化与渲染
 * ------------------------------------------------------------------ */

async function loadResult() {
  try {
    const data = await chrome.storage.local.get(RESULT_KEY);
    const result = data && data[RESULT_KEY];
    if (!result || !Array.isArray(result.images) || !result.images.length) {
      renderEmpty();
      return;
    }
    state.result = result;
    state.selected = new Set(result.images.map((_, index) => index));
    render();
  } catch (error) {
    console.error('[ImageGrab] 读取提取结果失败：', error);
    renderEmpty();
  }
}

function renderEmpty() {
  els.empty.hidden = false;
  els.grid.hidden = true;
  els.countInline.textContent = '0';
  els.totalCount.textContent = '0';
  updateSelectionUi();
}

function render() {
  const result = state.result;
  const images = result.images;

  document.title = `${result.pageTitle || '商品图片'} · 图提取`;

  els.siteBadge.textContent = result.platform || '电商平台';
  els.pageTitle.textContent = result.pageTitle || '商品图片预览';
  els.pageTitle.title = result.pageTitle || '';

  if (/^https?:/i.test(result.pageUrl || '')) {
    els.pageLink.href = result.pageUrl;
    els.pageLink.hidden = false;
    try {
      els.pageHost.textContent = new URL(result.pageUrl).hostname;
    } catch (_) {
      els.pageHost.textContent = '商品详情页';
    }
  } else {
    els.pageLink.hidden = true;
  }

  els.totalCount.textContent = String(images.length);
  els.countInline.textContent = String(images.length);
  els.empty.hidden = true;
  els.grid.hidden = false;
  els.grid.textContent = '';

  const fragment = document.createDocumentFragment();
  images.forEach((image, index) => fragment.appendChild(createCard(image, index)));
  els.grid.appendChild(fragment);

  updateSelectionUi();
}

function createCard(image, index) {
  const card = document.createElement('article');
  card.className = 'card is-selected';
  card.dataset.index = String(index);
  card.tabIndex = 0;
  card.setAttribute('aria-label', `商品图片 ${index + 1}，点击勾选`);

  const thumb = document.createElement('div');
  thumb.className = 'thumb';

  const img = document.createElement('img');
  img.src = image.url;
  img.alt = image.alt || `商品图片 ${index + 1}`;
  img.loading = index < 60 ? 'eager' : 'lazy';
  img.decoding = 'async';
  img.referrerPolicy = 'no-referrer';
  img.addEventListener('error', () => card.classList.add('is-broken'));

  const fallback = document.createElement('span');
  fallback.className = 'thumb-fallback';
  fallback.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <rect x="3" y="4" width="18" height="16" rx="3" stroke="currentColor" stroke-width="1.6"/>
      <path d="M5 17l4.5-4.5 3 3L15 13l4 4" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>
      <circle cx="9" cy="9" r="1.6" stroke="currentColor" stroke-width="1.6"/>
    </svg>
    图片预览加载失败
  `;

  const check = document.createElement('span');
  check.className = 'check';
  const input = document.createElement('input');
  input.type = 'checkbox';
  input.checked = true;
  input.tabIndex = -1;
  input.setAttribute('aria-label', `选择第 ${index + 1} 张图片`);
  input.addEventListener('click', (event) => event.stopPropagation());
  input.addEventListener('change', (event) => {
    setSelected(index, event.target.checked);
  });
  check.appendChild(input);

  const previewBtn = document.createElement('button');
  previewBtn.type = 'button';
  previewBtn.className = 'preview-btn';
  previewBtn.title = '查看大图';
  previewBtn.setAttribute('aria-label', `查看第 ${index + 1} 张图片大图`);
  previewBtn.innerHTML = `
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <circle cx="11" cy="11" r="6.5" stroke="currentColor" stroke-width="1.8"/>
      <path d="M11 8.5v5M8.5 11h5M15.8 15.8L20 20" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/>
    </svg>
  `;
  previewBtn.addEventListener('click', (event) => {
    event.stopPropagation();
    openPreview(index);
  });

  thumb.append(img, fallback, check, previewBtn);

  const meta = document.createElement('div');
  meta.className = 'card-meta';

  const format = document.createElement('span');
  const formatName = image.format || 'IMAGE';
  format.className = 'format-chip';
  if (/png/i.test(formatName)) format.classList.add('is-png');
  if (/webp/i.test(formatName)) format.classList.add('is-webp');
  if (/gif/i.test(formatName)) format.classList.add('is-gif');
  format.textContent = formatName;

  const dims = document.createElement('span');
  dims.className = 'dims';
  dims.textContent = image.width && image.height ? `${image.width} × ${image.height}` : '尺寸未知';

  meta.append(format, dims);
  card.append(thumb, meta);

  // 点击卡片切换勾选
  card.addEventListener('click', () => {
    setSelected(index, !state.selected.has(index));
  });

  card.addEventListener('keydown', (event) => {
    if (event.target !== card) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      setSelected(index, !state.selected.has(index));
    }
  });

  return card;
}

/* ------------------------------------------------------------------
 * 勾选逻辑
 * ------------------------------------------------------------------ */

function setSelected(index, selected) {
  if (!state.result) return;
  if (selected) state.selected.add(index);
  else state.selected.delete(index);
  syncCard(index);
  updateSelectionUi();
}

function syncCard(index) {
  const card = els.grid.querySelector(`.card[data-index="${index}"]`);
  if (!card) return;
  const selected = state.selected.has(index);
  card.classList.toggle('is-selected', selected);
  const input = card.querySelector('input[type="checkbox"]');
  if (input) input.checked = selected;
}

function syncAllCards() {
  els.grid.querySelectorAll('.card').forEach((card) => {
    const index = Number(card.dataset.index);
    const selected = state.selected.has(index);
    card.classList.toggle('is-selected', selected);
    const input = card.querySelector('input[type="checkbox"]');
    if (input) input.checked = selected;
  });
}

function updateSelectionUi() {
  const selected = state.selected.size;
  const total = state.result ? state.result.images.length : 0;
  els.selectedCount.textContent = String(selected);
  els.selectedCountBottom.textContent = String(selected);
  els.totalCount.textContent = String(total);
  const disabled = selected === 0 || state.downloading;
  els.downloadBtn.disabled = disabled;
  els.downloadBtnBottom.disabled = disabled;
}

function selectAll() {
  if (!state.result) return;
  state.selected = new Set(state.result.images.map((_, index) => index));
  syncAllCards();
  updateSelectionUi();
}

function invertSelection() {
  if (!state.result) return;
  const next = new Set();
  state.result.images.forEach((_, index) => {
    if (!state.selected.has(index)) next.add(index);
  });
  state.selected = next;
  syncAllCards();
  updateSelectionUi();
}

/* ------------------------------------------------------------------
 * 下载
 * ------------------------------------------------------------------ */

function setDownloading(value) {
  state.downloading = value;
  updateSelectionUi();
}

async function startDownload() {
  if (state.downloading || !state.result) return;

  const items = Array.from(state.selected)
    .sort((a, b) => a - b)
    .map((index) => ({ url: state.result.images[index].url }));

  if (!items.length) {
    showToast('请先选择要下载的图片', 'warning');
    return;
  }

  state.finished = false;
  setDownloading(true);
  showProgress(0, items.length, `准备下载 ${items.length} 张图片…`);

  try {
    const response = await chrome.runtime.sendMessage({
      type: 'IMAGEGRAB_DOWNLOAD',
      items
    });

    if (!response || !response.success) {
      throw new Error((response && response.error) || '下载失败');
    }

    // 正常情况下后台会先广播 DONE；这里兜底处理（内部会去重）
    finishDownload(response);
  } catch (error) {
    console.error('[ImageGrab] 下载失败：', error);
    setDownloading(false);
    hideProgress();
    showToast(`下载失败：${error.message || '未知错误'}`, 'error', 4200);
  }
}

function showProgress(percent, total, message) {
  clearTimeout(state.progressTimer);
  els.progress.hidden = false;
  els.progressBar.style.width = `${Math.min(100, Math.max(0, percent))}%`;
  els.progressText.textContent = message || (total ? `共 ${total} 张图片` : '准备下载…');
}

function hideProgress() {
  clearTimeout(state.progressTimer);
  state.progressTimer = setTimeout(() => {
    els.progress.hidden = true;
    els.progressBar.style.width = '0%';
  }, 1200);
}

function onProgress(message) {
  if (state.finished) return;
  if (message.phase === 'start') {
    showProgress(0, message.total, `准备下载 ${message.total} 张图片…`);
    return;
  }

  const total = message.total || 1;
  const current = message.current || 0;
  const percent = message.phase === 'converting'
    ? ((current - 1) / total) * 100
    : (current / total) * 100;

  let text;
  if (message.phase === 'converting') {
    text = `正在抓取并转换第 ${current} / ${total} 张…`;
  } else {
    text = `已处理 ${current} / ${total} 张 · 成功 ${message.ok || 0} 张`;
    if (message.fail) text += ` · 失败 ${message.fail} 张`;
  }

  showProgress(percent, total, text);
}

function finishDownload(result) {
  if (!result || typeof result.ok !== 'number' || state.finished) return;
  state.finished = true;
  const { ok = 0, fail = 0, total = 0 } = result;

  clearTimeout(state.progressTimer);
  showProgress(100, total, `下载完成：成功 ${ok} 张${fail ? `，失败 ${fail} 张` : ''}`);
  setDownloading(false);

  if (fail > 0) {
    showToast(`完成：成功 ${ok} 张，失败 ${fail} 张。失败图片可能受防盗链或跨域限制。`, 'warning', 5200);
  } else {
    showToast(`下载完成，共保存 ${ok} 张 PNG 图片`, 'success');
  }

  hideProgress();
}

/* ------------------------------------------------------------------
 * 轻提示
 * ------------------------------------------------------------------ */

function showToast(message, type = 'info', duration = 3200) {
  clearTimeout(state.toastTimer);
  els.toast.textContent = message;
  els.toast.className = 'toast is-show';
  if (type === 'success') els.toast.classList.add('is-success');
  if (type === 'error') els.toast.classList.add('is-error');
  if (type === 'warning') els.toast.classList.add('is-warning');

  state.toastTimer = setTimeout(() => {
    els.toast.classList.remove('is-show');
  }, duration);
}

/* ------------------------------------------------------------------
 * 大图预览
 * ------------------------------------------------------------------ */

function openPreview(index) {
  if (!state.result) return;
  const image = state.result.images[index];
  if (!image) return;

  els.previewImg.src = image.url;
  els.previewImg.alt = image.alt || `商品图片 ${index + 1}`;
  els.previewDims.textContent = image.width && image.height
    ? `${image.width} × ${image.height} · ${image.format || 'IMAGE'}`
    : `${image.format || 'IMAGE'} · 尺寸未知`;
  els.previewOpen.href = image.url;

  els.preview.hidden = false;
  document.body.style.overflow = 'hidden';
  const closeBtn = els.preview.querySelector('.preview-close');
  if (closeBtn) closeBtn.focus({ preventScroll: true });
}

function closePreview() {
  els.preview.hidden = true;
  document.body.style.overflow = '';
  setTimeout(() => {
    els.previewImg.removeAttribute('src');
  }, 200);
}

/* ------------------------------------------------------------------
 * 事件绑定
 * ------------------------------------------------------------------ */

els.selectAll.addEventListener('click', selectAll);
els.selectAllBottom.addEventListener('click', selectAll);
els.invert.addEventListener('click', invertSelection);
els.downloadBtn.addEventListener('click', startDownload);
els.downloadBtnBottom.addEventListener('click', startDownload);

els.preview.querySelectorAll('[data-close="preview"]').forEach((el) => {
  el.addEventListener('click', closePreview);
});

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !els.preview.hidden) {
    closePreview();
  }
});

chrome.runtime.onMessage.addListener((message) => {
  if (!message || typeof message.type !== 'string') return;

  if (message.type === 'IMAGEGRAB_PROGRESS') {
    onProgress(message);
  } else if (message.type === 'IMAGEGRAB_DONE') {
    finishDownload(message);
  }
});

loadResult();

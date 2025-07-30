// Pinterest Split + Fabric Board (localStorage, no pan, no zoom, RIGHT board, collapsible Notion-like toolbar)
// 前提: fabric.min.js を manifest で content.js より先に読み込み済み

(() => {
  'use strict';
  const APP_ID = 'prx-root-purefab';
  const STYLE_ID = APP_ID + '-style';

  // ----- 重要: 既存ノードを必ずクリーンアップしてからマウント -----
  try {
    const oldHost = document.getElementById(APP_ID);
    if (oldHost && oldHost.parentNode) oldHost.parentNode.removeChild(oldHost);
    const oldStyle = document.getElementById(STYLE_ID);
    if (oldStyle && oldStyle.parentNode) oldStyle.parentNode.removeChild(oldStyle);
  } catch (e) {}

  // 離脱時にも片付け（bfcache/復帰の不整合抑制）
  window.addEventListener('pagehide', () => {
    try {
      const n1 = document.getElementById(APP_ID);
      if (n1 && n1.parentNode) n1.parentNode.removeChild(n1);
      const n2 = document.getElementById(STYLE_ID);
      if (n2 && n2.parentNode) n2.parentNode.removeChild(n2);
    } catch {}
  });

  // -------- 基本設定 --------
  const SPLIT_RATIO = 0.30;                  // 右 30%（ボード）/ 左 70%（Pinterest）
  const LS_KEY = 'prx.fabric.board.json.v1'; // Canvas JSON 保存
  const LS_UI_KEY = 'prx.fabric.board.ui.v1'; // UI 状態（ツールバー開閉）
  const Z = 2147483600;
  const BG = '#1c1c1c';
  const CANVAS_BG = '#2a2a2a';

  // 既定の UI 状態
  const uiState = loadUIState() || { collapsed: false };

  // -------- スタイル注入 --------
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    :root {
      --prx-radius: 10px;
      --prx-radius-sm: 8px;
      --prx-border: #2f2f2f;
      --prx-surface: #202020;
      --prx-surface-2: #2a2a2a;
      --prx-text: #e8e8e8;
      --prx-text-dim: #bdbdbd;
      --prx-shadow: rgba(0,0,0,0.35);
      --prx-focus: #5b9cff;
    }
    html { overflow-x: hidden !important; }
    /* 右側 30vw をボードが占有するため、本体は右余白を空ける */
    body { margin-right: ${SPLIT_RATIO * 100}vw !important; }
    /* Pinterest 側の最大幅/固定ヘッダー調整の保険 */
    [role="main"], #__PWS_ROOT__, #__PWS_ROOT__ > div { max-width: 100% !important; }
    /* ユーザー報告の特定コンテナ幅調整（必要に応じて） */
    .jzS.un8.C9i.TB_ { width: 68% !important; }

    /* ---- Notion風バー ---- */
    #${APP_ID} .prx-bar {
      display: grid;
      grid-template-rows: auto auto;
      gap: 6px;
      padding: 8px 10px;
      background: var(--prx-surface);
      border-bottom: 1px solid var(--prx-border);
      font: 12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial;
      box-shadow: 0 2px 8px var(--prx-shadow);
    }
    #${APP_ID} .prx-title-row {
      display: flex; align-items: center; gap: 8px;
      min-height: 32px;
    }
    #${APP_ID} .prx-pill {
      display: inline-flex; align-items: center; gap: 6px;
      color: var(--prx-text);
      font-weight: 600;
      padding: 6px 10px;
      border: 1px solid var(--prx-border);
      border-radius: var(--prx-radius);
      background: rgba(255,255,255,0.03);
    }
    #${APP_ID} .prx-dot {
      width: 8px; height: 8px; border-radius: 50%; background: #7bdcb5;
      box-shadow: 0 0 0 2px rgba(123,220,181,0.2);
    }
    #${APP_ID} .prx-icon-btn {
      display: inline-flex; align-items: center; justify-content: center;
      width: 28px; height: 28px; border-radius: var(--prx-radius-sm);
      border: 1px solid var(--prx-border);
      background: var(--prx-surface-2);
      cursor: pointer;
      user-select: none;
    }
    #${APP_ID} .prx-icon-btn:hover { filter: brightness(1.08); }
    #${APP_ID} .prx-icon-btn:focus { outline: 2px solid var(--prx-focus); outline-offset: 1px; }
    #${APP_ID} .prx-chevron { display: inline-block; transition: transform .18s ease; }
    #${APP_ID} .prx-bar.collapsed .prx-chevron { transform: rotate(-90deg); }

    #${APP_ID} .prx-controls {
      display: grid;
      grid-template-columns: 1fr auto auto;
      gap: 8px;
      overflow: hidden;
      max-height: 120px;                 /* アニメーション用最大高さ */
      transition: max-height .18s ease, padding .18s ease;
      padding-top: 2px;
    }
    #${APP_ID} .prx-bar.collapsed .prx-controls {
      max-height: 0;
      padding-top: 0;
    }
    #${APP_ID} input.prx-input {
      width: 100%;
      background: var(--prx-surface-2);
      color: var(--prx-text);
      border: 1px solid var(--prx-border);
      border-radius: var(--prx-radius);
      padding: 8px 10px;
      outline: none;
    }
    #${APP_ID} input.prx-input::placeholder { color: var(--prx-text-dim); }
    #${APP_ID} input.prx-input:focus {
      border-color: var(--prx-focus);
      box-shadow: 0 0 0 2px rgba(91,156,255,0.25);
    }
    #${APP_ID} .prx-btn {
      background: var(--prx-surface-2);
      color: var(--prx-text);
      border: 1px solid var(--prx-border);
      border-radius: var(--prx-radius);
      padding: 8px 12px;
      cursor: pointer;
      user-select: none;
    }
    #${APP_ID} .prx-btn:hover { filter: brightness(1.08); }
    #${APP_ID} .prx-btn:focus { outline: 2px solid var(--prx-focus); outline-offset: 1px; }
  `;
  (document.head || document.documentElement).appendChild(style);

  // -------- 右ペイン（ボード）DOM 構築 --------
  const host = document.createElement('div');
  host.id = APP_ID;
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0 0 0 auto',             // 右寄せ
    width: `${SPLIT_RATIO * 100}vw`,
    height: '100vh',
    background: BG,
    zIndex: String(Z),
    display: 'flex',
    flexDirection: 'column',
    pointerEvents: 'auto',
    userSelect: 'none',
    boxSizing: 'border-box',
    borderLeft: '1px solid #000',
    boxShadow: '-4px 0 8px rgba(0,0,0,0.3)'
  });

  // ===== Notion風ツールバー（開閉対応） =====
  const bar = document.createElement('div');
  bar.className = 'prx-bar';
  if (uiState.collapsed) bar.classList.add('collapsed');

  // 見出し行
  const titleRow = document.createElement('div');
  titleRow.className = 'prx-title-row';

  const btnToggle = document.createElement('button');
  btnToggle.className = 'prx-icon-btn';
  btnToggle.title = '開閉';
  const chev = document.createElement('span');
  chev.className = 'prx-chevron';
  chev.textContent = '▾';
  btnToggle.appendChild(chev);

  const pill = document.createElement('div');
  pill.className = 'prx-pill';
  const dot = document.createElement('span');
  dot.className = 'prx-dot';
  const title = document.createElement('span');
  title.textContent = 'Fabric Board';
  pill.append(dot, title);

  // 操作行（開閉対象）
  const controls = document.createElement('div');
  controls.className = 'prx-controls';

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.placeholder = '画像URLを貼り付け（pinimg など推奨）';
  urlInput.className = 'prx-input';

  const btnAdd = document.createElement('button');
  btnAdd.textContent = 'URL追加';
  btnAdd.className = 'prx-btn';

  const btnClear = document.createElement('button');
  btnClear.textContent = '全削除';
  btnClear.className = 'prx-btn';

  titleRow.append(btnToggle, pill);
  controls.append(urlInput, btnAdd, btnClear);
  bar.append(titleRow, controls);

  // キャンバスラッパ
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'relative',
    flex: '1',
    minHeight: '0',
    display: 'block'
  });

  // <canvas>
  const elCanvas = document.createElement('canvas');
  elCanvas.id = APP_ID + '-canvas';
  Object.assign(elCanvas.style, { display: 'block' });
  wrap.appendChild(elCanvas);

  host.append(bar, wrap);
  (document.body || document.documentElement).appendChild(host);

  // ===== 開閉ロジック =====
  btnToggle.addEventListener('click', () => {
    bar.classList.toggle('collapsed');
    uiState.collapsed = bar.classList.contains('collapsed');
    saveUIState(uiState);
    // 開閉後にキャンバス再レイアウト（高さ変化対応）
    queueMicrotask(resize);
  });

  // ===== Fabric.js 初期化 =====
  /** @type {fabric.Canvas} */
  const canvas = new fabric.Canvas(elCanvas, {
    backgroundColor: CANVAS_BG,
    selection: true,
    preserveObjectStacking: true,
    controlsAboveOverlay: true,
    viewportTransform: [1, 0, 0, 1, 0, 0] // パン/ズーム無効
  });

  canvas.enableRetinaScaling = true;

  // ホイールズーム完全無効化
  canvas.on('mouse:wheel', (opt) => {
    opt.e.preventDefault();
    opt.e.stopPropagation();
  });

  // キャンバスのリサイズ
  const resize = () => {
    const rect = wrap.getBoundingClientRect();
    canvas.setDimensions({ width: rect.width, height: rect.height }, { backstoreOnly: false });
    canvas.renderAll();
  };
  new ResizeObserver(resize).observe(wrap);
  resize();

  // -------- 画像追加ユーティリティ --------
  function addImageFromUrl(url) {
    if (!url) return;
    const clean = url.trim();
    fabric.Image.fromURL(clean, (img) => {
      if (!img) return;
      img.set({ crossOrigin: 'anonymous' });

      fitImageInside(img, canvas.getWidth(), canvas.getHeight(), 0.9);
      img.set({
        left: (canvas.getWidth() - img.getScaledWidth()) / 2,
        top: (canvas.getHeight() - img.getScaledHeight()) / 2,
        selectable: true
      });

      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.requestRenderAll();
      scheduleSave();
      tryEmbedImageAsDataURL(img).then((changed) => { if (changed) scheduleSave(); });
    }, { crossOrigin: 'anonymous' });
  }

  function addImageFromFile(file) {
    if (!file || !file.type?.startsWith('image/')) return;
    const reader = new FileReader();
    reader.onload = () => addImageFromUrl(reader.result);
    reader.readAsDataURL(file);
  }

  function addImageFromBlob(blob) {
    if (!blob || !blob.type?.startsWith('image/')) return;
    const url = URL.createObjectURL(blob);
    fabric.Image.fromURL(url, (img) => {
      if (!img) { URL.revokeObjectURL(url); return; }
      fitImageInside(img, canvas.getWidth(), canvas.getHeight(), 0.9);
      img.set({
        left: (canvas.getWidth() - img.getScaledWidth()) / 2,
        top: (canvas.getHeight() - img.getScaledHeight()) / 2,
        selectable: true
      });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.requestRenderAll();
      scheduleSave();
      tryEmbedImageAsDataURL(img).then(() => scheduleSave());
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }

  function fitImageInside(img, cw, ch, maxRatio = 1.0) {
    const w = img.width || 1;
    const h = img.height || 1;
    const scale = Math.min((cw * maxRatio) / w, (ch * maxRatio) / h, 1);
    img.scale(scale);
  }

  async function tryEmbedImageAsDataURL(fimg) {
    return new Promise((resolve) => {
      try {
        const el = fimg.getElement();
        const t = document.createElement('canvas');
        t.width = el.naturalWidth || el.videoWidth || el.width || fimg.width || 1;
        t.height = el.naturalHeight || el.videoHeight || el.height || fimg.height || 1;
        const ctx = t.getContext('2d');
        ctx.drawImage(el, 0, 0);
        const dataUrl = t.toDataURL('image/png');
        fimg.setSrc(dataUrl, () => {
          canvas.requestRenderAll();
          resolve(true);
        });
      } catch (e) {
        resolve(false);
      }
    });
  }

  // -------- D&D --------
  const preventDefaults = (e) => { e.preventDefault(); e.stopPropagation(); };
  ['dragenter', 'dragover', 'dragleave', 'drop'].forEach((ev) => {
    host.addEventListener(ev, preventDefaults, false);
    wrap.addEventListener(ev, preventDefaults, false);
  });

  wrap.addEventListener('drop', (e) => {
    const dt = e.dataTransfer;
    if (!dt) return;
    if (dt.files && dt.files.length) {
      for (const f of dt.files) addImageFromFile(f);
      return;
    }
    const uriList = dt.getData('text/uri-list');
    const plain = dt.getData('text/plain');
    const text = (uriList || plain || '').trim();
    if (isProbablyUrl(text)) addImageFromUrl(text);
  });

  function isProbablyUrl(s) {
    try { new URL(s); return true; } catch { return false; }
  }

  // -------- クリップボード貼り付け --------
  window.addEventListener('paste', async (e) => {
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    const cd = e.clipboardData;
    if (!cd) return;

    const items = Array.from(cd.items || []);
    for (const it of items) {
      if (it.kind === 'file' && it.type?.startsWith('image/')) {
        const blob = it.getAsFile();
        if (blob) { addImageFromBlob(blob); return; }
      }
    }
    const text = cd.getData('text')?.trim();
    if (text && isProbablyUrl(text)) addImageFromUrl(text);
  });

  // -------- キーボードショートカット --------
  window.addEventListener('keydown', (e) => {
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) return;

    if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = canvas.getActiveObjects();
      if (active && active.length) {
        active.forEach(obj => canvas.remove(obj));
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        scheduleSave();
        e.preventDefault();
      }
    }
  });

  // -------- ボタン動作 --------
  btnAdd.addEventListener('click', () => {
    if (urlInput.value.trim()) {
      addImageFromUrl(urlInput.value.trim());
      urlInput.value = '';
    }
  });
  urlInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') btnAdd.click();
  });

  btnClear.addEventListener('click', () => {
    if (!canvas.getObjects().length) return;
    if (confirm('ボード上の全てのオブジェクトを削除します。よろしいですか？')) {
      canvas.clear();
      canvas.setBackgroundColor(CANVAS_BG, () => {});
      canvas.requestRenderAll();
      scheduleSave();
    }
  });

  // -------- 永続化（localStorage）--------
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 600);
  }

  async function saveNow() {
    const imgs = canvas.getObjects('image');
    for (const img of imgs) {
      await tryEmbedImageAsDataURL(img).catch(() => {});
    }
    const json = canvas.toJSON(['selectable']);
    localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, json }));
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed?.json) return;
      canvas.loadFromJSON(parsed.json, () => {
        canvas.renderAll();
      });
    } catch (e) {
      console.warn('Failed to load canvas JSON:', e);
    }
  }
  loadFromLocalStorage();

  // Fabric 変更イベントで自動保存
  ['object:added', 'object:modified', 'object:removed'].forEach(ev => {
    canvas.on(ev, scheduleSave);
  });

  // -------- UI 状態 保存/復元 --------
  function saveUIState(state) {
    try { localStorage.setItem(LS_UI_KEY, JSON.stringify(state)); } catch {}
  }
  function loadUIState() {
    try { return JSON.parse(localStorage.getItem(LS_UI_KEY) || ''); } catch { return null; }
  }

  // -------- 補助（旧: 見た目 helpers は CSS に移行）--------
})();

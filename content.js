// Pinterest Split + Fabric Board (localStorage, no pan, no zoom, RIGHT board)
// 前提: fabric.min.js を manifest で content.js より先に読み込み済み

(() => {
  'use strict';
  const APP_ID = 'prx-root-purefab';
  if (document.getElementById(APP_ID)) return; // 多重起動防止

  // -------- 基本設定 --------
  const SPLIT_RATIO = 0.30;                  // 右 30%（ボード）/ 左 70%（Pinterest）
  const LS_KEY = 'prx.fabric.board.json.v1'; // localStorage キー
  const Z = 2147483600;                      // 高めの z-index
  const BG = '#1c1c1c';
  const CANVAS_BG = '#2a2a2a';

  // -------- スタイル注入（Pinterest側を 70% に）--------
  const style = document.createElement('style');
  style.id = APP_ID + '-style';
  style.textContent = `
    html { overflow-x: hidden !important; }
    /* 右側 30vw をボードが占有するため、本体は右余白を空ける */
    body { margin-right: ${SPLIT_RATIO * 100}vw !important; }
    /* Pinterest が固定ヘッダー等で横幅を使い切る場合に備えて */
    [role="main"], #__PWS_ROOT__, #__PWS_ROOT__ > div { max-width: 100% !important; }
  `;
  document.documentElement.appendChild(style);

  // -------- 右ペイン（ボード）DOM 構築 --------
  const host = document.createElement('div');
  host.id = APP_ID;
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0 0 0 auto',             // ← 右寄せ
    width: `${SPLIT_RATIO * 100}vw`,
    height: '100vh',
    background: BG,
    zIndex: String(Z),
    display: 'flex',
    flexDirection: 'column',
    pointerEvents: 'auto',
    userSelect: 'none',
    boxSizing: 'border-box',
    borderLeft: '1px solid #000'     // ← 右ペインなので左側に罫線
  });

  // ツールバー
  const bar = document.createElement('div');
  Object.assign(bar.style, {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    padding: '8px',
    background: '#202020',
    borderBottom: '1px solid #000',
    font: '12px/1.2 system-ui, -apple-system, Segoe UI, Roboto, Helvetica, Arial'
  });

  const title = document.createElement('div');
  title.textContent = 'Fabric Board (No Pan / No Zoom)';
  Object.assign(title.style, { color: '#ddd', fontWeight: '600', marginRight: '8px' });

  const urlInput = document.createElement('input');
  urlInput.type = 'text';
  urlInput.placeholder = '画像URLを貼り付け（pinimg等推奨）';
  Object.assign(urlInput.style, {
    flex: '1',
    minWidth: '120px',
    background: '#2a2a2a',
    color: '#eee',
    border: '1px solid #3a3a3a',
    borderRadius: '6px',
    padding: '6px 8px',
    outline: 'none'
  });

  const btnAdd = document.createElement('button');
  btnAdd.textContent = 'URL追加';
  stylizeButton(btnAdd);

  const btnClear = document.createElement('button');
  btnClear.textContent = '全削除';
  stylizeButton(btnClear);

  bar.append(title, urlInput, btnAdd, btnClear);

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
  document.documentElement.appendChild(host);

  // -------- Fabric.js 初期化 --------
  /** @type {fabric.Canvas} */
  const canvas = new fabric.Canvas(elCanvas, {
    backgroundColor: CANVAS_BG,
    selection: true,
    preserveObjectStacking: true,
    controlsAboveOverlay: true,
    // 重要: ビューポート変形は使わない（= パン/ズーム無効）
    viewportTransform: [1, 0, 0, 1, 0, 0]
  });

  // Retina 対応
  canvas.enableRetinaScaling = true;

  // 重要: ホイールズームを完全無効化
  canvas.on('mouse:wheel', (opt) => {
    opt.e.preventDefault();
    opt.e.stopPropagation();
    // 何もしない（ズーム禁止）
  });

  // 重要: パン（ドラッグでのビューポート移動）を実装しない

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

      // 初期スケール: キャンバスに収まるように最大 90%
      fitImageInside(img, canvas.getWidth(), canvas.getHeight(), 0.9);

      // 初期配置: 中央
      img.set({
        left: (canvas.getWidth() - img.getScaledWidth()) / 2,
        top: (canvas.getHeight() - img.getScaledHeight()) / 2,
        selectable: true
      });

      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.requestRenderAll();
      scheduleSave();
      // 可能ならデータURL埋め込みを試行（CORS許可時）
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
      // Blobは同一オリジン扱いなのでDataURL変換は不要だが、保存一貫性のために埋め込み直す
      tryEmbedImageAsDataURL(img).then(() => scheduleSave());
      // revokeは少し遅らせる
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
        // 一時キャンバスで draw → toDataURL を試みる
        const t = document.createElement('canvas');
        t.width = el.naturalWidth || el.videoWidth || el.width || fimg.width || 1;
        t.height = el.naturalHeight || el.videoHeight || el.height || fimg.height || 1;
        const ctx = t.getContext('2d');
        ctx.drawImage(el, 0, 0);
        const dataUrl = t.toDataURL('image/png');
        // src を DataURL に置換（CORS対策）
        fimg.setSrc(dataUrl, () => {
          canvas.requestRenderAll();
          resolve(true);
        });
      } catch (e) {
        // セキュリティエラー等（CORS未許可）は埋め込みを諦める
        resolve(false);
      }
    });
  }

  // -------- ドラッグ & ドロップ --------
  // ファイル/URLの両方に対応
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
    // URLテキスト
    const uriList = dt.getData('text/uri-list');
    const plain = dt.getData('text/plain');
    const text = (uriList || plain || '').trim();
    if (isProbablyUrl(text)) addImageFromUrl(text);
  });

  function isProbablyUrl(s) {
    try { new URL(s); return true; } catch { return false; }
  }

  // -------- クリップボード貼り付け（画像/URL）--------
  window.addEventListener('paste', async (e) => {
    // 入力中（URL欄など）は無視
    const target = e.target;
    if (target && (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)) return;

    const cd = e.clipboardData;
    if (!cd) return;

    // 画像アイテム優先
    const items = Array.from(cd.items || []);
    for (const it of items) {
      if (it.kind === 'file' && it.type?.startsWith('image/')) {
        const blob = it.getAsFile();
        if (blob) { addImageFromBlob(blob); return; }
      }
    }
    // テキストURL
    const text = cd.getData('text')?.trim();
    if (text && isProbablyUrl(text)) addImageFromUrl(text);
  });

  // -------- キーボードショートカット --------
  window.addEventListener('keydown', (e) => {
    // 入力中は無効
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) return;

    // Delete / Backspace で選択削除
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
    // ズーム/パン系ショートカットは実装しない
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
    // 画像のDataURL化をできる範囲で確実に
    const imgs = canvas.getObjects('image');
    for (const img of imgs) {
      await tryEmbedImageAsDataURL(img).catch(() => {});
    }
    const json = canvas.toJSON(['selectable']); // 必要なら拡張プロパティを追加
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

  // -------- ユーティリティ: ボタン見た目 --------
  function stylizeButton(btn) {
    Object.assign(btn.style, {
      background: '#2e2e2e',
      color: '#eee',
      border: '1px solid #3a3a3a',
      borderRadius: '6px',
      padding: '6px 10px',
      cursor: 'pointer'
    });
    btn.addEventListener('mouseenter', () => btn.style.background = '#3a3a3a');
    btn.addEventListener('mouseleave', () => btn.style.background = '#2e2e2e');
    btn.addEventListener('focus', () => btn.style.outline = '2px solid #555');
    btn.addEventListener('blur', () => btn.style.outline = 'none');
  }
})();

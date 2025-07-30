// Pinterest Split + Fabric Board (localStorage, patched for RIGHT 30% board)
// 前提: fabric.min.js を content_scripts で先に読み込んでいる（Manifestのjs順序）
// 変更点（要旨）:
// - <canvas> の width/height を直接いじらず、Fabric の setDimensions に任せる
// - 外部URL画像は CORS が通る場合に DataURL へ埋め込み変換して再描画時の消失を抑制
// - zoomToFit は Group を生成せずに境界矩形を計算
// - Pinterest の fixed ヘッダーを右側ボード幅ぶん左に詰めるCSSを注入（ボードは右側 30%）
//
// レイアウト: Pinterest 70%（左） / ボード 30%（右）

(() => {
  const APP_ID = 'prx-root-purefab';
  if (document.getElementById(APP_ID)) return; // 多重起動防止

  // ---------- 基本設定 ----------
  const SPLIT_RATIO = 0.30; // ボード 30%（右側）
  const LS_KEY = 'prx.fabric.board.json.v1'; // localStorageキー
  const Z = 2147483600; // 高めのz-index
  const EMBED_MAX_BYTES = 3 * 1024 * 1024; // CORS成功時にDataURL化する上限 (3MB目安)

  // ---------- DOM 構築 ----------
  const host = document.createElement('div');
  host.id = APP_ID;
  host.style.position = 'fixed';
  host.style.inset = '0 0 0 auto'; // 右固定
  host.style.width = `${SPLIT_RATIO * 100}vw`;
  host.style.height = '100vh';
  host.style.zIndex = Z;
  host.style.pointerEvents = 'auto'; // ボード側は操作可
  host.style.display = 'block';
  document.documentElement.appendChild(host);

  // 左側(Pinterest)のレイアウトに右側のボード分の空きを作る
  document.documentElement.classList.add('prx-split-applied');
  const applyRightShift = () => {
    document.documentElement.style.setProperty('--prx-split-width', `${SPLIT_RATIO * 100}vw`);
    document.body.style.marginLeft = '0'; // 念のためリセット
    document.body.style.marginRight = `calc(var(--prx-split-width))`; // 右側に空き
  };
  applyRightShift();

  // ---- Pinterest固定ヘッダーを左に詰める全局CSSを注入（fixed要素はbodyのmarginの影響を受けないため）----
  (() => {
    const styleId = 'prx-split-global-css';
    if (document.getElementById(styleId)) return;
    const s = document.createElement('style');
    s.id = styleId;
    s.textContent = `
      html.prx-split-applied { /* --prx-split-width はJS側で設定済み */ }

      /* 代表的なヘッダー候補を右側ボード幅ぶん左に詰める */
      html.prx-split-applied [data-test-id="header"],
      html.prx-split-applied header[role="banner"],
      html.prx-split-applied header {
        position: fixed !important;
        left: 0 !important;
        right: var(--prx-split-width) !important;
        width: calc(100vw - var(--prx-split-width)) !important;
        max-width: none !important;
        box-sizing: border-box !important;
      }

      /* 保険: top:0 の fixed 要素（div/nav）も詰める */
      html.prx-split-applied div[style*="position: fixed"][style*="top: 0"],
      html.prx-split-applied nav[style*="position: fixed"][style*="top: 0"] {
        left: 0 !important;
        right: var(--prx-split-width) !important;
        width: calc(100vw - var(--prx-split-width)) !important;
        box-sizing: border-box !important;
      }
      
      /* Pinterest内のヘッダー内ラッパー調整（ユーザー報告で有効だったクラス） */
      html.prx-split-applied .Jea.KS5.i1W.ujU.xcv.L4E.zI7 { padding-left: 78px !important; }
    `;
    document.head.appendChild(s);
  })();

  // Shadow DOM でスタイル隔離
  const shadow = host.attachShadow({ mode: 'open' });

  const style = document.createElement('style');
  style.textContent = `
    :host, .wrap { all: initial; }
    .wrap { 
      font-family: system-ui, -apple-system, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans", "Liberation Sans", sans-serif;
      color: #eaeaea;
    }
    .pane {
      position: relative;
      width: 100%;
      height: 100vh;
      background: #1e1e1e;
      box-shadow: -2px 0 10px rgba(0,0,0,.4); /* 右ペインっぽく左側に影 */
      overflow: hidden;
      outline: none;
    }
    .toolbar {
      position: absolute;
      top: 8px; left: 8px; right: 8px;
      display: flex; gap: 6px; align-items: center;
      background: rgba(0,0,0,.45);
      padding: 6px 8px; border-radius: 8px;
      backdrop-filter: blur(2px);
      z-index: 10;
      font-size: 12px; line-height: 1;
    }
    .toolbar button, .toolbar input {
      all: revert;
      font-size: 12px; line-height: 1;
      padding: 6px 8px; border-radius: 6px; border: none;
    }
    .toolbar button { background: #2d2d2d; color: #eaeaea; cursor: pointer; }
    .toolbar button:hover { background: #3a3a3a; }
    .toolbar .spacer { flex: 1; }
    canvas { display:block; }
    .drop-hint {
      position:absolute; inset:0;
      display:flex; align-items:center; justify-content:center;
      color:#bbb; font-size:13px;
      border:2px dashed #333; border-radius:12px;
      margin: 48px 8px 8px; /* ツールバー分の余白 */
      pointer-events:none;
    }
  `;
  shadow.appendChild(style);

  const wrap = document.createElement('div');
  wrap.className = 'wrap';
  wrap.innerHTML = `
    <div class="pane" tabindex="0" aria-label="PureRef-like board (paste image with Ctrl+V)">
      <div class="toolbar">
        <button id="btnSave">保存</button>
        <button id="btnLoad">読込</button>
        <button id="btnClear">全消去</button>
        <div class="spacer"></div>
        <input id="imgUrl" type="text" placeholder="画像URLを貼り付け" style="min-width:220px;background:#1d1d1d;color:#eaeaea;border:1px solid #333"/>
        <button id="btnAddUrl">追加</button>
        <button id="btnExport">PNG書き出し</button>
      </div>
      <div class="drop-hint">ここに画像ファイル or 画像URLをドロップ（Ctrl+V でも貼り付け可）</div>
      <canvas id="board"></canvas>
    </div>
  `;
  shadow.appendChild(wrap);

  const canvasEl = shadow.getElementById('board');
  const hintEl = shadow.querySelector('.drop-hint');
  const btnSave = shadow.getElementById('btnSave');
  const btnLoad = shadow.getElementById('btnLoad');
  const btnClear = shadow.getElementById('btnClear');
  const btnAddUrl = shadow.getElementById('btnAddUrl');
  const btnExport = shadow.getElementById('btnExport');
  const imgUrlInput = shadow.getElementById('imgUrl');
  const pane = shadow.querySelector('.pane');

  // ---------- Fabric 初期化 ----------
  let canvas = null;
  try {
    canvas = new fabric.Canvas(canvasEl, {
      backgroundColor: '#1e1e1e',
      preserveObjectStacking: true,
      selection: true
    });
  } catch (e) {
    console.error('Fabric Canvas init error', e);
    return;
  }

  // サイズ適用（<canvas>の属性を直書きせず、Fabric に任せる）
  const ensureSize = (() => {
    let lastW = -1, lastH = -1;
    return () => {
      const rect = host.getBoundingClientRect();
      const w = Math.max(1, Math.floor(rect.width));
      const h = Math.max(1, Math.floor(rect.height));
      if (w === lastW && h === lastH) return;
      lastW = w; lastH = h;
      if (canvas) {
        canvas.setDimensions({ width: w, height: h }); // Fabric が適切に再描画
        canvas.calcOffset();
        canvas.requestRenderAll();
      }
    };
  })();

  const resizeObserver = new ResizeObserver(() => ensureSize());
  resizeObserver.observe(host);
  window.addEventListener('resize', ensureSize, { passive: true });
  ensureSize();

  // ---------- 画像追加ユーティリティ（CORS成功時はDataURLに埋め込み） ----------
  function addImageFromURL(url, opts = {}) {
    return new Promise((resolve, reject) => {
      const isData = /^data:/i.test(url);
      const imgOpts = isData ? opts : { crossOrigin: 'anonymous', ...opts };

      fabric.Image.fromURL(url, async (img) => {
        if (!img) return reject(new Error('Image load failed'));

        // 可能なら埋め込みに置き換え（CORSが通るURLのみ）
        if (!isData) {
          try {
            const res = await fetch(url, { mode: 'cors', credentials: 'omit', cache: 'force-cache' });
            if (res.ok) {
              const blob = await res.blob();
              if (blob.size <= EMBED_MAX_BYTES) {
                const dataUrl = await new Promise(r => {
                  const fr = new FileReader();
                  fr.onload = () => r(fr.result);
                  fr.readAsDataURL(blob);
                });
                await new Promise(r => img.setSrc(dataUrl, r)); // 埋め込みへ差し替え
              }
            }
          } catch (err) {
            // CORS不可の場合はそのままURL描画（エクスポートや将来再描画で失敗する可能性あり）
          }
        }

        // 初期サイズ調整（大きすぎる場合は収める）
        const maxW = canvas.getWidth() * 0.8;
        const maxH = canvas.getHeight() * 0.8;
        const scale = Math.min(1, maxW / img.width, maxH / img.height);
        img.set({
          left: (canvas.getWidth() - img.width * scale) / 2,
          top: (canvas.getHeight() - img.height * scale) / 2,
          selectable: true
        });
        img.scale(scale);

        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        resolve(img);
      }, imgOpts);
    });
  }

  function addImageFromFile(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => addImageFromURL(reader.result).then(resolve).catch(reject);
      reader.onerror = reject;
      reader.readAsDataURL(file); // DataURL化（localStorage保存にも都合が良い）
    });
  }

  // ---------- DnD ----------
  pane.addEventListener('dragover', (e) => {
    e.preventDefault();
    hintEl.style.borderColor = '#555';
    hintEl.style.color = '#ddd';
  });
  pane.addEventListener('dragleave', () => {
    hintEl.style.borderColor = '#333';
    hintEl.style.color = '#bbb';
  });
  pane.addEventListener('drop', async (e) => {
    e.preventDefault();
    hintEl.style.borderColor = '#333';
    hintEl.style.color = '#bbb';

    const dt = e.dataTransfer;
    if (!dt) return;

    const files = Array.from(dt.files || []);
    if (files.length) {
      for (const f of files) {
        if (f.type.startsWith('image/')) {
          await addImageFromFile(f).catch(console.warn);
        }
      }
      autoSaveSoon();
      return;
    }

    // URL/テキスト
    const url = dt.getData('text/uri-list') || dt.getData('text/plain');
    if (url && /^https?:\/\//i.test(url)) {
      await addImageFromURL(url).catch(console.warn);
      autoSaveSoon();
    }
  });

  // ---------- ズーム・パン ----------
  let isSpaceDown = false;
  window.addEventListener('keydown', (e) => {
    if (e.code === 'Space') { isSpaceDown = true; }
    // ショートカット
    if (e.code === 'Delete' || e.code === 'Backspace') {
      const obj = canvas.getActiveObject();
      if (obj) { canvas.remove(obj); autoSaveSoon(); }
    }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'd') {
      const obj = canvas.getActiveObject();
      if (obj) {
        obj.clone((cloned) => {
          cloned.set({ left: obj.left + 20, top: obj.top + 20 });
          canvas.add(cloned);
          canvas.setActiveObject(cloned);
          canvas.requestRenderAll();
          autoSaveSoon();
        });
      }
      e.preventDefault();
    }
    if (e.key === '0') {
      resetZoom();
    }
    if (e.key.toLowerCase() === 'f') {
      zoomToFit();
    }
  }, { passive: false });

  window.addEventListener('keyup', (e) => {
    if (e.code === 'Space') { isSpaceDown = false; }
  });

  canvas.on('mouse:wheel', function(opt) {
    const delta = opt.e.deltaY;
    let zoom = canvas.getZoom();
    const zoomFactor = 0.999 ** delta;
    zoom *= zoomFactor;
    zoom = Math.min(10, Math.max(0.1, zoom));
    const pointer = canvas.getPointer(opt.e);
    canvas.zoomToPoint({ x: pointer.x, y: pointer.y }, zoom);
    opt.e.preventDefault();
    opt.e.stopPropagation();
  });

  let lastPosX, lastPosY;
  canvas.on('mouse:down', function(opt) {
    if (isSpaceDown) {
      const e = opt.e;
      this.isDragging = true;
      this.selection = false;
      lastPosX = e.clientX;
      lastPosY = e.clientY;
    }
  });
  canvas.on('mouse:move', function(opt) {
    if (this.isDragging) {
      const e = opt.e;
      const vpt = this.viewportTransform;
      vpt[4] += e.clientX - lastPosX;
      vpt[5] += e.clientY - lastPosY;
      lastPosX = e.clientX;
      lastPosY = e.clientY;
      this.requestRenderAll();
    }
  });
  canvas.on('mouse:up', function() {
    this.setViewportTransform(this.viewportTransform);
    this.isDragging = false;
    this.selection = true;
  });

  function resetZoom() {
    canvas.setViewportTransform([1,0,0,1,0,0]);
    canvas.setZoom(1);
    canvas.requestRenderAll();
  }

  function getObjectsBoundingRect(objs) {
    if (!objs.length) return { left:0, top:0, width:0, height:0 };
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const o of objs) {
      const r = o.getBoundingRect(true, true); // absolute, calculate
      minX = Math.min(minX, r.left);
      minY = Math.min(minY, r.top);
      maxX = Math.max(maxX, r.left + r.width);
      maxY = Math.max(maxY, r.top + r.height);
    }
    return { left: minX, top: minY, width: maxX - minX, height: maxY - minY };
    // 注: 画像が clipPath 等を持つ場合は必要に応じて拡張
  }

  function zoomToFit() {
    const objs = canvas.getObjects().filter(o => o.visible);
    if (!objs.length) { resetZoom(); return; }

    const bounds = getObjectsBoundingRect(objs);
    const pad = 40;
    const w = Math.max(1, canvas.getWidth() - pad * 2);
    const h = Math.max(1, canvas.getHeight() - pad * 2);
    const scale = Math.min(w / bounds.width, h / bounds.height);
    const zoom = Math.max(0.1, Math.min(10, scale));
    canvas.setViewportTransform([
      zoom, 0, 0, zoom,
      -(bounds.left) * zoom + pad,
      -(bounds.top) * zoom + pad
    ]);
    canvas.requestRenderAll();
  }

  // ---------- 保存/読込(localStorage) ----------
  function saveToLocalStorage() {
    try {
      const json = canvas.toJSON();
      localStorage.setItem(LS_KEY, JSON.stringify(json));
      toast('保存しました');
    } catch (e) {
      console.warn('save error', e);
      toast('保存に失敗しました（容量超過の可能性）');
    }
  }

  function loadFromLocalStorage() {
    const raw = localStorage.getItem(LS_KEY);
    if (!raw) { toast('保存データがありません'); return; }
    try {
      const json = JSON.parse(raw);
      canvas.clear();
      canvas.loadFromJSON(json, () => {
        canvas.requestRenderAll();
        toast('読込完了');
      });
    } catch (e) {
      console.warn('load error', e);
      toast('読込に失敗しました');
    }
  }

  let saveTimer = null;
  function autoSaveSoon() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveToLocalStorage, 1200);
  }
  canvas.on('object:added', autoSaveSoon);
  canvas.on('object:modified', autoSaveSoon);
  canvas.on('object:removed', autoSaveSoon);

  // ---------- PNG エクスポート ----------
  function exportPNG() {
    try {
      const url = canvas.toDataURL({ format: 'png', enableRetinaScaling: true });
      const a = document.createElement('a');
      a.href = url;
      a.download = 'board.png';
      a.click();
    } catch (e) {
      console.warn('export error', e);
      toast('PNG書き出しに失敗（CORS未許可画像が混在の可能性）');
    }
  }

  // ---------- UI ハンドラ ----------
  btnSave.addEventListener('click', saveToLocalStorage);
  btnLoad.addEventListener('click', loadFromLocalStorage);
  btnClear.addEventListener('click', () => { canvas.clear(); autoSaveSoon(); });
  btnAddUrl.addEventListener('click', async () => {
    const url = (imgUrlInput.value || '').trim();
    if (!url) return;
    await addImageFromURL(url).catch(() => toast('画像の追加に失敗'));
    imgUrlInput.value = '';
    autoSaveSoon();
  });
  btnExport.addEventListener('click', exportPNG);

  // EnterでURL追加
  imgUrlInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      btnAddUrl.click();
    }
  });

  // ---------- Ctrl+V 貼り付け対応 ----------
  let paneHasFocus = false;
  pane.addEventListener('mousedown', () => { paneHasFocus = true; });
  pane.addEventListener('focus', () => { paneHasFocus = true; });
  pane.addEventListener('blur', () => { paneHasFocus = false; });
  pane.addEventListener('mouseleave', () => { /* クリックでのフォーカス維持のため離脱では消さない */ });

  function isLikelyImageURL(s) {
    return /^data:image\//i.test(s)
        || /\.(png|jpe?g|webp|gif|bmp|svg)(\?.*)?$/i.test(s)
        || /^https?:\/\//i.test(s); // 拡張子なしの画像CDNも許容
  }

  async function handlePaste(e) {
    // 右ペインにフォーカスが無い場合は何もしない（Pinterest側入力を邪魔しない）
    const path = (e.composedPath && e.composedPath()) || [];
    const inPane = path.includes(pane) || path.includes(host);
    if (!(paneHasFocus || inPane)) return;

    const cd = e.clipboardData;
    if (!cd) return;

    let added = 0;

    // 1) Fileとしての画像
    const files = Array.from(cd.files || []);
    for (const f of files) {
      if (f.type && f.type.startsWith('image/')) {
        try { await addImageFromFile(f); added++; } catch (err) { console.warn(err); }
      }
    }

    // 2) items経由（ブラウザ差異対策）
    if (!added && cd.items) {
      for (const it of cd.items) {
        if (it.type && it.type.startsWith('image/')) {
          const f = it.getAsFile();
          if (f) {
            try { await addImageFromFile(f); added++; } catch (err) { console.warn(err); }
          }
        }
      }
    }

    // 3) text/html 内の <img src> / CSS url()
    if (!added) {
      const html = cd.getData('text/html');
      if (html) {
        try {
          const doc = new DOMParser().parseFromString(html, 'text/html');
          let src = '';
          const img = doc.querySelector('img');
          if (img && img.src) src = img.src;
          if (!src) {
            const m = html.match(/url\(\s*['"]?(.*?)['"]?\s*\)/i);
            if (m && m[1]) src = m[1];
          }
          if (src && isLikelyImageURL(src)) {
            try { await addImageFromURL(src); added++; } catch (err) { console.warn(err); }
          }
        } catch (err) { /* ignore */ }
      }
    }

    // 4) text/plain（URL / Data URL）
    if (!added) {
      const text = (cd.getData('text/plain') || '').trim();
      if (text && isLikelyImageURL(text)) {
        try { await addImageFromURL(text); added++; } catch (err) { console.warn(err); }
      }
    }

    if (added) {
      autoSaveSoon();
      toast(`${added}件貼り付け`);
      e.preventDefault(); // 画像を追加できた場合のみ既定動作を抑止
    }
  }

  // キャプチャ段階で受ける（Pinterest側が先に処理しないように）
  window.addEventListener('paste', handlePaste, true);

  // ---------- トースト ----------
  let toastTimer = null;
  function toast(msg) {
    let el = shadow.getElementById('prx-toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'prx-toast';
      el.style.position = 'absolute';
      el.style.top = '52px';
      el.style.right = '12px';
      el.style.background = 'rgba(0,0,0,.6)';
      el.style.padding = '8px 10px';
      el.style.borderRadius = '8px';
      el.style.fontSize = '12px';
      el.style.pointerEvents = 'none';
      shadow.querySelector('.pane').appendChild(el);
    }
    el.textContent = msg;
    el.style.opacity = '1';
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { el.style.opacity = '0'; }, 1600);
  }

  // 初回自動読込
  loadFromLocalStorage();

  // クリーンアップ（必要なら）
  window.addEventListener('beforeunload', () => {
    resizeObserver.disconnect();
  });
})();

// Pinterest Split + Fabric Board (localStorage)
// 前提: fabric.min.js を content_scripts で先に読み込んでいる（Manifestのjs順序）

(() => {
  const APP_ID = 'prx-root-purefab';
  if (document.getElementById(APP_ID)) return; // 多重起動防止

  // ---------- 基本設定 ----------
  const SPLIT_RATIO = 0.30; // 左30% / 右70%
  const LS_KEY = 'prx.fabric.board.json.v1'; // localStorageキー
  const Z = 2147483600; // 高めのz-index

  // ---------- DOM 構築 ----------
  const host = document.createElement('div');
  host.id = APP_ID;
  host.style.position = 'fixed';
  host.style.inset = '0 auto 0 0';
  host.style.width = `${SPLIT_RATIO * 100}vw`;
  host.style.height = '100vh';
  host.style.zIndex = Z;
  host.style.pointerEvents = 'auto'; // 左側は操作可
  host.style.display = 'block';
  document.documentElement.appendChild(host);

  // 右側(Pinterest)のレイアウトを左にスペース分だけ押し出す
  document.documentElement.classList.add('prx-split-applied');
  const applyRightShift = () => {
    // body マージン方式（Pinterest本体のレイアウト崩れを最小化）
    document.documentElement.style.setProperty('--prx-split-width', `${SPLIT_RATIO * 100}vw`);
    document.body.style.marginLeft = `calc(var(--prx-split-width))`;
  };
  applyRightShift();

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
      box-shadow: 2px 0 10px rgba(0,0,0,.4);
      overflow: hidden;
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
    .help {
      position: absolute; bottom: 8px; left: 8px;
      background: rgba(0,0,0,.45);
      padding: 6px 8px; border-radius: 8px;
      font-size: 12px; line-height: 1.4;
      white-space: pre-line;
      pointer-events: none;
    }
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
    <div class="pane">
      <div class="toolbar">
        <button id="btnSave">保存</button>
        <button id="btnLoad">読込</button>
        <button id="btnClear">全消去</button>
        <div class="spacer"></div>
        <input id="imgUrl" type="text" placeholder="画像URLを貼り付け" style="min-width:220px;background:#1d1d1d;color:#eaeaea;border:1px solid #333"/>
        <button id="btnAddUrl">追加</button>
        <button id="btnExport">PNG書き出し</button>
      </div>
      <div class="drop-hint">ここに画像ファイル or 画像URLをドロップ</div>
      <canvas id="board"></canvas>
      <div class="help">
        操作: マウスホイール=拡大縮小 / Space+ドラッグ=パン / クリックで選択<br/>
        ショートカット: Delete=削除, Ctrl+D=複製, 0=ズームリセット, F=全体表示<br/>
        保存は自動でも行われます（数秒おき, localStorage）。
      </div>
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

  // ---------- Fabric 初期化 ----------
  const ensureSize = () => {
    const rect = host.getBoundingClientRect();
    const dpr = Math.max(1, window.devicePixelRatio || 1);
    canvasEl.width = rect.width * dpr;
    canvasEl.height = rect.height * dpr;
    canvasEl.style.width = rect.width + 'px';
    canvasEl.style.height = rect.height + 'px';
    if (canvas) {
      canvas.setWidth(rect.width);
      canvas.setHeight(rect.height);
      canvas.setDimensions({ width: rect.width, height: rect.height });
      canvas.requestRenderAll();
    }
  };

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

  // Retina スケール
  const applyRetina = () => {
    const ratio = window.devicePixelRatio || 1;
    const ctx = canvas.getContext();
    if (ratio !== 1) {
      ctx.setTransform(1,0,0,1,0,0);
      canvas.setZoom(1);
    }
  };

  // リサイズ対応
  const resizeObserver = new ResizeObserver(() => ensureSize());
  resizeObserver.observe(host);
  window.addEventListener('resize', ensureSize, { passive: true });
  ensureSize();
  applyRetina();

  // ---------- 画像追加ユーティリティ ----------
  function addImageFromURL(url, opts = {}) {
    return new Promise((resolve, reject) => {
      // クロスオリジン許可があるサーバーならエクスポート可
      const imgOpts = { crossOrigin: 'anonymous', ...opts };
      fabric.Image.fromURL(url, (img) => {
        if (!img) return reject(new Error('Image load failed'));
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
  const pane = shadow.querySelector('.pane');
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

  function zoomToFit() {
    const objs = canvas.getObjects();
    if (!objs.length) { resetZoom(); return; }
    const group = new fabric.Group(objs.map(o => o), { selectable: false });
    const bounds = group.getBoundingRect();
    group.destroy();

    const pad = 40;
    const w = canvas.getWidth() - pad * 2;
    const h = canvas.getHeight() - pad * 2;
    const scale = Math.min(w / bounds.width, h / bounds.height);
    const zoom = Math.max(0.1, Math.min(10, scale));
    canvas.setViewportTransform([zoom,0,0,zoom,
      -(bounds.left)*zoom + pad, -(bounds.top)*zoom + pad
    ]);
    canvas.requestRenderAll();
  }

  // ---------- 保存/読込(localStorage) ----------
  function saveToLocalStorage() {
    try {
      const json = canvas.toJSON();
      // DataURL画像はそのままJSONに含まれる。リモートURLはsrcだけが保存され再取得されます。
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
      const url = canvas.toDataURL({
        format: 'png',
        enableRetinaScaling: true
      });
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

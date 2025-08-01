// Pinterest Split + Fabric Board
// (localStorage, no pan, no zoom, RIGHT board, toolbar removed, max 8 images, centered scaling)
// 前提: fabric.min.js を manifest の content_scripts で本ファイルより先に読み込み済み

(() => {
  'use strict';

  const APP_ID   = 'prx-root-purefab';
  const STYLE_ID = APP_ID + '-style';

  // ----- 既存ノードのクリーンアップ -----
  try {
    const oldHost  = document.getElementById(APP_ID);
    if (oldHost && oldHost.parentNode) oldHost.parentNode.removeChild(oldHost);
    const oldStyle = document.getElementById(STYLE_ID);
    if (oldStyle && oldStyle.parentNode) oldStyle.parentNode.removeChild(oldStyle);
  } catch {}

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
  const LS_KEY      = 'prx.fabric.board.json.v1'; // Canvas JSON 保存
  const Z           = 2147483600;
  const BG          = '#1c1c1c';
  const CANVAS_BG   = '#2a2a2a';
  const MAX_IMAGES  = 8;  // 画像枚数の上限

  // -------- スタイル注入（Pinterest 側を 70%、右に 30% のボード） --------
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html { overflow-x: hidden !important; }
    body { margin-right: ${SPLIT_RATIO * 100}vw !important; }
    [role="main"], #__PWS_ROOT__, #__PWS_ROOT__ > div { max-width: 100% !important; }
    .jzS.un8.C9i.TB_ { width: 68% !important; }
  `;
  (document.head || document.documentElement).appendChild(style);

  // -------- 右ペイン（ボード）DOM 構築 --------
  const host = document.createElement('div');
  host.id = APP_ID;
  Object.assign(host.style, {
    position: 'fixed',
    inset: '0 0 0 auto',
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

  // キャンバスラッパ
  const wrap = document.createElement('div');
  Object.assign(wrap.style, {
    position: 'relative',
    flex: '1',
    minHeight: '0',
    display: 'block'
  });

  // 右下トースト（簡易通知）
  const toast = (() => {
    let tm, el;
    return (msg, ms = 1400) => {
      if (!el) {
        el = document.createElement('div');
        Object.assign(el.style, {
          position: 'absolute',
          right: '12px',
          bottom: '12px',
          background: 'rgba(0,0,0,0.85)',
          color: '#fff',
          padding: '8px 12px',
          borderRadius: '8px',
          font: '12px/1.4 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
          pointerEvents: 'none',
          opacity: '0',
          transition: 'opacity 200ms',
          zIndex: Z + 1
        });
        wrap.appendChild(el);
      }
      el.textContent = msg;
      el.style.opacity = '1';
      clearTimeout(tm);
      tm = setTimeout(() => { el.style.opacity = '0'; }, ms);
    };
  })();

  // <canvas>
  const elCanvas = document.createElement('canvas');
  elCanvas.id = APP_ID + '-canvas';
  Object.assign(elCanvas.style, { display: 'block' });
  wrap.appendChild(elCanvas);

  host.append(wrap);
  (document.body || document.documentElement).appendChild(host);

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

  // 常に中心基準でスケールさせる & 既定原点を center に統一
  fabric.Object.prototype.centeredScaling = true;
  fabric.Object.prototype.originX = 'center';
  fabric.Object.prototype.originY = 'center';

  // ホイールズーム完全無効化
  canvas.on('mouse:wheel', (opt) => {
    opt.e.preventDefault();
    opt.e.stopPropagation();
  });

  // キャンバスのリサイズ
  const resize = () => {
    const rect = wrap.getBoundingClientRect();
    canvas.setDimensions({ width: rect.width, height: rect.height }, { backstoreOnly: false });
    canvas.requestRenderAll();
  };
  new ResizeObserver(resize).observe(wrap);
  resize();

  // === 画像上限制御 ===
  const getImageCount = () => canvas.getObjects('image').length;

  function ensureCanAdd(need = 1) {
    const left = MAX_IMAGES - getImageCount();
    if (left < need) {
      toast(`画像は最大 ${MAX_IMAGES} 枚までです`);
      return false;
    }
    return true;
  }

  function enforceImageLimitAfterLoad() {
    const imgs = canvas.getObjects('image');
    if (imgs.length <= MAX_IMAGES) return;
    const excess = imgs.length - MAX_IMAGES;
    for (let i = 0; i < excess; i++) {
      const list = canvas.getObjects('image'); // 先に追加されたものから削除
      if (list[i]) canvas.remove(list[i]);
    }
    canvas.requestRenderAll();
    scheduleSave();
    toast(`画像は最大 ${MAX_IMAGES} 枚までに制限しました`);
  }

  // -------- 画像追加ユーティリティ --------
  function addImageFromUrl(url) {
    if (!url) return;
    if (!ensureCanAdd(1)) return;
    const clean = url.trim();
    fabric.Image.fromURL(clean, (img) => {
      if (!img) return;
      if (!ensureCanAdd(1)) return;
      img.set({ crossOrigin: 'anonymous' });

      fitImageInside(img, canvas.getWidth(), canvas.getHeight(), 0.9);

      img.set({
        originX: 'center',
        originY: 'center',
        left: canvas.getWidth() / 2,
        top: canvas.getHeight() / 2,
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
    if (!ensureCanAdd(1)) return;
    const reader = new FileReader();
    reader.onload = () => addImageFromUrl(reader.result);
    reader.readAsDataURL(file);
  }

  function addImageFromBlob(blob) {
    if (!blob || !blob.type?.startsWith('image/')) return;
    if (!ensureCanAdd(1)) return;
    const url = URL.createObjectURL(blob);
    fabric.Image.fromURL(url, (img) => {
      if (!img) { URL.revokeObjectURL(url); return; }
      if (!ensureCanAdd(1)) { URL.revokeObjectURL(url); return; }

      fitImageInside(img, canvas.getWidth(), canvas.getHeight(), 0.9);
      img.set({
        originX: 'center',
        originY: 'center',
        left: canvas.getWidth() / 2,
        top: canvas.getHeight() / 2,
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
        t.width  = el.naturalWidth  || el.videoWidth  || el.width  || fimg.width  || 1;
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
      let capacity = MAX_IMAGES - getImageCount();
      if (capacity <= 0) { toast(`画像は最大 ${MAX_IMAGES} 枚までです`); return; }
      const files = Array.from(dt.files).slice(0, capacity);
      for (const f of files) addImageFromFile(f);
      return;
    }

    const uriList = dt.getData('text/uri-list');
    const plain   = dt.getData('text/plain');
    const text    = (uriList || plain || '').trim();
    if (text && isProbablyUrl(text)) {
      if (!ensureCanAdd(1)) return;
      addImageFromUrl(text);
    }
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

    const items = Array.from(cd.items || []).filter(it => it.kind === 'file' && it.type?.startsWith('image/'));
    if (items.length) {
      let capacity = MAX_IMAGES - getImageCount();
      if (capacity <= 0) { toast(`画像は最大 ${MAX_IMAGES} 枚までです`); return; }
      for (const it of items.slice(0, capacity)) {
        const blob = it.getAsFile();
        if (blob) addImageFromBlob(blob);
      }
      return;
    }

    const text = cd.getData('text')?.trim();
    if (text && isProbablyUrl(text)) {
      if (!ensureCanAdd(1)) return;
      addImageFromUrl(text);
    }
  });

  // ====== 画像コピー（Ctrl/⌘+C）追加 ======
  async function copyActiveImageToClipboard() {
    const sel = canvas.getActiveObjects() || [];
    if (sel.length !== 1) return false;                 // 複数やゼロは不可
    const obj = sel[0];
    if (obj?.type !== 'image') return false;            // 画像以外は対象外

    // オブジェクトをクローンして専用 StaticCanvas に描画し、そのPNGをクリップボードへ
    return new Promise((resolve, reject) => {
      obj.clone((cloned) => {
        try {
          // 高解像度化したい場合は multiplier を上げる（2 程度が無難）
          const multiplier = 2;

          // クローンの外接矩形を取得（トランスフォーム込み）
          const bbox = cloned.getBoundingRect(true, true);
          const w = Math.max(1, Math.round(bbox.width  * multiplier));
          const h = Math.max(1, Math.round(bbox.height * multiplier));

          // 描画用 StaticCanvas
          const sc = new fabric.StaticCanvas(null, { width: w, height: h });

          // 中央配置 & スケールを反映。倍率分スケーリング。
          cloned.set({
            originX: 'center',
            originY: 'center',
            left: w / 2,
            top:  h / 2,
            selectable: false
          });
          cloned.scaleX = (cloned.scaleX || 1) * multiplier;
          cloned.scaleY = (cloned.scaleY || 1) * multiplier;

          sc.add(cloned);
          sc.renderAll();

          // PNG へ変換して Async Clipboard API で書き込み
          sc.lowerCanvasEl.toBlob(async (blob) => {
            try {
              if (!blob) throw new Error('blob is null');
              await navigator.clipboard.write([ new ClipboardItem({ 'image/png': blob }) ]);
              resolve(true);
            } catch (err) {
              reject(err);
            } finally {
              sc.dispose();
            }
          }, 'image/png');
        } catch (e) {
          reject(e);
        }
      });
    });
  }

  // -------- キーボードショートカット（Delete/Backspace/Copy） --------
  window.addEventListener('keydown', async (e) => {
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) return;

    // Delete / Backspace = 削除
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = canvas.getActiveObjects();
      if (active && active.length) {
        active.forEach(obj => canvas.remove(obj));
        canvas.discardActiveObject();
        canvas.requestRenderAll();
        scheduleSave();
        e.preventDefault();
      }
      return;
    }

    // Ctrl/⌘ + C = 画像コピー（単一選択のみ）
    if ((e.ctrlKey || e.metaKey) && (e.key === 'c' || e.key === 'C')) {
      const sel = canvas.getActiveObjects() || [];
      if (sel.length > 1) {
        // 複数選択時はコピーさせない
        e.preventDefault();
        toast('複数選択中はコピーできません（1枚だけ選択してください）');
        return;
      }
      if (sel.length === 1 && sel[0]?.type === 'image') {
        e.preventDefault();
        try {
          await copyActiveImageToClipboard();
          toast('画像をクリップボードへコピーしました');
        } catch (err) {
          console.warn('clipboard write failed:', err);
          toast('コピーに失敗しました（ブラウザ設定や権限を確認してください）', 2000);
        }
      }
      // 0件や画像以外は既定挙動（Pinterest側のコピー等）に任せる
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
    const json = canvas.toJSON(['selectable', 'originX', 'originY', 'centeredScaling']);
    localStorage.setItem(LS_KEY, JSON.stringify({ v: 1, json }));
  }

  function loadFromLocalStorage() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (!parsed?.json) return;

      canvas.loadFromJSON(parsed.json, () => {
        const imgs = canvas.getObjects('image');
        for (const img of imgs) {
          if (img.originX !== 'center' || img.originY !== 'center') {
            const cx = img.left + img.getScaledWidth() / 2;
            const cy = img.top  + img.getScaledHeight() / 2;
            img.set({ originX: 'center', originY: 'center', left: cx, top: cy });
          }
          img.centeredScaling = true;
          img.setCoords();
        }

        canvas.renderAll();
        enforceImageLimitAfterLoad();
        scheduleSave();
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

  // -------- 補助（UI要素は削除済み）--------
})();

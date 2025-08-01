これを適用して
```
Ctrl+Zで戻せるのは直近２０回にして

以下が、このコードにCtrl+Zで戻せると便利な操作です（いまの実装/使用状況に即して厳選）。
※Fabricの標準操作（ドラッグ移動・ハンドルでの拡大縮小・回転）は発生します。コピー（クリップボードへ）は状態を変えないので通常はUndo対象外です。

1) 最優先で入れたい（体感の恩恵が大きい）
画像の追加（D&D／URL／貼り付け／ファイル）

戻す内容: 直前に追加した画像を削除。

補足: 複数枚を一度に追加したときはひと塊の1ステップとして扱うと直感的。enforceImageLimitAfterLoadで自動削除が起きた場合も同じ束で戻せると親切。

画像の削除（Delete/Backspace）

戻す内容: 削除した画像を元の座標・拡大率・回転・Z順で復活。

変形系の編集（移動／拡大縮小／回転）

戻す内容: 直前のleft/top/scaleX/scaleY/angleなどを復元。

補足: 複数選択の一括変形はひと塊で戻す。

2) 可能なら対応したい（整合性・見た目の安定に効く）
Zオーダーの変化（追加で最前面になる／将来的にbringToFront等を入れる場合）

戻す内容: 変更前のスタッキング順に戻す。

自動上限制御による強制削除（MAX_IMAGES超過時）

戻す内容: 自動で消えた古い画像群をまとめて復活。

補足: 「ドロップで9枚→上限で1枚自動削除」も一回の操作としてUndo可能に。
```

```content.js
// Pinterest Split + Fabric Board
// (IndexedDB persists: images as Blob, board JSON in 'boards'; no pan, no zoom, RIGHT board, toolbar removed, max 8 images, centered scaling)
// 前提: fabric.min.js を manifest の content_scripts で本ファイルより先に読み込み済み

(() => {
  'use strict';

  const APP_ID   = 'prx-root-purefab';
  const STYLE_ID = APP_ID + '-style';

  // ==== 二重起動ガード ====
  if (window.__PRX_PUREFAB_ACTIVE__) {
    console.debug('[PureFab] already active, skip init.');
    return;
  }
  window.__PRX_PUREFAB_ACTIVE__ = true;

  // ---- 外部エラーフック（発生源の特定補助）----
  (function setupErrorTaps() {
    const tag = '%c[PureFab/ErrorTap]';
    const sty = 'color:#0bf';
    window.addEventListener('error', (e) => {
      const msg = String(e.message || '');
      if (msg.includes('alphabetical') || msg.includes('uiState')) {
        console.group(tag, sty);
        console.log('message :', msg);
        console.log('source  :', e.filename, 'line:', e.lineno, 'col:', e.colno);
        if (e.error && e.error.stack) console.log('stack   :\n' + e.error.stack);
        console.groupEnd();
      }
    });
    window.addEventListener('unhandledrejection', (e) => {
      const reason = e.reason;
      const msg = String((reason && (reason.message || reason)) || '');
      if (msg.includes('alphabetical') || msg.includes('uiState')) {
        console.group(tag, sty);
        console.log('message :', msg);
        if (reason && reason.stack) console.log('stack   :\n' + reason.stack);
        console.groupEnd();
      }
    });
  })();

  // ----- 既存ノードのクリーンアップ -----
  try {
    const oldHost  = document.getElementById(APP_ID);
    if (oldHost && oldHost.parentNode) oldHost.parentNode.removeChild(oldHost);
    const oldStyle = document.getElementById(STYLE_ID);
    if (oldStyle && oldStyle.parentNode) oldStyle.parentNode.removeChild(oldStyle);
  } catch {}

  // 離脱時にも片付け＋フラグ解除
  const __pf_cleanup__ = () => {
    try {
      const n1 = document.getElementById(APP_ID);
      if (n1 && n1.parentNode) n1.parentNode.removeChild(n1);
      const n2 = document.getElementById(STYLE_ID);
      if (n2 && n2.parentNode) n2.parentNode.removeChild(n2);
    } catch {}
    try { delete window.__PRX_PUREFAB_ACTIVE__; } catch {}
  };
  window.addEventListener('pagehide', __pf_cleanup__, { once: true });
  window.addEventListener('unload',   __pf_cleanup__, { once: true });

  // -------- 基本設定 --------
  const SPLIT_RATIO = 0.30;                  // 右 30%（ボード）/ 左 70%（Pinterest）
  const Z           = 2147483600;
  const BG          = '#1c1c1c';
  const CANVAS_BG   = '#2a2a2a';
  const MAX_IMAGES  = 8;

  // ==== IndexedDB ラッパ ====
  const DB_NAME = 'prx_purefab_db';
  const DB_VER  = 1;
  let   __db;

  function idbOpen() {
    if (__db) return Promise.resolve(__db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VER);
      req.onupgradeneeded = (ev) => {
        const db = ev.target.result;
        if (!db.objectStoreNames.contains('images')) {
          db.createObjectStore('images', { keyPath: 'id' }); // {id, blob, type, created}
        }
        if (!db.objectStoreNames.contains('boards')) {
          db.createObjectStore('boards', { keyPath: 'id' }); // {id, json, updated}
        }
      };
      req.onsuccess = () => { __db = req.result; resolve(__db); };
      req.onerror   = () => reject(req.error);
    });
  }

  async function idbPut(store, value) {
    const db  = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => reject(tx.error);
      tx.objectStore(store).put(value);
    });
  }

  async function idbGet(store, key) {
    const db  = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readonly');
      tx.onerror = () => reject(tx.error);
      const req = tx.objectStore(store).get(key);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror   = () => reject(req.error);
    });
  }

  async function idbDelete(store, key) {
    const db  = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readwrite');
      tx.oncomplete = () => resolve(true);
      tx.onerror    = () => reject(tx.error);
      tx.objectStore(store).delete(key);
    });
  }

  async function saveBoardJSON(json) {
    const data = { id: 'main', json, updated: Date.now() };
    await idbPut('boards', data);
  }

  async function loadBoardJSON() {
    const row = await idbGet('boards', 'main');
    return row ? row.json : null;
  }

  async function saveImageBlob(blob) {
    const id = (crypto?.randomUUID && crypto.randomUUID()) || ('img-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    await idbPut('images', { id, blob, type: blob.type || 'application/octet-stream', created: Date.now() });
    return id;
  }

  async function getImageBlob(id) {
    const row = await idbGet('images', id);
    return row ? row.blob : null;
  }

  // -------- スタイル注入 --------
  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    html { overflow-x: hidden !important; }
    body { margin-right: ${SPLIT_RATIO * 100}vw !important; }
    [role="main"], #__PWS_ROOT__, #__PWS_ROOT__ > div { max-width: 100% !important; }
    .jzS.un8.C9i.TB_ { width: 68% !important; }
  `;
  (document.head || document.documentElement).appendChild(style);

  // -------- 右ペイン（ボード）DOM --------
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

  const wrap = document.createElement('div');
  Object.assign(wrap.style, { position: 'relative', flex: '1', minHeight: '0', display: 'block' });

  // 右下トースト
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
    if (left < need) { toast(`画像は最大 ${MAX_IMAGES} 枚までです`); return false; }
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

  // -------- 画像追加ユーティリティ（IndexedDB保存対応） --------
  const CUSTOM_PROPS = ['selectable','originX','originY','centeredScaling','prxBlobKey','prxSrcUrl'];

  function fitImageInside(img, cw, ch, maxRatio = 1.0) {
    const w = img.width || 1;
    const h = img.height || 1;
    const scale = Math.min((cw * maxRatio) / w, (ch * maxRatio) / h, 1);
    img.scale(scale);
  }

  function objURLFromBlob(blob) {
    try { return URL.createObjectURL(blob); } catch { return null; }
  }

  async function addImageFromUrl(url) {
    if (!url) return;
    if (!ensureCanAdd(1)) return;
    const clean = url.trim();

    // 1) まず fetch して Blob を取得（CORS 許可があれば成功）
    let blob = null;
    try {
      const res = await fetch(clean, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('fetch not ok');
      blob = await res.blob();
    } catch {
      // fetch 失敗時は Blob なしで URL 表示にフォールバック（後で保存時もURL参照）
      blob = null;
    }

    if (blob) {
      const key = await saveImageBlob(blob);
      const urlObj = objURLFromBlob(blob);
      fabric.Image.fromURL(urlObj, (img) => {
        if (!img) { if (urlObj) setTimeout(() => URL.revokeObjectURL(urlObj), 2000); return; }
        img.set({ crossOrigin: 'anonymous' });
        fitImageInside(img, canvas.getWidth(), canvas.getHeight(), 0.9);
        img.set({
          originX: 'center',
          originY: 'center',
          left: canvas.getWidth() / 2,
          top: canvas.getHeight() / 2,
          selectable: true,
          prxBlobKey: key,
          prxSrcUrl: null
        });
        canvas.add(img);
        canvas.setActiveObject(img);
        canvas.requestRenderAll();
        scheduleSave();
        setTimeout(() => { try { URL.revokeObjectURL(urlObj); } catch {} }, 2000);
      }, { crossOrigin: 'anonymous' });
      return;
    }

    // Blob 取得不可: URL 直接読み込み
    fabric.Image.fromURL(clean, (img) => {
      if (!img) return;
      img.set({ crossOrigin: 'anonymous' });
      fitImageInside(img, canvas.getWidth(), canvas.getHeight(), 0.9);
      img.set({
        originX: 'center',
        originY: 'center',
        left: canvas.getWidth() / 2,
        top: canvas.getHeight() / 2,
        selectable: true,
        prxBlobKey: null,
        prxSrcUrl: clean
      });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.requestRenderAll();
      scheduleSave();
    }, { crossOrigin: 'anonymous' });
  }

  function addImageFromFile(file) {
    if (!file || !file.type?.startsWith('image/')) return;
    if (!ensureCanAdd(1)) return;
    addImageFromBlob(file);
  }

  async function addImageFromBlob(blob) {
    if (!blob || !blob.type?.startsWith('image/')) return;
    if (!ensureCanAdd(1)) return;

    const key = await saveImageBlob(blob);
    const url = objURLFromBlob(blob);
    fabric.Image.fromURL(url, (img) => {
      if (!img) { if (url) setTimeout(() => URL.revokeObjectURL(url), 2000); return; }
      fitImageInside(img, canvas.getWidth(), canvas.getHeight(), 0.9);
      img.set({
        originX: 'center',
        originY: 'center',
        left: canvas.getWidth() / 2,
        top: canvas.getHeight() / 2,
        selectable: true,
        prxBlobKey: key,
        prxSrcUrl: null
      });
      canvas.add(img);
      canvas.setActiveObject(img);
      canvas.requestRenderAll();
      scheduleSave();
      setTimeout(() => { try { URL.revokeObjectURL(url); } catch {} }, 2000);
    }, { crossOrigin: 'anonymous' });
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

  // ====== 画像コピー（Ctrl/⌘+C） ======
  async function copyActiveImageToClipboard() {
    const sel = canvas.getActiveObjects() || [];
    if (sel.length !== 1) return false;
    const obj = sel[0];
    if (obj?.type !== 'image') return false;

    return new Promise((resolve, reject) => {
      obj.clone((cloned) => {
        try {
          const multiplier = 2;
          const bbox = cloned.getBoundingRect(true, true);
          const w = Math.max(1, Math.round(bbox.width  * multiplier));
          const h = Math.max(1, Math.round(bbox.height * multiplier));
          const sc = new fabric.StaticCanvas(null, { width: w, height: h });

          cloned.set({ originX: 'center', originY: 'center', left: w / 2, top:  h / 2, selectable: false });
          cloned.scaleX = (cloned.scaleX || 1) * multiplier;
          cloned.scaleY = (cloned.scaleY || 1) * multiplier;

          sc.add(cloned);
          sc.renderAll();

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
        } catch (e) { reject(e); }
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
    }
  });

  // -------- 永続化（IndexedDB）--------
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 400);
  }

  async function saveNow() {
    try {
      const json = canvas.toJSON(CUSTOM_PROPS);
      await saveBoardJSON({ v: 2, json }); // v2: IndexedDB 版
    } catch (e) {
      console.warn('save board failed:', e);
      toast('保存に失敗しました', 1200);
    }
  }

  async function loadBoard() {
    const saved = await loadBoardJSON();
    if (!saved?.json) return;

    // JSON をロード。画像の prxBlobKey/prxSrcUrl を見て src を復元
    const reviveQueue = [];
    canvas.loadFromJSON(saved.json, () => {
      const imgs = canvas.getObjects('image');
      for (const img of imgs) {
        // center 原点/centeredScaling の整合
        if (img.originX !== 'center' || img.originY !== 'center') {
          const cx = img.left + img.getScaledWidth() / 2;
          const cy = img.top  + img.getScaledHeight() / 2;
          img.set({ originX: 'center', originY: 'center', left: cx, top: cy });
        }
        img.centeredScaling = true;
        img.setCoords();

        const key = img.prxBlobKey || null;
        const url = img.prxSrcUrl  || null;

        if (key) {
          // 非同期で Blob を取得して objectURL に差し替え
          reviveQueue.push(
              (async () => {
                try {
                  const blob = await getImageBlob(key);
                  if (blob) {
                    const objUrl = objURLFromBlob(blob);
                    await new Promise((res) => img.setSrc(objUrl, () => res()));
                    setTimeout(() => { try { URL.revokeObjectURL(objUrl); } catch {} }, 2000);
                  }
                } catch (e) {
                  console.warn('image revive failed (blob):', e);
                }
              })()
          );
        } else if (url) {
          // URL 参照のまま
        }
      }

      Promise.allSettled(reviveQueue).then(() => {
        canvas.renderAll();
        enforceImageLimitAfterLoad();
        scheduleSave(); // 正規化後に保存
      });
    });
  }
  loadBoard();

  ['object:added', 'object:modified', 'object:removed'].forEach(ev => {
    canvas.on(ev, scheduleSave);
  });

  // -------- D&D/貼り付け補助 --------
  // クリックで URL 追加用の入力を後から足したくなった場合に備え、ここに空関数を残すだけ
})();
```

```manifest.json
{
  "name": "Pinterest Split + Fabric Board",
  "description": "Pinterest画面を3:7に分割し、左にFabric.jsでボードを表示します。",
  "version": "1.0.0",
  "manifest_version": 3,
  "permissions": ["clipboardWrite"],
  "content_scripts": [
    {
      "matches": [
        "https://*.pinterest.com/*",
        "http://*.pinterest.com/*",
        "https://*.pinterest.jp/*",
        "http://*.pinterest.jp/*"
      ],
      "run_at": "document_end",
      "js": [
        "fabric.min.js",
        "content.js"
      ]
    }
  ]
}

```
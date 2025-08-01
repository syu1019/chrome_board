// Pinterest Split + Fabric Board
// (IndexedDB persists: images as Blob, board JSON in 'boards'; no pan, no zoom, RIGHT board, toolbar removed, max 8 images, centered scaling)
// 前提: fabric.min.js を manifest の content_scripts で本ファイルより先に読み込み済み

(() => {
  'use strict';

  const APP_ID   = 'prx-root-purefab';
  const STYLE_ID = APP_ID + '-style';
  const UI_OPEN_BTN_ID = APP_ID + '-opener';

  // ==== 二重起動ガード ====
  if (window.__PRX_PUREFAB_ACTIVE__) {
    console.debug('[PureFab] already active, skip init.');
    return;
  }
  window.__PRX_PUREFAB_ACTIVE__ = true;

  // ---- 外部エラーフック ----
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
    const oldOpen  = document.getElementById(UI_OPEN_BTN_ID);
    if (oldOpen && oldOpen.parentNode) oldOpen.parentNode.removeChild(oldOpen);
  } catch {}

  // 離脱時にも片付け＋フラグ解除
  const __pf_cleanup__ = () => {
    try {
      const n1 = document.getElementById(APP_ID);
      if (n1 && n1.parentNode) n1.parentNode.removeChild(n1);
      const n2 = document.getElementById(STYLE_ID);
      if (n2 && n2.parentNode) n2.parentNode.removeChild(n2);
      const n3 = document.getElementById(UI_OPEN_BTN_ID);
      if (n3 && n3.parentNode) n3.parentNode.removeChild(n3);
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
  const LS_KEY_VIS  = APP_ID + ':visible';

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

  async function idbListAll(store) {
    const db  = await idbOpen();
    return new Promise((resolve, reject) => {
      const tx  = db.transaction(store, 'readonly');
      const st  = tx.objectStore(store);
      const out = [];
      st.openCursor().onsuccess = (e) => {
        const cur = e.target.result;
        if (cur) { out.push(cur.value); cur.continue(); }
      };
      tx.oncomplete = () => resolve(out);
      tx.onerror    = () => reject(tx.error);
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

  // -------- スタイル注入（可変：可視/非表示で body margin を切替） --------
  const style = document.createElement('style');
  style.id = STYLE_ID;

  const initialVisible = (() => {
    const v = localStorage.getItem(LS_KEY_VIS);
    if (v === '0') return false;
    if (v === '1') return true;
    return true; // 既定は表示
  })();

  function applyGlobalStyle(visible){
    const mr = visible ? `${SPLIT_RATIO * 100}vw` : '0';
    style.textContent = `
      html { overflow-x: hidden !important; }
      body { margin-right: ${mr} !important; transition: margin-right 200ms ease; }
      [role="main"], #__PWS_ROOT__, #__PWS_ROOT__ > div { max-width: 100% !important; }
      .jzS.un8.C9i.TB_ { width: 68% !important; }
    `;
  }
  applyGlobalStyle(initialVisible);
  (document.head || document.documentElement).appendChild(style);

  // -------- 右ペインDOM（Notion風ツールバー＋折りたたみ） --------
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
    boxShadow: '-4px 0 8px rgba(0,0,0,0.3)',
    transform: initialVisible ? 'translateX(0)' : 'translateX(100%)',
    transition: 'transform 200ms ease'
  });

  // Notion風トップバー
  const topbar = document.createElement('div');
  Object.assign(topbar.style, {
    height: '44px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0 10px',
    borderBottom: '1px solid #2f2f2f',
    background: '#222',
    color: '#ddd',
    font: '13px/1.2 system-ui, -apple-system, Segoe UI, Roboto, sans-serif',
    flexShrink: '0'
  });

  const title = document.createElement('div');
  title.textContent = 'Board';
  Object.assign(title.style, { fontWeight: '600', letterSpacing: '.2px' });

  const hideBtn = document.createElement('button');
  hideBtn.type = 'button';
  hideBtn.textContent = ' ⟩⟩ ';
  Object.assign(hideBtn.style, {
    border: '1px solid #3a3a3a',
    background: '#2a2a2a',
    color: '#ddd',
    padding: '6px 10px',
    borderRadius: '8px',
    cursor: 'pointer'
  });
  hideBtn.onmouseenter = () => hideBtn.style.background = '#313131';
  hideBtn.onmouseleave = () => hideBtn.style.background = '#2a2a2a';

  topbar.append(hideBtn);
  topbar.style.justifyContent = 'flex-end';

  const wrap = document.createElement('div');
  Object.assign(wrap.style, { position: 'relative', flex: '1', minHeight: '0', display: 'block', contain: 'strict' });

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
  Object.assign(elCanvas.style, { display: 'block', willChange: 'transform' });
  wrap.appendChild(elCanvas);

  host.append(topbar, wrap);
  (document.body || document.documentElement).appendChild(host);

  // 「開く」ピル（折りたたみ時のみ表示）
  const opener = document.createElement('button');
  opener.id = UI_OPEN_BTN_ID;
  opener.textContent = ' ⟨⟨ ';
  Object.assign(opener.style, {
    position: 'fixed',
    right: '12px',
    top: '50%',
    transform: 'translateY(-50%)',
    zIndex: String(Z),
    border: '1px solid #3a3a3a',
    background: '#222',
    color: '#ddd',
    padding: '8px 12px',
    borderRadius: '999px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
    cursor: 'pointer',
    display: initialVisible ? 'none' : 'block'
  });
  opener.onmouseenter = () => opener.style.background = '#2a2a2a';
  opener.onmouseleave = () => opener.style.background = '#222';
  document.body.appendChild(opener);

  function setBoardVisible(visible){
    host.style.transform = visible ? 'translateX(0)' : 'translateX(100%)';
    applyGlobalStyle(visible);
    opener.style.display = visible ? 'none' : 'block';
    localStorage.setItem(LS_KEY_VIS, visible ? '1' : '0');
    // 展開時はキャンバスをリサイズ
    if (visible) {
      setTimeout(() => { resize(); safeRender(); }, 210);
    }
  }
  hideBtn.addEventListener('click', () => setBoardVisible(false));
  opener.addEventListener('click', () => setBoardVisible(true));

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

  // === rAF 集約レンダ ===
  let __rafId = 0;
  function safeRender() {
    if (__rafId) return;
    __rafId = requestAnimationFrame(() => {
      __rafId = 0;
      canvas.requestRenderAll();
    });
  }

  // === まとめ処理（描画一時停止） ===
  async function withRenderSuspended(fn) {
    const prev = canvas.renderOnAddRemove;
    canvas.renderOnAddRemove = false;
    try { await fn(); } finally {
      canvas.renderOnAddRemove = prev;
      safeRender();
    }
  }

  // ==== Pointer Capture（ワープ/ガタつき対策） ====
  const upper = canvas.upperCanvasEl;
  upper.style.touchAction = 'none'; // タッチのブラウザパン抑止
  upper.addEventListener('pointerdown', (ev) => { try { upper.setPointerCapture(ev.pointerId); } catch {} });
  upper.addEventListener('pointerup',     (ev) => { try { upper.releasePointerCapture(ev.pointerId); } catch {} });
  upper.addEventListener('pointercancel', (ev) => { try { upper.releasePointerCapture(ev.pointerId); } catch {} });
  upper.addEventListener('lostpointercapture', () => { /* 必要なら状態リセット */ });

  let __pf_dragging__ = false;
  canvas.on('mouse:down', () => { __pf_dragging__ = true; document.body.style.userSelect = 'none'; });
  canvas.on('mouse:up',   () => { __pf_dragging__ = false; document.body.style.userSelect = ''; });

  // 常に中心基準でスケールさせる & 既定原点を center に統一
  fabric.Object.prototype.centeredScaling = true;
  fabric.Object.prototype.originX = 'center';
  fabric.Object.prototype.originY = 'center';

  // ===== Undo/Redo + バッチ確定（タイムアウト） =====
  const UNDO_LIMIT = 20;
  const CUSTOM_PROPS = ['selectable','originX','originY','centeredScaling','prxBlobKey','prxSrcUrl','prxId'];
  const UNDO_TYPES = { ADD:'add', REMOVE:'remove', TRANSFORM:'transform', AUTOLIMIT:'autoLimitDelete' };

  function ensurePrxId(obj){
    if (!obj.prxId) obj.prxId = (crypto?.randomUUID && crypto.randomUUID()) || ('oid-' + Date.now() + '-' + Math.random().toString(36).slice(2));
    return obj.prxId;
  }
  function findById(id){ return canvas.getObjects().find(o => o.prxId === id) || null; }

  const TF_KEYS = ['left','top','scaleX','scaleY','angle','flipX','flipY','skewX','skewY','opacity'];
  const pickProps = (obj) => {
    const out = {};
    TF_KEYS.forEach(k => out[k] = obj[k]);
    return out;
  };

  function serializeForRemove(obj){
    const json = obj.toObject(CUSTOM_PROPS);
    const index = canvas.getObjects().indexOf(obj);
    return { json, index };
  }

  async function restoreImageFromJSON(json, index){
    const prxId = json.prxId || ((crypto?.randomUUID && crypto.randomUUID()) || ('oid-' + Math.random().toString(36).slice(2)));
    const applyCommon = (img) => { img.set(json); img.prxId = prxId; img.centeredScaling = true; img.setCoords(); };

    const blobKey = json.prxBlobKey || null;
    const srcUrl  = json.prxSrcUrl  || json.src || null;

    if (blobKey){
      try{
        const blob = await getImageBlob(blobKey);
        if (blob){
          const objUrl = URL.createObjectURL(blob);
          return new Promise((resolve)=> {
            fabric.Image.fromURL(objUrl, (img)=>{
              if (img){ applyCommon(img); canvas.insertAt(img, Math.max(0,index), true); safeRender(); }
              setTimeout(()=>{ try{ URL.revokeObjectURL(objUrl); }catch{} }, 2000);
              resolve(img || null);
            }, { crossOrigin: 'anonymous' });
          });
        }
      }catch(e){ console.warn('restore blob failed', e); }
    }
    if (srcUrl){
      return new Promise((resolve)=> {
        fabric.Image.fromURL(srcUrl, (img)=>{
          if (img){ applyCommon(img); canvas.insertAt(img, Math.max(0,index), true); safeRender(); }
          resolve(img || null);
        }, { crossOrigin: 'anonymous' });
      });
    }
    return null;
  }

  const Undo = (() => {
    const undoStack = [];
    const redoStack = [];
    const batches = new Map(); // token -> { type, items:[{id,json,index}], remaining, done, timer }
    let transformSnapshot = null; // { items:[{id, props}], afterProps? }

    function clearRedo(){ redoStack.length = 0; }

    function push(action, {fromReplay=false} = {}){
      undoStack.push(action);
      if (undoStack.length > UNDO_LIMIT) undoStack.shift();
      if (!fromReplay) clearRedo();
    }

    function beginBatch(type, expectedCount){
      const token = 'batch-' + Date.now() + '-' + Math.random().toString(36).slice(2);
      const b = { type, items:[], remaining: Math.max(1, expectedCount|0), done:false, timer:null };
      // タイムアウトで自動確定（例：4秒）
      b.timer = setTimeout(() => finalizeBatch(token), 4000);
      batches.set(token, b);
      return token;
    }

    function finalizeBatch(token){
      const b = batches.get(token);
      if (!b || b.done) return;
      b.done = true;
      clearTimeout(b.timer);
      b.timer = null;
      if (b.items.length){
        // ADD バッチ：items は {id,json,index}
        push({ type: UNDO_TYPES.ADD, items: b.items.map(x => ({ id:x.id, json:x.json, index:x.index })) });
      }
      batches.delete(token);
    }

    function recordAdd(obj, token){
      ensurePrxId(obj);
      const item = { id: obj.prxId, json: obj.toObject(CUSTOM_PROPS), index: canvas.getObjects().indexOf(obj) };
      if (!token){
        token = beginBatch(UNDO_TYPES.ADD, 1);
      }
      const b = batches.get(token);
      if (!b) return;
      b.items.push(item);
      b.remaining = Math.max(0, b.remaining - 1);
      if (b.remaining === 0 && !b.done){
        // 即時確定
        finalizeBatch(token);
      }
    }

    async function doUndo(){
      const act = undoStack.pop();
      if (!act) { toast('これ以上戻せません'); return; }

      if (act.type === UNDO_TYPES.ADD){
        // 追加 → 削除
        const removed = [];
        act.items.forEach(it => {
          const o = findById(it.id);
          if (o){ removed.push(serializeForRemove(o)); canvas.remove(o); }
        });
        canvas.discardActiveObject();
        safeRender();
        scheduleSave();
        // Redo用（再追加に備え JSON を持つ）
        redoStack.push({ type: UNDO_TYPES.ADD, items: act.items });
        toast('追加を取り消しました');
        return;
      }

      if (act.type === UNDO_TYPES.REMOVE || act.type === UNDO_TYPES.AUTOLIMIT){
        // 削除 → 復元
        await Promise.allSettled(act.objects.map(o => restoreImageFromJSON(o.json, o.index)));
        safeRender();
        scheduleSave();
        // Redo用（再削除）
        redoStack.push(act);
        toast('削除を取り消しました');
        return;
      }

      if (act.type === UNDO_TYPES.TRANSFORM){
        // 変形 → 元へ
        for (const it of act.before){
          const o = findById(it.id);
          if (o){ Object.assign(o, it.props); o.setCoords(); }
        }
        safeRender();
        scheduleSave();
        // Redo用（after に進め直す）
        redoStack.push(act);
        toast('編集を取り消しました');
        return;
      }
    }

    async function doRedo(){
      const act = redoStack.pop();
      if (!act) { toast('これ以上やり直せません'); return; }

      // 再適用し、undoStackへ積み直す（fromReplay=trueでRedoスタックのクリアを防ぐ）
      if (act.type === UNDO_TYPES.ADD){
        // 再追加
        await Promise.allSettled(act.items.map(it => restoreImageFromJSON(it.json, it.index)));
        safeRender();
        scheduleSave();
        push({ type: UNDO_TYPES.ADD, items: act.items }, { fromReplay:true });
        toast('追加をやり直しました');
        return;
      }

      if (act.type === UNDO_TYPES.REMOVE || act.type === UNDO_TYPES.AUTOLIMIT){
        // 再削除
        const removed = [];
        for (const oinfo of act.objects){
          const id = oinfo.json?.prxId;
          if (!id) continue;
          const o = findById(id);
          if (o){ removed.push(serializeForRemove(o)); canvas.remove(o); }
        }
        canvas.discardActiveObject();
        safeRender();
        scheduleSave();
        push({ type: act.type, objects: removed }, { fromReplay:true });
        toast('削除をやり直しました');
        return;
      }

      if (act.type === UNDO_TYPES.TRANSFORM){
        // after に進める
        for (const it of act.after){
          const o = findById(it.id);
          if (o){ Object.assign(o, it.props); o.setCoords(); }
        }
        safeRender();
        scheduleSave();
        push(act, { fromReplay:true });
        toast('編集をやり直しました');
        return;
      }
    }

    // 変形スナップショット
    function onPointerDown(){
      const sel = canvas.getActiveObjects() || [];
      if (!sel.length) { transformSnapshot = null; return; }
      transformSnapshot = {
        items: sel.map(o => ({ id: ensurePrxId(o), props: pickProps(o) }))
      };
      // 変形中はキャッシュOFF
      fabric.Object.prototype.objectCaching = false;
    }
    function onPointerUp(){
      // 変形終了でキャッシュON
      fabric.Object.prototype.objectCaching = true;

      if (!transformSnapshot) return;
      const before = transformSnapshot.items;
      const after = [];
      for (const b of before){
        const o = findById(b.id);
        if (!o) continue;
        const now = pickProps(o);
        const diff = TF_KEYS.some(k => (now[k] ?? null) !== (b.props[k] ?? null));
        if (diff) after.push({ id: b.id, props: now });
      }
      transformSnapshot = null;
      if (after.length){
        const action = {
          type: UNDO_TYPES.TRANSFORM,
          before, // ここは「元に戻す」側
          after   // ここは「やり直す」側
        };
        push(action);
        safeRender();
      }
    }

    return {
      beginBatch, recordAdd, finalizeBatch,
      undo: doUndo, redo: doRedo,
      onPointerDown, onPointerUp,
      pushRemove(objects){ if (objects.length) push({ type: UNDO_TYPES.REMOVE, objects }); },
      pushAutoLimit(objects){ if (objects.length) push({ type: UNDO_TYPES.AUTOLIMIT, objects }); },
      stacks(){ return { undoStack, redoStack, batches }; } // GC 用
    };
  })();

  // === Shift+Alt フリップ（上下/左右） ===
  // 単一画像選択時、Shift+Alt を押してドラッグ開始:
  //   - 最初の移動が縦優勢 → flipY トグル（上下反転）
  //   - 最初の移動が横優勢 → flipX トグル（左右反転）
  // ドラッグ中は lockMovementX/Y で移動させない。1ジェスチャにつき1回のみ。
  const FlipGesture = (() => {
    const THRESH = 16; // 方向判定のしきい値(px)
    let active = false;
    let started = false;
    let obj = null;
    let startX = 0, startY = 0;
    let prevLockX = false, prevLockY = false;

    function canStart(e){
      if (!e.shiftKey || !e.altKey) return false;
      const sel = canvas.getActiveObjects() || [];
      if (sel.length !== 1) return false;
      const o = sel[0];
      if (!o || o.type !== 'image') return false;
      return true;
    }

    function onMouseDown(opt){
      const e = opt.e || {};
      if (!canStart(e)) { active = false; obj = null; return; }

      const sel = canvas.getActiveObjects();
      obj = sel[0];
      // 移動ロック（ジェスチャ中は動かさない）
      prevLockX = !!obj.lockMovementX;
      prevLockY = !!obj.lockMovementY;
      obj.lockMovementX = true;
      obj.lockMovementY = true;

      startX = e.clientX;
      startY = e.clientY;
      active = true;
      started = false;
    }

    function onMouseMove(opt){
      if (!active || !obj) return;
      const e = opt.e || {};
      // 念のためデフォルト阻止（スクロール等）
      if (e.preventDefault) e.preventDefault();

      const dx = (e.clientX ?? startX) - startX;
      const dy = (e.clientY ?? startY) - startY;

      if (!started){
        if (Math.abs(dx) < THRESH && Math.abs(dy) < THRESH) return;
        started = true;

        if (Math.abs(dy) >= Math.abs(dx)) {
          // 縦優勢 → 上下反転
          obj.set('flipY', !obj.flipY);
          obj.setCoords();
          safeRender();
          toast('上下反転');
        } else {
          // 横優勢 → 左右反転
          obj.set('flipX', !obj.flipX);
          obj.setCoords();
          safeRender();
          toast('左右反転');
        }
      }
    }

    function onMouseUp(){
      if (!active) return;
      if (obj){
        // ロック復元
        obj.lockMovementX = prevLockX;
        obj.lockMovementY = prevLockY;
      }
      active = false;
      obj = null;
    }

    // 念のため、moving も抑止（他経路の移動をブロック）
    function onObjectMoving(opt){
      if (active && opt?.target){
        opt.target.left = opt.target.left; // no-op
        opt.target.top  = opt.target.top;  // no-op
        if (opt.e?.preventDefault) opt.e.preventDefault();
      }
    }

    return { onMouseDown, onMouseMove, onMouseUp, onObjectMoving };
  })();

  // ホイールズーム完全無効化
  canvas.on('mouse:wheel', (opt) => { opt.e.preventDefault(); opt.e.stopPropagation(); });

  // キャンバスのリサイズ
  const resize = () => {
    const rect = wrap.getBoundingClientRect();
    canvas.setDimensions({ width: rect.width, height: rect.height }, { backstoreOnly: false });
    safeRender();
  };
  new ResizeObserver(resize).observe(wrap);
  // 初期表示状態に応じてリサイズ
  if (initialVisible) resize();

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

    const removed = [];
    for (let i = 0; i < excess; i++) {
      const list = canvas.getObjects('image'); // 先に追加されたものから削除
      if (list[i]) {
        ensurePrxId(list[i]);
        removed.push(serializeForRemove(list[i]));
        canvas.remove(list[i]);
      }
    }
    if (removed.length){
      Undo.pushAutoLimit(removed);
      toast(`画像は最大 ${MAX_IMAGES} 枚までに制限しました`);
      safeRender();
      scheduleSave();
    }
  }

  // -------- 画像追加ユーティリティ --------
  function fitImageInside(img, cw, ch, maxRatio = 1.0) {
    const w = img.width || 1;
    const h = img.height || 1;
    const scale = Math.min((cw * maxRatio) / w, (ch * maxRatio) / h, 1);
    img.scale(scale);
  }

  function objURLFromBlob(blob) { try { return URL.createObjectURL(blob); } catch { return null; } }

  async function addImageFromUrl(url, batchToken) {
    if (!url) return;
    if (!ensureCanAdd(1)) return;
    const clean = url.trim();

    let blob = null;
    try {
      const res = await fetch(clean, { mode: 'cors', credentials: 'omit' });
      if (!res.ok) throw new Error('fetch not ok');
      blob = await res.blob();
    } catch { blob = null; }

    if (blob) {
      const key = await saveImageBlob(blob);
      const urlObj = objURLFromBlob(blob);
      fabric.Image.fromURL(urlObj, (img) => {
        if (!img) { if (urlObj) setTimeout(() => URL.revokeObjectURL(urlObj), 2000); return; }
        img.set({ crossOrigin: 'anonymous' });
        fitImageInside(img, canvas.getWidth(), canvas.getHeight(), 0.9);
        img.set({ originX:'center', originY:'center', left:canvas.getWidth()/2, top:canvas.getHeight()/2, selectable:true, prxBlobKey:key, prxSrcUrl:null });
        ensurePrxId(img);
        canvas.add(img);
        canvas.setActiveObject(img);
        Undo.recordAdd(img, batchToken);
        safeRender();
        scheduleSave();
        setTimeout(() => { try { URL.revokeObjectURL(urlObj); } catch {} }, 2000);
      }, { crossOrigin: 'anonymous' });
      return;
    }

    fabric.Image.fromURL(clean, (img) => {
      if (!img) return;
      img.set({ crossOrigin: 'anonymous' });
      fitImageInside(img, canvas.getWidth(), canvas.getHeight(), 0.9);
      img.set({ originX:'center', originY:'center', left:canvas.getWidth()/2, top:canvas.getHeight()/2, selectable:true, prxBlobKey:null, prxSrcUrl:clean });
      ensurePrxId(img);
      canvas.add(img);
      canvas.setActiveObject(img);
      Undo.recordAdd(img, batchToken);
      safeRender();
      scheduleSave();
    }, { crossOrigin: 'anonymous' });
  }

  function addImageFromFile(file, batchToken) {
    if (!file || !file.type?.startsWith('image/')) return;
    if (!ensureCanAdd(1)) return;
    addImageFromBlob(file, batchToken);
  }

  async function addImageFromBlob(blob, batchToken) {
    if (!blob || !blob.type?.startsWith('image/')) return;
    if (!ensureCanAdd(1)) return;

    const key = await saveImageBlob(blob);
    const url = objURLFromBlob(blob);
    fabric.Image.fromURL(url, (img) => {
      if (!img) { if (url) setTimeout(() => URL.revokeObjectURL(url), 2000); return; }
      fitImageInside(img, canvas.getWidth(), canvas.getHeight(), 0.9);
      img.set({ originX:'center', originY:'center', left:canvas.getWidth()/2, top:canvas.getHeight()/2, selectable:true, prxBlobKey:key, prxSrcUrl:null });
      ensurePrxId(img);
      canvas.add(img);
      canvas.setActiveObject(img);
      Undo.recordAdd(img, batchToken);
      safeRender();
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
      const token = Undo.beginBatch('add', files.length);
      withRenderSuspended(async () => {
        for (const f of files) addImageFromFile(f, token);
      });
      return;
    }

    const uriList = dt.getData('text/uri-list');
    const plain   = dt.getData('text/plain');
    const text    = (uriList || plain || '').trim();
    if (text && isProbablyUrl(text)) {
      if (!ensureCanAdd(1)) return;
      addImageFromUrl(text, null); // 単発
    }
  });

  function isProbablyUrl(s) { try { new URL(s); return true; } catch { return false; } }

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
      const take = items.slice(0, capacity);
      const token = Undo.beginBatch('add', take.length);
      withRenderSuspended(async () => {
        for (const it of take) {
          const blob = it.getAsFile();
          if (blob) addImageFromBlob(blob, token);
        }
      });
      return;
    }

    const text = cd.getData('text')?.trim();
    if (text && isProbablyUrl(text)) {
      if (!ensureCanAdd(1)) return;
      addImageFromUrl(text, null);
    }
  });

  // ====== 画像コピー（Ctrl/⌘+C） ======
  let __copyBusy = false;
  async function copyActiveImageToClipboard() {
    const sel = canvas.getActiveObjects() || [];
    if (sel.length !== 1) return false;
    const obj = sel[0];
    if (obj?.type !== 'image') return false;
    if (__copyBusy) return false;
    __copyBusy = true;

    try {
      return await new Promise((resolve, reject) => {
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
    } finally {
      __copyBusy = false;
    }
  }

  // -------- キーボードショートカット（Delete/Backspace/Copy/Undo/Redo） --------
  window.addEventListener('keydown', async (e) => {
    if (document.activeElement && (document.activeElement.tagName === 'INPUT' || document.activeElement.tagName === 'TEXTAREA' || document.activeElement.isContentEditable)) return;

    // Ctrl/⌘ + Z = Undo
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && (e.key === 'z' || e.key === 'Z')) {
      e.preventDefault();
      await Undo.undo();
      return;
    }
    // Ctrl/⌘ + Shift + Z または Ctrl/⌘ + Y = Redo
    if ((e.ctrlKey || e.metaKey) && ((e.shiftKey && (e.key === 'z' || e.key === 'Z')) || e.key === 'y' || e.key === 'Y')) {
      e.preventDefault();
      await Undo.redo();
      return;
    }

    // Delete / Backspace = 削除（Undo対応）
    if (e.key === 'Delete' || e.key === 'Backspace') {
      const active = canvas.getActiveObjects();
      if (active && active.length) {
        const removed = [];
        active.forEach(obj => {
          ensurePrxId(obj);
          removed.push(serializeForRemove(obj));
          canvas.remove(obj);
        });
        canvas.discardActiveObject();
        if (removed.length) Undo.pushRemove(removed);
        safeRender();
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

  // 変形のUndo収集（+キャッシュ制御）
  canvas.on('mouse:down', (opt) => { Undo.onPointerDown(opt); FlipGesture.onMouseDown(opt); });
  canvas.on('mouse:move', (opt) => { FlipGesture.onMouseMove(opt); });
  canvas.on('mouse:up',   (opt) => { FlipGesture.onMouseUp(opt); Undo.onPointerUp(opt); });
  canvas.on('object:moving', (opt) => { FlipGesture.onObjectMoving(opt); });

  // -------- 永続化（IndexedDB） + GC --------
  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      if ('requestIdleCallback' in window) {
        requestIdleCallback(async () => { await saveNow(); scheduleGc(); }, { timeout: 1500 });
      } else {
        saveNow().then(scheduleGc);
      }
    }, 400);
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

    const reviveQueue = [];
    canvas.loadFromJSON(saved.json, () => {
      const imgs = canvas.getObjects('image');
      let needResave = false;

      for (const img of imgs) {
        if (img.originX !== 'center' || img.originY !== 'center') {
          const cx = img.left + img.getScaledWidth() / 2;
          const cy = img.top  + img.getScaledHeight() / 2;
          img.set({ originX: 'center', originY: 'center', left: cx, top: cy });
        }
        img.centeredScaling = true;
        ensurePrxId(img);
        img.setCoords();

        const key = img.prxBlobKey || null;
        const url = img.prxSrcUrl  || null;

        if (key) {
          reviveQueue.push(
              (async () => {
                try {
                  const blob = await getImageBlob(key);
                  if (blob) {
                    const objUrl = objURLFromBlob(blob);
                    await new Promise((res) => img.setSrc(objUrl, () => res()));
                    setTimeout(() => { try { URL.revokeObjectURL(objUrl); } catch {} }, 2000);
                  }
                } catch (e) { console.warn('image revive failed (blob):', e); }
              })()
          );
        } else if (url) {
          // URL参照のまま
        } else {
          needResave = true;
        }
      }

      Promise.allSettled(reviveQueue).then(() => {
        safeRender();
        enforceImageLimitAfterLoad();
        if (needResave) scheduleSave();
        scheduleGc(); // 起動時にもGCを計画
      });
    });
  }
  loadBoard();

  ['object:added', 'object:modified', 'object:removed'].forEach(ev => {
    canvas.on(ev, scheduleSave);
  });

  // ===== 参照されないBlobのGC（アイドル時・分割実行） =====
  const GC_GRACE_MS = 10 * 60 * 1000; // 10分猶予
  const GC_INTERVAL_MIN = 2 * 60 * 1000; // 実行間隔（最短2分）
  let lastGcAt = 0;
  let gcTimer = null;

  function collectReferencedBlobKeys(){
    const refs = new Set();
    // Canvas 上
    for (const o of canvas.getObjects('image')){
      if (o.prxBlobKey) refs.add(o.prxBlobKey);
    }
    // Undo/Redo スタック内（JSONに含まれる）
    const { undoStack, redoStack, batches } = Undo.stacks();
    const scanActs = (arr) => {
      for (const act of arr){
        if (act.items){ // ADD
          for (const it of act.items){ const k = it.json?.prxBlobKey; if (k) refs.add(k); }
        }
        if (act.objects){ // REMOVE/AUTOLIMIT
          for (const oinfo of act.objects){ const k = oinfo.json?.prxBlobKey; if (k) refs.add(k); }
        }
      }
    };
    scanActs(undoStack); scanActs(redoStack);
    // 進行中のバッチ（確定待ち）
    batches.forEach(b => {
      for (const it of b.items){ const k = it.json?.prxBlobKey; if (k) refs.add(k); }
    });
    return refs;
  }

  async function runBlobGcChunked(limit = 200) {
    try{
      const refs = collectReferencedBlobKeys();
      const rows = await idbListAll('images'); // {id, blob, type, created}
      const cutoff = Date.now() - GC_GRACE_MS;

      let i = 0;
      async function step(deadline) {
        let count = 0;
        while (i < rows.length && (count < limit) && (deadline?.timeRemaining?.() > 5 || !deadline)) {
          const r = rows[i++];
          const id = r.id;
          const created = r.created || 0;
          if (!refs.has(id) && created < cutoff) {
            try { await idbDelete('images', id); } catch {}
          }
          count++;
        }
        if (i < rows.length) {
          if ('requestIdleCallback' in window) requestIdleCallback(step);
          else setTimeout(() => step(), 0);
        }
      }
      if ('requestIdleCallback' in window) requestIdleCallback(step);
      else setTimeout(() => step(), 0);
    } catch(e) {
      console.warn('[PureFab/GC] failed:', e);
    }
  }

  function scheduleGc(){
    const now = Date.now();
    if (now - lastGcAt < GC_INTERVAL_MIN) return; // 頻度制御
    clearTimeout(gcTimer);
    gcTimer = setTimeout(() => { lastGcAt = Date.now(); runBlobGcChunked(); }, 1500);
  }

  // ---- タブ可視状態で描画制御（強化） ----
  document.addEventListener('visibilitychange', () => {
    const hidden = document.hidden;
    canvas.renderOnAddRemove = !hidden;
    if (!hidden) safeRender();
  });

  // 将来拡張用フック
  // クリックで URL 追加用の入力を後から足したくなった場合に備え、ここに空関数を残すだけ
})();

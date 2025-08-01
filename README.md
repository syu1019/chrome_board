# Pinterest Split + Fabric Board

Pinterest を左右分割し、**右 30% の固定ペイン**に Fabric.js ベースのボードを表示する Chrome 拡張です。  
画像は **IndexedDB（Blob）** に保存され、ボード構成(JSON)は別ストアに永続化されます。**パン/ズームなし**、**ツールバーなし**、**最大 8 枚**までの画像追加、**Undo/Redo** 対応。

> ⚠️ 本拡張は Pinterest ドメイン上でのみ動作する _content script_ です（`https://*.pinterest.com/*` / `https://*.pinterest.jp/*`）。

---

## 主な機能

- 画面 3:7 分割（左: Pinterest / 右: ボード）
- 右ペインはダーク背景 (`#1c1c1c` / キャンバス `#2a2a2a`)
- 画像の永続化: **IndexedDB**
  - `images` ストア: `{ id, blob, type, created }`
  - `boards` ストア: `{ id:'main', json, updated }`
- 画像の追加方法
  - **ドラッグ & ドロップ**（ファイル / URL）
  - **ペースト**（クリップボード画像 / URL）
  - **URL 直指定のフェッチ**（CORS 許可時は Blob 保存、不可時は URL 参照）
- **画像上限 8 枚**（超過時は先に追加されたものから自動削除・Undo 対応）
- **Undo / Redo**
  - 直近 **20 回**まで（追加・削除・移動/拡縮/回転などの変形）
  - 複数画像の一括追加は **1 ステップのバッチ**として取り扱い
- **単一選択画像のコピー（Ctrl/⌘+C）**
  - 選択中が 1 枚の `image` オブジェクトのとき、PNG としてクリップボードへ書き込み
- Delete / Backspace で削除（Undo 対応）
- ペイン内レンダリング最適化（rAF 集約 / 変形時キャッシュ制御 / `requestIdleCallback` 保存 / 参照のない Blob の **段階的 GC**）
- **二重起動ガード**と **離脱時クリーンアップ**
- エラータップ（`alphabetical` / `uiState` を検出時に詳細ログ出力）

---

## インストール（開発者モード）

1. このリポジトリをダウンロード / クローンします。
2. `fabric.min.js` を `content.js` より **先に** 読み込むよう `manifest.json` を配置します。
3. Chrome で `chrome://extensions/` を開き、右上の **デベロッパーモード**をオン。
4. **パッケージ化されていない拡張機能を読み込む** から本フォルダを選択。

### `manifest.json` 例

```json
{
  "name": "Pinterest Split + Fabric Board",
  "description": "Pinterest画面を3:7に分割し、右にFabric.jsボードを表示します。",
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

> **Permission**: クリップボード書き込みには `clipboardWrite` が必要です。

---

## 使い方

- Pinterest のページを開くと、右側にボードが出現します。
- 画像の追加
  - 右ペインへ画像ファイルを **D&D** する
  - 右ペインをアクティブにして **貼り付け（Ctrl/⌘+V）**
  - 画像の **URL を D&D / 貼り付け**（CORS 許可時は Blob 保存）
- 画像の配置
  - オブジェクトをドラッグで移動、ハンドルで拡大縮小・回転
  - 常に中心基準でスケールされます（`centeredScaling`）
- 保存
  - 変更は自動保存（短い遅延の後、`IndexedDB` に保存）

### ショートカット

| 操作 | キー |
|---|---|
| 元に戻す | `Ctrl/⌘+Z` |
| やり直す | `Ctrl/⌘+Shift+Z` または `Ctrl/⌘+Y` |
| 削除 | `Delete` または `Backspace` |
| 画像をクリップボードにコピー（単一選択時） | `Ctrl/⌘+C` |

> 複数選択時はコピー不可です。単一 `image` のみが対象となります。

---

## データ構造と永続化

- **IndexedDB**
  - **`images`**: 画像 Blob とメタ（`{ id, blob, type, created }`）を保存
  - **`boards`**: キャンバスの JSON（必要なカスタムプロパティ込み）を保存
- **GC（ガーベジコレクション）**
  - キャンバス・Undo/Redo スタック・進行中バッチで参照されない Blob を、アイドル時に段階的に削除
  - 既定猶予: **10 分**（`GC_GRACE_MS`）

---

## 既知の制限 / メモ

- **最大 8 枚**の画像制限（超過は自動削除・Undo 対応）
- **パン / ズーム**は無効化（意図的）
- CORS により、URL 経由追加で **Blob 化できない**場合は **URL 参照**のままになります
- 画像コピー（`Ctrl/⌘+C`）にはブラウザのクリップボード権限が必要です
- Pinterest 側 UI のクラス名変更などで左ペイン幅の微調整が必要になる可能性があります

---

## トラブルシュート

- **何も表示されない / 奇妙な重複動作**  
  → 同系の拡張が **二重起動**していないか確認し、ページを再読込してください。  
  → コンソールで `__PRX_PUREFAB_ACTIVE__` が重複しないことを確認。

- **コンソールに `alphabetical` / `uiState` が出る**  
  → 本拡張は該当ワードを含む例外を **詳細ログ出力**します。エラースタックの発生源を特定してください（Pinterest 側変更の影響が疑われます）。

- **画像が保存されない / 消える**  
  → CORS の都合で Blob 保存できなかった URL は **URL 参照**として復元します。元 URL が消えると表示できません。必要に応じてファイル経由で追加してください。

- **コピーに失敗する**  
  → サイト権限・ブラウザ設定でクリップボード書き込みがブロックされていないか確認。

---

## 開発メモ

- Fabric.js は `fabric.min.js` を **content script で先に**読み込む前提です
- `canvas.toJSON()` には以下の **カスタムプロパティ**を含めています:  
  `['selectable','originX','originY','centeredScaling','prxBlobKey','prxSrcUrl','prxId']`
- 変形の Undo は `mouse:down` / `mouse:up` でスナップショットを取り、差分があれば 1 ステップとして記録
- 保存は `requestIdleCallback` で遅延実行し、`object:added/modified/removed` をトリガに予約
- 右ペインのレイアウトは固定幅（`SPLIT_RATIO=0.30`）

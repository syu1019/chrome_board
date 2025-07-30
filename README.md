# chrome_board

```プロンプト
chrome拡張機能を作ってください
拡張機能はpinterestでだけ動くようにしてください

cssを利用して、画面を3:7に分割してください
狭い方にはpurerefのような機能をもつ画像ビューワを作ってください
広い方にはpinterestの画面を表示してください

画像操作の機能にはFablicJSを使用してください
FablicJSは`<script src="fabric.min.js"></script> <!--https://cdn.jsdelivr.net/npm/fabric@5.3.0/dist/fabric.min.jsをローカルに取り込んだもの-->`を使用してください

manifest.jsonとcontent.jsにすべてをまとめるようにしてください

`Could not load icon 'icon16.png' specified in 'icons'.`のエラーが出るのでマニフェストにアイコンを含めないでください

ストレージはローカルストレージを使用してください

パンは付けないでください
ズームはつけないでください

固定ボードを右に表示するようにして

全体的にUIはnotionっぽくして

マニフェストはこれを使います
~~~
{
  "name": "Pinterest Split + Fabric Board",
  "description": "Pinterest画面を3:7に分割し、左にFabric.jsでボードを表示します。",
  "version": "1.0.0",
  "manifest_version": 3,
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
~~~
```

## メモ

```
・スペースでキャンバスを動かすと画像が消える
・検索バーがめり込むので元ページの要素を与えて改善できるか試す
・ボードを移動できる機能を不要です
```
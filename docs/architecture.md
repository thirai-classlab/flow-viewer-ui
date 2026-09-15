# アーキテクチャ

作成: 2026-09-15。構成の変更（lib / demo 分離、公開 API）は `draft/flow-viewer-package.md` で起案し、台帳 #3 / #4 で実装する。

## 構成（目標）

```
flow-viewer-ui/
├── src/
│   ├── lib/                      # publish 対象 = @thirai-classlab/flow-viewer
│   │   ├── index.ts              # export: FlowViewer / FlowDoc / validateFlowDoc
│   │   ├── flow/                 # ライブラリ非依存の層（schema / collapse / flatten / theme / view-props）※アルゴリズムは触らない
│   │   ├── logicflow/            # LogicFlow による描画（layout / drilldown / split / anim / nodes）
│   │   ├── doc-panel/            # 手順書パネル（読み取り専用。marked + dompurify）
│   │   └── styles/               # トークン（light / dark）+ コンポーネント CSS → dist/style.css
│   └── demo/                     # 動作確認用アプリ（publish しない）
│       ├── App.tsx               # 閲覧 / 編集モード、Toolbar / SidePanel / JsonPanel / InfoPanel
│       └── data/                 # 32 テストケース / 自動生成 / 手書きサンプル / 匿名化実データ
├── tests/                        # vitest（src/lib/flow の回帰）
├── docs/
└── dist/                         # vite build（lib モード）: ES + CJS + style.css + .d.ts
```

現状（2026-09-15）は POC からコピーした `src/{flow,logicflow,ui}` + `App.tsx` のままで、分離は未着手。

## 公開 API（骨格）

```ts
import { FlowViewer, validateFlowDoc, type FlowDoc, type FlowViewerHandle } from '@thirai-classlab/flow-viewer'
import '@thirai-classlab/flow-viewer/style.css'

<FlowViewer
  ref={handle}                       // handle.goUp() / handle.drillInto(id)
  doc={flowDoc}                      // FlowDoc（validateFlowDoc で通したもの）
  mode="drilldown"                   // 'drilldown' | 'split' | 'nested'
  direction="horizontal"             // モード共通の設定はすべてプロパティ
  showAncestors                      // drilldown: 上位を表示
  nestPath={...}                     // split: 左ペインの入れ子経路
  abstraction={...}                  // nested: 一括の抽象度
  animate
  theme="light"                      // 'light' | 'dark'
  onPathChange={(path) => ...}       // ホストがパンくずを描く
  onSelect={(node) => ...}           // 選択ノード（doc 含む）
/>
```

- **状態の持ち方**: 表示モードと設定は controlled（プロパティ）。階層の現在地と選択は uncontrolled（内部）+ `ref` メソッド + コールバック通知。ホストは Toolbar を自前で作るが、階層移動の整合（圏外リンク、上位表示）はコンポーネント内で閉じる
- **境界の検証**: `validateFlowDoc(json): { ok: true, doc } | { ok: false, errors }`。依存を足さず手書きで書く

## データの持ち方

- 真実源は `FlowDoc` JSON 1 本（`schema.ts`）。コンポーネントは JSON を受け取るだけで、読み込み・保存・変換はホストの責務
- 派生データ（折りたたみ後の平坦化、レイアウト座標）はすべて `FlowDoc` から毎回計算する。永続化しない
- デモのデータ源は `sample3` / `sample5` / `gen:<depth>` / `case:<id>` の文字列で選ぶ（`data-source.ts`）。匿名化実データは `real:<id>` として同列に足す
- 実データは匿名化したものだけを `src/demo/data/` に置く。匿名化前のファイルは `*.local`（gitignore 済）

## 技術判断とその理由

| 判断 | 理由 | 代替案と落とした理由 |
|---|---|---|
| LogicFlow を描画エンジンに使う | POC で 11 ライブラリを実機比較して採用。階層・折りたたみ・カスタムノードが揃う | 再選定はしない（`flow-visualization-oss-research/` 参照） |
| npm パッケージとして配布 | ホストが React 製で、型ごと渡せる | iframe: テーマ連携と状態の受け渡しが弱い。ソースコピー: 更新が追えない |
| キャンバスだけ渡し、Toolbar はホスト | ホストの情報設計に Toolbar を合わせる方が自然 | シェル込み: ホスト側で作り直しになる |
| 階層移動は内部状態 + `ref` メソッド | 圏外リンク・上位表示の整合をコンポーネント内で閉じられる。ホストは `onPathChange` でパンくずを描ける | controlled `path`: ホストが整合を保つ責任を負う |
| DocPanel を同梱 | 手順書はフローと一体の情報。ホストごとに作らせない | ホスト実装: `marked` / `dompurify` の依存は減るが実装が分散 |
| ライト既定 + ダーク、CSS 変数トークン | 資料用途と長時間閲覧の両方に応える。ホストの配色に CSS だけで寄せられる | ダーク固定: 資料用途に不向き |
| `style.css` 別出力 | トークン上書きが CSS だけで済む。Vite lib モードの既定 | JS 埋め込み: 上書きに `!important` が要りがち |
| 1 パッケージ内で `src/lib` / `src/demo` を分ける | 境界がフォルダで見え、package.json は 1 つ | workspaces: 一人開発には重い。分けない: demo コードが publish に紛れる |
| vitest は `src/lib/flow` だけ | 触らないと決めた層が UI 変更で壊れないことを自動で担保。UI テストは見た目を変える最中は壊れ続ける | ピクセル比較: UI を意図的に変えるので毎回 FAIL |
| npm 手動 publish、0.x | 一人開発でホストが 1 つ。secrets を CI に置かずに済む | CI publish: `NPM_TOKEN` の管理が増える。ホストが増えたら移す |

## テーマ（2026-09-15 実装）

- 実体は `src/styles.css` の CSS 変数 `--fv-*`。`:root` = ライト（既定）、`[data-theme='dark']` = ダーク。切替はルート要素（いまは `.app`、パッケージ化後は `FlowViewer` のルート）に `data-theme` を付けるだけ
- キャンバス側（`theme.ts` / `lf.ts` / `nodes.ts`）は色の実値を持たず `'var(--fv-…)'` 文字列を SVG の `fill` / `stroke` 属性と inline style に渡す。SVG 属性でも `var()` は解決される（実機確認済み）
- 上位層の不透明度（`--fv-context-opacity`）もテーマごとの値。ライト 0.8 / ダーク 0.6（POC の 0.4 では上位層のラベルが 1.9:1 で読めず、配色監査を受けて 2026-09-15 に 0.6 + 文字 `#d7dbe3` = 5.2:1 に決めた）
- **別名の落とし穴**: シェル用の `--bg: var(--fv-bg)` 等は `:root` だけで宣言すると、その時点の（ライトの）値で確定して継承され、`data-theme` の要素で `--fv-*` を上書きしても別名が変わらない。そのため `:root, [data-theme]` の両方で再宣言している。パッケージ化で別名を消せば不要になる
- **HMR の落とし穴**: `anim.ts` は CSS を `<style>` に 1 度だけ注入する。`theme.ts` の値を変えても HMR では注入済み CSS が更新されないので、色・不透明度の確認は**ページを再読込**してから行う

## 触ると壊れるもの

`docs/inherited-findings.md` の表を正とする。特に: `src/lib/flow/` のアルゴリズム、`dynamic-group` の再登録、`selectedId` を描画 effect の依存に入れること、`.lf-node foreignObject { pointer-events: none }`、`FlowCanvas` の `key`。

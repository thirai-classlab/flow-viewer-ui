# FlowViewer のパッケージ化（lib / demo 分離と公開 API）

| 項目 | 値 |
|---|---|
| 起案日 | 2026-09-15 |
| approved | 2026-09-15 |
| 起案者 | Claude（`/hirai-lite:init` のヒアリング Q9〜Q25 の合意を記録） |

## 1. 解きたい問題

- `src/` は POC のコピーで、描画（`flow/` `logicflow/`）とシェル UI（`ui/` `App.tsx`）が同じ層に並んでいる。ホストに渡すのはキャンバスだけなので、publish の境界が無い
- 階層移動・選択・表示モードの状態は `App.tsx` が持ち、Toolbar が内部モジュールを直接呼んでいる。ホストが Toolbar を自前で作る手段が無い
- ダークテーマ固定で、ホストの配色に寄せられない

## 2. 目指す状態

- `npm run build` で `dist/` に `@thirai-classlab/flow-viewer`（ES / CJS / `.d.ts` / `style.css`）が出る
- demo の Toolbar が **公開 API だけ**（プロパティ・`ref` メソッド・コールバック）で動く
- `theme="light" | "dark"` で切り替わり、CSS 変数を上書きすれば配色が変わる

## 3. 検討した案

| 案 | 概要 | 利点 | 欠点 |
|---|---|---|---|
| A | 1 パッケージ内で `src/lib` / `src/demo` に分け、Vite lib モードで build | 境界が見える。package.json 1 つ | フォルダ移動の commit が要る |
| B | npm workspaces（`packages/flow-viewer` + `apps/demo`） | 依存の分離が厳密 | 一人開発には重い |
| C | 今の `src/` のまま `src/index.ts` を足す | 移動なし | demo 専用コードが publish に紛れやすい |

状態の持ち方: (a) controlled `path` / (b) 内部状態 + `ref` メソッド + 通知 / (c) 両対応

## 4. 採用案

**採用: 案 A + 状態は (b)**

A は境界が見えて軽い。B は規模に合わず、C は publish の事故が起きやすい。状態 (b) は圏外リンク・上位表示の整合をコンポーネント内で閉じられ、ホストは `onPathChange` でパンくずを描ける。(c) は今は要らない。

## 5. 変更範囲

| 対象 | 変更内容 |
|---|---|
| `src/flow/` `src/logicflow/` | `src/lib/` 配下へ移動（中身は触らない） |
| `src/ui/DocPanel.tsx` `markdown.ts` | `src/lib/doc-panel/` へ移動し読み取り専用に |
| `src/ui/{Toolbar,SidePanel,JsonPanel,InfoPanel,ErrorBoundary}.tsx` `App.tsx` | `src/demo/` へ移動。公開 API だけを使うよう書き換え |
| `src/flow/cases/` `sample-data*.ts` `generate.ts` `data-source.ts` | `src/demo/data/` へ移動 |
| `src/lib/index.ts`（新規） | `FlowViewer` / `FlowDoc` / `validateFlowDoc` / `FlowViewerHandle` を export |
| `src/lib/styles/`（新規） | ライト / ダークのトークン + コンポーネント CSS |
| `vite.config.ts` `package.json` `tsconfig.json` | lib モード、`exports` / `peerDependencies` / `files`、`private: true` を外す（publish 時） |

## 6. リスクと戻し方

| リスク | 起きたときの兆候 | 戻し方 |
|---|---|---|
| 移動で階層アルゴリズムを壊す | `npm test` が FAIL | 移動 commit を revert。アルゴリズムは触らない前提なので diff は import path だけのはず |
| `FlowCanvas` の `key` 再生成が demo のパネル開閉で効かなくなる | パネル開閉で fit が崩れる | `inherited-findings.md` の表に従い key を見直す |
| `marked` / `dompurify` の同梱でバンドルが重い | `dist/` のサイズ | DocPanel を別エントリに分ける（案 C 相当。Q18 の再判断） |

不可逆な操作: `npm publish`（版は取り消せない）。台帳 #12 で承認を取ってから行う。

## 7. 完了条件

- `npm run build` が exit 0 で `dist/` に `index.js` `index.cjs` `index.d.ts` `style.css` がある
- `grep -r "lib/logicflow\|lib/flow" src/demo` が `src/lib/index` 以外を返さない（demo が内部モジュールを直接 import していない）
- `npm run dev` で demo の Toolbar から 3 モード切替・潜る・戻る・選択・テーマ切替ができる

## 8. タスク分解

| タスク | 完了条件 |
|---|---|
| #3 lib / demo 分離と lib ビルド | 上の 1 行目 |
| #4 公開 API（プロパティ / ref / コールバック）と DocPanel 同梱 | 上の 2・3 行目 |
| #5 テーマ基盤（ライト既定 + ダーク、トークン） | `theme` 切替のスクショが `docs/after/` にある |

## 9. 承認履歴

| 日付 | 内容 | 承認者 |
|---|---|---|
| 2026-09-15 | `/hirai-lite:init` ヒアリングの要約を承認（Q9 npm / Q10 キャンバスのみ / Q17 ref メソッド / Q18 DocPanel 同梱 / Q20 export / Q22 CSS 別 / Q23 案 A） | takuma hirai |

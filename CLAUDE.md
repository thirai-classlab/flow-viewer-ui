# CLAUDE.md

## プロジェクト概要

`flow-viewer-ui` — 業務フローの**構造定義（JSON）と描画**を React コンポーネントとして提供する npm パッケージ `@thirai-classlab/flow-viewer` の開発リポジトリ。POC（`~/work/雑務/flow-viewer/`、凍結）を引き継ぎ、見た目と触り方を最適化してパッケージ化する。

- 本番: なし（別プロダクト（React、リポジトリ未定）に npm 経由で組み込まれる）
- リポジトリの責務: 持つ = `FlowDoc` 型と検証 / 階層アルゴリズム / キャンバス描画（ノード・エッジ・階層移動）/ 手順書パネル（読み取り専用）/ ライト・ダークのテーマトークン。持たない = Toolbar・パンくず・設定 UI（ホスト側）/ 印刷・書き出し / 編集機能 / 実データの読み込み機能
- 主役の利用者: 業務設計者・管理者の全体把握 > 説明資料用途 > 担当者の手順確認

## Tech Stack

- 言語 / フレームワーク: TypeScript / React 19（`peerDependencies`）
- 描画エンジン: LogicFlow 2.x（`@logicflow/core` `@logicflow/extension`。同梱依存）
- ビルド: Vite 6（lib モードで ES/CJS + `style.css` + `.d.ts` を出す。demo は同じ Vite の dev サーバ）
- ランタイム: Node 22+
- テスト / lint: vitest / eslint（typescript-eslint recommended）— 未導入。台帳 #2 で入れる
- 配布: npm レジストリに手動 publish（0.x）。GitHub `thirai-classlab/flow-viewer-ui`（public）
- 詳細: `docs/architecture.md`

## Commands

```bash
npm run dev          # demo アプリ http://127.0.0.1:5201（POC の 5200 と並べて見比べる）
npm run typecheck    # tsc --noEmit
npm run build        # tsc --noEmit && vite build
npm run preview      # ビルド結果の確認
npm test             # vitest（台帳 #2 で追加）
npm run lint         # eslint（台帳 #2 で追加）
```

## Rules index

T0 は毎セッション常時ロード（合計 6,000 tokens で警告 / 10,000 tokens が上限）。T1 は `paths:` に該当するファイルを触った時のみロードされる。

| 層 | ファイル | ロード条件 | 内容 |
|---|---|---|---|
| T0 | `CLAUDE.md`（本ファイル） | 常時 | プロジェクト固有情報 + rules index |
| T0 | `.claude/rules/_meta.md` | 常時 | ルール追加のルール 9 条 / 層定義 / 記述テンプレート |
| T0 | `.claude/rules/core.md` | 常時 | 全作業に例外なく効く行動規範 |
| T1 | `.claude/rules/tasks.md` | `docs/{tasks,draft}/**` + `.claude/{tasks,draft}/**` | タスク台帳と draft 承認の運用 |
| T1 | `.claude/rules/code.md` | `src/**`, `tests/**` | 実装とレビューの運用 |
| T1 | `.claude/rules/ops.md` | `.github/**`, `infra/**`, `*.tf` | CI / インフラの運用 |
| T2 | `docs/rules-reference/**` | 明示 Read のみ | 背景・事故記録・詳細手順 |
| T3 | `.claude/rules-archive/**` | ロードしない | 失効ルールの履歴 |

`.claude/rules/` の中身は プラグイン `hirai-lite` の `/init` が配置する。ルールの追加は `.claude/rules/_meta.md` のパイプライン（`/add-rule`）を通す。`@import` は使わない。

## Documents index

| ファイル | 内容 |
|---|---|
| `docs/overview.md` | ゴール / 背景 / スコープ（作らないもの）/ 体制 / ドメイン用語 / 関連リポジトリ |
| `docs/requirements.md` | 要件（機能・非機能） |
| `docs/architecture.md` | 構成（lib / demo）/ 公開 API / データの持ち方 / 技術判断とその理由 |
| `docs/ui-baseline.md` | 引き継ぎ時点の UI 棚卸し（before）。改善候補メモ |
| `docs/inherited-findings.md` | POC の知見。触ると壊れるもの / 数値的根拠 / 表示モデルの設計判断 |
| `docs/baseline/` | 引き継ぎ時点のスクリーンショット |
| `docs/tasks/list.md` | やること一覧。**いまどこまで進んでいるかもここで分かる**（進捗表は別に作らない） |
| `docs/tasks/parking-lot.md` | 保留にしたこと（作らないと決めた機能とその再開条件） |
| `docs/draft/` | 設計メモ（承認後に task 化） |
| `docs/rules-reference/` | 背景・事故記録・承認の型（必要なとき読む） |
| `src/logicflow/NOTES.md` | LogicFlow の地雷と回避策（POC の実装ノート） |

`.claude/rules/` のルールは、この表に書かなくても自動で読み込まれる（frontmatter 無し = 常時 / `paths:` 付き = 該当ファイルを触った時）。この表は所在を把握するためのもの。

## mode（進め方）

`.claude/mode.yml` の `mode:` で決まる。`normal`（確認あり）/ `loop`（自動で進む）。切替は `/hirai-lite:config`。詳細は `.claude/rules/core.md` の該当条。

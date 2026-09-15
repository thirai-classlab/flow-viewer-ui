# タスク台帳

status は 未着手 / 進行中 / 完了 の 3 種。

| # | status | タスク | 概要 | 依存先 | 詳細 |
|---|--------|-------|------|-------|------|
| 1 | 未着手 | 初回 commit と public リポジトリ作成 | 現状（POC コピー + docs + ハーネス設定）を 1 commit。`gh repo create thirai-classlab/flow-viewer-ui --public`（承認要）→ push | — | 完了条件: `git log --oneline` に 1 件、`git remote -v` に origin、GitHub 上で閲覧できる |
| 2 | 未着手 | 品質ゲート（vitest + eslint） | `tests/` に `src/flow` の 32 ケース × 全ドリル経路の回帰（例外 0・ノード欠落 0）。eslint は typescript-eslint recommended。`npm test` / `npm run lint` を追加 | 1 | 完了条件: `npm run typecheck && npm run build && npm test && npm run lint` が exit 0 |
| 3 | 未着手 | lib / demo 分離と lib ビルド | `src/lib/`（publish 対象）/ `src/demo/` に移動。Vite lib モードで ES / CJS / `.d.ts` / `style.css` | 2 | 完了条件: [draft/flow-viewer-package.md](../draft/flow-viewer-package.md) §7 の 1 行目 |
| 4 | 未着手 | FlowViewer の公開 API と DocPanel 同梱 | mode / 設定 / theme はプロパティ、`ref` に `goUp()` / `drillInto(id)`、`onPathChange` / `onSelect`。`validateFlowDoc()`（入力: ノード 0 の doc は drilldown が `use-drill-effect.ts:232` で throw するので、検証で先に弾く）。DocPanel 読み取り専用。demo は公開 API だけで動く | 3 | 完了条件: 同 §7 の 2・3 行目 |
| 5 | 完了 | テーマ基盤（ライト既定 + ダーク） | CSS 変数トークン `--fv-*`、`data-theme` 切替（`theme` プロパティ化は #4）。2026-09-15 完了: 32 ケース × 2 テーマ = 64 枚で破綻 0・JS エラー 0、レビュー 2 巡で収束（未対応: LOW 1 件 = warn チップ背景を琥珀に揃えた意図的変更） | 3 | 完了条件: light / dark の 32 ケース目視、スクショが `docs/after/` にある → 済 |
| 6 | 未着手 | 視覚言語の最適化（U1） | group / task の判別性、exception / loopback の強調、線上ラベルの可読性。配色監査（2026-09-15）の入力: exception 赤と loopback 琥珀は色覚多様性下で近づくので線種以外の冗長化（矢尻・端点）を検討 / loopback 線と decision 枠が同系の琥珀で溶ける / 線上ラベル「不備あり」が枠に重なって欠ける / ライトの group 枠のアクセント青が強い / 📄 マークが絵文字依存 | 5 | 完了条件: 32 ケース目視、before / after スクショ、`npm test` green |
| 7 | 未着手 | キャンバス内の情報の出し方（U2） | ヒント行と hint-bubble の二重解消、「▸ 中を見る」バッジ、ラベル | 6 | 完了条件: 同上 |
| 8 | 未着手 | 空間の使い方（U3） | DocPanel がフローを隠さない配置、トップ階層の縦余白 | 6 | 完了条件: 同上。`FlowCanvas` の `key` を見直したことを記録 |
| 9 | 未着手 | 操作の発見性（U4） | キャンバス上で「戻る」手段（`blank:dbclick` 無しの制約下） | 6 | 完了条件: 同上 |
| 10 | 未着手 | レスポンシブ（U5） | ホストの幅に追従 | 8 | 完了条件: 幅 800 / 1280 / 1920 で 32 ケース目視 |
| 11 | 未着手 | 匿名化実データの同梱 | ユーザー提供の実データ 1〜2 本を匿名化して `src/demo/data/` に `real:<id>` として追加 | 4 | 完了条件: `validateFlowDoc()` を通り、demo のデータ選択に出る。匿名化前は `*.local` のみ |
| 12 | 未着手 | npm publish 0.1.0 | `npm login` はユーザー（`! npm login`）。publish 前に承認 | 4, 5, 6 | 完了条件: `npm view @thirai-classlab/flow-viewer version` が `0.1.0` |

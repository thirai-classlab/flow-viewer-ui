# 保留タスク

| # | 状態 | タスク | 保留理由 | 再開条件 | 元の設計 |
|---|------|-------|---------|---------|---------|
| P1 | 保留 | UI からフロー構造を変える編集機能 | 機能追加に当たる（ヒアリング Q3） | ホストから「JSON 直接編集では足りない」と要望が出たとき | — |
| P2 | 保留 | ファイル / URL からの JSON 読み込み | 読み込みはホストの責務（Q4） | ホスト無しで単体配布する用途が出たとき | — |
| P3 | 保留 | 印刷 CSS / PNG・SVG・PDF 書き出し | 今回は何もしないと決めた（Q12） | 説明資料用途（利用者 2 位）で具体的な要望が出たとき | — |
| P4 | 保留 | DocPanel の `editable` + `onDocChange` | パッケージの DocPanel は読み取り専用（Q24） | ホストから手順書編集の要望が出たとき | [draft/flow-viewer-package.md](../draft/flow-viewer-package.md) |
| P5 | 保留 | 既定の表示モードを nested / split に変える | POC の drilldown + 上位表示を尊重（Q14） | 匿名化実データ（#11）で 3 モードを見比べてから | — |
| P6 | 保留 | ライセンスの決定（`LICENSE` の設置） | ヒアリングで未回答。`"license": "UNLICENSED"` にしておく | ユーザーが決めたとき | — |
| P7 | 保留 | GitHub Actions によるタグ起点の npm publish | 手動 publish で足りる（Q25） | ホストが 2 つ以上になる、または版固定の要求が出たとき | — |
| P8 | 保留 | ノード 0 件のフローを「空状態」として出す | いまは `use-drill-effect.ts` が throw して赤いエラー文字列が出る（`degenerate-empty`）。POC 由来の既存挙動 | #4 の `validateFlowDoc()` を作るとき、境界で弾くか空状態を描くかを決める | — |
| P9 | 保留 | ノード本文が箱からはみ出す（長大ラベル） | `NODE_SIZE` 固定 + LogicFlow の foreignObject が overflow visible のため。サイズ定数は据え置きの制約がある | 文字側で省略（line-clamp）かツールチップ化を決めたとき | — |


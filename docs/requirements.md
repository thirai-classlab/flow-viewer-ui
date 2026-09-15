# 要件

作成: 2026-09-15

## 機能要件

### パッケージ `@thirai-classlab/flow-viewer`

| # | 要件 | 根拠 |
|---|---|---|
| F1 | `FlowViewer` は `FlowDoc` JSON を受け取り、キャンバスにノード・エッジ・階層を描く | ゴール |
| F2 | 表示モード `drilldown` / `split` / `nested` を **プロパティ**で切り替えられる。3 モードすべて残す。既定は `drilldown` | Q14 |
| F3 | モードごとの設定（方向、上位を表示、`nestPath`、抽象度、アニメ ON/OFF）もプロパティ | Q14 |
| F4 | 階層移動（潜る / 戻る）はコンポーネントが内部状態として持ち、`ref` のメソッド `goUp()` / `drillInto(id)` で外から動かせる | Q17 |
| F5 | 現在地の変化を `onPathChange(path)`、選択の変化を `onSelect(node)` でホストに通知する（パンくずはホストが描く） | Q10, Q17 |
| F6 | 手順書パネル（DocPanel）を同梱し、選択ノードの Markdown を読み取り専用で表示する | Q18, Q24 |
| F7 | `theme` プロパティで `light`（既定）/ `dark` を切り替えられる。配色は CSS 変数トークンで、ホストが上書きできる | Q11 |
| F8 | `FlowDoc` 型と `validateFlowDoc()` を export し、不正な JSON は例外でなく検証結果として返す | Q20 |
| F9 | `style.css` を別ファイルで出力し、ホストが 1 行 import する | Q22 |
| F10 | 単一クリック = 選択、ダブルクリック = 潜る。group の「中を見る」バッジは単一クリックで潜る | `inherited-findings.md` |

### 見た目の最適化（優先順。対象はキャンバスと DocPanel のみ）

| # | 観点 | 具体 |
|---|---|---|
| U1 | 視覚言語 | group と task の判別性（線種以外の差）、exception / loopback の強調、線上ラベルの可読性 |
| U2 | キャンバス内の情報の出し方 | 左上ヒント行と hint-bubble の二重解消、「▸ 中を見る」バッジ、ラベル |
| U3 | 空間の使い方 | DocPanel のオーバーレイがフローを隠さない配置、トップ階層の縦余白 |
| U4 | 操作の発見性 | キャンバス上で「戻る」手段（`blank:dbclick` が無い制約下で） |
| U5 | レスポンシブ | ホストの幅に追従する（`FlowCanvas` の `key` 再生成に注意） |

### デモアプリ（`src/demo/`）

| # | 要件 |
|---|---|
| D1 | パッケージの公開 API **だけ**を使って Toolbar / パンくず / 設定を組み、動作確認できる |
| D2 | 32 テストケース（構造 / 実務 / 規模 / 退化）と自動生成（1〜10 階層）、手書きサンプル、匿名化実データを選べる |
| D3 | 編集モード（JSON パネルからの真実源編集）は壊さない。手順書の直接編集は落としてよい |
| D4 | デモ自体の見た目は最適化しない |

## 非機能要件

| # | 要件 | 検証 |
|---|---|---|
| N1 | `src/lib/flow/`（階層アルゴリズム）は変更しない。32 ケース × 全ドリル経路で例外 0・ノード欠落 0 | `npm test` |
| N2 | 完了条件は `npm run typecheck && npm run build && npm test && npm run lint` が exit 0 | `core.md` 完了の定義 |
| N3 | 見た目の回帰は 32 ケースの目視。節目で before（`docs/baseline/`）/ after（`docs/after/`）のスクショを残す | Q6 |
| N4 | ノードラベルは 13px を下限に 11px まで。`FIT` / `NODE_SIZE` / `LAYOUT_GAP` を変えるなら計測し直す | `inherited-findings.md` |
| N5 | 規模ケース（150〜900 ノード）でも描画が破綻しない（速度目標は置かない） | 目視 |
| N6 | React は `peerDependencies`、LogicFlow は `dependencies`。`marked` / `dompurify` は DocPanel 同梱のため `dependencies` | package.json |
| N7 | public リポジトリに置くデータは匿名化済みのものだけ | レビュー |

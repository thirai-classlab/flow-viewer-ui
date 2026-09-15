# 箱をまたぐ線の配線（dagre compound）— #16

| 項目 | 値 |
|---|---|
| 起案日 | 2026-09-16 |
| approved | 2026-09-16 |
| 起案者 | Claude（ユーザー指摘「線・文字・エッジが重なる」と #13 の openIssue） |

## 1. 解きたい問題

- #13 は「同じ箱の直下どうし」の線だけ dagre の経路を使い、**箱をまたぐ線**（nested の中身どうし / split 左ペインの入れ子に刺さる線 / コンテキスト層への crossing）は LogicFlow の自動経路（障害物回避なし、ラベルは最長セグメント中点）に落としている
- そのため split 左ペイン（審査部門を展開）で NG の線が書類審査の箱の縁を這い、「不備あり」のラベルが重なる（ユーザー提供スクショ 2026-09-16）
- 原因は `arrange()` の再帰構造: `measure()` がコンテナごとに独立に dagre を回し、外側は中身を 1 つの箱として扱うため、箱をまたぐ線に「通る隙間」を確保できない

## 2. 目指す状態

- nested / split の入れ子表示で、全ての線が dagre の経路（ダミー頂点でランク間に確保した隙間）を通り、ノードを貫通せず、ラベルは線上に載る
- drilldown（levelOnly = 1 階層だけ）は現行のまま（箱をまたぐ線が無い）

## 3. 検証済みの事実（scratchpad/compound-probe.mjs、dagre 3.1.1）

- `new graphlib.Graph({ compound: true, multigraph: true })` + `setParent(child, cluster)` で、cluster の bbox（x, y, width, height）と、cluster をまたぐ辺の points・ラベル座標が返る。例: 受付(a→b) / 審査(c→d) の 2 cluster で b→d「重複」は y=108 のトラック、d→a「差し戻し」は y=52 の別トラックに載った
- **`clusterLabelPos` / `paddingTop` は 3.1.1 に無い**（dist を grep: 0 件）。cluster の余白は nodesep / ranksep の半分で固定
- 既存のグループのタイトル帯 GROUP_HEADER = 36px（`src/flow/theme.ts`）と GROUP_PAD = 20 は dagre では確保できない

## 4. 採用案

**案 A: compound 1 回 + 後処理でタイトル帯を確保**

1. nested / split-nest の arrange を「1 つの compound グラフ」に変える。葉ノードは NODE_SIZE、畳んだグループは COLLAPSED_SIZE、展開グループは cluster（`setParent`）。rankdir / nodesep / ranksep は現行どおり
2. layout 後、cluster の bbox を子の bbox + GROUP_PAD から求め直し、**上辺に GROUP_HEADER を足す**。交差軸で cluster の上辺より下にある全要素（ノード・cluster・辺の点）を GROUP_HEADER だけ下へずらす（外側の cluster から順に。空間を足すだけなので重なりは増えない）
3. 全辺に pointsList / ラベル座標を渡す（#13 の orthogonalRoute をそのまま使う。cluster 境界の交点は捨て、両端のノードの側面から出す）
4. `measure()` の再帰と `nestExpanded` の箱詰めは compound に置き換える。split 左ペインの `fixedSize` / `SPLIT.nestGap` / DOWN 固定は維持

案 B（不採用）: 現行の再帰を残し、箱をまたぐ線だけ自前の障害物回避ルータ（A* / libavoid 相当）を書く — 実装が重く、ラベル位置も自前になる

## 5. 変更範囲

| 対象 | 変更内容 |
|---|---|
| `src/logicflow/layout.ts` | `arrangeCompound(ids, ctx)`（cluster 構築 / layout / bbox 再計算 + ヘッダ帯のずらし / 配線抽出）。`measure()` は drilldown（levelOnly）用に残す |
| `src/logicflow/split.ts` `use-drill-effect.ts` | nested と split-nest の呼び出しを arrangeCompound に |
| `src/logicflow/nodes.ts` | 箱をまたぐ辺の fallback（自動経路）を撤去 |
| `tests/layout.sweep.test.ts` | nested 全展開・split 入れ子で「線がノードを貫通 0 / ラベル同士の重なり 0」を追加 |

## 6. リスクと戻し方

| リスク | 兆候 | 戻し方 |
|---|---|---|
| dynamic-group の折りたたみ（nested）と cluster 座標の食い違い | 畳んだ後に子が箱の外に出る | 畳んだグループは cluster でなく 1 ノード（COLLAPSED_SIZE）として渡しているか確認 |
| split 左ペインの縮尺が落ちる（compound は再帰より広がりやすい） | 5 階層で 0.78 を割る | nestGap を再計測、駄目なら左ペインだけ再帰を残す |
| ヘッダ帯のずらしで辺が斜めになる | 直交チェックが FAIL | 点のずらしを「上辺より下の点は全部」に統一（部分ずらしをしない） |

不可逆な操作: なし。

## 7. 完了条件

- 848 sweep + nested 全展開（sample3 / sample5 × 2 方向）+ split 入れ子で 例外 0 / 重なり 0 / 貫通 0 / ラベル重なり 0
- sample3 の split（審査部門 › 与信審査）と nested のスクショで NG・不備あり・重複の線が箱の縁を這わない

## 8. 承認履歴

| 日付 | 内容 | 承認者 |
|---|---|---|
| 2026-09-16 | 案 A（compound 1 回 + 後処理でタイトル帯を確保）を承認 | takuma hirai |


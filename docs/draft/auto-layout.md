# 自動レイアウト（dagre 化と行折り返しの廃止）

| 項目 | 値 |
|---|---|
| 起案日 | 2026-09-15 |
| approved | 2026-09-15 |
| 起案者 | Claude（ユーザー指摘「レイアウトが死んでいる。自動で並ぶように」を受けた調査 wf_c255bb9a の結果） |

## 1. 解きたい問題

- `src/logicflow/layout.ts` の `arrange()` は自前実装で、ランク = 最長経路、同ランク内の並び替え（交差最小化）無し、`ctx.fit` があると行折り返しを必ず試みる。縮尺上限 `FIT.maxScale = 1.4` を考慮せず比較するため 1920 幅でも 3 本/行に折る（32 ケース × 全ドリル経路 × 2 方向 = 848 通りのうち 84.4% が折り返し、DAG 上は前進なのに画面上で後退する辺 1,310 本）
- 線は LogicFlow の自動経路（障害物回避なし）で、ラベルは「最長セグメントの中点」。`edgeText.textWidth 90 > LAYOUT_GAP.rank 64` のため隣接ノード間のラベル（「不備あり」「NG」）は必ず枠に重なる。逆走辺（loopback）は順路と同じ隙間・同じアンカーに重なる

## 2. 目指す状態

- drilldown / split / nested のどの階層でも、フローが左→右（または上→下）の一直線に並び、画面上で後退する辺が 0 本（折り返し無し）
- loopback / exception の線が順路と別トラックを通り、ラベルが枠に重ならない
- 848 通りのヘッドレス回帰が `npm test` で走り、例外 0・NaN 0・重なり 0 を assert する

## 3. 検討した案

| 案 | 概要 | 利点 | 欠点 |
|---|---|---|---|
| A | 自前 arrange を改良（折り返し抑制 + バリセンタ + 自前トラック） | 依存ゼロ | A3（トラック・ラベル位置）は dagre の再実装 150〜250 行 |
| B | `@dagrejs/dagre` 3.1.1 で arrange の中身を置換、コンテナ箱詰めは現行 measure() を残す | MIT / 48KB / 同期 API / 848 階層で例外 0・最悪 80ms 実測。交差最小化・トラック・ラベル位置が一度に手に入る | 依存 +1、tween 中に pointsList が消えるので完了時 `updatePath()` が要る |
| C | elkjs 0.12.0 | 品質は最高 | 1.6MB / 非同期 / EPL-2.0 or GPL |
| D | `@logicflow/layout` 2.1.5 | 配線は小さい | 描画後に renderRawData で描き直す方式で dynamic-group と衝突、旧 dagre 0.8 依存 |

折り返し: X = drilldown では廃止しズーム / パンに任せる ／ Y = 12px を割るときだけ最終手段として折る

## 4. 採用案

**採用: 案 B + 折り返し X（廃止）**

B は品質・サイズ・同期性の釣り合いが最も良く、`src/flow/` と measure() の箱詰め・`fit` を最外だけに効かせる構造を無傷で残せる。X は「自動で並ぶ」要望に沿い、Z 字の読み順崩れを根本から消す。POC の面積比 52.2% の実績は捨てる（1440 幅で中央値縮尺 1.0、1280×593 では約半数の階層が実効 12px 未満 → ズームで補う）。A は A1 相当の「縮尺を上限で頭打ちしてから比較」だけを B と併用しない（折り返し自体を廃止するため不要）。C はサイズとライセンス、D は dynamic-group との衝突で落とす。

## 5. 変更範囲

| 対象 | 変更内容 |
|---|---|
| `package.json` | `@dagrejs/dagre` ^3.1.1 を dependencies に追加 |
| `src/logicflow/layout.ts` | `arrange()` の `computeRanks → lanes → 行配置`（:285-335）を dagre.layout に差し替え。`rankdir` は direction、`nodesep / ranksep` は gap から。`Arranged` に `edgePoints: Map<edgeKey, {x,y}[]>` と `labelAt: Map<edgeKey, {x,y}>` を追加。`chooseRowSize / measureRows` と `LayoutCtx.fit` の折り返し経路は削除（`fit` はキャンバス実寸として fitViewport のために残す） |
| `src/logicflow/drilldown.ts` `nodes.ts` `split.ts` | エッジ生成（toLevelEdge / toLfEdge / toViewEdge / splitEdge）で `pointsList` と `text: {value, x, y}` を渡す |
| `src/logicflow/anim.ts` | `tweenLayout` 完了時に各エッジへ `updatePath(pointsList)` を再適用 |
| `tests/layout.sweep.test.ts`（新規） | 32 ケース × 全ドリル経路 × RIGHT/DOWN の 848 通りを `arrange()` に通し、例外 0 / NaN 0 / 箱の重なり 0 / 画面上で後退する辺 0 を assert。面積比・縮尺はレポート出力のみ |
| `src/logicflow/NOTES.md` `docs/inherited-findings.md` | 「@logicflow/layout は npm に無い」の訂正、面積比 52.2% の根拠が失効した旨、dagre 採用理由 |

## 6. リスクと戻し方

| リスク | 起きたときの兆候 | 戻し方 |
|---|---|---|
| tween 後に自前経路が消える | 階層遷移の直後だけ線が枠を貫通する | `updatePath()` の再適用漏れ。anim.ts の完了コールバックを確認 |
| split 左ペインの縮尺が崩れる | 5 階層で 0.78 を割る | `SPLIT.nestGap` を再計測して調整（NOTES.md:143-149 の実測をやり直す） |
| 長い鎖が 1280 幅で読めない | 実効 12px 未満 | ズーム / パン。改善しないなら案 Y を再検討（要判断） |
| 依存追加 | — | `git revert` 1 回で layout.ts ごと戻る |

不可逆な操作: なし。

## 7. 完了条件

- `npm test` で `tests/layout.sweep.test.ts` が green（848 通り: 例外 0 / NaN 0 / 重なり 0 / 後退辺 0）
- `npm run typecheck && npm run build` が exit 0
- サンプル 3 階層のトップ（`docs/after/` の before と同条件）で、7 ノードが左→右の一直線に並び、「不備あり」「NG」「重複」「不通」のラベルが枠に重ならないスクショが `docs/after/` にある
- 32 ケース × 2 テーマのスクショ取得で JS エラー 0（#5 と同じ手順）

## 8. タスク分解

| タスク | 完了条件 |
|---|---|
| #13 自動レイアウト（dagre 化 + 折り返し廃止 + sweep テスト） | 上の 4 行すべて |

## 9. 承認履歴

| 日付 | 内容 | 承認者 |
|---|---|---|
| 2026-09-15 | 案 B + 折り返し X を承認（AskUserQuestion で「廃止してズーム/パンに任せる」を選択） | takuma hirai |

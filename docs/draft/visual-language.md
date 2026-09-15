# 視覚言語の整理とアイコン（#6）

| 項目 | 値 |
|---|---|
| 起案日 | 2026-09-16 |
| approved | 2026-09-15（方向のみ。AskUserQuestion「実線にしてバッジとカーソルで示す」を選択。具体値は本メモ） |
| 起案者 | Claude（調査 wf_c255bb9a「icons-design」と配色監査の結果） |

## 1. 解きたい問題

- ユーザー指摘「デザインがチープ。アイコンですかね?」。記号は全て文字（📄 ▸ ▾ ⚙ ☾ ☀ ✕ ⋯ ↑ › ★ ⚡）で、絵文字はテーマの色を無視する
- チープに見える主因は記号より「太い青の破線（2.5px）+ 二重ピルのバッジ + ホバー / 選択の glow + 直角のエッジ + 16px のドットグリッド」の重なり
- BPMN / Miro / FigJam では破線は「非表示・ドロップ領域」に予約され、サブプロセスは実線角丸 + 下辺のマーカー。現状の「破線 = 潜れる」は業務フロー読者に逆に読まれうる
- 配色監査: exception（赤）と loopback（琥珀）は色覚多様性下で近づき、線種だけが識別子。loopback 線と decision 枠が同系の琥珀で溶ける

## 2. 目指す状態

- 全ての記号が Lucide の inline SVG（`src/icons/lucide.ts` 同梱、依存追加なし）で、テーマの文字色に追従する
- グループは実線角丸 + 下辺の「中を見る N」バッジ + カーソル pointer + ホバーで枠がアクセント色。glow は無い
- 例外 / 差し戻しの線は色 + 線種に加えて矢尻の形で区別できる
- サイズ定数（NODE_SIZE / BADGE_SIZE / NODE_FONT / LAYOUT_GAP）は据え置き。848 通り sweep は green のまま

## 3. 具体値

| 対象 | 現状 | 変更 |
|---|---|---|
| グループ枠（drilldown / split の潜れる箱） | accent 破線 `7 4` 2.5px、radius 10 | `--fv-node-group-stroke` 実線 1.5px、radius 10。ホバー: stroke `--fv-accent` 2px（glow 無し）。選択: `--fv-select-stroke` 2.5px（glow 無し） |
| バッジ「▸ 中を見る N」 | 外枠 1.2px + 内側の件数ピル（accent 塗り） | 枠線なしの淡いピル（fill `--fv-badge-fill`、text `--fv-badge-text`）+ chevronRight 12px + 件数は同じピル内に区切り線で。ホバー: fill `--fv-accent` + text `--fv-accent-contrast` |
| 📄 マーク | circle r=11 + 絵文字 | fileText 14px、stroke `--fv-doc-stroke`、背景なし（BPMN のタスクマーカー流） |
| エッジ | 直角、normal 1.5 / exception・loopback 1.8、矢尻は全部 solid | radius 8。矢尻: normal = solid、loopback = hollow（差し戻し）、exception = solid + 始点に circle マーカー（BPMN の境界イベント流）。線幅・破線は据え置き |
| ドットグリッド | 16px、`--fv-grid` | 24px、色はそのまま |
| decision 枠 | `--fv-node-decision-stroke`（琥珀） | 据え置き。loopback 線の琥珀と溶ける件は矢尻の形（hollow）で補う |
| ツールバー | 文字記号のボタン | Icon 16px（moon / sun / settings2 / chevronDown / arrowUp / arrowRight / arrowDown / x / scan / maximize2 / minimize2）。高さは 1 段 40px を維持 |
| パンくず区切り › | 文字 | chevronRight 12px、`--fv-text-dim` |
| キャンバス上のチップ ⋯ ↑ | 文字 | ellipsis / arrowUp 12px |
| 影 | popover 0 10px 30px / dock -12px 0 28px / hint 0 6px 18px と不揃い | `--fv-shadow` で popover 0 8px 24px / dock -8px 0 24px / hint 0 4px 12px |
| split 左ペインの ★ ⚡ | ラベル文字列に前置（foreignObject の HTML） | 据え置き（SVG を入れられない）。#4 の API 設計で再検討 |
| nested の ± | LogicFlow が描く（#f4f5f6 固定） | dynamic-group は再登録しない。CSS の属性セレクタで色だけテーマに寄せる（効かなければ据え置き） |

## 4. 変更範囲

| 対象 | 変更内容 |
|---|---|
| `src/icons/lucide.ts` `src/icons/Icon.tsx` | 同梱データと React 部品（作成済み） |
| `src/logicflow/nodes.ts` | `iconShape(h, name, …)` で 📄 / ▸ を SVG に、グループ枠・バッジの描画、エッジの矢尻（`AppPolylineEdgeModel.getArrowStyle`） |
| `src/logicflow/anim.ts` | ホバー / 選択の CSS（glow 除去、枠色の遷移） |
| `src/logicflow/lf.ts` | グリッド 24px、edge の radius |
| `src/flow/theme.ts` | BADGE_COLOR / DOC_COLOR の意味の整理（値は styles.css） |
| `src/styles.css` | 影の統一、バッジ / ツールバーのアイコンボタン |
| `src/ui/Toolbar.tsx` `src/ui/DocPanel.tsx` `src/ui/SidePanel.tsx` `src/logicflow/index.tsx` `src/App.tsx` | 文字記号 → `<Icon>` |

## 5. リスクと戻し方

| リスク | 兆候 | 戻し方 |
|---|---|---|
| バッジのクリック判定が壊れる | 「中を見る」で潜れない | 新しい SVG を `.lfa-badge` の `<g>` の内側に置く（`use-drill-effect.ts` の closest('.lfa-badge') が前提） |
| 📄 が当たり判定を奪う | ノードのクリックが効かない | DOC_CLASS の `<g>` 内に置き `pointer-events: none` を効かせる |
| 矢尻の変更で split の marker id が衝突 | 片方のペインで矢尻が消える | sp-u- / sp-l- 接頭辞が start 側にも効くか実機で数える。駄目なら矢尻変更だけ戻す |
| 破線廃止で「潜れる」が分からない | ホバー前に区別できない | バッジ + cursor + ホバー枠色で担保。不足なら下辺に BPMN 流の [+] を足す |

不可逆な操作: なし。

## 6. 完了条件

- 記号・絵文字の描画箇所が 0（`grep -rn "📄\|▸\|▾\|⚙\|☾\|☀\|✕\|⋯" src --include='*.ts' --include='*.tsx'` がコメントと sample-data 以外で 0 件。★ ⚡ を除く）
- `npm run typecheck && npm run build && npm test` exit 0（848 sweep green）
- ライト / ダークで drilldown トップ・潜った階層・split・nested の before / after が `docs/after/2026-09-16_visual_*.png` にあり、バッジクリックで潜れる・📄 のノードが選択できる・矢尻の形で loopback / exception が見分けられる

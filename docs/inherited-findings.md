# POC から引き継ぐ知見

原典: `~/work/雑務/flow-viewer/src/logicflow/NOTES.md`（本プロジェクトにも `src/logicflow/NOTES.md` として同梱）と
`~/work/雑務/flow-visualization-oss-research/flow-visualization-oss-features.md`（0 章「実機検証」）。
ここには **UI を触るときに踏み抜きやすいもの**だけを抜粋する。全文は原典を読むこと。

## 触ってはいけない・触ると壊れるもの

| 項目 | 理由 | 出典 |
|---|---|---|
| `src/flow/` の階層アルゴリズム（`collapse.ts` / `flatten.ts`） | 32 テストケース × 848 通りで破綻 0 件を実測済み。UI 最適化の対象外 | NOTES「UX 作り直し」 |
| `arrange()` の配線（`edgePoints` / `labelAt`）の座標系 | dagre の中心座標を箱の左上オフセットに直し、原点 0 に正規化してから返す。`emitArranged()` を通さずに `pointsList` へ写すと箱とずれる。位置トゥイーン後は `tweenLayout()` が `updatePath()` で配線を戻す（戻し忘れると階層遷移の直後だけ線が枠を貫通する） | NOTES「dagre 化で分かったこと」 |
| `@logicflow/layout` | npm に存在する（2.1.5）が、描画後に renderRawData で描き直す方式で dynamic-group と衝突する。POC の NOTES「存在しない」は誤りだった | `docs/draft/auto-layout.md` 案 D |
| `type: 'dynamic-group'` の再登録 | プラグイン側の実装ごと置き換わり、nested モードの折りたたみが壊れる。だから **nested のグループだけホバー演出が付けられない**（枠左上の ± が既存アフォーダンス） | NOTES「nested モードのグループだけはホバー演出を付けられない」 |
| `selectedId` を描画 effect の依存に入れる | 選ぶたびに LogicFlow が destroy → render され出現アニメが再生されて画面が跳ねる。選択枠は `data-nid` を使って DOM の class 付け替えで行う（独立 effect） | NOTES「選択枠は再描画せずに DOM の class で付け替える」 |
| `.lf-node foreignObject { pointer-events: none }` の削除 | LogicFlow はラベルを foreignObject の HTML で描き、これが図形の当たり判定を奪う。外すとバッジ（▸ 中を見る）のクリックが効かなくなる。`textEdit: false` 前提 | NOTES「ノードの装飾は getShape() の override で足せる」 |
| `FlowCanvas` の `key`（`narrow` / `wide`） | LogicFlow は幅の変化でレイアウトとフィットを計算し直さない。パネル開閉で幅が変わるときは key で作り直す必要がある。**パネルを増減する UI 変更をしたらここも見直す** | `App.tsx` のコメント |
| split の左ペインの向き | 左ペインは direction を無視して縦積み固定。横にすると幅 36〜52% で読めない | NOTES「split の左ペインは direction を無視して…」 |

## UI の数値的な根拠（変えるなら計測し直す）

| 定数 | 値 | 根拠 |
|---|---|---|
| `NODE_FONT.label` | 13px | 12px を切ると日本語が潰れる。下限 11 |
| `FIT.maxScale` | 1.4（本編）/ 1.0（split 左）/ 1.25（split 右） | 拡大上限は「ラベルの実効フォント」で決める。1.75 まで伸ばすと 2〜3 ノードの階層で枠・バッジが間延びした |
| `FIT.padding` | 56 | 旧 72 はキャンバスの 13% を余白で捨てていた |
| `NODE_SIZE` | task 212×78 / group 268×108 | 旧 176×56 / 200×64 は縮尺 0.55 で実効 6.6px に潰れた |
| `LAYOUT_GAP` | node 30 / rank 64 | split 左ペイン専用は node 14 / rank 22（間隔が縮尺を直接支配する）。#13 からは dagre の nodesep / ranksep にそのまま渡す |
| ツールバー高 | 閲覧 1 段 約 40px | キャンバスの縦をフローに使わせるのがツールバーの一番の仕事 |
| 面積比 | ~~平均 52.2%（旧 8.1%）~~ **失効（#13）** | ~~`arrange()` にキャンバス実寸を渡してランク列を折り返す。行数を増やすのは 6% 以上縮尺が上がるときだけ~~ 折り返しは #13 で廃止（Z 字の読み順崩れと後退辺 1,310 本の原因）。dagre で主軸 1 本に並べ、収まらないぶんはズーム / パン。1280x593 の実測は平均 15.3%、縮尺中央値 0.75（`npm test` が出す） |

## 表示モデルの設計判断（UI はこれを前提に組む）

- **drilldown（既定）**: 1 画面 1 階層。ドリルダウン型は潜るほど階層をまたぐリンクが圏外へ消える構造的欠陥があり、
  「上位を表示」（フォーカス+コンテキスト、3 バンド構成）で対処している。**OFF にできるが既定 ON が正しい**
- **split**: 左ペインは「最上位からの経路を入れ子で展開」（`nestPath`）。これにより 1〜10 階層で圏外リンク 0 本。
  省略は「トップは絶対残し、中間だけ飛ばす」。入れ子は 4 段で頭打ち
- **nested**: 全階層を一度に描く。LogicFlow の折りたたみは 1 階層限定なので入れ子の境界エッジは自前補修コードが描いている
- 操作の割り当て: **単一クリック = 選択（DocPanel）/ ダブルクリック = 潜る**。グループの「▼ 中を見る」バッジは単一クリックで潜る
- `blank:dbclick` イベントは LogicFlow に存在しない（背景ダブルクリックで「戻る」は素直には作れない）

## 検証のしかた

- 合成イベントでクリックを検証するには `pointerdown` → `pointerup` → `click` の順で、`detail` に 1 / 2 を入れて送る（`click` だけでは `startTime` が入らず無視される）
- 編集モード → データ選択で 32 テストケース（構造 / 実務 / 規模 / 退化）を切り替えられる。規模ケース（150〜900 ノード）は重い
- POC（5200）と本プロジェクト（5201）を同時起動して before / after を並べられる

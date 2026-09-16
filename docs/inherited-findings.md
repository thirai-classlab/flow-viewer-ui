# POC から引き継ぐ知見

原典: `~/work/雑務/flow-viewer/src/logicflow/NOTES.md`（本プロジェクトにも `src/logicflow/NOTES.md` として同梱）と
`~/work/雑務/flow-visualization-oss-research/flow-visualization-oss-features.md`（0 章「実機検証」）。
ここには **UI を触るときに踏み抜きやすいもの**だけを抜粋する。全文は原典を読むこと。

## 触ってはいけない・触ると壊れるもの

| 項目 | 理由 | 出典 |
|---|---|---|
| `src/flow/` の階層アルゴリズム（`collapse.ts` / `flatten.ts`） | 32 テストケース × 848 通りで破綻 0 件を実測済み。UI 最適化の対象外 | NOTES「UX 作り直し」 |
| `arrange()` の配線（`edgePoints` / `labelAt`）の座標系 | ELK の相対座標を箱の左上オフセットに直し、原点 0 に正規化してから返す。`emitArranged()` を通さずに `pointsList` へ写すと箱とずれる。位置トゥイーン後は `tweenLayout()` が `updatePath()` で配線を戻す（戻し忘れると階層遷移の直後だけ線が枠を貫通する） | NOTES「ELK 化で分かったこと（#19）」 |
| `arrange()` が `Promise` を返すこと（#19） | 描画 effect は「await を含む組み立て」→ 世代カウンタ（`genRef`）の照合 →「await を含まない描画」の 3 段。(3) の途中に await を足すと cleanup が割り込み、`prevViewportRef` / `prevLayoutRef` / `ghostRef` の書き込み順と `destroy()` の順序が壊れる | NOTES「非同期化: effect は…」 |
| ひし形（decision）の端点を bbox の枠線に置くこと | ELK は `elk.port.side` 付きポートの主軸座標を bbox へ強制スナップするので、頂点以外は図形の外に浮く（848 通りで 1,418 本中 432 本）。`snapDiamondEndpoints()` が 4 頂点の外周まで伸ばして直している。`DIAMOND_MAX_INSET = 12` を外すと折れ線が逆走する | NOTES「ひし形の端点は…」 |
| split 左ペインに ELK のラベル場所を**無条件で**空けさせること（#19） | 空けると縦に伸びて縮尺が落ちる（無条件だと 1,736 地点中 0.85 未満が 736 → 1,144）。**縮尺が `FIT.maxScaleUpper = 1.0` で頭打ちの地点だけ渡す**（`buildSplitNestGraph` の `fit` 引数）。この条件なら 0.85 未満は 736 のまま増えない | NOTES「ラベルは ELK に場所を…」 |
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
| `FIT.minReadable` | 0.85 | 縮尺の下限（#15）。13px × 0.85 ≒ 11px = 日本語の下限。割るときは 0.85 で止めて左 / 上に寄せ、はみ出しはパン。split 左ペインと「全体を表示」は下限なし |
| `FIT.padding` | 56 | 旧 72 はキャンバスの 13% を余白で捨てていた |
| `NODE_SIZE` | task 212×78 / group 268×108 | 旧 176×56 / 200×64 は縮尺 0.55 で実効 6.6px に潰れた |
| `LAYOUT_GAP` | node 30 / rank 64 | split 左ペイン専用（`SPLIT.nestGap`）は **node 8 / rank 10**（#19 で 14 / 22 から詰めた。間隔が縮尺を直接支配する）。#19 からは ELK の `elk.spacing.nodeNode` / `elk.layered.spacing.nodeNodeBetweenLayers` にそのまま渡す。辺まわりは `layout-elk.ts` の `EDGE_SPACING`。層と直交する向き（`edgeNode` / `edgeEdge`）と層をまたぐ向き（`rankNode` / `rankEdge`）を分けてあり、入れ子は 8/3 と 4/3。**入れ子の `edgeNode` を 4 → 8 にすると線がノードの縁を這う事故が 5,341 → 1,706 に減り、縮尺は 0.85 未満 736 地点のまま変わらない**（`rankNode` も 8 にすると 759 地点に増えるので据え置き） |
| ツールバー高 | 閲覧 1 段 約 40px | キャンバスの縦をフローに使わせるのがツールバーの一番の仕事 |
| 面積比 | ~~平均 52.2%（旧 8.1%）~~ **失効（#13）** | ~~`arrange()` にキャンバス実寸を渡してランク列を折り返す。行数を増やすのは 6% 以上縮尺が上がるときだけ~~ 折り返しは #13 で廃止（Z 字の読み順崩れと後退辺 1,310 本の原因）。主軸 1 本に並べ、収まらないぶんはズーム / パン。1280x593 の実測は平均 15.8%、縮尺中央値 0.66（#19 の ELK 化後。dagre 時代は 15.3% / 0.75。`npm test` が出す） |

## 表示モデルの設計判断（UI はこれを前提に組む）

- **drilldown（既定）**: 1 画面 1 階層。ドリルダウン型は潜るほど階層をまたぐリンクが圏外へ消える構造的欠陥があり、
  「上位を表示」（フォーカス+コンテキスト、3 バンド構成）で対処している。**OFF にできるが既定 ON が正しい**
- **split**: 左ペインは「最上位からの経路を入れ子で展開」（`nestPath`）。これにより 1〜10 階層で圏外リンク 0 本。
  省略は「トップは絶対残し、中間だけ飛ばす」。入れ子は 4 段で頭打ち
- **nested**: 全階層を一度に描く。LogicFlow の折りたたみは 1 階層限定なので入れ子の境界エッジは自前補修コードが描いている。
  配線自体は #19 から ELK の `hierarchyHandling=INCLUDE_CHILDREN` が箱をまたいで返す（dagre 時代の「箱をまたぐ線は LogicFlow の自動経路」は失効）
- 操作の割り当て: **単一クリック = 選択（DocPanel）/ ダブルクリック = 潜る**。グループの「▼ 中を見る」バッジは単一クリックで潜る
- `blank:dbclick` イベントは LogicFlow に存在しない（背景ダブルクリックで「戻る」は素直には作れない）

## 検証のしかた

- 合成イベントでクリックを検証するには `pointerdown` → `pointerup` → `click` の順で、`detail` に 1 / 2 を入れて送る（`click` だけでは `startTime` が入らず無視される）
- 編集モード → データ選択で 32 テストケース（構造 / 実務 / 規模 / 退化）を切り替えられる。規模ケース（150〜900 ノード）は重い
- レイアウトの回帰は `npm test`（`tests/layout.sweep.test.ts`、848 通り）。#19 から
  **ラベルが自分の線に重なる 0 / ひし形端点の外周外 0 / 出口が下辺・側面 1.00 / 上辺入口が中央 ≥ 0.95 / 線がノードを貫通 0** も assert する。
  #19 の後始末でさらに 3 つ足した: **可視域にノードが 0 個の画面 0（1,696 チェック）/ split 左ペインのひし形端点の外周外 0（393 地点）/
  畳んだグループをまたぐ線が自動経路に落ちる 0（3,818 本）**
- POC（5200）と本プロジェクト（5201）を同時起動して before / after を並べられる

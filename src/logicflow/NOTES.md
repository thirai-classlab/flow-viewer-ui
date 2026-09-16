# LogicFlow 実装ノート

> `flow-visualization-oss-research/mock-app` で 11 の OSS ライブラリを同一 JSON で実装して比較したときの、
> LogicFlow アダプタの `meta`（ライブラリ選定の根拠）をそのまま移したもの。
> 新プロジェクトには比較用の抽象（`AdapterModule` / `AdapterMeta`）が存在しないため、Markdown として残している。

## 対象

| 項目 | 値 |
|---|---|
| id | `logicflow` |
| name | LogicFlow (dynamic-group) |
| パッケージ | @logicflow/core + @logicflow/extension |
| バージョン | 2.2.5 / 2.3.1 |
| ライセンス | Apache-2.0 |
| 自前で書いた行数（linesOfGlue） | 1974 |

## カタログの主張（claim）

> 今回の候補で唯一、折りたたみに必要な部品が全部標準。DynamicGroupNodeModel.toggleCollapse()、collapsedWidth/Height、境界をまたぐエッジを仮想エッジへ差し替える registerCollapsedVirtualEdge まで実装済み

## 機能の実現方式（capabilities）

| 機能 | 実現方式 |
|---|---|
| グループ（入れ子） | 公式プラグイン（`plugin`） |
| 折りたたみ | 公式プラグイン（`plugin`） |
| ドリルダウン | 自前実装（`diy`） |
| 自動レイアウト | `elkjs` 0.12（ELK layered。ランク付け・交差最小化・座標・直交配線・入れ子）。#13 で自前実装 → dagre、#19 で dagre → ELK。ライセンスは **EPL-2.0 OR GPL-3.0-or-later** |

## 実装して分かったこと（findings）

実装しながら実測で確かめた内容。**採用理由と、踏んではいけない地雷の両方**がここにある。

### 主張は半分正しい

toggleCollapse(true) / collapsedWidth / collapsedHeight / createVirtualEdge は実在し、1 階層のグループなら本当に 1 行で動く。実測でも start→n1 の実エッジが hidden になり start→G1a の仮想エッジ（virtual=true, id="e1__0"）が自動生成された。この範囲ではカタログどおり。

### 主張が破綻するのは入れ子

グループ in グループを畳むと境界エッジが全滅する。親の collapseEdge() は「子の仮想エッジを見つけたら無条件 deleteEdgeById して return」する実装（model.js の if (edge.virtual) 分岐）なので、内側が作った仮想エッジを消すだけで代替を作らない。実測: 3 階層で外側を畳んだ直後、全 4 本のエッジが visible=false・仮想エッジ 0 本になった。しかも外側を展開しても復活しない（グラフ状態が壊れたまま）。この穴埋め（最外殻の折りたたみ祖先へ端点を寄せ、重複を潰して addEdge し直す）に約 30 行の自前コードが要った。サンプルの 4 部門を全部畳んだ「部門レベル」表示の 9 本のエッジは、全部この自前コードが描いている。

### 集約は標準にはない

仮想エッジは元の実エッジ 1 本ごとに 1 本作られる（ソースのコメントにも「M+N 条连线」と明記）。4 社並列申込を畳むと同じ端点の仮想エッジが 4 本重なるだけで、Airflow の hasUniformExternalConnectivity 相当の「N 本を 1 本に畳む」処理は無い。重複潰しも自前側の責務だった。

### childrenLastCollapseStateDict は本物

主張どおり機能した。内側 G1a だけ畳んだ状態で外側 G1 を畳み、G1 を展開すると dict は [["G1a",true],["G1b",false]] を保持し、G1a は畳んだまま・G1b は展開で復元された。ここは実装済みという主張が正しい。

### レイアウトはゼロ支援

> **訂正（2026-09-15, #13）**: `@logicflow/layout` は npm に存在する（2.1.5）。ただし描画後に renderRawData で描き直す方式で dynamic-group と衝突し、旧 dagre 0.8 依存なので採らなかった（`docs/draft/auto-layout.md` 案 D）。
> 自前のランク付け（最長路）・文書順の並び・行折り返しは #13 で `@dagrejs/dagre` 3.1.1 に置き換えた。残っている自前部分は入れ子コンテナの箱詰め（`measure()`）と、dagre の折れ線を LogicFlow の polyline 用に直交化する `orthogonalRoute()`、ラベル寸法の確保だけ。

@logicflow/extension の AutoLayout はソース冒頭に「未完善」と書かれ flowPath 依存・型は any だらけで実用外。POC 時点では DAG のランク付け（後退辺の DFS 除去 + 最長路）と入れ子コンテナの再帰的な箱詰めを全部自前で書くことになり、約 150 行がレイアウトだけで消えた。アダプタのコード量の大半はここだった。

### ドリルダウンは API なし

maxGraph の enterGroup に相当するものは無いので、drillRoot 配下だけを lf.render() で流し直す方式（diy）。ただし LogicFlow は render() で完全に作り直せるので実装自体は素直だった。

### 日本語/英語ドキュメントが薄く .d.ts と es/*.js を読むしかない

折りたたみの座標仕様（collapse() は中心ではなく「左上を固定して縮む」）はソースを読んで初めて分かった。逆にこれが分かればグループの場所取りを COLLAPSED_SIZE だけにしても畳んだ箱がぴったり収まる、という設計ができた。node.children と properties.children の両方を渡す必要がある（前者は onGraphRendered、後者は initNodeData が見る）のも同様にソース由来。

### drilldown モード: ビルトイン API はゼロ、ただし render() のおかげで自前実装は安い

@logicflow/core と @logicflow/extension の全ソースを grep しても enterGroup / setRootElement / drillDown に相当する API は 1 件も無い（bpmn-js の canvas.setRootElement、maxGraph の enterGroup に当たるものが存在しない）。そこで共通レイヤの nodesAtLevel() / edgesAtLevel() でこの階層ぶんだけを組み立て lf.render() に流し込む方式にした。LogicFlow の render() は毎回グラフを完全に作り直す仕様なので「潜る = 別データで render し直す」で済み、前の階層の状態を巻き戻す後始末が一切要らなかった。ドリルダウン専用コードは 172 行。

### グループは dynamic-group をやめて通常の rect にした

中身を描かない「名前だけの箱」に dynamic-group を使うと、children 空・collapsedWidth・isRestrict・仮想エッジ生成という折りたたみ前提の機構が全部無駄に動くうえ、枠左上の ± ボタンが「潜る」操作と競合して意味が二重になる。type: "rect" + 太い破線枠（通常ノードは実線 1.5px、グループは 2.5px の破線）+ text の 2 行目に「▼ 中を見る（N 件）」を入れる方が実装も見た目も安定した。件数は共通レイヤの descendantCount()、潜るのは node:click（drilldown のときだけ購読）と node:dbclick の両方。

### 階層外リンクは「上部の注記」と「境界マーカー」の両方を実装した

受付部門に潜ると 4 本が階層外へ出入りする（申込発生からの流入 / 審査部門への流出 / 審査部門からの差し戻し loopback / 品質管理への例外遷移）。画面上部に「4 本がこの階層の外へ出入りしています」と出したうえで、キャンバス内にもピル型の擬似ノード（「→ 内容確認 へ」「← 審査部門 から」、線種は元リンクの kind 色）を描いて実ノードと結んだ。行き先名は drillRoot の 1 つ上の階層を基準に resolveEndpointAtLevel() を解くと「兄弟グループ名」になり（例: proc-receive に潜ると「→ 内容確認 へ」）、そこでも解決できない遠い相手だけトップレベルの部門名へ落とす。この擬似ノードは flat.byId に存在しない id なので、既存 measure() の「未知 id フォールバック」1 箇所だけで自前レイアウトにそのまま乗った。

### nested との共存コストはレイアウト側がほぼゼロ

既存の arrange() / computeRanks() / emitPositions() はそのまま再利用でき、足したのは LayoutCtx に levelOnly フラグ 1 つと、measure() で「levelOnly のときコンテナの中身へ再帰せず固定サイズの箱を返す」分岐だけ。一方で描画・イベント購読・視野合わせは viewMode で完全に分岐させる必要があり、nested 側は 1 行も変えずに if/else へ丸ごと退避した（dynamic-group の折りたたみ検証結果を壊さないため）。全体で 430 行 → 約 700 行。

### アニメーション API は「エッジの流動ダッシュ」しか無い

node_modules を全部読んだ結論。options.animation の型は { node: boolean; edge: boolean } だけ（options.d.ts の AnimationConfig）で、実体は BaseEdgeModel.isAnimation → SVG に .lf-edge-animation を付けて CSS keyframes lf_animate_dash（stroke-dashoffset の無限ループ）を回すだけ。node: true に至っては消費側が 1 箇所も無く実質デッドフラグだった。ビューポート側も TransformModel.zoom() / translate() / focusOn() と LogicFlow.fitView() は全部その場で SCALE_X / TRANSLATE_X を代入して終わりで、duration も easing も引数に持たない（focusOn(targetX, targetY, width, height) というシグネチャで確認）。つまり「階層遷移をアニメーションさせる」ビルトインは存在しない。

### preact + SVG 属性という構造が CSS 側に有利に働いた

LogicFlow はビューポート変換を <g transform="matrix(...)"> の SVG 属性として出す（CanvasOverlay.render）。SVG2 では transform は CSS プロパティなので `.lf-canvas-overlay > g { transition: transform 420ms }` を挿すだけでズーム/パンがブラウザ補間される。実測でも階層遷移のズームがなめらかに繋がった。ただし transition を常時付けるとホイールズームやドラッグまで遅延するので、遷移中だけラッパへ class を足し ANIM.drill + 80ms 後に外している。ノードの出現も同様で、render() が毎回 DOM を作り直す＝CSS animation が必ず再生されるため、.lf-node / .lf-edge に keyframes を当てるだけでフェード + スケールが効いた（ANIM.fade）。

### 消えるノードのフェードアウトだけは 1 枚絵にするしかなかった

lf.render() はグラフを丸ごと作り直すので「今から消えるノード」を個別に残す手段が無い（DOM が同期的に消える）。そこで destroy 直前に host.innerHTML をスナップショットし、次の描画の上に position:absolute で重ねて Web Animations API で opacity 1→0 + scale させる方式にした。階層遷移の向き（drillTransition の enter/exit）でスケール方向を反転させると「潜る=前の階層が手前に抜ける / 戻る=遠ざかる」になり、新しい階層のビューポートを逆向きに補間するのと合わせてズームイン/アウトに見える。ここが本アダプタで一番自前コードを使った部分。

### 位置トゥイーンはモデル API が使えた

graphModel.moveNode2Coordinate(id, x, y, true) を自前 rAF から毎フレーム呼ぶと、MobX 経由でエッジの折れ線まで追従して補間される。CSS では代替できない（<rect> の x/y は CSS geometry property だが <text> は違うので、枠だけ動いて文字が置き去りになる）。イージングは ANIM.easingCss の cubic-bezier をパースしてニュートン法で評価し、CSS 側と同じ曲線を JS でも使うようにした（約 25 行）。なお dynamic-group は「programmatic な移動では子を追従させない」実装（addNodeMoveRules の中で子の moveNodes 呼び出しがコメントアウトされている）なので、nested モードでこのトゥイーンを走らせると枠だけ動いて中身が取り残される。折りたたみ検証を壊さないため drilldown モード限定にした。

### コンテキスト層は getOuterGAttributes() の override 1 個で成立した

BaseNodeModel には @overridable と明記された getOuterGAttributes() があり、最外 <g> に任意の className を返せる。RectNodeModel を継承して className を返すだけのモデルを lf.register({ type, view: RectNode, model }) で登録すれば、枠もテキストもまとめて CSS の opacity: CONTEXT_OPACITY で沈められた（style に opacity を入れる方法だと <rect> にしか効かずテキストが浮く）。view は標準の RectNode を再利用できるので追加コードは 5 行。crossing エッジは擬似ノードではなく実際のコンテキストノードに着地するので、前回の境界マーカーは showContext=true のとき完全に不要になった（受付部門に潜ると 4 本の階層外リンクが 0 本になり、すべて審査部門・品質管理・申込発生の薄い箱へ繋がる）。

### フォーカス+コンテキストのレイアウトは 3 バンド構成にした

フラットに流し込むと薄い箱が主役の中に混ざって層が分からなくなるので、方向（RIGHT/DOWN）に沿って「前コンテキスト列 → フォーカス層 → 後コンテキスト列」の 3 バンドに分けた。どちら側に置くかは crossing エッジの向き（context→focus なら前、focus→context なら後）で決め、crossing が無い兄弟だけドキュメント順で前後に振る。層間は CONTEXT_GAP=96 とノード間隔より広くとって切れ目を見せている。フォーカス層自体は既存 arrange() をそのまま使えたので、追加は外側の 3 バンド配置 60 行ほど。

### prevDrillRoot はそのままでは使えない

App 側の prevDrillRoot は「最後に潜ったときの値」で固定されるので、方向切替や showContext トグルで再描画しても drillTransition(prevDrillRoot, drillRoot) は前回の enter/exit を返し続ける。毎回ズーム演出が走ってしまうため、アダプタ側で「前回描画時の drillRoot」を ref に持ち、実際に変わったときだけ drillTransition() を呼ぶガードを入れた。animate=false のときはゴースト・CSS class・rAF のすべてを作らないので、切り替えは完全に即時になる（実測: ラッパの class が lfa-host のみ、.lf-node の animation-name が none、.lfa-ghost が 0 個）。React 19 StrictMode の二重実行に備えて rAF / setTimeout / WAAPI の Animation はすべて cleanup で cancel している。全体では 700 行 → 1170 行で、コンテキスト層 +130 行・アニメーション +250 行という内訳。

### split: 2 インスタンスは「ほぼ」問題なく同居した — ただし SVG マーカー id だけは確実に衝突する

new LogicFlow({ container }) を 2 つ作って左右に並べた結果、実機で両ペインとも正しく描画された（DOM 実測: .lf-graph が 2 個、左 7 ノード / 右 2 ノード、grid の <pattern id> は createUuid() 由来で instance ごとに別 UUID、ResizeObserver は GraphModel が自分の rootEl だけを observe して waitCleanEffects で disconnect、window の resize リスナも Graph.componentWillUnmount で外れるので競合なし、Mousetrap も new Mousetrap(this.target) でインスタンスごと）。唯一の実害が矢印マーカーで、BaseEdgeModel は markerEnd を "url(#marker-end-<エッジ id>)" として持ち、BaseEdge が同じ id で <defs><marker> を document 内に吐く。SVG の id 参照は文書全体で解決されるので、2 ペインで同じエッジ id（例: lv-0）を使うと後から描いた側の矢印が先に描かれた側のマーカー（色も orient も別物）を拾う。対策としてエッジ id にペイン接頭辞（sp-u- / sp-l-）を必ず付けた。実測で marker id の重複 0 件を確認済み。ノード id は左＝current の兄弟 / 右＝current の子で必ず素集合になるため衝突しなかった。

### plugins はインスタンスオプションなので静的登録の罠を踏まずに済んだ

LogicFlow には静的な LogicFlow.use(extension) があり、これで DynamicGroup を登録すると全インスタンスに効いてしまう。一方 Options.Common には plugins?: ExtensionType[] / pluginsOptions / disabledPlugins がインスタンス単位で用意されており（options.d.ts で確認）、今回は 2 つとも plugins: [DynamicGroup] を渡した。同じプラグインを 2 インスタンスに登録しても互いの ExtensionsManager は独立で、初期化エラーもイベントの取り違えも起きなかった。lf.register() によるカスタムノード型登録も同様にインスタンス単位。「LogicFlow.use() を使わない」ことだけが 2 インスタンス化の前提条件だった。

### コストは DOM がきれいに 2 倍、JS ヒープは +3MB 程度

同じ階層（審査部門）で実測すると、drilldown（1 インスタンス・7 ノード 9 エッジ）でアダプタ配下の DOM 要素が 198 個、split（2 インスタンス・計 9 ノード 10 エッジ）で 374 個。ノード数はほとんど増えていないのに DOM がほぼ倍になるのは、grid の <pattern>・canvas-overlay・tool-overlay・modification-overlay といった「1 インスタンスあたりの固定の骨組み」が丸ごと 2 セットできるため。usedJSHeapSize は 124MB → 127MB で、体感の初期化遅延は無し（render() 自体が軽い）。ただし destroy も 2 回必要で、cleanup を 1 つ書き忘れると LogicFlow の ResizeObserver ごと残る。実測では split → drilldown へ切り替えた直後に .lf-graph が 1 個・.lfa-ghost が 0 個まで戻ることを確認した（StrictMode の二重実行込み）。

### split の左ペインは direction を無視して縦積みにするしかなかった

左ペインは幅 SPLIT.upperRatio = 0.36 の細長い柱なので、ツールバーの「横 →」をそのまま適用するとトップ階層 7 ノードで横幅 1000px 超になり、視野合わせが MIN_SCALE 付近まで縮んで文字が完全に潰れた（実測）。左だけ direction: "DOWN" 固定にしたところペインの高さを使い切って読めるようになった。あわせて視野合わせの余白も左ペインだけ 72 → 24 に落としている。なお「ペインをまたぐ線は引かない」という要件のおかげでレイアウトは左右完全独立になり、既存の arrange() を LayoutCtx.fixedSize（全ノードを SPLIT.nodeSize 一律にする分岐 1 行）だけ足して再利用できた。split 固有のコードは約 300 行で、そのうち半分は「2 セットぶんの ghost / viewport / トゥイーン / cleanup」の管理。ゴーストと位置トゥイーンは drilldown 用のコードを spawnGhost() / tweenLayout() に切り出して共有した。

### split の最上位は「左ペインを空にする」ではなく「左ペインごと外す」のが正解だった

最上位（drillRoot = null）では splitView().upper が空なので、左ペインを幅 36% のまま「最上位です」と出しても場所を無駄に食うだけだった。左ペインの JSX ごと条件レンダリングから外すと、右ペインが flex:1 のまま幅 100% の全画面 1 ペインになり、同時に LogicFlow インスタンスも 1 つで済む（DOM も ResizeObserver も 1 つぶん）。実測で最上位 = .lf-graph 1 個 / 下位 = 2 個、往復 4 回でも残留も二重生成も無し（React 19 StrictMode 有効のまま）。ここで学んだ LogicFlow 固有の注意が 2 つ。(1) 最上位へ戻るとき React は左ペインの DOM を「passive cleanup より先に」外すので、destroy() は document から切り離された container に対して呼ばれる。LogicFlow.destroy() は preact の render(null, container) と ResizeObserver.disconnect() しかせず、GraphModel.resize() も document.body.contains(rootEl) を見て早期 return する実装なので、切り離し後でも安全に走った。(2) ただし destroy() は container の中身を消すため、ゴースト用の innerHTML スナップショットは destroy より前に取らないと空になる。

### 1 ペイン ⇄ 2 ペインのアニメーションは CSS 1 本で足りたが、視野合わせだけは実測幅を使えなくなった

左ペインに @keyframes（width: 0% → SPLIT.upperRatio%、opacity 0 → 1、ANIM.drill = 420ms）を当てるだけで「全画面 → 左が割り込んで分割」になる。CSS animation は要素の挿入時に 1 度だけ再生されるので、class を付けっぱなしにしておけば「左ペインが現れた瞬間だけ再生 / 同じ下位階層どうしの移動では再生しない」が自動的に成立した。右ペインは flex:1 なので縮小はブラウザが補間する。逆向き（下位 → 最上位）は左ペインが DOM ごと消えて WAAPI を掛ける相手がいないため、既存の spawnGhost() を「消えた左ペイン専用のゴーストレイヤ」（全画面ペインの上に重ねた width 36% の絶対配置 div）へ流用してフェードアウトさせた。副作用として、effect 内の host.clientWidth が「アニメーション途中の幅」を返すようになったので、視野合わせの幅だけはラッパの clientWidth から最終形（最上位 = 全幅 / 下位 = 全幅 − 36%）を計算するように変えている。実測の落とし穴として、遷移中に document.querySelectorAll(".lf-graph").length を数えると 3 になる — ゴーストは直前の描画の innerHTML なので .lf-graph を含む。数えるのは ANIM.drill 経過後にすること。

### blank:dbclick イベントが存在しない

LogicFlow の EventType には blank:mousedown / blank:click / blank:contextmenu はあるが blank:dbclick が無い（node:dbclick / edge:dbclick / text:dbclick はある）。「右ペインの空白をダブルクリックで 1 つ上へ戻る」を実装するには、右ペインのホスト DOM に素の dblclick リスナを張り、event.target.closest(".lf-node, .lf-edge") が null かどうかを自分で判定するしかなかった。実機で正しく 1 階層戻ることを確認済み（CDP の mouse down/up を 2 回送るだけでは clickCount が上がらず dblclick にならないので、検証は DOM イベントの直接ディスパッチで行った）。

### 経路入れ子（nestPath）の左ペインには dynamic-group をそのまま使えた — ただし「畳まない」ことが前提条件

使った階層機能は type: "dynamic-group" + node.children + properties.children（前者を onGraphRendered、後者を initNodeData が見るので両方必要）だけ。加えて properties.collapsible: false / isCollapsed: false を必ず入れ、toggleCollapse() は一度も呼ばない。nested モードで踏み抜いた「入れ子グループを畳むと境界エッジが全滅する」バグは collapseEdge() の中にしか無いので、畳まない限りその経路に入らない — 実機でも左ペインの ± ボタン 0 個（DOM 実測: group ノード 3 個に対し collapse アイコンの rect[fill=#f4f5f6] が 0 個）、仮想エッジ 0 本、左ペインのエッジは edgesForNestView() が出した 14 本がそのまま 14 本描かれた。重なり順も無調整で成立する: DynamicGroupNodeModel.initNodeData が zIndex に DEFAULT_BOTTOM_Z_INDEX = -10000 を自動で入れるため、通常ノード（既定 zIndex）が必ず上に来る。親→子の順に nodes へ push するだけで、入れ子 3 段でも内側の箱と子ノードが正しく前面に出た。子ノードのクリックも透過せず届く（実機で「受注プロセス」の枠の中にある「審査部門」をクリックして横移動できた）。

### dynamic-group のタイトルは overflowMode を ellipsis にしないと中の子ノードを HTML で覆い隠す

DynamicGroupText.renderTitleHtmlText は getTitleForeignObjectRect() で foreignObject を作るが、overflowMode が autoWrap のとき foHeight = bandHeight = height − DG_OPERATE_INSET(10) になる。つまり「タイトル用の foreignObject が枠のほぼ全面に広がる」ので、中に置いた子ノードが HTML の div に覆われてクリックも視認もできなくなる。ellipsis にすると foHeight = pad.top + fontSize + 2 + pad.bottom（今回 13px）に縮み、見出し帯だけを占めるようになった。左ペインの入れ子ではこれが必須。ついでに同じ関数は文字色に style.color ではなく style.fill を使う（SVG 描画時は color）ので、textStyle には color と fill の両方を同じ値で入れている。ヘッダ帯の高さは SPLIT.nestHeader = 22 に対し文字が上端 +10px から始まるのでちょうど収まった。

### 5 階層の実測: 潰れなかった。ただし共通の LAYOUT_GAP のままだと縮尺 0.53 で読めない

> **再計測（2026-09-15, #13, dagre 化後）**: 同じ地点（deepFlow: 受注プロセス > 受付部門 > 申込受付 > フォーム処理、左ペイン幅 51%）で 1920x1080 = 1.00 / 1440x900 = 1.00 / 1280x800 = 0.98 / 1280x720 = 0.87。下の 0.78〜1.00 の帯を保っている（`SPLIT.nestGap` は dagre の nodesep / ranksep にそのまま渡している）。

deepFlow の最深ドリル先（受注プロセス > 受付部門 > 申込受付 > フォーム処理、経路 4 段・展開 3 段・箱の深さ 4）で計測。左ペイン幅は式どおり min(0.52, 0.36 + 3×0.05) = 51%、左ペインの中身は 13 ノード / 14 エッジ。縮尺は 1920×1080 と 1440×900 と 1280×800 で 1.00、1280×720 でも 0.78（11px フォントが実効 8.6px）で全ラベルが読める。ただしこれは左ペイン専用のノード間隔 SPLIT.nestGap = { node: 14, rank: 22 } を入れた結果で、共通テーマの LAYOUT_GAP（node 28 / rank 64）のままだと同じ地点で縮尺 0.53 まで落ち（実効 5.8px）ラベルが完全に潰れた。LAYOUT_GAP は「本編のキャンバス」向けの値で、幅 51% の柱に入れ子を積む用途には広すぎる。左ペインの向きを direction 無視の DOWN 固定にする既存判断はそのまま踏襲した（横に流すと入れ子の幅が柱に収まらない）。圏外リンクは実機でも全階層 0 本。ページ内で collapse.ts を直接叩いて全ドリルルートを総当たりした結果でも、deepFlow 31 件 + sampleFlow 9 件の計 40 件すべてで edgesForNestView().outOfScope = 0（同じ地点の edgesAtLevel().outOfScope は 2〜8 本）。経路入れ子は「画面の外へ出る線」問題を完全に消す。

### MAX_NEST_LEVELS = 3 はこのデータでは一度も発火しない — 減らす必要はなく、むしろ上げてよい

deepFlow で潜れる最深コンテナは depth 3（工程 = step-form 等）なので祖先は最大 3 個。pathNestView() の省略条件は ancestors.length > MAX_NEST_LEVELS なので 3 > 3 が成立せず、40 ドリルルート全部で omittedAncestors が空だった。つまり 3 は「5 階層では実質無制限」で、意味を持つのは 6 階層以上のとき。読みやすさの観点でも展開 3 段（箱の深さ 4）で 1440×900 の縮尺が 1.00 なので減らす理由が無く、LogicFlow 側は 4〜5 段でも耐えると見ている（左ペイン幅は nestRatioMax 0.52 で頭打ちになるため、先に効くのは横ではなく縦の伸び）。省略 UI 自体は擬似的に omittedAncestors を差し込んで動作確認済み: キャンバス内に擬似ノードとして描くと視野合わせで一緒に縮んで読めなくなるので、ペイン最上段に HTML のチップ帯（「⋯ 上位 N 階層」＋祖先名ボタン）として固定し、クリックで onDrillDown(祖先 id) を呼ぶ形にした。左ペイン幅が経路の深さで変わることの副作用が 1 つあり、1 ペイン ⇄ 2 ペインの @keyframes lfa-pane-in に幅を定数で焼き込めなくなった。to を var(--lfa-pane-w)（インライン style で与える）にし、fill-mode を both から backwards へ変えて解決している（both のままだと再生後もアニメーションが最終値を保持し、合成順で transition より優先されるため、階層を移って幅が変わってもカクつく）。

## UX 作り直し（閲覧モードでフローを主役にする）で分かったこと

### 「縦の 8 割が空白」の犯人はズーム上限ではなくレイアウトの縦横比だった

> **失効（2026-09-15, #13）**: この節の「ランクの列を折り返す」方式と面積比 52.2% の実測は、折り返しの廃止（dagre 化）で根拠を失った。
> 折り返しは 848 通り中 84.4% で発生し、DAG 上は前進なのに画面上で後退する辺を 1,310 本作っていた（`docs/draft/auto-layout.md` §1）。
> いまはフローを常に主軸 1 本に並べ、収まらないぶんはズーム / パンに任せる。`tests/layout.sweep.test.ts` の実測（1280x593）: 面積比 平均 15.3% / 中央値 13.9%、縮尺 中央値 0.75、後退辺 0 本。
> 下の (1)(2) の判断（拡大上限の開放・余白 56）は今も有効。

1280x633 の実測で、キャンバス 820x544 に対しフローは 748x77（面積比 12.9%・横は 91% 使っているのに縦は 14%）。
原因は 3 つあって、効き方の大きさが全然違った。(1) `fitViewport` が `Math.min(1, …)` で拡大側を 1.0 に頭打ちしていた、
(2) 余白が 72px（キャンバスの 13%）、(3) 本命は「業務フローは 1 本の長い鎖になりがち」という形の問題で、
direction=RIGHT のまま並べると横 1360 × 縦 140 のような極端な比になり、縦をどう頑張っても埋まらない。
このケースは横が制約なので、(1)(2) だけ直しても縮尺は上がらない。

解決は `arrange()` にキャンバス実寸（`LayoutCtx.fit`）を渡し、**ランクの列を何本ごとに折り返すか**を実測で選ぶこと。
候補（折り返し無し〜1 本ずつ）を全部組んでみて縮尺が最大になる分割を採り、
行数が増えるのは明確に（6% 以上）大きくなるときだけにしてある（折り返しは読み順を増やすコストがあるため）。
`arrange()` は `measure()` 経由で再帰するので、`fit` は最外の 1 枚だけに効かせ、
再帰へ渡す ctx からは必ず落とすこと（グループの中身まで折り返すと入れ子が崩れる）。

全 32 テストケース × 全ドリルルート × 両方向（848 通り）の総当たり実測:

| 指標（キャンバス 1280x593 に対するフローの面積比） | before | after |
|---|---|---|
| 平均 | 8.1% | 52.2% |
| 中央値 | 7.0% | 47.1% |
| 50% 以上埋まる割合 | 0.5% | 49.3% |
| 例外・レイアウト破綻 | 0 件 | 0 件 |

実機の既定表示（drilldown / トップ階層）は 12.9% → 85.4%、縮尺 0.55 → 1.41、
ノードの実寸 110x35px → 379x178px、ラベルの実効フォント 6.6px → 18px。

### dagre 化で分かったこと（#13）

> **一部失効（2026-09-16, #19）**: 自動レイアウトは `@dagrejs/dagre` から **elkjs 0.12（ELK layered）** に全面置換した。
> 下の 6 項目のうち、dagre 固有の 2 つ（`minlen` の 2 倍・`orthogonalRoute()` による直交化）と
> 「配線が取れるのは同じ箱の直下どうしだけ」は失効している。`LineText` の背景幅と `tweenLayout()` の
> `updatePath()` 戻しは ELK でもそのまま必要。詳しくは下の「ELK 化で分かったこと（#19）」。


- dagre は `minlen` を内部で 2 倍にしてラベル用の仮想ノードを必ず 1 つ挟むので、隣接ノード間でも `edge.x / y`（ラベル中心）が取れる。ラベルに `width / height` を渡すと逆走辺（loopback）と順路が別トラックに分かれ、隣の枠にラベルが重ならない
- dagre の `points` は両端が枠との交点で中間が仮想ノードを結ぶ斜線。そのまま `pointsList` に渡すと LogicFlow の `orthogonalizePath` が枠の縁を這う線を作るので、`layout.ts` の `orthogonalRoute()` が「側面の通過点に一番近い位置から出て、空き区間の中央で 1 回だけ曲がる」直交折れ線に組み直している。菱形（decision）は頂点だけが枠線に触れるので側面中央に固定
- `LineText` は線上ラベルの背景を文字数にかかわらず `edgeText.textWidth`（90px）幅で描く。短いラベルでも 90px の背景が線を隠すので、`lfa-polyline`（`AppPolylineEdgeModel`）を登録して `properties.textStyle.textWidth` をラベルの実幅にしている。`BaseEdgeModel.getTextStyle()` はテーマしか見ないので override が要る
- `moveNode2Coordinate()` → `moveStartPoint / moveEndPoint` は `updatePoints()` で自動経路に計算し直すため、位置トゥイーン中は `pointsList` が消える。`tweenLayout()` が描画直後の `pointsList` と `text` 位置を控え、完了時に `updatePath()` と `moveText()` で戻す
- ~~配線が取れるのは「同じ箱の直下どうし」を結ぶ線だけ~~ **失効（2026-09-16, #19 の後始末）**: 箱をまたぐ線も ELK を通る。nested の中身どうしと split 左ペインの入れ子は `INCLUDE_CHILDREN`、折りたたみ中のグループをまたぐ線は `Arranged.projected`、コンテキスト層への crossing は「コンテキスト層も ELK の入力に含める」で解決した。LogicFlow の自動経路に落ちる辺は 0 本（`tests/layout.sweep.test.ts` が assert する）
- 848 通り（32 ケース × 全ドリル経路 × RIGHT/DOWN）の回帰は `npm test`（`tests/layout.sweep.test.ts`）で走る: 例外 0 / NaN 0 / 重なり 0 / 後退辺 0 / 直交・両端が枠線上・ラベルが線上

### 拡大上限は「ラベルの実効フォントサイズ」で決めると迷わない

上限を外すと 2〜3 ノードしかない階層で縮尺 1.75 まで伸び、枠もバッジも間延びして逆に読みにくくなった。
ラベルが 13px なので `FIT.maxScale = 1.4`（実効 18px）で止めている。
split のペインは別枠で、左（現在地の見取り図）は 1.0 に据え置き
— 上の「5 階層の実測」がこの上限を前提にしているため — 右（今いる階層の中身）は 1.25。

### 下限は 0.85 で止め、はみ出しはパン（#15）

折り返し廃止（#13）で sample3 のトップが 1440x900 で縮尺 0.51、nested の全展開が 0.25 まで縮んだ。
`FIT.minReadable = 0.85`（13px × 0.85 ≒ 11px）で止め、収まらない軸は開始側（左 / 上）に `pad/2` で寄せる
（`fitViewport()` の minScale 引数。split の左ペインと「全体を表示」（`FlowViewerHandle.fitAll`）は `FIT.minScale` を渡して下限なし）。
nested は初期表示で `pickAutoCollapse()` が「深さ ≥ d を全部畳む」候補を深い側から試し、生の縮尺が 0.85 に届く最初の d を
collapsed に載せる（sample3 は全部畳んでも 0.53 なので d = 0 + 下限、sample5 は d = 0 で 1.02）。

パン / ズームは LogicFlow の既定（`isSilentMode` でも `stopScrollGraph` / `stopZoomGraph` / `stopMoveGraph` は false、`EditConfigModel.js`）のまま:
**空白のドラッグ = パン、ホイール = スクロール（縦 / 横）、ctrl / ⌘ + ホイール = ズーム**（`CanvasOverlay.js` の `zoomHandler`）。
実測（1440x900、ドリルダウントップ）: 400px ドラッグで tx 28 → −371.5、`WheelEvent(deltaY 200)` で ty 305.9 → 135.9、ctrl + `deltaY −100` で 0.85 → 0.89。
preact の再描画は非同期なので、`transform` 属性の読み取りはイベントの次のフレーム以降に行う。

### ノードの装飾は getShape() の override で足せる。ただしラベルの foreignObject が当たり判定を奪う

`BaseNode.getShape()` は `@overridable` なので、`super.getShape()` の戻りと自前の vnode を
`h('g', {}, …)` で包めば図形の上に何でも重ねられる（「▸ 中を見る N」バッジと 📄 マークはこれで描いている）。
ただし LogicFlow はノードのラベルを **foreignObject の HTML** で描き、その div が枠いっぱい
（`min-height` = ノード高）に広がって getShape() の出力の上に載る。
実測でバッジ中央の `document.elementFromPoint()` が `.lf-node-text-auto-wrap` を返し、
クリック判定の `e.target.closest('.lfa-badge')` が一度も成立しなかった。
`.lf-node foreignObject { pointer-events: none }` でラベルの当たり判定を下の図形へ通して解決した
（ラベルは読むもので押すものではないので副作用は無い。`textEdit: false` 前提）。
副産物として、nested モードで dynamic-group のタイトル帯が子ノードのクリックを吸う問題にも効く。

### 選択枠は再描画せずに DOM の class で付け替える

`selectedId` を描画 effect の依存に入れると、ノードを選ぶたびに LogicFlow を destroy → render し直すことになり、
選ぶだけで出現アニメが再生されて画面が跳ねる。
`getOuterGAttributes()` は className 以外の属性も最外 `<g>` へそのまま撒く（実装上 `restAttributes` として spread される）ので
`data-nid` を出しておき、選択は `querySelectorAll('[data-nid=…]')` に class を足すだけの独立 effect に分けた。
この effect は描画 effect より後に走るので、再描画直後の貼り直しも同じ関数 1 つで足りる。

### 合成イベントで node:click / node:dbclick を検証するには pointerdown が要る

`BaseNode.handleClick` は先頭に `if (!this.startTime) return` があり、`startTime` は
`handleMouseDown`（= `onPointerDown`）でしか入らない。`click` だけ dispatch しても何も起きない。
検証は `pointerdown` → `pointerup` → `click` の順で、`detail` に 1（単一）か 2（ダブル）を入れて送る
（ダブルクリックの判定は `e.detail === 2`）。CDP の mouse down/up では clickCount が上がらないのは既出のとおり。

### nested モードのグループだけはホバー演出を付けられない

ホバー / 選択 / バッジは `lf.register()` した自前の rect・diamond でしか付けられず、
nested の箱は dynamic-group プラグインが登録したままの型なので `getOuterGAttributes()` を差し替えられない
（`type: 'dynamic-group'` を再登録するとプラグイン側の実装ごと置き換わり、折りたたみの検証結果を壊す）。
nested には枠左上の ± という既存のアフォーダンスがあるのでそのままにした。

## ELK 化で分かったこと（#19、2026-09-16）

### 効いたオプションだけを残す — ELK は不正なオプション名・値を例外なく黙って無視する

これが一番の落とし穴。綴りが 1 文字違っても、値が列挙外でも、ELK は例外を投げず**そのオプションを無かったことにする**。
「設定したのに効かない」と「設定が間違っている」が区別できないので、足したら必ず出力の数値（bbox・端点・交差数）で確かめる。
実測で黙って無視されたもの: `elk.layered.spacing.baseValue`（4 / 8 / 12 いずれも bbox 303x853 のまま）、
`elk.edgeLabels.inline=true`（361x920 のまま）、`elk.layered.compaction.postCompaction.strategy=EDGE_LENGTH`（361x920 のまま）。
無視ではなく**壊れる**ものも 2 つあった: `elk.layered.layering.strategy=STRETCH_WIDTH` は 300 秒待っても返らず（プロセスごと kill）、
`DF_MODEL_ORDER` は `java.lang.IndexOutOfBoundsException: index (-1) must not be negative`。本体でこの 2 つを露出してはいけない。

平坦な階層（drilldown / nested）で採った最終セット（`layout.ts` の `elkLayoutOptions()`）:
`elk.algorithm=layered` / `elk.direction=DOWN|RIGHT` / `elk.edgeRouting=ORTHOGONAL` / `elk.hierarchyHandling=INCLUDE_CHILDREN` /
`nodePlacement.strategy=BRANDES_KOEPF` / `crossingMinimization.strategy=LAYER_SWEEP`（+ `forceNodeModelOrder=false`）/
`thoroughness=14` / **`cycleBreaking.strategy=MODEL_ORDER`**（既定の GREEDY は順路を無視して逆走辺を作る）/
`considerModelOrder.strategy=NODES_AND_EDGES` / `mergeEdges=false` / `unnecessaryBendpoints=true` /
`spacing.nodeNode` と `layered.spacing.nodeNodeBetweenLayers` に `LAYOUT_GAP` / `spacing.edgeNode=16` / `spacing.edgeEdge=12` /
`spacing.edgeLabel=6` / `spacing.labelNode=8` / `edgeLabels.placement=CENTER` / `layered.edgeLabels.sideSelection=ALWAYS_DOWN` /
root は `elk.padding=[0,0,0,0]`、グループ（compound node）は `elk.padding=[top=GROUP_HEADER,…]` + `elk.nodeSize.constraints=MINIMUM_SIZE`。

`INCLUDE_CHILDREN` で `crossingMinimization.strategy` を変えるときは、root だけでなく compound node にも同じ値を置かないと
`UnsupportedGraphException: The hierarchy aware processor LAYER_SWEEP in child node ... is only allowed if the root node specifies the same hierarchical processor` で落ちる（実測）。

### ポート規則: 「上から入って下から出る」は辺ごとの FIXED_POS ポートでしか作れない

ユーザー指摘の 3 点（上辺に入る線は中央 / 出る線は下辺・横 / 線とラベルが重ならない）のうち、前 2 つはポートで解く。

- **葉ノードだけ**にポートを付ける（グループは FREE。付けると入れ子で斜め線が出る）
- **辺ごとに専用ポートを 1 つ**作り `elk.portConstraints=FIXED_POS`
- 入口は `NORTH`(DOWN) / `WEST`(RIGHT)、出口は `SOUTH`(DOWN) / `EAST`(RIGHT)
- 位置は辺の中央 ±(span×0.15)、刻みは `min(16, span×0.3/(k-1))`（`spreadOffsets()`）

ポートを外すと 848 通りで 出口 1.000 → 0.948 / 上辺中央 0.985 → 0.767 に落ちる（`layout.ts` の `portsOf()` を空配列にして実測）。
逆に「辺の中央 1 点に全部集約」すると交差は 708 → 227 まで減るが、共線重なりが 0 → 3,915 に激増して 3 本の線が 1 本に見える。

### ひし形の端点は「ポートで外周に乗せる」ことが原理的にできない — 読み取り側で伸ばす

ELK は `elk.port.side` を付けたポートの**主軸座標を bbox の枠線へ強制スナップする**（実測: SOUTH ポートに y=84.64 を指定 → 実測 y=92、
NORTH ポートに y=0 を指定 → 実測 y=-1）。つまりひし形（decision）は頂点以外が bbox の辺に触れないので、
散らしたポートの端点はそのまま使うと**図形の外に浮く**（#18 の実装では菱形端点 1,418 本中 432 本 = 30.5%）。

解決は読み取り側。`snapDiamondEndpoints()` が最終セグメントの向き（主軸に平行）を保ったまま端点を 4 頂点の外周まで伸ばす。
直交は崩れず、848 通りで 外周外 0 / 非直交 0 / 逆走 0。
ここで要るのが `DIAMOND_MAX_INSET.flat = 12`（ひし形だけポートを散らす幅を絞る上限）。これが無いと食い込みが最大 31.1px になり、
最終セグメント（最短 17px = `elk.spacing.edgeNode` 16 由来）を食い切って折れ線が逆走する。上限つきなら最大食い込み 13.1px / 最小余裕 3.9px。

**入れ子（split 左ペイン）は別値 `DIAMOND_MAX_INSET.nest = 3`**（#19 の後始末）。左ペインは層の間隔が `rankNode = 4px` しかなく、
最終セグメントも 4px 前後になるので、12 のままだと「最終セグメントより食い込まない」保険が先に働いて端点が外周の手前で止まる
（実測: 全ドリル地点 434 のひし形端点 136 本のうち 93 本が外周外・最大 7.7px）。3 にすると 0 本になる。
なお左ペインは `buildSpec()` が形を `rect` 決め打ちにしていたので、そもそも `snapDiamondEndpoints()` が呼ばれていなかった
（`toSplitUpperNode()` はひし形で描くのに）。サイズが一律でも `shape` だけは kind から決めること。

なお「ひし形は頂点 1 点に集める」案も外周外 0 にはなるが、共線重なりが 0 → 240 に増えて 3 本の入線が 1 本に重なって見えたので採らなかった。

### ラベルは ELK に場所を空けさせる。split 左ペインは「縮尺が頭打ちなら」渡す

`labelSizeOf()` の矩形を `edge.labels` に渡すと、`edgeLabels.placement=CENTER` + `sideSelection=ALWAYS_DOWN` で
ラベルが線の脇に置かれる。848 通りで「ラベルが自分の線に重なる」が dagre 1,046/1,110（94.2%）→ ELK 0/1,110 になった。
逆にラベルの予約矩形を 1x1 に縮めると 1,110/1,110 が線に重なる（テストを壊して確認済み）。

split の左ペイン（幅 36〜52% の柱）は既定では渡さない。渡すと縦に伸びて縮尺が 0.85 → 0.78 に落ちる
（dagre と同じ 5 本だけに絞っても 0.78）。全ドリル地点 × 4 解像度 1,736 点で測ると、無条件に渡した場合
0.85 未満が 736 → 1,144 点に増える。

**ただし縮尺が `FIT.maxScaleUpper = 1.0` で頭打ちの地点では渡しても損しない**（#19 の後始末）。
`buildSplitNestGraph(view, …, fit)` にペイン実寸を渡すと、まずラベル無しで組み、その縮尺が頭打ちのときだけ
ラベル付きでもう一度組んで「頭打ちのままなら採る」。採否を縮尺で決めるので 0.85 未満の地点数は 736 のまま変わらず
（実測: 修正前 736 / 修正後 736）、1440x900 では 434 地点中 115 地点で ELK がラベルを置く。
採らなかった地点のラベルは従来どおり LogicFlow の自動配置。

### 入れ子の読み順は `considerModelOrder` では一切動かない — `partitioning` と loopback 反転で解く

split 左ペイン（経路入れ子）を ELK にすると、既定では読み順が JSON 順から崩れる（兄弟ペアの前後関係 15/20）。
`considerModelOrder.strategy` 3 種 × `forceNodeModelOrder` 2 値、`noModelOrder` 4 種、`cycleBreaking` 4 種、
`crossingMinimization` 3 種、children 配列を links 順に並べ替え — **全部 15/20 のまま**（GREEDY と DEPTH_FIRST は 13/20 に悪化）。

効いたのは「入力の作り方」側の 2 つだけ:

1. `elk.partitioning.activate=true` + 各ノードに `elk.partitioning.partition` = 親の children 配列内の順番（18/20）
2. `kind==='loopback'` の辺を向きを入れ替えて ELK に渡し、返ってきた折れ線を `reverse()` して読む（19/20）

両方足して 20/20（dagre は 17/20）。隣接ペアも 9/9（dagre 8/9）。
**loopback 反転は入れ子だけに当てる**。平坦な 848 通りに当てると「出口は必ず下辺」が 1.000 → 0.951（252 本が入口側から出る）に崩れる。
入れ子でも逆走辺 3 本は上辺から出るが、左ペイン限定の妥協として受け入れた。

### 箱をまたぐ線は `INCLUDE_CHILDREN` で葉まで届く

dagre は「同じ箱の直下どうし」しか配線を返せず、split 左ペインの 14 本のうち 9 本（箱をまたぐ線）が
LogicFlow の自動経路に落ちていた。ELK は `hierarchyHandling=INCLUDE_CHILDREN` で親子をまたいで直交配線するので、
14 本すべてが ELK 配線になり、箱をまたぐ 9 本も 9/9 直交で葉まで届く。
辺は 2 端点の最小共通祖先（LCA）を `container` にして宣言し、読み取り時にそのコンテナの絶対原点を足す。

`SEPARATE_CHILDREN` + 辺を兄弟レベルへ射影（dagre の `projectLinks` と同じモデル）でも読み順 20/20 にはなるが、
線が箱の枠で止まって葉に届かないので不採用。

### 折りたたみ中のグループをまたぐ線も ELK に通す（#19 の後始末）

`resolveLinks()` は畳んだグループへ射影した辺も ELK に渡している（同じ端点の組は 1 本に畳む）が、
以前はその配線を捨てていた。捨てると LogicFlow の仮想エッジ（`createVirtualEdge` が `pointsList = undefined` で作る）と
自前の補修エッジが自動経路になり、**畳んだ箱を線が貫通する**。
実測（34 ドキュメントの nested 初期表示 = 自動抽象化後）: 畳んだ箱をまたぐ 964 本のうち 841 本が自動経路 → 0 本。
`Arranged.projected`（key は `<始点>-><終点>`）で返し、`use-drill-effect.ts` が補修エッジには `addEdge` の時点で、
LogicFlow が作った仮想エッジには `updatePath()` で当てる。重複する仮想エッジには同じ折れ線を当てるので重なって 1 本に見える。

### フォーカス + コンテキストもコンテキスト層ごと ELK に入れる（#19 の後始末）

コンテキスト層を 3 バンドに手置きして crossing エッジを LogicFlow の自動経路に任せていたが、
線がフォーカス層の箱を貫通し、ラベルが箱の下に隠れ、3 本が同じ y に重なって 1 本に見えていた。
コンテキスト層も `arrange()` の入力に入れ、バンド構成は `elk.partitioning`（前 0 / フォーカス 1 / 後 2）で保つ。
サイズは `LayoutCtx.sizeOf` で `CONTEXT_SIZE` に上書きする。
実測（868 画面 = 全ドリル地点 × 2 方向）: crossing 3,052 本すべてが ELK 配線になり、
箱の貫通 0 / ラベル × ノードの重なり 0 / ラベルが自分の線に重なる 0。
同じ partition のノードは従来どおり ELK が層を決めるので、フォーカス層の層数が減った画面は 868 中 2 画面だけだった。

### 折りたたみ中のグループだけは ELK の compound にしない

nested の折りたたみは「場所取りを `COLLAPSED_SIZE` にする」ことが目的なので、compound node（= ELK が中身に合わせて大きくする）
にしてしまうと畳む意味が消える。折りたたみ中のグループは **親のグラフでは `COLLAPSED_SIZE` の葉**として置き、
展開時のレイアウトだけ別の `arrange()`（= 別の ELK 実行）で先に決めて `Box.fullW/fullH` に入れる。
LogicFlow の `collapse()` は「左上を固定して縮む」実装なので、展開時の箱の左上を枠の左上に合わせておけば畳んだ結果がぴったり収まる。

### 層番号（`Arranged.ranks`）は ELK の出力から復元している

ELK は層番号を JSON に載せない。ただし ELK layered は**同じ層のノードを主軸の開始座標で揃える**（実測: 幅 200 と 60 のノードが
同じ層なら y が両方 82）ので、トップレベルの箱の主軸開始座標をまとめて番号にすれば層番号になる。
`tests/layout.sweep.test.ts` の「後退辺 0」はこの復元値を使うので、dagre 時代より弱い検査になっている点は承知しておくこと。

### 非同期化: effect は「await を含む組み立て」と「await を含まない描画」に割る

`arrange()` が `Promise` を返すようになったので、描画 effect の中で await をまたぐと
cleanup（同期クロージャ）との間で ref の書き込み順が壊れる。`use-drill-effect.ts` / `use-split-effect.ts` は

1. **組み立て**（await あり）: レイアウトとグラフ config を作るだけ。DOM も ref も触らない
2. `if (gen !== genRef.current) return`（世代カウンタ）
3. **描画**（await 無し）: ghost → `createLogicFlow` → `render` → 視野合わせ → tween → イベント購読

の 3 段にしてある。(3) は同期なので React が途中で cleanup を走らせられず、
`prevViewportRef` / `prevLayoutRef` / `splitViewportRef` / `lastRootRef` / `ghostRef` の書き込み順と `dead.destroy()` の順序が守られる。
cleanup は `rendered` フラグを見て、描画まで到達していない世代では ghost も host も触らない（触ると次の描画のゴーストが空になる）。

### バンドル: Worker に逃がすと本体は +4.8KB で済む

`elk.bundled.js` は 1,441,200B（gzip 438KB）。`elkjs/lib/elk-api.js`（4,764B / gzip 1.9KB）+
`new Worker(new URL('elkjs/lib/elk-worker.min.js', import.meta.url), { type: 'module' })` にすると、
Vite が worker を別アセット（1,433,769B）として吐き、本体チャンクには入らない（実測 `dist/assets`）。
`typeof Worker === 'function'` が false の環境（vitest の node）と、Worker の生成が例外になる環境（CSP）では
`elk.bundled.js` の動的 import に落ちる。ELK インスタンスはモジュールスコープの lazy singleton 1 つを使い回す
（`elk-api.js` の `PromisedWorker` はメッセージ id で解決するので、同時に複数の `layout()` を投げても取り違えない）。

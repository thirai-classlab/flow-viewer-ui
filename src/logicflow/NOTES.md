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
| 自動レイアウト | 自前実装（`diy`） |

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

@logicflow/layout は存在しない（npm にも node_modules にも無い）。@logicflow/extension の AutoLayout はソース冒頭に「未完善」と書かれ flowPath 依存・型は any だらけで実用外。結果、DAG のランク付け（後退辺の DFS 除去 + 最長路）と入れ子コンテナの再帰的な箱詰めを全部自前で書くことになり、約 150 行がレイアウトだけで消えた。アダプタのコード量の大半はここ。

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

deepFlow の最深ドリル先（受注プロセス > 受付部門 > 申込受付 > フォーム処理、経路 4 段・展開 3 段・箱の深さ 4）で計測。左ペイン幅は式どおり min(0.52, 0.36 + 3×0.05) = 51%、左ペインの中身は 13 ノード / 14 エッジ。縮尺は 1920×1080 と 1440×900 と 1280×800 で 1.00、1280×720 でも 0.78（11px フォントが実効 8.6px）で全ラベルが読める。ただしこれは左ペイン専用のノード間隔 SPLIT.nestGap = { node: 14, rank: 22 } を入れた結果で、共通テーマの LAYOUT_GAP（node 28 / rank 64）のままだと同じ地点で縮尺 0.53 まで落ち（実効 5.8px）ラベルが完全に潰れた。LAYOUT_GAP は「本編のキャンバス」向けの値で、幅 51% の柱に入れ子を積む用途には広すぎる。左ペインの向きを direction 無視の DOWN 固定にする既存判断はそのまま踏襲した（横に流すと入れ子の幅が柱に収まらない）。圏外リンクは実機でも全階層 0 本。ページ内で collapse.ts を直接叩いて全ドリルルートを総当たりした結果でも、deepFlow 31 件 + sampleFlow 9 件の計 40 件すべてで edgesForNestView().outOfScope = 0（同じ地点の edgesAtLevel().outOfScope は 2〜8 本）。経路入れ子は「画面の外へ出る線」問題を完全に消す。

### MAX_NEST_LEVELS = 3 はこのデータでは一度も発火しない — 減らす必要はなく、むしろ上げてよい

deepFlow で潜れる最深コンテナは depth 3（工程 = step-form 等）なので祖先は最大 3 個。pathNestView() の省略条件は ancestors.length > MAX_NEST_LEVELS なので 3 > 3 が成立せず、40 ドリルルート全部で omittedAncestors が空だった。つまり 3 は「5 階層では実質無制限」で、意味を持つのは 6 階層以上のとき。読みやすさの観点でも展開 3 段（箱の深さ 4）で 1440×900 の縮尺が 1.00 なので減らす理由が無く、LogicFlow 側は 4〜5 段でも耐えると見ている（左ペイン幅は nestRatioMax 0.52 で頭打ちになるため、先に効くのは横ではなく縦の伸び）。省略 UI 自体は擬似的に omittedAncestors を差し込んで動作確認済み: キャンバス内に擬似ノードとして描くと視野合わせで一緒に縮んで読めなくなるので、ペイン最上段に HTML のチップ帯（「⋯ 上位 N 階層」＋祖先名ボタン）として固定し、クリックで onDrillDown(祖先 id) を呼ぶ形にした。左ペイン幅が経路の深さで変わることの副作用が 1 つあり、1 ペイン ⇄ 2 ペインの @keyframes lfa-pane-in に幅を定数で焼き込めなくなった。to を var(--lfa-pane-w)（インライン style で与える）にし、fill-mode を both から backwards へ変えて解決している（both のままだと再生後もアニメーションが最終値を保持し、合成順で transition より優先されるため、階層を移って幅が変わってもカクつく）。

## UX 作り直し（閲覧モードでフローを主役にする）で分かったこと

### 「縦の 8 割が空白」の犯人はズーム上限ではなくレイアウトの縦横比だった

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

### 拡大上限は「ラベルの実効フォントサイズ」で決めると迷わない

上限を外すと 2〜3 ノードしかない階層で縮尺 1.75 まで伸び、枠もバッジも間延びして逆に読みにくくなった。
ラベルが 13px なので `FIT.maxScale = 1.4`（実効 18px）で止めている。
split のペインは別枠で、左（現在地の見取り図）は 1.0 に据え置き
— 上の「5 階層の実測」がこの上限を前提にしているため — 右（今いる階層の中身）は 1.25。

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

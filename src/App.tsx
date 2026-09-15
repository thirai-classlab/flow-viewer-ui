import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { FlowCanvas } from './logicflow'
import type { Theme, ViewMode } from './flow/view-props'
import { DEFAULT_THEME } from './flow/view-props'
import type { CollapseState, Direction, FlowDoc, FlowStep } from './flow/schema'
import { flattenDoc } from './flow/flatten'
import { toggleCollapsed } from './flow/collapse'
import { measureFlow } from './flow/generate'
import { DEFAULT_DATA_SEL, resolveDoc } from './flow/data-source'
import type { DataSel } from './flow/data-source'
import { Toolbar } from './ui/Toolbar'
import type { UiMode } from './ui/Toolbar'
import { SidePanel } from './ui/SidePanel'
import { DocPanel } from './ui/DocPanel'
import { CanvasErrorBoundary } from './ui/ErrorBoundary'

/**
 * シェル。持っているのは「今どう見ているか」の状態だけで、描画は FlowCanvas に、
 * 階層の計算は src/flow に、JSON の見せ方は SidePanel に、手順書は DocPanel に閉じている。
 *
 * 真実源は常に doc（FlowDoc）1 つ。画面上の状態（現在地・折りたたみ・選択）は doc の外にあり、
 * doc を書き換えない。doc を差し替える経路は 2 つだけ:
 *   - JSON パネルの編集（丸ごと差し替え）
 *   - DocPanel での手順書編集（該当ステップの doc だけを差し替え）
 * どちらも editedDoc に載せるので、「元データ + 編集」という構図は変わらない。
 *
 * 画面は 2 モードある。既定は閲覧（view）で、フローを大きく見せることに全振りする。
 * 編集（edit）に切り替えたときだけ JSON パネル・データ選択・折りたたみ指定が現れる。
 */

/** 初回ヒントを閉じたことを覚えておく鍵 */
const HINT_KEY = 'flow-viewer:hint-dismissed'
/** 選んだテーマを覚えておく鍵 */
const THEME_KEY = 'flow-viewer:theme'

/** 前回選んだテーマ。無ければ既定（ライト） */
function loadTheme(): Theme {
  try {
    return localStorage.getItem(THEME_KEY) === 'dark' ? 'dark' : DEFAULT_THEME
  } catch {
    return DEFAULT_THEME
  }
}

/** doc の木から id のステップを探す。見つからなければ null */
function findStep(steps: readonly FlowStep[], id: string): FlowStep | null {
  for (const step of steps) {
    if (step.id === id) return step
    const hit = step.children ? findStep(step.children, id) : null
    if (hit) return hit
  }
  return null
}

/**
 * id のステップの doc だけを差し替えた新しい木を返す。
 * 既存のオブジェクトは一切書き換えない（イミュータブル）。
 * 空文字なら doc: undefined にして、JSON.stringify の時点でキーごと消えるようにしてある。
 */
function replaceStepDoc(steps: readonly FlowStep[], id: string, md: string): FlowStep[] {
  return steps.map((step) => {
    if (step.id === id) return { ...step, doc: md.trim() === '' ? undefined : md }
    if (!step.children) return step
    return { ...step, children: replaceStepDoc(step.children, id, md) }
  })
}

export default function App() {
  // 既定は閲覧モード。JSON もデータ選択も出さず、キャンバスを全幅で使う
  const [mode, setMode] = useState<UiMode>('view')
  // 既定は drilldown。上位ではグループ名だけを見せ、中身は潜って初めて分かる形
  const [viewMode, setViewMode] = useState<ViewMode>('drilldown')
  const [collapsed, setCollapsed] = useState<CollapseState>(new Set())
  const [direction, setDirection] = useState<Direction>('RIGHT')
  const [drillRoot, setDrillRoot] = useState<string | null>(null)
  // 直前の階層。アニメーションの向き（潜った / 戻った）の判定に使う
  const [prevDrillRoot, setPrevDrillRoot] = useState<string | null>(null)
  // 1 つ上の階層を薄く出す。潜ったときに現在地を見失わないため
  const [showContext, setShowContext] = useState(true)
  const [animate, setAnimate] = useState(true)
  // split の左ペインを「経路を入れ子で展開」で描く（既定 ON）
  const [nestPath, setNestPath] = useState(true)
  const [sideOpen, setSideOpen] = useState(true)
  // 配色。ルート要素の data-theme で CSS 変数が切り替わる（キャンバスも同じ変数を読む）
  const [theme, setTheme] = useState<Theme>(loadTheme)
  // 選択中のノード。ドリルダウンとは別概念で、選んでも表示階層は変わらない
  const [selectedId, setSelectedId] = useState<string | null>(null)

  // 操作説明は文字で常設せず、初回だけ出して閉じられるようにする
  const [hintOpen, setHintOpen] = useState(() => {
    try {
      return localStorage.getItem(HINT_KEY) !== '1'
    } catch {
      // プライベートモード等で localStorage が触れない場合は毎回出す
      return true
    }
  })

  // 手書きサンプル / 任意深さの自動生成 / 32 種のテストケース を切り替えられる
  const [dataSel, setDataSel] = useState<DataSel>(DEFAULT_DATA_SEL)
  // 編集された doc。null なら dataSel が指す元データをそのまま使う
  const [editedDoc, setEditedDoc] = useState<FlowDoc | null>(null)
  // 編集のたびに増やす。エラー境界の復帰の鍵に混ぜて「直したら再描画」を成立させる
  const [editSeq, setEditSeq] = useState(0)

  const resolved = useMemo(() => resolveDoc(dataSel), [dataSel])
  const doc = editedDoc ?? resolved.doc
  const flat = useMemo(() => flattenDoc(doc), [doc])
  const stats = useMemo(() => measureFlow(doc), [doc])

  /* --- 編集で id が消えることがあるので、描画へ渡す前に実在するものだけに寄せる ---
     編集中の JSON からノードを消すと現在地が宙に浮く。effect で後から直すと
     1 フレームだけ壊れた状態が描画へ渡ってしまうため、レンダー時に解決している。 */
  const safeDrillRoot = drillRoot !== null && flat.byId.has(drillRoot) ? drillRoot : null
  const safePrevDrillRoot = prevDrillRoot !== null && flat.byId.has(prevDrillRoot) ? prevDrillRoot : null
  const safeCollapsed = useMemo<CollapseState>(() => {
    const stale = [...collapsed].some((id) => !flat.byId.has(id))
    // 参照が変わると再描画が走るので、消す必要が無いときは元の Set をそのまま返す
    return stale ? new Set([...collapsed].filter((id) => flat.byId.has(id))) : collapsed
  }, [collapsed, flat])
  // 選択も同じ理屈。消えた id を選んだままにせず、そのままパネルを閉じる
  const safeSelectedId = selectedId !== null && flat.byId.has(selectedId) ? selectedId : null
  const selectedStep = useMemo(
    () => (safeSelectedId === null ? null : findStep(doc.root, safeSelectedId)),
    [doc, safeSelectedId],
  )

  const handleDataSel = useCallback((d: DataSel) => {
    setDataSel(d)
    // データが変わると id 体系ごと別物になるので、階層の状態も編集も選択も捨てる
    setEditedDoc(null)
    setDrillRoot(null)
    setPrevDrillRoot(null)
    setCollapsed(new Set())
    setSelectedId(null)
  }, [])

  const handleApplyDoc = useCallback((next: FlowDoc) => {
    setEditedDoc(next)
    setEditSeq((n) => n + 1)
  }, [])

  const handleResetDoc = useCallback(() => {
    setEditedDoc(null)
    setEditSeq((n) => n + 1)
  }, [])

  // 更新関数の中から「今の doc」を参照するための箱。
  // handleDocChange を doc 依存で作り直すと DocPanel が毎描画で作り直されるため、
  // 依存を持たせずに最新値だけを見る形にしている
  const docRef = useRef(doc)
  docRef.current = doc

  /** DocPanel からの手順書の保存。木の該当ステップだけを差し替えて doc を作り直す */
  const handleDocChange = useCallback((id: string, md: string) => {
    setEditedDoc((cur) => {
      // 未編集なら今表示している doc（＝元データ）を土台にする
      const base = cur ?? docRef.current
      return { ...base, root: replaceStepDoc(base.root, id, md) }
    })
    setEditSeq((n) => n + 1)
  }, [])

  const handleToggleCollapse = useCallback((id: string) => {
    setCollapsed((cur) => toggleCollapsed(cur, id))
  }, [])

  const handleCollapseAll = useCallback(() => {
    // 深さ 0 のコンテナ（＝部門）だけを畳む。中の入れ子は畳まれた側に含まれる
    setCollapsed(new Set(flat.containerIds.filter((id) => flat.byId.get(id)?.depth === 0)))
  }, [flat])

  const handleCollapseDepth = useCallback(
    (depth: number) => {
      setCollapsed(new Set(flat.containerIds.filter((id) => flat.byId.get(id)?.depth === depth)))
    },
    [flat],
  )

  const handleExpandAll = useCallback(() => setCollapsed(new Set()), [])

  const handleDrillDown = useCallback((id: string | null) => {
    setDrillRoot((cur) => {
      setPrevDrillRoot(cur) // 遷移の向きを判定するため直前値を残す
      return id
    })
    // 潜った先は中身が見えるべきなので、その配下の折りたたみは解除する
    if (id !== null) setCollapsed((cur) => new Set([...cur].filter((c) => c !== id)))
  }, [])

  const handleViewMode = useCallback((m: ViewMode) => {
    setViewMode(m)
    // モードを跨ぐと状態の意味が変わるのでリセットする。
    // drilldown では collapsed は使わず、nested では drillRoot の意味が変わるため
    setCollapsed(new Set())
    setDrillRoot(null)
  }, [])

  // data-theme は .app に付けるが、Safari のオーバースクロールでは html / body の地が
  // 一瞬見える。デモ（＝ホスト役）の責務として <html> にも同じ値を写しておく
  useEffect(() => {
    document.documentElement.dataset.theme = theme
  }, [theme])

  const handleTheme = useCallback((t: Theme) => {
    setTheme(t)
    try {
      localStorage.setItem(THEME_KEY, t)
    } catch {
      // 覚えられなくても次回ライトに戻るだけなので、失敗は無視してよい
    }
  }, [])

  const dismissHint = useCallback(() => {
    setHintOpen(false)
    try {
      localStorage.setItem(HINT_KEY, '1')
    } catch {
      // 覚えられなくてもヒントが再び出るだけなので、失敗は無視してよい
    }
  }, [])

  const isEdit = mode === 'edit'
  // 手順書が空のノードを選んだだけでパネルを開くと、閲覧の邪魔にしかならない。
  // 編集モードでは「これから書く」ために空でも開く
  const showDoc = selectedStep !== null && (isEdit || (selectedStep.doc ?? '').trim() !== '')

  return (
    <div className="app" data-theme={theme}>
      <Toolbar
        mode={mode}
        onMode={setMode}
        flat={flat}
        dataSel={dataSel}
        onDataSel={handleDataSel}
        stats={stats}
        viewMode={viewMode}
        onViewMode={handleViewMode}
        direction={direction}
        onDirection={setDirection}
        collapsed={safeCollapsed}
        onToggleCollapse={handleToggleCollapse}
        onCollapseAll={handleCollapseAll}
        onExpandAll={handleExpandAll}
        onCollapseDepth={handleCollapseDepth}
        drillRoot={safeDrillRoot}
        onDrillDown={handleDrillDown}
        showContext={showContext}
        onShowContext={setShowContext}
        animate={animate}
        onAnimate={setAnimate}
        nestPath={nestPath}
        onNestPath={setNestPath}
        sideOpen={sideOpen}
        onToggleSide={() => setSideOpen((v) => !v)}
        theme={theme}
        onTheme={handleTheme}
      />

      {/* テストケースは「何を検証するデータか」が分かって初めて意味を持つ。
          ただし選べるのは編集モードだけなので、帯も編集モードにだけ出す */}
      {isEdit && resolved.testCase && (
        <div className="case-banner">
          <strong>{resolved.testCase.label}</strong>
          <span className="purpose">{resolved.testCase.purpose}</span>
          <span className="chip-list">
            {resolved.testCase.stress.map((s) => (
              <span key={s} className="chip static">
                {s}
              </span>
            ))}
          </span>
        </div>
      )}

      <div className="stage">
        <div className="canvas-wrap">
          <CanvasErrorBoundary resetKey={`${dataSel}|${viewMode}|${direction}|${editSeq}`}>
            {/* key でキャンバスを作り直しているのは、JSON パネルの出入りで幅が
                1280 ⇄ 820 と変わったときにレイアウトを取り直させるため。
                LogicFlow 側は幅の変化を検知してもノード配置とフィットを計算し直さず、
                前の幅のまま縮こまって描かれてしまう（実測: 1280 幅に 764px のフロー）。
                手順書パネルは重ねて出すのでここには影響しない。 */}
            <FlowCanvas
              key={isEdit && sideOpen ? 'narrow' : 'wide'}
              doc={doc}
              flat={flat}
              viewMode={viewMode}
              collapsed={safeCollapsed}
              onToggleCollapse={handleToggleCollapse}
              direction={direction}
              drillRoot={safeDrillRoot}
              onDrillDown={handleDrillDown}
              prevDrillRoot={safePrevDrillRoot}
              showContext={showContext}
              animate={animate}
              nestPath={nestPath}
              selectedId={safeSelectedId}
              onSelect={setSelectedId}
            />
          </CanvasErrorBoundary>

          {/* 手順書はキャンバスに重ねる。閲覧モードでも読めるが、
              常設しないのでフローの幅を削らない。
              置き場所の箱（.doc-dock）は DocPanel 自身が root として描く。幅のドラッグと
              全画面を SidePanel と同じくパネルの中で完結させるため（styles.css の .doc-dock 参照） */}
          {showDoc && (
            <DocPanel
              step={selectedStep}
              editable={isEdit}
              onChange={handleDocChange}
              onClose={() => setSelectedId(null)}
            />
          )}

          {/* 操作の説明は初回だけ。閉じたら二度と出さない */}
          {!isEdit && hintOpen && (
            <div className="hint-bubble" role="note">
              <span>クリックで詳細、ダブルクリックでグループの中へ。</span>
              <button className="ghost" onClick={dismissHint} title="今後表示しない">
                ✕
              </button>
            </div>
          )}
        </div>

        {/* 閲覧モードでは open=false になり、SidePanel 自身が null を返して場所を取らない。
            条件分岐でアンマウントしないのは、タブ・幅・スクロール位置といった
            「見る側の状態」をモードの往復で失わせないため（SidePanel の設計意図に合わせる） */}
        <SidePanel
          open={isEdit && sideOpen}
          doc={doc}
          flat={flat}
          viewMode={viewMode}
          collapsed={safeCollapsed}
          drillRoot={safeDrillRoot}
          testCase={resolved.testCase}
          onApplyDoc={handleApplyDoc}
          onResetDoc={handleResetDoc}
          edited={editedDoc !== null}
        />
      </div>
    </div>
  )
}

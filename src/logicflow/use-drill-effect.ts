/**
 * LogicFlow アダプタ — nested / drilldown モードの描画 effect。
 *
 * LogicFlow インスタンスを 1 つだけ作り、viewMode で
 *   nested    … 全階層を入れ子で描き dynamic-group の折りたたみを使う
 *   drilldown … この階層ぶんのデータだけを render() し直す（+ 任意でコンテキスト層）
 * を切り替える。split は専用の effect（use-split-effect.ts）が 2 インスタンスを面倒みる。
 *
 * #19 でレイアウトが ELK（非同期）になったので、effect は
 *   (1) await を含む「組み立て」 → (2) await を 1 つも含まない「描画」
 * の 2 段構成にしてある。世代カウンタ（genRef）で (1) の途中に依存が変わった描画を捨て、
 * (2) を同期で走らせることで「cleanup が await をまたぐ」レースを構造的に無くしている。
 */

import { useEffect, useRef } from 'react'
import LogicFlow from '@logicflow/core'

import type { FlowViewProps, ViewMode } from '../flow/view-props'
import type { DrillTransition } from '../flow/collapse'
import { drillTransition, levelView, nodesAtLevel, nodesUnder } from '../flow/collapse'
import type { FlatNode } from '../flow/flatten'
import type { LinkKind } from '../flow/schema'
import { ANIM, FIT } from '../flow/theme'
import type { Viewport } from './anim'
import {
  DRILL_ZOOM_FACTOR,
  VIEW_ANIM_CLASS,
  applyViewport,
  ensureAnimStyles,
  fitViewport,
  ghostFactor,
  scaleAbout,
  spawnGhost,
  transitionViewport,
  tweenLayout,
} from './anim'
import { pickAutoCollapse } from './auto-collapse'
import { docIdsOf } from './doc-index'
import { buildDrillGraph, buildFocusContextGraph } from './drilldown'
import type { Bounds, LayoutCtx, Placed, Point } from './layout'
import { arrange, edgeKeysOf, emitArranged, routeOf } from './layout'
import type { CollapseEventArgs, DynamicGroupModel, LayoutSnapshot } from './lf'
import { createLogicFlow } from './lf'
import type { LFEdgeConfig, LFNodeConfig } from './nodes'
import {
  BADGE_CLASS,
  EDGE_TYPE,
  applySelection,
  edgeRouteConfig,
  edgeStyleOf,
  registerAppNodes,
  toLfEdge,
  toLfNode,
} from './nodes'

/** LogicFlow がノードイベントに渡す引数のうち、ここで使うものだけ */
type NodeEventArgs = { data?: { id?: string }; e?: MouseEvent }

/**
 * 「中を見る」バッジの上で押されたか。
 * 単一クリックは原則「選択」だが、バッジだけは押した瞬間に潜れるほうが自然なので例外にする。
 */
function isBadgeHit(e: MouseEvent | undefined): boolean {
  const target = e?.target
  if (!(target instanceof Element)) return false
  return target.closest(`.${BADGE_CLASS}`) !== null
}

/** nested のスコープ（drillRoot 配下、無ければ全体）。自動抽象化の判定と描画の両方で同じ集合を使う */
function nestedScope(flat: FlowViewProps['flat'], links: FlowViewProps['doc']['links'], drillRoot: string | null) {
  const scopeNodes = drillRoot ? nodesUnder(flat.nodes, flat.parentOf, drillRoot) : flat.nodes.slice()
  const scopeIds = new Set(scopeNodes.map((n) => n.id))
  const topIds = drillRoot
    ? (flat.byId.get(drillRoot)?.childIds ?? [])
    : flat.nodes.filter((n) => n.parentId === undefined).map((n) => n.id)
  const scopeLinks = links.filter((l) => scopeIds.has(l.from) && scopeIds.has(l.to))
  return { scopeNodes, scopeIds, topIds, scopeLinks }
}

/**
 * await を含む組み立ての結果。ここから先（描画）は同期で走らせる。
 * nested は render() 後に折りたたみと穴埋めを行うので、そのための集合も持たせる。
 */
type DrawPlan = {
  nodes: LFNodeConfig[]
  edges: LFEdgeConfig[]
  width: number
  height: number
  positions: Map<string, Placed>
  /** 視野合わせの基準（ノード実体だけの外接矩形）と、主軸の先頭ノード */
  nodeBox: Bounds
  headBox: Bounds
  outOfScopeCount: number
  boundaryCount: number
  contextIds: Set<string>
  contextParentId: string | null
  contextInfo: { count: number; crossing: number; parent: string } | null
  /** nested のときだけ。折りたたみ適用と境界エッジの穴埋めに使う */
  nested: {
    scopeNodes: readonly FlatNode[]
    scopeIds: ReadonlySet<string>
    /** 折りたたみ中のグループをまたぐ線の配線。key は `<始点>-><終点>` */
    projected: ReadonlyMap<string, Point[]>
  } | null
}

export type DrillEffectParams = {
  doc: FlowViewProps['doc']
  flat: FlowViewProps['flat']
  collapsed: FlowViewProps['collapsed']
  direction: FlowViewProps['direction']
  drillRoot: string | null
  viewMode: ViewMode
  prevDrillRoot: string | null
  showContext: boolean
  animate: boolean
  wrapRef: { current: HTMLDivElement | null }
  hostRef: { current: HTMLDivElement | null }
  ghostHostRef: { current: HTMLDivElement | null }
  lfRef: { current: LogicFlow | null }
  /** 選択中ノード。描画のやり直しを避けるため effect の依存には入れない（applySelection で反映） */
  selectedId: string | null
  cbRef: {
    current: {
      onToggleCollapse: (id: string) => void
      onDrillDown: (id: string | null) => void
      onSelect: (id: string | null) => void
      onAutoCollapse: ((ids: string[]) => void) | undefined
    }
  }
  syncingRef: { current: boolean }
  ghostRef: { current: string | null }
  prevLayoutRef: { current: LayoutSnapshot | null }
  prevViewportRef: { current: Viewport | null }
  lastRootRef: { current: string | null | undefined }
  /** 「全体を表示」（fitAll）の実体。描画のたびに今の内容で登録し直し、cleanup で外す */
  fitAllRef: { current: (() => void) | null }
  /** nested の自動抽象化を適用済みの (doc, viewMode)。同じ組では二度と適用しない */
  autoCollapsedRef: { current: { doc: FlowViewProps['doc']; viewMode: ViewMode } | null }
  setError: (v: string | null) => void
  setOutOfScopeLinks: (v: number) => void
  setBoundaryMarkers: (v: number) => void
  setContextInfo: (v: { count: number; crossing: number; parent: string } | null) => void
  setSplitInfo: (v: { upper: number; lower: number; linked: number; cross: number } | null) => void
  setNestInfo: (
    v: {
      levels: number
      boxDepth: number
      omitted: { id: string; label: string }[]
      outOfScope: number
      scale: number
    } | null,
  ) => void
}

/** nested / drilldown 用の描画 effect。元は FlowCanvas 本体にあったものをそのまま切り出した */
export function useDrillEffect(params: DrillEffectParams) {
  const {
    doc,
    flat,
    collapsed,
    direction,
    drillRoot,
    viewMode,
    prevDrillRoot,
    showContext,
    animate,
    selectedId,
    wrapRef,
    hostRef,
    ghostHostRef,
    lfRef,
    cbRef,
    syncingRef,
    ghostRef,
    prevLayoutRef,
    prevViewportRef,
    lastRootRef,
    fitAllRef,
    autoCollapsedRef,
    setError,
    setOutOfScopeLinks,
    setBoundaryMarkers,
    setContextInfo,
    setSplitInfo,
    setNestInfo,
  } = params

  /**
   * 描画の世代。effect が走るたびに 1 つ進め、cleanup でも進める。
   * await から戻った時点で自分の世代でなければ、DOM にも ref にも一切触らずに降りる。
   */
  const genRef = useRef(0)

  useEffect(() => {
    ensureAnimStyles()
    // split は専用の effect が 2 インスタンスを面倒みる。
    // ここで早期 return しないと 3 つ目のインスタンスができてしまう。
    if (viewMode === 'split') {
      setOutOfScopeLinks(0)
      setBoundaryMarkers(0)
      setContextInfo(null)
      // 使われないまま残ると、split から戻ったときに古い絵が一瞬出る
      ghostRef.current = null
      prevLayoutRef.current = null
      prevViewportRef.current = null
      return
    }
    setSplitInfo(null)
    setNestInfo(null)
    const host = hostRef.current
    const wrap = wrapRef.current
    if (!host || !wrap) return

    const gen = ++genRef.current
    let lf: LogicFlow | null = null
    /** 描画まで到達したか。到達していないなら cleanup は ghost も host も触らない */
    let rendered = false

    /* キャンバス実寸は視野合わせ（fitViewport）と自動抽象化の判定にだけ使う。 */
    const cw = host.clientWidth || 800
    const ch = host.clientHeight || 600

    const rafIds: number[] = []
    const timers: number[] = []
    const disposers: (() => void)[] = [
      () => {
        for (const id of rafIds) cancelAnimationFrame(id)
        for (const t of timers) window.clearTimeout(t)
      },
    ]

    /* ============================================================ *
     * (1) 組み立て — await を含む。DOM も ref も一切触らない
     * ============================================================ */
    const build = async (): Promise<DrawPlan> => {
      const docIds = docIdsOf(doc)
      if (viewMode === 'drilldown') {
        /* ドリルダウン: 1 画面 = 1 階層（+ 任意でコンテキスト層）。
         * LogicFlow に「潜る」API は無いので、この階層ぶんのデータだけを組み立てて
         * render() し直す。孫は一切流し込まない。                                */
        const useContext = showContext && drillRoot !== null
        if (useContext) {
          const view = levelView(flat.nodes, flat.parentOf, flat.byId, drillRoot)
          if (view.focus.length === 0) {
            throw new Error(`ドリルダウン先 ${String(drillRoot)} に子ノードがありません`)
          }
          const graph = await buildFocusContextGraph(view, doc.links, flat, direction, docIds)
          return {
            ...graph,
            contextParentId: view.contextParent?.id ?? null,
            contextInfo: {
              count: view.context.length,
              crossing: graph.crossingCount,
              parent: view.contextParent?.label ?? 'トップ階層',
            },
            nested: null,
          }
        }
        const levelNodes = nodesAtLevel(flat.nodes, flat.parentOf, drillRoot)
        if (levelNodes.length === 0) {
          throw new Error(`ドリルダウン先 ${String(drillRoot)} に子ノードがありません`)
        }
        const graph = await buildDrillGraph(levelNodes, doc.links, flat, drillRoot, direction, docIds)
        return { ...graph, contextParentId: null, contextInfo: null, nested: null }
      }

      /* nested: 全階層を入れ子で描く。各階層の中身と箱をまたぐ線は ELK が 1 回で並べる */
      const { scopeNodes, scopeIds, topIds, scopeLinks } = nestedScope(flat, doc.links, drillRoot)
      if (scopeNodes.length === 0) {
        throw new Error(`ドリルダウン先 ${String(drillRoot)} に子ノードがありません`)
      }
      const ctx: LayoutCtx = { byId: flat.byId, links: scopeLinks, collapsed, direction }
      const root = await arrange(topIds, ctx)
      const emitted = emitArranged(root, 0, 0)
      // 配線が取れるのは「この階層で見えている箱どうし」を結ぶリンクだけ。
      // 折りたたみ中のグループの中身へ刺さるリンクは LogicFlow の仮想エッジに任せる
      const routeKeys = edgeKeysOf(scopeLinks)
      // flat.nodes は親が子より前に並んでいるのでそのまま使える
      const nodes = scopeNodes
        .map((n) => {
          const at = emitted.positions.get(n.id)
          return at ? toLfNode(n, at, docIds.has(n.id)) : null
        })
        .filter((n): n is LFNodeConfig => n !== null)
      const edges: LFEdgeConfig[] = scopeLinks.map((l, i) =>
        toLfEdge(l, i, routeOf(emitted, routeKeys[i])),
      )
      return {
        nodes,
        edges,
        width: root.width,
        height: root.height,
        positions: emitted.positions,
        nodeBox: emitted.nodeBox,
        headBox: emitted.headBox,
        outOfScopeCount: 0,
        boundaryCount: 0,
        contextIds: new Set<string>(),
        contextParentId: null,
        contextInfo: null,
        nested: { scopeNodes, scopeIds, projected: emitted.projected },
      }
    }

    /* ============================================================ *
     * (2) 描画 — ここから最後まで await を 1 つも挟まない。
     *     途中で React が cleanup を走らせることはないので、
     *     ref の書き込み順と destroy の順序が壊れない。
     * ============================================================ */
    const draw = (plan: DrawPlan) => {
      // 実際に階層が変わったときだけ、共通レイヤの判定を使って向きを決める
      const rootChanged = lastRootRef.current !== drillRoot
      const transition: DrillTransition = rootChanged
        ? drillTransition(prevDrillRoot, drillRoot, flat.parentOf)
        : 'none'
      lastRootRef.current = drillRoot

      // 前回描画のゴーストは、animate が OFF なら黙って捨てる
      const pendingGhost = ghostRef.current
      ghostRef.current = null

      /* --- 消えていく前の絵をゴーストとして重ね、フェードアウトさせる --- *
       * LogicFlow の render() はグラフを丸ごと作り直すので「消えるノード」を
       * 個別にフェードアウトさせる手段が無い。そこで直前の DOM を丸ごと
       * スナップショットして WAAPI で 1 枚絵として送り出す。            */
      if (animate) {
        spawnGhost(ghostHostRef.current, pendingGhost, ghostFactor(transition), disposers, timers)
      }

      // ghost の生成は createLogicFlow より前（host の中身を撮り終えてから作り直す）
      const instance = createLogicFlow(host)
      lf = instance
      rendered = true
      lfRef.current = instance
      // ホバー / 選択 / バッジ / 手順書マークを持つカスタムノード型（rect・diamond）を登録する
      registerAppNodes(instance)

      instance.render({ nodes: plan.nodes, edges: plan.edges })
      setOutOfScopeLinks(plan.outOfScopeCount)
      setBoundaryMarkers(plan.boundaryCount)
      setContextInfo(plan.contextInfo)

      if (plan.nested !== null) {
        applyNestedCollapse(instance, plan.nested)
      }

      /* --- 視野合わせ（fitView は非表示の子ノードまで含めてしまうので自前で計算） --- *
       * 既定は読める縮尺の下限（FIT.minReadable）付き。はみ出しはパンで見る。          */
      const fitFrame = { nodes: plan.nodeBox, anchor: plan.headBox }
      const finalVp = fitViewport(plan.width, plan.height, cw, ch, fitFrame)
      const prevVp = prevViewportRef.current

      // 「全体を表示」: 同じ内容を下限なしで収める。次の同階層の再描画はこの位置から補間する
      const fitTarget = instance
      fitAllRef.current = () => {
        const vp = fitViewport(plan.width, plan.height, cw, ch, { ...fitFrame, minScale: FIT.minScale })
        transitionViewport(fitTarget, wrap, vp, animate, timers)
        prevViewportRef.current = vp
      }
      disposers.push(() => {
        fitAllRef.current = null
      })

      // アニメーション時だけ「始点」を作る。潜る→少し引いた位置から寄る、戻る→寄った位置から引く。
      // 階層が変わらない再描画（方向切替など）は、直前のビューポートから補間する。
      let startVp: Viewport | null = null
      if (animate) {
        if (transition === 'enter') startVp = scaleAbout(finalVp, 1 / DRILL_ZOOM_FACTOR, cw, ch)
        else if (transition === 'exit') startVp = scaleAbout(finalVp, DRILL_ZOOM_FACTOR, cw, ch)
        else if (prevVp !== null) startVp = prevVp
      }
      applyViewport(instance, startVp ?? finalVp)
      prevViewportRef.current = finalVp

      if (animate && startVp !== null) {
        const target = instance
        // transition を付ける前に始点が 1 度ペイントされている必要があるので rAF を 2 段にする
        const raf1 = requestAnimationFrame(() => {
          wrap.classList.add(VIEW_ANIM_CLASS)
          const raf2 = requestAnimationFrame(() => {
            try {
              applyViewport(target, finalVp)
            } catch (e: unknown) {
              setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
            }
          })
          rafIds.push(raf2)
        })
        rafIds.push(raf1)
        const off = window.setTimeout(() => wrap.classList.remove(VIEW_ANIM_CLASS), ANIM.drill + 80)
        timers.push(off)
        disposers.push(() => wrap.classList.remove(VIEW_ANIM_CLASS))
      }

      /* --- レイアウト変更のトゥイーン --- *
       * ノードの絶対座標を LogicFlow のモデル API（moveNode2Coordinate）で
       * 毎フレーム動かす。エッジは MobX 経由で自動追従するので線も一緒に動く。
       * nested モードでは dynamic-group の折りたたみが x/y を自前で書き換えるため、
       * 競合を避けて drilldown モードのときだけ動かす。                         */
      const prevLayout = prevLayoutRef.current
      prevLayoutRef.current = { mode: viewMode, positions: plan.positions }
      if (
        animate &&
        transition === 'none' &&
        viewMode === 'drilldown' &&
        prevLayout !== null &&
        prevLayout.mode === 'drilldown'
      ) {
        tweenLayout(instance, prevLayout.positions, plan.positions, rafIds, setError)
      }

      bindEvents(instance, plan)
      // 描画し直した直後は選択枠が消えているので、その場で貼り直す
      applySelection(host, selectedId)
      setError(null)
    }

    /**
     * 折れ線を LogicFlow のエッジモデルに書き戻す。
     * PolylineEdgeModel.updatePath() は pointsList と points（描画に使う文字列）だけを差し替え、
     * startPoint / endPoint は触らない（nested はノードを動かさないのでこれで整合する）。
     */
    const applyRoute = (target: LogicFlow, id: string, points: readonly Point[]) => {
      const model = target.getEdgeModelById(id) as unknown as
        | { updatePath?: (pts: Point[]) => void }
        | undefined
      if (model === undefined || typeof model.updatePath !== 'function') return false
      model.updatePath(points.map((p) => ({ x: p.x, y: p.y })))
      return true
    }

    /** nested の折りたたみ適用と、標準機能の穴埋め（入れ子折りたたみで消えたエッジの復元） */
    const applyNestedCollapse = (target: LogicFlow, nested: NonNullable<DrawPlan['nested']>) => {
      const { scopeNodes, scopeIds, projected } = nested
      // --- 折りたたみ：ここが検証の本体。標準 API だけを呼ぶ ---
      syncingRef.current = true
      const targets = scopeNodes
        .filter((n) => n.isContainer && collapsed.has(n.id))
        .sort((a, b) => a.depth - b.depth) // 外側から畳む（内側は標準実装が再帰で畳む）
      for (const n of targets) {
        const model = target.getNodeModelById(n.id) as unknown as DynamicGroupModel | undefined
        if (model && !model.isCollapsed) model.toggleCollapse(true)
      }
      syncingRef.current = false

      // 実測: 1 段の折りたたみは createVirtualEdge が正しく働くが、
      // グループ in グループを畳むと親の collapseEdge が子の虚拟辺を無条件 delete し、
      // 代わりの辺も作らないため境界エッジが全滅する。ここだけ自前で補う。
      const outermostCollapsed = (id: string): string => {
        let result = id
        for (let cur = flat.parentOf.get(id); cur !== undefined; cur = flat.parentOf.get(cur)) {
          if (!scopeIds.has(cur)) break
          if (collapsed.has(cur)) result = cur
        }
        return result
      }
      const seen = new Set<string>()
      const snapshot = [...target.graphModel.edges]
      for (const e of snapshot) if (e.visible) seen.add(`${e.sourceNodeId}->${e.targetNodeId}`)
      let repaired = 0
      for (const e of snapshot) {
        if (e.visible || e.virtual) continue
        const s = outermostCollapsed(e.sourceNodeId)
        const t = outermostCollapsed(e.targetNodeId)
        if (s === t) continue
        const key = `${s}->${t}`
        if (seen.has(key)) continue
        seen.add(key)
        const kind = (e.properties?.linkKind as LinkKind | undefined) ?? 'normal'
        // 矢尻の形（loopback hollow / exception circle）を揃えるため同じ edge model を使う。
        // 配線は ELK が射影した辺として返しているので、そのまま渡して自動経路に落とさない
        const route = projected.get(key)
        target.addEdge({
          id: `repair-${repaired++}`,
          type: EDGE_TYPE.polyline,
          sourceNodeId: s,
          targetNodeId: t,
          ...edgeRouteConfig(route === undefined ? undefined : { points: [...route] }, ''),
          properties: { linkKind: kind, style: edgeStyleOf(kind) },
        })
      }

      /* --- 畳んだ箱をまたぐ線に ELK の配線を当てる（#19 レビュー HIGH 3） ---
       * LogicFlow の仮想エッジは pointsList を undefined にして作られる（model.js の
       * createVirtualEdge）ので、当てないと自動経路のまま畳んだ箱を貫通する。
       * 同じ端点の仮想エッジは実エッジ 1 本につき 1 本できるが、ELK には 1 本しか渡していないので
       * 同じ折れ線を当てると重なって 1 本に見える。                                          */
      for (const e of target.graphModel.edges) {
        if (!e.visible) continue
        const isRepair = String(e.id).startsWith('repair-')
        if (!e.virtual && !isRepair) continue
        const pts = projected.get(`${e.sourceNodeId}->${e.targetNodeId}`)
        if (pts !== undefined) applyRoute(target, String(e.id), pts)
      }
    }

    /** --- イベント購読 --- */
    const bindEvents = (target: LogicFlow, plan: DrawPlan) => {
      const onCollapse = (args: CollapseEventArgs) => {
        if (syncingRef.current) return
        const id = args?.nodeModel?.id
        if (id) cbRef.current.onToggleCollapse(id)
      }
      /* --- クリックの割り当て（両担当が守る契約） ---
       *   単一クリック  → 選択（表示階層は変えない）
       *   ダブルクリック → 潜る（グループのみ）
       *   「中を見る」バッジの単一クリックだけは例外で、その場で潜る
       *   空白クリック  → 選択解除
       * 擬似ノード（境界マーカーの __edge: … など）は doc を持てないので選択させない。 */
      const onNodeClick = (args: NodeEventArgs) => {
        const id = args?.data?.id
        if (!id) return
        const node = flat.byId.get(id)
        if (isBadgeHit(args.e) && node?.isContainer === true) {
          cbRef.current.onDrillDown(id)
          return
        }
        cbRef.current.onSelect(node === undefined ? null : id)
      }
      const onNodeDbl = (args: NodeEventArgs) => {
        const id = args?.data?.id
        if (!id) return
        const node = flat.byId.get(id)
        if (plan.contextIds.has(id)) {
          // コンテキスト層: グループならその中へ、葉なら 1 つ上の階層へ戻る
          cbRef.current.onDrillDown(node?.isContainer === true ? id : plan.contextParentId)
          return
        }
        if (node?.isContainer) cbRef.current.onDrillDown(id)
      }
      const onBlankClick = () => cbRef.current.onSelect(null)
      target.on('dynamicGroup:collapse', onCollapse)
      target.on('node:dbclick', onNodeDbl)
      target.on('node:click', onNodeClick)
      target.on('blank:click', onBlankClick)
      disposers.push(() => {
        target.off('dynamicGroup:collapse', onCollapse)
        target.off('node:dbclick', onNodeDbl)
        target.off('node:click', onNodeClick)
        target.off('blank:click', onBlankClick)
      })
    }

    const run = async () => {
      /* --- nested の自動抽象化（#15）: 初期表示で読める縮尺を割る深さを畳む --- *
       * collapsed が空で、この (doc, viewMode) でまだ判定していないときだけ 1 回判定する
       * （結果が「畳まない」でも判定済みにし、ユーザーの展開 / 折りたたみを上書きしない）。
       * 畳む先が決まったら描画せずに戻る。collapsed が変わって走る次の effect が描くので、
       * 遷移の判定（lastRootRef）とゴースト（ghostRef）はここでは触らず持ち越す。      */
      const onAutoCollapse = cbRef.current.onAutoCollapse
      const judged = autoCollapsedRef.current
      const firstJudge = judged === null || judged.doc !== doc || judged.viewMode !== viewMode
      if (viewMode === 'nested' && onAutoCollapse !== undefined && collapsed.size === 0 && firstJudge) {
        autoCollapsedRef.current = { doc, viewMode }
        const scope = nestedScope(flat, doc.links, drillRoot)
        const ctx: LayoutCtx = { byId: flat.byId, links: scope.scopeLinks, collapsed, direction }
        const full = await arrange(scope.topIds, ctx)
        const containers = scope.scopeNodes.filter((n) => n.isContainer)
        const ids = await pickAutoCollapse(scope.topIds, containers, ctx, full, cw, ch)
        if (gen !== genRef.current) return
        if (ids !== null && ids.length > 0) {
          onAutoCollapse(ids)
          return
        }
      }

      const plan = await build()
      // 依存が変わっていたら DOM も ref も触らずに降りる（cleanup が後始末済み）
      if (gen !== genRef.current) return
      draw(plan)
    }

    run().catch((e: unknown) => {
      if (gen !== genRef.current) return
      const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      setError(message)
      for (const d of disposers) d()
      try {
        lf?.destroy()
      } catch {
        /* destroy 中の二次エラーは初期化エラーを覆い隠すだけなので無視する */
      }
      lf = null
      rendered = false
      lfRef.current = null
      host.innerHTML = ''
      ghostRef.current = null
      prevLayoutRef.current = null
    })

    return () => {
      // 組み立ての途中なら、この世代はもう描かない（await の後で弾かれる）
      genRef.current += 1
      for (const d of disposers) d()
      // 描画まで到達していないなら host も ghost も自分のものではないので触らない
      if (!rendered) return
      // 次の描画へ渡すゴースト。animate が OFF なら残さない（＝即座に切り替わる）
      ghostRef.current = animate ? host.innerHTML : null
      lf?.destroy()
      lf = null
      lfRef.current = null
      host.innerHTML = ''
    }
  }, [doc, flat, collapsed, direction, drillRoot, viewMode, prevDrillRoot, showContext, animate])
}

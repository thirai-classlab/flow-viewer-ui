/**
 * LogicFlow アダプタ — nested / drilldown モードの描画 effect。
 *
 * LogicFlow インスタンスを 1 つだけ作り、viewMode で
 *   nested    … 全階層を入れ子で描き dynamic-group の折りたたみを使う
 *   drilldown … この階層ぶんのデータだけを render() し直す（+ 任意でコンテキスト層）
 * を切り替える。split は専用の effect（use-split-effect.ts）が 2 インスタンスを面倒みる。
 */

import { useEffect } from 'react'
import LogicFlow from '@logicflow/core'

import type { FlowViewProps, ViewMode } from '../flow/view-props'
import type { DrillTransition } from '../flow/collapse'
import { drillTransition, levelView, nodesAtLevel, nodesUnder } from '../flow/collapse'
import type { LinkKind } from '../flow/schema'
import { ANIM } from '../flow/theme'
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
  tweenLayout,
} from './anim'
import { docIdsOf } from './doc-index'
import type { DrillGraph } from './drilldown'
import { buildDrillGraph, buildFocusContextGraph } from './drilldown'
import type { LayoutCtx, Placed } from './layout'
import { arrange, edgeKeysOf, emitArranged, routeOf } from './layout'
import type { CollapseEventArgs, DynamicGroupModel, LayoutSnapshot } from './lf'
import { createLogicFlow } from './lf'
import type { LFNodeConfig } from './nodes'
import {
  BADGE_CLASS,
  applySelection,
  edgeStyleOf,
  registerAppNodes,
  toLfEdge,
  toLfNode,
} from './nodes'

/** LogicFlow がノードイベントに渡す引数のうち、ここで使うものだけ */
type NodeEventArgs = { data?: { id?: string }; e?: MouseEvent }

/**
 * 「▸ 中を見る」バッジの上で押されたか。
 * 単一クリックは原則「選択」だが、バッジだけは押した瞬間に潜れるほうが自然なので例外にする。
 */
function isBadgeHit(e: MouseEvent | undefined): boolean {
  const target = e?.target
  if (!(target instanceof Element)) return false
  return target.closest(`.${BADGE_CLASS}`) !== null
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
    }
  }
  syncingRef: { current: boolean }
  ghostRef: { current: string | null }
  prevLayoutRef: { current: LayoutSnapshot | null }
  prevViewportRef: { current: Viewport | null }
  lastRootRef: { current: string | null | undefined }
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
    setError,
    setOutOfScopeLinks,
    setBoundaryMarkers,
    setContextInfo,
    setSplitInfo,
    setNestInfo,
  } = params

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
    let lf: LogicFlow | null = null

    // 実際に階層が変わったときだけ、共通レイヤの判定を使って向きを決める
    const rootChanged = lastRootRef.current !== drillRoot
    const transition: DrillTransition = rootChanged
      ? drillTransition(prevDrillRoot, drillRoot, flat.parentOf)
      : 'none'
    lastRootRef.current = drillRoot

    // 前回描画のゴーストは、animate が OFF なら黙って捨てる
    const pendingGhost = ghostRef.current
    ghostRef.current = null

    const rafIds: number[] = []
    const timers: number[] = []
    const disposers: (() => void)[] = [
      () => {
        for (const id of rafIds) cancelAnimationFrame(id)
        for (const t of timers) window.clearTimeout(t)
      },
    ]

    try {
      /* --- 消えていく前の絵をゴーストとして重ね、フェードアウトさせる --- *
       * LogicFlow の render() はグラフを丸ごと作り直すので「消えるノード」を
       * 個別にフェードアウトさせる手段が無い。そこで直前の DOM を丸ごと
       * スナップショットして WAAPI で 1 枚絵として送り出す。            */
      if (animate) {
        spawnGhost(ghostHostRef.current, pendingGhost, ghostFactor(transition), disposers, timers)
      }

      lf = createLogicFlow(host)
      lfRef.current = lf
      // ホバー / 選択 / バッジ / 📄 を持つカスタムノード型（rect・diamond）を登録する
      registerAppNodes(lf)

      /* キャンバス実寸は視野合わせ（fitViewport）にだけ使う。
       * レイアウト側の行折り返しは #13 で廃止した（dagre が主軸 1 本に並べ、
       * 収まらないぶんはズーム / パンに任せる）。                        */
      const cw = host.clientWidth || 800
      const ch = host.clientHeight || 600
      const docIds = docIdsOf(doc)

      // 画面に収めるべき描画結果のサイズ。両モードでここに書き込む
      let fitW = 0
      let fitH = 0
      // クリック時にコンテキスト層かどうかを判定するための情報
      let contextIds = new Set<string>()
      let contextParentId: string | null = null
      let positions = new Map<string, Placed>()

      if (viewMode === 'drilldown') {
        /* ============ ドリルダウン: 1 画面 = 1 階層（+ 任意でコンテキスト層） ============ *
         * LogicFlow に「潜る」API は無いので、この階層ぶんのデータだけを
         * 組み立てて render() し直す。孫は一切流し込まない。                        */
        const useContext = showContext && drillRoot !== null
        let graph: DrillGraph
        if (useContext) {
          const view = levelView(flat.nodes, flat.parentOf, flat.byId, drillRoot)
          if (view.focus.length === 0) {
            throw new Error(`ドリルダウン先 ${String(drillRoot)} に子ノードがありません`)
          }
          contextParentId = view.contextParent?.id ?? null
          graph = buildFocusContextGraph(view, doc.links, flat, direction, docIds)
          setContextInfo({
            count: view.context.length,
            crossing: graph.crossingCount,
            parent: view.contextParent?.label ?? 'トップ階層',
          })
        } else {
          const levelNodes = nodesAtLevel(flat.nodes, flat.parentOf, drillRoot)
          if (levelNodes.length === 0) {
            throw new Error(`ドリルダウン先 ${String(drillRoot)} に子ノードがありません`)
          }
          graph = buildDrillGraph(levelNodes, doc.links, flat, drillRoot, direction, docIds)
          setContextInfo(null)
        }
        lf.render({ nodes: graph.nodes, edges: graph.edges })
        setOutOfScopeLinks(graph.outOfScopeCount)
        setBoundaryMarkers(graph.boundaryCount)
        contextIds = graph.contextIds
        positions = graph.positions
        fitW = graph.width
        fitH = graph.height
      } else {
        /* ============ nested: 従来どおり全階層を入れ子で描く ============ */
        setOutOfScopeLinks(0)
        setBoundaryMarkers(0)
        setContextInfo(null)

        // --- スコープ決定（ドリルダウン） ---
        const scopeNodes = drillRoot
          ? nodesUnder(flat.nodes, flat.parentOf, drillRoot)
          : flat.nodes.slice()
        const scopeIds = new Set(scopeNodes.map((n) => n.id))
        const topIds = drillRoot
          ? (flat.byId.get(drillRoot)?.childIds ?? [])
          : flat.nodes.filter((n) => n.parentId === undefined).map((n) => n.id)
        const scopeLinks = doc.links.filter((l) => scopeIds.has(l.from) && scopeIds.has(l.to))

        if (scopeNodes.length === 0) {
          throw new Error(`ドリルダウン先 ${String(drillRoot)} に子ノードがありません`)
        }

        // --- レイアウト（各階層の中身を dagre で並べ、箱詰めで入れ子にする） ---
        const ctx: LayoutCtx = {
          byId: flat.byId,
          links: scopeLinks,
          collapsed,
          direction,
        }
        const root = arrange(topIds, ctx)
        const emitted = emitArranged(root, 0, 0)
        positions = emitted.positions
        // 配線が取れるのは「同じ箱の直下どうし」を結ぶリンクだけ。
        // 箱をまたぐリンクは LogicFlow の自動経路にフォールバックする
        const routeKeys = edgeKeysOf(scopeLinks)

        // --- 流し込み（flat.nodes は親が子より前に並んでいるのでそのまま使える） ---
        const nodes = scopeNodes
          .map((n) => {
            const at = positions.get(n.id)
            return at ? toLfNode(n, at, docIds.has(n.id)) : null
          })
          .filter((n): n is LFNodeConfig => n !== null)
        const edges = scopeLinks.map((l, i) => toLfEdge(l, i, routeOf(emitted, routeKeys[i])))
        lf.render({ nodes, edges })

        // --- 折りたたみ：ここが検証の本体。標準 API だけを呼ぶ ---
        syncingRef.current = true
        const targets = scopeNodes
          .filter((n) => n.isContainer && collapsed.has(n.id))
          .sort((a, b) => a.depth - b.depth) // 外側から畳む（内側は標準実装が再帰で畳む）
        for (const n of targets) {
          const model = lf.getNodeModelById(n.id) as unknown as DynamicGroupModel | undefined
          if (model && !model.isCollapsed) model.toggleCollapse(true)
        }
        syncingRef.current = false

        // --- 標準機能の穴埋め（入れ子折りたたみで消えたエッジの復元） ---
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
        const snapshot = [...lf.graphModel.edges]
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
          lf.addEdge({
            id: `repair-${repaired++}`,
            type: 'polyline',
            sourceNodeId: s,
            targetNodeId: t,
            text: '',
            properties: { linkKind: kind, style: edgeStyleOf(kind) },
          })
        }

        fitW = root.width
        fitH = root.height
      }

      /* --- 視野合わせ（fitView は非表示の子ノードまで含めてしまうので自前で計算） --- */
      const finalVp = fitViewport(fitW, fitH, cw, ch)
      const prevVp = prevViewportRef.current

      // アニメーション時だけ「始点」を作る。潜る→少し引いた位置から寄る、戻る→寄った位置から引く。
      // 階層が変わらない再描画（方向切替など）は、直前のビューポートから補間する。
      let startVp: Viewport | null = null
      if (animate) {
        if (transition === 'enter') startVp = scaleAbout(finalVp, 1 / DRILL_ZOOM_FACTOR, cw, ch)
        else if (transition === 'exit') startVp = scaleAbout(finalVp, DRILL_ZOOM_FACTOR, cw, ch)
        else if (prevVp !== null) startVp = prevVp
      }
      applyViewport(lf, startVp ?? finalVp)
      prevViewportRef.current = finalVp

      if (animate && startVp !== null) {
        const target = lf
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
      prevLayoutRef.current = { mode: viewMode, positions }
      if (
        animate &&
        transition === 'none' &&
        viewMode === 'drilldown' &&
        prevLayout !== null &&
        prevLayout.mode === 'drilldown'
      ) {
        tweenLayout(lf, prevLayout.positions, positions, rafIds, setError)
      }

      // --- イベント購読 ---
      const onCollapse = (args: CollapseEventArgs) => {
        if (syncingRef.current) return
        const id = args?.nodeModel?.id
        if (id) cbRef.current.onToggleCollapse(id)
      }
      /* --- クリックの割り当て（両担当が守る契約） ---
       *   単一クリック  → 選択（表示階層は変えない）
       *   ダブルクリック → 潜る（グループのみ）
       *   「▸ 中を見る」バッジの単一クリックだけは例外で、その場で潜る
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
        if (contextIds.has(id)) {
          // コンテキスト層: グループならその中へ、葉なら 1 つ上の階層へ戻る
          cbRef.current.onDrillDown(node?.isContainer === true ? id : contextParentId)
          return
        }
        if (node?.isContainer) cbRef.current.onDrillDown(id)
      }
      const onBlankClick = () => cbRef.current.onSelect(null)
      const lfForEvents = lf
      lf.on('dynamicGroup:collapse', onCollapse)
      lf.on('node:dbclick', onNodeDbl)
      lf.on('node:click', onNodeClick)
      lf.on('blank:click', onBlankClick)
      disposers.push(() => {
        lfForEvents.off('dynamicGroup:collapse', onCollapse)
        lfForEvents.off('node:dbclick', onNodeDbl)
        lfForEvents.off('node:click', onNodeClick)
        lfForEvents.off('blank:click', onBlankClick)
      })
      // 描画し直した直後は選択枠が消えているので、その場で貼り直す
      applySelection(host, selectedId)
      setError(null)

      const dead = lf
      return () => {
        for (const d of disposers) d()
        // 次の描画へ渡すゴースト。animate が OFF なら残さない（＝即座に切り替わる）
        ghostRef.current = animate ? host.innerHTML : null
        dead.destroy()
        lfRef.current = null
        host.innerHTML = ''
      }
    } catch (e: unknown) {
      const message = e instanceof Error ? `${e.name}: ${e.message}` : String(e)
      setError(message)
      for (const d of disposers) d()
      try {
        lf?.destroy()
      } catch {
        /* destroy 中の二次エラーは初期化エラーを覆い隠すだけなので無視する */
      }
      lfRef.current = null
      host.innerHTML = ''
      ghostRef.current = null
      prevLayoutRef.current = null
      return
    }
  }, [doc, flat, collapsed, direction, drillRoot, viewMode, prevDrillRoot, showContext, animate])
}

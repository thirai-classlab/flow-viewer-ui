/**
 * LogicFlow アダプタ — split モードの描画 effect（LogicFlow インスタンスを 2 つ作る）。
 *
 * nested / drilldown 用の effect（use-drill-effect.ts）とは完全に分離してある。
 */

import { useEffect, useRef } from 'react'
import type LogicFlow from '@logicflow/core'

import type { FlowViewProps, ViewMode } from '../flow/view-props'
import type { DrillTransition, PathNestView, SplitView } from '../flow/collapse'
import { drillTransition, pathNestView, splitView } from '../flow/collapse'
import { pathTo } from '../flow/flatten'
import { ANIM, FIT, SPLIT } from '../flow/theme'
import type { Viewport } from './anim'
import {
  DRILL_ZOOM_FACTOR,
  FIT_PADDING,
  SPLIT_FIT_PADDING,
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
import type { Placed } from './layout'
import type { SplitPair } from './lf'
import { createLogicFlow } from './lf'
import { docIdsOf } from './doc-index'
import { BADGE_CLASS, applySelection, registerAppNodes } from './nodes'

/** LogicFlow がノードイベントに渡す引数のうち、ここで使うものだけ */
type NodeEventArgs = { data?: { id?: string }; e?: MouseEvent }

/** 「中を見る」バッジの上で押されたか（バッジだけは単一クリックで潜れる） */
function isBadgeHit(e: MouseEvent | undefined): boolean {
  const target = e?.target
  if (!(target instanceof Element)) return false
  return target.closest(`.${BADGE_CLASS}`) !== null
}
import type { NestPaneGraph, SplitPaneGraph } from './split'
import {
  EMPTY_PANE,
  buildSplitLowerGraph,
  buildSplitNestGraph,
  buildSplitUpperGraph,
  nestUpperRatio,
} from './split'

/**
 * await を含む組み立ての結果。ここから先（描画）は同期で走らせる。
 * 左右 2 本は Promise.all で揃うまで待つので、片側だけ先に描かれることがない。
 */
type SplitPlan = {
  view: SplitView
  nestView: PathNestView | null
  nestGraph: NestPaneGraph | null
  upperGraph: SplitPaneGraph | null
  lowerGraph: SplitPaneGraph
}

export type SplitEffectParams = {
  doc: FlowViewProps['doc']
  flat: FlowViewProps['flat']
  direction: FlowViewProps['direction']
  drillRoot: string | null
  viewMode: ViewMode
  prevDrillRoot: string | null
  animate: boolean
  nestPath: boolean
  wrapRef: { current: HTMLDivElement | null }
  upperHostRef: { current: HTMLDivElement | null }
  lowerHostRef: { current: HTMLDivElement | null }
  upperGhostRef: { current: HTMLDivElement | null }
  lowerGhostRef: { current: HTMLDivElement | null }
  upperExitRef: { current: HTMLDivElement | null }
  splitLfRef: { current: SplitPair<LogicFlow | null> | null }
  /** 選択中ノード。描画のやり直しを避けるため effect の依存には入れない */
  selectedId: string | null
  cbRef: {
    current: {
      onToggleCollapse: (id: string) => void
      onDrillDown: (id: string | null) => void
      onSelect: (id: string | null) => void
    }
  }
  splitGhostRef: { current: SplitPair<string | null> | null }
  splitLayoutRef: { current: SplitPair<Map<string, Placed>> | null }
  splitViewportRef: { current: SplitPair<Viewport | null> }
  lastSplitRootRef: { current: string | null | undefined }
  /** 「全体を表示」（fitAll）の実体。右ペインを下限なしで収め直す。cleanup で外す */
  fitAllRef: { current: (() => void) | null }
  setError: (v: string | null) => void
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

/** split 用の描画 effect。元は FlowCanvas 本体にあったものをそのまま切り出した */
export function useSplitEffect(params: SplitEffectParams) {
  const {
    doc,
    flat,
    direction,
    drillRoot,
    viewMode,
    prevDrillRoot,
    animate,
    nestPath,
    selectedId,
    wrapRef,
    upperHostRef,
    lowerHostRef,
    upperGhostRef,
    lowerGhostRef,
    upperExitRef,
    splitLfRef,
    cbRef,
    splitGhostRef,
    splitLayoutRef,
    splitViewportRef,
    lastSplitRootRef,
    fitAllRef,
    setError,
    setSplitInfo,
    setNestInfo,
  } = params

  /* ================================================================== *
   * split: LogicFlow インスタンスを 2 つ作る
   *
   * 検証の本体。drilldown 用の effect とは完全に分離し、
   * 「2 セットぶんの cleanup を必ず書く」ことだけを守れば済む形にしてある。
   * ================================================================== */
  /**
   * 描画の世代。effect が走るたびに 1 つ進め、cleanup でも進める。
   * await から戻った時点で自分の世代でなければ、DOM にも ref にも一切触らずに降りる。
   */
  const genRef = useRef(0)

  useEffect(() => {
    if (viewMode !== 'split') {
      // split を離れたら、持ち越したゴーストと座標は捨てる
      splitGhostRef.current = null
      splitLayoutRef.current = null
      splitViewportRef.current = { upper: null, lower: null }
      return
    }
    ensureAnimStyles()
    const wrap = wrapRef.current
    const lowerHost = lowerHostRef.current
    if (!wrap || !lowerHost) return

    /* 最上位（drillRoot === null）は上位階層が存在しないので、左ペインを DOM ごと描かない。
     * → upperHostRef は null のまま。ここで「左ペインが無い」を 1 つの変数に落として、
     *   以降のインスタンス生成・render・視野合わせ・イベント・cleanup を全部そろえて分岐させる。 */
    const isTop = drillRoot === null
    const upperHost = isTop ? null : upperHostRef.current
    // 下位なのに左ペインの DOM が用意できていないのは React の commit 順が崩れたときだけ。
    // 中途半端に 1 インスタンスだけ作らないよう、何もせず次の描画に任せる。
    if (!isTop && upperHost === null) return

    /* --- ペインの幅を先に決める（組み立てと描画で同じ値を使う） --- *
     * 幅は host.clientWidth ではなくラッパから計算する。
     * 1 ペイン ⇄ 2 ペインの切り替えでは左ペインの幅を CSS アニメーションで開くため、
     * effect が走る瞬間の clientWidth は「アニメーション途中の幅」になってしまう。
     * 最終形の幅で視野を決めておけば、アニメーションが終わった時点でぴったり収まる。 */
    const useNest = nestPath && !isTop
    const wrapW = wrap.clientWidth || 800
    // 入れ子は横に広がるので、経路の深さに応じて左ペインを広げる（JSX 側と同じ式）
    const paneRatio =
      useNest && drillRoot !== null
        ? nestUpperRatio(pathTo(drillRoot, flat.parentOf).length)
        : SPLIT.upperRatio
    const upperPaneW = Math.max(1, Math.round(wrapW * paneRatio))
    const lowerPaneW = Math.max(1, isTop ? wrapW : wrapW - upperPaneW)

    const gen = ++genRef.current
    const rafIds: number[] = []
    const timers: number[] = []
    const disposers: (() => void)[] = [
      () => {
        for (const id of rafIds) cancelAnimationFrame(id)
        for (const t of timers) window.clearTimeout(t)
      },
    ]
    // 片方の生成に失敗しても、既に作った方を確実に destroy するための控え
    let upperLf: LogicFlow | null = null
    let lowerLf: LogicFlow | null = null
    /** 描画まで到達したか。到達していないなら cleanup は ghost も host も触らない */
    let rendered = false

    /* ============================================================ *
     * (1) 組み立て — await を含む。DOM も ref も一切触らない。
     *     左右 2 本は Promise.all で揃えてから描く（片側だけ先に出さない）。
     * ============================================================ */
    const build = async (): Promise<SplitPlan> => {
      const view = splitView(flat.nodes, flat.parentOf, flat.byId, doc.links, drillRoot)
      /* 経路入れ子モード。最上位には上位階層そのものが無いので下位のときだけ成立する。
         nestPath = false なら従来の splitView（1 つ上の階層だけ）のままにする。 */
      const nestView = useNest
        ? pathNestView(flat.nodes, flat.parentOf, flat.byId, doc.links, drillRoot)
        : null
      const docIds = docIdsOf(doc)
      // 左ペインは「経路入れ子」か「1 つ上の階層」のどちらか。最上位はそもそも描かない
      // 左ペインの視野を先に渡す。縮尺が頭打ちの地点だけ ELK にラベルの場所を空けさせる
      const upperFit = {
        cw: upperPaneW,
        ch: upperHost?.clientHeight || 500,
        pad: SPLIT_FIT_PADDING,
        maxScale: FIT.maxScaleUpper,
      }
      const nestTask: Promise<NestPaneGraph | null> =
        nestView === null
          ? Promise.resolve(null)
          : buildSplitNestGraph(nestView, flat.byId, doc.links, flat.parentOf, upperFit)
      const plainTask: Promise<SplitPaneGraph | null> =
        isTop || nestView !== null ? Promise.resolve(null) : buildSplitUpperGraph(view, flat.byId, docIds)
      const [nestGraph, plainUpper, lowerGraph] = await Promise.all([
        nestTask,
        plainTask,
        buildSplitLowerGraph(view, flat.byId, direction, docIds),
      ])
      return { view, nestView, nestGraph, upperGraph: nestGraph ?? plainUpper, lowerGraph }
    }

    /* ============================================================ *
     * (2) 描画 — ここから最後まで await を 1 つも挟まない。
     * ============================================================ */
    const draw = (plan: SplitPlan) => {
      const { view, nestView, nestGraph, upperGraph, lowerGraph } = plan

      const rootChanged = lastSplitRootRef.current !== drillRoot
      const transition: DrillTransition = rootChanged
        ? drillTransition(prevDrillRoot, drillRoot, flat.parentOf)
        : 'none'
      lastSplitRootRef.current = drillRoot

      const pendingGhosts = splitGhostRef.current
      splitGhostRef.current = null

      /* --- ゴースト（最上位は 1 セット + 「消えた左ペイン」ぶん） --- *
       * 最上位へ戻ったときは左ペインの DOM ごと無くなるので、
       * 直前の左ペインは全画面ペインの上に重ねた専用レイヤでフェードアウトさせる。 */
      if (animate && pendingGhosts !== null) {
        const factor = ghostFactor(transition)
        spawnGhost(
          isTop ? upperExitRef.current : upperGhostRef.current,
          pendingGhosts.upper,
          factor,
          disposers,
          timers,
        )
        spawnGhost(lowerGhostRef.current, pendingGhosts.lower, factor, disposers, timers)
      }

      /* --- インスタンス。最上位は 1 つ、下位は 2 つ。
             plugins はインスタンスオプションなので静的登録は使わない --- */
      if (upperHost !== null) upperLf = createLogicFlow(upperHost)
      const lower = createLogicFlow(lowerHost)
      lowerLf = lower
      rendered = true
      // ホバー / 選択 / バッジ / 手順書マークのカスタムノード型はインスタンス単位に登録する
      if (upperLf !== null) registerAppNodes(upperLf)
      registerAppNodes(lower)
      splitLfRef.current = { upper: upperLf, lower }

      // エッジ id はペインごとに接頭辞を付けてある（SVG マーカー id の衝突対策）
      if (upperLf !== null && upperGraph !== null) {
        upperLf.render({ nodes: upperGraph.nodes, edges: upperGraph.edges })
      }
      lower.render({ nodes: lowerGraph.nodes, edges: lowerGraph.edges })

      setSplitInfo({
        // 入れ子では「左ペインに出ている全ノード数」が上位階層の件数より意味がある
        upper: nestView === null ? view.upper.length : nestView.visibleIds.size,
        lower: view.lower.length,
        linked: nestView === null ? view.linked.size : nestView.linked.size,
        cross: view.crossCount,
      })

      const pendingViews: { lf: LogicFlow; vp: Viewport }[] = []
      const fitPane = (
        lf: LogicFlow,
        host: HTMLDivElement,
        paneW: number,
        graph: SplitPaneGraph,
        pad: number,
        prevVp: Viewport | null,
        maxScale: number,
        minScale: number,
      ): Viewport => {
        const cw = paneW
        // 高さはペインの開閉で変わらないので実測でよい
        const ch = host.clientHeight || 500
        const finalVp = fitViewport(graph.width, graph.height, cw, ch, {
          pad,
          maxScale,
          minScale,
          nodes: graph.nodeBox,
          anchor: graph.headBox,
        })
        let startVp: Viewport | null = null
        if (animate) {
          if (transition === 'enter') startVp = scaleAbout(finalVp, 1 / DRILL_ZOOM_FACTOR, cw, ch)
          else if (transition === 'exit') startVp = scaleAbout(finalVp, DRILL_ZOOM_FACTOR, cw, ch)
          else if (prevVp !== null) startVp = prevVp
        }
        applyViewport(lf, startVp ?? finalVp)
        if (startVp !== null) pendingViews.push({ lf, vp: finalVp })
        return finalVp
      }

      const prevVps = splitViewportRef.current
      // 左ペインは見取り図なので従来どおり下限なし（NOTES.md の 5 階層実測がこの前提）
      const upperVp =
        upperLf !== null && upperHost !== null && upperGraph !== null
          ? fitPane(
              upperLf,
              upperHost,
              upperPaneW,
              upperGraph,
              SPLIT_FIT_PADDING,
              prevVps.upper,
              FIT.maxScaleUpper,
              FIT.minScale,
            )
          : null
      // 右ペイン（今いる階層の中身）は本編と同じく読める縮尺の下限付き
      const lowerVp = fitPane(
        lower,
        lowerHost,
        lowerPaneW,
        lowerGraph,
        FIT_PADDING,
        prevVps.lower,
        FIT.maxScalePane,
        FIT.minReadable,
      )
      splitViewportRef.current = { upper: upperVp, lower: lowerVp }

      // 「全体を表示」: 右ペインだけ下限なしで収め直す（左ペインは元から下限なし）
      fitAllRef.current = () => {
        const vp = fitViewport(lowerGraph.width, lowerGraph.height, lowerPaneW, lowerHost.clientHeight || 500, {
          pad: FIT_PADDING,
          maxScale: FIT.maxScalePane,
          minScale: FIT.minScale,
          nodes: lowerGraph.nodeBox,
          anchor: lowerGraph.headBox,
        })
        transitionViewport(lower, wrap, vp, animate, timers)
        splitViewportRef.current = { ...splitViewportRef.current, lower: vp }
      }
      disposers.push(() => {
        fitAllRef.current = null
      })

      // 縮尺は「入れ子が実際に潰れたか」の唯一の客観指標なので画面に出す
      setNestInfo(
        nestView === null || nestGraph === null
          ? null
          : {
              levels: nestGraph.levels,
              boxDepth: nestGraph.boxDepth,
              omitted: nestView.omittedAncestors.map((n) => ({ id: n.id, label: n.label })),
              outOfScope: nestGraph.outOfScope,
              scale: upperVp?.scale ?? 1,
            },
      )

      if (pendingViews.length > 0) {
        // transition を付ける前に始点が 1 度ペイントされている必要があるので rAF を 2 段にする
        const raf1 = requestAnimationFrame(() => {
          wrap.classList.add(VIEW_ANIM_CLASS)
          const raf2 = requestAnimationFrame(() => {
            try {
              for (const p of pendingViews) applyViewport(p.lf, p.vp)
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

      /* --- 位置トゥイーン（方向切替など、階層が変わらない再描画のとき） --- */
      const prevLayout = splitLayoutRef.current
      splitLayoutRef.current = {
        upper: upperGraph?.positions ?? EMPTY_PANE.positions,
        lower: lowerGraph.positions,
      }
      if (animate && transition === 'none' && prevLayout !== null) {
        if (upperLf !== null && upperGraph !== null) {
          tweenLayout(upperLf, prevLayout.upper, upperGraph.positions, rafIds, setError)
        }
        tweenLayout(lower, prevLayout.lower, lowerGraph.positions, rafIds, setError)
      }

      /* --- 操作 --- */
      const parentOfCurrent = view.current?.parentId ?? null
      /* 左ペインは「今どこにいるか」を示す案内板なので、従来どおり単一クリックで移動する
         （パンくずと同じ役割。ここだけは選択より移動を優先したほうが手数が減る）。
         葉は潜れないので無視する — 葉を drillRoot にすると右ペインが空になり、
         他モードへ戻したときに壊れるため。 */
      const onUpperClick = (args: NodeEventArgs) => {
        const id = args?.data?.id
        if (!id) return
        // ★ = 今いる場所。既にそこにいるので無反応でよい（再 render を無駄に走らせない）
        if (id === drillRoot) {
          cbRef.current.onSelect(id)
          return
        }
        if (flat.byId.get(id)?.isContainer === true) cbRef.current.onDrillDown(id)
        else cbRef.current.onSelect(id)
      }
      /* 右ペインは本編と同じ契約:
           単一クリック  → 選択（「中を見る」バッジの上だけは潜る）
           ダブルクリック → 潜る */
      const onLowerClick = (args: NodeEventArgs) => {
        const id = args?.data?.id
        if (!id) return
        const node = flat.byId.get(id)
        if (isBadgeHit(args.e) && node?.isContainer === true) {
          cbRef.current.onDrillDown(id)
          return
        }
        cbRef.current.onSelect(node === undefined ? null : id)
      }
      const onLowerDbl = (args: NodeEventArgs) => {
        const id = args?.data?.id
        if (!id) return
        if (flat.byId.get(id)?.isContainer === true) cbRef.current.onDrillDown(id)
      }
      const onLowerBlankClick = () => cbRef.current.onSelect(null)
      // 右ペインの空白ダブルクリックで 1 つ上へ戻る。
      // LogicFlow の EventType には blank:dbclick が無い（blank:click までしか無い）ので
      // DOM の dblclick を拾い、ノード/エッジの上でないことを自分で判定する。
      const onLowerBlankDbl = (ev: MouseEvent) => {
        const target = ev.target
        if (target instanceof Element && target.closest('.lf-node, .lf-edge') !== null) return
        cbRef.current.onDrillDown(parentOfCurrent)
      }

      const upperForEvents = upperLf
      if (upperForEvents !== null) {
        upperForEvents.on('node:click', onUpperClick)
        upperForEvents.on('node:dbclick', onUpperClick)
      }
      lower.on('node:click', onLowerClick)
      lower.on('node:dbclick', onLowerDbl)
      lower.on('blank:click', onLowerBlankClick)
      lowerHost.addEventListener('dblclick', onLowerBlankDbl)
      disposers.push(() => {
        if (upperForEvents !== null) {
          upperForEvents.off('node:click', onUpperClick)
          upperForEvents.off('node:dbclick', onUpperClick)
        }
        lower.off('node:click', onLowerClick)
        lower.off('node:dbclick', onLowerDbl)
        lower.off('blank:click', onLowerBlankClick)
        lowerHost.removeEventListener('dblclick', onLowerBlankDbl)
      })
      // 描画し直した直後は選択枠が消えているので、両ペインへ貼り直す
      applySelection(upperHost, selectedId)
      applySelection(lowerHost, selectedId)
      setError(null)
    }

    const run = async () => {
      const plan = await build()
      // 依存が変わっていたら DOM も ref も触らずに降りる（cleanup が後始末済み）
      if (gen !== genRef.current) return
      draw(plan)
    }

    run().catch((e: unknown) => {
      if (gen !== genRef.current) return
      setError(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
      for (const d of disposers) d()
      for (const dead of [upperLf, lowerLf]) {
        try {
          dead?.destroy()
        } catch {
          /* destroy 中の二次エラーは初期化エラーを覆い隠すだけなので無視する */
        }
      }
      upperLf = null
      lowerLf = null
      rendered = false
      splitLfRef.current = null
      if (upperHost !== null) upperHost.innerHTML = ''
      lowerHost.innerHTML = ''
      splitGhostRef.current = null
      splitLayoutRef.current = null
    })

    /* --- cleanup（最上位なら 1 セット / 下位なら 2 セット。
           StrictMode の二重実行でも、最上位 ⇄ 下位の往復でも取りこぼさない） --- *
     * 最上位へ戻るときは React が左ペインの DOM を先に外すため、
     * destroy 時点で upperHost は document から切り離されている。
     * LogicFlow.destroy() は preact の render(null, container) と
     * ResizeObserver.disconnect() しかしないので、切り離し後でも安全に走る。
     * ただし destroy が中身を消すので、ゴースト用の innerHTML は必ず destroy の前に取る。 */
    return () => {
      // 組み立ての途中なら、この世代はもう描かない（await の後で弾かれる）
      genRef.current += 1
      for (const d of disposers) d()
      if (!rendered) return
      splitGhostRef.current = animate
        ? { upper: upperHost?.innerHTML ?? null, lower: lowerHost.innerHTML }
        : null
      upperLf?.destroy()
      lowerLf?.destroy()
      upperLf = null
      lowerLf = null
      splitLfRef.current = null
      if (upperHost !== null) upperHost.innerHTML = ''
      lowerHost.innerHTML = ''
    }
  }, [doc, flat, direction, drillRoot, viewMode, prevDrillRoot, animate, nestPath])
}

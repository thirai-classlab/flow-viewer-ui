/**
 * LogicFlow アダプタ — split モードのグラフ構築（左右 2 ペイン）。
 *
 *   nestPath = false … buildSplitUpperGraph() / buildSplitLowerGraph()
 *   nestPath = true  … buildSplitNestGraph()  （左ペインを経路の入れ子で描く）
 */

import type { FlatNode } from '../flow/flatten'
import type { NestNode, PathNestView, SplitView } from '../flow/collapse'
import { descendantCount, edgesForNestView } from '../flow/collapse'
import type { Direction, FlowLink } from '../flow/schema'
import { SPLIT } from '../flow/theme'
import type { LayoutCtx, Placed } from './layout'
import { EMPTY_COLLAPSE, arrange, emitPositions } from './layout'
import type { LFEdgeConfig, LFNodeConfig, UpperState } from './nodes'
import {
  SPLIT_EDGE_PREFIX,
  splitEdge,
  toDrillGroupNode,
  toLfNode,
  toNestGroupNode,
  toSplitUpperNode,
} from './nodes'

/* ------------------------------------------------------------------ *
 * 2.9 左右 2 ペイン表示（split）
 *
 * 左 = 1 つ上の階層（current とその兄弟）／右 = current の中身。
 * どちらも完全にフラットなグラフなので dynamic-group は一切使わず、
 * 既存の arrange() を levelOnly で回すだけで済む。
 *
 * ペインをまたぐ線は引かない（ユーザーの明示的な選択）。代わりに
 *   ★ = view.current      … SPLIT.currentStroke の太枠 + 実色
 *   ⚡ = view.linked       … SPLIT.linkedStroke の枠
 * で左ペイン側をハイライトして関係を示す。
 *
 * ★ LogicFlow 固有の落とし穴:
 *   BaseEdgeModel は矢印マーカーを marker-end-<エッジ id> という **document 全体で
 *   共有される SVG id** で定義し、url(#marker-end-<id>) で参照する。
 *   2 インスタンスで同じエッジ id を使うと、後から描いた側の矢印が
 *   先に描いた側のマーカー（色も向きも別物）を拾ってしまう。
 *   そのため split ではエッジ id にペインごとの接頭辞を必ず付ける。
 * ------------------------------------------------------------------ */

export type SplitPaneGraph = {
  nodes: LFNodeConfig[]
  edges: LFEdgeConfig[]
  width: number
  height: number
  positions: Map<string, Placed>
}

export const EMPTY_PANE: SplitPaneGraph = {
  nodes: [],
  edges: [],
  width: 1,
  height: 1,
  positions: new Map<string, Placed>(),
}

/**
 * 左ペイン: 1 つ上の階層を SPLIT.nodeSize の一律サイズで並べる。
 *
 * 向きはツールバーの direction ではなく常に縦（DOWN）。
 * 左ペインは幅 SPLIT.upperRatio（= 0.36）の「細長い柱」なので、
 * 横に流すと 6 ノードで横幅が 1000px を超え、視野合わせで 0.2 倍まで
 * 縮んで文字が読めなくなる（実測）。縦積みならペインの高さを使い切れる。
 */
export function buildSplitUpperGraph(
  view: SplitView,
  byId: Map<string, FlatNode>,
  docIds: ReadonlySet<string> = new Set<string>(),
): SplitPaneGraph {
  if (view.upper.length === 0) return EMPTY_PANE
  const ctx: LayoutCtx = {
    byId,
    links: view.upperEdges.map((e) => ({ from: e.source, to: e.target, kind: e.kind })),
    collapsed: EMPTY_COLLAPSE,
    direction: 'DOWN',
    levelOnly: true,
    fixedSize: SPLIT.nodeSize,
  }
  const arranged = arrange(
    view.upper.map((n) => n.id),
    ctx,
  )
  const positions = new Map<string, Placed>()
  emitPositions(arranged.boxes, 0, 0, positions)

  const currentId = view.current?.id ?? null
  const nodes: LFNodeConfig[] = []
  for (const n of view.upper) {
    const at = positions.get(n.id)
    if (!at) continue
    const state: UpperState =
      n.id === currentId ? 'current' : view.linked.has(n.id) ? 'linked' : 'plain'
    nodes.push(toSplitUpperNode(n, at, state, undefined, docIds.has(n.id)))
  }
  return {
    nodes,
    edges: view.upperEdges.map((e, i) => splitEdge(e, `${SPLIT_EDGE_PREFIX.upper}-${i}`)),
    width: arranged.width,
    height: arranged.height,
    positions,
  }
}

/** 右ペイン: 今いる階層の中身。従来のドリルダウンと同じ見た目（サイズも据え置き） */
export function buildSplitLowerGraph(
  view: SplitView,
  byId: Map<string, FlatNode>,
  direction: Direction,
  fit?: { width: number; height: number },
  docIds: ReadonlySet<string> = new Set<string>(),
): SplitPaneGraph {
  if (view.lower.length === 0) return EMPTY_PANE
  const ctx: LayoutCtx = {
    byId,
    links: view.lowerEdges.map((e) => ({ from: e.source, to: e.target, kind: e.kind })),
    collapsed: EMPTY_COLLAPSE,
    direction,
    levelOnly: true,
    // 右ペインは本編と同じく「キャンバスの縦横比に合わせて折り返す」
    fit,
  }
  const arranged = arrange(
    view.lower.map((n) => n.id),
    ctx,
  )
  const positions = new Map<string, Placed>()
  emitPositions(arranged.boxes, 0, 0, positions)

  const nodes: LFNodeConfig[] = []
  for (const n of view.lower) {
    const at = positions.get(n.id)
    if (!at) continue
    const hasDoc = docIds.has(n.id)
    nodes.push(
      n.isContainer
        ? toDrillGroupNode(n, at, descendantCount(n.id, byId), hasDoc)
        : toLfNode(n, at, hasDoc),
    )
  }
  return {
    nodes,
    edges: view.lowerEdges.map((e, i) => splitEdge(e, `${SPLIT_EDGE_PREFIX.lower}-${i}`)),
    width: arranged.width,
    height: arranged.height,
    positions,
  }
}

/* ------------------------------------------------------------------ *
 * 2.9.1 左ペインの「経路を入れ子で見せる」ビュー（nestPath = true）
 *
 * 左ペインを「1 つ上の階層だけ」から「最上位 + 経路上のグループを入れ子で展開」に変える。
 * これで左ペインが再び階層構造を持つので、LogicFlow 側でも階層機能が必要になる。
 *
 * 使う階層機能は dynamic-group（@logicflow/extension）。
 * ただし折りたたみは一切使わない:
 *   - properties.collapsible = false  → 枠左上の ± ボタンごと出さない
 *   - toggleCollapse() を呼ばない     → isCollapsed は常に false
 * nested モードで踏み抜いた「入れ子グループを畳むと境界エッジが全滅する」バグは
 * collapseEdge() の中にしかないので、畳まなければその経路に入らない。
 * ------------------------------------------------------------------ */

/** 左ペイン幅の比率。経路が深いほど広げる（上限 SPLIT.nestRatioMax） */
export function nestUpperRatio(pathLength: number): number {
  return Math.min(
    SPLIT.nestRatioMax,
    SPLIT.nestRatioBase + Math.max(0, pathLength - 1) * SPLIT.nestRatioStep,
  )
}

function nestStateOf(n: NestNode): UpperState {
  if (n.isCurrent) return 'current'
  if (n.isLinked) return 'linked'
  return 'plain'
}

export type NestPaneGraph = SplitPaneGraph & {
  /** 展開した（＝コンテナとして描いた）祖先の段数。MAX_NEST_LEVELS が上限 */
  levels: number
  /** 箱の入れ子の深さ。展開段数 + 1（一番内側に「今ここ」の箱が入るため） */
  boxDepth: number
  /** 左ペインからも見えないリンクの本数。0 なら「圏外ゼロ」 */
  outOfScope: number
}

/** 左ペイン（経路入れ子）を組み立てる */
export function buildSplitNestGraph(
  view: PathNestView,
  byId: Map<string, FlatNode>,
  links: readonly FlowLink[],
  parentOf: Map<string, string>,
): NestPaneGraph {
  const expanded = new Set<string>()
  let boxDepth = 0
  const scan = (list: readonly NestNode[]) => {
    for (const n of list) {
      boxDepth = Math.max(boxDepth, n.level + 1)
      if (n.expanded) expanded.add(n.node.id)
      scan(n.children)
    }
  }
  scan(view.tree)
  const levels = expanded.size
  if (view.tree.length === 0) {
    return { ...EMPTY_PANE, levels: 0, boxDepth: 0, outOfScope: 0 }
  }

  const { edges: nestEdges, outOfScope } = edgesForNestView(links, parentOf, view)

  // 向きは左ペインの慣例どおり常に縦。横に流すと入れ子の幅が柱に収まらない。
  // 間隔は共通テーマの SPLIT.nestGap（node 14 / rank 22）。本編用の LAYOUT_GAP
  // （node 28 / rank 64）は幅 36〜52% の柱に入れ子を積むには広すぎて縮尺が潰れる。
  const ctx: LayoutCtx = {
    byId,
    links,
    collapsed: EMPTY_COLLAPSE,
    direction: 'DOWN',
    nestExpanded: expanded,
    gap: SPLIT.nestGap,
  }
  const arranged = arrange(
    view.tree.map((n) => n.node.id),
    ctx,
  )
  const positions = new Map<string, Placed>()
  emitPositions(arranged.boxes, 0, 0, positions)

  const nodes: LFNodeConfig[] = []
  const emit = (list: readonly NestNode[]) => {
    for (const n of list) {
      const at = positions.get(n.node.id)
      if (at !== undefined) {
        // 親を先に push する。dynamic-group の children 解決と重なり順の両方がこの順序に依存する
        nodes.push(
          n.expanded
            ? toNestGroupNode(n, at)
            : // 今いる場所は「中身が右ペインにある」ことを 2 行目で明示する
              toSplitUpperNode(n.node, at, nestStateOf(n), n.isCurrent ? '今ここ（中身は右）' : undefined),
        )
      }
      emit(n.children)
    }
  }
  emit(view.tree)

  return {
    nodes,
    edges: nestEdges.map((e, i) => splitEdge(e, `${SPLIT_EDGE_PREFIX.upper}-${i}`)),
    width: arranged.width,
    height: arranged.height,
    positions,
    levels,
    boxDepth,
    outOfScope: outOfScope.length,
  }
}

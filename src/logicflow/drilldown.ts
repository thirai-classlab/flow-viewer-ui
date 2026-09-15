/**
 * LogicFlow アダプタ — drilldown モードのグラフ構築。
 *
 *   showContext = false … buildDrillGraph()        （1 画面 1 階層 + 境界マーカー）
 *   showContext = true  … buildFocusContextGraph() （フォーカス層 + コンテキスト層の 3 バンド）
 */

import type { FlatNode } from '../flow/flatten'
import type { AggregatedEdge, LevelView, ViewEdge } from '../flow/collapse'
import { descendantCount, edgesAtLevel, edgesForLevelView, resolveEndpointAtLevel } from '../flow/collapse'
import type { Direction, FlowLink, LinkKind } from '../flow/schema'
import { CONTEXT_SIZE, LAYOUT_GAP, LINK_COLOR, NODE_FONT } from '../flow/theme'
import type { LayoutCtx, Placed } from './layout'
import { EMPTY_COLLAPSE, arrange, emitPositions } from './layout'
import type { LFEdgeConfig, LFNodeConfig } from './nodes'
import {
  NODE_TYPE,
  edgeStyleOf,
  toContextNode,
  toDrillGroupNode,
  toLfNode,
  toViewEdge,
} from './nodes'

/**
 * 描き込めるキャンバスの実寸。レイアウトの折り返し（LayoutCtx.fit）に渡す。
 * 「横フローで縦が 8 割空く」問題はここが無いと直せない。
 */
export type FitBox = { width: number; height: number }

/** フォーカス層とコンテキスト層の間隔。層の切れ目をはっきり見せるため通常より広くとる */
const CONTEXT_GAP = 96

/* ------------------------------------------------------------------ *
 * 2.5 ドリルダウン表示モード（1 画面 = 1 階層）
 *
 * LogicFlow には bpmn-js の canvas.setRootElement / maxGraph の enterGroup に
 * 相当する「別ルートへ潜る」API が無い（core / extension 全ソースを grep しても
 * enterGroup・setRootElement・drillDown いずれもヒットしない）。
 * そこで共通レイヤの levelView / nodesAtLevel でこの階層ぶんのデータだけを作り、
 * lf.render() で丸ごと流し込む。LogicFlow の render() は毎回グラフを作り直す仕様なので
 * 「潜る = 別データを render し直す」という素直な実装になる。
 *
 * グループは dynamic-group ではなく通常の rect ノードとして描く。
 * children を持たせないなら dynamic-group を使う理由（折りたたみ・子の追従・仮想エッジ）が
 * すべて消え、逆に collapsedWidth や isRestrict の挙動が邪魔になるため。
 * ------------------------------------------------------------------ */

/** 親を辿り切ってトップレベルの祖先を返す（自分がトップならそのまま） */
function topAncestorOf(id: string, parentOf: Map<string, string>): string {
  let cur = id
  for (let p = parentOf.get(cur); p !== undefined; p = parentOf.get(cur)) cur = p
  return cur
}

/** 階層の外へ出入りするリンクを束ねた境界マーカー */
type Boundary = {
  id: string
  /** この階層で線が刺さる実ノード */
  anchor: string
  dir: 'out' | 'in'
  kind: LinkKind
  label: string
  count: number
}

/**
 * outOfScope なリンクを「この階層のどのノードから、どの部門へ抜けるか」でまとめる。
 * 黙って捨てるとフローが途切れて見えるので、境界マーカーとして必ず描く。
 *
 * ※ showContext = true のときは 1 つ上の階層が実際に描かれるので、この擬似ノードは使わない。
 */
function buildBoundaries(
  outOfScope: readonly FlowLink[],
  parentOf: Map<string, string>,
  byId: Map<string, FlatNode>,
  drillRoot: string | null,
): Boundary[] {
  const merged = new Map<string, Boundary>()
  // 1 つ上の階層で解決すると「どの兄弟グループへ抜けるか」が出せる。
  // そこでも見えない相手（さらに遠い部門）はトップレベルの祖先名で示す。
  const parentLevel = drillRoot === null ? null : (parentOf.get(drillRoot) ?? null)
  for (const l of outOfScope) {
    const s = resolveEndpointAtLevel(l.from, parentOf, drillRoot)
    const t = resolveEndpointAtLevel(l.to, parentOf, drillRoot)
    // edgesAtLevel が outOfScope に入れるのは「片側だけ見える」リンクだけ
    const dir: 'out' | 'in' = s !== null ? 'out' : 'in'
    const anchor = s !== null ? s : t
    if (anchor === null) continue
    const outsideId = dir === 'out' ? l.to : l.from
    const far =
      resolveEndpointAtLevel(outsideId, parentOf, parentLevel) ?? topAncestorOf(outsideId, parentOf)
    const farLabel = byId.get(far)?.label ?? far
    const kind: LinkKind = l.kind ?? 'normal'
    const id = `__edge:${dir}:${anchor}:${far}:${kind}`
    const hit = merged.get(id)
    if (hit) {
      hit.count += 1
      continue
    }
    merged.set(id, {
      id,
      anchor,
      dir,
      kind,
      label: dir === 'out' ? `→ ${farLabel} へ` : `← ${farLabel} から`,
      count: 1,
    })
  }
  return [...merged.values()]
}

/** 境界マーカーノード（「→ 手配部門 へ」）。実ノードと混同されないようピル型 + 破線 */
function toBoundaryNode(b: Boundary, at: Placed): LFNodeConfig {
  const stroke = LINK_COLOR[b.kind]
  return {
    id: b.id,
    type: NODE_TYPE.rect,
    x: at.x,
    y: at.y,
    text: b.count > 1 ? `${b.label}\n${b.count} 本` : b.label,
    properties: {
      width: at.w,
      height: at.h,
      isBoundary: true,
      style: { fill: 'var(--fv-boundary-fill)', stroke, strokeWidth: 1.4, strokeDasharray: '4 3', radius: 18 },
      textStyle: {
        color: stroke,
        fontSize: NODE_FONT.sub,
        overflowMode: 'autoWrap',
        textWidth: at.w - 16,
      },
    },
  }
}

function toLevelEdge(e: AggregatedEdge, index: number): LFEdgeConfig {
  return {
    id: `lv-${index}`,
    type: 'polyline',
    sourceNodeId: e.source,
    targetNodeId: e.target,
    text: e.label ?? '',
    properties: { linkKind: e.kind, style: edgeStyleOf(e.kind) },
  }
}

export type DrillGraph = {
  nodes: LFNodeConfig[]
  edges: LFEdgeConfig[]
  width: number
  height: number
  /** 階層の外へ出入りするリンクの本数（画面上部の注記に出す） */
  outOfScopeCount: number
  /** 描いた境界マーカーの数（showContext = true のときは 0） */
  boundaryCount: number
  /** フォーカス層とコンテキスト層をまたぐエッジの本数 */
  crossingCount: number
  /** コンテキスト層として描いたノード id。クリック時の遷移先判定に使う */
  contextIds: Set<string>
  /** 位置トゥイーンの基準に使う、全ノードの確定座標 */
  positions: Map<string, Placed>
}

export function buildDrillGraph(
  levelNodes: readonly FlatNode[],
  links: readonly FlowLink[],
  flat: { byId: Map<string, FlatNode>; parentOf: Map<string, string> },
  drillRoot: string | null,
  direction: Direction,
  fit: FitBox,
  docIds: ReadonlySet<string>,
): DrillGraph {
  const { edges: levelEdges, outOfScope } = edgesAtLevel(links, flat.parentOf, drillRoot)
  const boundaries = buildBoundaries(outOfScope, flat.parentOf, flat.byId, drillRoot)

  // --- レイアウト: この階層のノード + 境界マーカーを 1 枚の DAG として並べる ---
  const layoutLinks: FlowLink[] = [
    ...levelEdges.map((e) => ({ from: e.source, to: e.target, kind: e.kind })),
    ...boundaries.map((b) =>
      b.dir === 'out'
        ? { from: b.anchor, to: b.id, kind: b.kind }
        : { from: b.id, to: b.anchor, kind: b.kind },
    ),
  ]
  const ids = [...levelNodes.map((n) => n.id), ...boundaries.map((b) => b.id)]
  const ctx: LayoutCtx = {
    byId: flat.byId,
    links: layoutLinks,
    collapsed: EMPTY_COLLAPSE,
    direction,
    levelOnly: true,
    // 「1 本の長い鎖」をキャンバスの縦横比に合わせて折り返す
    fit,
  }
  const root = arrange(ids, ctx)
  const positions = new Map<string, Placed>()
  emitPositions(root.boxes, 0, 0, positions)

  const nodes: LFNodeConfig[] = []
  for (const n of levelNodes) {
    const at = positions.get(n.id)
    if (!at) continue
    const hasDoc = docIds.has(n.id)
    nodes.push(
      n.isContainer
        ? toDrillGroupNode(n, at, descendantCount(n.id, flat.byId), hasDoc)
        : toLfNode(n, at, hasDoc),
    )
  }
  for (const b of boundaries) {
    const at = positions.get(b.id)
    if (at) nodes.push(toBoundaryNode(b, at))
  }

  const edges: LFEdgeConfig[] = levelEdges.map(toLevelEdge)
  boundaries.forEach((b, i) => {
    const [from, to] = b.dir === 'out' ? [b.anchor, b.id] : [b.id, b.anchor]
    edges.push({
      id: `bd-${i}`,
      type: 'polyline',
      sourceNodeId: from,
      targetNodeId: to,
      text: '',
      properties: { linkKind: b.kind, style: edgeStyleOf(b.kind) },
    })
  })

  return {
    nodes,
    edges,
    width: root.width,
    height: root.height,
    outOfScopeCount: outOfScope.length,
    boundaryCount: boundaries.length,
    crossingCount: 0,
    contextIds: new Set<string>(),
    positions,
  }
}

/* ------------------------------------------------------------------ *
 * 2.6 フォーカス + コンテキスト（1 つ上の階層も薄く描く）
 *
 * 「1 画面 1 階層」だけだと潜った瞬間に現在地を見失う。そこで
 *   フォーカス層   = 潜った先の中身（従来どおりはっきり描く）
 *   コンテキスト層 = 1 つ上の階層の兄弟（CONTEXT_* で薄く名前だけ描く）
 * の 2 層にする。副次効果として、前回は境界マーカー（擬似ノード）でお茶を濁していた
 * 階層外リンクが、実際のコンテキスト層ノードへ着地するようになる。
 *
 * コンテキスト層はフォーカス層のカスタムノード型として登録する。
 * BaseNodeModel.getOuterGAttributes() を override すると最外 <g> に任意の class が付くので、
 * そこに CSS で opacity を当てて層全体（枠 + テキスト）をまとめて沈ませられる。
 * ------------------------------------------------------------------ */

/** コンテキスト層をフォーカス層のどちら側に置くか */
type ContextSide = 'before' | 'after'

/**
 * コンテキストノードを、フォーカス層への流れの向きで前後に振り分ける。
 * crossing エッジが無いノードは元のドキュメント順で root の前後に置く。
 */
function contextSideOf(
  id: string,
  edges: readonly ViewEdge[],
  orderIndex: Map<string, number>,
  rootId: string,
): ContextSide {
  let feedsIn = false // context → focus
  let feedsOut = false // focus → context
  for (const e of edges) {
    if (e.scope !== 'crossing') continue
    if (e.source === id) feedsIn = true
    if (e.target === id) feedsOut = true
  }
  if (feedsIn && !feedsOut) return 'before'
  if (feedsOut) return 'after'
  return (orderIndex.get(id) ?? 0) < (orderIndex.get(rootId) ?? 0) ? 'before' : 'after'
}

/**
 * フォーカス層を中央に置き、コンテキスト層を流れの前後に列として配置する。
 * 「コンテキストが周囲、フォーカスが中心」を、方向（RIGHT / DOWN）に沿った
 * 3 バンド（前コンテキスト → フォーカス → 後コンテキスト）で実現する。
 */
export function buildFocusContextGraph(
  view: LevelView,
  links: readonly FlowLink[],
  flat: { nodes: readonly FlatNode[]; byId: Map<string, FlatNode>; parentOf: Map<string, string> },
  direction: Direction,
  fit: FitBox,
  docIds: ReadonlySet<string>,
): DrillGraph {
  const root = view.root
  if (root === null) {
    // 呼び出し側で drillRoot !== null を保証しているので通常ここへは来ない
    throw new Error('コンテキスト層はトップ階層では作れません（levelView().root が null）')
  }
  const { edges: viewEdges, outOfScope } = edgesForLevelView(links, flat.parentOf, view)

  // --- コンテキスト層: 流れの前後 2 列に振り分ける ---
  // フォーカス層より先に決める。コンテキスト帯が主軸を食う分だけ
  // フォーカス層に渡す fit を減らさないと、折り返しの判断がずれるため。
  const orderIndex = new Map(flat.nodes.map((n, i) => [n.id, i] as const))
  const before: FlatNode[] = []
  const after: FlatNode[] = []
  for (const n of view.context) {
    if (contextSideOf(n.id, viewEdges, orderIndex, root.id) === 'before') before.push(n)
    else after.push(n)
  }

  const horiz = direction === 'RIGHT'
  const ctxMain = horiz ? CONTEXT_SIZE.width : CONTEXT_SIZE.height
  const ctxCross = horiz ? CONTEXT_SIZE.height : CONTEXT_SIZE.width
  const columnCross = (n: number) => (n === 0 ? 0 : n * ctxCross + LAYOUT_GAP.node * (n - 1))
  const bandsMain =
    (before.length > 0 ? ctxMain + CONTEXT_GAP : 0) + (after.length > 0 ? ctxMain + CONTEXT_GAP : 0)

  // --- フォーカス層: 従来どおり 1 枚の DAG として並べる ---
  const focusLinks: FlowLink[] = viewEdges
    .filter((e) => e.scope === 'focus')
    .map((e) => ({ from: e.source, to: e.target, kind: e.kind }))
  const focusFit: FitBox = horiz
    ? { width: Math.max(240, fit.width - bandsMain), height: fit.height }
    : { width: fit.width, height: Math.max(240, fit.height - bandsMain) }
  const ctx: LayoutCtx = {
    byId: flat.byId,
    links: focusLinks,
    collapsed: EMPTY_COLLAPSE,
    direction,
    levelOnly: true,
    fit: focusFit,
  }
  const focusArr = arrange(
    view.focus.map((n) => n.id),
    ctx,
  )

  const focusMain = horiz ? focusArr.width : focusArr.height
  const focusCross = horiz ? focusArr.height : focusArr.width
  const totalCross = Math.max(focusCross, columnCross(before.length), columnCross(after.length))
  const beforeBand = before.length > 0 ? ctxMain + CONTEXT_GAP : 0
  const afterBand = after.length > 0 ? ctxMain + CONTEXT_GAP : 0
  const totalMain = beforeBand + focusMain + afterBand

  const positions = new Map<string, Placed>()
  const focusCrossStart = (totalCross - focusCross) / 2
  emitPositions(
    focusArr.boxes,
    horiz ? beforeBand : focusCrossStart,
    horiz ? focusCrossStart : beforeBand,
    positions,
  )

  const placeColumn = (col: readonly FlatNode[], mainStart: number) => {
    let cross = (totalCross - columnCross(col.length)) / 2
    for (const n of col) {
      const left = horiz ? mainStart : cross
      const top = horiz ? cross : mainStart
      positions.set(n.id, {
        x: left + CONTEXT_SIZE.width / 2,
        y: top + CONTEXT_SIZE.height / 2,
        w: CONTEXT_SIZE.width,
        h: CONTEXT_SIZE.height,
      })
      cross += ctxCross + LAYOUT_GAP.node
    }
  }
  placeColumn(before, 0)
  placeColumn(after, beforeBand + focusMain + CONTEXT_GAP)

  // --- 流し込み ---
  const nodes: LFNodeConfig[] = []
  for (const n of view.focus) {
    const at = positions.get(n.id)
    if (!at) continue
    const hasDoc = docIds.has(n.id)
    nodes.push(
      n.isContainer
        ? toDrillGroupNode(n, at, descendantCount(n.id, flat.byId), hasDoc)
        : toLfNode(n, at, hasDoc),
    )
  }
  const contextIds = new Set<string>()
  for (const n of [...before, ...after]) {
    const at = positions.get(n.id)
    if (!at) continue
    contextIds.add(n.id)
    nodes.push(toContextNode(n, at, docIds.has(n.id)))
  }

  return {
    nodes,
    edges: viewEdges.map(toViewEdge),
    width: horiz ? totalMain : totalCross,
    height: horiz ? totalCross : totalMain,
    outOfScopeCount: outOfScope.length,
    // コンテキスト層があるので境界マーカーは出さない
    boundaryCount: 0,
    crossingCount: viewEdges.filter((e) => e.scope === 'crossing').length,
    contextIds,
    positions,
  }
}

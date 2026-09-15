/**
 * LogicFlow アダプタ — 自動レイアウト（dagre のランク付け・並び・配線 + 入れ子コンテナの箱詰め）。
 *
 * LogicFlow は座標を一切計算しないので、全モード共通のレイアウト基盤としてここに集約する。
 * 1 階層ぶんの「ランク付け → 交差最小化 → 座標 → 配線」は @dagrejs/dagre に任せ、
 * 入れ子コンテナの箱詰め（measure）と LogicFlow の座標系への変換だけを自前で持つ。
 */

import type { EdgeLabel, GraphLabel, NodeLabel } from '@dagrejs/dagre'
import { graphlib, layout as dagreLayout } from '@dagrejs/dagre'

import type { FlatNode } from '../flow/flatten'
import { descendantsOf } from '../flow/flatten'
import type { CollapseState, Direction, FlowLink } from '../flow/schema'
import { COLLAPSED_SIZE, GROUP_HEADER, LAYOUT_GAP, NODE_FONT, NODE_SIZE, SPLIT } from '../flow/theme'

/** ドリルダウン / split の各ビューは折りたたみを使わないので、空の集合を使い回す */
export const EMPTY_COLLAPSE: CollapseState = new Set<string>()

/* ------------------------------------------------------------------ *
 * 1. レイアウト
 *    ランク付け・交差最小化・座標・配線は @dagrejs/dagre 3.x（MIT / 同期 API）。
 *    自前実装（最長経路ランク + 文書順 + 行折り返し）は #13 で廃止した。
 *    折り返しは Z 字の読み順崩れと後退辺（848 通り中 1,310 本）の原因だったので、
 *    フローは常に主軸方向の 1 本にし、収まらない分はズーム / パンに任せる。
 *    ※ @logicflow/layout 2.x は npm に存在するが、描画後に renderRawData で描き直す方式で
 *      dynamic-group と衝突し、旧 dagre 0.8 依存なので採らなかった（docs/draft/auto-layout.md）。
 * ------------------------------------------------------------------ */
/** グループ枠の内側パディング（上辺だけタイトル帯ぶん厚くする） */
const GROUP_PAD = 20

/**
 * ドリルダウン時にグループを描く「名前だけの箱」のサイズ。
 * 中身を一切描かないので、折りたたみ表示と同じコンパクトサイズを流用する。
 */
const DRILL_GROUP_SIZE = COLLAPSED_SIZE

/** 階層の外へ出入りするリンクを示す境界マーカー（擬似ノード）のサイズ */
const BOUNDARY_SIZE = { width: 156, height: 44 }

/**
 * 線が枠の側面に刺さる位置を、角からこれだけ内側に寄せる。
 * start / end は radius 20 の角丸なので、これより角に近いと矢印の先が枠から浮く。
 */
const SIDE_INSET = 20
/**
 * 刺さる位置が SIDE_INSET をこれ以下だけ超えるなら、段差を作らず角側へ寄せる。
 * 2〜3px の段差は縮尺 1.4 で「線の欠け」に見える。radius 20 の角でも 8px 内側なら
 * 枠線からのずれは 2px 未満（20 − √(20² − 8²)）。
 */
const JOG_SLACK = 8

/**
 * 線上ラベルの寸法。
 * LogicFlow は edgeText.textWidth で自動折り返しし、背景の矩形も文字数にかかわらず
 * textWidth 幅で描く（LineText.getBackground）。テーマの既定 90px のままだと短いラベルでも
 * 90px の背景が線を隠すので、nodes.ts がエッジごとに labelTextWidth() を textWidth として渡し、
 * ここでは同じ幅 + 両側の余白を dagre に確保させる。
 */
const LABEL_MAX_WIDTH = 90
const LABEL_MARGIN = 12
/** 1 文字の概算幅（11px フォント）。全角は fontSize、半角は 0.65 倍 */
const LABEL_CHAR_WIDE = NODE_FONT.small
const LABEL_CHAR_NARROW = Math.ceil(NODE_FONT.small * 0.65)
/** lf.ts の edgeText.background.wrapPadding '2px,4px' の左右ぶん + 折り返し防止の余裕 */
const LABEL_TEXT_PAD = 12
/** 1 行の高さ（11px フォントの line-height 相当）と上下の余白 */
const LABEL_LINE_HEIGHT = 14
const LABEL_PAD_Y = 3

/** 文字列の描画幅（概算）。半角 = ASCII と半角カナ、それ以外は全角扱い */
function rawTextWidth(label: string): number {
  let w = 0
  for (const ch of label) {
    const code = ch.codePointAt(0) ?? 0
    w += code < 0x2e80 || (code >= 0xff61 && code <= 0xff9f) ? LABEL_CHAR_NARROW : LABEL_CHAR_WIDE
  }
  return w
}

/**
 * 線上ラベルの textWidth（背景矩形の幅）。長いラベルは LABEL_MAX_WIDTH で折り返す。
 * nodes.ts がエッジの textStyle に渡す値と、dagre の予約幅の両方をここから取る。
 */
export function labelTextWidth(label: string): number {
  return Math.min(LABEL_MAX_WIDTH, rawTextWidth(label) + LABEL_TEXT_PAD)
}

export type LayoutCtx = {
  byId: Map<string, FlatNode>
  links: readonly FlowLink[]
  collapsed: CollapseState
  direction: Direction
  /**
   * true = 1 画面 1 階層モード。コンテナの中身へ再帰せず固定サイズの箱として置く。
   * 省略時（nested モード）は従来どおり再帰的に箱詰めする。
   */
  levelOnly?: boolean
  /**
   * 全ノードをこのサイズで置く（split の左ペイン専用）。
   * 左ペインは「上位階層の見取り図」なので kind ごとの大小を付けず一律に小さくする。
   */
  fixedSize?: { width: number; height: number }
  /**
   * 経路入れ子モード（split の左ペイン・nestPath = true）。
   * ここに入っている id のグループだけ中身へ再帰し、それ以外は SPLIT.nodeSize の葉にする。
   */
  nestExpanded?: Set<string>
  /**
   * ノード間隔の上書き。省略時は共通テーマの LAYOUT_GAP。
   * dagre の nodesep（同ランク内）/ ranksep（ランク間）にそのまま渡す。
   * 左ペインの入れ子は「細長い柱の中に箱を積む」ので、本編と同じ間隔だと縦に伸びすぎる。
   */
  gap?: { node: number; rank: number }
}

export type Point = { x: number; y: number }

/** 1 本のエッジの配線結果。points は直交折れ線（両端は枠の側面上）、labelAt はラベルの中心 */
export type EdgeRoute = { points: Point[]; labelAt?: Point }

export type Box = {
  id: string
  /** 親レイアウトで場所取りするサイズ。折りたたみ中のグループは COLLAPSED_SIZE */
  slotW: number
  slotH: number
  /** LogicFlow に渡す実サイズ。グループは常に「展開時」のサイズ */
  fullW: number
  fullH: number
  /** 親コンテンツ原点からの左上オフセット */
  offX: number
  offY: number
  /** 線の刺さり方。diamond は側面の中央にしか刺せない（菱形の頂点だけが枠線に触れる） */
  shape: 'rect' | 'diamond'
  children: Box[]
  /** children の間の配線。座標はこの箱の左上が原点（children の offX/offY と同じ系） */
  edgePoints: Map<string, Point[]>
  labelAt: Map<string, Point>
}

export type Arranged = {
  boxes: Box[]
  width: number
  height: number
  /**
   * エッジの配線。key は edgeKeysOf(ctx.links) と同じ並びで呼び出し側が再現する。
   * 座標は boxes と同じ系（左上 0,0 始まり）。両端がこの階層の箱そのものでないリンク
   * （nested モードで中身のノード同士を結ぶもの）は入らない → 呼び出し側は自動経路に任せる
   */
  edgePoints: Map<string, Point[]>
  /** ラベルを持つエッジの、ラベル中心座標（edgePoints と同じ key・同じ系） */
  labelAt: Map<string, Point>
  /** dagre が付けたランク（主軸の順序）。回帰テストと診断用 */
  ranks: Map<string, number>
}

/**
 * ctx.links の各リンクに対応する配線 key。arrange() と呼び出し側で同じ関数を使う。
 * (from, to, kind) が同じ多重辺は出現順の番号で区別する（構造ケース「多重エッジ」）。
 */
export function edgeKeysOf(links: readonly FlowLink[]): string[] {
  const seen = new Map<string, number>()
  return links.map((l) => {
    const base = JSON.stringify([l.from, l.to, l.kind ?? 'normal'])
    const nth = seen.get(base) ?? 0
    seen.set(base, nth + 1)
    return `${base}#${nth}`
  })
}

type ProjectedLink = {
  index: number
  s: string
  t: string
  /** 両端がこの階層の箱そのもの（＝配線結果をそのまま LogicFlow のエッジに使える） */
  direct: boolean
}

/** 同一階層の兄弟に、リンクを「その階層の代表ノード」へ射影する。自己ループになるものは落とす */
function projectLinks(ids: readonly string[], ctx: LayoutCtx): ProjectedLink[] {
  const owner = new Map<string, string>()
  for (const id of ids) {
    for (const d of descendantsOf(id, ctx.byId)) owner.set(d, id)
  }
  const out: ProjectedLink[] = []
  ctx.links.forEach((l, index) => {
    const s = owner.get(l.from)
    const t = owner.get(l.to)
    if (s === undefined || t === undefined || s === t) return
    out.push({ index, s, t, direct: s === l.from && t === l.to })
  })
  return out
}

/** 子を持たない固定サイズの箱 */
function leafBox(id: string, size: { width: number; height: number }, shape: Box['shape'] = 'rect'): Box {
  return {
    id,
    slotW: size.width,
    slotH: size.height,
    fullW: size.width,
    fullH: size.height,
    offX: 0,
    offY: 0,
    shape,
    children: [],
    edgePoints: new Map(),
    labelAt: new Map(),
  }
}

/** 入れ子の配線を親の座標系へ平行移動する（箱の offX/offY をパディングぶんずらすのと同じ操作） */
function shiftRoutes(
  edgePoints: ReadonlyMap<string, Point[]>,
  labelAt: ReadonlyMap<string, Point>,
  dx: number,
  dy: number,
): Pick<Box, 'edgePoints' | 'labelAt'> {
  const points = new Map<string, Point[]>()
  for (const [k, pts] of edgePoints) points.set(k, pts.map((p) => ({ x: p.x + dx, y: p.y + dy })))
  const labels = new Map<string, Point>()
  for (const [k, p] of labelAt) labels.set(k, { x: p.x + dx, y: p.y + dy })
  return { edgePoints: points, labelAt: labels }
}

/**
 * 経路入れ子ビューの箱詰め（split の左ペイン専用）。
 * 展開対象（＝経路上の祖先）だけ中身へ再帰し、それ以外は一律サイズの葉にする。
 * 入れ子の枠は本編の GROUP_PAD / GROUP_HEADER ではなく SPLIT.nest* を使う（左ペインは幅が命）。
 */
function measureNest(id: string, ctx: LayoutCtx, expanded: Set<string>): Box {
  const node = ctx.byId.get(id)
  if (!node || !node.isContainer || !expanded.has(id)) return leafBox(id, SPLIT.nodeSize)
  const inner = arrange(node.childIds, ctx)
  for (const b of inner.boxes) {
    b.offX += SPLIT.nestPadding
    b.offY += SPLIT.nestHeader
  }
  const fullW = inner.width + SPLIT.nestPadding * 2
  const fullH = inner.height + SPLIT.nestHeader + SPLIT.nestPadding
  return {
    id,
    slotW: fullW,
    slotH: fullH,
    fullW,
    fullH,
    offX: 0,
    offY: 0,
    shape: 'rect',
    children: inner.boxes,
    ...shiftRoutes(inner.edgePoints, inner.labelAt, SPLIT.nestPadding, SPLIT.nestHeader),
  }
}

function measure(id: string, ctx: LayoutCtx): Box {
  // 経路入れ子（split の左ペイン）は専用の箱詰め。fixedSize より先に判定する
  if (ctx.nestExpanded !== undefined) return measureNest(id, ctx, ctx.nestExpanded)
  // split の左ペインは一律サイズ。kind もコンテナ判定も見ない
  if (ctx.fixedSize !== undefined) return leafBox(id, ctx.fixedSize)
  const node = ctx.byId.get(id)
  if (!node) {
    // byId に無い id = ドリルダウンの境界マーカー（階層外への出入りを示す擬似ノード）
    return leafBox(id, BOUNDARY_SIZE)
  }
  // 1 画面 1 階層モードではグループの中身を描かないので、再帰せず名前だけの箱にする
  if (ctx.levelOnly === true && node.isContainer) {
    return leafBox(id, DRILL_GROUP_SIZE)
  }
  if (!node.isContainer) {
    return leafBox(id, NODE_SIZE[node.kind], node.kind === 'decision' ? 'diamond' : 'rect')
  }
  const inner = arrange(node.childIds, ctx)
  for (const b of inner.boxes) {
    b.offX += GROUP_PAD
    b.offY += GROUP_HEADER
  }
  const fullW = inner.width + GROUP_PAD * 2
  const fullH = inner.height + GROUP_HEADER + GROUP_PAD
  const isCollapsed = ctx.collapsed.has(id)
  return {
    id,
    // 折りたたみ中は場所取りを COLLAPSED_SIZE だけにする。
    // LogicFlow の collapse() は「左上を固定して縮む」実装なので、
    // 展開時の箱の左上をこの枠の左上に合わせておけば、畳んだ結果がぴったり枠に収まる。
    slotW: isCollapsed ? COLLAPSED_SIZE.width : fullW,
    slotH: isCollapsed ? COLLAPSED_SIZE.height : fullH,
    fullW,
    fullH,
    offX: 0,
    offY: 0,
    shape: 'rect',
    children: inner.boxes,
    ...shiftRoutes(inner.edgePoints, inner.labelAt, GROUP_PAD, GROUP_HEADER),
  }
}

/**
 * 線上ラベルの占有サイズ（概算）。dagre はこのぶんの場所を空けてくれるので、
 * 「ラベルが隣の枠に重なる」「逆走辺が順路と同じ隙間に重なる」が同時に消える。
 * 幅は背景矩形（labelTextWidth）+ 両側の余白、高さは折り返し後の行数ぶん。
 */
function labelSizeOf(label: string): { width: number; height: number } {
  const width = labelTextWidth(label)
  const lines = Math.max(1, Math.ceil((rawTextWidth(label) + LABEL_TEXT_PAD) / LABEL_MAX_WIDTH))
  return {
    width: width + LABEL_MARGIN * 2,
    height: lines * LABEL_LINE_HEIGHT + LABEL_PAD_Y * 2,
  }
}

/** 主軸 / 交差軸で扱うための箱の幾何（中心と半径） */
type Geom = { m: number; c: number; hm: number; hc: number; snap: boolean }

/**
 * dagre の points（先頭と末尾は枠との交点、中間は仮想ノード）を LogicFlow の polyline 用の
 * 直交折れ線にする。
 *
 * dagre の折れ線は仮想ノードを結ぶ斜線なので、そのまま渡すと LogicFlow の orthogonalizePath が
 * 枠の縁を這う線を作る。ここでは仮想ノードを「通過点」とみなし、
 *   - 出口 / 入口は枠の側面のうち通過点に一番近い位置（角から SIDE_INSET は避ける）
 *   - 通過点どうしの交差軸のずれは、両者の間の空き区間の中央で 1 回だけ曲がる
 * という規則で組み立てる。通過点を主軸に沿って通るので、ラベル（＝通過点の 1 つ）は必ず線上に載る。
 */
function orthogonalRoute(
  pts: readonly Point[],
  from: Geom,
  to: Geom,
  horiz: boolean,
  label: { at: Point; halfMain: number } | undefined,
): Point[] {
  const main = (p: Point) => (horiz ? p.x : p.y)
  const cross = (p: Point) => (horiz ? p.y : p.x)
  const mk = (m: number, c: number): Point => (horiz ? { x: m, y: c } : { x: c, y: m })
  /** 通過点がラベルなら、その主軸方向の半幅（線を曲げてよい区間から除く） */
  const extentOf = (p: Point) =>
    label !== undefined && Math.abs(p.x - label.at.x) < 0.5 && Math.abs(p.y - label.at.y) < 0.5
      ? label.halfMain
      : 0

  // 両端の交点は使わない（斜めの入射点なので）。中間点が無ければ両者の中点を 1 つ置く
  const via = pts.slice(1, -1)
  const waypoints: Point[] = via.length > 0 ? via : [mk((from.m + to.m) / 2, (from.c + to.c) / 2)]

  const attach = (g: Geom, toward: Point): Point => {
    const dir = main(toward) >= g.m ? 1 : -1
    // 側面のうち通過点に一番近い位置。角から SIDE_INSET は避ける（diamond は頂点だけ）
    const span = g.snap ? 0 : Math.max(0, g.hc - SIDE_INSET)
    const slack = g.snap ? 0 : JOG_SLACK
    const want = cross(toward)
    const c =
      Math.abs(want - g.c) <= span + slack
        ? want
        : Math.min(g.c + span, Math.max(g.c - span, want))
    return mk(g.m + dir * g.hm, c)
  }
  const start = attach(from, waypoints[0])
  const end = attach(to, waypoints[waypoints.length - 1])

  const route: Point[] = [start]
  for (const w of [...waypoints, end]) {
    const prev = route[route.length - 1]
    if (Math.abs(cross(w) - cross(prev)) < 0.5) {
      route.push(mk(main(w), cross(prev)))
      continue
    }
    // 空き区間 = 前の点の占有幅を出た所から、次の点の占有幅に入る手前まで。
    // 占有幅が区間より大きいときも 2 点の間から出ない（主軸を戻る折れ線を作らない）
    const dir = main(w) >= main(prev) ? 1 : -1
    const mid = (main(prev) + dir * extentOf(prev) + main(w) - dir * extentOf(w)) / 2
    const lo = Math.min(main(prev), main(w))
    const hi = Math.max(main(prev), main(w))
    const bend = Math.min(hi, Math.max(lo, mid))
    route.push(mk(bend, cross(prev)), mk(bend, cross(w)), mk(main(w), cross(w)))
  }
  return simplifyRoute(route)
}

/** 重複点と、一直線上の中間点を落とす */
function simplifyRoute(route: readonly Point[]): Point[] {
  const out: Point[] = []
  for (const p of route) {
    const last = out[out.length - 1]
    if (last !== undefined && Math.abs(last.x - p.x) < 0.5 && Math.abs(last.y - p.y) < 0.5) continue
    out.push(p)
  }
  const kept: Point[] = []
  out.forEach((p, i) => {
    const a = out[i - 1]
    const b = out[i + 1]
    if (a !== undefined && b !== undefined) {
      const sameX = Math.abs(a.x - p.x) < 0.5 && Math.abs(p.x - b.x) < 0.5
      const sameY = Math.abs(a.y - p.y) < 0.5 && Math.abs(p.y - b.y) < 0.5
      if (sameX || sameY) return
    }
    kept.push(p)
  })
  return kept
}

const EMPTY_ARRANGED = (boxes: Box[]): Arranged => ({
  boxes,
  width: 140,
  height: 60,
  edgePoints: new Map(),
  labelAt: new Map(),
  ranks: new Map(),
})

/** dagre に渡すグラフ型（エッジ名付きの multigraph） */
type DagreGraph = InstanceType<typeof graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>>

/** 配線結果を使う（両端がこの階層の箱そのもの）リンク。dagre のエッジ名 = 配線 key */
type RoutedLink = { key: string; from: Box; to: Box; label: string | undefined }

/**
 * (1) dagre のグラフを組む。ノードは場所取りサイズ（slotW/slotH）で置く。
 * 配線結果を使うのは両端がこの階層の箱そのものであるリンクだけ。
 * 中身のノード同士を結ぶリンク（nested モード）はランク付けにだけ効かせ、同じ箱の組は 1 本に畳む。
 */
function buildDagreGraph(
  ids: readonly string[],
  boxes: readonly Box[],
  ctx: LayoutCtx,
  horiz: boolean,
): { g: DagreGraph; routed: RoutedLink[] } {
  const gap = ctx.gap ?? LAYOUT_GAP
  const keys = edgeKeysOf(ctx.links)
  const boxOf = new Map(boxes.map((b) => [b.id, b] as const))
  const g = new graphlib.Graph<GraphLabel, NodeLabel, EdgeLabel>({ multigraph: true })
  g.setGraph({
    rankdir: horiz ? 'LR' : 'TB',
    nodesep: gap.node,
    ranksep: gap.rank,
    ranker: 'network-simplex',
    marginx: 0,
    marginy: 0,
  })
  g.setDefaultEdgeLabel(() => ({}))
  for (const b of boxes) g.setNode(b.id, { width: b.slotW, height: b.slotH })

  const routed: RoutedLink[] = []
  const projectedSeen = new Set<string>()
  for (const p of projectLinks(ids, ctx)) {
    const link = ctx.links[p.index]
    if (!p.direct) {
      const pairKey = JSON.stringify([p.s, p.t])
      if (projectedSeen.has(pairKey)) continue
      projectedSeen.add(pairKey)
      g.setEdge(p.s, p.t, {}, `proj:${pairKey}`)
      continue
    }
    const key = keys[p.index]
    const label = link.label !== undefined && link.label !== '' ? link.label : undefined
    // label も渡す。dagre がラベルぶんの場所を空けるので、隣接ノード間のラベルが枠に重ならない
    const dims = label === undefined ? {} : { ...labelSizeOf(label), labelpos: 'c' as const }
    g.setEdge(p.s, p.t, dims, key)
    routed.push({ key, from: boxOf.get(p.s) as Box, to: boxOf.get(p.t) as Box, label })
  }
  return { g, routed }
}

/** (2) 箱の位置を確定する。dagre の x/y は中心なので左上オフセットに直す。ランクは診断・回帰用 */
function placeBoxes(g: DagreGraph, boxes: readonly Box[]): Map<string, number> {
  const ranks = new Map<string, number>()
  for (const b of boxes) {
    const n = g.node(b.id)
    b.offX = n.x! - b.slotW / 2
    b.offY = n.y! - b.slotH / 2
    ranks.set(b.id, n.rank ?? 0)
  }
  return ranks
}

/** ラベルの占有矩形（原点の正規化で線やラベルが箱より外へ出るぶんを数える） */
type LabelBox = { at: Point; width: number; height: number }

/** (3) 配線を抽出する。dagre の折れ線を直交化し、ラベル位置を拾う */
function extractRoutes(
  g: DagreGraph,
  routed: readonly RoutedLink[],
  horiz: boolean,
): { edgePoints: Map<string, Point[]>; labelAt: Map<string, Point>; labelBoxes: LabelBox[] } {
  const geomOf = (b: Box): Geom => {
    const cx = b.offX + b.slotW / 2
    const cy = b.offY + b.slotH / 2
    return {
      m: horiz ? cx : cy,
      c: horiz ? cy : cx,
      hm: (horiz ? b.slotW : b.slotH) / 2,
      hc: (horiz ? b.slotH : b.slotW) / 2,
      snap: b.shape === 'diamond',
    }
  }
  const edgePoints = new Map<string, Point[]>()
  const labelAt = new Map<string, Point>()
  const labelBoxes: LabelBox[] = []
  for (const r of routed) {
    const e = g.edge(r.from.id, r.to.id, r.key)
    const pts = e.points ?? []
    let label: { at: Point; halfMain: number } | undefined
    if (r.label !== undefined && e.x !== undefined && e.y !== undefined) {
      const size = labelSizeOf(r.label)
      const at = { x: e.x, y: e.y }
      label = { at, halfMain: (horiz ? size.width : size.height) / 2 }
      labelAt.set(r.key, at)
      labelBoxes.push({ at, ...size })
    }
    edgePoints.set(r.key, orthogonalRoute(pts, geomOf(r.from), geomOf(r.to), horiz, label))
  }
  return { edgePoints, labelAt, labelBoxes }
}

/**
 * (4) 原点を 0 始まりに正規化する（線やラベルが箱より外へ出ることがある）。
 * boxes の offX/offY はその場で平行移動し、配線は移動後の新しい Map を返す。
 */
function normalizeOrigin(
  boxes: readonly Box[],
  edgePoints: ReadonlyMap<string, Point[]>,
  labelAt: ReadonlyMap<string, Point>,
  labelBoxes: readonly LabelBox[],
): Pick<Arranged, 'width' | 'height' | 'edgePoints' | 'labelAt'> {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  const extend = (x0: number, y0: number, x1: number, y1: number) => {
    minX = Math.min(minX, x0)
    minY = Math.min(minY, y0)
    maxX = Math.max(maxX, x1)
    maxY = Math.max(maxY, y1)
  }
  for (const b of boxes) extend(b.offX, b.offY, b.offX + b.slotW, b.offY + b.slotH)
  for (const pts of edgePoints.values()) for (const p of pts) extend(p.x, p.y, p.x, p.y)
  for (const l of labelBoxes) {
    extend(l.at.x - l.width / 2, l.at.y - l.height / 2, l.at.x + l.width / 2, l.at.y + l.height / 2)
  }
  for (const b of boxes) {
    b.offX -= minX
    b.offY -= minY
  }
  const shifted = shiftRoutes(edgePoints, labelAt, -minX, -minY)
  return { width: maxX - minX, height: maxY - minY, ...shifted }
}

/**
 * 1 階層ぶんの箱を並べて配線する。
 * 手順は (1) dagre のグラフを組む → (2) 箱の位置を確定 → (3) 配線を抽出 → (4) 原点を正規化。
 * 入れ子の中身は measure() が再帰的に arrange() を呼んで先に決めている。
 */
export function arrange(ids: readonly string[], ctx: LayoutCtx): Arranged {
  const boxes = ids.map((id) => measure(id, ctx))
  if (boxes.length === 0) return EMPTY_ARRANGED(boxes)

  const horiz = ctx.direction === 'RIGHT'
  const { g, routed } = buildDagreGraph(ids, boxes, ctx, horiz)
  dagreLayout(g)
  const ranks = placeBoxes(g, boxes)
  const { edgePoints, labelAt, labelBoxes } = extractRoutes(g, routed, horiz)
  const normalized = normalizeOrigin(boxes, edgePoints, labelAt, labelBoxes)
  return { boxes, ranks, ...normalized }
}

export type Placed = { x: number; y: number; w: number; h: number }

/** emitArranged() の出力。座標はすべてキャンバス上の絶対座標 */
export type Emitted = {
  positions: Map<string, Placed>
  edgePoints: Map<string, Point[]>
  labelAt: Map<string, Point>
}

/** 配線を (dx, dy) だけずらして out へ流し込む */
function emitRoutes(
  edgePoints: ReadonlyMap<string, Point[]>,
  labelAt: ReadonlyMap<string, Point>,
  dx: number,
  dy: number,
  out: Emitted,
) {
  const shifted = shiftRoutes(edgePoints, labelAt, dx, dy)
  for (const [k, v] of shifted.edgePoints) out.edgePoints.set(k, v)
  for (const [k, v] of shifted.labelAt) out.labelAt.set(k, v)
}

export function emitPositions(
  boxes: readonly Box[],
  ox: number,
  oy: number,
  out: Map<string, Placed>,
  routes?: Emitted,
) {
  for (const b of boxes) {
    const left = ox + b.offX
    const top = oy + b.offY
    // LogicFlow の x/y は中心座標。グループは「展開時サイズ」の中心を渡す
    out.set(b.id, { x: left + b.fullW / 2, y: top + b.fullH / 2, w: b.fullW, h: b.fullH })
    // 中身の配線は箱の左上が原点なので、箱の位置ぶんずらす
    if (routes !== undefined) emitRoutes(b.edgePoints, b.labelAt, left, top, routes)
    emitPositions(b.children, left, top, out, routes)
  }
}

/** arrange() の結果を (ox, oy) に置き、ノード座標と配線をまとめて絶対座標にする */
export function emitArranged(arr: Arranged, ox: number, oy: number): Emitted {
  const out: Emitted = { positions: new Map(), edgePoints: new Map(), labelAt: new Map() }
  emitPositions(arr.boxes, ox, oy, out.positions, out)
  emitRoutes(arr.edgePoints, arr.labelAt, ox, oy, out)
  return out
}

/** key に対応する配線を EdgeRoute にまとめる。無ければ undefined（呼び出し側は自動経路にフォールバック） */
export function routeOf(emitted: Emitted, key: string): EdgeRoute | undefined {
  const points = emitted.edgePoints.get(key)
  if (points === undefined) return undefined
  return { points, labelAt: emitted.labelAt.get(key) }
}

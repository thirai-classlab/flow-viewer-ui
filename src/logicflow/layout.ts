/**
 * LogicFlow アダプタ — 自前レイアウト（DAG のランク付け + 入れ子コンテナの箱詰め）。
 *
 * LogicFlow は座標を一切計算しないので、全モード共通のレイアウト基盤としてここに集約する。
 */

import type { FlatNode } from '../flow/flatten'
import { descendantsOf } from '../flow/flatten'
import type { CollapseState, Direction, FlowLink } from '../flow/schema'
import { COLLAPSED_SIZE, GROUP_HEADER, LAYOUT_GAP, LAYOUT_ROW_GAP, NODE_SIZE, SPLIT } from '../flow/theme'

/** ドリルダウン / split の各ビューは折りたたみを使わないので、空の集合を使い回す */
export const EMPTY_COLLAPSE: CollapseState = new Set<string>()

/* ------------------------------------------------------------------ *
 * 1. レイアウト（LogicFlow は座標を一切計算しないので全部自前）
 *    @logicflow/layout は npm に存在せず node_modules にも無い。
 *    @logicflow/extension の AutoLayout は「未完善」と明記され flowPath 依存なので不採用。
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
   * 左ペインの入れ子は「細長い柱の中に箱を積む」ので、本編と同じ間隔だと縦に伸びすぎる。
   */
  gap?: { node: number; rank: number }
  /**
   * 描き込めるキャンバスの実寸（余白を引いた後の px）。
   *
   * これが与えられると arrange() は「ランクの列を何本ごとに折り返すと
   * 一番大きく描けるか」を実測で選ぶ（chooseRowSize）。
   *
   * 背景: 業務フローは 1 本の長い鎖になりがちで、direction=RIGHT のまま並べると
   * 横 1360 × 縦 140 のような極端な形になる。1280x633 の実測では縮尺 0.55 まで
   * 縮み、キャンバス 820x544 に対してフローは 748x77（面積比 12.9%・縦の 86% が空白）
   * だった。折り返せば縦横比をキャンバスに寄せられるので、縮尺を落とさずに済む。
   *
   * ※ 折り返すのは一番外側の 1 枚だけ。グループの中身（再帰呼び出し）には渡さない。
   */
  fit?: { width: number; height: number }
}

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
  children: Box[]
}

export type Arranged = { boxes: Box[]; width: number; height: number }

/** 同一階層の兄弟に、リンクを「その階層の代表ノード」へ射影して渡す */
function projectLinks(ids: readonly string[], ctx: LayoutCtx): [string, string][] {
  const owner = new Map<string, string>()
  for (const id of ids) {
    for (const d of descendantsOf(id, ctx.byId)) owner.set(d, id)
  }
  const out: [string, string][] = []
  for (const l of ctx.links) {
    const s = owner.get(l.from)
    const t = owner.get(l.to)
    if (s && t && s !== t) out.push([s, t])
  }
  return out
}

/** DFS で後退辺（ループバック）を落として DAG 化 → 最長路でランクを決める */
function computeRanks(ids: readonly string[], edges: readonly [string, string][]): Map<string, number> {
  const adj = new Map<string, string[]>()
  for (const id of ids) adj.set(id, [])
  for (const [s, t] of edges) if (s !== t) adj.get(s)?.push(t)

  const state = new Map<string, 1 | 2>()
  const dag: [string, string][] = []
  const visit = (u: string) => {
    state.set(u, 1)
    for (const v of adj.get(u) ?? []) {
      if (state.get(v) === 1) continue // 後退辺はランク計算から除外
      dag.push([u, v])
      if (!state.has(v)) visit(v)
    }
    state.set(u, 2)
  }
  for (const id of ids) if (!state.has(id)) visit(id)

  const rank = new Map<string, number>(ids.map((id) => [id, 0]))
  const indeg = new Map<string, number>(ids.map((id) => [id, 0]))
  const succ = new Map<string, string[]>(ids.map((id) => [id, []]))
  for (const [s, t] of dag) {
    indeg.set(t, (indeg.get(t) ?? 0) + 1)
    succ.get(s)?.push(t)
  }
  const queue = ids.filter((id) => indeg.get(id) === 0)
  while (queue.length > 0) {
    const u = queue.shift() as string
    for (const v of succ.get(u) ?? []) {
      rank.set(v, Math.max(rank.get(v) ?? 0, (rank.get(u) ?? 0) + 1))
      const left = (indeg.get(v) ?? 0) - 1
      indeg.set(v, left)
      if (left === 0) queue.push(v)
    }
  }
  return rank
}

/** 子を持たない固定サイズの箱 */
function leafBox(id: string, size: { width: number; height: number }): Box {
  return {
    id,
    slotW: size.width,
    slotH: size.height,
    fullW: size.width,
    fullH: size.height,
    offX: 0,
    offY: 0,
    children: [],
  }
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
  return { id, slotW: fullW, slotH: fullH, fullW, fullH, offX: 0, offY: 0, children: inner.boxes }
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
    const s = NODE_SIZE[node.kind]
    return {
      id,
      slotW: s.width,
      slotH: s.height,
      fullW: s.width,
      fullH: s.height,
      offX: 0,
      offY: 0,
      children: [],
    }
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
    children: inner.boxes,
  }
}

/** 折り返し後の全体サイズ（主軸 × 交差軸）。chooseRowSize の評価にも使う */
function measureRows(
  perRow: number,
  laneMain: readonly number[],
  laneCross: readonly number[],
  gap: { node: number; rank: number },
): { main: number; cross: number; rows: number[][] } {
  const rows: number[][] = []
  for (let i = 0; i < laneMain.length; i += perRow) {
    const row: number[] = []
    for (let j = i; j < Math.min(i + perRow, laneMain.length); j += 1) row.push(j)
    rows.push(row)
  }
  let main = 0
  let cross = 0
  rows.forEach((row, r) => {
    const rowMain = row.reduce((s, i) => s + laneMain[i], 0) + gap.rank * Math.max(0, row.length - 1)
    const rowCross = row.reduce((m, i) => Math.max(m, laneCross[i]), 0)
    main = Math.max(main, rowMain)
    cross += rowCross + (r > 0 ? LAYOUT_ROW_GAP : 0)
  })
  return { main, cross, rows }
}

/**
 * 「1 行あたり何本のランクを並べるか」を実測で決める。
 *
 * 候補（1 本ずつ〜折り返し無し）を全部組んでみて、fit に収めたときの縮尺が
 * 一番大きくなるものを採る。折り返しは読み順を増やすコストがあるので、
 * 明確に（6% 以上）大きくならない限りは行数の少ない側を優先する。
 */
function chooseRowSize(
  laneMain: readonly number[],
  laneCross: readonly number[],
  gap: { node: number; rank: number },
  fitMain: number,
  fitCross: number,
): number {
  const n = laneMain.length
  if (n <= 1) return Math.max(1, n)
  let best = n
  let bestScale = -1
  // 折り返し無し（perRow = n）から順に減らす。同点なら先に見た＝行数の少ない側が残る
  for (let perRow = n; perRow >= 1; perRow -= 1) {
    const { main, cross } = measureRows(perRow, laneMain, laneCross, gap)
    const scale = Math.min(fitMain / Math.max(main, 1), fitCross / Math.max(cross, 1))
    if (scale > bestScale * 1.06) {
      bestScale = scale
      best = perRow
    }
  }
  return best
}

export function arrange(ids: readonly string[], ctx: LayoutCtx): Arranged {
  // 折り返しは一番外側の 1 枚だけ。グループの中身には fit を渡さない
  const inner = ctx.fit === undefined ? ctx : { ...ctx, fit: undefined }
  const boxes = ids.map((id) => measure(id, inner))
  if (boxes.length === 0) return { boxes, width: 140, height: 60 }

  const rank = computeRanks(ids, projectLinks(ids, ctx))
  const horiz = ctx.direction === 'RIGHT'
  const gap = ctx.gap ?? LAYOUT_GAP
  const mainOf = (b: Box) => (horiz ? b.slotW : b.slotH)
  const crossOf = (b: Box) => (horiz ? b.slotH : b.slotW)

  let maxRank = 0
  for (const r of rank.values()) maxRank = Math.max(maxRank, r)
  const lanes: Box[][] = Array.from({ length: maxRank + 1 }, () => [])
  for (const b of boxes) lanes[rank.get(b.id) ?? 0].push(b)

  const laneMain = lanes.map((l) => l.reduce((m, b) => Math.max(m, mainOf(b)), 0))
  const laneCross = lanes.map(
    (l) => l.reduce((s, b) => s + crossOf(b), 0) + gap.node * Math.max(0, l.length - 1),
  )

  /* --- 何本ごとに折り返すか。fit が無ければ従来どおり 1 行に全部並べる --- */
  const perRow =
    ctx.fit === undefined
      ? lanes.length
      : chooseRowSize(
          laneMain,
          laneCross,
          gap,
          horiz ? ctx.fit.width : ctx.fit.height,
          horiz ? ctx.fit.height : ctx.fit.width,
        )
  const { main: totalMain, cross: totalCross, rows } = measureRows(perRow, laneMain, laneCross, gap)

  let rowCrossBase = 0
  for (const row of rows) {
    const rowCross = row.reduce((m, i) => Math.max(m, laneCross[i]), 0)
    let mainAcc = 0
    for (const i of row) {
      // 行の中では交差軸方向に中央寄せ。行をまたぐと左端が揃うので読み順が崩れない
      let cross = rowCrossBase + (rowCross - laneCross[i]) / 2
      for (const b of lanes[i]) {
        const main = mainAcc + (laneMain[i] - mainOf(b)) / 2
        if (horiz) {
          b.offX = main
          b.offY = cross
        } else {
          b.offY = main
          b.offX = cross
        }
        cross += crossOf(b) + gap.node
      }
      mainAcc += laneMain[i] + gap.rank
    }
    rowCrossBase += rowCross + LAYOUT_ROW_GAP
  }

  return {
    boxes,
    width: horiz ? totalMain : totalCross,
    height: horiz ? totalCross : totalMain,
  }
}

export type Placed = { x: number; y: number; w: number; h: number }

export function emitPositions(boxes: readonly Box[], ox: number, oy: number, out: Map<string, Placed>) {
  for (const b of boxes) {
    const left = ox + b.offX
    const top = oy + b.offY
    // LogicFlow の x/y は中心座標。グループは「展開時サイズ」の中心を渡す
    out.set(b.id, { x: left + b.fullW / 2, y: top + b.fullH / 2, w: b.fullW, h: b.fullH })
    emitPositions(b.children, left, top, out)
  }
}

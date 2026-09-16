/**
 * LogicFlow アダプタ — ELK の出力を読む。
 *
 * ELK は座標を親からの相対で返し、辺は宣言したコンテナに残す。
 * ここで絶対座標（root 原点）に直し、Box の木と直交折れ線に組み替える。
 */

import type { ElkExtendedEdge, ElkNode } from 'elkjs/lib/elk-api.js'

import type { Arranged, Bounds, Box, Point, Spec } from './layout-model'
import { leafBox, shiftRoutes } from './layout-model'

export type Abs = { x: number; y: number; w: number; h: number }

/** ELK の座標は親からの相対なので、絶対座標（root 原点）に直しておく */
export function absolutize(node: ElkNode, ox: number, oy: number, out: Map<string, Abs>): void {
  for (const c of node.children ?? []) {
    const x = ox + (c.x ?? 0)
    const y = oy + (c.y ?? 0)
    out.set(c.id, { x, y, w: c.width ?? 0, h: c.height ?? 0 })
    absolutize(c, x, y, out)
  }
}

/** 辺は宣言したコンテナに残るので、そのコンテナの絶対原点を足して読む */
export function collectEdges(
  node: ElkNode,
  origin: Point,
  abs: Map<string, Abs>,
  out: { edge: ElkExtendedEdge; origin: Point }[],
): void {
  for (const e of node.edges ?? []) out.push({ edge: e as ElkExtendedEdge, origin })
  for (const c of node.children ?? []) {
    const a = abs.get(c.id)
    if (a === undefined) continue
    collectEdges(c, { x: a.x, y: a.y }, abs, out)
  }
}

/** spec の木と ELK の絶対座標から Box の木を組み立てる（offX/offY は親の左上からの相対） */
export function toBoxes(specs: readonly Spec[], abs: Map<string, Abs>, parentAt: Point): Box[] {
  const out: Box[] = []
  for (const s of specs) {
    const at = abs.get(s.id)
    if (at === undefined) continue
    const offX = at.x - parentAt.x
    const offY = at.y - parentAt.y
    if (s.kind === 'collapsed') {
      out.push({ ...s.box, offX, offY })
      continue
    }
    if (s.kind === 'leaf') {
      out.push({ ...leafBox(s.id, { width: s.w, height: s.h }, s.shape), offX, offY })
      continue
    }
    out.push({
      id: s.id,
      slotW: at.w,
      slotH: at.h,
      fullW: at.w,
      fullH: at.h,
      offX,
      offY,
      shape: 'rect',
      children: toBoxes(s.children, abs, { x: at.x, y: at.y }),
      edgePoints: new Map(),
      labelAt: new Map(),
    })
  }
  return out
}

/**
 * ひし形の端点を 4 頂点の外周まで伸ばす。
 *
 * ELK が返す端点は bbox の枠線上なので、ひし形では頂点以外が図形の外に浮く
 * （#18 の実装では 1,418 本中 432 本 = 30.5%）。最終セグメントの向き（主軸に平行）を
 * 保ったまま外周まで伸ばすので直交は崩れない（848 通りで外周外 0 / 非直交 0 / 逆走 0）。
 */
export function snapDiamondEndpoints(
  routes: ReadonlyMap<string, Point[]>,
  boxOf: (id: string) => { at: Abs; shape: Box['shape'] } | undefined,
  ends: ReadonlyMap<string, { source: string; target: string }>,
): void {
  const snap = (p: Point, prev: Point, n: Abs): Point => {
    const cx = n.x + n.w / 2
    const cy = n.y + n.h / 2
    // 最終セグメントより長く食い込ませない保険（上限つき offset なので実測では発火 0 回）
    const limit = (v: number, seg: number) => Math.min(v, Math.max(0, seg - 1))
    if (Math.abs(p.x - prev.x) < 0.5) {
      const inset = limit((Math.abs(p.x - cx) * n.h) / n.w, Math.abs(p.y - prev.y))
      return { x: p.x, y: p.y < cy ? n.y + inset : n.y + n.h - inset }
    }
    const inset = limit((Math.abs(p.y - cy) * n.w) / n.h, Math.abs(p.x - prev.x))
    return { x: p.x < cx ? n.x + inset : n.x + n.w - inset, y: p.y }
  }
  for (const [key, pts] of routes) {
    if (pts.length < 2) continue
    const e = ends.get(key)
    if (e === undefined) continue
    const s = boxOf(e.source)
    const t = boxOf(e.target)
    if (s !== undefined && s.shape === 'diamond') pts[0] = snap(pts[0], pts[1], s.at)
    if (t !== undefined && t.shape === 'diamond') {
      const k = pts.length - 1
      pts[k] = snap(pts[k], pts[k - 1], t.at)
    }
  }
}

/** ラベルの占有矩形（原点の正規化で線やラベルが箱より外へ出るぶんを数える） */
export type LabelBox = { at: Point; width: number; height: number }

/**
 * 原点を 0 始まりに正規化する（線やラベルが箱より外へ出ることがある）。
 * boxes の offX/offY はその場で平行移動し、配線は移動後の新しい Map を返す。
 */
export function normalizeOrigin(
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
 * 主軸方向の層番号。ELK layered は同じ層のノードを主軸の開始座標で揃えるので、
 * トップレベルの箱の開始座標をまとめて番号にすれば層番号が復元できる（実測で確認）。
 */
export function ranksOf(boxes: readonly Box[], horiz: boolean): Map<string, number> {
  const mainOf = (b: Box) => Math.round(horiz ? b.offX : b.offY)
  const layers = [...new Set(boxes.map(mainOf))].sort((a, b) => a - b)
  const indexOf = new Map(layers.map((v, i) => [v, i] as const))
  return new Map(boxes.map((b) => [b.id, indexOf.get(mainOf(b)) ?? 0] as const))
}

export const EMPTY_ARRANGED = (boxes: Box[]): Arranged => ({
  boxes,
  width: 140,
  height: 60,
  edgePoints: new Map(),
  labelAt: new Map(),
  ranks: new Map(),
  nodeBox: { x: 0, y: 0, w: 140, h: 60 },
  headBox: { x: 0, y: 0, w: 140, h: 60 },
  projected: new Map(),
})

/**
 * トップレベルの箱（場所取りサイズ）だけの外接矩形と、主軸の先頭にある箱。
 * 折りたたみ中のグループは slotW / slotH（= COLLAPSED_SIZE）で数える。画面に出ている大きさがそれだから。
 */
export function boxFrameOf(
  boxes: readonly Box[],
  horiz: boolean,
  fallback: Bounds,
): Pick<Arranged, 'nodeBox' | 'headBox'> {
  if (boxes.length === 0) return { nodeBox: fallback, headBox: fallback }
  const mainOf = (b: Box) => (horiz ? b.offX : b.offY)
  const crossOf = (b: Box) => (horiz ? b.offY : b.offX)
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  let head = boxes[0]
  for (const b of boxes) {
    minX = Math.min(minX, b.offX)
    minY = Math.min(minY, b.offY)
    maxX = Math.max(maxX, b.offX + b.slotW)
    maxY = Math.max(maxY, b.offY + b.slotH)
    // 主軸が同じなら交差軸の小さいほう（= 読み始めの位置）を先頭にする
    const d = mainOf(b) - mainOf(head)
    if (d < -0.5 || (Math.abs(d) <= 0.5 && crossOf(b) < crossOf(head))) head = b
  }
  return {
    nodeBox: { x: minX, y: minY, w: maxX - minX, h: maxY - minY },
    headBox: { x: head.offX, y: head.offY, w: head.slotW, h: head.slotH },
  }
}


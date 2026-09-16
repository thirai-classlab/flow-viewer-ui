/**
 * LogicFlow アダプタ — arrange() の結果を LogicFlow の座標系へ流し込む。
 *
 * LogicFlow の x / y は中心座標。グループは「展開時サイズ」の中心を渡す
 * （折りたたみは左上を固定して COLLAPSED_SIZE に縮むので、これで枠にぴったり収まる）。
 */

import type { Arranged, Box, EdgeRoute, Emitted, Placed, Point } from './layout-model'
import { shiftBounds, shiftRoutes } from './layout-model'

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

function emitPositions(
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
  const out: Emitted = {
    positions: new Map(),
    edgePoints: new Map(),
    labelAt: new Map(),
    nodeBox: shiftBounds(arr.nodeBox, ox, oy),
    headBox: shiftBounds(arr.headBox, ox, oy),
    projected: new Map(
      [...arr.projected].map(([k, pts]) => [k, pts.map((p) => ({ x: p.x + ox, y: p.y + oy }))] as const),
    ),
  }
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

/**
 * レイアウト回帰（ヘッドレス）。
 *
 * 32 ケース × 全ドリル経路 × RIGHT/DOWN = 848 通りを arrange() に通し、
 *   例外 0 / 座標 NaN 0 / 同階層の箱の重なり 0 / DAG 上は前進なのに主軸で後退する辺 0
 * を assert する。面積比・縮尺は集計して console に出すだけ（assert しない）。
 *
 * drilldown（showContext = false）の buildDrillGraph 相当を、LogicFlow を介さずに回す
 * （境界マーカーは省略）。src/flow/ は読み取り専用で import する。
 *
 * 加えて buildDrillGraph 本体（境界マーカー `__edge:` 擬似ノード込み）も全ドリル経路で回し、
 * 境界エッジの経路が直交・端点が枠線上であることを同じ checker で assert する（#15、#13 のレビュー MEDIUM）。
 */

import { describe, expect, it } from 'vitest'

import { allCases } from '../src/flow/cases'
import { edgesAtLevel, nodesAtLevel } from '../src/flow/collapse'
import { flattenDoc } from '../src/flow/flatten'
import type { FlowLink } from '../src/flow/schema'
import { FIT } from '../src/flow/theme'
import { buildDrillGraph } from '../src/logicflow/drilldown'
import type { LayoutCtx, Placed, Point } from '../src/logicflow/layout'
import { EMPTY_COLLAPSE, arrange, edgeKeysOf, emitArranged } from '../src/logicflow/layout'

/** NOTES.md の実測条件（1280x593 のキャンバス） */
const CANVAS = { width: 1280, height: 593 }
const FIT_BOX = { width: CANVAS.width - FIT.padding, height: CANVAS.height - FIT.padding }
/** 32 ケース × 全ドリル経路 × 2 方向。ケースを増減したらここも更新する */
const EXPECTED_RUNS = 848

type Run = {
  id: string
  direction: 'RIGHT' | 'DOWN'
  nodes: number
  edges: number
  scale: number
  area: number
}

type Sweep = {
  runs: Run[]
  errors: string[]
  nan: string[]
  overlaps: string[]
  backward: string[]
  brokenRoutes: string[]
  labelsOffRoute: string[]
}

const isFinitePoint = (p: Point) => Number.isFinite(p.x) && Number.isFinite(p.y)

/** 点 p が線分 a-b（軸平行）の上に乗っているか */
function onSegment(p: Point, a: Point, b: Point, eps = 0.5): boolean {
  const minX = Math.min(a.x, b.x) - eps
  const maxX = Math.max(a.x, b.x) + eps
  const minY = Math.min(a.y, b.y) - eps
  const maxY = Math.max(a.y, b.y) + eps
  if (p.x < minX || p.x > maxX || p.y < minY || p.y > maxY) return false
  if (Math.abs(a.x - b.x) < eps) return Math.abs(p.x - a.x) <= eps
  if (Math.abs(a.y - b.y) < eps) return Math.abs(p.y - a.y) <= eps
  return false
}

/** 点 p が箱 at の枠線上にあるか */
function onBorder(p: Point, at: Placed, eps = 0.5): boolean {
  const left = at.x - at.w / 2
  const right = at.x + at.w / 2
  const top = at.y - at.h / 2
  const bottom = at.y + at.h / 2
  const inX = p.x >= left - eps && p.x <= right + eps
  const inY = p.y >= top - eps && p.y <= bottom + eps
  const onV = (Math.abs(p.x - left) <= eps || Math.abs(p.x - right) <= eps) && inY
  const onH = (Math.abs(p.y - top) <= eps || Math.abs(p.y - bottom) <= eps) && inX
  return onV || onH
}

function sweep(): Sweep {
  const out: Sweep = {
    runs: [],
    errors: [],
    nan: [],
    overlaps: [],
    backward: [],
    brokenRoutes: [],
    labelsOffRoute: [],
  }
  for (const c of allCases) {
    const flat = flattenDoc(c.doc)
    const roots: (string | null)[] = [null, ...flat.containerIds]
    for (const root of roots) {
      const level = nodesAtLevel(flat.nodes, flat.parentOf, root)
      if (level.length === 0) continue
      const { edges } = edgesAtLevel(c.doc.links, flat.parentOf, root)
      const links: FlowLink[] = edges.map((e) => ({
        from: e.source,
        to: e.target,
        kind: e.kind,
        label: e.label,
      }))
      for (const direction of ['RIGHT', 'DOWN'] as const) {
        const tag = `${c.id}/${root ?? 'top'}/${direction}`
        try {
          const ctx: LayoutCtx = {
            byId: flat.byId,
            links,
            collapsed: EMPTY_COLLAPSE,
            direction,
            levelOnly: true,
          }
          const ids = level.map((n) => n.id)
          const arranged = arrange(ids, ctx)
          const { positions, edgePoints, labelAt } = emitArranged(arranged, 0, 0)
          const keys = edgeKeysOf(links)
          const mainOf = (p: Point) => (direction === 'RIGHT' ? p.x : p.y)

          // --- NaN ---
          if (!Number.isFinite(arranged.width) || !Number.isFinite(arranged.height)) {
            out.nan.push(`${tag}: size`)
          }
          for (const [id, at] of positions) {
            if (![at.x, at.y, at.w, at.h].every(Number.isFinite)) out.nan.push(`${tag}: ${id}`)
          }
          for (const [key, pts] of edgePoints) {
            if (!pts.every(isFinitePoint)) out.nan.push(`${tag}: edge ${key}`)
          }

          // --- 同階層の箱の重なり ---
          const list = ids.map((id) => [id, positions.get(id)] as const)
          for (let i = 0; i < list.length; i += 1) {
            for (let j = i + 1; j < list.length; j += 1) {
              const [ia, a] = list[i]
              const [ib, b] = list[j]
              if (a === undefined || b === undefined) continue
              if (Math.abs(a.x - b.x) * 2 < a.w + b.w && Math.abs(a.y - b.y) * 2 < a.h + b.h) {
                out.overlaps.push(`${tag}: ${ia} x ${ib}`)
              }
            }
          }

          // --- DAG 上は前進（dagre のランクが増える）なのに主軸で後退する辺 ---
          links.forEach((l, i) => {
            const rs = arranged.ranks.get(l.from)
            const rt = arranged.ranks.get(l.to)
            const s = positions.get(l.from)
            const t = positions.get(l.to)
            if (rs === undefined || rt === undefined || s === undefined || t === undefined) return
            if (rs < rt && mainOf(t) <= mainOf(s)) out.backward.push(`${tag}: ${keys[i]}`)
          })

          // --- 配線の健全性: 直交・両端が枠線上・ラベルが線上 ---
          links.forEach((l, i) => {
            const pts = edgePoints.get(keys[i])
            if (pts === undefined) {
              out.brokenRoutes.push(`${tag}: no route for ${keys[i]}`)
              return
            }
            const s = positions.get(l.from)
            const t = positions.get(l.to)
            if (pts.length < 2 || s === undefined || t === undefined) {
              out.brokenRoutes.push(`${tag}: short route ${keys[i]}`)
              return
            }
            for (let k = 1; k < pts.length; k += 1) {
              const a = pts[k - 1]
              const b = pts[k]
              if (Math.abs(a.x - b.x) > 0.5 && Math.abs(a.y - b.y) > 0.5) {
                out.brokenRoutes.push(`${tag}: diagonal segment in ${keys[i]}`)
                break
              }
            }
            if (!onBorder(pts[0], s)) out.brokenRoutes.push(`${tag}: start off border ${keys[i]}`)
            if (!onBorder(pts[pts.length - 1], t)) {
              out.brokenRoutes.push(`${tag}: end off border ${keys[i]}`)
            }
            const lab = labelAt.get(keys[i])
            if (lab !== undefined) {
              let hit = false
              for (let k = 1; k < pts.length; k += 1) if (onSegment(lab, pts[k - 1], pts[k])) hit = true
              if (!hit) out.labelsOffRoute.push(`${tag}: ${keys[i]}`)
            }
          })

          // --- 集計だけ（assert しない） ---
          const scale = Math.min(
            FIT.maxScale,
            Math.max(
              FIT.minScale,
              Math.min(FIT_BOX.width / arranged.width, FIT_BOX.height / arranged.height),
            ),
          )
          const area = (arranged.width * scale * arranged.height * scale) / (CANVAS.width * CANVAS.height)
          out.runs.push({ id: tag, direction, nodes: level.length, edges: edges.length, scale, area })
        } catch (e: unknown) {
          out.errors.push(`${tag}: ${e instanceof Error ? `${e.name}: ${e.message}` : String(e)}`)
        }
      }
    }
  }
  return out
}

/** 直交折れ線か（斜めの区間が無い） */
function isOrthogonal(pts: readonly Point[]): boolean {
  for (let k = 1; k < pts.length; k += 1) {
    if (Math.abs(pts[k - 1].x - pts[k].x) > 0.5 && Math.abs(pts[k - 1].y - pts[k].y) > 0.5) return false
  }
  return true
}

type BoundarySweep = { runs: number; markers: number; boundaryEdges: number; broken: string[] }

/**
 * buildDrillGraph（境界マーカー込み）を 32 ケース × 全ドリル経路 × 2 方向で回す。
 * LogicFlow のエッジ config（pointsList / startPoint / endPoint）を、ノードの確定座標（positions）に対して
 * arrange() の sweep と同じ基準で検査する。境界マーカーは flat.byId に無い擬似ノードなので、
 * 位置は positions（buildDrillGraph が返す）から引く。
 */
function sweepBoundaries(): BoundarySweep {
  const out: BoundarySweep = { runs: 0, markers: 0, boundaryEdges: 0, broken: [] }
  const docIds = new Set<string>()
  for (const c of allCases) {
    const flat = flattenDoc(c.doc)
    for (const root of [null, ...flat.containerIds]) {
      const level = nodesAtLevel(flat.nodes, flat.parentOf, root)
      if (level.length === 0) continue
      for (const direction of ['RIGHT', 'DOWN'] as const) {
        const tag = `${c.id}/${root ?? 'top'}/${direction}`
        out.runs += 1
        const graph = buildDrillGraph(level, c.doc.links, flat, root, direction, docIds)
        out.markers += graph.boundaryCount
        for (const e of graph.edges) {
          const isBoundary = (e.id ?? '').startsWith('bd-')
          if (isBoundary) out.boundaryEdges += 1
          const pts = e.pointsList
          const s = graph.positions.get(e.sourceNodeId)
          const t = graph.positions.get(e.targetNodeId)
          if (pts === undefined || pts.length < 2 || s === undefined || t === undefined) {
            out.broken.push(`${tag}: no route ${e.id ?? '?'}`)
            continue
          }
          if (!isOrthogonal(pts)) out.broken.push(`${tag}: diagonal segment in ${e.id}`)
          if (!onBorder(pts[0], s)) out.broken.push(`${tag}: start off border ${e.id}`)
          if (!onBorder(pts[pts.length - 1], t)) out.broken.push(`${tag}: end off border ${e.id}`)
        }
      }
    }
  }
  return out
}

const result = sweep()
const boundaryResult = sweepBoundaries()

describe('arrange() 848 通りの回帰', () => {
  it('例外 0', () => {
    expect(result.errors).toEqual([])
    expect(result.runs.length).toBe(EXPECTED_RUNS)
  })

  it('座標 NaN 0', () => {
    expect(result.nan).toEqual([])
  })

  it('同階層の箱の重なり 0', () => {
    expect(result.overlaps).toEqual([])
  })

  it('DAG 上は前進なのに主軸で後退する辺 0', () => {
    expect(result.backward).toEqual([])
  })

  it('配線は直交で両端が枠線上、ラベルは線上', () => {
    expect(result.brokenRoutes).toEqual([])
    expect(result.labelsOffRoute).toEqual([])
  })

  it('buildDrillGraph（境界マーカー込み）: 全エッジが直交で両端が枠線上', () => {
    expect(boundaryResult.runs).toBe(EXPECTED_RUNS)
    // 境界マーカーが 1 つも無ければこのケースは何も検査していない
    expect(boundaryResult.markers).toBeGreaterThan(0)
    expect(boundaryResult.boundaryEdges).toBe(boundaryResult.markers)
    expect(boundaryResult.broken).toEqual([])
  })

  it('面積比・縮尺の集計（レポートのみ）', () => {
    const runs = result.runs
    const sorted = (f: (r: Run) => number) => runs.map(f).sort((a, b) => a - b)
    const median = (xs: number[]) => xs[Math.floor(xs.length / 2)] ?? 0
    const mean = (xs: number[]) => xs.reduce((s, x) => s + x, 0) / Math.max(1, xs.length)
    const areas = sorted((r) => r.area)
    const scales = sorted((r) => r.scale)
    const pct = (xs: number[], th: number) =>
      ((100 * xs.filter((x) => x >= th).length) / Math.max(1, xs.length)).toFixed(1)
    const lines = [
      `runs=${runs.length} (canvas ${CANVAS.width}x${CANVAS.height}, padding ${FIT.padding})`,
      `area  mean=${(100 * mean(areas)).toFixed(1)}% median=${(100 * median(areas)).toFixed(1)}% >=50%: ${pct(areas, 0.5)}%`,
      `scale median=${median(scales).toFixed(2)} >=0.92(12px): ${pct(scales, 12 / 13)}% >=0.85(11px): ${pct(scales, 11 / 13)}% >=0.7: ${pct(scales, 0.7)}%`,
    ]
    console.log(`[layout.sweep]\n  ${lines.join('\n  ')}`)
    expect(runs.length).toBeGreaterThan(0)
  })
})

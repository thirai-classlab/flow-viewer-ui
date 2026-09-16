/**
 * レイアウト回帰（ヘッドレス）。
 *
 * 32 ケース × 全ドリル経路 × RIGHT/DOWN = 848 通りを arrange() に通し、
 *   例外 0 / 座標 NaN 0 / 同階層の箱の重なり 0 / 主軸で後退する辺 0 /
 *   配線は直交・両端が図形の外周上 / 線が無関係な箱を貫通 0
 * に加えて #19（ELK 化）で看板にした 4 点を assert する。
 *   ラベルが自分の線に重なる 0 / ひし形の端点が多角形の外周から外れる 0 /
 *   出口が下辺・側面（＝入口側の辺から出ない）1.00 / 上辺に入る線が中央 ≥ 0.95
 * 面積比・縮尺は集計して console に出すだけ（assert しない）。
 *
 * drilldown（showContext = false）の buildDrillGraph 相当を、LogicFlow を介さずに回す
 * （境界マーカーは省略）。src/flow/ は読み取り専用で import する。
 *
 * 加えて buildDrillGraph 本体（境界マーカー `__edge:` 擬似ノード込み）も全ドリル経路で回し、
 * 境界エッジの経路が直交・端点が外周上であることを同じ checker で assert する。
 */

import { beforeAll, describe, expect, it } from 'vitest'

import { allCases } from '../src/flow/cases'
import { edgesAtLevel, nodesAtLevel, pathNestView } from '../src/flow/collapse'
import { flattenDoc } from '../src/flow/flatten'
import type { FlowLink } from '../src/flow/schema'
import { FIT } from '../src/flow/theme'
import { SPLIT_FIT_PADDING, fitViewport } from '../src/logicflow/anim'
import { buildDrillGraph } from '../src/logicflow/drilldown'
import type { LayoutCtx, Placed, Point } from '../src/logicflow/layout'
import { EMPTY_COLLAPSE, arrange, edgeKeysOf, emitArranged, labelTextWidth } from '../src/logicflow/layout'
import { buildSplitNestGraph } from '../src/logicflow/split'

/** NOTES.md の実測条件（1280x593 のキャンバス） */
const CANVAS = { width: 1280, height: 593 }
const FIT_BOX = { width: CANVAS.width - FIT.padding, height: CANVAS.height - FIT.padding }
/** 32 ケース × 全ドリル経路 × 2 方向。ケースを増減したらここも更新する */
const EXPECTED_RUNS = 848
/** 線上ラベルの背景矩形の高さ（LineText が描く実寸）。幅は labelTextWidth() */
const LABEL_H = 18
/** 座標の許容誤差（ELK は 0.1px 単位の小数を返す） */
const TOL = 1.5

/** 848 通りは 1 通りあたり 2 回 ELK を回す（arrange + buildDrillGraph）ので長めに取る */
const SWEEP_TIMEOUT = 600_000

type Rect = { x: number; y: number; w: number; h: number; shape: 'rect' | 'diamond' }
type Side = 'top' | 'bottom' | 'left' | 'right'

/** LogicFlow の中心座標（Placed）を左上基準の矩形に直す */
const rectOf = (at: Placed, shape: Rect['shape']): Rect => ({
  x: at.x - at.w / 2,
  y: at.y - at.h / 2,
  w: at.w,
  h: at.h,
  shape,
})

/** 矩形の枠線上にあるか */
function onRectBorder(p: Point, r: Rect, eps = TOL): boolean {
  const inX = p.x >= r.x - eps && p.x <= r.x + r.w + eps
  const inY = p.y >= r.y - eps && p.y <= r.y + r.h + eps
  const onV = (Math.abs(p.x - r.x) <= eps || Math.abs(p.x - (r.x + r.w)) <= eps) && inY
  const onH = (Math.abs(p.y - r.y) <= eps || Math.abs(p.y - (r.y + r.h)) <= eps) && inX
  return onV || onH
}

/** ひし形の 4 頂点（上 → 右 → 下 → 左）。nodes.ts の diamond が描く多角形と同じ */
function diamondVertices(r: Rect): [Point, Point, Point, Point] {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  return [
    { x: cx, y: r.y },
    { x: r.x + r.w, y: cy },
    { x: cx, y: r.y + r.h },
    { x: r.x, y: cy },
  ]
}

function distToSeg(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x
  const dy = b.y - a.y
  const len2 = dx * dx + dy * dy
  if (len2 < 1e-9) return Math.hypot(p.x - a.x, p.y - a.y)
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2))
  return Math.hypot(p.x - (a.x + t * dx), p.y - (a.y + t * dy))
}

/**
 * ひし形の「外周」に乗っているか。bbox で見ると頂点以外の上辺・下辺も辺扱いになり、
 * 図形の外に浮いた端点を見逃す（#18 の計測が嘘をついた原因）。4 頂点を結ぶ 4 辺で判定する。
 */
function onDiamondOutline(p: Point, r: Rect): boolean {
  const v = diamondVertices(r)
  for (let i = 0; i < 4; i += 1) {
    if (distToSeg(p, v[i], v[(i + 1) % 4]) <= TOL) return true
  }
  return false
}

/** 端点が図形の外周上にあるか（矩形は枠線、ひし形は 4 頂点を結ぶ多角形） */
const onOutline = (p: Point, r: Rect): boolean =>
  r.shape === 'diamond' ? onDiamondOutline(p, r) : onRectBorder(p, r)

/**
 * 端点が図形のどの辺に刺さっているか。
 * ひし形の斜辺は「上かつ左」なので位置だけでは決まらない。
 * 隣の通過点（= 線が来た向き）が縦なら上下、横なら左右で判定する。
 */
function attachSide(p: Point, r: Rect, neighbor: Point): Side | null {
  const cx = r.x + r.w / 2
  const cy = r.y + r.h / 2
  if (r.shape === 'diamond') {
    if (!onDiamondOutline(p, r)) return null
    const vertical = Math.abs(p.x - neighbor.x) < 0.5
    if (vertical) return p.y <= cy ? 'top' : 'bottom'
    return p.x <= cx ? 'left' : 'right'
  }
  const inX = p.x >= r.x - TOL && p.x <= r.x + r.w + TOL
  const inY = p.y >= r.y - TOL && p.y <= r.y + r.h + TOL
  if (inX && Math.abs(p.y - r.y) <= TOL) return 'top'
  if (inX && Math.abs(p.y - (r.y + r.h)) <= TOL) return 'bottom'
  if (inY && Math.abs(p.x - r.x) <= TOL) return 'left'
  if (inY && Math.abs(p.x - (r.x + r.w)) <= TOL) return 'right'
  return null
}

/** 線分が箱の内部を通るか（Liang-Barsky）。箱は 1px 内側に縮めて、辺に接するだけの線は数えない */
function segHitsBox(a: Point, b: Point, x0: number, y0: number, x1: number, y1: number): boolean {
  let t0 = 0
  let t1 = 1
  const dx = b.x - a.x
  const dy = b.y - a.y
  const p = [-dx, dx, -dy, dy]
  const q = [a.x - x0, x1 - a.x, a.y - y0, y1 - a.y]
  for (let i = 0; i < 4; i += 1) {
    if (Math.abs(p[i]) < 1e-9) {
      if (q[i] < 0) return false
    } else {
      const r = q[i] / p[i]
      if (p[i] < 0) {
        if (r > t1) return false
        if (r > t0) t0 = r
      } else {
        if (r < t0) return false
        if (r < t1) t1 = r
      }
    }
  }
  return t1 - t0 > 0.02
}

const hitsRect = (a: Point, b: Point, r: Rect) =>
  segHitsBox(a, b, r.x + 1, r.y + 1, r.x + r.w - 1, r.y + r.h - 1)

/** 直交折れ線か（斜めの区間が無い） */
function isOrthogonal(pts: readonly Point[]): boolean {
  for (let k = 1; k < pts.length; k += 1) {
    if (Math.abs(pts[k - 1].x - pts[k].x) > 0.5 && Math.abs(pts[k - 1].y - pts[k].y) > 0.5) return false
  }
  return true
}

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
  /** ラベルの背景矩形が自分の折れ線と交わった辺 */
  labelOnOwnEdge: string[]
  labelsTotal: number
  /** ひし形に刺さる端点のうち、多角形の外周から外れたもの */
  diamondEndpoints: number
  diamondOffOutline: string[]
  /** 入口側の辺から出てしまった辺（出口は必ず下辺 / 右辺） */
  exitFromEntrySide: string[]
  edgesTotal: number
  /** 入口側の辺に刺さった端点と、そのうち中央 ±15% に入ったもの */
  enterOnEntrySide: number
  enterCentered: number
  /** 無関係な箱を貫通した辺 */
  edgeThroughNode: string[]
}

async function sweep(): Promise<Sweep> {
  const out: Sweep = {
    runs: [],
    errors: [],
    nan: [],
    overlaps: [],
    backward: [],
    brokenRoutes: [],
    labelOnOwnEdge: [],
    labelsTotal: 0,
    diamondEndpoints: 0,
    diamondOffOutline: [],
    exitFromEntrySide: [],
    edgesTotal: 0,
    enterOnEntrySide: 0,
    enterCentered: 0,
    edgeThroughNode: [],
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
        const entrySide: Side = direction === 'RIGHT' ? 'left' : 'top'
        try {
          const ctx: LayoutCtx = {
            byId: flat.byId,
            links,
            collapsed: EMPTY_COLLAPSE,
            direction,
            levelOnly: true,
          }
          const ids = level.map((n) => n.id)
          const arranged = await arrange(ids, ctx)
          const { positions, edgePoints, labelAt } = emitArranged(arranged, 0, 0)
          const keys = edgeKeysOf(links)
          const mainOf = (p: Point) => (direction === 'RIGHT' ? p.x : p.y)
          // levelOnly なのでコンテナは「名前だけの箱」= 矩形。ひし形は decision だけ
          const shapeOf = (id: string): Rect['shape'] => {
            const n = flat.byId.get(id)
            return n !== undefined && !n.isContainer && n.kind === 'decision' ? 'diamond' : 'rect'
          }
          const rects = new Map<string, Rect>()
          for (const [id, at] of positions) rects.set(id, rectOf(at, shapeOf(id)))

          // --- NaN ---
          if (!Number.isFinite(arranged.width) || !Number.isFinite(arranged.height)) {
            out.nan.push(`${tag}: size`)
          }
          for (const [id, at] of positions) {
            if (![at.x, at.y, at.w, at.h].every(Number.isFinite)) out.nan.push(`${tag}: ${id}`)
          }
          for (const [key, pts] of edgePoints) {
            if (!pts.every((p) => Number.isFinite(p.x) && Number.isFinite(p.y))) {
              out.nan.push(`${tag}: edge ${key}`)
            }
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

          // --- 層が進んでいるのに主軸で後退する辺 ---
          links.forEach((l, i) => {
            const rs = arranged.ranks.get(l.from)
            const rt = arranged.ranks.get(l.to)
            const s = positions.get(l.from)
            const t = positions.get(l.to)
            if (rs === undefined || rt === undefined || s === undefined || t === undefined) return
            if (rs < rt && mainOf(t) <= mainOf(s)) out.backward.push(`${tag}: ${keys[i]}`)
          })

          // --- 配線の健全性 ---
          links.forEach((l, i) => {
            const key = keys[i]
            const pts = edgePoints.get(key)
            if (pts === undefined) {
              out.brokenRoutes.push(`${tag}: no route for ${key}`)
              return
            }
            const s = rects.get(l.from)
            const t = rects.get(l.to)
            if (pts.length < 2 || s === undefined || t === undefined) {
              out.brokenRoutes.push(`${tag}: short route ${key}`)
              return
            }
            out.edgesTotal += 1
            if (!isOrthogonal(pts)) out.brokenRoutes.push(`${tag}: diagonal segment in ${key}`)

            // 端点は図形の外周上（ひし形は 4 頂点を結ぶ多角形の上）
            const p0 = pts[0]
            const pn = pts[pts.length - 1]
            if (!onOutline(p0, s)) out.brokenRoutes.push(`${tag}: start off outline ${key}`)
            if (!onOutline(pn, t)) out.brokenRoutes.push(`${tag}: end off outline ${key}`)
            if (s.shape === 'diamond') {
              out.diamondEndpoints += 1
              if (!onDiamondOutline(p0, s)) out.diamondOffOutline.push(`${tag}: start ${key}`)
            }
            if (t.shape === 'diamond') {
              out.diamondEndpoints += 1
              if (!onDiamondOutline(pn, t)) out.diamondOffOutline.push(`${tag}: end ${key}`)
            }

            // 出口は必ず下辺 / 右辺（入口側の辺から出ない）
            const sSide = attachSide(p0, s, pts[1])
            if (sSide === entrySide) out.exitFromEntrySide.push(`${tag}: ${key}`)
            // 入口は上辺 / 左辺の中央寄り
            const tSide = attachSide(pn, t, pts[pts.length - 2])
            if (tSide === entrySide) {
              out.enterOnEntrySide += 1
              const center = entrySide === 'top' ? t.x + t.w / 2 : t.y + t.h / 2
              const span = entrySide === 'top' ? t.w : t.h
              const at = entrySide === 'top' ? pn.x : pn.y
              if (Math.abs(at - center) <= span * 0.15) out.enterCentered += 1
            }

            // 無関係な箱を貫通しない
            for (const [id, r] of rects) {
              if (id === l.from || id === l.to) continue
              for (let k = 1; k < pts.length; k += 1) {
                if (hitsRect(pts[k - 1], pts[k], r)) {
                  out.edgeThroughNode.push(`${tag}: ${key} x ${id}`)
                  break
                }
              }
            }

            // ラベルの背景矩形が自分の線に重ならない（#19 の看板）
            const lab = labelAt.get(key)
            const text = l.label
            if (lab !== undefined && text !== undefined && text !== '') {
              out.labelsTotal += 1
              const w = labelTextWidth(text)
              let hit = false
              for (let k = 1; k < pts.length && !hit; k += 1) {
                if (
                  segHitsBox(
                    pts[k - 1],
                    pts[k],
                    lab.x - w / 2,
                    lab.y - LABEL_H / 2,
                    lab.x + w / 2,
                    lab.y + LABEL_H / 2,
                  )
                ) {
                  hit = true
                }
              }
              if (hit) out.labelOnOwnEdge.push(`${tag}: ${key}`)
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

type BoundarySweep = {
  runs: number
  markers: number
  boundaryEdges: number
  broken: string[]
  /** 視野合わせの結果、可視域にノードが 1 つも入らなかった画面（#19 レビュー HIGH 1） */
  emptyViewport: string[]
  viewportChecks: number
}

/** 視野合わせを検査するキャンバス実寸（1440x900 / 1280x720 のツールバーぶんを引いた値） */
const FIT_CANVASES = [
  { name: '1440x840', w: 1440, h: 840 },
  { name: '1280x660', w: 1280, h: 660 },
]

/** vp を当てたとき、可視域（0,0,cw,ch）に矩形が重なるノードの数 */
function visibleNodeCount(
  positions: ReadonlyMap<string, Placed>,
  vp: { scale: number; tx: number; ty: number },
  cw: number,
  ch: number,
): number {
  let n = 0
  for (const at of positions.values()) {
    const x0 = (at.x - at.w / 2) * vp.scale + vp.tx
    const y0 = (at.y - at.h / 2) * vp.scale + vp.ty
    const x1 = (at.x + at.w / 2) * vp.scale + vp.tx
    const y1 = (at.y + at.h / 2) * vp.scale + vp.ty
    if (x1 > 0 && x0 < cw && y1 > 0 && y0 < ch) n += 1
  }
  return n
}

/**
 * buildDrillGraph（境界マーカー込み）を 32 ケース × 全ドリル経路 × 2 方向で回す。
 * LogicFlow のエッジ config（pointsList / startPoint / endPoint）を、ノードの確定座標（positions）に対して
 * arrange() の sweep と同じ基準で検査する。境界マーカーは flat.byId に無い擬似ノードなので、
 * 位置は positions（buildDrillGraph が返す）から引く。
 */
async function sweepBoundaries(): Promise<BoundarySweep> {
  const out: BoundarySweep = {
    runs: 0,
    markers: 0,
    boundaryEdges: 0,
    broken: [],
    emptyViewport: [],
    viewportChecks: 0,
  }
  const docIds = new Set<string>()
  for (const c of allCases) {
    const flat = flattenDoc(c.doc)
    for (const root of [null, ...flat.containerIds]) {
      const level = nodesAtLevel(flat.nodes, flat.parentOf, root)
      if (level.length === 0) continue
      for (const direction of ['RIGHT', 'DOWN'] as const) {
        const tag = `${c.id}/${root ?? 'top'}/${direction}`
        out.runs += 1
        const graph = await buildDrillGraph(level, c.doc.links, flat, root, direction, docIds)
        out.markers += graph.boundaryCount
        const shapeOf = (id: string): Rect['shape'] => {
          const n = flat.byId.get(id)
          return n !== undefined && !n.isContainer && n.kind === 'decision' ? 'diamond' : 'rect'
        }
        // --- 視野合わせ: 可視域にノードが 1 つも無い画面を作らない（#19 レビュー HIGH 1） ---
        for (const canvas of FIT_CANVASES) {
          out.viewportChecks += 1
          const vp = fitViewport(graph.width, graph.height, canvas.w, canvas.h, {
            nodes: graph.nodeBox,
            anchor: graph.headBox,
          })
          if (visibleNodeCount(graph.positions, vp, canvas.w, canvas.h) === 0) {
            out.emptyViewport.push(`${tag}@${canvas.name}`)
          }
        }
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
          if (!onOutline(pts[0], rectOf(s, shapeOf(e.sourceNodeId)))) {
            out.broken.push(`${tag}: start off outline ${e.id}`)
          }
          if (!onOutline(pts[pts.length - 1], rectOf(t, shapeOf(e.targetNodeId)))) {
            out.broken.push(`${tag}: end off outline ${e.id}`)
          }
        }
      }
    }
  }
  return out
}

/* ------------------------------------------------------------------ *
 * split 左ペイン（経路入れ子）と nested の折りたたみ
 * ------------------------------------------------------------------ */

type PaneSweep = {
  points: number
  diamondEnds: number
  diamondOffOutline: string[]
}

/** 左ペインの視野（1440x900 相当）。ラベル予約の判定と縮尺の検査に使う */
const PANE_CANVAS = { w: 480, h: 814 }

/**
 * split の左ペイン（経路入れ子）を全ドリル地点で回し、ひし形の端点が外周に乗ることを見る。
 * 左ペインは SPLIT.nodeSize の一律サイズだが、分岐はひし形で描く（nodes.ts の toSplitUpperNode）ので
 * レイアウト側も shape を diamond にしていないと端点が図形の外に浮く（#19 レビュー HIGH 2 (c)）。
 */
async function sweepNestPane(): Promise<PaneSweep> {
  const out: PaneSweep = { points: 0, diamondEnds: 0, diamondOffOutline: [] }
  for (const c of allCases) {
    const flat = flattenDoc(c.doc)
    for (const root of flat.containerIds) {
      const view = pathNestView(flat.nodes, flat.parentOf, flat.byId, c.doc.links, root)
      if (view.tree.length === 0) continue
      const graph = await buildSplitNestGraph(view, flat.byId, c.doc.links, flat.parentOf, {
        cw: PANE_CANVAS.w,
        ch: PANE_CANVAS.h,
        pad: SPLIT_FIT_PADDING,
        maxScale: FIT.maxScaleUpper,
      })
      out.points += 1
      const tag = `${c.id}/${root}`
      for (const e of graph.edges) {
        const pts = e.pointsList
        if (pts === undefined || pts.length < 2) continue
        const ends: [string, Point][] = [
          [e.sourceNodeId, pts[0]],
          [e.targetNodeId, pts[pts.length - 1]],
        ]
        for (const [id, p] of ends) {
          const n = flat.byId.get(id)
          if (n === undefined || n.isContainer || n.kind !== 'decision') continue
          const at = graph.positions.get(id)
          if (at === undefined) continue
          out.diamondEnds += 1
          if (!onDiamondOutline(p, rectOf(at, 'diamond'))) out.diamondOffOutline.push(`${tag}: ${e.id}`)
        }
      }
    }
  }
  return out
}

type CollapseSweep = { runs: number; spanning: number; unrouted: string[] }

/**
 * nested の折りたたみ表示で、畳んだグループをまたぐ線が 1 本残らず ELK の配線を持つこと。
 * 持たない辺は LogicFlow の自動経路に落ち、畳んだ箱を貫通する（#19 レビュー HIGH 3）。
 */
async function sweepCollapsed(): Promise<CollapseSweep> {
  const out: CollapseSweep = { runs: 0, spanning: 0, unrouted: [] }
  for (const c of allCases) {
    const flat = flattenDoc(c.doc)
    if (flat.containerIds.length === 0) continue
    const topIds = flat.nodes.filter((n) => n.parentId === undefined).map((n) => n.id)
    const depths = flat.containerIds.map((id) => flat.byId.get(id)?.depth ?? 0)
    const deepest = Math.max(...depths)
    const sets: [string, Set<string>][] = [
      ['all', new Set(flat.containerIds)],
      ['deepest', new Set(flat.containerIds.filter((id) => (flat.byId.get(id)?.depth ?? 0) === deepest))],
    ]
    for (const [name, collapsed] of sets) {
      for (const direction of ['RIGHT', 'DOWN'] as const) {
        const ctx: LayoutCtx = { byId: flat.byId, links: c.doc.links, collapsed, direction }
        const arranged = await arrange(topIds, ctx)
        const emitted = emitArranged(arranged, 0, 0)
        const keys = edgeKeysOf(c.doc.links)
        out.runs += 1
        const outermost = (id: string): string => {
          let result = id
          for (let cur = flat.parentOf.get(id); cur !== undefined; cur = flat.parentOf.get(cur)) {
            if (collapsed.has(cur)) result = cur
          }
          return result
        }
        c.doc.links.forEach((l, i) => {
          const s = outermost(l.from)
          const t = outermost(l.to)
          if (s === t) return
          if (s === l.from && t === l.to) return // 折りたたみに関係ない辺は既存の assert が見ている
          out.spanning += 1
          if (emitted.projected.get(`${s}->${t}`) === undefined) {
            out.unrouted.push(`${c.id}/${name}/${direction}: ${keys[i]}`)
          }
        })
      }
    }
  }
  return out
}

let result: Sweep
let boundaryResult: BoundarySweep
let paneResult: PaneSweep
let collapseResult: CollapseSweep

beforeAll(async () => {
  result = await sweep()
  boundaryResult = await sweepBoundaries()
  paneResult = await sweepNestPane()
  collapseResult = await sweepCollapsed()
}, SWEEP_TIMEOUT)

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

  it('層が進んでいるのに主軸で後退する辺 0', () => {
    expect(result.backward).toEqual([])
  })

  it('配線は直交で両端が図形の外周上', () => {
    expect(result.brokenRoutes).toEqual([])
  })

  it('線が無関係な箱を貫通しない', () => {
    expect(result.edgeThroughNode).toEqual([])
  })

  it('ラベルが自分の線に重ならない（#19）', () => {
    // ラベルを 1 本も検査していなければこの assert は何も守っていない
    expect(result.labelsTotal).toBeGreaterThan(0)
    expect(result.labelOnOwnEdge).toEqual([])
  })

  it('ひし形に刺さる端点が多角形の外周から外れない（#19）', () => {
    expect(result.diamondEndpoints).toBeGreaterThan(0)
    expect(result.diamondOffOutline).toEqual([])
  })

  it('出口は必ず下辺 / 右辺（入口側の辺から出ない）= 1.00（#19）', () => {
    expect(result.edgesTotal).toBeGreaterThan(0)
    expect(result.exitFromEntrySide).toEqual([])
  })

  it('上辺 / 左辺に入る線が中央 ±15% に収まる割合 ≥ 0.95（#19）', () => {
    expect(result.enterOnEntrySide).toBeGreaterThan(0)
    const ratio = result.enterCentered / result.enterOnEntrySide
    expect(ratio).toBeGreaterThanOrEqual(0.95)
  })

  it('buildDrillGraph（境界マーカー込み）: 全エッジが直交で両端が外周上', () => {
    expect(boundaryResult.runs).toBe(EXPECTED_RUNS)
    // 境界マーカーが 1 つも無ければこのケースは何も検査していない
    expect(boundaryResult.markers).toBeGreaterThan(0)
    expect(boundaryResult.boundaryEdges).toBe(boundaryResult.markers)
    expect(boundaryResult.broken).toEqual([])
  })

  it('視野合わせの結果、可視域にノードが 0 個にならない（#19 レビュー HIGH 1）', () => {
    expect(boundaryResult.viewportChecks).toBe(EXPECTED_RUNS * FIT_CANVASES.length)
    expect(boundaryResult.emptyViewport).toEqual([])
  })

  it('split 左ペイン: ひし形に刺さる端点が多角形の外周から外れない（#19 レビュー HIGH 2）', () => {
    expect(paneResult.points).toBeGreaterThan(0)
    expect(paneResult.diamondEnds).toBeGreaterThan(0)
    expect(paneResult.diamondOffOutline).toEqual([])
  })

  it('nested: 畳んだグループをまたぐ線が自動経路に落ちない（#19 レビュー HIGH 3）', () => {
    expect(collapseResult.runs).toBeGreaterThan(0)
    expect(collapseResult.spanning).toBeGreaterThan(0)
    expect(collapseResult.unrouted).toEqual([])
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
      `edges=${result.edgesTotal} exitOk=${(1 - result.exitFromEntrySide.length / result.edgesTotal).toFixed(3)} ` +
        `topCtr=${(result.enterCentered / Math.max(1, result.enterOnEntrySide)).toFixed(3)}` +
        `(${result.enterCentered}/${result.enterOnEntrySide})`,
      `labels=${result.labelsTotal} onOwnEdge=${result.labelOnOwnEdge.length} ` +
        `diamondEnds=${result.diamondEndpoints} offOutline=${result.diamondOffOutline.length} ` +
        `throughNode=${result.edgeThroughNode.length}`,
      `fitChecks=${boundaryResult.viewportChecks} emptyViewport=${boundaryResult.emptyViewport.length} ` +
        `panePoints=${paneResult.points} paneDiamondEnds=${paneResult.diamondEnds} ` +
        `paneOffOutline=${paneResult.diamondOffOutline.length}`,
      `collapseRuns=${collapseResult.runs} spanningEdges=${collapseResult.spanning} ` +
        `unrouted=${collapseResult.unrouted.length}`,
    ]
    console.log(`[layout.sweep]\n  ${lines.join('\n  ')}`)
    expect(runs.length).toBeGreaterThan(0)
  })
})

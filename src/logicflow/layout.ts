/**
 * LogicFlow アダプタ — 自動レイアウト（ELK layered のランク付け・並び・配線・入れ子）。
 *
 * LogicFlow は座標を一切計算しないので、全モード共通のレイアウト基盤としてここに集約する。
 * #19 で dagre + 自前の直交化（orthogonalRoute）+ 自前の箱詰め（measure）を全部やめ、
 * 「ランク付け → 交差最小化 → 座標 → 直交配線 → 入れ子」を elkjs 0.12 に一任した。
 *
 * ELK を選んだ理由（#18 / #19 の 848 通り実測）:
 *   - 入口が上辺の中央に来る割合 0.828 → 0.985、出口が必ず下辺・側面 0.951 → 1.000
 *   - 線どうしの共線重なり 762 → 0、ラベルが自分の線に重なる 1,046/1,110 → 0/1,110
 *   - 箱をまたぐ線（nested / split 左ペイン）も hierarchyHandling で直交配線される
 *     （dagre は配線を返せず LogicFlow の自動経路に落ちていた）
 * 代償は所要時間 2.36 倍（1 画面あたり 2.03ms → 4.80ms）と交差 422 → 708。
 *
 * このファイルは手順の骨だけを持ち、中身は 5 つに分けてある:
 *   layout-model.ts … 公開型と座標の小道具
 *   layout-spec.ts  … 箱の仕様とリンクの解決（ELK に渡す前）
 *   layout-elk.ts   … ELK インスタンスとオプションと入力グラフ
 *   layout-read.ts  … ELK 出力の読み取り（絶対座標化・ひし形スナップ・原点の正規化）
 *   layout-emit.ts  … LogicFlow の座標系への流し込み
 */

import type { ElkExtendedEdge, ElkLabel } from 'elkjs/lib/elk-api.js'

import type { Abs, LabelBox } from './layout-read'
import type { Arranged, Box, LayoutCtx, Point, Spec } from './layout-model'
import { PROJECTED_PREFIX } from './layout-model'
import { buildElkGraph, getElk } from './layout-elk'
import {
  EMPTY_ARRANGED,
  absolutize,
  boxFrameOf,
  collectEdges,
  normalizeOrigin,
  ranksOf,
  snapDiamondEndpoints,
  toBoxes,
} from './layout-read'
import { buildSpecs, resolveLinks } from './layout-spec'

/* --- 公開 API（呼び出し側は今までどおり './layout' から取れる） --- */
export type {
  Arranged,
  Bounds,
  Box,
  EdgeRoute,
  Emitted,
  LayoutCtx,
  Placed,
  Point,
} from './layout-model'
export { EMPTY_COLLAPSE, edgeKeysOf } from './layout-model'
export { labelTextWidth } from './layout-elk'
export { emitArranged, routeOf } from './layout-emit'

/**
 * 1 階層ぶんの箱を並べて配線する。
 * 手順は (1) 箱の仕様を決める → (2) リンクを見えている箱へ寄せる → (3) ELK に投げる
 * → (4) Box の木と配線を読む → (5) ひし形の端点を外周へ → (6) 原点を正規化。
 *
 * 入れ子は ELK の children（hierarchyHandling = INCLUDE_CHILDREN）で表現するので、
 * 箱をまたぐ線も 1 回のレイアウトで直交配線される。
 * 折りたたみ中のグループだけは場所取りを COLLAPSED_SIZE にするため中身を別 ELK で先に決める。
 */
export async function arrange(ids: readonly string[], ctx: LayoutCtx): Promise<Arranged> {
  const specs = await buildSpecs(ids, ctx, arrange)
  if (specs.length === 0) return EMPTY_ARRANGED([])

  const nest = ctx.nestExpanded !== undefined
  const horiz = (nest ? 'DOWN' : ctx.direction) === 'RIGHT'
  const links = resolveLinks(specs, ctx, nest)
  const { root } = buildElkGraph(specs, links, ctx, nest)

  const layout = await getElk()
  const res = await layout(root)

  const abs = new Map<string, Abs>()
  absolutize(res, 0, 0, abs)
  const boxes = toBoxes(specs, abs, { x: 0, y: 0 })

  // --- 配線とラベル（座標は root 原点の絶対座標に直す） ---
  const collected: { edge: ElkExtendedEdge; origin: Point }[] = []
  collectEdges(res, { x: 0, y: 0 }, abs, collected)
  const linkOf = new Map(links.map((l) => [l.key, l] as const))
  const edgePoints = new Map<string, Point[]>()
  const labelAt = new Map<string, Point>()
  const labelBoxes: LabelBox[] = []
  const ends = new Map<string, { source: string; target: string }>()
  for (const { edge, origin } of collected) {
    const link = linkOf.get(edge.id)
    if (link === undefined) continue
    const section = (edge.sections ?? [])[0]
    if (section === undefined) continue
    const shift = (p: Point): Point => ({ x: p.x + origin.x, y: p.y + origin.y })
    const raw = [section.startPoint, ...(section.bendPoints ?? []), section.endPoint].map(shift)
    // 反転して渡した辺（入れ子の loopback）は折れ線を戻して元の向きにする
    const points = link.reversed ? raw.reverse() : raw
    // 射影した辺（折りたたみ中のグループをまたぐ線）も同じ Map に入れ、
    // 正規化とひし形スナップを通してから最後に分ける（key の接頭辞で区別できる）
    edgePoints.set(link.key, points)
    if (!link.direct) {
      ends.set(link.key, { source: link.from, target: link.to })
      continue
    }
    ends.set(link.key, {
      source: link.reversed ? link.to : link.from,
      target: link.reversed ? link.from : link.to,
    })
    const label: ElkLabel | undefined = edge.labels?.[0]
    if (label !== undefined) {
      const at = {
        x: origin.x + (label.x ?? 0) + (label.width ?? 0) / 2,
        y: origin.y + (label.y ?? 0) + (label.height ?? 0) / 2,
      }
      labelAt.set(link.key, at)
      labelBoxes.push({ at, width: label.width ?? 0, height: label.height ?? 0 })
    }
  }

  // --- ひし形は bbox の枠線ではなく 4 頂点の外周に着地させる ---
  const shapeOf = new Map<string, Box['shape']>()
  const scan = (list: readonly Spec[]) => {
    for (const s of list) {
      if (s.kind === 'leaf') shapeOf.set(s.id, s.shape)
      else if (s.kind === 'group') scan(s.children)
    }
  }
  scan(specs)
  snapDiamondEndpoints(
    edgePoints,
    (id) => {
      const at = abs.get(id)
      const shape = shapeOf.get(id)
      return at === undefined || shape === undefined ? undefined : { at, shape }
    },
    ends,
  )

  const normalized = normalizeOrigin(boxes, edgePoints, labelAt, labelBoxes)
  const frame = boxFrameOf(boxes, horiz, { x: 0, y: 0, w: normalized.width, h: normalized.height })
  const direct = new Map<string, Point[]>()
  const projected = new Map<string, Point[]>()
  for (const [key, pts] of normalized.edgePoints) {
    if (key.startsWith(PROJECTED_PREFIX)) projected.set(key.slice(PROJECTED_PREFIX.length), pts)
    else direct.set(key, pts)
  }
  return {
    boxes,
    ranks: ranksOf(boxes, horiz),
    ...frame,
    ...normalized,
    edgePoints: direct,
    projected,
  }
}


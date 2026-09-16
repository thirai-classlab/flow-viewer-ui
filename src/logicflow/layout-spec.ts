/**
 * LogicFlow アダプタ — 箱の仕様とリンクの解決（ELK に渡す前の下ごしらえ）。
 *
 * 旧 measure() に相当する部分。ここではサイズと入れ子の形だけを決め、座標は一切持たない。
 * 折りたたみ中のグループだけは「展開時の中身」を先に確定させる必要があるので、
 * arrange() を引数で受け取る（import すると layout.ts と循環参照になるため）。
 */

import type { FlatNode } from '../flow/flatten'
import { descendantsOf } from '../flow/flatten'
import { COLLAPSED_SIZE, GROUP_HEADER, NODE_SIZE, SPLIT } from '../flow/theme'
import type { Arranged, Box, ElkLink, LayoutCtx, Pad, Spec } from './layout-model'
import { PROJECTED_PREFIX, edgeKeysOf, shiftRoutes } from './layout-model'

/** 折りたたみ中のグループの中身を先に確定させるための注入口（= layout.ts の arrange） */
export type ArrangeFn = (ids: readonly string[], ctx: LayoutCtx) => Promise<Arranged>

/** グループ枠の内側パディング（上辺だけタイトル帯ぶん厚くする = GROUP_HEADER） */
const GROUP_PAD = 20

/**
 * ドリルダウン時にグループを描く「名前だけの箱」のサイズ。
 * 中身を一切描かないので、折りたたみ表示と同じコンパクトサイズを流用する。
 */
const DRILL_GROUP_SIZE = COLLAPSED_SIZE

/** 階層の外へ出入りするリンクを示す境界マーカー（擬似ノード）のサイズ */
const BOUNDARY_SIZE = { width: 156, height: 44 }

/** 経路入れ子（split 左ペイン）のパディング。左ペインは幅が命なので本編より薄い */
const NEST_PAD: Pad = {
  top: SPLIT.nestHeader,
  left: SPLIT.nestPadding,
  right: SPLIT.nestPadding,
  bottom: SPLIT.nestPadding,
}
const GROUP_PAD_BOX: Pad = {
  top: GROUP_HEADER,
  left: GROUP_PAD,
  right: GROUP_PAD,
  bottom: GROUP_PAD,
}

/**
 * 線の刺さり方。split の左ペインも分岐はひし形で描く（nodes.ts の toSplitUpperNode、#17）ので、
 * サイズが一律でも shape だけは kind から決める。rect のままにすると
 * snapDiamondEndpoints() が働かず、端点が図形の外に浮く（#19 レビュー HIGH 2 (c)）。
 */
const shapeOf = (node: FlatNode | undefined): Box['shape'] =>
  node !== undefined && !node.isContainer && node.kind === 'decision' ? 'diamond' : 'rect'

async function buildSpec(id: string, ctx: LayoutCtx, arrange: ArrangeFn): Promise<Spec> {
  // 経路入れ子（split の左ペイン）は専用の規則。fixedSize より先に判定する
  const expanded = ctx.nestExpanded
  if (expanded !== undefined) {
    const node = ctx.byId.get(id)
    if (!node || !node.isContainer || !expanded.has(id) || node.childIds.length === 0) {
      const size = SPLIT.nodeSize
      return { kind: 'leaf', id, w: size.width, h: size.height, shape: shapeOf(node) }
    }
    return { kind: 'group', id, children: await buildSpecs(node.childIds, ctx, arrange), pad: NEST_PAD }
  }
  // split の左ペイン（1 つ上の階層）は一律サイズ。コンテナ判定は見ないが、形だけは kind に従う
  if (ctx.fixedSize !== undefined) {
    const size = ctx.fixedSize
    return { kind: 'leaf', id, w: size.width, h: size.height, shape: shapeOf(ctx.byId.get(id)) }
  }
  // コンテキスト層は「薄く名前だけ」なので kind によらず一律サイズの矩形にする
  const override = ctx.sizeOf?.(id)
  if (override !== undefined) {
    return { kind: 'leaf', id, w: override.width, h: override.height, shape: 'rect' }
  }
  const node = ctx.byId.get(id)
  // byId に無い id = ドリルダウンの境界マーカー（階層外への出入りを示す擬似ノード）
  if (!node) {
    return { kind: 'leaf', id, w: BOUNDARY_SIZE.width, h: BOUNDARY_SIZE.height, shape: 'rect' }
  }
  // 1 画面 1 階層モードではグループの中身を描かないので、再帰せず名前だけの箱にする
  if (ctx.levelOnly === true && node.isContainer) {
    return { kind: 'leaf', id, w: DRILL_GROUP_SIZE.width, h: DRILL_GROUP_SIZE.height, shape: 'rect' }
  }
  if (!node.isContainer || node.childIds.length === 0) {
    const size = NODE_SIZE[node.kind]
    return { kind: 'leaf', id, w: size.width, h: size.height, shape: shapeOf(node) }
  }
  if (!ctx.collapsed.has(id)) {
    return { kind: 'group', id, children: await buildSpecs(node.childIds, ctx, arrange), pad: GROUP_PAD_BOX }
  }
  // 折りたたみ中: 展開時のレイアウトだけ別に確定させ、場所取りは COLLAPSED_SIZE にする。
  // LogicFlow の collapse() は「左上を固定して縮む」実装なので、展開時の箱の左上を
  // この枠の左上に合わせておけば、畳んだ結果がぴったり枠に収まる。
  const inner = await arrange(node.childIds, ctx)
  for (const b of inner.boxes) {
    b.offX += GROUP_PAD
    b.offY += GROUP_HEADER
  }
  const fullW = inner.width + GROUP_PAD * 2
  const fullH = inner.height + GROUP_HEADER + GROUP_PAD
  return {
    kind: 'collapsed',
    id,
    box: {
      id,
      slotW: COLLAPSED_SIZE.width,
      slotH: COLLAPSED_SIZE.height,
      fullW,
      fullH,
      offX: 0,
      offY: 0,
      shape: 'rect',
      children: inner.boxes,
      ...shiftRoutes(inner.edgePoints, inner.labelAt, GROUP_PAD, GROUP_HEADER),
    },
  }
}

export function buildSpecs(
  ids: readonly string[],
  ctx: LayoutCtx,
  arrange: ArrangeFn,
): Promise<Spec[]> {
  return Promise.all(ids.map((id) => buildSpec(id, ctx, arrange)))
}

/**
 * 各リンクを「この階層で見えている箱」へ寄せる。
 * 折りたたみ中のグループの中身へ刺さるリンクはその箱へ射影し、同じ組は 1 本に畳む。
 * 射影した辺も ELK に渡して配線を受け取り（Arranged.projected）、
 * LogicFlow の仮想エッジ / 補修エッジに当てる。
 */
export function resolveLinks(specs: readonly Spec[], ctx: LayoutCtx, nest: boolean): ElkLink[] {
  // 深さ優先で降りながら上書きするので、最後に残るのは「一番深い祖先」= 見えている箱
  const owner = new Map<string, string>()
  const walk = (list: readonly Spec[]) => {
    for (const s of list) {
      // descendantsOf は自分自身を先頭に含む（byId に無い擬似ノードでも [id] を返す）
      for (const d of descendantsOf(s.id, ctx.byId)) owner.set(d, s.id)
      if (s.kind === 'group') walk(s.children)
    }
  }
  walk(specs)

  const keys = edgeKeysOf(ctx.links)
  const out: ElkLink[] = []
  const projected = new Set<string>()
  ctx.links.forEach((l, i) => {
    const s = owner.get(l.from)
    const t = owner.get(l.to)
    if (s === undefined || t === undefined || s === t) return
    if (s !== l.from || t !== l.to) {
      const pair = `${s}->${t}`
      if (projected.has(pair)) return
      projected.add(pair)
      out.push({
        key: `${PROJECTED_PREFIX}${pair}`,
        from: s,
        to: t,
        direct: false,
        reversed: false,
        label: undefined,
      })
      return
    }
    // 入れ子（split 左ペイン）だけ loopback を反転して渡す。順路が DAG になり層が JSON 順を保つ
    // （実測: 兄弟ペアの前後関係 19/20。平坦に当てると出口の規律が崩れるので当てない）
    const reversed = nest && l.kind === 'loopback'
    const label = l.label !== undefined && l.label !== '' ? l.label : undefined
    out.push({
      key: keys[i],
      from: reversed ? l.to : l.from,
      to: reversed ? l.from : l.to,
      direct: true,
      reversed,
      // 入れ子は既定でラベルの場所を空けない（空けると縦に伸びて縮尺が落ちる）
      label: nest && ctx.nestLabels !== true ? undefined : label,
    })
  })
  return out
}


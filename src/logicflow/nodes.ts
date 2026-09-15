/**
 * LogicFlow アダプタ — ノード / エッジの LogicFlow データへの変換とカスタムノード。
 *
 * 5 つの表示状態（nested / drilldown ×2 / split ×2）が共有する「箱の作り方」を集めた場所。
 */

import LogicFlow, { DiamondNode, DiamondNodeModel, RectNode, RectNodeModel, h } from '@logicflow/core'

import type { FlatNode } from '../flow/flatten'
import type { AggregatedEdge, EdgeScope, NestNode, ViewEdge } from '../flow/collapse'
import type { FlowLink, LinkKind } from '../flow/schema'
import {
  BADGE_COLOR,
  BADGE_SIZE,
  CONTEXT_COLOR,
  COLLAPSED_SIZE,
  CROSSING_COLOR,
  DOC_COLOR,
  KIND_COLOR,
  LINK_COLOR,
  LINK_DASH,
  NODE_FONT,
  SPLIT,
} from '../flow/theme'
import type { Placed } from './layout'

/* ------------------------------------------------------------------ *
 * 2. LogicFlow データへの変換
 * ------------------------------------------------------------------ */

/* --- カスタムノード型 ---------------------------------------------------
 *
 * 標準の 'rect' / 'diamond' をそのまま使うと
 *   (a) 最外 <g> に class を出せない（＝ホバー / 選択を CSS で書けない）
 *   (b) 箱の中に「▸ 中を見る N」バッジや 📄 マークを足せない
 * の 2 つができない。どちらも LogicFlow が用意している拡張点
 *   model 側: BaseNodeModel.getOuterGAttributes()  … 最外 <g> の属性
 *   view 側 : BaseNode.getShape()                  … 図形そのもの
 * で解決できるので、rect / diamond をこの 2 点だけ拡張した型に差し替える。
 *
 * lf.register() はインスタンス単位なので、split の 2 インスタンスに
 * 同じ型名を登録しても競合しない（LogicFlow.use() を使わないのが前提。NOTES.md 参照）。 */
export const NODE_TYPE = {
  /** 通常ノード + ドリルダウンのグループ箱 + 境界マーカー + split 左ペイン */
  rect: 'lfa-rect',
  /** 分岐（菱形） */
  diamond: 'lfa-diamond',
} as const

/** 全カスタムノードに付く class。ホバーの transition をまとめて当てる */
export const NODE_CLASS = 'lfa-node'
/** 潜れるノードに付く class。cursor: pointer とホバーの光り方はここで決まる */
export const DRILL_CLASS = 'lfa-drill'
/** 選択中ノードに付く class。描画後に DOM 側から付け外しする（再描画を避けるため） */
export const SELECT_CLASS = 'lfa-sel'
/** doc（手順書）マークのグループに付く class */
export const DOC_CLASS = 'lfa-doc'
/** 「▸ 中を見る」バッジに付く class。単一クリックの当たり判定にも使う */
export const BADGE_CLASS = 'lfa-badge'

const LF_TYPE: Record<FlatNode['kind'], string> = {
  start: NODE_TYPE.rect,
  end: NODE_TYPE.rect,
  task: NODE_TYPE.rect,
  decision: NODE_TYPE.diamond,
  group: 'dynamic-group',
}

export type LFNodeConfig = Parameters<LogicFlow['addNode']>[0]
export type LFEdgeConfig = Parameters<LogicFlow['addEdge']>[0]

/** カスタムノードが読む properties（型が緩い LogicFlow 側との境界をここで締める） */
type DecorProps = {
  /** 潜れる箱か（＝クリックできるか） */
  isDrillTarget?: boolean
  /** コンテキスト層（1 つ上の階層）のノードか */
  isContextLayer?: boolean
  /** 手順書を持つか。true なら 📄 マークを出す */
  hasDoc?: boolean
  /** グループの中身の件数。数値のときだけ「▸ 中を見る N」バッジを描く */
  drillCount?: number
  width?: number
  height?: number
}

/**
 * 最外 <g> に付ける属性。
 * data-nid は「再描画せずに選択枠だけ付け替える」ために使う目印
 * （selectedId を effect の依存に入れると LogicFlow ごと作り直しになるため）。
 */
function outerAttrs(model: { id: string; properties: unknown }): LogicFlow.DomAttributes {
  const p = (model.properties ?? {}) as DecorProps
  const classes = [NODE_CLASS]
  if (p.isDrillTarget === true) classes.push(DRILL_CLASS)
  if (p.isContextLayer === true) classes.push(CONTEXT_CLASS)
  return { className: classes.join(' '), 'data-nid': model.id }
}

/** 📄 マーク。箱の右上に小さく出す */
function docMark(cx: number, cy: number) {
  return h(
    'g',
    { className: DOC_CLASS },
    h('circle', {
      cx,
      cy,
      r: 11,
      fill: DOC_COLOR.fill,
      stroke: DOC_COLOR.stroke,
      'stroke-width': 1.2,
    }),
    h(
      'text',
      {
        x: cx,
        y: cy + 4,
        'text-anchor': 'middle',
        'font-size': 11,
        fill: DOC_COLOR.stroke,
      },
      '📄',
    ),
  )
}

/**
 * 「▸ 中を見る N」バッジ。箱の下辺に敷く。
 * 文字だけの「▼ 中を見る（7 件）」は縮尺が落ちると真っ先に潰れるので、
 * 図形として描いて件数を右のバッジに分離した。
 */
function drillBadge(left: number, bottom: number, count: number) {
  const label = '中を見る'
  const countText = String(count)
  const width = Math.max(BADGE_SIZE.minWidth, 62 + label.length * 12 + countText.length * 9)
  const x = left + BADGE_SIZE.padX
  const y = bottom - BADGE_SIZE.height - BADGE_SIZE.padY
  const midY = y + BADGE_SIZE.height / 2
  const pillW = 22 + countText.length * 8
  return h(
    'g',
    { className: BADGE_CLASS },
    h('rect', {
      className: 'lfa-badge-bg',
      x,
      y,
      width,
      height: BADGE_SIZE.height,
      rx: BADGE_SIZE.height / 2,
      ry: BADGE_SIZE.height / 2,
      fill: BADGE_COLOR.fill,
      stroke: BADGE_COLOR.stroke,
      'stroke-width': 1.2,
    }),
    h(
      'text',
      {
        className: 'lfa-badge-label',
        x: x + 14,
        y: midY + 4,
        'font-size': NODE_FONT.sub,
        fill: BADGE_COLOR.text,
      },
      `▸ ${label}`,
    ),
    h('rect', {
      x: x + width - pillW - 8,
      y: y + 4,
      width: pillW,
      height: BADGE_SIZE.height - 8,
      rx: (BADGE_SIZE.height - 8) / 2,
      ry: (BADGE_SIZE.height - 8) / 2,
      fill: BADGE_COLOR.stroke,
    }),
    h(
      'text',
      {
        x: x + width - pillW / 2 - 8,
        y: midY + 4,
        'text-anchor': 'middle',
        'font-size': NODE_FONT.small,
        'font-weight': 600,
        fill: '#0e1424',
      },
      countText,
    ),
  )
}

/** 図形の上に重ねる装飾（バッジ / 📄）を列挙する。無ければ空配列 */
function decorationsOf(model: {
  x: number
  y: number
  width: number
  height: number
  properties: unknown
}): unknown[] {
  const p = (model.properties ?? {}) as DecorProps
  const w = p.width ?? model.width
  const h0 = p.height ?? model.height
  const out: unknown[] = []
  if (typeof p.drillCount === 'number') {
    out.push(drillBadge(model.x - w / 2, model.y + h0 / 2, p.drillCount))
  }
  if (p.hasDoc === true) out.push(docMark(model.x + w / 2 - 16, model.y - h0 / 2 + 16))
  return out
}

/**
 * 元の図形と装飾を 1 つの <g> にまとめる。
 *
 * getShape() の戻り型は RectNode と DiamondNode で微妙に違う（null 許容かどうか）ので、
 * 「入力と同じ型を返す」形にして各サブクラスの override 条件を満たす。
 */
function wrapShape<T>(base: T, extra: readonly unknown[]): T {
  if (extra.length === 0) return base
  return h('g', {}, base as never, ...(extra as never[])) as unknown as T
}

export class AppRectNodeModel extends RectNodeModel {
  getOuterGAttributes() {
    return outerAttrs(this)
  }
}

export class AppRectNode extends RectNode {
  getShape() {
    return wrapShape(super.getShape(), decorationsOf(this.props.model))
  }
}

export class AppDiamondNodeModel extends DiamondNodeModel {
  getOuterGAttributes() {
    return outerAttrs(this)
  }
}

export class AppDiamondNode extends DiamondNode {
  getShape() {
    return wrapShape(super.getShape(), decorationsOf(this.props.model))
  }
}

/** LogicFlow インスタンス 1 つにカスタムノード型を登録する（split では 2 回呼ぶ） */
export function registerAppNodes(lf: LogicFlow) {
  lf.register({
    type: NODE_TYPE.rect,
    view: AppRectNode as unknown as LogicFlow.RegisterConfig['view'],
    model: AppRectNodeModel as unknown as LogicFlow.RegisterConfig['model'],
  })
  lf.register({
    type: NODE_TYPE.diamond,
    view: AppDiamondNode as unknown as LogicFlow.RegisterConfig['view'],
    model: AppDiamondNodeModel as unknown as LogicFlow.RegisterConfig['model'],
  })
}

/**
 * 選択枠を DOM 側で付け替える。
 *
 * selectedId を描画 effect の依存に入れると、ノードを選ぶたびに
 * LogicFlow インスタンスごと作り直し（destroy → render → 出現アニメ再生）になる。
 * 選択は「見た目だけ」の変化なので、data-nid を頼りに class を差し替えるだけにする。
 */
export function applySelection(root: HTMLElement | null, selectedId: string | null) {
  if (root === null) return
  for (const el of Array.from(root.querySelectorAll(`.${SELECT_CLASS}`))) {
    el.classList.remove(SELECT_CLASS)
  }
  if (selectedId === null) return
  const escape =
    typeof CSS !== 'undefined' && typeof CSS.escape === 'function'
      ? CSS.escape
      : (v: string) => v.replace(/["\\]/g, '\\$&')
  for (const el of Array.from(root.querySelectorAll(`[data-nid="${escape(selectedId)}"]`))) {
    el.classList.add(SELECT_CLASS)
  }
}

export function toLfNode(n: FlatNode, at: Placed, hasDoc = false): LFNodeConfig {
  const color = KIND_COLOR[n.kind]
  const textStyle = {
    color: color.text,
    fontSize: NODE_FONT.label,
    overflowMode: 'autoWrap',
    textWidth: 150,
  }
  if (n.isContainer) {
    return {
      id: n.id,
      type: 'dynamic-group',
      x: at.x,
      y: at.y,
      text: n.label,
      // onGraphRendered は node.children を、initNodeData は properties.children を見るので両方渡す
      children: n.childIds,
      properties: {
        children: n.childIds,
        width: at.w,
        height: at.h,
        collapsedWidth: COLLAPSED_SIZE.width,
        collapsedHeight: COLLAPSED_SIZE.height,
        collapsible: true,
        isRestrict: false,
        transformWithContainer: false,
        style: { fill: color.fill, stroke: color.stroke, strokeWidth: 1.5, radius: 8 },
        textStyle: { ...textStyle, textWidth: at.w - 48 },
      },
    }
  }
  const isDecision = n.kind === 'decision'
  return {
    id: n.id,
    type: LF_TYPE[n.kind],
    x: at.x,
    y: at.y,
    text: n.label,
    properties: {
      width: at.w,
      height: at.h,
      hasDoc,
      ...(isDecision ? { rx: at.w / 2, ry: at.h / 2 } : {}),
      style: {
        fill: color.fill,
        stroke: color.stroke,
        strokeWidth: 1.5,
        radius: n.kind === 'start' || n.kind === 'end' ? 20 : 6,
      },
      // 📄 マークが右上に載るので、その分だけ文字の幅を詰めておく
      textStyle: { ...textStyle, textWidth: at.w - (hasDoc ? 40 : 16) },
    },
  }
}

export function edgeStyleOf(kind: LinkKind) {
  return {
    stroke: LINK_COLOR[kind],
    strokeWidth: kind === 'normal' ? 1.4 : 1.8,
    strokeDasharray: LINK_DASH[kind] ?? 'none',
  }
}

export function toLfEdge(link: FlowLink, index: number): LFEdgeConfig {
  const kind: LinkKind = link.kind ?? 'normal'
  return {
    id: `lk-${index}`,
    type: 'polyline',
    sourceNodeId: link.from,
    targetNodeId: link.to,
    text: link.label ?? '',
    properties: { linkKind: kind, style: edgeStyleOf(kind) },
  }
}

/**
 * グループを「中身の見えない名前だけの箱」として描く。
 *
 * 旧実装は 2 行目に「▼ 中を見る（7 件）」という文字を入れていたが、
 * 縮尺が落ちると真っ先に潰れて読めなくなった（実測 110x35px）。
 * いまは名前を上寄せに置き、下辺にバッジ（drillBadge）を図形として敷く。
 * バッジは縮尺と無関係に「押せる帯」として残るので潰れ方が緩やかになる。
 */
export function toDrillGroupNode(
  n: FlatNode,
  at: Placed,
  count: number,
  hasDoc = false,
): LFNodeConfig {
  const color = KIND_COLOR.group
  return {
    id: n.id,
    type: NODE_TYPE.rect,
    x: at.x,
    y: at.y,
    // バッジの高さぶん、名前を上へ寄せる（LogicFlow の text は座標を直接指定できる）
    text: { value: n.label, x: at.x, y: at.y - (BADGE_SIZE.height + BADGE_SIZE.padY) / 2 },
    properties: {
      width: at.w,
      height: at.h,
      isDrillTarget: true,
      drillCount: count,
      hasDoc,
      style: {
        fill: color.fill,
        // 通常ノード（実線 1.5px）と明確に描き分ける: 太い破線 + アクセント色
        stroke: '#6b8afd',
        strokeWidth: 2.5,
        strokeDasharray: '7 4',
        radius: 10,
      },
      textStyle: {
        color: color.text,
        fontSize: NODE_FONT.label,
        overflowMode: 'autoWrap',
        textWidth: at.w - (hasDoc ? 48 : 24),
      },
    },
  }
}

/**
 * コンテキスト層のノードに付く class。CSS 側で opacity / フェードを当てる。
 *
 * かつては専用のノード型（ctx-layer-rect）+ 専用モデルで付けていたが、
 * ホバー / 選択 / 📄 を全ノードで共通に扱うためカスタム rect に統合した。
 * class は properties.isContextLayer を見て outerAttrs() が付ける。
 */
export const CONTEXT_CLASS = 'lfa-ctx'

/** コンテキスト層の「名前だけの箱」 */
export function toContextNode(n: FlatNode, at: Placed, hasDoc = false): LFNodeConfig {
  return {
    id: n.id,
    type: NODE_TYPE.rect,
    x: at.x,
    y: at.y,
    text: n.label,
    properties: {
      width: at.w,
      height: at.h,
      isContextLayer: true,
      // コンテナはダブルクリックでその中へ潜れるので、ホバーの手応えも出す
      isDrillTarget: n.isContainer,
      hasDoc,
      style: {
        fill: CONTEXT_COLOR.fill,
        stroke: CONTEXT_COLOR.stroke,
        strokeWidth: 1.2,
        // グループ（潜れる）だけ破線にして、葉ノードと描き分ける
        strokeDasharray: n.isContainer ? '5 4' : 'none',
        radius: 8,
      },
      textStyle: {
        color: CONTEXT_COLOR.text,
        fontSize: NODE_FONT.sub,
        overflowMode: 'autoWrap',
        textWidth: at.w - 16,
      },
    },
  }
}

/** crossing エッジは CROSSING_COLOR。線種は元の kind を残して例外/差し戻しの区別を保つ */
export function viewEdgeStyle(kind: LinkKind, scope: EdgeScope) {
  if (scope === 'focus') return edgeStyleOf(kind)
  return {
    stroke: CROSSING_COLOR,
    strokeWidth: 1.6,
    strokeDasharray: LINK_DASH[kind] ?? '2 3',
  }
}

export function toViewEdge(e: ViewEdge, index: number): LFEdgeConfig {
  return {
    id: `vw-${index}`,
    type: 'polyline',
    sourceNodeId: e.source,
    targetNodeId: e.target,
    text: e.label ?? '',
    properties: { linkKind: e.kind, edgeScope: e.scope, style: viewEdgeStyle(e.kind, e.scope) },
  }
}

/** ペインごとのエッジ id 接頭辞。SVG マーカー id の衝突を避けるためのもの */
export const SPLIT_EDGE_PREFIX = { upper: 'sp-u', lower: 'sp-l' } as const

/** 左ペインのノードの状態。★ = 今いる場所 / ⚡ = 右ペインと繋がっている */
export type UpperState = 'current' | 'linked' | 'plain'

export function splitEdge(e: AggregatedEdge, id: string): LFEdgeConfig {
  return {
    id,
    type: 'polyline',
    sourceNodeId: e.source,
    targetNodeId: e.target,
    text: e.label ?? '',
    properties: { linkKind: e.kind, style: edgeStyleOf(e.kind) },
  }
}

export function toSplitUpperNode(
  n: FlatNode,
  at: Placed,
  state: UpperState,
  note?: string,
  hasDoc = false,
): LFNodeConfig {
  const base = KIND_COLOR[n.kind]
  const isCurrent = state === 'current'
  const isLinked = state === 'linked'
  const stroke = isCurrent
    ? SPLIT.currentStroke
    : isLinked
      ? SPLIT.linkedStroke
      : CONTEXT_COLOR.stroke
  // 記号は凡例（★ = 今いる場所 / ⚡ = 右と繋がっている）と対応させる
  const head = isCurrent ? `★ ${n.label}` : isLinked ? `⚡ ${n.label}` : n.label
  return {
    id: n.id,
    type: NODE_TYPE.rect,
    x: at.x,
    y: at.y,
    text: note === undefined ? head : `${head}\n${note}`,
    properties: {
      width: at.w,
      height: at.h,
      splitState: state,
      isDrillTarget: n.isContainer,
      hasDoc,
      style: {
        // 今いる場所だけ実色。他は沈ませて主役を 1 つに絞る
        fill: isCurrent ? base.fill : CONTEXT_COLOR.fill,
        stroke,
        strokeWidth: isCurrent ? 3 : isLinked ? 2 : 1.2,
        // 潜れる（コンテナ）かどうかを破線で描き分ける
        strokeDasharray: n.isContainer ? '5 4' : 'none',
        radius: 8,
      },
      textStyle: {
        color: isCurrent ? base.text : isLinked ? '#efe0b0' : CONTEXT_COLOR.text,
        fontSize: 11,
        overflowMode: 'autoWrap',
        textWidth: at.w - 14,
      },
    },
  }
}

/**
 * 入れ子の段数ごとの背景色。深いほど明るくして「箱の中の箱」を見せる。
 * 枠線だけだと 3 段目の所属が読み取れなかった（実測）。
 */
const NEST_FILL = ['#151924', '#1b2130', '#212940', '#27304b']

/**
 * 経路上のグループ = dynamic-group の「常時展開」ノード。
 *
 * text の overflowMode に注意。autoWrap にすると DynamicGroupText が
 * foreignObject を枠いっぱい（height - 10px）に広げるので、
 * 中の子ノードが HTML 要素に覆われてクリックできなくなる。
 * ellipsis なら foreignObject の高さが pad + fontSize + 2 で収まり、見出し帯だけを占める。
 */
export function toNestGroupNode(n: NestNode, at: Placed): LFNodeConfig {
  const linked = n.isLinked
  return {
    id: n.node.id,
    type: 'dynamic-group',
    x: at.x,
    y: at.y,
    text: linked ? `⚡ ${n.node.label}` : n.node.label,
    // onGraphRendered は node.children を、initNodeData は properties.children を見る
    children: n.node.childIds,
    properties: {
      children: n.node.childIds,
      width: at.w,
      height: at.h,
      // 畳ませない。± を出さないので「入れ子折りたたみでエッジ全滅」バグの経路に入らない
      collapsible: false,
      isCollapsed: false,
      isRestrict: false,
      autoResize: false,
      transformWithContainer: false,
      isDrillTarget: true,
      nestLevel: n.level,
      style: {
        fill: NEST_FILL[Math.min(n.level, NEST_FILL.length - 1)],
        stroke: linked ? SPLIT.linkedStroke : KIND_COLOR.group.stroke,
        strokeWidth: linked ? 2 : 1.2,
        strokeDasharray: '5 4',
        radius: 8,
      },
      textStyle: {
        // DynamicGroupText は HTML 描画時に style.fill を色として使い、
        // SVG 描画時は color を使う。どちらに転んでも同じ色になるよう両方入れる
        color: linked ? '#efe0b0' : KIND_COLOR.group.text,
        fill: linked ? '#efe0b0' : KIND_COLOR.group.text,
        fontSize: 11,
        overflowMode: 'ellipsis',
        textWidth: at.w - 16,
        wrapPadding: '0,8,0,8',
        textAlign: 'left',
      },
    },
  }
}

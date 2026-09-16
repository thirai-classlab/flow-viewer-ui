/**
 * LogicFlow アダプタ — ELK インスタンスと入力グラフの組み立て。
 *
 * ※ ELK は不正なオプション名・値を例外なく黙って無視する（実測）。
 *   オプションを足したら必ず出力の数値で効いているか確かめること。
 *   実際に無視された / 壊れたものは elkLayoutOptions() の注記に残してある。
 */

import type { ElkExtendedEdge, ElkNode, ElkPort } from 'elkjs/lib/elk-api.js'

import type { Direction } from '../flow/schema'
import { LAYOUT_GAP, NODE_FONT } from '../flow/theme'
import type { ElkLink, LayoutCtx, Spec } from './layout-model'

/**
 * 線上ラベルの寸法。
 * LogicFlow は edgeText.textWidth で自動折り返しし、背景の矩形も文字数にかかわらず
 * textWidth 幅で描く（LineText.getBackground）。テーマの既定 90px のままだと短いラベルでも
 * 90px の背景が線を隠すので、nodes.ts がエッジごとに labelTextWidth() を textWidth として渡し、
 * ここでは同じ幅 + 両側の余白を ELK に確保させる。
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

/** ポートを散らす帯の広さ（辺の中央 ±(span × SPREAD_RATIO)）と、隣り合うポートの最大間隔 */
const SPREAD_RATIO = 0.15
const SPREAD_STEP_MAX = 16

/**
 * ひし形の端点を外周へ寄せるとき、主軸方向へ食い込んでよい上限 (px)。
 * ELK が空ける elk.spacing.edgeNode = 16 より小さくしないと、最終セグメントより長く
 * 食い込んで折れ線が逆走する（848 通り実測: 上限なしだと最大食い込み 31.1px に対し
 * 最終セグメントは最短 17px。上限つきなら最大 13.1px / 最小余裕 3.9px で逆走 0 件）。
 *
 * 入れ子（split 左ペイン）は層の間隔が rankNode = 4px しかないので、最終セグメントも 4px 前後になる。
 * 12px のままだと snapDiamondEndpoints() の「最終セグメントより食い込まない」保険が働いて
 * 端点が外周の手前で止まり、図形の外に浮く（#19 レビュー HIGH 2 (c) の実測 23 本 / 最大 3.9px）。
 */
const DIAMOND_MAX_INSET = { flat: 12, nest: 3 } as const

/**
 * 辺まわりの余白。入れ子（split 左ペイン）は細い柱に積むので詰める（#19 (c) の実測）。
 *
 * 層と直交する向き（edgeNode / edgeEdge）と層をまたぐ向き（*BetweenLayers）を分けてある。
 * 入れ子では前者だけ 4 → 8 に広げた: 4px では線がノードの縁を最長 287px 這って
 * 枠と見分けが付かなかった（#19 レビュー HIGH 2 (b)）。層をまたぐ向きは
 * 縦積みの背丈＝左ペインの縮尺を直接支配するので 4 のまま据え置く
 * （実測: 両方 8 にすると全 1,736 地点のうち 0.85 未満が 23 地点増える）。
 */
const EDGE_SPACING = {
  flat: { edgeNode: 16, edgeEdge: 12, rankNode: 16, rankEdge: 12 },
  nest: { edgeNode: 8, edgeEdge: 3, rankNode: 4, rankEdge: 3 },
} as const

/** 入口 / 出口をどの辺に付けるか。「上から入って下から出る」を FIXED_POS で強制する */
const IN_SIDE = { DOWN: 'NORTH', RIGHT: 'WEST' } as const
const OUT_SIDE = { DOWN: 'SOUTH', RIGHT: 'EAST' } as const

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
 * nodes.ts がエッジの textStyle に渡す値と、ELK の予約幅の両方をここから取る。
 */
export function labelTextWidth(label: string): number {
  return Math.min(LABEL_MAX_WIDTH, rawTextWidth(label) + LABEL_TEXT_PAD)
}

/* ------------------------------------------------------------------ *
 * ELK インスタンス（Worker + 遅延ロード。モジュールスコープの lazy singleton）
 *
 * elk.bundled.js は 1.46MB（gzip 440KB）あるので、初回のレイアウトまで読み込まない。
 * ブラウザでは Worker へ逃がして UI スレッドを止めない（本体側の追加は elk-api.js の 5KB だけ）。
 * Worker が無い環境（vitest の node）では bundled をそのまま動的 import する。
 * ------------------------------------------------------------------ */

type ElkLayoutFn = (graph: ElkNode) => Promise<ElkNode>

let elkPromise: Promise<ElkLayoutFn> | null = null

async function createElk(): Promise<ElkLayoutFn> {
  if (typeof Worker === 'function') {
    try {
      const { default: ELK } = await import('elkjs/lib/elk-api.js')
      // ELK のコンストラクタは workerFactory をその場で呼ぶので、
      // CSP で Worker が作れない環境ならここで例外になる → bundled へ落とす
      const elk = new ELK({
        workerFactory: () =>
          new Worker(new URL('elkjs/lib/elk-worker.min.js', import.meta.url), { type: 'module' }),
      })
      return (graph) => elk.layout(graph)
    } catch {
      /* Worker が作れない環境（CSP など）。下の bundled で続行する */
    }
  }
  const { default: ELK } = await import('elkjs/lib/elk.bundled.js')
  const elk = new ELK()
  return (graph) => elk.layout(graph)
}

export function getElk(): Promise<ElkLayoutFn> {
  if (elkPromise === null) {
    // 失敗した Promise を握り続けると以降のレイアウトが全部同じ理由で死ぬので、捨てて次回やり直す
    elkPromise = createElk().catch((e: unknown) => {
      elkPromise = null
      throw e
    })
  }
  return elkPromise
}

/* ------------------------------------------------------------------ *
 * 入力グラフの組み立て
 * ------------------------------------------------------------------ */

/**
 * 線上ラベルの占有サイズ（概算）。ELK はこのぶんの場所を空けてくれるので、
 * 「ラベルが隣の枠に重なる」「ラベルが自分の線に重なる」が同時に消える。
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

/** 中央 ±(span × SPREAD_RATIO) の帯に k 個を等間隔で置くときのオフセット */
function spreadOffsets(k: number, span: number, maxHalfSpan = Number.POSITIVE_INFINITY): number[] {
  if (k <= 1) return [0]
  const step = Math.min(
    SPREAD_STEP_MAX,
    (span * SPREAD_RATIO * 2) / (k - 1),
    (maxHalfSpan * 2) / (k - 1),
  )
  return Array.from({ length: k }, (_, i) => (i - (k - 1) / 2) * step)
}

type Deg = { inKeys: string[]; outKeys: string[] }

/** 辺ごとに専用ポートを 1 つ作るので、ノードごとの入出力 key を先に数える */
function degreesOf(links: readonly ElkLink[]): Map<string, Deg> {
  const out = new Map<string, Deg>()
  const get = (id: string): Deg => {
    let d = out.get(id)
    if (d === undefined) {
      d = { inKeys: [], outKeys: [] }
      out.set(id, d)
    }
    return d
  }
  for (const l of links) {
    get(l.from).outKeys.push(l.key)
    get(l.to).inKeys.push(l.key)
  }
  return out
}

/**
 * 葉ノード 1 つぶんのポート。辺ごとに 1 ポート作り FIXED_POS で位置を決める。
 * これで「入口は必ず上辺（DOWN）/ 左辺（RIGHT）の中央寄り、出口は必ず反対側」が成立する。
 * グループ（compound node）には付けない（付けると入れ子で斜め線が出る。#18 実測）。
 *
 * ひし形は散らす幅を DIAMOND_MAX_INSET から逆算した上限で絞る。端点そのものは ELK が
 * bbox の枠線へスナップするので、4 頂点の外周へ乗せるのは読み取り側（snapDiamondEndpoints）。
 */
function portsOf(
  id: string,
  w: number,
  h: number,
  shape: 'rect' | 'diamond',
  direction: Direction,
  deg: Deg | undefined,
  nest: boolean,
): ElkPort[] {
  if (deg === undefined) return []
  const horiz = direction === 'RIGHT'
  const span = horiz ? h : w // ポートを散らす軸
  const spanMain = horiz ? w : h // 主軸（食い込む向き）
  const maxInset = nest ? DIAMOND_MAX_INSET.nest : DIAMOND_MAX_INSET.flat
  const cap = shape === 'diamond' ? (maxInset * span) / spanMain : Number.POSITIVE_INFINITY

  const make = (keys: readonly string[], dir: 'in' | 'out'): ElkPort[] =>
    spreadOffsets(keys.length, span, cap).map((off, i) => ({
      id: portId(id, dir, keys[i]),
      width: 1,
      height: 1,
      x: horiz ? (dir === 'in' ? 0 : w) : w / 2 + off,
      y: horiz ? h / 2 + off : dir === 'in' ? 0 : h,
      layoutOptions: { 'elk.port.side': dir === 'in' ? IN_SIDE[direction] : OUT_SIDE[direction] },
    }))

  return [
    ...(deg.inKeys.length > 0 ? make(deg.inKeys, 'in') : []),
    ...(deg.outKeys.length > 0 ? make(deg.outKeys, 'out') : []),
  ]
}

const portId = (nodeId: string, dir: 'in' | 'out', key: string) => `${nodeId}#${dir}:${key}`

type ElkBuild = {
  root: ElkNode
  /** container id → その ElkNode（辺を宣言する先） */
  index: Map<string, ElkNode>
  /** ポートを持つノードの id（辺の端点をポート参照にするか判定する） */
  ported: Set<string>
}

function buildElkNodes(
  specs: readonly Spec[],
  direction: Direction,
  deg: Map<string, Deg>,
  partition: ReadonlyMap<string, number> | undefined,
  index: Map<string, ElkNode>,
  ported: Set<string>,
  nest: boolean,
): ElkNode[] {
  return specs.map((s) => {
    const opts: Record<string, string> = {}
    const part = partition?.get(s.id)
    if (part !== undefined) opts['elk.partitioning.partition'] = String(part)
    const out: ElkNode = { id: s.id }
    index.set(s.id, out)

    if (s.kind === 'group') {
      out.children = buildElkNodes(s.children, direction, deg, partition, index, ported, nest)
      out.edges = []
      opts['elk.padding'] =
        `[top=${s.pad.top},left=${s.pad.left},bottom=${s.pad.bottom},right=${s.pad.right}]`
      // 中身より小さくならないようにする。これが無いと入れ子の枠が子を食う
      opts['elk.nodeSize.constraints'] = 'MINIMUM_SIZE'
    } else {
      const w = s.kind === 'leaf' ? s.w : s.box.slotW
      const h = s.kind === 'leaf' ? s.h : s.box.slotH
      out.width = w
      out.height = h
      const shape = s.kind === 'leaf' ? s.shape : 'rect'
      const ports = portsOf(s.id, w, h, shape, direction, deg.get(s.id), nest)
      if (ports.length > 0) {
        out.ports = ports
        opts['elk.portConstraints'] = 'FIXED_POS'
        ported.add(s.id)
      }
    }
    if (Object.keys(opts).length > 0) out.layoutOptions = opts
    return out
  })
}

/**
 * ELK layered のオプション。
 *
 * ELK は不正なオプション名・値を例外なく黙って無視する（実測）。足したら必ず出力の数値で確かめること。
 * 実際に無視された / 壊れたもの（bbox が 1px も動かない・例外・無応答）:
 *   elk.layered.spacing.baseValue / elk.edgeLabels.inline /
 *   elk.layered.compaction.postCompaction.strategy / layering.strategy=STRETCH_WIDTH（無応答）/
 *   layering.strategy=DF_MODEL_ORDER（IndexOutOfBoundsException）
 */
function elkLayoutOptions(
  nest: boolean,
  direction: Direction,
  gap: { node: number; rank: number },
  partitioned: boolean,
): Record<string, string> {
  const edge = nest ? EDGE_SPACING.nest : EDGE_SPACING.flat
  const opts: Record<string, string> = {
    'elk.algorithm': 'layered',
    // 左ペイン（入れ子）は direction を無視して縦固定（NOTES.md「幅 36〜52% の柱」）
    'elk.direction': nest ? 'DOWN' : direction,
    'elk.edgeRouting': 'ORTHOGONAL',
    'elk.hierarchyHandling': 'INCLUDE_CHILDREN',
    'elk.layered.nodePlacement.strategy': 'BRANDES_KOEPF',
    'elk.layered.crossingMinimization.strategy': 'LAYER_SWEEP',
    'elk.layered.crossingMinimization.forceNodeModelOrder': 'false',
    'elk.layered.thoroughness': '14',
    // 既定の GREEDY は順路を無視して逆走辺を作る。JSON の並びを正とする
    'elk.layered.cycleBreaking.strategy': 'MODEL_ORDER',
    'elk.layered.considerModelOrder.strategy': 'NODES_AND_EDGES',
    'elk.layered.mergeEdges': 'false',
    'elk.layered.unnecessaryBendpoints': 'true',
    'elk.spacing.nodeNode': String(gap.node),
    'elk.layered.spacing.nodeNodeBetweenLayers': String(gap.rank),
    'elk.spacing.edgeNode': String(edge.edgeNode),
    'elk.spacing.edgeEdge': String(edge.edgeEdge),
    'elk.layered.spacing.edgeNodeBetweenLayers': String(edge.rankNode),
    'elk.layered.spacing.edgeEdgeBetweenLayers': String(edge.rankEdge),
    'elk.spacing.edgeLabel': '6',
    'elk.spacing.labelNode': '8',
    'elk.edgeLabels.placement': 'CENTER',
    'elk.layered.edgeLabels.sideSelection': 'ALWAYS_DOWN',
    'elk.padding': '[top=0,left=0,bottom=0,right=0]',
  }
  // 入れ子と 3 バンド: 並び順をレイヤ順として強制する（入れ子ではこれが無いと兄弟ペア 15/20 のまま）
  if (partitioned) opts['elk.partitioning.activate'] = 'true'
  return opts
}

/** 親の children 配列内の順番（= JSON 順 = 読み順）を partition 番号にする */
function partitionOf(specs: readonly Spec[]): Map<string, number> {
  const out = new Map<string, number>()
  const walk = (list: readonly Spec[]) => {
    list.forEach((s, i) => {
      out.set(s.id, i)
      if (s.kind === 'group') walk(s.children)
    })
  }
  walk(specs)
  return out
}

export function buildElkGraph(
  specs: readonly Spec[],
  links: readonly ElkLink[],
  ctx: LayoutCtx,
  nest: boolean,
): ElkBuild {
  const direction = nest ? 'DOWN' : ctx.direction
  const index = new Map<string, ElkNode>()
  const ported = new Set<string>()
  // 入れ子は「JSON の並び順」、3 バンドは呼び出し側が渡した番号を層順として強制する
  const partition = nest ? partitionOf(specs) : ctx.partition
  const root: ElkNode = {
    id: 'root',
    layoutOptions: elkLayoutOptions(nest, ctx.direction, ctx.gap ?? LAYOUT_GAP, partition !== undefined),
    children: [],
    edges: [],
  }
  index.set('root', root)
  const deg = degreesOf(links)
  root.children = buildElkNodes(specs, direction, deg, partition, index, ported, nest)

  const parent = parentMapOf(specs)
  for (const l of links) {
    const container = lcaOf(l.from, l.to, parent)
    const host = index.get(container)
    if (host === undefined) continue
    const edge: ElkExtendedEdge = {
      id: l.key,
      sources: [ported.has(l.from) ? portId(l.from, 'out', l.key) : l.from],
      targets: [ported.has(l.to) ? portId(l.to, 'in', l.key) : l.to],
      container,
    }
    if (l.label !== undefined) {
      const size = labelSizeOf(l.label)
      edge.labels = [{ text: l.label, width: size.width, height: size.height }]
    }
    host.edges = host.edges ?? []
    host.edges.push(edge)
  }
  return { root, index, ported }
}

/** 見えている箱の id → 親の id（トップレベルは 'root'） */
function parentMapOf(specs: readonly Spec[]): Map<string, string> {
  const out = new Map<string, string>()
  const walk = (list: readonly Spec[], parent: string) => {
    for (const s of list) {
      out.set(s.id, parent)
      if (s.kind === 'group') walk(s.children, s.id)
    }
  }
  walk(specs, 'root')
  return out
}

/**
 * 2 ノードの最小共通祖先（= ELK でこの辺を宣言すべきコンテナ）。
 * 端点自身はコンテナになれない（子ではなく自分に刺さるため）ので親から探す。
 */
function lcaOf(a: string, b: string, parent: Map<string, string>): string {
  const chain = (id: string) => {
    const out = [id]
    for (let c = parent.get(id); c !== undefined; c = parent.get(c)) out.push(c)
    return out
  }
  const up = new Set(chain(b))
  for (const x of chain(a).slice(1)) if (up.has(x)) return x
  return 'root'
}


/**
 * LogicFlow アダプタ — レイアウトの公開型と座標の小道具。
 *
 * layout.ts（arrange）/ layout-spec.ts / layout-elk.ts / layout-read.ts / layout-emit.ts の
 * どこからでも参照される土台。ここには「型」と「副作用の無い小さな関数」だけを置く。
 */

import type { FlatNode } from '../flow/flatten'
import type { CollapseState, Direction, FlowLink } from '../flow/schema'

/** ドリルダウン / split の各ビューは折りたたみを使わないので、空の集合を使い回す */
export const EMPTY_COLLAPSE: CollapseState = new Set<string>()

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
   * ELK の elk.spacing.nodeNode / elk.layered.spacing.nodeNodeBetweenLayers にそのまま渡す。
   * 左ペインの入れ子は「細長い柱の中に箱を積む」ので、本編と同じ間隔だと縦に伸びすぎる。
   */
  gap?: { node: number; rank: number }
  /**
   * ノードごとのサイズ上書き（フォーカス + コンテキストのコンテキスト層専用）。
   * undefined を返した id は通常どおり kind から決める。
   */
  sizeOf?: (id: string) => { width: number; height: number } | undefined
  /**
   * 層の並び順の強制（elk.partitioning）。番号が小さいほど主軸の手前に置かれる。
   * フォーカス + コンテキストの 3 バンド（前 0 / フォーカス 1 / 後 2）をこれで作る。
   * 同じ番号のノードどうしは従来どおり ELK が層を決める。
   */
  partition?: ReadonlyMap<string, number>
  /**
   * 入れ子（split 左ペイン）で線上ラベルの場所を ELK に空けさせるか。
   * 空けるとラベルが線と枠を覆わなくなる代わりに縦に伸びる（実測: 0.85 → 0.78）ので、
   * 呼び出し側が「縮尺が頭打ちで損しない」ことを確かめたときだけ true にする。
   */
  nestLabels?: boolean
}

export type Point = { x: number; y: number }

/** 左上基準の矩形。視野合わせ（fitViewport）が基準にする「ノード実体だけ」の枠に使う */
export type Bounds = { x: number; y: number; w: number; h: number }

/** 1 本のエッジの配線結果。points は直交折れ線（両端は枠線上）、labelAt はラベルの中心 */
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
  /** 線の刺さり方。diamond は端点を 4 頂点の外周へ着地させる */
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
   * 座標は boxes と同じ系（左上 0,0 始まり）。両端がこの階層で「見えている箱」でない
   * リンク（折りたたみ中のグループの中身へ刺さるもの）はここではなく projected に入る。
   */
  edgePoints: Map<string, Point[]>
  /** ラベルを持つエッジの、ラベル中心座標（edgePoints と同じ key・同じ系） */
  labelAt: Map<string, Point>
  /**
   * 主軸方向の層番号（回帰テストと診断用）。
   * ELK は層番号を出力に載せないので、トップレベルの箱の主軸開始座標をまとめて番号にしている
   * （ELK layered は同じ層のノードを主軸の開始座標で揃える。実測で確認済み）。
   */
  ranks: Map<string, number>
  /**
   * ノード実体だけの外接矩形（配線とラベルは含めない）。視野合わせの基準はこちら。
   * width / height は線とラベルのはみ出しを含むので、これで fit すると
   * 「はみ出す軸を開始側へ寄せた結果、可視域にノードが 1 つも無い」が起きる（#19 レビュー HIGH 1）。
   */
  nodeBox: Bounds
  /** 主軸の先頭にある箱。収まらない軸では、この箱が必ず可視域に入るように寄せる */
  headBox: Bounds
  /**
   * 折りたたみ中のグループをまたぐ線の配線。key は `<見えている始点>-><見えている終点>`。
   * 同じ組は 1 本に畳んである（ELK にも 1 本しか渡していない）。
   * 呼び出し側は LogicFlow の仮想エッジ / 補修エッジにこの折れ線を当てる
   * （当てないと自動経路になり、畳んだ箱を線が貫通する。#19 レビュー HIGH 3）。
   */
  projected: Map<string, Point[]>
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

/* ------------------------------------------------------------------ *
 * 箱の仕様（buildSpec が作り、buildElkNodes と toBoxes が読む）
 * ------------------------------------------------------------------ */

export type Pad = { top: number; left: number; right: number; bottom: number }

export type Spec =
  /** ELK に寸法を渡す葉。ひし形はここで shape が付く */
  | { kind: 'leaf'; id: string; w: number; h: number; shape: 'rect' | 'diamond' }
  /** ELK の compound node。サイズと子の位置は ELK が決める */
  | { kind: 'group'; id: string; children: Spec[]; pad: Pad }
  /**
   * 折りたたみ中のグループ。親のレイアウトでは COLLAPSED_SIZE の葉として置き、
   * 展開時の中身は別の arrange() で先に決めておく（ELK の compound にすると
   * 場所取りが展開時サイズになり、折りたたむ意味が無くなる）。
   */
  | { kind: 'collapsed'; id: string; box: Box }

/** 子を持たない固定サイズの箱 */
export function leafBox(id: string, size: { width: number; height: number }, shape: Box['shape']): Box {
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
export function shiftRoutes(
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

/* ------------------------------------------------------------------ *
 * ELK へ渡す辺（resolveLinks が作り、buildElkGraph と arrange が読む）
 * ------------------------------------------------------------------ */

/**
 * 折りたたみ中のグループへ寄せた辺の key 接頭辞。
 * edgeKeysOf() が作る key（JSON 配列）とは絶対に衝突しない形にしてある。
 */
export const PROJECTED_PREFIX = 'proj:'

/** ELK に渡す 1 本の辺 */
export type ElkLink = {
  /** 配線 key。direct は edgeKeysOf() の key、射影した辺は PROJECTED_PREFIX 始まり */
  key: string
  /** ELK に渡す向き（loopback を反転したときは元と逆） */
  from: string
  to: string
  /** true = 両端がこの階層で見えている箱そのもの。配線結果をそのまま LogicFlow に使える */
  direct: boolean
  /** 反転して渡した辺。読み取り時に折れ線を reverse() して戻す */
  reversed: boolean
  label: string | undefined
}

/* ------------------------------------------------------------------ *
 * LogicFlow の座標系（emitArranged の出力）
 * ------------------------------------------------------------------ */

export type Placed = { x: number; y: number; w: number; h: number }

/** emitArranged() の出力。座標はすべてキャンバス上の絶対座標 */
export type Emitted = {
  positions: Map<string, Placed>
  edgePoints: Map<string, Point[]>
  labelAt: Map<string, Point>
  /** ノード実体だけの外接矩形（視野合わせの基準）。Arranged の同名フィールドを平行移動したもの */
  nodeBox: Bounds
  /** 主軸の先頭にある箱 */
  headBox: Bounds
  /** 折りたたみ中のグループをまたぐ線の配線（Arranged.projected と同じ key） */
  projected: Map<string, Point[]>
}

/** 矩形を平行移動する（Bounds は不変なので新しい値を返す） */
export const shiftBounds = (b: Bounds, dx: number, dy: number): Bounds => ({
  x: b.x + dx,
  y: b.y + dy,
  w: b.w,
  h: b.h,
})


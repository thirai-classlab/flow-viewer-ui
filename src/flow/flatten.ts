/**
 * 再帰ネスト（正）→ フラット + parentId（描画用）への変換。
 *
 * カタログ「付録 A-1」の推奨どおり、深さ優先で展開することで
 * 「親ノードが配列内で子より前に来る」ことを自動的に保証する。
 * React Flow はこれを守らないと `Parent node ${parentId} not found.` を
 * console.warn して黙ってノードをスキップする。
 */

import type { FlowDoc, FlowStep, StepKind, StepMeta } from './schema'

export type FlatNode = {
  id: string
  label: string
  kind: StepKind
  /** 親グループの id。トップレベルなら undefined */
  parentId?: string
  /** 階層の深さ。0 = トップレベル */
  depth: number
  /** 子を持つ = 折りたたみ・ドリルダウンの対象になれる */
  isContainer: boolean
  /** 直接の子の id（コンテナのみ） */
  childIds: string[]
  meta?: StepMeta
}

export type FlatDoc = {
  nodes: FlatNode[]
  /** 子 id → 親 id。resolveEndpoint が使う */
  parentOf: Map<string, string>
  byId: Map<string, FlatNode>
  /** コンテナの id 一覧（折りたたみ UI 用） */
  containerIds: string[]
}

/**
 * 深さ優先で再帰ネストを平坦化する。
 * 出力配列は必ず「親 → その子孫 → 次の親」の順になる。
 */
export function flattenDoc(doc: FlowDoc): FlatDoc {
  const nodes: FlatNode[] = []
  const parentOf = new Map<string, string>()
  const byId = new Map<string, FlatNode>()
  const containerIds: string[] = []

  const walk = (steps: FlowStep[], parentId: string | undefined, depth: number) => {
    for (const step of steps) {
      const children = step.children ?? []
      const isContainer = children.length > 0
      const node: FlatNode = {
        id: step.id,
        label: step.label,
        kind: step.kind,
        parentId,
        depth,
        isContainer,
        childIds: children.map((c) => c.id),
        meta: step.meta,
      }
      // 親を先に push することが React Flow の要件を満たす鍵
      nodes.push(node)
      byId.set(node.id, node)
      if (parentId !== undefined) parentOf.set(step.id, parentId)
      if (isContainer) {
        containerIds.push(step.id)
        walk(children, step.id, depth + 1)
      }
    }
  }

  walk(doc.root, undefined, 0)
  return { nodes, parentOf, byId, containerIds }
}

/** 祖先チェーンを近い順に返す（自分自身は含まない） */
export function ancestorsOf(id: string, parentOf: Map<string, string>): string[] {
  const out: string[] = []
  for (let cur = parentOf.get(id); cur !== undefined; cur = parentOf.get(cur)) {
    out.push(cur)
  }
  return out
}

/** id を起点にした部分木の全 id（自分自身を含む） */
export function descendantsOf(id: string, byId: Map<string, FlatNode>): string[] {
  const out: string[] = [id]
  const node = byId.get(id)
  if (!node) return out
  for (const childId of node.childIds) {
    out.push(...descendantsOf(childId, byId))
  }
  return out
}

/** ルートから id までのパス（パンくず用）。id 自身を含む */
export function pathTo(id: string, parentOf: Map<string, string>): string[] {
  return [...ancestorsOf(id, parentOf).reverse(), id]
}

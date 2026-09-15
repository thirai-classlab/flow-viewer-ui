/**
 * テストケースの共通型。
 *
 * ベンチマークとして意味のあるデータは「ライブラリの差が出る」データなので、
 * 各ケースに **何を検証するためのものか** を必ず持たせる。
 * UI にそのまま出して「今どのストレスをかけているか」が分かるようにする。
 */

import type { FlowDoc } from '../schema'

/** このケースが主に何に負荷をかけるか */
export type StressKind =
  | 'layout-width' // 横方向のレイアウト限界（並列が多い）
  | 'layout-height' // 縦方向の限界（直列が長い）
  | 'edge-routing' // エッジの交差・回避（密結合）
  | 'edge-aggregation' // 折りたたみ時のエッジ集約（多重・並列）
  | 'cycles' // 循環・自己ループ（DAG でないグラフ）
  | 'hierarchy-depth' // 階層の深さ
  | 'hierarchy-width' // 1 グループあたりの要素数
  | 'degenerate' // 退化ケース（空グループ・孤立ノード）
  | 'scale' // 描画性能（大規模）
  | 'realistic' // 実務に近い構造

export type TestCase = {
  id: string
  /** UI に出す短い名前 */
  label: string
  /** 何を検証するためのデータか。UI に出すので 1〜2 文で */
  purpose: string
  /** 主にどこへ負荷をかけるか */
  stress: StressKind[]
  /**
   * このケースで差が出そうなライブラリと、その予想。
   * 実測して外れたらそれ自体が発見になるので、外れることを恐れず書く。
   */
  expectation?: string
  doc: FlowDoc
}

/** ケースの規模をざっと測る（UI 表示用） */
export function caseSize(doc: FlowDoc): { nodes: number; groups: number; links: number; depth: number } {
  let nodes = 0
  let groups = 0
  let depth = 0
  const walk = (steps: FlowDoc['root'], d: number) => {
    for (const s of steps) {
      nodes++
      depth = Math.max(depth, d)
      if (s.children?.length) {
        groups++
        walk(s.children, d + 1)
      }
    }
  }
  walk(doc.root, 0)
  return { nodes, groups, links: doc.links.length, depth: depth + 1 }
}

/**
 * 表示するデータの選択と解決。
 *
 * 選択肢は 3 系統:
 *   - 手書きサンプル（3 階層 / 5 階層）… 業務フローとして自然な形
 *   - 自動生成（1〜10 階層）… 深さへの耐性を測る
 *   - テストケース（32 種）… 特定の弱点を突く
 *
 * select の value にそのまま使えるよう文字列で表す。
 */

import type { FlowDoc } from './schema'
import { sampleFlow } from './sample-data'
import { deepFlow } from './sample-data-deep'
import { generateFlow } from './generate'
import { caseById, caseCategories } from './cases'
import type { TestCase } from './cases'

/** 'sample3' | 'sample5' | 'gen:5' | 'case:wide-parallel-24' */
export type DataSel = string

export const DEFAULT_DATA_SEL: DataSel = 'sample3'

/** 自動生成で選べる階層数 */
export const GEN_DEPTHS = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]

export type ResolvedData = {
  doc: FlowDoc
  /** テストケースを選んでいる場合のみ。purpose / stress / expectation を UI に出す */
  testCase?: TestCase
}

export function resolveDoc(sel: DataSel): ResolvedData {
  if (sel === 'sample5') return { doc: deepFlow }
  if (sel.startsWith('gen:')) {
    const depth = Number(sel.slice(4))
    if (Number.isFinite(depth) && depth >= 1) return { doc: generateFlow({ depth }) }
  }
  if (sel.startsWith('case:')) {
    const c = caseById.get(sel.slice(5))
    if (c) return { doc: c.doc, testCase: c }
  }
  // 未知の値は既定に落とす（URL 直打ちや古い状態が残った場合の保険）
  return { doc: sampleFlow }
}

/** select の <optgroup> 構造をそのまま返す */
export function dataSelOptions(): { label: string; options: { value: DataSel; label: string }[] }[] {
  return [
    {
      label: '手書きサンプル',
      options: [
        { value: 'sample3', label: '3 階層（業務フロー・30 ノード）' },
        { value: 'sample5', label: '5 階層（業務フロー・70 ノード）' },
      ],
    },
    {
      label: '自動生成（深さ検証）',
      options: GEN_DEPTHS.map((d) => ({ value: `gen:${d}`, label: `${d} 階層` })),
    },
    ...caseCategories.map((cat) => ({
      label: `${cat.label}（${cat.cases.length}）`,
      options: cat.cases.map((c) => ({ value: `case:${c.id}`, label: c.label })),
    })),
  ]
}

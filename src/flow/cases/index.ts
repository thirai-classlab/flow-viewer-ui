/**
 * テストケースの集約。
 *
 * カテゴリごとに別ファイルで定義し、ここで 1 つのリストにまとめる。
 * UI はこのリストだけを見ればよく、ケースを足すときは
 * 対応するカテゴリのファイルに追記するだけで自動的に一覧へ出る。
 */

import type { TestCase, StressKind } from './types'
import { structuralCases } from './structural'
import { realisticCases } from './realistic'
import { scaleCases } from './scale'
import { degenerateCases } from './degenerate'

export type { TestCase, StressKind }
export { caseSize } from './types'

export type CaseCategory = {
  id: string
  label: string
  /** このカテゴリが何を測るためのものか */
  description: string
  cases: TestCase[]
}

export const caseCategories: CaseCategory[] = [
  {
    id: 'structural',
    label: '構造',
    description:
      'レイアウトエンジンの限界を突く。超横並列・超直列・密結合・多重エッジなど、ノード数ではなく形で負荷をかける',
    cases: structuralCases,
  },
  {
    id: 'realistic',
    label: '実務',
    description:
      '現実の業務フローに近い構造。承認・インシデント対応・受発注・DAG・状態遷移など、自社のフローに近いものを選んで比べる',
    cases: realisticCases,
  },
  {
    id: 'scale',
    label: '規模',
    description:
      '描画性能の限界。150 → 400 → 900 ノードと段階的に上げ、どこで破綻するかを測る。重いケースを含むので注意',
    cases: scaleCases,
  },
  {
    id: 'degenerate',
    label: '退化',
    description:
      '実装が雑だと壊れる入力。空・孤立ノード・自己ループ・入口なし循環・特殊文字など。壊れ方の違いを見るのが目的',
    cases: degenerateCases,
  },
]

/** 全ケースをフラットに */
export const allCases: TestCase[] = caseCategories.flatMap((c) => c.cases)

/** id からケースを引く */
export const caseById = new Map(allCases.map((c) => [c.id, c]))

/** ケース総数（UI 表示用） */
export const caseCount = allCases.length

/**
 * LogicFlow アダプタ — 「手順書（FlowStep.doc）を持つノード」の索引。
 *
 * doc は長文の Markdown なので描画側は中身を必要としない。要るのは
 * 「この id には読むものがあるか」の 1 bit だけで、それを図の上に 📄 として出す。
 *
 * 平坦化（src/flow/flatten.ts）は共通レイヤなので触らず、
 * 真実源の FlowDoc を 1 回歩いて id 集合を作るだけにしてある。
 */

import type { FlowDoc, FlowStep } from '../flow/schema'

/** doc を持つステップの id 集合。空文字・空白だけの doc は「無い」とみなす */
export function docIdsOf(doc: FlowDoc): Set<string> {
  const out = new Set<string>()
  const walk = (steps: readonly FlowStep[]) => {
    for (const step of steps) {
      if (typeof step.doc === 'string' && step.doc.trim() !== '') out.add(step.id)
      if (step.children !== undefined) walk(step.children)
    }
  }
  walk(doc.root)
  return out
}

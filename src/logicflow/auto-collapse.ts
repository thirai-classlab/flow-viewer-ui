/**
 * LogicFlow アダプタ — nested モードの自動抽象化（#15）。
 *
 * 全階層を一度に描く nested は、折り返し廃止（#13）で sample3 のトップが縮尺 0.25、
 * sample5 が 0.14 まで縮んでラベルが読めない。初期表示では「読める縮尺（FIT.minReadable）を
 * 割る深さ」を自動で畳み、結果は既存の collapsed（App の state）に載せる。
 * 1 回だけ適用し、その後のユーザーの展開 / 折りたたみは上書きしない（判定は effect 側）。
 */

import type { FlatNode } from '../flow/flatten'
import { FIT } from '../flow/theme'
import { fitScale } from './anim'
import type { LayoutCtx } from './layout'
import { arrange } from './layout'

/**
 * 畳むコンテナ id を選ぶ。全展開（full）の生の縮尺が既に FIT.minReadable 以上なら null。
 *
 * 深いコンテナから順に「深さ ≥ d を全部畳んだ collapsed」で arrange し、
 * 生の縮尺（下限なし）が FIT.minReadable に届く最初の d を採る。
 * どの d でも届かなければ最も浅い d（= スコープ内の全コンテナ）を返す。
 * ctx.collapsed は空である前提（呼び出し側が collapsed.size === 0 のときだけ呼ぶ）。
 */
export async function pickAutoCollapse(
  topIds: readonly string[],
  containers: readonly FlatNode[],
  ctx: LayoutCtx,
  full: { width: number; height: number },
  cw: number,
  ch: number,
): Promise<string[] | null> {
  if (containers.length === 0) return null
  if (fitScale(full.width, full.height, cw, ch) >= FIT.minReadable) return null

  const depths = containers.map((c) => c.depth)
  const deepest = Math.max(...depths)
  const shallowest = Math.min(...depths)
  // drillRoot 配下では深さが絶対値のまま来るので、スコープ内の最浅コンテナまでで打ち切る
  // （それより浅い d は候補が同じ集合になり、arrange を繰り返すだけ）
  let ids: string[] = []
  for (let d = deepest; d >= shallowest; d -= 1) {
    ids = containers.filter((c) => c.depth >= d).map((c) => c.id)
    const arr = await arrange(topIds, { ...ctx, collapsed: new Set(ids) })
    if (fitScale(arr.width, arr.height, cw, ch) >= FIT.minReadable) return ids
  }
  return ids
}

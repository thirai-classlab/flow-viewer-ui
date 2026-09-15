/**
 * 手順書パネルの幅の決め方（DOM に依存しない純粋な部分）。
 *
 * DocPanel.tsx はコンポーネント以外を export できない（React Fast Refresh の制約）ので、
 * テストしたい計算だけをここに切り出している。
 */

/** パネル幅の下限。これより狭いと表が読めない */
export const MIN_WIDTH = 320
/** キャンバスに残す最低幅。パネルでフローを完全に隠さない */
export const MIN_CANVAS = 320

/**
 * localStorage に覚えていた幅を解釈する。
 * 無い / 数値でない / 下限未満 なら null（= CSS の既定幅 min(560px, 45%) のまま）。
 */
export function parseStoredWidth(raw: string | null): number | null {
  if (raw === null) return null
  const n = Number(raw)
  return Number.isFinite(n) && n >= MIN_WIDTH ? n : null
}

/**
 * ドラッグ中の希望幅を、下限とキャンバスの残り幅で挟む。
 * 親（canvas-wrap）が MIN_WIDTH + MIN_CANVAS より狭いときは下限を優先する（キャンバスを潰してでもパネルは読める幅に）。
 */
export function clampWidth(desired: number, wrapWidth: number): number {
  const max = Math.max(MIN_WIDTH, wrapWidth - MIN_CANVAS)
  return Math.min(max, Math.max(MIN_WIDTH, desired))
}

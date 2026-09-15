import { describe, expect, it } from 'vitest'
import { MIN_CANVAS, MIN_WIDTH, clampWidth, parseStoredWidth } from '../src/ui/doc-panel-width'

describe('parseStoredWidth', () => {
  it('無い / 数値でない / 下限未満 は null（CSS の既定幅に任せる）', () => {
    expect(parseStoredWidth(null)).toBeNull()
    expect(parseStoredWidth('')).toBeNull()
    expect(parseStoredWidth('abc')).toBeNull()
    expect(parseStoredWidth('NaN')).toBeNull()
    expect(parseStoredWidth('Infinity')).toBeNull()
    expect(parseStoredWidth(String(MIN_WIDTH - 1))).toBeNull()
  })

  it('下限以上の数値はそのまま返す', () => {
    expect(parseStoredWidth(String(MIN_WIDTH))).toBe(MIN_WIDTH)
    expect(parseStoredWidth('740')).toBe(740)
  })
})

describe('clampWidth', () => {
  it('下限とキャンバスの残り幅で挟む', () => {
    // 1440 幅: 320 〜 1120
    expect(clampWidth(100, 1440)).toBe(MIN_WIDTH)
    expect(clampWidth(740, 1440)).toBe(740)
    expect(clampWidth(5000, 1440)).toBe(1440 - MIN_CANVAS)
  })

  it('編集モードのように親が狭いときは上限が下がる', () => {
    // 980 幅（右に JSON パネル）: 上限 660
    expect(clampWidth(740, 980)).toBe(980 - MIN_CANVAS)
  })

  it('親が MIN_WIDTH + MIN_CANVAS より狭くても下限を割らない', () => {
    expect(clampWidth(500, 400)).toBe(MIN_WIDTH)
    expect(clampWidth(100, 400)).toBe(MIN_WIDTH)
  })
})

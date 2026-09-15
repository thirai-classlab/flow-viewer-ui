/**
 * 視野合わせ（fitViewport）の下限。
 *
 * #15: 長いフローで縮尺が 0.49（1440x900 の sample3 トップ）まで落ちてラベルが潰れたので、
 * FIT.minReadable（0.85 = 13px × 0.85 ≒ 11px、日本語の下限）で止め、
 * 収まらない軸は開始側（左 / 上）に pad/2 で寄せる。収まる軸は従来どおり中央。
 */

import { describe, expect, it } from 'vitest'

import { FIT } from '../src/flow/theme'
import { fitScale, fitViewport } from '../src/logicflow/anim'

const CW = 1440
const CH = 860
const PAD = FIT.padding

describe('fitViewport の下限（FIT.minReadable）', () => {
  it('収まるときは従来どおり: 生の縮尺で両軸とも中央寄せ', () => {
    // 1000x400 → 横 (1440-56)/1000 = 1.384 が効く（maxScale 1.4 未満）
    const vp = fitViewport(1000, 400, CW, CH)
    expect(vp.scale).toBeCloseTo((CW - PAD) / 1000, 6)
    expect(vp.tx).toBeCloseTo((CW - 1000 * vp.scale) / 2, 6)
    expect(vp.ty).toBeCloseTo((CH - 400 * vp.scale) / 2, 6)
  })

  it('横が長くて下限を割るときは minReadable で止め、横は左端 pad/2、縦は中央', () => {
    // 2800x300 → 生の縮尺 (1440-56)/2800 = 0.494 < 0.85
    const vp = fitViewport(2800, 300, CW, CH)
    expect(vp.scale).toBe(FIT.minReadable)
    expect(vp.tx).toBe(PAD / 2)
    expect(vp.ty).toBeCloseTo((CH - 300 * FIT.minReadable) / 2, 6)
  })

  it('縦が長くて下限を割るときは縦を上端 pad/2、横は中央', () => {
    // 300x2800 → 生の縮尺 (860-56)/2800 = 0.287 < 0.85
    const vp = fitViewport(300, 2800, CW, CH)
    expect(vp.scale).toBe(FIT.minReadable)
    expect(vp.tx).toBeCloseTo((CW - 300 * FIT.minReadable) / 2, 6)
    expect(vp.ty).toBe(PAD / 2)
  })

  it('両軸とも収まらなければ左上 pad/2', () => {
    const vp = fitViewport(4000, 3000, CW, CH)
    expect(vp.scale).toBe(FIT.minReadable)
    expect(vp.tx).toBe(PAD / 2)
    expect(vp.ty).toBe(PAD / 2)
  })

  it('minScale に FIT.minScale を渡すと下限なし（全体を表示）: 生の縮尺で中央寄せ', () => {
    const vp = fitViewport(2800, 300, CW, CH, PAD, FIT.maxScale, FIT.minScale)
    expect(vp.scale).toBeCloseTo((CW - PAD) / 2800, 6)
    expect(vp.tx).toBeCloseTo((CW - 2800 * vp.scale) / 2, 6)
    expect(vp.ty).toBeCloseTo((CH - 300 * vp.scale) / 2, 6)
  })

  it('fitScale は上限だけ効いた生の縮尺を返す（nested の自動抽象化の判定に使う）', () => {
    expect(fitScale(2800, 300, CW, CH)).toBeCloseTo((CW - PAD) / 2800, 6)
    expect(fitScale(100, 100, CW, CH)).toBe(FIT.maxScale)
    expect(fitScale(2800, 300, CW, CH, PAD, FIT.maxScalePane)).toBeCloseTo((CW - PAD) / 2800, 6)
  })
})

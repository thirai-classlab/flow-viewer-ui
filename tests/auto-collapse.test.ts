/**
 * nested の自動抽象化（#15）: 初期表示で読める縮尺（FIT.minReadable）を割る深さを畳む。
 *
 * 実測（arrange + fitScale、RIGHT。#19 の ELK 化後に再計測。括弧内は dagre 時代の値）:
 *   sample3 全展開 5797x606 → 1440x860 で 0.24 (0.25) / 深さ ≥ 1 を畳む 0.36 (0.35) / 全部畳む 0.53 (0.53、届かない)
 *   sample3 4000x2000 では 深さ ≥ 1 で 1.02 (0.99、届く)
 *   sample5 全展開 9963x1000 → 1440x860 で 0.14、深さ ≥ 1 で 0.64 (0.64)、全部畳む 1.01 (1.02、d = 0 で届く)
 *   sample5 2400x1200 では 深さ ≥ 2 で 0.70 (0.70)、深さ ≥ 1 で 1.08 (1.09、d = 1 で届く)
 */

import { describe, expect, it } from 'vitest'

import { flattenDoc } from '../src/flow/flatten'
import type { FlatDoc } from '../src/flow/flatten'
import { sampleFlow } from '../src/flow/sample-data'
import { deepFlow } from '../src/flow/sample-data-deep'
import type { FlowDoc } from '../src/flow/schema'
import { FIT } from '../src/flow/theme'
import { fitScale } from '../src/logicflow/anim'
import { pickAutoCollapse } from '../src/logicflow/auto-collapse'
import type { LayoutCtx } from '../src/logicflow/layout'
import { EMPTY_COLLAPSE, arrange } from '../src/logicflow/layout'

async function setup(doc: FlowDoc) {
  const flat: FlatDoc = flattenDoc(doc)
  const topIds = flat.nodes.filter((n) => n.parentId === undefined).map((n) => n.id)
  const containers = flat.nodes.filter((n) => n.isContainer)
  const ctx: LayoutCtx = { byId: flat.byId, links: doc.links, collapsed: EMPTY_COLLAPSE, direction: 'RIGHT' }
  const full = await arrange(topIds, ctx)
  return { flat, topIds, containers, ctx, full }
}

/** 「深さ ≥ d のコンテナ全部」の id 一覧 */
function depthCut(containers: readonly { id: string; depth: number }[], d: number): Set<string> {
  return new Set(containers.filter((c) => c.depth >= d).map((c) => c.id))
}

async function rawScaleWith(topIds: readonly string[], ctx: LayoutCtx, ids: Set<string>, cw: number, ch: number) {
  const arr = await arrange(topIds, { ...ctx, collapsed: ids })
  return fitScale(arr.width, arr.height, cw, ch)
}

describe('pickAutoCollapse', () => {
  it('全展開で既に読める縮尺なら null（何もしない）', async () => {
    const { topIds, containers, ctx, full } = await setup(sampleFlow)
    await expect(pickAutoCollapse(topIds, containers, ctx, full, 20000, 20000)).resolves.toBeNull()
  })

  it('sample5 @1440x860: 深さ ≥ 1 では届かず、全部畳む d = 0 で届く', async () => {
    const { topIds, containers, ctx, full } = await setup(deepFlow)
    const ids = await pickAutoCollapse(topIds, containers, ctx, full, 1440, 860)
    expect(ids).not.toBeNull()
    expect(new Set(ids!)).toEqual(depthCut(containers, 0))
    expect(await rawScaleWith(topIds, ctx, new Set(ids!), 1440, 860)).toBeGreaterThanOrEqual(FIT.minReadable)
    expect(await rawScaleWith(topIds, ctx, depthCut(containers, 1), 1440, 860)).toBeLessThan(FIT.minReadable)
  })

  it('sample5 @2400x1200: 最初に届いた d = 1 を採り、d = 0 まで畳まない', async () => {
    const { topIds, containers, ctx, full } = await setup(deepFlow)
    const ids = await pickAutoCollapse(topIds, containers, ctx, full, 2400, 1200)
    expect(new Set(ids!)).toEqual(depthCut(containers, 1))
    expect(await rawScaleWith(topIds, ctx, depthCut(containers, 2), 2400, 1200)).toBeLessThan(FIT.minReadable)
  })

  it('sample3 @4000x2000: 深さ ≥ 1 で届く', async () => {
    const { topIds, containers, ctx, full } = await setup(sampleFlow)
    const ids = await pickAutoCollapse(topIds, containers, ctx, full, 4000, 2000)
    expect(new Set(ids!)).toEqual(depthCut(containers, 1))
  })

  it('sample3 @1440x860: どの d でも届かないので全コンテナ（d = 0）を返す', async () => {
    const { topIds, containers, ctx, full } = await setup(sampleFlow)
    const ids = await pickAutoCollapse(topIds, containers, ctx, full, 1440, 860)
    expect(new Set(ids!)).toEqual(depthCut(containers, 0))
    // 全部畳んでも下限に届かない。残りは fitViewport の下限（0.85 + 左寄せ + パン）が受け持つ
    expect(await rawScaleWith(topIds, ctx, new Set(ids!), 1440, 860)).toBeLessThan(FIT.minReadable)
  })

  it('コンテナが無ければ null（畳むものがない）', async () => {
    const { topIds, ctx, full } = await setup(sampleFlow)
    await expect(pickAutoCollapse(topIds, [], ctx, full, 320, 200)).resolves.toBeNull()
  })
})

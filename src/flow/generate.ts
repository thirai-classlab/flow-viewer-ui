/**
 * 任意の階層数の業務フローを生成する。
 *
 * 固定のサンプル（3 階層 / 5 階層）では「何階層まで耐えるか」を検証できないため、
 * 深さ・分岐数を指定して生成できるようにした。
 *
 * 生成されるフローは、実測で意味を持つよう以下の性質を必ず持つ:
 *   - 各階層に「順路」がある（子を順に繋ぐ）
 *   - 分岐（decision）が混ざる
 *   - **階層を大きくまたぐ例外遷移**（差し戻し・謝絶）が入る
 *     → これがドリルダウン型で「画面外へ出る線」になる条件
 *   - 最下層に並列 → 合流がある
 *     → hasUniformExternalConnectivity が効く条件
 */

import type { FlowDoc, FlowStep, FlowLink, StepKind } from './schema'

export type GenerateOptions = {
  /** 階層数。1 ならフラット、5 なら 5 段のネスト */
  depth: number
  /**
   * 各グループが持つ子グループの数。
   * 指定しなければ深さに応じて自動調整する（上位は広く、下位は狭く）。
   * ノード数は概ね branching^depth で増えるので、深いときは自動側に任せるのが安全。
   */
  branching?: number
  /** 最下層のグループが持つタスク数 */
  leavesPerGroup?: number
  /** 階層をまたぐ例外遷移の本数 */
  crossLinks?: number
}

/** 階層ごとの呼び名。足りなくなったら「レベル N」にフォールバックする */
const LEVEL_NAMES = ['プロセス', '部門', '業務', '工程', '手順', '操作', '細目', '要素', '項目']

const levelName = (level: number) => LEVEL_NAMES[level] ?? `レベル${level + 1}`

/**
 * 深さに応じた既定の分岐数。
 *
 * 一律 2 分岐にするとノード数が 2^depth で爆発する（10 階層で 1 万ノード超を実測）。
 * 検証したいのは「深さに耐えるか」であってノード数ではないので、
 * 深いときは中間を一本道にして、最下層の 2 段だけ枝を残す。
 */
function defaultBranching(level: number, depth: number): number {
  if (depth <= 3) return 3
  if (depth <= 4) return 2
  // 5 階層以上: 最下層 2 段だけ枝分かれさせ、中間は一本道にして総数を抑える。
  // こうしないと深さごとにノード数が乱高下する（一律 2 分岐だと 5 階層 120 / 6 階層 39 と逆転した）。
  return level >= depth - 3 ? 2 : 1
}

export function generateFlow(opts: GenerateOptions): FlowDoc {
  const depth = Math.max(1, Math.min(12, Math.floor(opts.depth)))
  const leavesPerGroup = opts.leavesPerGroup ?? 3
  const links: FlowLink[] = []

  /** 各階層の「最初の葉」「最後の葉」を覚えておき、階層間の順路を繋ぐのに使う */
  type Built = { step: FlowStep; firstLeaf: string; lastLeaf: string; allLeaves: string[] }

  let seq = 0
  const nextId = (prefix: string) => `${prefix}${seq++}`

  const buildGroup = (level: number, path: string): Built => {
    const id = nextId('g')
    const label = `${levelName(level)}${path}`

    // 最下層のグループ。ここが葉（タスク）を直接持つ。
    //
    // 「3 階層 = 部門 → 業務 → 手順」なら、グループは部門(0)・業務(1) の 2 段で、
    // 手順は葉として depth-1 段目に来る。よって葉を持つのは level === depth - 2。
    if (level >= depth - 2) {
      const children: FlowStep[] = []
      const leaves: string[] = []
      for (let i = 0; i < leavesPerGroup; i++) {
        const leafId = nextId('t')
        // 真ん中の 1 つを分岐にして、フローらしい形にする
        const kind: StepKind = i === 1 && leavesPerGroup >= 3 ? 'decision' : 'task'
        children.push({
          id: leafId,
          label: kind === 'decision' ? `${label} 判定` : `${label} 作業${i + 1}`,
          kind,
          meta: { owner: `${levelName(Math.max(0, level - 1))}担当`, sla: `${(i + 1) * 10} 分` },
        })
        leaves.push(leafId)
      }
      // 最下層の順路
      for (let i = 0; i + 1 < leaves.length; i++) {
        links.push({ from: leaves[i], to: leaves[i + 1] })
      }
      return {
        step: { id, label, kind: 'group', children, meta: { owner: `${levelName(level)}チーム` } },
        firstLeaf: leaves[0],
        lastLeaf: leaves[leaves.length - 1],
        allLeaves: leaves,
      }
    }

    // 中間層: 子グループを持つ
    const n = opts.branching ?? defaultBranching(level, depth)
    const children: FlowStep[] = []
    const builts: Built[] = []
    for (let i = 0; i < n; i++) {
      const b = buildGroup(level + 1, `${path}-${i + 1}`)
      children.push(b.step)
      builts.push(b)
    }
    // 子グループ同士を順路で繋ぐ（前の子の最後の葉 → 次の子の最初の葉）
    for (let i = 0; i + 1 < builts.length; i++) {
      links.push({ from: builts[i].lastLeaf, to: builts[i + 1].firstLeaf })
    }
    return {
      step: { id, label, kind: 'group', children, meta: { owner: `${levelName(level)}チーム` } },
      firstLeaf: builts[0].firstLeaf,
      lastLeaf: builts[builts.length - 1].lastLeaf,
      allLeaves: builts.flatMap((b) => b.allLeaves),
    }
  }

  // depth === 1 はグループを作らず、トップレベルにタスクだけ並べる（完全にフラット）
  if (depth === 1) {
    const leaves: FlowStep[] = []
    const ids: string[] = []
    for (let i = 0; i < leavesPerGroup * 3; i++) {
      const leafId = nextId('t')
      const kind: StepKind = i % 4 === 2 ? 'decision' : 'task'
      leaves.push({
        id: leafId,
        label: kind === 'decision' ? `判定${i + 1}` : `作業${i + 1}`,
        kind,
      })
      ids.push(leafId)
    }
    for (let i = 0; i + 1 < ids.length; i++) links.push({ from: ids[i], to: ids[i + 1] })
    links.push({ from: 'start', to: ids[0] })
    links.push({ from: ids[ids.length - 1], to: 'end' })
    links.push({ from: ids[2], to: 'end-reject', label: 'NG', kind: 'exception' })
    if (ids.length > 4) {
      links.push({ from: ids[ids.length - 2], to: ids[1], label: '差し戻し', kind: 'loopback' })
    }
    return {
      id: 'generated-d1',
      title: '自動生成フロー（1 階層）',
      description: '階層なしのフラットなフロー。階層機能を一切使わない場合の基準。',
      root: [
        { id: 'start', label: '申込発生', kind: 'start' },
        ...leaves,
        { id: 'end', label: '完了', kind: 'end' },
        { id: 'end-reject', label: '謝絶', kind: 'end' },
      ],
      links,
    }
  }

  // トップレベルは 3 つのグループ（受注 / 手配 / 完了 に相当）
  const topCount = 3
  const tops: Built[] = []
  for (let i = 0; i < topCount; i++) {
    tops.push(buildGroup(0, `${i + 1}`))
  }
  for (let i = 0; i + 1 < tops.length; i++) {
    links.push({ from: tops[i].lastLeaf, to: tops[i + 1].firstLeaf })
  }

  const start: FlowStep = { id: 'start', label: '申込発生', kind: 'start' }
  const end: FlowStep = { id: 'end', label: '完了', kind: 'end' }
  const reject: FlowStep = { id: 'end-reject', label: '謝絶', kind: 'end' }

  links.push({ from: 'start', to: tops[0].firstLeaf })
  links.push({ from: tops[tops.length - 1].lastLeaf, to: 'end' })

  // --- 階層をまたぐ例外遷移 ---
  // これがドリルダウン型で「画面外へ出る線」になる条件。必ず入れる。
  const allLeaves = tops.flatMap((t) => t.allLeaves)
  const crossCount = opts.crossLinks ?? Math.max(3, depth)
  for (let i = 0; i < crossCount && allLeaves.length > 4; i++) {
    // 後ろのほうの葉から前のほうの葉へ戻す（差し戻し）
    const fromIdx = Math.floor(allLeaves.length * (0.5 + (i % 4) * 0.12))
    const toIdx = Math.floor(allLeaves.length * (0.05 + (i % 3) * 0.1))
    const from = allLeaves[Math.min(fromIdx, allLeaves.length - 1)]
    const to = allLeaves[Math.min(toIdx, allLeaves.length - 1)]
    if (from !== to) {
      links.push({ from, to, label: '差し戻し', kind: 'loopback' })
    }
  }
  // 謝絶（最上位の終端へ飛ぶ例外）
  if (allLeaves.length > 2) {
    links.push({
      from: allLeaves[Math.floor(allLeaves.length * 0.3)],
      to: 'end-reject',
      label: 'NG',
      kind: 'exception',
    })
  }
  // 途中から完了へ直行（プロセスを飛ばす例外）
  if (allLeaves.length > 6) {
    links.push({
      from: allLeaves[2],
      to: allLeaves[allLeaves.length - 2],
      label: '短絡',
      kind: 'exception',
    })
  }

  return {
    id: `generated-d${depth}`,
    title: `自動生成フロー（${depth} 階層）`,
    description: `深さ ${depth} / 各階層の呼び名: ${Array.from({ length: depth }, (_, i) => levelName(i)).join(' → ')}`,
    root: [start, ...tops.map((t) => t.step), end, reject],
    links,
  }
}

/** 生成結果の規模を測る。UI に出して「重すぎないか」を判断するのに使う */
export function measureFlow(doc: FlowDoc): {
  nodes: number
  groups: number
  leaves: number
  links: number
  maxDepth: number
} {
  let nodes = 0
  let groups = 0
  let leaves = 0
  let maxDepth = 0
  const walk = (steps: readonly FlowStep[], d: number) => {
    for (const s of steps) {
      nodes++
      maxDepth = Math.max(maxDepth, d)
      if (s.children?.length) {
        groups++
        walk(s.children, d + 1)
      } else {
        leaves++
      }
    }
  }
  walk(doc.root, 0)
  return { nodes, groups, leaves, links: doc.links.length, maxDepth: maxDepth + 1 }
}

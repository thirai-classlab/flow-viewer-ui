/**
 * 規模カテゴリのテストケース。
 *
 * 狙いは「どこで破綻するか」を段階的に測ること。
 * 150 → 400 → 900 とノード数だけを上げていく系列に加えて、
 * **同じノード数でも形が違うと破綻点が変わる**ことを見るための
 * 対照ケース（単一巨大グループ / 多グループ / エッジ密）を並べてある。
 *
 * 設計上の分離:
 *   - scale-mid-150 / scale-large-400 / scale-huge-900
 *       → ノード数だけを変える。階層形状は近い。純粋なスケール曲線を取る。
 *   - scale-wide-single-group
 *       → ノード数は 104 と小さいが、1 グループに 100 個フラットに入っている。
 *         「総数」ではなく「1 コンテナ内の要素数」が効くかを切り分ける。
 *   - scale-many-small-groups
 *       → 同じ 300 ノードでもコンテナが 60 個ある。コンテナ数のコストを切り分ける。
 *   - scale-edge-dense
 *       → ノードを 187 に固定したままエッジだけ 3 倍以上にする。
 *         ボトルネックがノード描画かエッジルーティングかを切り分ける。
 *
 * ラベルはすべて業務フローらしい語彙で生成する（「ノード001」ではなく「照合001」）。
 * 生成は決定的（seed 付き LCG）なので、実測値が再現する。
 */

import type { FlowDoc, FlowLink, FlowStep, StepKind } from '../schema'
import type { TestCase } from './types'

// ---------------------------------------------------------------------------
// 語彙（業務フローらしさを担保する）
// ---------------------------------------------------------------------------

/** 階層 0（部門レベル）の呼び名 */
const UNIT_NAMES = [
  '受付センター',
  '与信審査部',
  '手配オペレーション',
  '開通管理部',
  '請求精算部',
  '品質保証部',
  '契約管理部',
  'カスタマーサクセス部',
] as const

/** 階層 1（業務レベル）の呼び名 */
const PROCESS_NAMES = [
  '申込照合',
  '書類点検',
  '与信照会',
  '各社申込',
  '日程調整',
  '工事管理',
  '開通確認',
  '請求計上',
  '入金消込',
  '解約受付',
  '苦情対応',
  'データ移行',
] as const

/** 階層 2 以降（工程レベル）の呼び名 */
const STAGE_NAMES = [
  '一次処理',
  '二次処理',
  '外部連携',
  '内部承認',
  '記録更新',
  '例外処理',
  '再照会',
  '締め処理',
] as const

/** 葉（手順レベル）の動詞。`照合001` のように連番を付けて使う */
const LEAF_VERBS = [
  '照合',
  '起票',
  '点検',
  '照会',
  '入力',
  '承認',
  '送信',
  '受領',
  '登録',
  '通知',
  '確認',
  '転記',
  '集計',
  '是正',
  '督促',
  '回収',
] as const

const SYSTEMS = [
  'CRM',
  '基幹システム',
  '電力会社 Web',
  'ガス会社 EDI',
  '自治体窓口',
  'ISP API',
  '会計 SaaS',
  'RPA 実行基盤',
] as const

const LEVEL_POOLS: readonly (readonly string[])[] = [UNIT_NAMES, PROCESS_NAMES, STAGE_NAMES]

const pad3 = (n: number) => String(n).padStart(3, '0')

/** 決定的な擬似乱数（線形合同法）。seed を固定して実測値の再現性を担保する */
function makeRng(seed: number): () => number {
  let s = (seed >>> 0) || 1
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) >>> 0
    return s / 0x1_0000_0000
  }
}

// ---------------------------------------------------------------------------
// 階層ジェネレータ
// ---------------------------------------------------------------------------

type HierarchyOptions = {
  /** id の接頭辞。ケース間で衝突させないため必須 */
  prefix: string
  /**
   * 各階層のファンアウト。末尾要素が「最下層グループが持つ葉の数」。
   * 例: [4, 4, 8] = 部門 4 → 業務 4 → 手順 8（グループ 20 / 葉 128）
   */
  fanout: number[]
  /**
   * 最下層の葉の数を可変にしたいときのサイクル。
   * 指定すると fanout の末尾要素の代わりに、グループ出現順にこの配列を巡回して使う。
   */
  leafCountCycle?: number[]
  /** 何個おきに decision を混ぜるか（グループ内インデックス基準） */
  decisionEvery?: number
}

type Hierarchy = {
  groups: FlowStep[]
  /** ドキュメント順（＝主フローの順路順）に並んだ葉の id */
  leafIds: string[]
  /** decision になった葉の id */
  decisionIds: string[]
}

/**
 * ファンアウト指定でネスト構造を組み立てる。
 * 葉の並び順 = 深さ優先順なので、そのまま主フローの順路として鎖状に繋げる。
 */
function buildHierarchy(opts: HierarchyOptions): Hierarchy {
  const { prefix, fanout, leafCountCycle } = opts
  const decisionEvery = opts.decisionEvery ?? 5

  const leafIds: string[] = []
  const decisionIds: string[] = []
  let groupSeq = 0
  let leafSeq = 0
  let leafGroupSeq = 0

  const groupLabel = (level: number, path: number[]): string => {
    const pool = LEVEL_POOLS[Math.min(level, LEVEL_POOLS.length - 1)]
    const name = pool[(path[path.length - 1] - 1 + level) % pool.length]
    return level === 0 ? name : `${name} ${path.join('-')}`
  }

  const buildLeaves = (count: number, path: number[], unit: string): FlowStep[] => {
    const out: FlowStep[] = []
    for (let i = 0; i < count; i++) {
      leafSeq++
      const id = `${prefix}-t${leafSeq}`
      const kind: StepKind = i % decisionEvery === decisionEvery - 2 ? 'decision' : 'task'
      const verb = LEAF_VERBS[leafSeq % LEAF_VERBS.length]
      out.push({
        id,
        label: kind === 'decision' ? `${verb}判定${pad3(leafSeq)}` : `${verb}${pad3(leafSeq)}`,
        kind,
        meta: {
          owner: unit,
          system: SYSTEMS[(leafSeq + path.length) % SYSTEMS.length],
          sla: `${((leafSeq % 6) + 1) * 10} 分`,
        },
      })
      leafIds.push(id)
      if (kind === 'decision') decisionIds.push(id)
    }
    return out
  }

  const buildLevel = (level: number, path: number[], unit: string): FlowStep[] => {
    const isLeafLevel = level === fanout.length - 1
    if (isLeafLevel) {
      const count = leafCountCycle
        ? leafCountCycle[leafGroupSeq++ % leafCountCycle.length]
        : fanout[level]
      return buildLeaves(count, path, unit)
    }

    const out: FlowStep[] = []
    for (let i = 0; i < fanout[level]; i++) {
      const childPath = [...path, i + 1]
      groupSeq++
      const label = groupLabel(level, childPath)
      const nextUnit = level === 0 ? label : unit
      out.push({
        id: `${prefix}-g${groupSeq}`,
        label,
        kind: 'group',
        children: buildLevel(level + 1, childPath, nextUnit),
        meta: { owner: nextUnit, sla: level === 0 ? '2 営業日' : '4 時間' },
      })
    }
    return out
  }

  return { groups: buildLevel(0, [], UNIT_NAMES[0]), leafIds, decisionIds }
}

// ---------------------------------------------------------------------------
// 配線
// ---------------------------------------------------------------------------

type WireOptions = {
  leafIds: string[]
  decisionIds: string[]
  /** 何本おきに差し戻し（loopback）を入れるか。0 なら入れない */
  loopbackEvery?: number
  /** 追加で張る階層またぎのエッジ本数（エッジ密ケース用） */
  extraCross?: number
  seed: number
}

const START_ID = 'flow-start'
const END_ID = 'flow-end'
const REJECT_ID = 'flow-reject'

/**
 * 葉の列を主フローとして鎖状に繋ぎ、分岐・差し戻し・例外を足す。
 * from/to は必ず leafIds か start/end/reject のいずれかなので参照エラーは構造的に起きない。
 */
function wireLinks(opts: WireOptions): FlowLink[] {
  const { leafIds, decisionIds } = opts
  const loopbackEvery = opts.loopbackEvery ?? 0
  const extraCross = opts.extraCross ?? 0
  const n = leafIds.length
  const links: FlowLink[] = []
  const seen = new Set<string>()

  const push = (link: FlowLink) => {
    if (link.from === link.to) return
    const key = `${link.from}>${link.to}`
    if (seen.has(key)) return
    seen.add(key)
    links.push(link)
  }

  // 主フロー（深さ優先順にそのまま繋ぐ）
  push({ from: START_ID, to: leafIds[0] })
  for (let i = 0; i + 1 < n; i++) push({ from: leafIds[i], to: leafIds[i + 1] })
  push({ from: leafIds[n - 1], to: END_ID })

  // 分岐: decision には必ず 2 本目の出口を作る
  const indexOf = new Map(leafIds.map((id, i) => [id, i]))
  decisionIds.forEach((id, k) => {
    const i = indexOf.get(id) ?? 0
    if (k % 6 === 5) {
      push({ from: id, to: REJECT_ID, label: 'NG', kind: 'exception' })
      return
    }
    const jump = Math.min(i + 3 + (k % 4), n - 1)
    push({ from: id, to: leafIds[jump], label: 'スキップ', kind: 'exception' })
  })

  // 差し戻し: 後ろの葉から前の葉へ。階層をまたぐので折りたたみ時の集約対象になる
  if (loopbackEvery > 0) {
    for (let i = loopbackEvery; i < n; i += loopbackEvery) {
      const back = Math.max(0, i - Math.floor(loopbackEvery * 1.7))
      push({ from: leafIds[i], to: leafIds[back], label: '差し戻し', kind: 'loopback' })
    }
  }

  // 追加の階層またぎエッジ（エッジ密ケースでのみ使う）
  if (extraCross > 0 && n > 8) {
    const rng = makeRng(opts.seed)
    for (let k = 0; k < extraCross; k++) {
      const a = Math.floor(rng() * n)
      const spread = 4 + Math.floor(rng() * (n / 2))
      const b = (a + spread) % n
      const forward = a < b
      push({
        from: leafIds[forward ? a : b],
        to: leafIds[forward ? b : a],
        label: forward ? '併走' : '再処理',
        kind: forward ? 'exception' : 'loopback',
      })
    }
  }

  return links
}

// ---------------------------------------------------------------------------
// ドキュメント組み立て
// ---------------------------------------------------------------------------

type DocOptions = HierarchyOptions & {
  id: string
  title: string
  description: string
  loopbackEvery?: number
  extraCross?: number
  seed: number
}

function buildScaleDoc(opts: DocOptions): FlowDoc {
  const { groups, leafIds, decisionIds } = buildHierarchy(opts)
  const links = wireLinks({
    leafIds,
    decisionIds,
    loopbackEvery: opts.loopbackEvery,
    extraCross: opts.extraCross,
    seed: opts.seed,
  })
  const root: FlowStep[] = [
    { id: START_ID, label: '申込発生', kind: 'start' },
    ...groups,
    { id: END_ID, label: '開通完了', kind: 'end' },
    { id: REJECT_ID, label: '謝絶', kind: 'end', meta: { note: '与信 NG・要件不適合による終了' } },
  ]
  return { id: opts.id, title: opts.title, description: opts.description, root, links }
}

// ---------------------------------------------------------------------------
// ケース定義
// ---------------------------------------------------------------------------

export const scaleCases: TestCase[] = [
  {
    id: 'scale-mid-150',
    label: '中規模 150',
    purpose:
      'ノード約 150 / 3 階層（部門 4 → 業務 16 → 手順 128）。全ライブラリが問題なく描けるはずの基準点で、以降のスケール曲線の原点として使う。ここで既に体感差が出るならそのライブラリは実務規模に届かない。',
    stress: ['scale', 'realistic'],
    expectation:
      '150 ノードなら DOM 系（React Flow / X6 / LogicFlow）も Canvas 系（Cytoscape / G6）も 1 秒以内で描けるはず。差が出るとすればレイアウト計算側で、ELK を使う React Flow と bpmn-js の自動レイアウトが初回だけ 300ms 程度遅れると予想。Mermaid は文字列生成 + dagre-d3 なので中規模までは互角のはず。',
    doc: buildScaleDoc({
      id: 'scale-mid-150',
      title: '規模検証: 中規模（約 150 ノード / 3 階層）',
      description: '部門 4 × 業務 4 × 手順 8。スケール計測系列の原点。',
      prefix: 'sm',
      fanout: [4, 4, 8],
      loopbackEvery: 17,
      seed: 1501,
    }),
  },

  {
    id: 'scale-large-400',
    label: '大規模 400',
    purpose:
      'ノード約 400 / 4 階層（部門 4 → 業務 12 → 工程 48 → 手順 336）。実務の「全社業務フロー 1 本」に相当する現実的な上限規模で、ここが実用ラインに乗るかどうかを判定する。',
    stress: ['scale', 'hierarchy-depth', 'realistic'],
    expectation:
      'Canvas 系（Cytoscape / G6）は 400 ノードでも 60fps を維持するはず。DOM 系は React Flow が仮想化のおかげで耐え、X6 と LogicFlow はパン／ズーム時にカクつき始めると予想。SVG 系は maxGraph が健闘し、bpmn-js は BPMN 要素へのマッピングコストで初回描画が最も遅くなるはず。Mermaid はこのあたりから再描画が全再生成になり、体感で最も遅くなると予想。',
    doc: buildScaleDoc({
      id: 'scale-large-400',
      title: '規模検証: 大規模（約 400 ノード / 4 階層）',
      description: '部門 4 × 業務 3 × 工程 4 × 手順 7。実務上限に近い規模。',
      prefix: 'sl',
      fanout: [4, 3, 4, 7],
      loopbackEvery: 29,
      seed: 4001,
    }),
  },

  {
    id: 'scale-huge-900',
    label: '超大規模 900（重い）',
    purpose:
      '【重い・全ライブラリ同時に開かないこと】ノード約 900 / 4 階層。ブラウザが固まる可能性があるので 1 ライブラリずつ開いて計測する。どのレンダラ方式がどこで破綻するかの限界点を取るためのケース。',
    stress: ['scale', 'hierarchy-depth', 'edge-routing'],
    expectation:
      'Canvas 系（Cytoscape / G6）だけが実用的に動き、DOM 系（React Flow / X6 / tldraw 系）は DOM ノード数が数千に達してパン／ズームが 1fps 台まで落ちると予想。SVG 系（maxGraph / JointJS / LogicFlow / bpmn-js）はその中間で、初回描画は通るがインタラクションが重くなるはず。Mermaid はレイアウト計算（dagre）が数秒〜十数秒かかるか、そもそも描き切れずタイムアウトする可能性が高い。',
    doc: buildScaleDoc({
      id: 'scale-huge-900',
      title: '規模検証: 超大規模（約 900 ノード / 4 階層）※重い',
      description: '部門 6 × 業務 4 × 工程 4 × 手順 8。破綻点の測定用。',
      prefix: 'sh',
      fanout: [6, 4, 4, 8],
      loopbackEvery: 61,
      seed: 9001,
    }),
  },

  {
    id: 'scale-wide-single-group',
    label: '単一G 100 並列',
    purpose:
      '総ノードは約 104 と小さいのに、1 つのグループだけに手順 100 個をフラットに詰めた形。「総ノード数」ではなく「1 コンテナ内の要素数」がレイアウトコストを決めているのかを切り分ける。',
    stress: ['scale', 'hierarchy-width', 'layout-width'],
    expectation:
      '総数が小さいので描画自体はどこも速いはずだが、コンテナのサイズ計算で差が出ると予想。React Flow の親ノード自動リサイズ、X6 / LogicFlow のグループ矩形計算、bpmn-js の Participant 幅計算がここで破綻しやすい。Cytoscape の compound node は子 100 個でも親矩形を一発で出せるので有利なはず。maxGraph は swimlane 幅が固定寄りなので、子がはみ出す描画になる可能性がある。',
    doc: buildScaleDoc({
      id: 'scale-wide-single-group',
      title: '規模検証: 単一グループに 100 手順',
      description: 'グループ 1 個に手順 100 個。浅いが 1 画面の要素数が多い形。',
      prefix: 'sw',
      fanout: [1, 100],
      decisionEvery: 8,
      loopbackEvery: 13,
      seed: 1001,
    }),
  },

  {
    id: 'scale-many-small-groups',
    label: '多グループ 60',
    purpose:
      '手順 3〜5 個の小さなグループを 60 個並べた約 300 ノード。ノード総数は大規模ケースより少ないのにコンテナが 60 個ある。コンテナ数そのものがレイアウトコストになるかを切り分ける。',
    stress: ['scale', 'hierarchy-width', 'layout-width'],
    expectation:
      'ノード数だけ見れば軽いはずだが、コンテナ単位で再帰レイアウトを回す実装（ELK の hierarchical layout を使う React Flow、G6 の combo レイアウト）はコンテナ数に比例して遅くなると予想。逆にコンテナを単なる矩形として扱う Cytoscape の compound や JointJS の Element embedding は影響が小さいはず。Mermaid の subgraph は 60 個並ぶと横幅が発散してビューポートに収まらなくなると予想。',
    doc: buildScaleDoc({
      id: 'scale-many-small-groups',
      title: '規模検証: 小グループ 60 個',
      description: '手順 3〜5 個のグループを 60 個。コンテナ数のコストを測る。',
      prefix: 'sg',
      fanout: [60, 4],
      leafCountCycle: [3, 4, 5, 4],
      decisionEvery: 4,
      loopbackEvery: 23,
      seed: 6001,
    }),
  },

  {
    id: 'scale-edge-dense',
    label: 'エッジ密 187n',
    purpose:
      'ノードを約 187 個に固定したまま、エッジだけを 600 本前後（ノード数の 3 倍超）に増やした対照ケース。中規模 150 と比べることで、ボトルネックがノード描画側かエッジのルーティング計算側かを切り分ける。',
    stress: ['scale', 'edge-routing', 'edge-aggregation'],
    expectation:
      '中規模 150 とほぼ同じノード数なので、ここで大きく遅くなるライブラリはエッジ側がボトルネック。直交ルーティングで障害物回避を行う maxGraph / JointJS / X6 が最も遅くなると予想。ベジェをそのまま引く React Flow と Cytoscape は影響が小さいはず。bpmn-js はシーケンスフローごとに waypoint を計算するので中間。折りたたみ時のエッジ集約（600 本 → 数十本）が効くかどうかもここで観察できる。',
    doc: buildScaleDoc({
      id: 'scale-edge-dense',
      title: '規模検証: エッジ密（ノード約 187 / エッジ約 600）',
      description: '部門 4 × 業務 5 × 手順 8。ノードを据え置きエッジだけ 3 倍にした対照。',
      prefix: 'se',
      fanout: [4, 5, 8],
      decisionEvery: 5,
      loopbackEvery: 7,
      extraCross: 420,
      seed: 6187,
    }),
  },
]

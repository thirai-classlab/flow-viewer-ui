/**
 * 構造的エッジケース — レイアウトエンジンの限界を突くテストデータ。
 *
 * 「大きい」「複雑」ではなく、**1 ケース 1 弱点** で設計している。
 * 各ケースは以下のどれか 1 つを極端にし、他の軸はわざと平凡にしてある。
 * そうしないと差が出たときに「どの軸が効いたのか」が切り分けられない。
 *
 *   1. 横幅（1 グループ 24 並列 → 折りたたみで N:1 集約されるか）
 *   2. 縦の長さ（一本道 45 ステップ → fitView の縮尺限界）
 *   3. エッジ密度（10 ノード / 40 リンク → ルーティング品質）
 *   4. 多重エッジ（同一ペアに kind 違い 5 本 → 平行エッジの分離）
 *   5. 階層の深さ（8 階層 / 各階層 2〜3 要素）
 *   6. 階層の幅（2 階層 / 1 グループ 40 ノード）
 *   7. ツリーの非対称性（1 枝だけ 7 階層、他は 1 階層）
 *   8. グループ境界の往復（2 グループを 10 回キャッチボール）
 *
 * 共通レイヤ側の性質メモ:
 *   - collapse.ts の rewriteEdges は `${source} ${target} ${kind}` をキーに集約する。
 *     つまり **kind が違う多重エッジは畳まれない**。ケース 4 はここを突く。
 *   - 両端が同じノードに解決されたエッジ（グループ内部で完結する線）は破棄される。
 *     ケース 6 / 8 はこの破棄量が極端になる形にしてある。
 */

import type { FlowDoc, FlowLink, FlowStep } from '../schema'
import type { TestCase } from './types'

// ---------------------------------------------------------------------------
// 1. 超横並列 — 1 グループに 24 並列、全部が同じ前後に繋がる
// ---------------------------------------------------------------------------

/**
 * 24 社の小売事業者名（架空）。
 * 実在社名を避けつつ、ラベル幅が現実的（8〜12 文字）になるようにしてある。
 */
const RETAILERS = [
  'あかつき電力',
  'みなと電力',
  'ひかり電力',
  'さくら電力',
  'かなで電力',
  'つばさ電力',
  'しおかぜ電力',
  'もみじ電力',
  'ふじさん電力',
  'あおば電力',
  'こもれび電力',
  'やまびこ電力',
  'なぎさ電力',
  'ほしぞら電力',
  'せせらぎ電力',
  'かがやき電力',
  'まきば電力',
  'ゆうひ電力',
  'あさひ電力',
  'ときわ電力',
  'みずうみ電力',
  'くもま電力',
  'はるかぜ電力',
  'ゆきしろ電力',
] as const

function buildWideParallel(): FlowDoc {
  const quoteIds = RETAILERS.map((_, i) => `wp-quote-${i + 1}`)
  const children: FlowStep[] = RETAILERS.map((name, i) => ({
    id: quoteIds[i],
    label: `${name} 料金照会`,
    kind: 'task',
    meta: { owner: '料金比較チーム', system: '各社見積 API', sla: '5 分' },
  }))

  const links: FlowLink[] = [
    { from: 'wp-start', to: 'wp-dec-target' },
    { from: 'wp-dec-target', to: 'wp-normalize', label: '比較対象外', kind: 'exception' },
    // 24 並列への一斉ファンアウト
    ...quoteIds.map<FlowLink>((id) => ({ from: 'wp-dec-target', to: id, label: '照会対象' })),
    // 24 並列から単一後続へのファンイン
    ...quoteIds.map<FlowLink>((id) => ({ from: id, to: 'wp-normalize' })),
    { from: 'wp-normalize', to: 'wp-select' },
    { from: 'wp-select', to: 'wp-end' },
  ]

  return {
    id: 'structural-wide-parallel',
    title: '電力小売 24 社 一括料金照会',
    description:
      '1 グループに 24 並列。全メンバーが「単一の前ノード」「単一の後ノード」だけに繋がる = 外部接続が完全に一様なので、折りたたみ時に 24 本 → 1 本へ畳めるはずの形。',
    root: [
      { id: 'wp-start', label: '比較依頼受付', kind: 'start' },
      {
        id: 'wp-dec-target',
        label: '比較対象か',
        kind: 'decision',
        meta: { note: '供給エリア内かどうかで 24 社照会に入るかを決める' },
      },
      {
        id: 'wp-quote-group',
        label: '一括料金照会',
        kind: 'group',
        meta: { owner: '料金比較チーム', sla: '15 分', note: '24 社に完全並列で照会' },
        children,
      },
      {
        id: 'wp-normalize',
        label: '料金体系の正規化',
        kind: 'task',
        meta: { system: '料金比較エンジン', sla: '3 分' },
      },
      { id: 'wp-select', label: '最安プラン選定', kind: 'task', meta: { owner: 'CS 担当' } },
      { id: 'wp-end', label: '提案書送付', kind: 'end' },
    ],
    links,
  }
}

// ---------------------------------------------------------------------------
// 2. 超直列 — 一本道 45 ステップ
// ---------------------------------------------------------------------------

/** 引越しライフライン開通の全工程を、わざと 1 手順も束ねずに並べたもの */
const SERIAL_STEPS = [
  '申込フォーム受信',
  '自動応答メール送信',
  '重複申込チェック',
  '顧客マスタ登録',
  '必須項目チェック',
  '住所正規化',
  '郵便番号照合',
  '建物種別判定',
  '入居日確認',
  '本人確認書類受領',
  '本人確認書類読取',
  '反社チェック',
  '信用情報照会',
  '与信スコア算定',
  '与信結果登録',
  '契約書ドラフト作成',
  '契約条件レビュー',
  '上長承認取得',
  '電子契約送信',
  '電子署名受領',
  '契約書保管',
  '供給地点特定番号取得',
  '電力小売申込送信',
  '電力受付番号記録',
  'ガス供給開始申込',
  'ガス開栓日調整',
  '水道使用開始届出',
  '下水道使用届出',
  '回線提供エリア判定',
  'ネット回線申込送信',
  '工事要否判定',
  '工事業者アサイン',
  '工事日程仮押さえ',
  '顧客への日程案内',
  '日程確定連絡',
  '前日リマインド送信',
  '当日立会手配',
  '開栓作業実施',
  '通電確認',
  '通信疎通確認',
  '作業報告書受領',
  '請求データ生成',
  '初回請求書発行',
  '完了通知送信',
  'アンケート依頼',
] as const

function buildLongSerial(): FlowDoc {
  const ids = SERIAL_STEPS.map((_, i) => `ls-${String(i + 1).padStart(2, '0')}`)
  const steps: FlowStep[] = SERIAL_STEPS.map((label, i) => ({
    id: ids[i],
    label,
    // 45 個すべて task にすると単調すぎるので、判定に相当する 3 手順だけ decision にする。
    // 分岐は作らない（一本道であることがこのケースの本体）。
    kind: i === 2 || i === 13 || i === 30 ? 'decision' : 'task',
    meta: { sla: `${(i % 6) + 1} 時間`, owner: i < 21 ? '受付センター' : '手配センター' },
  }))

  const links: FlowLink[] = [
    { from: 'ls-start', to: ids[0] },
    ...ids.slice(0, -1).map<FlowLink>((id, i) => ({ from: id, to: ids[i + 1] })),
    { from: ids[ids.length - 1], to: 'ls-end' },
  ]

  return {
    id: 'structural-long-serial',
    title: '開通オペレーション 45 手順（束ねない版）',
    description:
      '分岐も並列もない完全な一本道 45 ステップ。グルーピングを一切していないので、レイアウト方向の長さと fitView の縮尺だけが効く。',
    root: [{ id: 'ls-start', label: '申込発生', kind: 'start' }, ...steps, { id: 'ls-end', label: '完了', kind: 'end' }],
    links,
  }
}

// ---------------------------------------------------------------------------
// 3. 密結合 — 10 ノードに 40 リンク
// ---------------------------------------------------------------------------

const MESH_NODES = [
  { id: 'dm-recv', label: '一次受付' },
  { id: 'dm-triage', label: '内容切り分け' },
  { id: 'dm-tech', label: '技術調査' },
  { id: 'dm-field', label: '現地確認手配' },
  { id: 'dm-power', label: '電力会社照会' },
  { id: 'dm-gas', label: 'ガス会社照会' },
  { id: 'dm-legal', label: '法務確認' },
  { id: 'dm-approve', label: '上長判断' },
  { id: 'dm-contact', label: '顧客連絡' },
  { id: 'dm-record', label: '対応記録更新' },
] as const

/** 差し戻し（後ろ → 前）。距離 5 以上だけを選び、前進リンクと衝突しないようにしてある */
const MESH_BACK_EDGES: ReadonlyArray<readonly [number, number]> = [
  [9, 1],
  [8, 2],
  [7, 0],
  [9, 3],
  [6, 0],
  [8, 1],
  [7, 2],
  [9, 4],
]

function buildDenseMesh(): FlowDoc {
  const links: FlowLink[] = []

  // 前進リンク: 距離 4 以内の全ペア（= 30 本）。
  // 「隣だけ繋ぐ」でも「全結合」でもない中間の密度が、いちばんルーティング品質の差が出る。
  for (let i = 0; i < MESH_NODES.length; i++) {
    for (let j = i + 1; j < MESH_NODES.length && j - i <= 4; j++) {
      links.push({
        from: MESH_NODES[i].id,
        to: MESH_NODES[j].id,
        // 距離 4 の飛び越しだけ例外扱いにして、色分け時も交差が読めるかを見る
        kind: j - i === 4 ? 'exception' : 'normal',
        label: j - i === 1 ? undefined : `${j - i} 段飛ばし`,
      })
    }
  }

  // 差し戻しリンク（= 8 本）
  for (const [from, to] of MESH_BACK_EDGES) {
    links.push({
      from: MESH_NODES[from].id,
      to: MESH_NODES[to].id,
      label: '差し戻し',
      kind: 'loopback',
    })
  }

  links.push({ from: 'dm-start', to: MESH_NODES[0].id })
  links.push({ from: MESH_NODES[MESH_NODES.length - 1].id, to: 'dm-end' })

  return {
    id: 'structural-dense-mesh',
    title: 'クレーム一次対応の関係者間やり取り',
    description:
      '10 ノードに 40 リンク（前進 30 / 差し戻し 8 / 出入口 2）。ノード数は小さいまま、エッジ密度だけを N:N 近くまで上げてある。',
    root: [
      { id: 'dm-start', label: 'クレーム受信', kind: 'start' },
      {
        id: 'dm-room',
        label: 'クレーム対応室',
        kind: 'group',
        meta: { owner: 'カスタマーサポート', note: '10 名が相互に連絡を取り合う' },
        children: MESH_NODES.map<FlowStep>((n) => ({
          id: n.id,
          label: n.label,
          kind: 'task',
          meta: { owner: 'クレーム対応室' },
        })),
      },
      { id: 'dm-end', label: '対応完了', kind: 'end' },
    ],
    links,
  }
}

// ---------------------------------------------------------------------------
// 4. 多重エッジ — 同一ペアに複数リンク
// ---------------------------------------------------------------------------

function buildMultiEdge(): FlowDoc {
  const links: FlowLink[] = [
    { from: 'me-start', to: 'me-match' },

    // (A) 同一ペアに 5 本。kind は normal 2 / exception 1 / loopback 2。
    //     rewriteEdges のキーは (source, target, kind) なので、集約されても 3 本残るはず。
    { from: 'me-match', to: 'me-correct', label: '金額差異' },
    { from: 'me-match', to: 'me-correct', label: '名義差異' },
    { from: 'me-match', to: 'me-correct', label: '請求先誤り', kind: 'exception' },
    { from: 'me-match', to: 'me-correct', label: '再計算依頼', kind: 'loopback' },
    { from: 'me-match', to: 'me-correct', label: '月跨ぎ調整', kind: 'loopback' },

    // (B) 逆方向にも 2 本 = 双方向多重。両方向を同じ経路に描くライブラリだと重なる。
    { from: 'me-correct', to: 'me-match', label: '訂正完了' },
    { from: 'me-correct', to: 'me-match', label: '差額返金' },

    // (C) グループをまたぐ多重エッジ。両グループを畳むと group→group に 3 本残る。
    { from: 'me-correct', to: 'me-dunning', label: '督促保留' },
    { from: 'me-correct', to: 'me-dunning', label: '分割払い相談' },
    { from: 'me-correct', to: 'me-dunning', label: '債権譲渡', kind: 'exception' },
    { from: 'me-correct', to: 'me-dunning', label: '訂正取消', kind: 'loopback' },

    { from: 'me-correct', to: 'me-deposit' },

    // (D) 同一 kind だけ 3 本。ここは 1 本「3 件」に畳まれることを期待する。
    { from: 'me-deposit', to: 'me-dunning', label: '入金なし' },
    { from: 'me-deposit', to: 'me-dunning', label: '一部入金' },
    { from: 'me-deposit', to: 'me-dunning', label: '期日超過' },

    { from: 'me-dunning', to: 'me-deposit', label: '再照合', kind: 'loopback' },
    { from: 'me-dunning', to: 'me-end' },
  ]

  return {
    id: 'structural-multi-edge',
    title: '請求照合と督促のやり取り（多重エッジ）',
    description:
      '同一ノードペアに最大 5 本のリンク。kind 違い・同一 kind・逆方向・グループまたぎの 4 パターンを 1 枚に入れてある。',
    root: [
      { id: 'me-start', label: '締め処理開始', kind: 'start' },
      {
        id: 'me-billing-group',
        label: '請求管理',
        kind: 'group',
        meta: { owner: '経理', sla: '3 営業日' },
        children: [
          { id: 'me-match', label: '請求データ突合', kind: 'task', meta: { system: '請求管理システム' } },
          { id: 'me-correct', label: '請求訂正', kind: 'task', meta: { owner: '経理課長' } },
        ],
      },
      {
        id: 'me-collect-group',
        label: '入金管理',
        kind: 'group',
        meta: { owner: '債権管理', sla: '5 営業日' },
        children: [
          { id: 'me-deposit', label: '入金消込', kind: 'task', meta: { system: '銀行 API' } },
          { id: 'me-dunning', label: '督促', kind: 'task', meta: { sla: '期日 +3 日' } },
        ],
      },
      { id: 'me-end', label: '締め完了', kind: 'end' },
    ],
    links,
  }
}

// ---------------------------------------------------------------------------
// 5. 深い + 狭い — 8 階層 / 各階層 2〜3 要素
// ---------------------------------------------------------------------------

/** 稟議の階層。上から順に 7 段のグループを作り、8 段目に作業が来る */
const APPROVAL_LEVELS = [
  { id: 'dn-l1', group: '全社稟議', task: '全社稟議 決裁' },
  { id: 'dn-l2', group: '事業本部審査', task: '事業本部 内容確認' },
  { id: 'dn-l3', group: '部門審査', task: '部門 予算確認' },
  { id: 'dn-l4', group: '課内審査', task: '課内 見積確認' },
  { id: 'dn-l5', group: '係内確認', task: '係内 仕様確認' },
  { id: 'dn-l6', group: '班内確認', task: '班内 工数確認' },
  { id: 'dn-l7', group: '担当作業', task: '' },
] as const

const DEEP_LEAVES = ['起案書作成', '証跡添付', '申請送信'] as const

function buildDeepNarrow(): FlowDoc {
  // 最深の階層から積み上げる（子を作ってから親で包む）
  const leafIds = DEEP_LEAVES.map((_, i) => `dn-leaf-${i + 1}`)
  const last = APPROVAL_LEVELS[APPROVAL_LEVELS.length - 1]
  let current: FlowStep = {
    id: last.id,
    label: last.group,
    kind: 'group',
    meta: { owner: '起案担当', note: '8 階層目。ここだけ要素が 3 個' },
    children: DEEP_LEAVES.map<FlowStep>((label, i) => ({
      id: leafIds[i],
      label,
      kind: 'task',
      meta: { owner: '起案担当', sla: '30 分' },
    })),
  }

  const taskIds: string[] = []
  for (let i = APPROVAL_LEVELS.length - 2; i >= 0; i--) {
    const level = APPROVAL_LEVELS[i]
    const taskId = `${level.id}-task`
    taskIds.unshift(taskId)
    current = {
      id: level.id,
      label: level.group,
      kind: 'group',
      meta: { owner: level.group, sla: `${(i + 1) * 2} 営業日` },
      // 各階層の要素は「自分の確認作業 1 個 + 下位グループ 1 個」= 常に 2 個だけ。
      // 幅を意図的に殺して、深さ以外の負荷をゼロにしている。
      children: [
        {
          id: taskId,
          // 最上位だけ decision（差し戻すか決裁するか）
          label: level.task,
          kind: i === 0 ? 'decision' : 'task',
          meta: { owner: level.group },
        },
        current,
      ],
    }
  }

  // taskIds[0] = 最上位（全社稟議）… taskIds[5] = 最深に近い階層（班内確認）
  const links: FlowLink[] = [
    { from: 'dn-start', to: leafIds[0] },
    { from: leafIds[0], to: leafIds[1] },
    { from: leafIds[1], to: leafIds[2] },
    // 最深 → 最上位へ、1 段ずつ承認を上げていく（毎回 1 階層またぐ順路）
    { from: leafIds[2], to: taskIds[taskIds.length - 1], label: '申請' },
  ]
  for (let i = taskIds.length - 1; i > 0; i--) {
    links.push({ from: taskIds[i], to: taskIds[i - 1], label: '承認' })
  }
  links.push({ from: taskIds[0], to: 'dn-end', label: '決裁' })
  // 最上位から最深へ 8 階層をまたぐ差し戻し
  links.push({ from: taskIds[0], to: leafIds[0], label: '差し戻し', kind: 'loopback' })
  // 中間層（課内審査）からの却下。グループ外の終端へ飛ぶ
  links.push({ from: taskIds[3], to: 'dn-reject', label: '却下', kind: 'exception' })

  return {
    id: 'structural-deep-narrow',
    title: '8 段稟議（深いだけのフロー）',
    description:
      '8 階層のネスト。各階層の要素は常に 2 個（確認作業 1 + 下位グループ 1）、最下層だけ 3 個。幅・ノード数を極小に保ち、深さだけを負荷にしてある。',
    root: [
      { id: 'dn-start', label: '起案', kind: 'start' },
      current,
      { id: 'dn-end', label: '決裁完了', kind: 'end' },
      { id: 'dn-reject', label: '却下', kind: 'end', meta: { note: '課内審査での否決' } },
    ],
    links,
  }
}

// ---------------------------------------------------------------------------
// 6. 浅い + 広い — 2 階層 / 1 グループに 40 ノード
// ---------------------------------------------------------------------------

const LANES = ['電力', 'ガス', '水道', 'ネット', '電話', 'CATV', '火災保険', '鍵引渡'] as const
const LANE_STEPS = ['事前確認', '立会手配', '作業実施', '疎通確認', '報告登録'] as const

function buildShallowWide(): FlowDoc {
  const children: FlowStep[] = []
  const links: FlowLink[] = []
  const laneId = (lane: number, step: number) => `sw-l${lane + 1}-s${step + 1}`

  for (let lane = 0; lane < LANES.length; lane++) {
    for (let step = 0; step < LANE_STEPS.length; step++) {
      children.push({
        id: laneId(lane, step),
        label: `${LANES[lane]} ${LANE_STEPS[step]}`,
        kind: step === 3 ? 'decision' : 'task',
        meta: { owner: `${LANES[lane]}担当`, sla: `${(step + 1) * 20} 分` },
      })
      if (step > 0) links.push({ from: laneId(lane, step - 1), to: laneId(lane, step) })
    }
    // レーンの入口・出口（8 本ずつ）
    links.push({ from: 'sw-start', to: laneId(lane, 0) })
    links.push({ from: laneId(lane, LANE_STEPS.length - 1), to: 'sw-report' })
  }

  // 外部接続を「一様でない」状態にするための例外 2 本。
  // これがあるとグループを畳んでも 1 本には潰せない（= ケース 1 との対照）。
  links.push({ from: laneId(0, 2), to: 'sw-escalate', label: '通電不可', kind: 'exception' })
  links.push({ from: laneId(1, 2), to: 'sw-escalate', label: '開栓不可', kind: 'exception' })
  links.push({ from: 'sw-escalate', to: 'sw-report', label: '代替日程', kind: 'loopback' })
  links.push({ from: 'sw-report', to: 'sw-end' })

  return {
    id: 'structural-shallow-wide',
    title: '引越当日オペレーション 8 レーン',
    description:
      '2 階層しかないが、1 グループが 40 ノード（8 レーン × 5 手順）。グループ内部のレーン並列と、例外 2 本による「一様でない外部接続」を同時に持つ。',
    root: [
      { id: 'sw-start', label: '当日開始', kind: 'start' },
      {
        id: 'sw-onsite',
        label: '当日オペレーション',
        kind: 'group',
        meta: { owner: '当日運用センター', sla: '当日中', note: '8 レーンが同時進行' },
        children,
      },
      { id: 'sw-escalate', label: 'エスカレーション対応', kind: 'task', meta: { owner: 'SV' } },
      { id: 'sw-report', label: '完了報告集約', kind: 'task', meta: { system: '運用管理システム' } },
      { id: 'sw-end', label: '当日完了', kind: 'end' },
    ],
    links,
  }
}

// ---------------------------------------------------------------------------
// 7. 非対称ツリー — 1 枝だけ 7 階層、他は 1 階層
// ---------------------------------------------------------------------------

const SHALLOW_BRANCHES = [
  { id: 'at-recv', label: '受付', tasks: ['申込受信', '内容確認', '顧客登録'] },
  { id: 'at-contract', label: '契約', tasks: ['契約書作成', '電子署名', '契約保管'] },
  { id: 'at-billing', label: '請求', tasks: ['請求データ生成', '請求書発行'] },
  { id: 'at-after', label: 'アフター', tasks: ['開通確認', '完了通知', 'アンケート依頼'] },
] as const

const DEEP_BRANCH_LEVELS = [
  { id: 'at-cr1', group: '与信審査', task: '審査受付' },
  { id: 'at-cr2', group: '一次スクリーニング', task: '重複・反社チェック' },
  { id: 'at-cr3', group: '属性審査', task: '居住・就業属性確認' },
  { id: 'at-cr4', group: '信用情報照会', task: '外部信用情報取得' },
  { id: 'at-cr5', group: 'スコアリング', task: 'スコア算定' },
  { id: 'at-cr6', group: '例外判定', task: '例外条件突合' },
  { id: 'at-cr7', group: '最終決裁', task: '' },
] as const

function buildAsymmetricTree(): FlowDoc {
  const links: FlowLink[] = []

  const shallowGroups = SHALLOW_BRANCHES.map<FlowStep>((b) => ({
    id: b.id,
    label: b.label,
    kind: 'group',
    meta: { owner: `${b.label}チーム` },
    children: b.tasks.map<FlowStep>((label, i) => ({
      id: `${b.id}-t${i + 1}`,
      label,
      kind: 'task',
      meta: { owner: `${b.label}チーム`, sla: `${(i + 1) * 30} 分` },
    })),
  }))

  // 浅い枝の内部順路
  for (const b of SHALLOW_BRANCHES) {
    for (let i = 0; i + 1 < b.tasks.length; i++) {
      links.push({ from: `${b.id}-t${i + 1}`, to: `${b.id}-t${i + 2}` })
    }
  }

  // 深い枝: 7 段ネスト。最深にだけ 2 個の作業を置く
  const finalLevel = DEEP_BRANCH_LEVELS[DEEP_BRANCH_LEVELS.length - 1]
  let deep: FlowStep = {
    id: finalLevel.id,
    label: finalLevel.group,
    kind: 'group',
    meta: { owner: '審査役員', note: '7 階層目' },
    children: [
      { id: 'at-cr7-t1', label: '決裁根拠まとめ', kind: 'task', meta: { owner: '審査役員' } },
      { id: 'at-cr7-t2', label: '与信可否判定', kind: 'decision', meta: { owner: '審査役員' } },
    ],
  }
  const deepTaskIds: string[] = []
  for (let i = DEEP_BRANCH_LEVELS.length - 2; i >= 0; i--) {
    const level = DEEP_BRANCH_LEVELS[i]
    const taskId = `${level.id}-task`
    deepTaskIds.unshift(taskId)
    deep = {
      id: level.id,
      label: level.group,
      kind: 'group',
      meta: { owner: '審査チーム', sla: `${i + 1} 営業日` },
      children: [
        { id: taskId, label: level.task, kind: 'task', meta: { owner: '審査チーム' } },
        deep,
      ],
    }
  }

  // 深い枝の内部順路（上から下へ潜っていく）
  for (let i = 0; i + 1 < deepTaskIds.length; i++) {
    links.push({ from: deepTaskIds[i], to: deepTaskIds[i + 1] })
  }
  links.push({ from: deepTaskIds[deepTaskIds.length - 1], to: 'at-cr7-t1' })
  links.push({ from: 'at-cr7-t1', to: 'at-cr7-t2' })

  // 枝どうしの接続。浅い枝 → 7 階層の底 → 浅い枝、と潜って戻る形にする
  links.push({ from: 'at-start', to: 'at-recv-t1' })
  links.push({ from: 'at-recv-t3', to: deepTaskIds[0] })
  links.push({ from: 'at-cr7-t2', to: 'at-contract-t1', label: '可決' })
  links.push({ from: 'at-contract-t3', to: 'at-billing-t1' })
  links.push({ from: 'at-billing-t2', to: 'at-after-t1' })
  links.push({ from: 'at-after-t3', to: 'at-end' })

  // 7 階層の底から、1 階層の枝へ戻す差し戻し（パンくずと経路入れ子が効く線）
  links.push({ from: 'at-cr7-t2', to: 'at-recv-t2', label: '再確認依頼', kind: 'loopback' })
  links.push({ from: 'at-cr4-task', to: 'at-recv-t2', label: '書類不備', kind: 'loopback' })
  links.push({ from: 'at-cr7-t2', to: 'at-reject', label: '否決', kind: 'exception' })

  return {
    id: 'structural-asymmetric-tree',
    title: '与信だけ 7 階層の非対称フロー',
    description:
      '受付・契約・請求・アフターは 1 階層のまま、与信審査だけ 7 階層にネストしてある。ドリルダウンのパンくずと、左ペインの経路入れ子が極端に不均衡になる形。',
    root: [
      { id: 'at-start', label: '申込発生', kind: 'start' },
      shallowGroups[0],
      deep,
      shallowGroups[1],
      shallowGroups[2],
      shallowGroups[3],
      { id: 'at-end', label: '完了', kind: 'end' },
      { id: 'at-reject', label: '謝絶', kind: 'end' },
    ],
    links,
  }
}

// ---------------------------------------------------------------------------
// 8. グループ境界の往復 — 2 グループを 10 往復
// ---------------------------------------------------------------------------

const SALES_STEPS = [
  '初回ヒアリング',
  '概算見積提示',
  '現地調査依頼',
  '仕様すり合わせ',
  '本見積提示',
  '価格交渉',
  '契約条件確認',
  '着工日調整',
  '変更契約締結',
  '完了報告受領',
] as const

const WORKS_STEPS = [
  '現地調査実施',
  '調査報告作成',
  '施工方法検討',
  '積算算出',
  '工程表作成',
  '資材手配',
  '追加工事査定',
  '着工準備',
  '変更工程反映',
  '完工検査',
] as const

function buildInterleavedGroups(): FlowDoc {
  const salesIds = SALES_STEPS.map((_, i) => `ig-s${i + 1}`)
  const worksIds = WORKS_STEPS.map((_, i) => `ig-w${i + 1}`)
  const links: FlowLink[] = [{ from: 'ig-start', to: salesIds[0] }]

  // 営業 i → 工事 i → 営業 i+1 …と、グループ境界を 20 回またぐ
  for (let i = 0; i < salesIds.length; i++) {
    links.push({ from: salesIds[i], to: worksIds[i] })
    if (i + 1 < salesIds.length) links.push({ from: worksIds[i], to: salesIds[i + 1] })
  }
  links.push({ from: worksIds[worksIds.length - 1], to: 'ig-end' })
  // 往復の途中で 4 段戻る差し戻し（またぎ方向が逆になる線）
  links.push({ from: worksIds[6], to: salesIds[5], label: '追加費用の再交渉', kind: 'loopback' })
  links.push({ from: salesIds[8], to: worksIds[4], label: '工程やり直し', kind: 'loopback' })

  return {
    id: 'structural-interleaved-groups',
    title: '営業 ⇄ 工事の 10 往復',
    description:
      '2 グループの中身が交互に繋がり、順路がグループ境界を 20 回またぐ。グループ内部で完結するリンクが 1 本もないので、コンテナ矩形を重ねずに描けるかが問われる。',
    root: [
      { id: 'ig-start', label: '引合発生', kind: 'start' },
      {
        id: 'ig-sales',
        label: '営業部',
        kind: 'group',
        meta: { owner: '営業部', note: '工事部と交互に処理が行き来する' },
        children: SALES_STEPS.map<FlowStep>((label, i) => ({
          id: salesIds[i],
          label,
          kind: i === 5 ? 'decision' : 'task',
          meta: { owner: '営業担当', sla: `${i + 1} 営業日` },
        })),
      },
      {
        id: 'ig-works',
        label: '工事部',
        kind: 'group',
        meta: { owner: '工事部' },
        children: WORKS_STEPS.map<FlowStep>((label, i) => ({
          id: worksIds[i],
          label,
          kind: i === 6 ? 'decision' : 'task',
          meta: { owner: '工事担当', sla: `${i + 1} 営業日` },
        })),
      },
      { id: 'ig-end', label: '引渡完了', kind: 'end' },
    ],
    links,
  }
}

// ---------------------------------------------------------------------------
// エクスポート
// ---------------------------------------------------------------------------

export const structuralCases: TestCase[] = [
  {
    id: 'wide-parallel-24',
    label: '超横並列 24',
    purpose:
      '1 グループに 24 並列を入れ、全員が同じ前ノード・同じ後ノードだけに繋がる形にした。展開時の横幅の限界と、折りたたみ時にファンアウト 24 本 → 1 本・ファンイン 24 本 → 1 本へ集約できるかを見る。',
    stress: ['layout-width', 'edge-aggregation', 'hierarchy-width'],
    expectation:
      'ELK 系（React Flow + elkjs / Reaflow）は 24 並列を段組みできず横に一列で並べるはずで、コンテナ幅が数千 px になると予想。Mermaid は subgraph 内の並列を必ず 1 行に並べるので最悪。bpmn-js はレーン幅が固定なのでスクロール地獄になるはず。折りたたみ集約は共通レイヤ（rewriteEdges）が担うので N:1 に畳めるはずだが、AntV G6 は combo の端点解決を自前で持っているため二重集約でラベル「24 件」が出ない可能性がある。',
    doc: buildWideParallel(),
  },
  {
    id: 'long-serial-45',
    label: '超直列 45',
    purpose:
      '分岐も並列もない一本道 45 ステップ。縦（DOWN）／横（RIGHT）方向の長さだけを負荷にして、fitView の縮尺がどこまで落ちるか、何ステップでラベルが読めなくなるかの境界を測る。',
    stress: ['layout-height'],
    expectation:
      'レイアウト結果自体は全ライブラリで一致するはずなので、差が出るのは fitView / zoom 制御の実装。React Flow は minZoom 0.5 が既定なので 45 段だと画面に収まりきらず切れると予想。Cytoscape の fit はパディング計算が素直なので収まるが、ラベルが 0.1 倍以下になって読めなくなるはず。Mermaid は SVG を実サイズで吐くので縦に数千 px 伸びてスクロールになる。LogicFlow は自動 fit を持たないので初期表示で先頭しか見えないと予想。',
    doc: buildLongSerial(),
  },
  {
    id: 'dense-mesh-10x40',
    label: '密結合 10/40',
    purpose:
      '10 ノードに 40 リンク（距離 4 以内の全ペア 30 本 + 差し戻し 8 本 + 出入口 2 本）を張り、ノード数を増やさずにエッジ密度だけを N:N 近くまで上げた。エッジルーティングの品質差が最も出る形。',
    stress: ['edge-routing', 'cycles'],
    expectation:
      'JointJS の libavoid（直交回避ルーター）と AntV X6 の manhattan + jumpover がいちばんきれいに捌けるはず。React Flow の bezier は回避を一切しないのでノードの上を線が横断し、40 本が束になって読めなくなると予想。Cytoscape は unbundled-bezier で多少ばらけるが交差数は減らない。Mermaid はエッジ密度が上がると交差最小化を諦めて線が重なるはず。ELK の直交ルーティングは品質は高いが 40 本で計算時間が跳ねる可能性がある。',
    doc: buildDenseMesh(),
  },
  {
    id: 'multi-edge-pairs',
    label: '多重エッジ',
    purpose:
      '同一ノードペアに最大 5 本（normal 2 / exception 1 / loopback 2）、さらに逆方向 2 本・同一 kind 3 本・グループまたぎ 4 本を用意した。平行エッジを分離して描けるか、共通レイヤの (source, target, kind) 集約とライブラリ側の集約が二重にかからないかを見る。',
    stress: ['edge-aggregation', 'edge-routing'],
    expectation:
      'AntV G6 の process-parallel-edges（merge / bundle）が最もうまく捌くはずで、5 本が扇状に分離されると予想。React Flow は同一 source/target のエッジを完全に重ねて描くので 5 本が 1 本にしか見えないはず（ラベルだけ重なって潰れる）。Mermaid は平行エッジを分離できず線が重なる。bpmn-js は同一ペアの多重シーケンスフローを許すが、ウェイポイントが同一になり視覚的に区別できないと予想。逆方向 2 本（B）は Cytoscape の haystack だと完全に重なるはず。',
    doc: buildMultiEdge(),
  },
  {
    id: 'deep-narrow-8',
    label: '深い8階層',
    purpose:
      '8 階層のネストだが各階層の要素は 2 個（確認作業 1 + 下位グループ 1）だけ。幅とノード数を極小に保ち、階層の深さだけを負荷にした。最上位から最深への 8 階層またぎ差し戻しを 1 本含む。',
    stress: ['hierarchy-depth'],
    expectation:
      'ネスト対応が浅いライブラリで先に破綻するはず。React Flow の parentId は 8 段でも動くが、子の相対座標が段ごとに累積して padding がずれると予想。dagre は compound を正式サポートしないので 8 段で親矩形が子を包みきれないはず。ELK は 8 段のネストを再帰的に処理できるが計算時間が段数に対して非線形に伸びる可能性がある。Mermaid の subgraph は 8 段ネストで枠線の入れ子が視覚的に潰れるはず。LogicFlow / bpmn-js は 2〜3 段以上の入れ子を想定していないので、そもそも表現できない可能性が高い。8 階層またぎの差し戻しはドリルダウン時に「画面外へ出る線」になる。',
    doc: buildDeepNarrow(),
  },
  {
    id: 'shallow-wide-40',
    label: '浅い40幅',
    purpose:
      '2 階層しかないが 1 グループに 40 ノード（8 レーン × 5 手順）。ケース 1 と違って例外 2 本があるため外部接続が一様でなく、畳んでもエッジを 1 本には潰せない。1 グループの幅とコンテナ内レイアウトの限界を測る。',
    stress: ['hierarchy-width', 'layout-width', 'edge-aggregation'],
    expectation:
      'ELK の layered は 8 レーンをきれいに並べるはずだが、コンテナ幅の見積もりが甘いと親矩形が子をはみ出すと予想。Cytoscape の compound + dagre レイアウトは親のパディング計算が苦手なので、40 子ノードで枠がずれるはず。AntV G6 の combo は子のバウンディングボックス再計算が入るので描画が一拍遅れる可能性がある。折りたたみ時、ケース 1 は 1 本に畳めるがこのケースは例外 2 本のせいで 3 本残るはずで、その差が出るかが見どころ。Reaflow は 40 子ノードで ELK 呼び出しが同期実行されるため UI が固まると予想。',
    doc: buildShallowWide(),
  },
  {
    id: 'asymmetric-tree-7',
    label: '非対称ツリー',
    purpose:
      '受付・契約・請求・アフターは 1 階層のまま、与信審査だけを 7 階層にネストした極端に不均衡なツリー。ドリルダウン時のパンくずの深さが枝によって 1 と 7 で変わる状況と、左ペインの経路入れ子の挙動を見る。',
    stress: ['hierarchy-depth', 'realistic'],
    expectation:
      'レイアウトより UI 側に差が出ると予想。入れ子モードでは深い枝だけが縦に伸びて他の枝が潰れるはずで、ELK の nodeSize 計算が枝ごとに極端に偏る。ドリルダウンモードではパンくずが 7 段になり、浅い枝から深い枝へ移動したときに表示がガタつくはず。左右分割モードの左ペインは、7 階層のツリーを全部展開すると縦スクロールが必要になる一方で他の枝は 2 行で終わるので、非対称さがそのまま出る。7 階層の底から 1 階層の枝への差し戻し 2 本は、どの表示モードでも「階層をまたぐ線」として残るので、集約の対象になるかを確認したい。',
    doc: buildAsymmetricTree(),
  },
  {
    id: 'interleaved-groups-10',
    label: 'グループ往復',
    purpose:
      '営業部と工事部の中身が交互に繋がり、順路がグループ境界を 20 回またぐ。グループ内部で完結するリンクが 1 本もないため、コンテナを重ねずに描けるか・折りたたみ時に全リンクが group→group に潰れるかを見る。',
    stress: ['edge-routing', 'edge-aggregation', 'hierarchy-width'],
    expectation:
      'これが compound レイアウトの一番の弱点を突く形。dagre は交互に往復する順路を層に割り当てられず、2 つのコンテナ矩形が重なるか、片方が極端に縦長になると予想。ELK の layered は hierarchyHandling: INCLUDE_CHILDREN を指定しないと同様に破綻するはず。Cytoscape の compound は親のバウンディングボックスが子の位置から自動計算されるので、交互配置だと 2 つの矩形が確実に重なる。AntV G6 の combo は重なりを許容するので視覚的に読めなくなるはず。折りたたむと 22 本すべてが営業部⇄工事部の 2 本（+ loopback）に畳まれるはずで、集約の効果が最も大きいケースでもある。',
    doc: buildInterleavedGroups(),
  },
]

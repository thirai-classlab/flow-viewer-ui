/**
 * 退化ケース（degenerate）— 「壊れ方」を測るためのテストデータ集。
 *
 * 通常のベンチマークが測るのは「どこまで耐えるか」だが、ここで測りたいのは
 * **実装が暗黙に置いている前提が破れたときに何が起きるか**。
 *
 * 多くの可視化ライブラリ／レイアウトエンジンは、明示されていない前提を持っている:
 *   - ノードが 1 つ以上ある（空配列を渡すと fit() が NaN になる、例外を投げる）
 *   - 入口（in-degree 0）が 1 つ以上ある（dagre / ELK layered のランク付けの起点）
 *   - グループには子がいる（コンテナのサイズを子の bbox から決めている）
 *   - エッジの両端が別ノードである（自己ループの経路計算）
 *   - ラベルは短く、マークアップを含まない（テキスト幅の計測・エスケープ）
 *
 * ここに置くデータはその前提を 1 つずつ外す。**壊れることを期待して作っている**ので、
 * 「描画が崩れた」「警告が出た」「レイアウトが 0x0 になった」はすべて有効な観測結果。
 * ただしアプリ全体を落とすもの（無限再帰する children など）は作らない。
 *
 * 命名は「引越しライフライン（電気・ガス・水道・ネット）契約代行」の業務語彙で統一し、
 * 「退化データだから中身は適当」に見えないようにしてある。
 */

import type { FlowDoc, FlowStep, FlowLink } from '../schema'
import type { TestCase } from './types'

// ---------------------------------------------------------------------------
// 1. 空のフロー
// ---------------------------------------------------------------------------

const emptyDoc: FlowDoc = {
  id: 'deg-empty',
  title: '空フロー（ノード 0 / リンク 0）',
  description: '業務フローの新規作成直後（まだ何も置いていない）状態を模した完全な空。',
  root: [],
  links: [],
}

// ---------------------------------------------------------------------------
// 2. 単一ノード
// ---------------------------------------------------------------------------

const singleDoc: FlowDoc = {
  id: 'deg-single',
  title: '単一ノード（リンク 0）',
  description:
    'ノードを 1 つ置いただけの状態。しかも kind は start ではなく task なので、'
    + '「開始ノードから辿る」実装は起点を見つけられない。',
  root: [{ id: 'sg-task', label: '引越し予定日ヒアリング', kind: 'task', meta: { owner: 'CS 担当' } }],
  links: [],
}

// ---------------------------------------------------------------------------
// 3. 孤立ノード（どのリンクにも現れないノードが複数ある）
// ---------------------------------------------------------------------------

const isolatedDoc: FlowDoc = {
  id: 'deg-isolated',
  title: '孤立ノード混在',
  description:
    '本線（start → 3 工程 → end）に加えて、どのリンクにも現れないノードを 8 個混ぜた。'
    + 'うち 1 つは子を持つグループごと孤立している。',
  root: [
    { id: 'iso-start', label: '申込発生', kind: 'start' },
    { id: 'iso-receive', label: 'フォーム受信', kind: 'task', meta: { system: 'Web フォーム' } },
    { id: 'iso-credit', label: '与信照会', kind: 'task', meta: { system: '外部信用情報 API' } },
    { id: 'iso-notify', label: '完了通知', kind: 'task', meta: { system: 'メール / LINE' } },
    { id: 'iso-end', label: '完了', kind: 'end' },

    // --- ここから下は links に一度も登場しない ---
    { id: 'iso-orphan-1', label: '旧プラン解約受付', kind: 'task', meta: { note: '廃止済み手順' } },
    { id: 'iso-orphan-2', label: '紙申込書スキャン', kind: 'task', meta: { note: '廃止済み手順' } },
    { id: 'iso-orphan-3', label: '訪問見積が必要か', kind: 'decision' },
    { id: 'iso-orphan-4', label: 'FAX 送信控え保管', kind: 'task' },
    { id: 'iso-orphan-end', label: 'キャンセル終了', kind: 'end', meta: { note: '到達不能な終端' } },
    {
      id: 'iso-orphan-group',
      label: '旧・代理店経由受付',
      kind: 'group',
      meta: { owner: 'アライアンス', note: 'グループごと本線から切り離されている' },
      children: [
        { id: 'iso-orphan-g1', label: '代理店コード照合', kind: 'task' },
        { id: 'iso-orphan-g2', label: '手数料区分判定', kind: 'decision' },
        { id: 'iso-orphan-g3', label: '精算明細作成', kind: 'task' },
      ],
    },
  ],
  links: [
    { from: 'iso-start', to: 'iso-receive' },
    { from: 'iso-receive', to: 'iso-credit' },
    { from: 'iso-credit', to: 'iso-notify' },
    { from: 'iso-notify', to: 'iso-end' },
  ],
}

// ---------------------------------------------------------------------------
// 4. 自己ループ（from === to）
// ---------------------------------------------------------------------------

const selfLoopDoc: FlowDoc = {
  id: 'deg-self-loop',
  title: '自己ループ多用',
  description:
    'from === to のリンクを task / decision / group それぞれに付けた。'
    + '同一ペアの多重自己ループ（ラベル違い 3 本）と、2 ノード相互ループも含む。',
  root: [
    { id: 'sl-start', label: '申込発生', kind: 'start' },
    {
      id: 'sl-retry',
      label: '書類不備の再確認',
      kind: 'task',
      meta: { note: '不備が解消するまで同じ担当が繰り返す' },
    },
    { id: 'sl-dec', label: '不備は解消したか', kind: 'decision' },
    {
      id: 'sl-group',
      label: '与信審査',
      kind: 'group',
      meta: { owner: '審査チーム', note: 'グループ自身に自己ループが付いている' },
      children: [
        { id: 'sl-g-query', label: '信用情報照会', kind: 'task', meta: { system: '外部信用情報 API' } },
        { id: 'sl-g-judge', label: '与信 OK か', kind: 'decision' },
      ],
    },
    { id: 'sl-ping', label: '開通確認（1 回目）', kind: 'task' },
    { id: 'sl-pong', label: '開通確認（2 回目）', kind: 'task' },
    { id: 'sl-end', label: '完了', kind: 'end' },
  ],
  links: [
    { from: 'sl-start', to: 'sl-retry' },
    // 同じノードに 3 本の自己ループ（多重辺 + 自己ループの合わせ技）
    { from: 'sl-retry', to: 'sl-retry', label: '再確認 1 回目', kind: 'loopback' },
    { from: 'sl-retry', to: 'sl-retry', label: '再確認 2 回目', kind: 'loopback' },
    { from: 'sl-retry', to: 'sl-retry', label: '再確認 3 回目', kind: 'loopback' },
    { from: 'sl-retry', to: 'sl-dec' },
    // decision の自己ループ（菱形の自己参照）
    { from: 'sl-dec', to: 'sl-dec', label: '判定保留', kind: 'loopback' },
    { from: 'sl-dec', to: 'sl-g-query', label: '解消' },
    { from: 'sl-g-query', to: 'sl-g-judge' },
    // グループ自身への自己ループ。コンテナに刺さる辺 + 自己ループ
    { from: 'sl-group', to: 'sl-group', label: '審査やり直し', kind: 'loopback' },
    { from: 'sl-g-judge', to: 'sl-ping', label: 'OK' },
    // 2 ノード相互ループ（長さ 2 の閉路）
    { from: 'sl-ping', to: 'sl-pong', label: '不通' },
    { from: 'sl-pong', to: 'sl-ping', label: '再試験', kind: 'loopback' },
    { from: 'sl-pong', to: 'sl-end' },
    // 終端ノードの自己ループ（意味的にはあり得ないが、データとしては書ける）
    { from: 'sl-end', to: 'sl-end', label: '完了後の再オープン', kind: 'exception' },
  ],
}

// ---------------------------------------------------------------------------
// 5. 空グループ（children: []）
// ---------------------------------------------------------------------------

const emptyGroupDoc: FlowDoc = {
  id: 'deg-empty-group',
  title: '空グループ',
  description:
    'kind = group なのに children が空配列のノードを 5 つ置いた。'
    + '「作ったが中身をまだ書いていない部門」を模す。空グループを終点／始点にする辺も張ってある。',
  root: [
    { id: 'eg-start', label: '申込発生', kind: 'start' },
    { id: 'eg-empty-1', label: '受付部門（未記入）', kind: 'group', children: [], meta: { owner: 'CS' } },
    { id: 'eg-empty-2', label: '審査部門（未記入）', kind: 'group', children: [], meta: { owner: '審査' } },
    {
      id: 'eg-mixed',
      label: '手配部門',
      kind: 'group',
      meta: { owner: '手配チーム', note: '中身のあるグループと空グループが同居する' },
      children: [
        { id: 'eg-mixed-task', label: '電力申込', kind: 'task', meta: { system: '電力会社 Web' } },
        { id: 'eg-mixed-empty', label: 'ガス申込（未記入）', kind: 'group', children: [] },
        { id: 'eg-mixed-dec', label: '立会いが必要か', kind: 'decision' },
      ],
    },
    {
      id: 'eg-nest-outer',
      label: '品質管理',
      kind: 'group',
      meta: { note: '空グループだけを子に持つグループ（実質空だが children.length は 1）' },
      children: [{ id: 'eg-nest-inner', label: '開通確認（未記入）', kind: 'group', children: [] }],
    },
    { id: 'eg-end', label: '完了', kind: 'end' },
  ],
  links: [
    // 空グループを順路の途中に挟む
    { from: 'eg-start', to: 'eg-empty-1' },
    { from: 'eg-empty-1', to: 'eg-empty-2' },
    { from: 'eg-empty-2', to: 'eg-mixed-task' },
    { from: 'eg-mixed-task', to: 'eg-mixed-empty' },
    { from: 'eg-mixed-empty', to: 'eg-mixed-dec' },
    { from: 'eg-mixed-dec', to: 'eg-nest-inner', label: '不要' },
    { from: 'eg-mixed-dec', to: 'eg-nest-outer', label: '必要' },
    { from: 'eg-nest-inner', to: 'eg-end' },
  ],
}

// ---------------------------------------------------------------------------
// 6. グループのみ（葉が 1 つも無い）
// ---------------------------------------------------------------------------

/** 葉を一切持たない、グループだけの入れ子を作る */
function buildGroupOnlyTree(): FlowStep[] {
  const names: Record<number, string[]> = {
    0: ['受注プロセス', '手配プロセス'],
    1: ['受付部門', '審査部門'],
    2: ['申込業務', '確認業務'],
    3: ['一次工程', '二次工程'],
  }
  const build = (level: number, path: string): FlowStep => {
    const label = `${names[level]?.[Number(path.slice(-1)) - 1] ?? `レベル${level + 1}`}${path}`
    // 最深層も kind は group のまま、children を空配列にして「葉ゼロ」を成立させる
    if (level >= 3) {
      return { id: `go-${path}`, label, kind: 'group', children: [], meta: { note: '最深層の空グループ' } }
    }
    return {
      id: `go-${path}`,
      label,
      kind: 'group',
      meta: { owner: `${label}チーム` },
      children: [build(level + 1, `${path}-1`), build(level + 1, `${path}-2`)],
    }
  }
  return [build(0, '1'), build(0, '2')]
}

const groupOnlyLinks: FlowLink[] = [
  // グループ同士を繋ぐ。端点が全部コンテナなので、resolveEndpoint が常に「自分自身」を返す
  { from: 'go-1', to: 'go-2' },
  { from: 'go-1-1', to: 'go-1-2' },
  { from: 'go-2-1', to: 'go-2-2' },
  { from: 'go-1-1-1', to: 'go-1-1-2' },
  { from: 'go-1-2-1', to: 'go-1-2-2' },
  { from: 'go-2-1-1', to: 'go-2-1-2' },
  { from: 'go-2-2-1', to: 'go-2-2-2' },
  // 最深層（空グループ）同士
  { from: 'go-1-1-1-1', to: 'go-1-1-1-2' },
  { from: 'go-1-1-2-1', to: 'go-1-1-2-2' },
  { from: 'go-2-2-1-1', to: 'go-2-2-2-2' },
  // 階層をまたぐ差し戻し（深い空グループ → 最上位グループ）
  { from: 'go-2-2-2-2', to: 'go-1', label: '差し戻し', kind: 'loopback' },
  // 親 → 自分の子孫、という「包含関係と同じ向き」の辺（レイアウトが自己矛盾する）
  { from: 'go-1', to: 'go-1-1-1-1', label: '直行', kind: 'exception' },
]

const groupOnlyDoc: FlowDoc = {
  id: 'deg-group-only',
  title: 'グループのみ',
  description:
    'task / decision / start / end が 1 つも無く、kind = group の入れ子（4 段）だけで構成。'
    + '最深層は children: [] なので、部分木のどこにも葉が存在しない。',
  root: buildGroupOnlyTree(),
  links: groupOnlyLinks,
}

// ---------------------------------------------------------------------------
// 7. 全部が decision（かつ start / end が無い）
// ---------------------------------------------------------------------------

const allDecisionDoc: FlowDoc = {
  id: 'deg-all-decision',
  title: '全部 decision',
  description:
    '10 ノードすべてが kind = decision。start も end も task も無く、判定だけが連鎖する。'
    + '各判定は 2〜3 本の出辺を持ち、一部は前の判定へ戻る。',
  root: [
    { id: 'ad-1', label: '重複申込か', kind: 'decision' },
    { id: 'ad-2', label: '本人確認済みか', kind: 'decision' },
    { id: 'ad-3', label: '与信 OK か', kind: 'decision' },
    { id: 'ad-4', label: '書類に不備は無いか', kind: 'decision' },
    { id: 'ad-5', label: '供給地点は特定できたか', kind: 'decision' },
    { id: 'ad-6', label: '立会いは必要か', kind: 'decision' },
    { id: 'ad-7', label: '希望日に工事枠はあるか', kind: 'decision' },
    { id: 'ad-8', label: '開通は確認できたか', kind: 'decision' },
    { id: 'ad-9', label: '請求は発行済みか', kind: 'decision' },
    { id: 'ad-10', label: '解約扱いにするか', kind: 'decision' },
  ],
  links: [
    { from: 'ad-1', to: 'ad-2', label: '新規' },
    { from: 'ad-1', to: 'ad-10', label: '重複', kind: 'exception' },
    { from: 'ad-2', to: 'ad-3', label: '済' },
    { from: 'ad-2', to: 'ad-1', label: '未', kind: 'loopback' },
    { from: 'ad-3', to: 'ad-4', label: 'OK' },
    { from: 'ad-3', to: 'ad-10', label: 'NG', kind: 'exception' },
    { from: 'ad-4', to: 'ad-5', label: '不備なし' },
    { from: 'ad-4', to: 'ad-2', label: '不備あり', kind: 'loopback' },
    { from: 'ad-5', to: 'ad-6', label: '特定済' },
    { from: 'ad-5', to: 'ad-4', label: '未特定', kind: 'loopback' },
    { from: 'ad-6', to: 'ad-7', label: '必要' },
    { from: 'ad-6', to: 'ad-8', label: '不要' },
    { from: 'ad-7', to: 'ad-8', label: '確保' },
    { from: 'ad-7', to: 'ad-6', label: '枠なし', kind: 'loopback' },
    { from: 'ad-8', to: 'ad-9', label: '確認済' },
    { from: 'ad-8', to: 'ad-7', label: '不通', kind: 'loopback' },
    { from: 'ad-9', to: 'ad-10', label: '発行済' },
    { from: 'ad-10', to: 'ad-1', label: '再受付', kind: 'loopback' },
  ],
}

// ---------------------------------------------------------------------------
// 8. リンクが 1 本もない（ノードだけ 20 個）
// ---------------------------------------------------------------------------

const NO_LINK_LABELS = [
  '申込発生',
  'フォーム受信',
  '重複申込か',
  '顧客登録',
  '必須項目チェック',
  '本人確認',
  '信用情報照会',
  '与信 OK か',
  '書類受領',
  '不備なしか',
  '電力申込',
  'ガス申込',
  '水道申込',
  'ネット申込',
  '日程調整',
  '工事手配',
  '開通確認',
  '完了通知',
  '完了',
  '謝絶',
] as const

const noLinkDoc: FlowDoc = {
  id: 'deg-no-links',
  title: 'リンク 0 / 20 ノード',
  description:
    'ノードは 20 個あるが links が空配列。エッジからランクを決めるレイアウトは全ノードが同ランクになる。'
    + '「工程の付箋だけ貼って線をまだ引いていない」状態を模す。',
  root: NO_LINK_LABELS.map((label, i) => ({
    id: `nl-${i + 1}`,
    label,
    kind: i === 0 ? 'start' : i >= 18 ? 'end' : label.endsWith('か') ? 'decision' : 'task',
    meta: { note: '接続されていない' },
  })),
  links: [],
}

// ---------------------------------------------------------------------------
// 9. 長大ラベル
// ---------------------------------------------------------------------------

const LONG_TASK_LABEL =
  '引越しに伴う電気・ガス・水道・インターネット回線の各種手続きについて、'
  + 'お客様がお申込みフォームにご入力された内容に不備が無いかを、契約名義・供給地点特定番号・'
  + '使用開始希望日・立会いの要否・支払方法の五つの観点から一件ずつ突合し、'
  + '不足や矛盾が見つかった場合は当日中に架電またはメールでご確認のうえ、CRM の申込レコードを更新する'

const LONG_DECISION_LABEL =
  'お客様のお申込み内容と、外部信用情報機関から取得した与信結果、および過去の解約履歴を'
  + '突き合わせたうえで、当社の引受基準に照らして今回の申込を受託してよいと判断できるか'

const LONG_GROUP_LABEL =
  '受付部門・審査部門・手配部門・品質管理部門の四部門が横断で関与する、'
  + '申込受付から各ライフライン事業者への取次、工事日程の調整、開通確認、'
  + 'ならびに完了通知の発送までを一括で管理する統合オペレーショングループ'

const LONG_LEAF_LABEL =
  '各ライフライン事業者（電力会社・都市ガス／LP ガス会社・自治体水道局・ISP）ごとに'
  + '異なる申込チャネル（Web フォーム、FAX、電話、専用 API、窓口持参）と、'
  + 'それぞれの受付締切時刻・標準リードタイム・不備差し戻し時の再申込ルールを踏まえて、'
  + 'お客様の入居予定日に間に合う順序で申込を投入し、投入結果を一件ずつ記録に残す作業'

const longLabelDoc: FlowDoc = {
  id: 'deg-long-label',
  title: '長大ラベル',
  description:
    '100 文字を大きく超えるラベル（最長 164 文字）を task / decision / group / end に持たせた。'
    + '短いラベルのノードと混在させ、幅計算がノード単位か一律かを見分けられるようにしてある。',
  root: [
    { id: 'll-start', label: '申込発生', kind: 'start' },
    { id: 'll-task', label: LONG_TASK_LABEL, kind: 'task', meta: { owner: 'CS 担当', sla: '30 分' } },
    { id: 'll-short', label: '登録', kind: 'task', meta: { note: '対比用の極端に短いラベル' } },
    { id: 'll-dec', label: LONG_DECISION_LABEL, kind: 'decision' },
    {
      id: 'll-group',
      label: LONG_GROUP_LABEL,
      kind: 'group',
      meta: { owner: '統合オペレーション' },
      children: [
        { id: 'll-g-long', label: LONG_LEAF_LABEL, kind: 'task' },
        { id: 'll-g-short', label: '記録', kind: 'task' },
      ],
    },
    {
      id: 'll-end',
      label:
        'すべてのライフラインの開通が確認でき、お客様への完了通知の送達も確認できたため、'
        + '本申込に関する当社のオペレーションを完了とする',
      kind: 'end',
    },
  ],
  links: [
    { from: 'll-start', to: 'll-task' },
    { from: 'll-task', to: 'll-short' },
    { from: 'll-short', to: 'll-dec' },
    {
      from: 'll-dec',
      to: 'll-g-long',
      label: '当社の引受基準を満たすため受託と判断した場合（与信・本人確認ともに問題なし）',
    },
    { from: 'll-g-long', to: 'll-g-short' },
    { from: 'll-g-short', to: 'll-end' },
    { from: 'll-dec', to: 'll-end', label: '謝絶', kind: 'exception' },
  ],
}

// ---------------------------------------------------------------------------
// 10. 特殊文字ラベル
// ---------------------------------------------------------------------------

const specialCharDoc: FlowDoc = {
  id: 'deg-special-chars',
  title: '特殊文字ラベル',
  description:
    '絵文字・改行・タブ・HTML っぽいタグ・引用符・エンティティ表記・全角記号・RTL 文字を'
    + 'ラベルに含めた。XSS の検証ではなく、エスケープ漏れや文字幅計測の破綻を見るためのもの。',
  root: [
    { id: 'sc-start', label: '🚚 申込発生（引越し）', kind: 'start' },
    {
      id: 'sc-html',
      label: '<b>至急</b> 与信照会 <i>要フォロー</i>',
      kind: 'task',
      meta: { note: 'タグがそのまま文字として出るか、太字として解釈されるか' },
    },
    {
      id: 'sc-newline',
      label: '改行を含むラベル\n2 行目: 供給地点特定番号の照合\n3 行目: 立会い要否の確認',
      kind: 'task',
      meta: { note: '\\n が改行になるか、消えるか、□ になるか' },
    },
    {
      id: 'sc-tab',
      label: '電力\tガス\t水道\tネット（タブ区切り）',
      kind: 'task',
    },
    {
      id: 'sc-quote',
      label: '"二重引用符" と \'単一引用符\' と \\バックスラッシュ\\ と A & B',
      kind: 'decision',
      meta: { note: 'Mermaid のようなテキスト DSL 生成型はここで構文が壊れやすい' },
    },
    {
      id: 'sc-entity',
      label: '&lt;div&gt; エンティティ表記 &amp;nbsp; &copy; 2026',
      kind: 'task',
      meta: { note: '二重エスケープされると &amp;lt; と表示される' },
    },
    {
      id: 'sc-markup',
      label: '<div class="tooltip" style="color:red">HTML っぽい塊</div>',
      kind: 'task',
    },
    {
      id: 'sc-emoji',
      label: '✅ 開通確認 🔥🔥🔥 完了通知 📮 家族👨‍👩‍👧‍👦 対応',
      kind: 'task',
      meta: { note: 'ZWJ 結合絵文字。文字数カウントと描画幅がずれる' },
    },
    {
      id: 'sc-rtl',
      label: 'العربية 双方向テキスト עברית 混在',
      kind: 'task',
    },
    {
      id: 'sc-fullwidth',
      label: 'Ｚｅｎｋａｋｕ／全角ＡＢＣ１２３％＆＃＠～￥',
      kind: 'task',
    },
    {
      id: 'sc-group',
      label: '📦 手配部門 <span>【重要】</span>\n※ 括弧と改行を含むグループ名',
      kind: 'group',
      meta: { owner: '手配チーム 🛠️' },
      children: [
        { id: 'sc-g-1', label: '{{ mustache }} と ${template} と %s', kind: 'task' },
        { id: 'sc-g-2', label: '極端に短い→あ', kind: 'task' },
        { id: 'sc-g-3', label: '', kind: 'task', meta: { note: '空文字ラベル' } },
      ],
    },
    { id: 'sc-end', label: '🎉 完了', kind: 'end' },
  ],
  links: [
    { from: 'sc-start', to: 'sc-html' },
    { from: 'sc-html', to: 'sc-newline' },
    { from: 'sc-newline', to: 'sc-tab' },
    { from: 'sc-tab', to: 'sc-quote' },
    { from: 'sc-quote', to: 'sc-entity', label: '"OK" & 続行' },
    { from: 'sc-quote', to: 'sc-markup', label: '<b>NG</b>', kind: 'exception' },
    { from: 'sc-entity', to: 'sc-emoji' },
    { from: 'sc-markup', to: 'sc-emoji' },
    { from: 'sc-emoji', to: 'sc-rtl' },
    { from: 'sc-rtl', to: 'sc-fullwidth' },
    { from: 'sc-fullwidth', to: 'sc-g-1', label: '改行\n入りラベル' },
    { from: 'sc-g-1', to: 'sc-g-2' },
    { from: 'sc-g-2', to: 'sc-g-3' },
    { from: 'sc-g-3', to: 'sc-end', label: '🎉' },
  ],
}

// ---------------------------------------------------------------------------
// 11. 循環だけで構成されたフロー（入口が無い）
// ---------------------------------------------------------------------------

const cycleOnlyDoc: FlowDoc = {
  id: 'deg-cycle-only',
  title: '入口なし循環',
  description:
    '全 9 ノードの in-degree が 1 以上で、in-degree 0 のノードが存在しない。'
    + 'start / end も無いので「起点から辿る」実装は最初の 1 ノードすら選べない。'
    + '外側のリング + 内側のリング + 弦の三重構造。',
  root: [
    { id: 'co-1', label: '督促リスト抽出', kind: 'task', meta: { system: '請求管理' } },
    { id: 'co-2', label: '入金消込', kind: 'task' },
    { id: 'co-3', label: '未入金か', kind: 'decision' },
    { id: 'co-4', label: '架電督促', kind: 'task', meta: { owner: '債権管理' } },
    { id: 'co-5', label: '書面督促', kind: 'task' },
    {
      id: 'co-group',
      label: '再請求業務',
      kind: 'group',
      meta: { owner: '債権管理', note: 'グループ自体も循環の一部' },
      children: [
        { id: 'co-g-1', label: '請求書再発行', kind: 'task' },
        { id: 'co-g-2', label: '送付先住所の再確認', kind: 'task' },
        { id: 'co-g-3', label: '再送するか', kind: 'decision' },
      ],
    },
  ],
  links: [
    // 外側リング（グループ内の葉も巻き込んで 1 周する）
    { from: 'co-1', to: 'co-2' },
    { from: 'co-2', to: 'co-3' },
    { from: 'co-3', to: 'co-4', label: '未入金' },
    { from: 'co-4', to: 'co-5', label: '応答なし' },
    { from: 'co-5', to: 'co-g-1' },
    { from: 'co-g-1', to: 'co-g-2' },
    { from: 'co-g-2', to: 'co-g-3' },
    { from: 'co-g-3', to: 'co-1', label: '再送する', kind: 'loopback' },
    // 内側リング（グループ内で完結する閉路）
    { from: 'co-g-3', to: 'co-g-1', label: '宛先修正', kind: 'loopback' },
    // 弦（リングをショートカットする辺。閉路除去の結果が実装ごとに変わる）
    { from: 'co-3', to: 'co-1', label: '入金済', kind: 'loopback' },
    { from: 'co-4', to: 'co-2', label: '入金約束', kind: 'loopback' },
    { from: 'co-g-2', to: 'co-4', label: '電話番号更新', kind: 'exception' },
    // グループ自身を端点にする閉路（コンテナ ↔ 葉）
    { from: 'co-5', to: 'co-group', label: '一括再請求', kind: 'exception' },
    { from: 'co-group', to: 'co-5', label: '再督促', kind: 'loopback' },
  ],
}

// ---------------------------------------------------------------------------
// ケース定義
// ---------------------------------------------------------------------------

export const degenerateCases: TestCase[] = [
  {
    id: 'degenerate-empty',
    label: '空フロー',
    purpose:
      'ノード 0・リンク 0 の完全な空を渡す。「1 個以上ある」という暗黙の前提が'
      + 'どこで破れるか（初期化・fit・レイアウト呼び出し）を見る。',
    stress: ['degenerate'],
    expectation:
      'Reaflow / ELK は空の children で layout() が空結果を返すはずだが、'
      + 'fitCanvas 時に bbox が 0 幅になり scale = Infinity → 画面が真っ白か NaN transform になると予想。'
      + 'Mermaid は "flowchart TD" だけの本文になり構文エラーで赤いエラーボックスを出す可能性が高い。'
      + 'bpmn-js は Process に flowElements が無い XML になるので、空 canvas で警告のみと予想。'
      + 'Cytoscape / G6 / X6 は空でも落ちないが fit() が中心を決められず初期ズームが不定になるはず。',
    doc: emptyDoc,
  },
  {
    id: 'degenerate-single-node',
    label: '単一ノード',
    purpose:
      'ノード 1 個・リンク 0。しかも kind は start ではなく task なので、'
      + '「start から辿る」「入口を探す」実装は起点を決められない。',
    stress: ['degenerate'],
    expectation:
      'dagre / ELK は単一ノードを普通に (0,0) に置くので大半は描けるはず。'
      + '差が出るのは fit / zoom で、1 ノードしかないと bbox がノードサイズそのものになり'
      + '「1 ノードが画面いっぱいに拡大される」ライブラリ（Cytoscape の fit、React Flow の fitView）と'
      + 'デフォルトズーム維持のものに分かれると予想。'
      + 'bpmn-js は StartEvent 無しの Task 単独でも描けるが、リンタが警告を出すはず。',
    doc: singleDoc,
  },
  {
    id: 'degenerate-isolated-nodes',
    label: '孤立ノード',
    purpose:
      '本線 5 ノードに対し、どのリンクにも現れない孤立ノードを 8 個（うち 1 つは子 3 個を持つグループ）混ぜる。'
      + '非連結成分をどこに置くかでレイアウトの性格がはっきり分かれる。',
    stress: ['degenerate', 'layout-width'],
    expectation:
      'dagre は孤立ノードを全部ランク 0 に置くので、本線の上に横一列で並び図が極端に横長になると予想。'
      + 'ELK は separateConnectedComponents = true が既定なので成分ごとに矩形を詰めて配置し、'
      + '見た目が最もマシになるはず（Reaflow が有利）。'
      + 'Cytoscape の力学レイアウト（cose）は孤立ノードを外周へ弾き飛ばし、'
      + '本線が中央の小さな塊に潰れると予想。G6 の dagre も同様に横並びになるはず。',
    doc: isolatedDoc,
  },
  {
    id: 'degenerate-self-loop',
    label: '自己ループ',
    purpose:
      'from === to の辺を task / decision / group に付け、さらに同一ノードへの多重自己ループ 3 本と'
      + '2 ノード相互ループを混ぜる。自己ループの経路生成と多重辺のオフセットを見る。',
    stress: ['degenerate', 'cycles', 'edge-routing'],
    expectation:
      'dagre 本体は self-edge を layout 対象から外して edge.points を返さないため、'
      + 'React Flow / G6 の dagre 経由は 3 本が完全に重なるか、長さ 0 のベジエになって消えると予想。'
      + 'Cytoscape は loop edge を正式サポートし control-point-step-size で 3 本を扇状に描き分けるはず（最良）。'
      + 'ELK は自己ループに port 指定が要るので、Reaflow では辺が欠落するか例外になる可能性がある。'
      + 'グループ自身への自己ループはコンテナの周囲を回る必要があり、'
      + 'JointJS / maxGraph は描けるが、辺がグループ矩形の内側を突っ切ると予想。',
    doc: selfLoopDoc,
  },
  {
    id: 'degenerate-empty-group',
    label: '空グループ',
    purpose:
      'children が空配列の group を 5 つ置き、そのうち 3 つを順路の途中に挟む。'
      + 'コンテナのサイズを子の bbox から決める実装が 0x0 に潰れないかを見る。',
    stress: ['degenerate', 'hierarchy-width'],
    expectation:
      'React Flow は parent ノードに明示的な width/height を与えないと 0x0 になるため、'
      + '空グループが線だけの点に潰れて辺の端点が重なると予想。'
      + 'ELK は container の子が空だと minimum size padding だけの矩形になるので、'
      + 'Reaflow は小さいが潰れないはず。'
      + 'bpmn-js の折りたたみ SubProcess は空でも既定サイズを持つので最も安定するはず。'
      + '「空グループを折りたたむ／展開する」UI 操作で例外が出るかも要観察。',
    doc: emptyGroupDoc,
  },
  {
    id: 'degenerate-group-only',
    label: 'グループのみ',
    purpose:
      'task / decision / start / end が 1 つも無く、group の 4 段入れ子（最深層は children: []）だけ。'
      + '辺の端点も全部コンテナで、親 → 自分の子孫という包含方向と同じ辺も 1 本入れてある。',
    stress: ['degenerate', 'hierarchy-depth', 'edge-routing'],
    expectation:
      'コンテナ同士を直接つなぐ辺を想定していない実装（compound graph の辺を子に付け替える前提のもの）で'
      + '差が出るはず。Cytoscape は compound node 間の辺を公式にサポートするが'
      + '「祖先 → 子孫」の辺は仕様上禁止に近く、警告か描画崩れになると予想。'
      + 'Mermaid は subgraph の入れ子は書けるが中身が無い subgraph はパースエラーになる可能性が高い。'
      + 'ELK は hierarchyHandling = INCLUDE_CHILDREN でないと階層をまたぐ辺を無視するので、'
      + 'Reaflow で辺がごっそり消えるかもしれない。',
    doc: groupOnlyDoc,
  },
  {
    id: 'degenerate-all-decision',
    label: '全部 decision',
    purpose:
      '10 ノードすべてが decision で、start / end / task が存在しない。'
      + '出辺 2〜3 本 + 差し戻し 6 本で入口も出口も曖昧にしてある。',
    stress: ['degenerate', 'cycles', 'edge-routing'],
    expectation:
      '菱形は矩形よりラベルが入らないので、まず「判定ラベルが図形からはみ出す／省略される」差が出るはず。'
      + 'bpmn-js は ExclusiveGateway 連鎖として妥当な BPMN にならず（StartEvent 必須の検証に引っかかり）'
      + 'インポート時に警告を出すと予想。'
      + 'dagre は in-degree 0 が ad-1 のみ（実は ad-2/ad-10 から戻る辺があるため実質 0 個）で、'
      + 'greedy FAS の結果に依存して毎回違う縦順になる可能性がある。'
      + 'LogicFlow は decision 用ノードの既定サイズが小さく、最も先に破綻すると予想。',
    doc: allDecisionDoc,
  },
  {
    id: 'degenerate-no-links',
    label: 'リンク 0',
    purpose:
      'ノード 20 個・links 空配列。エッジからランクを決めるレイアウトが'
      + '全ノードを 1 ランクに置いて極端な横長になるかを見る。',
    stress: ['degenerate', 'layout-width'],
    expectation:
      'dagre は全 20 ノードがランク 0 になるので、横幅 = 20 ノード分の一直線になると予想'
      + '（React Flow / G6 / LogicFlow の dagre 経由が全部同じ形になるはず）。'
      + 'ELK layered も同様だが、Reaflow 側で separateConnectedComponents が効くと'
      + '正方形に近いグリッドへ詰めてくれる可能性がある。'
      + 'Cytoscape は cose ではなく grid レイアウトを選べば最も見やすくなるはずで、'
      + '「レイアウトを差し替えられるか」がそのまま差になると予想。'
      + 'Mermaid は接続の無いノードを縦に積むだけになるはず。',
    doc: noLinkDoc,
  },
  {
    id: 'degenerate-long-label',
    label: '長大ラベル',
    purpose:
      '100 文字超（最長 164 文字）のラベルを task / decision / group / end と辺ラベルに持たせ、'
      + '2 文字の極短ラベルと混在させる。省略・折り返し・ノード幅計算の挙動を見る。',
    stress: ['degenerate', 'layout-width'],
    expectation:
      'React Flow の既定ノードは固定幅なのでテキストが枠外へあふれるか、CSS 次第で縦に伸び続けると予想。'
      + 'dagre に渡す width/height を実測せず定数にしている実装は、'
      + 'ラベルは長いのにノード矩形が小さいまま = 辺とテキストが重なるはず。'
      + 'Cytoscape は text-wrap: wrap + text-max-width を設定していれば折り返すが、既定では 1 行で突き抜ける。'
      + 'G6 / X6 は canvas 描画なので自前で省略（…）を実装していない限りはみ出すと予想。'
      + 'Mermaid は自動で折り返すので最も破綻しにくいが、図全体の幅が数千 px になるはず。'
      + '110 文字超のグループラベルはコンテナのヘッダ高さを押し広げるので、そこも観察点。',
    doc: longLabelDoc,
  },
  {
    id: 'degenerate-special-chars',
    label: '特殊文字ラベル',
    purpose:
      '絵文字（ZWJ 結合含む）・改行・タブ・<b> などのタグ・引用符・&lt; 等のエンティティ・全角記号・'
      + 'RTL 文字・空文字ラベルを混ぜる。XSS ではなくエスケープ漏れと文字幅計測の破綻を見る。',
    stress: ['degenerate'],
    expectation:
      'Mermaid はテキスト DSL を生成するため最も脆いはずで、'
      + '二重引用符と改行を含むラベルでパースエラーを起こすと予想（要クォート／&quot; 置換）。'
      + 'HTML でノードを描く React Flow / Reaflow / LogicFlow は、textContent なら <b> がそのまま文字で出て正しく、'
      + 'innerHTML 経由だと太字になってしまう（＝エスケープ漏れの検出）。'
      + 'canvas 描画の G6 / X6 は \\n を無視して 1 行に潰すか □ を出すと予想。'
      + 'ZWJ 結合絵文字は length ベースで幅を推定している実装だとノード幅が過大に見積もられるはず。'
      + '空文字ラベルのノードは高さ 0 に潰れる実装がありそう。',
    doc: specialCharDoc,
  },
  {
    id: 'degenerate-cycle-only',
    label: '入口なし循環',
    purpose:
      '全ノードの in-degree が 1 以上で、in-degree 0 のノードが 1 つも無い。'
      + '外側リング + グループ内リング + 弦 + コンテナ↔葉の閉路を重ねてある。',
    stress: ['degenerate', 'cycles', 'edge-routing'],
    expectation:
      'dagre は acyclic 化（greedy FAS）で任意の辺を反転してから階層を決めるので、'
      + '「どの辺が逆向きに描かれるか」が実装・辺の並び順に依存して変わると予想。'
      + '同じ JSON でも React Flow 経由と G6 経由で上下が反転する可能性がある。'
      + 'ELK は CYCLE_BREAKING = GREEDY が既定なので描けるはずだが、'
      + '階層をまたぐ閉路（コンテナ ↔ 葉）で辺が消えるか例外になるかもしれない。'
      + 'bpmn-js は StartEvent 不在 + 循環のみなので、意味的に不正な BPMN として警告が出るはず。'
      + 'Mermaid は循環を素直に描けるので最も安定すると予想。',
    doc: cycleOnlyDoc,
  },
]

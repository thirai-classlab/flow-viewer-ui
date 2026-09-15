/**
 * 実務パターンのテストケース群。
 *
 * 「合成ストレスデータ」ではなく **実際の業務システムに存在する形** を再現する。
 * このアプリを使う人が「自社のフローに一番近いのはどれか」で選び、
 * そのケースでの各ライブラリの挙動を見て採用判断できることを狙う。
 *
 * 収録している 7 つの原型:
 *   1. 多段階承認（稟議）      … 階層をまたぐ差し戻しループが主役
 *   2. インシデント対応         … 6 分岐 decision と例外遷移が主役
 *   3. 受発注（Order to Cash） … 部門をまたぐ引き継ぎリンクが主役
 *   4. データパイプライン       … 循環ゼロ・fan-out / fan-in が主役
 *   5. チケット状態遷移         … 双方向の循環が本質にある
 *   6. カスタマーサポート       … 同一ノードへの多重合流が主役
 *   7. 督促・債権回収           … 自己ループと段階エスカレーション
 *
 * meta（owner / sla / system）は全ケースで埋めてある。
 * ノード内に情報を持てるライブラリ（React Flow / JointJS / X6）と
 * ラベル 1 行しか持てないライブラリ（Mermaid / bpmn-js）で
 * 「同じデータなのに情報量がまるで違う」ことが見えるようにするため。
 */

import type { FlowDoc } from '../schema'
import type { TestCase } from './types'

// ---------------------------------------------------------------------------
// 1. 多段階承認フロー（稟議）
// ---------------------------------------------------------------------------

/**
 * 申請 → 一次（課長）→ 二次（部長）→ 法務 → 最終（役員会）の 4 段階承認。
 *
 * 設計意図:
 *   差し戻し（loopback）を **必ず階層をまたがせる**。
 *   役員会（dept-exec/L1）の否認が申請部門（dept-applicant → 差し戻し対応/L2）へ戻るので、
 *   後方エッジがグループ境界を 2 回抜ける。dagre / ELK 系はこれで
 *   サブグラフのランク付けが崩れやすい。
 *   差し戻し先を「申請書作成」ではなく専用の「差し戻し対応」グループにしてあるのは、
 *   実務のワークフロー製品（ServiceNow / kintone 等）が実際にそうなっているのと、
 *   4 本の loopback が 1 ノードに集中して fan-in を作るため。
 */
const approvalDoc: FlowDoc = {
  id: 'realistic-approval-multi-stage',
  title: '設備投資稟議 4 段階承認フロー',
  description:
    '申請 → 一次承認（課長）→ 二次承認（部長）→ 法務レビュー → 最終決裁（役員会）。各段階の否認が階層をまたいで申請部門の差し戻し対応へ戻る。',
  root: [
    { id: 'ap-start', label: '稟議起票', kind: 'start', meta: { owner: '起票者', system: 'ワークフロー基盤' } },

    {
      id: 'ap-dept-applicant',
      label: '申請部門',
      kind: 'group',
      meta: { owner: '事業部', sla: '3 営業日' },
      children: [
        {
          id: 'ap-draft',
          label: '申請書作成',
          kind: 'group',
          meta: { sla: '1 営業日' },
          children: [
            {
              id: 'ap-input',
              label: '稟議書入力',
              kind: 'task',
              meta: { owner: '起票者', system: 'ワークフロー基盤', sla: '2 時間' },
            },
            {
              id: 'ap-attach',
              label: '相見積 3 社添付',
              kind: 'task',
              meta: { owner: '起票者', note: '10 万円以上は相見積 3 社が社内規程で必須' },
            },
            {
              id: 'ap-selfcheck',
              label: '記載要件を満たすか',
              kind: 'decision',
              meta: { note: '金額・勘定科目・添付の 3 点を自動チェック' },
            },
          ],
        },
        {
          id: 'ap-fix',
          label: '差し戻し対応',
          kind: 'group',
          meta: { sla: '1 営業日', note: '全承認段階からの差し戻しがここに集中する' },
          children: [
            {
              id: 'ap-fix-review',
              label: '指摘内容確認',
              kind: 'task',
              meta: { owner: '起票者', sla: '4 時間' },
            },
            {
              id: 'ap-fix-edit',
              label: '稟議書修正',
              kind: 'task',
              meta: { owner: '起票者', system: 'ワークフロー基盤' },
            },
          ],
        },
      ],
    },

    {
      id: 'ap-l1',
      label: '一次承認（課長）',
      kind: 'group',
      meta: { owner: '所属課長', sla: '1 営業日' },
      children: [
        {
          id: 'ap-l1-check',
          label: '業務妥当性確認',
          kind: 'task',
          meta: { owner: '所属課長', sla: '4 時間' },
        },
        { id: 'ap-l1-dec', label: '一次承認可否', kind: 'decision' },
      ],
    },

    {
      id: 'ap-l2',
      label: '二次承認（部長）',
      kind: 'group',
      meta: { owner: '部門長', sla: '2 営業日' },
      children: [
        {
          id: 'ap-l2-budget',
          label: '予算整合確認',
          kind: 'group',
          meta: { owner: '経営企画', sla: '1 営業日' },
          children: [
            {
              id: 'ap-l2-balance',
              label: '予算残高照会',
              kind: 'task',
              meta: { system: '会計システム', sla: '30 分' },
            },
            {
              id: 'ap-l2-roi',
              label: '費用対効果確認',
              kind: 'task',
              meta: { owner: '経営企画', note: '投資回収 3 年以内が基準' },
            },
          ],
        },
        { id: 'ap-l2-dec', label: '二次承認可否', kind: 'decision', meta: { owner: '部門長' } },
      ],
    },

    {
      id: 'ap-audit',
      label: '法務・コンプライアンス',
      kind: 'group',
      meta: { owner: '法務部', sla: '3 営業日' },
      children: [
        {
          id: 'ap-legal',
          label: '契約条項レビュー',
          kind: 'task',
          meta: { owner: '法務部', sla: '2 営業日' },
        },
        {
          id: 'ap-antisocial',
          label: '反社チェック',
          kind: 'task',
          meta: { system: '外部与信調査サービス', sla: '1 営業日' },
        },
        { id: 'ap-audit-dec', label: '法務指摘なしか', kind: 'decision' },
      ],
    },

    {
      id: 'ap-exec',
      label: '最終決裁（役員会）',
      kind: 'group',
      meta: { owner: '役員会', sla: '次回定例まで' },
      children: [
        {
          id: 'ap-exec-agenda',
          label: '役員会付議',
          kind: 'task',
          meta: { owner: '経営企画', note: '毎週火曜の定例に上程' },
        },
        { id: 'ap-exec-dec', label: '決裁可否', kind: 'decision', meta: { owner: '代表取締役' } },
        {
          id: 'ap-exec-record',
          label: '決裁記録登録',
          kind: 'task',
          meta: { system: '文書管理システム', note: '保存年限 10 年' },
        },
      ],
    },

    {
      id: 'ap-post',
      label: '決裁後処理',
      kind: 'group',
      meta: { owner: '調達部', sla: '1 営業日' },
      children: [
        {
          id: 'ap-po',
          label: '発注書発行',
          kind: 'task',
          meta: { owner: '調達部', system: '購買システム' },
        },
        {
          id: 'ap-notify',
          label: '起票者へ決裁通知',
          kind: 'task',
          meta: { system: 'ワークフロー基盤 / メール' },
        },
      ],
    },

    { id: 'ap-end', label: '決裁完了', kind: 'end' },
    { id: 'ap-end-reject', label: '否決・取下げ', kind: 'end', meta: { note: '否決理由を記録して終了' } },
  ],

  links: [
    { from: 'ap-start', to: 'ap-input' },
    { from: 'ap-input', to: 'ap-attach' },
    { from: 'ap-attach', to: 'ap-selfcheck' },
    { from: 'ap-selfcheck', to: 'ap-l1-check', label: '要件充足' },
    { from: 'ap-selfcheck', to: 'ap-input', label: '記載不足', kind: 'loopback' },

    { from: 'ap-l1-check', to: 'ap-l1-dec' },
    { from: 'ap-l1-dec', to: 'ap-l2-balance', label: '承認' },
    { from: 'ap-l1-dec', to: 'ap-fix-review', label: '差し戻し（課長）', kind: 'loopback' },
    { from: 'ap-l1-dec', to: 'ap-end-reject', label: '取下げ', kind: 'exception' },

    { from: 'ap-l2-balance', to: 'ap-l2-roi' },
    { from: 'ap-l2-roi', to: 'ap-l2-dec' },
    { from: 'ap-l2-dec', to: 'ap-legal', label: '承認' },
    { from: 'ap-l2-dec', to: 'ap-fix-review', label: '差し戻し（部長）', kind: 'loopback' },
    { from: 'ap-l2-dec', to: 'ap-end-reject', label: '予算超過で否決', kind: 'exception' },

    { from: 'ap-legal', to: 'ap-antisocial' },
    { from: 'ap-antisocial', to: 'ap-audit-dec' },
    { from: 'ap-audit-dec', to: 'ap-exec-agenda', label: '指摘なし' },
    { from: 'ap-audit-dec', to: 'ap-fix-review', label: '条項修正要', kind: 'loopback' },
    { from: 'ap-audit-dec', to: 'ap-end-reject', label: '反社該当', kind: 'exception' },

    { from: 'ap-exec-agenda', to: 'ap-exec-dec' },
    { from: 'ap-exec-dec', to: 'ap-exec-record', label: '決裁' },
    { from: 'ap-exec-dec', to: 'ap-fix-review', label: '再提出指示', kind: 'loopback' },
    { from: 'ap-exec-dec', to: 'ap-end-reject', label: '否決' },

    { from: 'ap-exec-record', to: 'ap-po' },
    { from: 'ap-po', to: 'ap-notify' },
    { from: 'ap-notify', to: 'ap-end' },

    // 差し戻し対応 → 申請書作成へ戻る（グループまたぎの復路）
    { from: 'ap-fix-review', to: 'ap-fix-edit' },
    { from: 'ap-fix-edit', to: 'ap-selfcheck', label: '再提出', kind: 'loopback' },
    { from: 'ap-fix-edit', to: 'ap-end-reject', label: '起票者が取下げ', kind: 'exception' },
  ],
}

// ---------------------------------------------------------------------------
// 2. インシデント対応フロー
// ---------------------------------------------------------------------------

/**
 * 検知 → 一次切り分け → エスカレーション → 復旧 → 事後対応。
 *
 * 設計意図:
 *   重大度判定（ir-severity）から **6 本の枝** を出す。
 *   6 分岐のうち 3 本は別グループのタスクへ、2 本はグループ外の終端へ飛ぶ exception。
 *   decision の out-degree が 2 を超えたときに、
 *   菱形の周囲へラベル付きエッジをどう並べるかがライブラリごとに大きく違う
 *   （bpmn-js は BPMN のゲートウェイ記法に落とし込むので特に差が出るはず）。
 */
const incidentDoc: FlowDoc = {
  id: 'realistic-incident-response',
  title: 'システム障害インシデント対応フロー',
  description:
    '検知 → 一次切り分け → エスカレーション → 復旧 → 事後対応。重大度判定の decision が 6 分岐し、例外遷移がグループ外の終端へ多数飛ぶ。',
  root: [
    {
      id: 'ir-start',
      label: 'アラート検知',
      kind: 'start',
      meta: { system: '監視基盤（Datadog）', sla: '即時' },
    },

    {
      id: 'ir-triage',
      label: '一次切り分け（NOC）',
      kind: 'group',
      meta: { owner: 'NOC 当番', sla: '15 分' },
      children: [
        {
          id: 'ir-detect',
          label: '検知・受信',
          kind: 'group',
          meta: { sla: '5 分' },
          children: [
            {
              id: 'ir-alert-recv',
              label: 'アラート受信',
              kind: 'task',
              meta: { system: 'PagerDuty', sla: '即時' },
            },
            {
              id: 'ir-dedupe',
              label: '重複アラート集約',
              kind: 'task',
              meta: { note: '同一サービスの連続発報を 1 件に束ねる' },
            },
            {
              id: 'ir-scope',
              label: '影響範囲確認',
              kind: 'task',
              meta: { owner: 'NOC 当番', system: '監視ダッシュボード', sla: '5 分' },
            },
          ],
        },
        {
          id: 'ir-severity',
          label: '重大度判定',
          kind: 'decision',
          meta: { owner: 'NOC 当番', note: 'SEV1〜SEV4 / 誤検知 / 監視対象外 の 6 分岐' },
        },
        {
          id: 'ir-firstaid',
          label: '一次対処（再起動・切離し）',
          kind: 'task',
          meta: { owner: 'NOC 当番', sla: '10 分' },
        },
      ],
    },

    {
      id: 'ir-esc',
      label: 'エスカレーション',
      kind: 'group',
      meta: { sla: '30 分以内に着手' },
      children: [
        {
          id: 'ir-esc-dev',
          label: '開発チーム対応',
          kind: 'group',
          meta: { owner: 'プロダクト開発', sla: '2 時間' },
          children: [
            { id: 'ir-dev-assign', label: '担当アサイン', kind: 'task', meta: { system: 'Slack / Jira' } },
            {
              id: 'ir-dev-log',
              label: 'アプリログ解析',
              kind: 'task',
              meta: { system: 'CloudWatch Logs', sla: '1 時間' },
            },
            { id: 'ir-dev-cause', label: '原因を特定できたか', kind: 'decision' },
          ],
        },
        {
          id: 'ir-esc-infra',
          label: 'インフラチーム対応',
          kind: 'group',
          meta: { owner: 'SRE', sla: '1 時間' },
          children: [
            {
              id: 'ir-infra-check',
              label: '基盤リソース確認',
              kind: 'task',
              meta: { system: 'AWS Console', sla: '20 分' },
            },
            {
              id: 'ir-infra-failover',
              label: 'フェイルオーバー実施',
              kind: 'task',
              meta: { owner: 'SRE', note: '手順書 RUN-014' },
            },
          ],
        },
        {
          id: 'ir-esc-vendor',
          label: 'ベンダー起票',
          kind: 'group',
          meta: { owner: 'ベンダー窓口', sla: 'ベンダー SLA 4 時間' },
          children: [
            { id: 'ir-vendor-ticket', label: 'ベンダー起票', kind: 'task', meta: { system: 'サポートポータル' } },
            { id: 'ir-vendor-wait', label: 'ベンダー回答待ち', kind: 'task', meta: { sla: '4 時間' } },
            { id: 'ir-vendor-sla', label: 'SLA 内に回答ありか', kind: 'decision' },
          ],
        },
      ],
    },

    {
      id: 'ir-comm',
      label: '顧客・社内広報',
      kind: 'group',
      meta: { owner: 'インシデントコマンダー', sla: '30 分ごとに更新' },
      children: [
        {
          id: 'ir-status-page',
          label: 'ステータスページ更新',
          kind: 'task',
          meta: { system: 'Statuspage', sla: '15 分' },
        },
        { id: 'ir-cs-notify', label: 'CS へ一次連絡', kind: 'task', meta: { owner: 'CS 連携担当' } },
        {
          id: 'ir-exec-report',
          label: '経営報告（SEV1 のみ）',
          kind: 'task',
          meta: { owner: 'CTO', sla: '30 分' },
        },
      ],
    },

    {
      id: 'ir-recover',
      label: '復旧',
      kind: 'group',
      meta: { owner: 'インシデントコマンダー' },
      children: [
        {
          id: 'ir-fix-apply',
          label: '暫定対処適用',
          kind: 'task',
          meta: { note: 'ロールバック / フィーチャーフラグ OFF' },
        },
        { id: 'ir-recover-ok', label: '復旧確認 OK か', kind: 'decision', meta: { sla: '15 分' } },
        {
          id: 'ir-monitor',
          label: '経過監視（30 分）',
          kind: 'task',
          meta: { owner: 'NOC 当番', sla: '30 分' },
        },
      ],
    },

    {
      id: 'ir-post',
      label: '事後対応',
      kind: 'group',
      meta: { owner: 'プロダクト開発', sla: '5 営業日' },
      children: [
        { id: 'ir-rca', label: '根本原因分析（RCA）', kind: 'task', meta: { sla: '3 営業日' } },
        { id: 'ir-postmortem', label: 'ポストモーテム作成', kind: 'task', meta: { system: 'Notion' } },
        { id: 'ir-action', label: '再発防止タスク登録', kind: 'task', meta: { system: 'Jira' } },
        { id: 'ir-cs-followup', label: '顧客への最終報告', kind: 'task', meta: { owner: 'CS' } },
      ],
    },

    { id: 'ir-end', label: 'インシデントクローズ', kind: 'end' },
    { id: 'ir-end-false', label: '誤検知クローズ', kind: 'end', meta: { note: '監視閾値の見直し起票のみ' } },
    { id: 'ir-end-outofscope', label: '対象外（監視除外）', kind: 'end' },
  ],

  links: [
    { from: 'ir-start', to: 'ir-alert-recv' },
    { from: 'ir-alert-recv', to: 'ir-dedupe' },
    { from: 'ir-dedupe', to: 'ir-scope' },
    { from: 'ir-scope', to: 'ir-severity' },

    // --- 6 分岐 decision ---
    { from: 'ir-severity', to: 'ir-exec-report', label: 'SEV1 全社障害' },
    { from: 'ir-severity', to: 'ir-dev-assign', label: 'SEV2 機能障害' },
    { from: 'ir-severity', to: 'ir-infra-check', label: 'SEV3 性能劣化' },
    { from: 'ir-severity', to: 'ir-firstaid', label: 'SEV4 軽微' },
    { from: 'ir-severity', to: 'ir-end-false', label: '誤検知', kind: 'exception' },
    { from: 'ir-severity', to: 'ir-end-outofscope', label: '監視対象外', kind: 'exception' },

    // SEV1 は広報と開発が同時に走る
    { from: 'ir-exec-report', to: 'ir-status-page' },
    { from: 'ir-exec-report', to: 'ir-dev-assign' },
    { from: 'ir-status-page', to: 'ir-cs-notify' },

    { from: 'ir-dev-assign', to: 'ir-dev-log' },
    { from: 'ir-dev-log', to: 'ir-dev-cause' },
    { from: 'ir-dev-cause', to: 'ir-fix-apply', label: '特定できた' },
    { from: 'ir-dev-cause', to: 'ir-infra-check', label: '基盤側の疑い', kind: 'exception' },
    { from: 'ir-dev-cause', to: 'ir-vendor-ticket', label: '外部サービス起因', kind: 'exception' },
    { from: 'ir-dev-cause', to: 'ir-dev-log', label: '追加ログ取得', kind: 'loopback' },

    { from: 'ir-infra-check', to: 'ir-infra-failover' },
    { from: 'ir-infra-failover', to: 'ir-fix-apply' },

    { from: 'ir-vendor-ticket', to: 'ir-vendor-wait' },
    { from: 'ir-vendor-wait', to: 'ir-vendor-sla' },
    { from: 'ir-vendor-sla', to: 'ir-fix-apply', label: '回答あり' },
    { from: 'ir-vendor-sla', to: 'ir-exec-report', label: 'SLA 超過でエスカレ', kind: 'exception' },

    { from: 'ir-firstaid', to: 'ir-recover-ok' },
    { from: 'ir-fix-apply', to: 'ir-recover-ok' },
    { from: 'ir-recover-ok', to: 'ir-monitor', label: '復旧' },
    { from: 'ir-recover-ok', to: 'ir-dev-assign', label: '未復旧・再解析', kind: 'loopback' },
    { from: 'ir-recover-ok', to: 'ir-status-page', label: '復旧報を掲示' },

    { from: 'ir-monitor', to: 'ir-rca' },
    { from: 'ir-monitor', to: 'ir-severity', label: '再発検知', kind: 'loopback' },
    { from: 'ir-rca', to: 'ir-postmortem' },
    { from: 'ir-postmortem', to: 'ir-action' },
    { from: 'ir-action', to: 'ir-cs-followup' },
    { from: 'ir-cs-notify', to: 'ir-cs-followup' },
    { from: 'ir-cs-followup', to: 'ir-end' },
  ],
}

// ---------------------------------------------------------------------------
// 3. 受発注プロセス（Order to Cash）
// ---------------------------------------------------------------------------

/**
 * 見積 → 受注 → 手配 → 納品 → 請求 → 入金。
 *
 * 設計意図:
 *   6 つの部門グループを並べ、**部門間の引き継ぎリンクを必ず階層またぎ** にする。
 *   さらに与信管理・品質管理という「横串部門」を置いて、
 *   縦の順路（営業→業務→調達→物流→経理）に対して斜めのリンクを走らせる。
 *   直列に並んだグループの間を斜めに横切るエッジは、
 *   グループ矩形を貫通するか迂回するかがライブラリごとに割れる典型条件。
 */
const orderToCashDoc: FlowDoc = {
  id: 'realistic-order-to-cash',
  title: '受発注プロセス（見積〜入金消込）',
  description:
    '営業 → 業務管理 → 調達 → 物流 → 経理の 5 部門を跨ぐ Order to Cash。与信管理と品質管理が横串で刺さり、部門境界を斜めに横切るリンクが多い。',
  root: [
    { id: 'o2c-start', label: '引合発生', kind: 'start', meta: { system: 'SFA', owner: '営業' } },

    {
      id: 'o2c-sales',
      label: '営業部',
      kind: 'group',
      meta: { owner: '営業部', sla: '5 営業日' },
      children: [
        {
          id: 'o2c-quote',
          label: '見積作成',
          kind: 'group',
          meta: { sla: '2 営業日' },
          children: [
            { id: 'o2c-req-hearing', label: '要件ヒアリング', kind: 'task', meta: { owner: '営業担当' } },
            {
              id: 'o2c-price',
              label: '価格設定・値引申請',
              kind: 'task',
              meta: { system: 'SFA', note: '値引 15% 超は部長承認' },
            },
            { id: 'o2c-quote-issue', label: '見積書発行', kind: 'task', meta: { system: 'SFA', sla: '1 営業日' } },
          ],
        },
        {
          id: 'o2c-nego',
          label: '商談・受注',
          kind: 'group',
          children: [
            { id: 'o2c-nego-dec', label: '受注できたか', kind: 'decision' },
            { id: 'o2c-contract', label: '注文請書取交し', kind: 'task', meta: { system: '電子契約' } },
          ],
        },
      ],
    },

    {
      id: 'o2c-credit',
      label: '与信管理部',
      kind: 'group',
      meta: { owner: '与信管理', sla: '1 営業日', note: '横串部門。受注前と請求前の 2 回呼ばれる' },
      children: [
        {
          id: 'o2c-credit-query',
          label: '与信枠確認',
          kind: 'task',
          meta: { system: '外部信用情報 API', sla: '30 分' },
        },
        { id: 'o2c-credit-dec', label: '与信枠内か', kind: 'decision' },
        {
          id: 'o2c-credit-extend',
          label: '与信枠増額申請',
          kind: 'task',
          meta: { owner: '与信管理課長', sla: '2 営業日' },
        },
      ],
    },

    {
      id: 'o2c-ops',
      label: '業務管理部',
      kind: 'group',
      meta: { owner: '業務管理', sla: '1 営業日' },
      children: [
        { id: 'o2c-order-entry', label: '受注登録', kind: 'task', meta: { system: 'ERP（販売管理）' } },
        {
          id: 'o2c-stock-check',
          label: '在庫引当',
          kind: 'task',
          meta: { system: 'ERP（在庫）', sla: '即時' },
        },
        { id: 'o2c-stock-dec', label: '在庫で充足するか', kind: 'decision' },
      ],
    },

    {
      id: 'o2c-purchase',
      label: '調達部',
      kind: 'group',
      meta: { owner: '調達部', sla: '3 営業日' },
      children: [
        {
          id: 'o2c-vendor-select',
          label: '仕入先選定',
          kind: 'task',
          meta: { owner: 'バイヤー', note: '単価契約先を優先' },
        },
        { id: 'o2c-po-issue', label: '発注書発行', kind: 'task', meta: { system: '購買システム' } },
        { id: 'o2c-po-ack', label: '納期回答受領', kind: 'task', meta: { sla: '2 営業日' } },
        { id: 'o2c-po-dec', label: '希望納期に間に合うか', kind: 'decision' },
      ],
    },

    {
      id: 'o2c-logi',
      label: '物流部',
      kind: 'group',
      meta: { owner: '物流センター', sla: '出荷指示当日' },
      children: [
        {
          id: 'o2c-inbound',
          label: '入荷検品',
          kind: 'group',
          meta: { owner: '検品担当' },
          children: [
            { id: 'o2c-receive', label: '入荷登録', kind: 'task', meta: { system: 'WMS' } },
            { id: 'o2c-inspect', label: '受入検査', kind: 'task', meta: { owner: '品質管理', sla: '1 営業日' } },
            { id: 'o2c-inspect-dec', label: '検査合格か', kind: 'decision' },
          ],
        },
        {
          id: 'o2c-outbound',
          label: '出荷・納品',
          kind: 'group',
          children: [
            { id: 'o2c-pick', label: 'ピッキング・梱包', kind: 'task', meta: { system: 'WMS' } },
            { id: 'o2c-ship', label: '出荷指示', kind: 'task', meta: { system: 'WMS', sla: '当日 15 時締め' } },
            { id: 'o2c-delivery-dec', label: '納品完了したか', kind: 'decision', meta: { note: '受領書の回収で判定' } },
          ],
        },
      ],
    },

    {
      id: 'o2c-acct',
      label: '経理部',
      kind: 'group',
      meta: { owner: '経理部', sla: '月次締めまで' },
      children: [
        {
          id: 'o2c-billing',
          label: '請求',
          kind: 'group',
          meta: { sla: '締日翌営業日' },
          children: [
            { id: 'o2c-sales-record', label: '売上計上', kind: 'task', meta: { system: 'ERP（会計）' } },
            { id: 'o2c-invoice', label: '請求書発行', kind: 'task', meta: { system: '請求書発行 SaaS' } },
            { id: 'o2c-invoice-send', label: '請求書送付', kind: 'task', meta: { note: '適格請求書要件を満たすこと' } },
          ],
        },
        {
          id: 'o2c-collect',
          label: '入金消込',
          kind: 'group',
          children: [
            { id: 'o2c-bank-match', label: '入金消込', kind: 'task', meta: { system: '銀行 API 連携' } },
            { id: 'o2c-paid-dec', label: '期日内入金ありか', kind: 'decision' },
            { id: 'o2c-dunning', label: '督促状発送', kind: 'task', meta: { owner: '債権管理', sla: '期日 +3 営業日' } },
          ],
        },
      ],
    },

    { id: 'o2c-end', label: '取引完了', kind: 'end' },
    { id: 'o2c-end-lost', label: '失注', kind: 'end' },
    { id: 'o2c-end-legal', label: '法的手続きへ移管', kind: 'end', meta: { owner: '法務部' } },
  ],

  links: [
    { from: 'o2c-start', to: 'o2c-req-hearing' },
    { from: 'o2c-req-hearing', to: 'o2c-price' },
    { from: 'o2c-price', to: 'o2c-quote-issue' },
    { from: 'o2c-quote-issue', to: 'o2c-nego-dec' },
    { from: 'o2c-nego-dec', to: 'o2c-end-lost', label: '失注', kind: 'exception' },
    { from: 'o2c-nego-dec', to: 'o2c-req-hearing', label: '仕様変更で再見積', kind: 'loopback' },

    // 営業 → 与信管理（部門またぎ）
    { from: 'o2c-nego-dec', to: 'o2c-credit-query', label: '内示あり' },
    { from: 'o2c-credit-query', to: 'o2c-credit-dec' },
    { from: 'o2c-credit-dec', to: 'o2c-contract', label: '枠内' },
    { from: 'o2c-credit-dec', to: 'o2c-credit-extend', label: '枠超過' },
    { from: 'o2c-credit-extend', to: 'o2c-credit-dec', label: '再判定', kind: 'loopback' },
    { from: 'o2c-credit-extend', to: 'o2c-end-lost', label: '増額不可', kind: 'exception' },

    // 営業 → 業務管理（部門またぎ）
    { from: 'o2c-contract', to: 'o2c-order-entry' },
    { from: 'o2c-order-entry', to: 'o2c-stock-check' },
    { from: 'o2c-stock-check', to: 'o2c-stock-dec' },
    { from: 'o2c-stock-dec', to: 'o2c-pick', label: '在庫あり' },
    // 業務管理 → 調達（部門またぎ）
    { from: 'o2c-stock-dec', to: 'o2c-vendor-select', label: '在庫不足' },

    { from: 'o2c-vendor-select', to: 'o2c-po-issue' },
    { from: 'o2c-po-issue', to: 'o2c-po-ack' },
    { from: 'o2c-po-ack', to: 'o2c-po-dec' },
    // 調達 → 物流（部門またぎ）
    { from: 'o2c-po-dec', to: 'o2c-receive', label: '納期 OK' },
    // 調達 → 営業への差し戻し（4 グループまたぎの逆流）
    { from: 'o2c-po-dec', to: 'o2c-req-hearing', label: '納期遅延で条件再交渉', kind: 'loopback' },
    { from: 'o2c-po-dec', to: 'o2c-vendor-select', label: '仕入先変更', kind: 'loopback' },

    { from: 'o2c-receive', to: 'o2c-inspect' },
    { from: 'o2c-inspect', to: 'o2c-inspect-dec' },
    { from: 'o2c-inspect-dec', to: 'o2c-pick', label: '合格' },
    { from: 'o2c-inspect-dec', to: 'o2c-po-issue', label: '不合格・返品再手配', kind: 'loopback' },

    { from: 'o2c-pick', to: 'o2c-ship' },
    { from: 'o2c-ship', to: 'o2c-delivery-dec' },
    { from: 'o2c-delivery-dec', to: 'o2c-ship', label: '不在再配達', kind: 'loopback' },
    // 物流 → 経理（部門またぎ）
    { from: 'o2c-delivery-dec', to: 'o2c-sales-record', label: '受領書回収' },

    { from: 'o2c-sales-record', to: 'o2c-invoice' },
    { from: 'o2c-invoice', to: 'o2c-invoice-send' },
    { from: 'o2c-invoice-send', to: 'o2c-bank-match' },
    { from: 'o2c-bank-match', to: 'o2c-paid-dec' },
    { from: 'o2c-paid-dec', to: 'o2c-end', label: '入金確認' },
    { from: 'o2c-paid-dec', to: 'o2c-dunning', label: '未入金' },
    { from: 'o2c-dunning', to: 'o2c-bank-match', label: '再確認', kind: 'loopback' },
    { from: 'o2c-dunning', to: 'o2c-end-legal', label: '3 回督促しても未入金', kind: 'exception' },
    // 経理 → 与信管理への横串フィードバック（部門をまたぐ斜めリンク）
    { from: 'o2c-paid-dec', to: 'o2c-credit-query', label: '延滞情報を与信へ反映', kind: 'exception' },
  ],
}

// ---------------------------------------------------------------------------
// 4. データパイプライン（純粋 DAG）
// ---------------------------------------------------------------------------

/**
 * 抽出 → 変換 → 検証 → ロード → 配信。Airflow の DAG を想定。
 *
 * 設計意図:
 *   **循環を 1 本も入れない**。代わりに fan-out / fan-in を強くする。
 *   - 6 ソースからの抽出が 2 つのステージングへ 11 本で合流（fan-in）
 *   - 変換 1 本から 5 つのマート構築へ分岐（fan-out）
 *   - 5 マートが 1 つの整合性チェックへ合流（fan-in）
 *   循環のあるフローを描けないライブラリ（Mermaid の一部レイアウト、
 *   BPMN のシーケンスフロー制約）でも素直に描けるはずのケースなので、
 *   「DAG なら全ライブラリ互角なのか、それでも差が出るのか」の基準線になる。
 */
const pipelineDoc: FlowDoc = {
  id: 'realistic-etl-pipeline',
  title: '売上データ基盤 日次パイプライン（DAG）',
  description:
    '6 ソースからの抽出 → 変換 → 品質検証 → 5 マートへのロード → 配信。循環が 1 本もない純粋な DAG で、並列と合流だけで構成されている。',
  root: [
    { id: 'dp-start', label: '日次バッチ起動', kind: 'start', meta: { system: 'Airflow', sla: '毎日 02:00 JST' } },

    {
      id: 'dp-extract',
      label: '抽出（Extract）',
      kind: 'group',
      meta: { owner: 'データ基盤チーム', sla: '40 分' },
      children: [
        {
          id: 'dp-ex-core',
          label: '基幹系抽出',
          kind: 'group',
          meta: { note: '締め処理完了を待って開始' },
          children: [
            { id: 'dp-ex-sales', label: '販売実績抽出', kind: 'task', meta: { system: 'ERP（販売管理）', sla: '15 分' } },
            { id: 'dp-ex-stock', label: '在庫スナップショット抽出', kind: 'task', meta: { system: 'WMS', sla: '10 分' } },
            { id: 'dp-ex-acct', label: '会計仕訳抽出', kind: 'task', meta: { system: 'ERP（会計）', sla: '20 分' } },
          ],
        },
        {
          id: 'dp-ex-front',
          label: 'フロント系抽出',
          kind: 'group',
          children: [
            { id: 'dp-ex-crm', label: '顧客マスタ抽出', kind: 'task', meta: { system: 'CRM', sla: '10 分' } },
            { id: 'dp-ex-web', label: 'Web 行動ログ抽出', kind: 'task', meta: { system: 'GA4 BigQuery Export' } },
            { id: 'dp-ex-ads', label: '広告費用抽出', kind: 'task', meta: { system: '広告 API', sla: '15 分' } },
          ],
        },
      ],
    },

    {
      id: 'dp-stage',
      label: 'ステージング',
      kind: 'group',
      meta: { owner: 'データ基盤チーム', system: 'S3 / Iceberg', sla: '15 分' },
      children: [
        { id: 'dp-stage-raw', label: 'Raw レイヤ格納', kind: 'task', meta: { note: '型変換せず原本のまま保持' } },
        { id: 'dp-stage-schema', label: 'スキーマ検出', kind: 'task', meta: { system: 'Glue Crawler' } },
        { id: 'dp-stage-partition', label: 'パーティション再構成', kind: 'task', meta: { note: '日付 + 事業部で分割' } },
      ],
    },

    {
      id: 'dp-transform',
      label: '変換（Transform）',
      kind: 'group',
      meta: { owner: 'アナリティクスエンジニア', system: 'dbt', sla: '30 分' },
      children: [
        { id: 'dp-tr-clean', label: 'クレンジング（名寄せ）', kind: 'task', meta: { note: '顧客名の表記ゆれを統合' } },
        { id: 'dp-tr-dedupe', label: '重複排除', kind: 'task' },
        { id: 'dp-tr-join', label: 'ディメンション結合', kind: 'task', meta: { sla: '10 分' } },
        { id: 'dp-tr-currency', label: '為替換算（円建て統一）', kind: 'task', meta: { system: '為替レート API' } },
      ],
    },

    {
      id: 'dp-validate',
      label: '品質検証（Validate）',
      kind: 'group',
      meta: { owner: 'データ基盤チーム', system: 'dbt test', sla: '10 分' },
      children: [
        { id: 'dp-va-notnull', label: '必須項目 NULL 検査', kind: 'task' },
        { id: 'dp-va-unique', label: '主キー一意性検査', kind: 'task' },
        { id: 'dp-va-range', label: '金額レンジ検査', kind: 'task', meta: { note: '前日比 ±30% 超で警告' } },
        { id: 'dp-va-recon', label: '基幹系との突合', kind: 'task', meta: { note: '売上合計の差分 0 円を確認' } },
        { id: 'dp-va-dec', label: '検証を通過したか', kind: 'decision' },
      ],
    },

    {
      id: 'dp-load',
      label: 'ロード（Load）',
      kind: 'group',
      meta: { owner: 'データ基盤チーム', system: 'Snowflake', sla: '20 分' },
      children: [
        { id: 'dp-ld-sales-mart', label: '売上マート構築', kind: 'task' },
        { id: 'dp-ld-cust-mart', label: '顧客マート構築', kind: 'task' },
        { id: 'dp-ld-stock-mart', label: '在庫マート構築', kind: 'task' },
        { id: 'dp-ld-mkt-mart', label: 'マーケ効果マート構築', kind: 'task' },
        { id: 'dp-ld-fin-mart', label: '財務マート構築', kind: 'task' },
        { id: 'dp-ld-consistency', label: 'マート間整合チェック', kind: 'task', meta: { note: '5 マートの合流点' } },
      ],
    },

    {
      id: 'dp-serve',
      label: '配信・公開',
      kind: 'group',
      meta: { owner: 'BI 担当', sla: '08:00 までに公開' },
      children: [
        { id: 'dp-sv-bi', label: 'BI ダッシュボード更新', kind: 'task', meta: { system: 'Looker Studio' } },
        { id: 'dp-sv-reverse', label: 'CRM へリバース ETL', kind: 'task', meta: { system: 'CRM' } },
        { id: 'dp-sv-notify', label: '完了通知（Slack）', kind: 'task', meta: { system: 'Slack' } },
      ],
    },

    { id: 'dp-end', label: '正常終了', kind: 'end' },
    { id: 'dp-end-failed', label: '異常終了（要 手動対応）', kind: 'end', meta: { owner: 'データ基盤オンコール' } },
  ],

  links: [
    // fan-out: 起動 → 6 抽出タスク
    { from: 'dp-start', to: 'dp-ex-sales' },
    { from: 'dp-start', to: 'dp-ex-stock' },
    { from: 'dp-start', to: 'dp-ex-acct' },
    { from: 'dp-start', to: 'dp-ex-crm' },
    { from: 'dp-start', to: 'dp-ex-web' },
    { from: 'dp-start', to: 'dp-ex-ads' },

    // fan-in: 6 抽出 → Raw 格納
    { from: 'dp-ex-sales', to: 'dp-stage-raw' },
    { from: 'dp-ex-stock', to: 'dp-stage-raw' },
    { from: 'dp-ex-acct', to: 'dp-stage-raw' },
    { from: 'dp-ex-crm', to: 'dp-stage-raw' },
    { from: 'dp-ex-web', to: 'dp-stage-raw' },
    { from: 'dp-ex-ads', to: 'dp-stage-raw' },

    { from: 'dp-stage-raw', to: 'dp-stage-schema' },
    { from: 'dp-stage-schema', to: 'dp-stage-partition' },

    // fan-out: ステージング → 変換 4 タスク（並列実行）
    { from: 'dp-stage-partition', to: 'dp-tr-clean' },
    { from: 'dp-stage-partition', to: 'dp-tr-dedupe' },
    { from: 'dp-stage-partition', to: 'dp-tr-currency' },
    { from: 'dp-tr-clean', to: 'dp-tr-join' },
    { from: 'dp-tr-dedupe', to: 'dp-tr-join' },
    { from: 'dp-tr-currency', to: 'dp-tr-join' },

    // fan-out: 変換 → 検証 4 タスク
    { from: 'dp-tr-join', to: 'dp-va-notnull' },
    { from: 'dp-tr-join', to: 'dp-va-unique' },
    { from: 'dp-tr-join', to: 'dp-va-range' },
    { from: 'dp-tr-join', to: 'dp-va-recon' },
    { from: 'dp-va-notnull', to: 'dp-va-dec' },
    { from: 'dp-va-unique', to: 'dp-va-dec' },
    { from: 'dp-va-range', to: 'dp-va-dec' },
    { from: 'dp-va-recon', to: 'dp-va-dec' },

    // 失敗時は再実行せず異常終了（循環を作らないための実務上の割り切り）
    { from: 'dp-va-dec', to: 'dp-end-failed', label: '検証 NG' },

    // fan-out: 検証通過 → 5 マート
    { from: 'dp-va-dec', to: 'dp-ld-sales-mart', label: '検証 OK' },
    { from: 'dp-va-dec', to: 'dp-ld-cust-mart', label: '検証 OK' },
    { from: 'dp-va-dec', to: 'dp-ld-stock-mart', label: '検証 OK' },
    { from: 'dp-va-dec', to: 'dp-ld-mkt-mart', label: '検証 OK' },
    { from: 'dp-va-dec', to: 'dp-ld-fin-mart', label: '検証 OK' },

    // fan-in: 5 マート → 整合チェック
    { from: 'dp-ld-sales-mart', to: 'dp-ld-consistency' },
    { from: 'dp-ld-cust-mart', to: 'dp-ld-consistency' },
    { from: 'dp-ld-stock-mart', to: 'dp-ld-consistency' },
    { from: 'dp-ld-mkt-mart', to: 'dp-ld-consistency' },
    { from: 'dp-ld-fin-mart', to: 'dp-ld-consistency' },

    // マートから直接配信へ抜ける経路（グループをまたぐショートカット）
    { from: 'dp-ld-sales-mart', to: 'dp-sv-bi' },
    { from: 'dp-ld-cust-mart', to: 'dp-sv-reverse' },
    { from: 'dp-ld-consistency', to: 'dp-sv-bi' },
    { from: 'dp-ld-consistency', to: 'dp-sv-reverse' },
    { from: 'dp-sv-bi', to: 'dp-sv-notify' },
    { from: 'dp-sv-reverse', to: 'dp-sv-notify' },
    { from: 'dp-sv-notify', to: 'dp-end' },
  ],
}

// ---------------------------------------------------------------------------
// 5. 状態遷移図（チケットのステータス）
// ---------------------------------------------------------------------------

/**
 * 受付済 → 処理中 → 保留 → 完了 → キャンセル / 再オープン。
 *
 * 設計意図:
 *   これは「フローチャート」ではなく **状態機械**。
 *   処理中 ⇄ 保留、処理中 ⇄ レビュー待ち のように **双方向の辺が本質的にある** ため、
 *   ランクベースのレイヤードレイアウト（dagre / ELK layered）は
 *   前後関係を決められず、辺の半分を逆向き扱いにして描く。
 *   逆に力学系レイアウト（Cytoscape の cose / G6 の force）は素直に描けるはず。
 *   「同じデータでも、レイアウトアルゴリズムの家系で見た目が根本的に変わる」ことを見る。
 *   ノード数はわざと少なく（20 未満）して、差がレイアウト由来だと分かるようにした。
 */
const stateMachineDoc: FlowDoc = {
  id: 'realistic-ticket-state-machine',
  title: '保守チケット 状態遷移図',
  description:
    '受付済 / 処理中 / 保留 / レビュー待ち / 完了 / 却下 の状態機械。双方向の遷移が多く、ランクベースのレイアウトでは前後関係が決まらない。',
  root: [
    { id: 'sm-start', label: 'チケット起票', kind: 'start', meta: { system: 'Jira Service Management' } },

    { id: 'sm-new', label: '受付済（New）', kind: 'task', meta: { owner: 'ヘルプデスク', sla: '4 時間で一次判定' } },
    { id: 'sm-triage', label: '振分判定', kind: 'decision', meta: { owner: 'ヘルプデスク' } },

    {
      id: 'sm-active',
      label: '稼働中ステータス群',
      kind: 'group',
      meta: { owner: '保守チーム', note: 'この 3 状態の間を何度も往復する' },
      children: [
        { id: 'sm-progress', label: '処理中（In Progress）', kind: 'task', meta: { owner: '担当エンジニア', sla: '5 営業日' } },
        {
          id: 'sm-hold',
          label: '保留（On Hold）',
          kind: 'task',
          meta: { note: '顧客回答待ち / ベンダー回答待ち', sla: '最長 30 日' },
        },
        { id: 'sm-review', label: 'レビュー待ち（In Review）', kind: 'task', meta: { owner: 'テックリード' } },
      ],
    },

    { id: 'sm-verify', label: '顧客検証中（UAT）', kind: 'task', meta: { owner: '顧客', sla: '5 営業日' } },
    { id: 'sm-verify-dec', label: '顧客が受け入れたか', kind: 'decision' },
    { id: 'sm-resolved', label: '解決済（Resolved）', kind: 'task', meta: { note: '30 日で自動クローズ' } },
    { id: 'sm-reopen', label: '再オープン（Reopened）', kind: 'task', meta: { owner: '顧客' } },
    { id: 'sm-rejected', label: '却下（Rejected）', kind: 'task', meta: { note: '仕様通り / 対応対象外' } },
    { id: 'sm-cancel', label: 'キャンセル（Cancelled）', kind: 'task', meta: { owner: '起票者' } },

    { id: 'sm-closed', label: 'クローズ', kind: 'end' },
  ],

  links: [
    { from: 'sm-start', to: 'sm-new' },
    { from: 'sm-new', to: 'sm-triage' },
    { from: 'sm-triage', to: 'sm-progress', label: '対応する' },
    { from: 'sm-triage', to: 'sm-hold', label: '情報不足で保留' },
    { from: 'sm-triage', to: 'sm-rejected', label: '対象外' },
    { from: 'sm-triage', to: 'sm-cancel', label: '起票者が取消' },

    // --- 双方向の循環（ここが本質） ---
    { from: 'sm-progress', to: 'sm-hold', label: '回答待ちへ' },
    { from: 'sm-hold', to: 'sm-progress', label: '回答受領で再開', kind: 'loopback' },
    { from: 'sm-progress', to: 'sm-review', label: 'レビュー依頼' },
    { from: 'sm-review', to: 'sm-progress', label: '指摘あり', kind: 'loopback' },
    { from: 'sm-review', to: 'sm-hold', label: '設計方針の確認待ち' },
    { from: 'sm-hold', to: 'sm-review', label: '方針確定', kind: 'loopback' },

    // 稼働中グループから外へ
    { from: 'sm-review', to: 'sm-verify', label: 'レビュー通過' },
    { from: 'sm-progress', to: 'sm-rejected', label: '再現せず', kind: 'exception' },
    { from: 'sm-hold', to: 'sm-cancel', label: '30 日超過で自動取消', kind: 'exception' },
    { from: 'sm-progress', to: 'sm-new', label: '担当外のため差し戻し', kind: 'loopback' },

    { from: 'sm-verify', to: 'sm-verify-dec' },
    { from: 'sm-verify-dec', to: 'sm-resolved', label: '受入 OK' },
    { from: 'sm-verify-dec', to: 'sm-progress', label: '受入 NG', kind: 'loopback' },
    { from: 'sm-verify-dec', to: 'sm-hold', label: '検証環境待ち', kind: 'loopback' },

    { from: 'sm-resolved', to: 'sm-closed', label: '30 日経過で自動クローズ' },
    { from: 'sm-resolved', to: 'sm-reopen', label: '再発報告', kind: 'loopback' },
    { from: 'sm-reopen', to: 'sm-progress', label: '再着手', kind: 'loopback' },
    { from: 'sm-reopen', to: 'sm-triage', label: '再振分', kind: 'loopback' },

    { from: 'sm-rejected', to: 'sm-closed' },
    { from: 'sm-rejected', to: 'sm-triage', label: '判定に異議', kind: 'loopback' },
    { from: 'sm-cancel', to: 'sm-closed' },
  ],
}

// ---------------------------------------------------------------------------
// 6. カスタマーサポート対応
// ---------------------------------------------------------------------------

/**
 * 問い合わせ受付から解決まで。
 *
 * 設計意図:
 *   **同一ノードへの合流（fan-in）を極端に多くする**。
 *   - `cs-answer`（一次回答作成）へ 8 本
 *   - `cs-close`（クローズ処理）へ 9 本
 *   合流点のノードは入次数が 2 桁近くになるので、
 *   ポート（接続点）を持つライブラリ（JointJS / X6 / bpmn-js）は
 *   1 点に集中させるか辺に沿って分散させるかで見た目が割れる。
 *   さらに合流元が別グループに散っているので、
 *   グループ折りたたみ時に「N 本 → 1 本」へ集約されるかどうかも同時に見る。
 */
const supportDoc: FlowDoc = {
  id: 'realistic-support-desk',
  title: 'カスタマーサポート 問い合わせ対応フロー',
  description:
    '5 チャネルからの問い合わせが一次回答作成へ 8 本、クローズ処理へ 9 本合流する。合流点の入次数が極端に高い実務パターン。',
  root: [
    { id: 'cs-start', label: '問い合わせ発生', kind: 'start' },

    {
      id: 'cs-intake',
      label: '受付チャネル',
      kind: 'group',
      meta: { owner: 'CS 一次受付', sla: '営業時間内 1 時間' },
      children: [
        { id: 'cs-ch-tel', label: '電話受付', kind: 'task', meta: { system: 'Zoom Phone', sla: '3 コール以内' } },
        { id: 'cs-ch-mail', label: 'メール受付', kind: 'task', meta: { system: 'Zendesk', sla: '1 営業日' } },
        { id: 'cs-ch-chat', label: 'チャット受付', kind: 'task', meta: { system: 'Web チャット', sla: '3 分' } },
        { id: 'cs-ch-form', label: 'Web フォーム受付', kind: 'task', meta: { system: 'Web フォーム' } },
        { id: 'cs-ch-line', label: 'LINE 受付', kind: 'task', meta: { system: 'LINE 公式アカウント' } },
        { id: 'cs-ticket', label: 'チケット起票', kind: 'task', meta: { system: 'Zendesk', note: '全チャネルの合流点' } },
      ],
    },

    {
      id: 'cs-triage',
      label: '一次切り分け',
      kind: 'group',
      meta: { owner: 'CS 一次受付', sla: '30 分' },
      children: [
        { id: 'cs-identify', label: '顧客情報照会', kind: 'task', meta: { system: 'CRM', sla: '5 分' } },
        { id: 'cs-category', label: '問い合わせ種別判定', kind: 'decision', meta: { note: '請求 / 技術 / 解約 / 苦情 / その他' } },
        { id: 'cs-faq', label: 'FAQ 検索', kind: 'task', meta: { system: 'ナレッジベース' } },
        { id: 'cs-answer', label: '一次回答作成', kind: 'task', meta: { owner: 'CS 一次受付', note: '多方向からの合流点' } },
      ],
    },

    {
      id: 'cs-specialist',
      label: '専門チーム対応',
      kind: 'group',
      meta: { sla: '2 営業日' },
      children: [
        {
          id: 'cs-billing',
          label: '請求担当',
          kind: 'group',
          meta: { owner: '経理 CS' },
          children: [
            { id: 'cs-bill-check', label: '請求明細照会', kind: 'task', meta: { system: '請求システム' } },
            { id: 'cs-bill-dec', label: '請求誤りか', kind: 'decision' },
            { id: 'cs-bill-refund', label: '返金処理', kind: 'task', meta: { sla: '5 営業日', owner: '経理部' } },
          ],
        },
        {
          id: 'cs-tech',
          label: '技術担当',
          kind: 'group',
          meta: { owner: 'テクニカルサポート' },
          children: [
            { id: 'cs-tech-repro', label: '事象再現確認', kind: 'task', meta: { sla: '1 営業日' } },
            { id: 'cs-tech-dec', label: '既知不具合か', kind: 'decision' },
            { id: 'cs-tech-bug', label: '不具合起票', kind: 'task', meta: { system: 'Jira' } },
          ],
        },
        {
          id: 'cs-retention',
          label: '解約抑止担当',
          kind: 'group',
          meta: { owner: 'カスタマーサクセス' },
          children: [
            { id: 'cs-ret-hearing', label: '解約理由ヒアリング', kind: 'task' },
            { id: 'cs-ret-offer', label: '代替プラン提案', kind: 'task', meta: { note: 'ダウングレード / 一時停止' } },
            { id: 'cs-ret-dec', label: '解約を撤回したか', kind: 'decision' },
          ],
        },
      ],
    },

    {
      id: 'cs-escalation',
      label: 'エスカレーション',
      kind: 'group',
      meta: { owner: 'CS マネージャ', sla: '当日中' },
      children: [
        { id: 'cs-esc-sv', label: 'SV 引き継ぎ', kind: 'task', meta: { owner: 'SV' } },
        { id: 'cs-esc-complaint', label: '苦情対応（役職者）', kind: 'task', meta: { owner: 'CS マネージャ' } },
        { id: 'cs-esc-legal', label: '法務相談', kind: 'task', meta: { owner: '法務部', sla: '3 営業日' } },
      ],
    },

    {
      id: 'cs-close',
      label: 'クローズ処理',
      kind: 'group',
      meta: { owner: 'CS 一次受付', note: '全経路がここへ合流する' },
      children: [
        { id: 'cs-close-reply', label: '最終回答送付', kind: 'task', meta: { system: 'Zendesk' } },
        { id: 'cs-close-confirm', label: '解決確認', kind: 'decision', meta: { sla: '3 営業日で自動クローズ' } },
        { id: 'cs-close-record', label: '対応履歴登録', kind: 'task', meta: { system: 'CRM' } },
        { id: 'cs-close-csat', label: 'CSAT アンケート送付', kind: 'task', meta: { system: 'Zendesk' } },
        { id: 'cs-close-kb', label: 'FAQ へナレッジ反映', kind: 'task', meta: { system: 'ナレッジベース' } },
      ],
    },

    { id: 'cs-end', label: '対応完了', kind: 'end' },
    { id: 'cs-end-churn', label: '解約成立', kind: 'end', meta: { owner: '業務管理' } },
  ],

  links: [
    // 5 チャネル → チケット起票（fan-in その 1）
    { from: 'cs-start', to: 'cs-ch-tel' },
    { from: 'cs-start', to: 'cs-ch-mail' },
    { from: 'cs-start', to: 'cs-ch-chat' },
    { from: 'cs-start', to: 'cs-ch-form' },
    { from: 'cs-start', to: 'cs-ch-line' },
    { from: 'cs-ch-tel', to: 'cs-ticket' },
    { from: 'cs-ch-mail', to: 'cs-ticket' },
    { from: 'cs-ch-chat', to: 'cs-ticket' },
    { from: 'cs-ch-form', to: 'cs-ticket' },
    { from: 'cs-ch-line', to: 'cs-ticket' },

    { from: 'cs-ticket', to: 'cs-identify' },
    { from: 'cs-identify', to: 'cs-category' },

    // 種別判定の 5 分岐
    { from: 'cs-category', to: 'cs-faq', label: '一般質問' },
    { from: 'cs-category', to: 'cs-bill-check', label: '請求' },
    { from: 'cs-category', to: 'cs-tech-repro', label: '技術' },
    { from: 'cs-category', to: 'cs-ret-hearing', label: '解約' },
    { from: 'cs-category', to: 'cs-esc-complaint', label: '苦情' },

    // --- cs-answer への合流（fan-in その 2。8 本） ---
    { from: 'cs-faq', to: 'cs-answer', label: 'FAQ ヒット' },
    { from: 'cs-identify', to: 'cs-answer', label: '既存回答あり' },
    { from: 'cs-bill-dec', to: 'cs-answer', label: '請求は正当' },
    { from: 'cs-bill-refund', to: 'cs-answer' },
    { from: 'cs-tech-dec', to: 'cs-answer', label: '既知・回避策あり' },
    { from: 'cs-tech-bug', to: 'cs-answer', label: '調査中と回答' },
    { from: 'cs-ret-offer', to: 'cs-answer' },
    { from: 'cs-esc-sv', to: 'cs-answer' },

    { from: 'cs-bill-check', to: 'cs-bill-dec' },
    { from: 'cs-bill-dec', to: 'cs-bill-refund', label: '請求誤り' },
    { from: 'cs-bill-dec', to: 'cs-esc-sv', label: '判断困難', kind: 'exception' },

    { from: 'cs-tech-repro', to: 'cs-tech-dec' },
    { from: 'cs-tech-dec', to: 'cs-tech-bug', label: '新規不具合' },
    { from: 'cs-tech-dec', to: 'cs-tech-repro', label: '情報不足で再確認', kind: 'loopback' },
    { from: 'cs-tech-bug', to: 'cs-esc-sv', label: '重大度高', kind: 'exception' },

    { from: 'cs-ret-hearing', to: 'cs-ret-offer' },
    { from: 'cs-ret-offer', to: 'cs-ret-dec' },
    { from: 'cs-ret-dec', to: 'cs-end-churn', label: '解約実行' },
    { from: 'cs-ret-dec', to: 'cs-ret-offer', label: '別条件を再提案', kind: 'loopback' },

    { from: 'cs-esc-complaint', to: 'cs-esc-legal', label: '法的主張あり', kind: 'exception' },
    { from: 'cs-esc-complaint', to: 'cs-esc-sv' },

    // --- cs-close-reply への合流（fan-in その 3。9 本） ---
    { from: 'cs-answer', to: 'cs-close-reply' },
    { from: 'cs-bill-refund', to: 'cs-close-reply', label: '返金完了報告' },
    { from: 'cs-tech-bug', to: 'cs-close-reply', label: '修正リリース報告' },
    { from: 'cs-ret-dec', to: 'cs-close-reply', label: '撤回' },
    { from: 'cs-esc-sv', to: 'cs-close-reply' },
    { from: 'cs-esc-complaint', to: 'cs-close-reply' },
    { from: 'cs-esc-legal', to: 'cs-close-reply' },
    { from: 'cs-faq', to: 'cs-close-reply', label: '自己解決' },
    { from: 'cs-ticket', to: 'cs-close-reply', label: '重複チケット', kind: 'exception' },

    { from: 'cs-close-reply', to: 'cs-close-confirm' },
    { from: 'cs-close-confirm', to: 'cs-close-record', label: '解決' },
    { from: 'cs-close-confirm', to: 'cs-identify', label: '未解決で再調査', kind: 'loopback' },
    { from: 'cs-close-record', to: 'cs-close-csat' },
    { from: 'cs-close-record', to: 'cs-close-kb' },
    { from: 'cs-close-csat', to: 'cs-end' },
    { from: 'cs-close-kb', to: 'cs-end' },
  ],
}

// ---------------------------------------------------------------------------
// 7. 督促・債権回収
// ---------------------------------------------------------------------------

/**
 * 期日超過の検知から、督促 → 内容証明 → 法的手続きまで。
 *
 * 設計意図:
 *   実務の督促は「同じ手順を回数だけ変えて繰り返す」ので、
 *   **自己ループに近い短い循環** と **回数で抜ける decision** が並ぶ。
 *   さらに督促の各段階から「入金あり」で同じ終端（入金消込）へ抜ける
 *   ショートカットが 4 本走るので、
 *   長い直列 + 短絡エッジという、レイヤードレイアウトが最も苦手な形になる。
 *   （直列の段数が多いほど、短絡エッジが何レイヤーも飛び越える）
 */
const dunningDoc: FlowDoc = {
  id: 'realistic-collection-dunning',
  title: '売掛金 督促・債権回収フロー',
  description:
    '期日超過検知から段階督促（架電 → 督促状 → 内容証明 → 法的手続き）まで。各段階から入金消込への短絡エッジが 4 本走る。',
  root: [
    {
      id: 'dn-start',
      label: '入金期日到来',
      kind: 'start',
      meta: { system: '会計システム（日次バッチ）', sla: '毎営業日 07:00' },
    },

    {
      id: 'dn-detect',
      label: '延滞検知',
      kind: 'group',
      meta: { owner: '債権管理課', sla: '期日翌営業日' },
      children: [
        { id: 'dn-match', label: '入金消込', kind: 'task', meta: { system: '銀行 API 連携', sla: '30 分' } },
        { id: 'dn-overdue-dec', label: '期日超過か', kind: 'decision' },
        {
          id: 'dn-amount-dec',
          label: '延滞金額の区分',
          kind: 'decision',
          meta: { note: '10 万円未満 / 10〜100 万円 / 100 万円以上 の 3 区分' },
        },
      ],
    },

    {
      id: 'dn-soft',
      label: 'ソフト督促',
      kind: 'group',
      meta: { owner: '債権管理課', sla: '期日 +3 営業日' },
      children: [
        { id: 'dn-mail1', label: '入金案内メール送信', kind: 'task', meta: { system: 'MA ツール' } },
        { id: 'dn-call', label: '担当者へ架電', kind: 'task', meta: { owner: '債権管理担当', sla: '2 営業日以内' } },
        { id: 'dn-call-dec', label: '入金予定を確認できたか', kind: 'decision' },
        { id: 'dn-promise', label: '入金予定日を登録', kind: 'task', meta: { system: '債権管理台帳' } },
      ],
    },

    {
      id: 'dn-hard',
      label: '正式督促',
      kind: 'group',
      meta: { owner: '債権管理課長', sla: '期日 +15 営業日' },
      children: [
        { id: 'dn-letter', label: '督促状発送', kind: 'task', meta: { note: '簡易書留。発送回数を台帳に記録' } },
        { id: 'dn-letter-count', label: '督促 3 回に達したか', kind: 'decision' },
        {
          id: 'dn-sales-escalate',
          label: '営業担当へ回収依頼',
          kind: 'task',
          meta: { owner: '営業部', note: '取引継続の可否も併せて判断' },
        },
        { id: 'dn-stop-shipping', label: '出荷停止措置', kind: 'task', meta: { owner: '業務管理部', system: 'ERP' } },
      ],
    },

    {
      id: 'dn-legal',
      label: '法的手続き',
      kind: 'group',
      meta: { owner: '法務部', sla: '期日 +60 日' },
      children: [
        { id: 'dn-content-mail', label: '内容証明郵便送付', kind: 'task', meta: { owner: '顧問弁護士' } },
        { id: 'dn-legal-dec', label: '任意弁済に応じたか', kind: 'decision', meta: { sla: '到達後 14 日' } },
        { id: 'dn-suit', label: '支払督促申立', kind: 'task', meta: { note: '簡易裁判所へ申立' } },
        { id: 'dn-seizure', label: '債権差押手続き', kind: 'task', meta: { owner: '顧問弁護士' } },
      ],
    },

    {
      id: 'dn-writeoff',
      label: '貸倒処理',
      kind: 'group',
      meta: { owner: '経理部', sla: '決算期末まで' },
      children: [
        { id: 'dn-reserve', label: '貸倒引当金計上', kind: 'task', meta: { system: 'ERP（会計）' } },
        { id: 'dn-writeoff-apply', label: '貸倒損失申請', kind: 'task', meta: { note: '取締役会決議が必要' } },
      ],
    },

    { id: 'dn-end-paid', label: '回収完了', kind: 'end' },
    { id: 'dn-end-writeoff', label: '貸倒確定', kind: 'end' },
  ],

  links: [
    { from: 'dn-start', to: 'dn-match' },
    { from: 'dn-match', to: 'dn-overdue-dec' },
    { from: 'dn-overdue-dec', to: 'dn-end-paid', label: '入金済' },
    { from: 'dn-overdue-dec', to: 'dn-amount-dec', label: '未入金' },

    { from: 'dn-amount-dec', to: 'dn-mail1', label: '10 万円未満' },
    { from: 'dn-amount-dec', to: 'dn-call', label: '10〜100 万円' },
    { from: 'dn-amount-dec', to: 'dn-letter', label: '100 万円以上' },

    { from: 'dn-mail1', to: 'dn-call' },
    { from: 'dn-call', to: 'dn-call-dec' },
    { from: 'dn-call-dec', to: 'dn-promise', label: '予定を確認' },
    { from: 'dn-call-dec', to: 'dn-call', label: '不在・再架電', kind: 'loopback' },
    { from: 'dn-call-dec', to: 'dn-letter', label: '連絡つかず' },
    // 短絡エッジ 1 本目
    { from: 'dn-promise', to: 'dn-match', label: '予定日に再消込', kind: 'loopback' },

    { from: 'dn-letter', to: 'dn-letter-count' },
    { from: 'dn-letter-count', to: 'dn-letter', label: '3 回未満・再送付', kind: 'loopback' },
    { from: 'dn-letter-count', to: 'dn-sales-escalate', label: '3 回到達' },
    { from: 'dn-sales-escalate', to: 'dn-stop-shipping', label: '取引継続不可' },
    // 短絡エッジ 2 本目（営業回収で入金 → 消込へ戻る）
    { from: 'dn-sales-escalate', to: 'dn-match', label: '営業経由で入金', kind: 'loopback' },
    { from: 'dn-stop-shipping', to: 'dn-content-mail' },

    { from: 'dn-content-mail', to: 'dn-legal-dec' },
    // 短絡エッジ 3 本目
    { from: 'dn-legal-dec', to: 'dn-match', label: '任意弁済あり', kind: 'loopback' },
    { from: 'dn-legal-dec', to: 'dn-suit', label: '応じず' },
    { from: 'dn-suit', to: 'dn-seizure', label: '異議なし・債務名義取得' },
    { from: 'dn-suit', to: 'dn-reserve', label: '異議申立あり', kind: 'exception' },
    // 短絡エッジ 4 本目
    { from: 'dn-seizure', to: 'dn-match', label: '差押で回収', kind: 'loopback' },
    { from: 'dn-seizure', to: 'dn-reserve', label: '回収不能' },

    { from: 'dn-reserve', to: 'dn-writeoff-apply' },
    { from: 'dn-writeoff-apply', to: 'dn-end-writeoff' },
    // 貸倒処理中でも入金があれば戻る（実務では稀だが台帳上は経路がある）
    { from: 'dn-reserve', to: 'dn-match', label: '一部入金あり', kind: 'loopback' },
  ],
}

// ---------------------------------------------------------------------------
// export
// ---------------------------------------------------------------------------

export const realisticCases: TestCase[] = [
  {
    id: 'realistic-approval-multi-stage',
    label: '多段階承認',
    purpose:
      '4 段階承認（課長 → 部長 → 法務 → 役員会）の否認を、すべて申請部門の「差し戻し対応」1 ノードへ戻す。深さ 3 のグループ境界を 2 回抜ける後方エッジを 4 本張り、階層をまたぐ loopback がグループ矩形を貫くか迂回するかを見る。',
    stress: ['realistic', 'cycles', 'edge-routing', 'hierarchy-depth'],
    expectation:
      'dagre 系（React Flow / Reaflow / LogicFlow）はサブフロー内の後方エッジでランクが崩れ、差し戻し先ノードが上に飛ぶと予想。ELK（maxGraph / JointJS の layered）は hierarchyHandling があるので階層をまたいでも耐えるはず。Mermaid は subgraph 間の後方エッジを描けるが交差が読めなくなる。bpmn-js は差し戻しを BPMN のシーケンスフローに落とせるので、逆に一番「業務フローらしく」見える可能性がある。',
    doc: approvalDoc,
  },
  {
    id: 'realistic-incident-response',
    label: 'インシデント対応',
    purpose:
      '重大度判定の decision から 6 本の枝を出し、うち 2 本はグループ外の終端へ飛ぶ exception にする。out-degree 6 の菱形の周りにラベル付きエッジを並べたときの破綻具合と、エスカレーション 3 チームへの分岐・再合流を見る。',
    stress: ['realistic', 'edge-routing', 'layout-width'],
    expectation:
      'bpmn-js は排他ゲートウェイの記法上 6 分岐を扱えるが、ラベルが菱形の周囲に重なると予想。Mermaid はラベル付き 6 分岐でノード幅が広がり横に伸びるはず。Cytoscape（cose）は decision を中心に放射状に配置して一番読みやすくなるかもしれない。React Flow は 6 本すべてが同じハンドルから出るのでエッジが束になって重なると予想。',
    doc: incidentDoc,
  },
  {
    id: 'realistic-order-to-cash',
    label: '受発注 O2C',
    purpose:
      '営業 → 業務管理 → 調達 → 物流 → 経理の 5 部門を跨ぐ Order to Cash。部門間の引き継ぎリンクをすべて階層またぎにし、さらに与信管理を横串部門として置いて「直列に並んだ 6 グループを斜めに横切るエッジ」を 3 本作った。グループ矩形を貫通するか迂回するかを比較する。',
    stress: ['realistic', 'edge-routing', 'hierarchy-depth', 'edge-aggregation'],
    expectation:
      'JointJS / X6 はマンハッタンルーティングでグループを避けて回り込むが、その分エッジが長くなり画面外へはみ出すと予想。React Flow + dagre はグループ矩形を素通りして貫通する（compound を考慮しないため）。Cytoscape は compound ノードに対応しているので、grid / dagre 拡張でも比較的まともに回避するはず。折りたたみ時に部門間 3 本が 1 本へ集約されるかも同時に見る。',
    doc: orderToCashDoc,
  },
  {
    id: 'realistic-etl-pipeline',
    label: 'データ基盤 DAG',
    purpose:
      '循環を 1 本も持たない純粋な DAG。6 抽出 → Raw への 6 本 fan-in、検証通過 → 5 マートへの 5 本 fan-out、5 マート → 整合チェックへの 5 本 fan-in を連続させる。「DAG なら全ライブラリ互角なのか、それでも差が出るのか」の基準線として置く。',
    stress: ['realistic', 'layout-width', 'edge-aggregation'],
    expectation:
      'DAG なので全ライブラリが破綻せずに描けるはず、というのが予想。差が出るとすれば fan-in / fan-out の幅の取り方で、dagre 系は 6 並列を等間隔に並べて横に広がり、ELK は layerConstraint で詰めるので縦長になると見ている。マートから配信への「1 レイヤー飛ばし」エッジをどう通すかでも割れるはず。ここで大きな差が出たら、そのライブラリは DAG 以外では確実に厳しい。',
    doc: pipelineDoc,
  },
  {
    id: 'realistic-ticket-state-machine',
    label: '状態遷移図',
    purpose:
      '処理中 ⇄ 保留 ⇄ レビュー待ちのように双方向の遷移が本質的にある状態機械。ノード数を 20 未満に抑えて、見た目の差がノード数ではなくレイアウトアルゴリズムの家系（レイヤード vs 力学系）に由来することを切り分ける。',
    stress: ['realistic', 'cycles', 'edge-routing'],
    expectation:
      'dagre / ELK layered は双方向の辺の片方を逆向き扱いにして無理やり段に押し込むので、フローチャートのように縦長に伸びて「状態機械に見えない」と予想。Cytoscape の cose / G6 の force は素直に円環状に配置して状態機械らしく描けるはず。bpmn-js は BPMN のシーケンスフローに状態機械を落とし込めず、最も不自然になると見ている。Mermaid は stateDiagram を持つが、このアプリは flowchart 変換なので双方向辺が並走して重なるはず。',
    doc: stateMachineDoc,
  },
  {
    id: 'realistic-support-desk',
    label: 'サポート対応',
    purpose:
      '5 チャネル → チケット起票へ 5 本、専門 3 チーム → 一次回答作成へ 8 本、全経路 → 最終回答送付へ 9 本と、同一ノードへの合流を 3 段重ねる。入次数が 2 桁近い合流点で接続点をどう捌くかを見る。',
    stress: ['realistic', 'edge-aggregation', 'edge-routing'],
    expectation:
      'ポートを持つライブラリ（JointJS / X6 / bpmn-js）は 9 本を 1 点に集中させて矢印が団子になると予想。React Flow は Handle が 1 つなので同様に集中するが、エッジの重なり順で見分けがつかなくなるはず。Cytoscape は辺の端点を自動分散させるので一番読みやすいと見ている。折りたたみ時は専門チーム 3 グループからの 8 本が 3 本まで畳まれるはずで、集約が実装されていないライブラリだと 8 本のまま残る。',
    doc: supportDoc,
  },
  {
    id: 'realistic-collection-dunning',
    label: '督促・回収',
    purpose:
      '段階督促（架電 → 督促状 → 内容証明 → 支払督促 → 差押）という長い直列に対し、各段階から「入金消込」へ戻る短絡エッジを 5 本張る。直列の段数が多いほど短絡エッジが何レイヤーも飛び越えるため、レイヤードレイアウトが最も苦手な形になる。',
    stress: ['realistic', 'cycles', 'layout-height', 'edge-routing'],
    expectation:
      'dagre は 5 本の長い後方エッジのために左右に大きな余白を取り、キャンバスが実際の内容の 2 倍以上に広がると予想。ELK は spacing.edgeEdge を効かせて束ねるのでもう少しまとまるはず。Mermaid は後方エッジを全部左側に回すので、長い直列の左に 5 本の線が並走して読めなくなると見ている。督促状の自己ループに近い短い循環（dn-letter ⇄ dn-letter-count）を自己ループとして描けるかも合わせて見る。',
    doc: dunningDoc,
  },
]

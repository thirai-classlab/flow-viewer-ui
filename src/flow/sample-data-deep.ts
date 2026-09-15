/**
 * 5 階層の深いサンプル業務フロー。
 *
 * 3 階層版（sample-data.ts）では「左ペインに経路を入れ子で表示する」方式が
 * 破綻するかどうかを検証できないため追加した。
 *
 * 階層:
 *   L0 プロセス（受注 / 手配 / 完了）
 *   L1 部門
 *   L2 業務
 *   L3 工程
 *   L4 手順
 *
 * 3 階層版と同じく、意図的に以下を含めてある:
 *   - プロセスをまたぐ例外遷移（差し戻し・謝絶）
 *   - 並列 → 合流（4 社への申込）
 *   - 深い位置での分岐
 */

import type { FlowDoc } from './schema'

export const deepFlow: FlowDoc = {
  id: 'lifeline-ops-deep-v1',
  title: '申込受付〜開通完了オペレーション（5 階層版）',
  description:
    'プロセス → 部門 → 業務 → 工程 → 手順 の 5 階層。左ペインの入れ子表示が深さに耐えるかの検証用。',
  root: [
    { id: 'start', label: '申込発生', kind: 'start' },

    // ===== L0: 受注プロセス =====
    {
      id: 'ph-order',
      label: '受注プロセス',
      kind: 'group',
      meta: { owner: 'フロント', sla: '2 営業日' },
      children: [
        // L1
        {
          id: 'dept-intake',
          label: '受付部門',
          kind: 'group',
          meta: { owner: 'カスタマーサポート' },
          children: [
            // L2
            {
              id: 'proc-receive',
              label: '申込受付',
              kind: 'group',
              children: [
                // L3
                {
                  id: 'step-form',
                  label: 'フォーム処理',
                  kind: 'group',
                  children: [
                    // L4
                    { id: 'op-form-recv', label: 'フォーム受信', kind: 'task', meta: { system: 'Web フォーム' } },
                    { id: 'op-form-parse', label: '項目パース', kind: 'task' },
                    {
                      id: 'op-form-norm',
                      label: '住所正規化',
                      kind: 'task',
                      meta: { system: '住所 API' },
                      doc: `## なぜ正規化するのか

引越し先住所は、この先の**すべての手続きの主キー**になる。
表記が揺れたままだと供給地点特定番号が引けず、電力・ガスの申込が成立しない。

## 手順

1. フォームの生住所を住所正規化 API に投げる
2. 返ってきた \`buildingId\` と \`roomNo\` を CRM に保存する（生住所も監査用に残す）
3. 正規化スコアが 0.8 未満のものは人手確認キューへ回す

## よくある揺れ

| 生入力 | 正規化後 |
| --- | --- |
| 一丁目2番3号 | 1-2-3 |
| ○○マンション 305 | ○○マンション / 305 |
| 305号室 | 305 |
| （建物名なし） | 人手確認キューへ |

## 注意点

- **部屋番号を建物名の一部として保存しない。** 電力は部屋単位で契約が分かれる
- 新築物件は API のマスタに載っていないことがある。その場合は
  住居表示実施証明を管理会社から取り寄せる`,
                    },
                  ],
                },
                {
                  id: 'step-dedup',
                  label: '重複判定',
                  kind: 'group',
                  children: [
                    { id: 'op-dedup-query', label: '既存申込照会', kind: 'task', meta: { system: 'CRM' } },
                    { id: 'op-dedup-judge', label: '重複か', kind: 'decision' },
                  ],
                },
                {
                  id: 'step-register',
                  label: '顧客登録',
                  kind: 'group',
                  children: [
                    { id: 'op-reg-create', label: '顧客レコード作成', kind: 'task', meta: { system: 'CRM' } },
                    { id: 'op-reg-link', label: '物件情報紐付け', kind: 'task' },
                  ],
                },
              ],
            },
            {
              id: 'proc-verify',
              label: '内容確認',
              kind: 'group',
              children: [
                {
                  id: 'step-required',
                  label: '必須項目チェック',
                  kind: 'group',
                  children: [
                    { id: 'op-req-scan', label: '欠損項目の抽出', kind: 'task' },
                    { id: 'op-req-ask', label: '不足分の照会', kind: 'task', meta: { owner: 'CS 担当' } },
                  ],
                },
                {
                  id: 'step-identity',
                  label: '本人確認',
                  kind: 'group',
                  children: [
                    { id: 'op-id-doc', label: '本人確認書類の受領', kind: 'task' },
                    { id: 'op-id-match', label: '記載内容の照合', kind: 'task' },
                    { id: 'op-id-ok', label: '確認完了か', kind: 'decision' },
                  ],
                },
              ],
            },
          ],
        },

        // L1
        {
          id: 'dept-screening',
          label: '審査部門',
          kind: 'group',
          meta: { owner: '審査チーム' },
          children: [
            {
              id: 'proc-credit',
              label: '与信審査',
              kind: 'group',
              children: [
                {
                  id: 'step-credit-query',
                  label: '信用情報照会',
                  kind: 'group',
                  children: [
                    { id: 'op-cr-req', label: '照会リクエスト送信', kind: 'task', meta: { system: '外部信用情報 API' } },
                    { id: 'op-cr-parse', label: 'スコア取得', kind: 'task' },
                  ],
                },
                {
                  id: 'step-credit-judge',
                  label: '与信判定',
                  kind: 'group',
                  children: [
                    { id: 'op-cr-rule', label: 'スコア閾値判定', kind: 'task' },
                    { id: 'op-cr-final', label: '与信 OK か', kind: 'decision' },
                  ],
                },
              ],
            },
            {
              id: 'proc-docs',
              label: '書類審査',
              kind: 'group',
              children: [
                {
                  id: 'step-docs-recv',
                  label: '書類受領',
                  kind: 'group',
                  children: [
                    { id: 'op-doc-upload', label: 'アップロード受信', kind: 'task' },
                    {
                      id: 'op-doc-ocr',
                      label: 'OCR 読取',
                      kind: 'task',
                      meta: { system: 'OCR' },
                      doc: `## 手順

1. アップロードされた本人確認書類の画像を OCR にかける
2. 抽出した 氏名 / 生年月日 / 住所 / 有効期限 を構造化して返す
3. 信頼度が閾値未満の項目は空で返し、次工程（記載内容の検証）で人が埋める

## 読取精度の目安

| 書類 | 実測の一発通過率 | 詰まりやすい項目 |
| --- | --- | --- |
| 運転免許証 | 高 | 旧字体の氏名 |
| マイナンバーカード | 高 | 裏面は読ませない運用 |
| 健康保険証 | 中 | 手書き追記の住所変更欄 |
| 在留カード | 中 | ローマ字氏名とカナの対応 |

## 注意点

- **個人番号（マイナンバー）が写った画像は OCR に投げる前に弾く。**
  外部 OCR へ送った時点で番号法上の取扱いが発生する
- 斜め撮り・影は再提出依頼が最短。補正で粘るより早い
- OCR の出力を無検証で CRM に書かない。必ず人の照合を挟む`,
                    },
                  ],
                },
                {
                  id: 'step-docs-check',
                  label: '不備チェック',
                  kind: 'group',
                  children: [
                    { id: 'op-doc-valid', label: '記載内容の検証', kind: 'task' },
                    { id: 'op-doc-ok', label: '不備なしか', kind: 'decision' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },

    // ===== L0: 手配プロセス =====
    {
      id: 'ph-arrange',
      label: '手配プロセス',
      kind: 'group',
      meta: { owner: '手配チーム', sla: '3 営業日' },
      children: [
        {
          id: 'dept-apply',
          label: '申込部門',
          kind: 'group',
          children: [
            {
              id: 'proc-utility',
              label: '各社申込',
              kind: 'group',
              meta: { note: '4 社に並列で申込。全部が開通調整に合流する' },
              children: [
                {
                  id: 'step-power',
                  label: '電力',
                  kind: 'group',
                  children: [
                    { id: 'op-pw-form', label: '申込書作成', kind: 'task' },
                    { id: 'op-pw-send', label: 'Web 送信', kind: 'task', meta: { system: '電力会社 Web' } },
                  ],
                },
                {
                  id: 'step-gas',
                  label: 'ガス',
                  kind: 'group',
                  children: [
                    { id: 'op-gas-form', label: '申込書作成', kind: 'task' },
                    {
                      id: 'op-gas-fax',
                      label: 'FAX 送信',
                      kind: 'task',
                      meta: { system: 'FAX' },
                      doc: `## 手順

1. 申込書 PDF を FAX ゲートウェイへ送信する
2. 送信結果レポートを待ち、\`OK\` を確認する
3. ガス会社から折返しの受付番号が届くまで案件を閉じない（当日〜翌営業日）
4. 受付番号を CRM の \`ガス受付番号\` に転記する

## チェックリスト

- [ ] 宛先番号が**その物件のエリアを担当するガス会社**か
- [ ] 開栓希望日時が第 3 希望まで記入されているか
- [ ] 立会者の氏名と携帯番号が入っているか
- [ ] 契約者と立会者が違う場合、続柄が書かれているか

## なぜ FAX なのか

一部のガス会社は今も FAX しか受け付けない。
Web 受付があっても、引越しシーズンは FAX のほうが処理が速いことがある。

> **送信 OK は「届いた」であって「受理された」ではない。**
> 受付番号が返ってくるまでは未申込として扱う。ここを混同すると、
> 開栓当日に「申込がありません」と言われる事故になる。`,
                    },
                  ],
                },
                {
                  id: 'step-water',
                  label: '水道',
                  kind: 'group',
                  children: [
                    { id: 'op-wt-form', label: '届出書作成', kind: 'task' },
                    { id: 'op-wt-send', label: '自治体窓口へ提出', kind: 'task' },
                  ],
                },
                {
                  id: 'step-net',
                  label: 'ネット',
                  kind: 'group',
                  children: [
                    { id: 'op-net-api', label: 'ISP API 申込', kind: 'task', meta: { system: 'ISP API' } },
                    { id: 'op-net-conf', label: '受付番号取得', kind: 'task' },
                  ],
                },
              ],
            },
          ],
        },
        {
          id: 'dept-schedule',
          label: '調整部門',
          kind: 'group',
          children: [
            {
              id: 'proc-schedule',
              label: '開通調整',
              kind: 'group',
              children: [
                {
                  id: 'step-slot',
                  label: '日程調整',
                  kind: 'group',
                  children: [
                    { id: 'op-slot-ask', label: '希望日ヒアリング', kind: 'task' },
                    { id: 'op-slot-fix', label: '各社と日程確定', kind: 'task' },
                  ],
                },
                {
                  id: 'step-dispatch',
                  label: '工事手配',
                  kind: 'group',
                  children: [
                    { id: 'op-dis-order', label: '工事依頼', kind: 'task' },
                    { id: 'op-dis-ok', label: '手配できたか', kind: 'decision' },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },

    // ===== L0: 完了プロセス =====
    {
      id: 'ph-close',
      label: '完了プロセス',
      kind: 'group',
      meta: { owner: '品質管理' },
      children: [
        {
          id: 'dept-qa',
          label: '品質管理部門',
          kind: 'group',
          children: [
            {
              id: 'proc-confirm',
              label: '開通確認',
              kind: 'group',
              children: [
                { id: 'op-cf-check', label: '各社の開通照合', kind: 'task' },
                { id: 'op-cf-ok', label: '全て開通したか', kind: 'decision' },
              ],
            },
            {
              id: 'proc-notify',
              label: '完了通知',
              kind: 'group',
              children: [
                { id: 'op-nt-mail', label: 'メール送信', kind: 'task', meta: { system: 'メール / LINE' } },
                { id: 'op-nt-close', label: '案件クローズ', kind: 'task', meta: { system: 'CRM' } },
              ],
            },
          ],
        },
      ],
    },

    { id: 'end', label: '完了', kind: 'end' },
    { id: 'end-reject', label: '謝絶', kind: 'end', meta: { note: '与信 NG による終了' } },
  ],

  links: [
    // --- 受注プロセス内の順路 ---
    { from: 'start', to: 'op-form-recv' },
    { from: 'op-form-recv', to: 'op-form-parse' },
    { from: 'op-form-parse', to: 'op-form-norm' },
    { from: 'op-form-norm', to: 'op-dedup-query' },
    { from: 'op-dedup-query', to: 'op-dedup-judge' },
    { from: 'op-dedup-judge', to: 'op-reg-create', label: '新規' },
    { from: 'op-reg-create', to: 'op-reg-link' },
    { from: 'op-reg-link', to: 'op-req-scan' },
    { from: 'op-req-scan', to: 'op-req-ask' },
    { from: 'op-req-ask', to: 'op-id-doc' },
    { from: 'op-id-doc', to: 'op-id-match' },
    { from: 'op-id-match', to: 'op-id-ok' },

    // --- 審査部門へ ---
    { from: 'op-id-ok', to: 'op-cr-req', label: 'OK' },
    { from: 'op-cr-req', to: 'op-cr-parse' },
    { from: 'op-cr-parse', to: 'op-cr-rule' },
    { from: 'op-cr-rule', to: 'op-cr-final' },
    { from: 'op-cr-final', to: 'op-doc-upload', label: 'OK' },
    { from: 'op-doc-upload', to: 'op-doc-ocr' },
    { from: 'op-doc-ocr', to: 'op-doc-valid' },
    { from: 'op-doc-valid', to: 'op-doc-ok' },

    // --- 4 社への並列申込（L0 をまたぐ） ---
    { from: 'op-doc-ok', to: 'op-pw-form', label: '不備なし' },
    { from: 'op-doc-ok', to: 'op-gas-form', label: '不備なし' },
    { from: 'op-doc-ok', to: 'op-wt-form', label: '不備なし' },
    { from: 'op-doc-ok', to: 'op-net-api', label: '不備なし' },
    { from: 'op-pw-form', to: 'op-pw-send' },
    { from: 'op-gas-form', to: 'op-gas-fax' },
    { from: 'op-wt-form', to: 'op-wt-send' },
    { from: 'op-net-api', to: 'op-net-conf' },

    // --- 合流 ---
    { from: 'op-pw-send', to: 'op-slot-ask' },
    { from: 'op-gas-fax', to: 'op-slot-ask' },
    { from: 'op-wt-send', to: 'op-slot-ask' },
    { from: 'op-net-conf', to: 'op-slot-ask' },

    { from: 'op-slot-ask', to: 'op-slot-fix' },
    { from: 'op-slot-fix', to: 'op-dis-order' },
    { from: 'op-dis-order', to: 'op-dis-ok' },

    // --- 完了プロセスへ ---
    { from: 'op-dis-ok', to: 'op-cf-check', label: 'OK' },
    { from: 'op-cf-check', to: 'op-cf-ok' },
    { from: 'op-cf-ok', to: 'op-nt-mail', label: '全て開通' },
    { from: 'op-nt-mail', to: 'op-nt-close' },
    { from: 'op-nt-close', to: 'end' },

    // --- 階層を大きくまたぐ例外遷移 ---
    // 書類不備 → 受付部門の本人確認へ差し戻し（L0 → L0、深さ 4 → 深さ 4）
    { from: 'op-doc-ok', to: 'op-id-doc', label: '不備あり', kind: 'loopback' },
    // 重複検出 → 完了通知へ直行（プロセスを 2 つ飛ばす）
    { from: 'op-dedup-judge', to: 'op-nt-mail', label: '重複', kind: 'exception' },
    // 与信 NG → 謝絶（最上位の終端へ）
    { from: 'op-cr-final', to: 'end-reject', label: 'NG', kind: 'exception' },
    // 本人確認 NG → 謝絶
    { from: 'op-id-ok', to: 'end-reject', label: '確認不可', kind: 'exception' },
    // 手配不可 → 日程調整へ差し戻し（同一業務内）
    { from: 'op-dis-ok', to: 'op-slot-ask', label: '再調整', kind: 'loopback' },
    // 開通不備 → 工事手配へ差し戻し（業務をまたぐ）
    { from: 'op-cf-ok', to: 'op-dis-order', label: '未開通あり', kind: 'loopback' },
    // 必須項目不足 → フォーム処理へ戻る（工程をまたぐ）
    { from: 'op-req-ask', to: 'op-form-parse', label: '再入力', kind: 'loopback' },
  ],
}

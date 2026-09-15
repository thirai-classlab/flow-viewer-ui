---
paths:
  - "docs/tasks/**"
  - "docs/draft/**"
  - ".claude/tasks/**"
  - ".claude/draft/**"
---
# タスク運用

対象: 台帳 (`list.md`) / `parking-lot.md` / 設計 draft を触る作業。

## 台帳

- **台帳は 1 枚**: メインエージェントは、タスクの正本を台帳 1 表だけに置く。台帳は常に `docs/tasks/list.md` (`$HARNESS_TASKS_FILE` があればそれが優先。旧レイアウトの `.claude/tasks/list.md` は `/hirai-lite:update` が `docs/` へ移す) ／ 例: 進捗は list.md の status 列を書き換える ／ 失効: 外部トラッカー (Asana / Jira) に正本を移したとき
- **列は 5 つ**: メインエージェントは、list.md を `# / status / タスク / 完了条件 / 詳細` の 5 列で書く ／ 例: `| 3 | 進行中 | ログイン API | `npm test -- auth` が green | [task-3.md](task-3.md) |` ／ 失効: なし
- **status は 3 種**: メインエージェントは、status に 未着手 / 進行中 / 完了 のいずれかを書く ／ 例: 保留したいタスクは list.md から `parking-lot.md` へ移す ／ 失効: なし
- **1 task = ゴール 1 文 + N step**: メインエージェントは、task に「ゴール 1 文」「step の箇条書き」「完了条件」を書く ／ 例: `$CLAUDE_PLUGIN_ROOT/templates/task.md` を写して埋める ／ 失効: なし
- **完了条件は検証可能に**: メインエージェントは、完了条件を再現コマンドか観察可能な事実で書く ／ 例: 「ログイン E2E が green」「`GET /health` が 200 を返す」 ／ 失効: なし
- **完了 commit に台帳を含める**: メインエージェントは、タスク完了 commit に list.md の status 更新を同梱する ／ 例: `git add docs/tasks/list.md docs/tasks/task-3.md src/auth.ts` ／ 失効: list.md を廃止したとき

## 台帳の管理者

- **台帳更新はメイン専任**: メインエージェントは、list.md と parking-lot.md の更新を自分で行い、サブエージェントに委譲しない ／ 例: サブエージェント起動前に status を 進行中 にする ／ 失効: 台帳を機械生成に切り替えたとき
- **サブエージェントは台帳を読むだけ**: サブエージェントは、list.md を Read して自分の担当範囲を確認し、書き換えは結果報告でメインに返す ／ 例: 報告に「task 3 完了、status を 完了 へ」と書く ／ 失効: 上と同じ

## 設計 draft

- **設計の起点は draft**: 新機能・仕様変更は `docs/draft/<slug>.md` に設計を起こす ／ 例: `docs/draft/login-rate-limit.md` ／ 失効: なし
- **承認してから台帳に載せる**: メインエージェントは、user 承認を得た draft だけを list.md の行にする ／ 例: draft 末尾に `approved: 2026-08-22` を書いてから `/new-task` 相当の追記をする ／ 失効: なし
- **未承認は draft に留める**: 承認前の設計は draft dir に置いたままにし、list.md からリンクしない ／ 例: 検討中の案は draft のまま user レビューに出す ／ 失効: なし
- **task から draft へリンクする**: メインエージェントは、task の詳細欄に元 draft への相対リンクを書く ／ 例: `詳細: [draft/login-rate-limit.md](../draft/login-rate-limit.md)` ／ 失効: draft を廃止したとき

## 保留

- **保留はリンク付きで移す**: 着手しないタスクは `parking-lot.md` へ移し、保留理由と再開条件を 1 行ずつ書く ／ 例: 「保留理由: 外部 API の仕様未確定 / 再開条件: v2 API 公開」 ／ 失効: なし
- **不採用も残す**: 不採用にしたタスクは parking-lot.md から消さず、判断日と理由を残す ／ 例: 「不採用 2026-08-22: 利用者ゼロのため」 ／ 失効: なし

- **承認は判断材料つきで求める**: メインエージェントは、着手 / 完了 / 優先順の変更 / draft 承認を求めるとき 5 項目を示す ／ 例: 型と記入例は `docs/rules-reference/approval-template.md` ／ 失効: なし

---
背景・過去の経緯・事故記録: `docs/rules-reference/`

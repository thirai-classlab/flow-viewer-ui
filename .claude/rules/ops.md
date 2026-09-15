---
paths:
  - ".github/**"
  - "infra/**"
  - "**/*.tf"
  - "**/Dockerfile"
---
# CI / デプロイ / インフラ

対象: CI 定義、デプロイ設定、Terraform、コンテナ定義を触る作業。

## 不可逆操作の扱い

- **不可逆操作は user が実行する**: メインエージェントは、本番 deploy / `terraform apply` / `kubectl delete` / DB migration の実行を user に渡し、自分では走らせない ／ 例: 「`terraform apply` の実行をお願いします。plan 結果は上記」と提示する ／ 失効: staging 専用アカウントに限定した実行経路を用意したとき
- **機械的にも止まる**: これらのコマンドは `.claude/settings.json` の `permissions.ask` に登録され、実行前に user 確認のプロンプトが出る。`deny` 指定のコマンド (`git push --force` / `rm -rf` 等) は実行されない ／ 例: `Bash(terraform apply:*)` は ask で停止する ／ 失効: settings.json から該当エントリを外したとき
- **止まったら迂回しない**: メインエージェントは、ask や deny で止まったコマンドを別表記や別ツールで再試行せず、user に報告する ／ 例: `terraform apply` が止まったら `tf apply` alias を作らない ／ 失効: なし

## 変更の出し方

- **plan を先に出す**: メインエージェントは、インフラ変更の PR に `terraform plan` の出力か同等の差分要約を貼る ／ 例: 「追加 2 / 変更 1 / 破壊 0」を PR 本文の先頭に書く ／ 失効: plan を自動で PR にコメントする CI を入れたとき
- **破壊を含む差分は明示する**: メインエージェントは、リソースの destroy / replace を含む変更を PR タイトルに書く ／ 例: `infra: RDS パラメータ変更 (replace 1 件を含む)` ／ 失効: なし
- **staging を先に通す**: 実装者は、本番へ出す変更を staging 環境で 1 度適用してから本番 PR を出す ／ 例: staging apply のログ URL を PR に貼る ／ 失効: staging 環境を廃止したとき
- **1 PR 1 環境**: 実装者は、複数環境にまたがる変更を環境ごとの PR に分ける ／ 例: `infra/staging/` と `infra/prod/` を別 PR にする ／ 失効: なし

## 秘密情報

- **秘密は参照だけ置く**: 実装者は、CI 定義とインフラコードに秘密の実値を書かず、Secrets Manager や CI の secret 参照を書く ／ 例: `${{ secrets.DEPLOY_TOKEN }}` ／ 失効: なし
- **`.env` は読まない**: エージェントは `.env` 系ファイルを読まない (settings.json の `permissions.deny` でも止まる) ／ 例: 必要な変数名は `.env.example` から読む ／ 失効: なし
- **漏れたら失効させる**: 秘密をコミットに含めたと分かったら、履歴の書き換えより先にその鍵をローテーションする ／ 例: token を revoke してから履歴対応を相談する ／ 失効: なし

## CI 定義

- **CI 変更は build・test・lint を壊さない**: 実装者は、CI 定義を変えた PR で 1 回 CI を green にしてから merge を依頼する ／ 例: workflow 変更後に空 commit を push して実行させる ／ 失効: なし
- **CI で落ちるものをローカルでも落とす**: 実装者は、CI に追加したチェックを同じコマンドでローカル実行できるようにする ／ 例: workflow から `npm run lint` を呼び、README にも同じコマンドを書く ／ 失効: なし
- **タイムアウトを書く**: 実装者は、CI の各 job に上限時間を設定する ／ 例: `timeout-minutes: 15` ／ 失効: なし

---
背景・過去の経緯・事故記録: `docs/rules-reference/`

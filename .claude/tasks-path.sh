#!/usr/bin/env bash
# 台帳 / 設計 draft / 事故記録 / 進め方 / ルールの パス解決を 1 箇所に集める共通ライブラリ。source して使う。
#
# **プロジェクトの書類は常に docs/ に置く** (v1.9.0)。.claude/ 側を見続けるのは、v1.7.0 までに
# 導入した環境が /hirai-lite:update で docs/ へ移行するまでの間、および移行しない選択をした環境で
# 台帳を見失わないため。解決順そのものは v1.8.0 から 1 バイトも変えていない。
#
# 共通の解決順: env 上書き > 既存パス (docs 側 → .claude 側) > docs/ の有無で決める
#   台帳     : HARNESS_TASKS_FILE     > docs/tasks/list.md            > .claude/tasks/list.md
#   draft    : HARNESS_DRAFT_DIR      > docs/draft/                   > .claude/draft/
#   事故記録 : HARNESS_INCIDENTS_FILE > docs/rules-reference/…        > .claude/rules-reference/…
# 台帳が 1 つも無い場合は空文字 + exit 1 を返す (エラーにせず呼び出し側で分岐する)。
# draft / 事故記録は未作成でも「これから作るべきパス」を返す (rc 0)。
#
# 進め方 / ルールは配置先が 2 通りある (プロジェクト側 = .claude/ と 全プロジェクト共通 = $HOME/.claude/)。
# どちらに置いたかを決め打ちすると、片方に置いた利用者に対して黙って外れる。**在る側**を選ぶ。
#   進め方   : HC_MODE (env) > <root>/.claude/mode.yml > $HOME/.claude/mode.yml > normal
#   入れ替え : HC_AUTO_SYNC (env) > 同じ mode.yml の auto_sync > off (既定は入れ替えない)
#   ルール   : HARNESS_RULES_DIR > <root>/.claude/rules > $HOME/.claude/rules > <root>/.claude/rules
#
# file-top に set -e / set -o pipefail を書かない。source 元の shell flags を汚染し、
# パイプ先の早期終了で呼び出し元ごと落ちる事故を防ぐため (関数内で局所化する)。

# harness_tasks_file [root] -> 台帳パスを stdout、無ければ空 + rc 1
harness_tasks_file() {
  local root="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}" p
  if [ -n "${HARNESS_TASKS_FILE:-}" ]; then
    printf '%s' "$HARNESS_TASKS_FILE"
    return 0
  fi
  for p in "$root/docs/tasks/list.md" "$root/.claude/tasks/list.md"; do
    if [ -f "$p" ]; then
      printf '%s' "$p"
      return 0
    fi
  done
  return 1
}

# harness_draft_dir [root] -> 設計 draft の置き場を stdout (末尾スラッシュなし)
harness_draft_dir() {
  local root="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}" p
  if [ -n "${HARNESS_DRAFT_DIR:-}" ]; then
    printf '%s' "$HARNESS_DRAFT_DIR"
    return 0
  fi
  for p in "$root/docs/draft" "$root/.claude/draft"; do
    if [ -d "$p" ]; then
      printf '%s' "$p"
      return 0
    fi
  done
  if [ -d "$root/docs" ]; then printf '%s' "$root/docs/draft"; else printf '%s' "$root/.claude/draft"; fi
}

# harness_incidents_file [root] -> 事故記録 (T2) のパスを stdout
harness_incidents_file() {
  local root="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}" p
  if [ -n "${HARNESS_INCIDENTS_FILE:-}" ]; then
    printf '%s' "$HARNESS_INCIDENTS_FILE"
    return 0
  fi
  for p in "$root/docs/rules-reference/incidents.md" "$root/.claude/rules-reference/incidents.md"; do
    if [ -f "$p" ]; then
      printf '%s' "$p"
      return 0
    fi
  done
  if [ -d "$root/docs" ]; then
    printf '%s' "$root/docs/rules-reference/incidents.md"
  else
    printf '%s' "$root/.claude/rules-reference/incidents.md"
  fi
}

# --- 進め方 (mode) ------------------------------------------------------------
# 読む側 (SessionStart / 画面下部) と書く側 (/config) が別々の順で解決すると、
# 「セッション冒頭は normal・画面下部は loop」のように食い違う。3 箇所ともここを通す。

# harness_mode_file [root] -> すでに在る mode.yml のパスを stdout。
# プロジェクト側 → ホーム側の順で探し、どちらにも無ければ空 + rc 1。
harness_mode_file() {
  local root="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}" p
  for p in "$root/.claude/mode.yml" "${HOME:+$HOME/.claude/mode.yml}"; do
    [ -n "$p" ] || continue
    if [ -f "$p" ]; then
      printf '%s' "$p"
      return 0
    fi
  done
  return 1
}

# harness_mode_write_file [root] -> /config が書き込むべきパスを stdout (常に rc 0)。
# **すでに在る側に書く。** 両方に無いときだけプロジェクト側に作る。
# (ホーム側に置いた人のプロジェクトへ mode.yml を新設すると、ホーム側を黙って覆い隠す)
harness_mode_write_file() {
  local root="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}" p
  if p="$(harness_mode_file "$root")"; then
    printf '%s' "$p"
    return 0
  fi
  printf '%s' "$root/.claude/mode.yml"
}

# harness_mode [root] -> いまの進め方 (normal / loop / 未知の値) を stdout。常に rc 0。
# env HC_MODE > 在る側の mode.yml > normal。読めない・空・壊れている場合も normal。
harness_mode() {
  local root="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}" f m=""
  if [ -n "${HC_MODE:-}" ]; then
    printf '%s' "$HC_MODE"
    return 0
  fi
  if f="$(harness_mode_file "$root")"; then
    m="$(sed -n 's/^[[:space:]]*mode:[[:space:]]*\([a-z]*\).*/\1/p' "$f" 2>/dev/null | head -1)"
  fi
  [ -n "$m" ] || m="normal"
  printf '%s' "$m"
}

# --- 更新後の入れ替え (auto_sync) ---------------------------------------------
# プラグイン所有の 3 ファイル (statusline.sh / tasks-path.sh / context-usage.sh) を、
# プラグインが新しくなった後に自動で入れ替えるかどうか。**既定は off (入れ替えない)。**
# 更新は挙動の変更なので、黙って書き換わると「昨日と違う動きをする理由」を追えなくなる。
# 解決順: env HC_AUTO_SYNC > 在る側の mode.yml の auto_sync > off
# 進め方 (mode) と同じ 1 本を通す (置き場を自分で組み立てない)。

# harness_auto_sync [root] -> on / off (未知の値はそのまま) を stdout。常に rc 0。
harness_auto_sync() {
  local root="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}" f v=""
  if [ -n "${HC_AUTO_SYNC:-}" ]; then
    printf '%s' "$HC_AUTO_SYNC"
    return 0
  fi
  if f="$(harness_mode_file "$root")"; then
    v="$(sed -n 's/^[[:space:]]*auto_sync:[[:space:]]*\([A-Za-z]*\).*/\1/p' "$f" 2>/dev/null | head -1)"
  fi
  [ -n "$v" ] || v="off"
  printf '%s' "$v"
}

# harness_yml_set <file> <キー> <値> -> その 1 行だけを書き換える (他の行は 1 バイトも触らない)。
# キーの行が無ければ末尾に足し、file が無ければ作る。書けたら rc 0。
# mode.yml に 2 つ以上のキーが載るようになったため、丸ごと書き直すともう片方が消える。
harness_yml_set() (
  set -uo pipefail
  local f="${1:-}" k="${2:-}" v="${3:-}" tmp
  [ -n "$f" ] && [ -n "$k" ] || return 1
  mkdir -p "$(dirname "$f")" 2>/dev/null || return 1
  [ -f "$f" ] || : > "$f" 2>/dev/null || return 1
  tmp="$f.tmp.$$"
  # awk は 1 行ずつ print するので、元が改行で終わっていなくても行が繋がらない。
  awk -v k="$k" -v v="$v" '
    $0 ~ "^[[:space:]]*" k ":" && !d { print k ": " v; d = 1; next }
    { print }
    END { if (!d) print k ": " v }
  ' "$f" > "$tmp" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 1; }
  mv -f "$tmp" "$f" 2>/dev/null || { rm -f "$tmp" 2>/dev/null; return 1; }
)

# --- ルール (rules) -----------------------------------------------------------
# /add-rule の予算計算と /rules-audit の棚卸しが見る置き場。プロジェクト側を決め打ちすると、
# 全プロジェクト共通 (/init user) に置いた利用者に対して「既存ルール 0 件」と誤判定する。

# harness_rules_dir [root] -> ルールの置き場を stdout (末尾スラッシュなし、常に rc 0)。
# 両方に在る場合はプロジェクト側を返すが、それは二重ロード状態なので
# scripts/scope-check.sh の警告に従って先に片方を消す (予算は 2 か所の合計で効いている)。
harness_rules_dir() {
  local root="${1:-${CLAUDE_PROJECT_DIR:-$PWD}}" p
  if [ -n "${HARNESS_RULES_DIR:-}" ]; then
    printf '%s' "$HARNESS_RULES_DIR"
    return 0
  fi
  for p in "$root/.claude/rules" "${HOME:+$HOME/.claude/rules}"; do
    [ -n "$p" ] || continue
    if [ -d "$p" ]; then
      printf '%s' "$p"
      return 0
    fi
  done
  printf '%s' "$root/.claude/rules"
}

# harness_open_tasks <list.md> -> 未完了 (完了 / done / ✅ 以外) の行数を stdout
harness_open_tasks() {
  local f="${1:-}" total done_n n
  [ -f "$f" ] || { printf '0'; return 0; }
  # grep -c は 0 件のとき "0" を出しつつ exit 1 を返す。数字以外を捨てて必ず整数にする。
  total="$(grep -c '^|[[:space:]]*[0-9]' "$f" 2>/dev/null | tr -cd '0-9')"
  done_n="$(grep '^|[[:space:]]*[0-9]' "$f" 2>/dev/null | grep -c -e '✅' -e '完了' -e '[Dd]one' | tr -cd '0-9')"
  n=$(( ${total:-0} - ${done_n:-0} ))
  [ "$n" -ge 0 ] 2>/dev/null || n=0
  printf '%s' "$n"
}

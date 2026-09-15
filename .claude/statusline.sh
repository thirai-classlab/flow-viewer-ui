#!/usr/bin/env bash
# statusLine (2 行)。1 行目 = いまの状態 / 2 行目 = 次にできる操作。
#   1 行目: <model> | ctx <N>% ・5h <N>% ・7d <N>% | mode: <進め方> | <branch> | やること <N>
#   2 行目: 設定を確認・変更 → /hirai-lite:config [    <お知らせ>]
# 進め方は「正式名（短い解説）」で出す (normal（確認あり）/ loop（自動で進む）)。正式名だけでは
# 意味が伝わらず、解説だけでは設定ファイル (mode.yml) の中身と結び付かないため両方を出す。
# 2 行目の設定リンクは**常時**出す。お知らせはその後ろに最大 1 件だけ (優先: 更新あり >
# context 使用率が閾値以上)。どちらでもなければお知らせは出さず、リンクだけが残る。
# HC_STATUSLINE_NOTICE=off でお知らせを止める (リンクは残る)。
# stdin は Claude Code の session JSON。jq 不在 / JSON 破損 / 台帳不在 / git 外でも
# 必ず 2 行返して exit 0 (fail-open)。NO_COLOR が非空なら色を落とす。
#
# **色は補助でしかない。** 色覚特性や配色設定で色が伝わらない環境があるため、色を落としても
# 意味が読み取れる文面にする (数値には %、進め方には normal（確認あり）/ loop（自動で進む）、リンクにはコマンド名を
# 必ず文字として出す)。色だけで区別する要素を作らない。
#
# **この scripts は通信しない。** 画面下部は何度も描き直されるため、更新の有無は
# SessionStart 側 (scripts/update-check.sh の harness_update_flag_sync) が置いたフラグ 1 ファイルの
# 有無を見るだけにする。取得も版の比較もここでは行わない。
set -uo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" 2>/dev/null && pwd)" || here="."
root="${CLAUDE_PROJECT_DIR:-$PWD}"
input="$(cat 2>/dev/null || true)"

# 色: モデル名 / branch / やること = グレー、使用率 = 緑→黄→赤、進め方 = normal/loop で別色、
# 設定リンク = 控えめなシアン、お知らせ = 黄。NO_COLOR が非空なら全て空にする。
E=$'\033'; R="${E}[0m"; DIM="${E}[2m"; GRN="${E}[32m"; YEL="${E}[33m"; RED="${E}[31m"
MAG="${E}[35m"; LNK="${E}[2;36m"
if [ -n "${NO_COLOR:-}" ]; then R=""; DIM=""; GRN=""; YEL=""; RED=""; MAG=""; LNK=""; fi
SEP="${DIM} | ${R}"

jqf() {  # JSON から 1 フィールド。jq 不在なら空。
  command -v jq >/dev/null 2>&1 || return 0
  printf '%s' "$input" | jq -r "$1 // empty" 2>/dev/null || true
}

lbl() { printf '%s%s%s' "$DIM" "$1" "$R"; }

pct() {  # 使用率を整数 % + 色に。非数は "—"。0-100 に clamp。
  local v="${1%%.*}" col="$GRN"
  case "$v" in ''|null|*[!0-9-]*) printf '%s—%s' "$DIM" "$R"; return 0 ;; esac
  if [ "$v" -lt 0 ] 2>/dev/null; then v=0; elif [ "$v" -gt 100 ] 2>/dev/null; then v=100; fi
  if [ "$v" -ge 80 ] 2>/dev/null; then col="$RED"; elif [ "$v" -ge 50 ] 2>/dev/null; then col="$YEL"; fi
  printf '%s%s%%%s' "$col" "$v" "$R"
}

model="$(jqf '.model.display_name')"; [ -n "$model" ] || model="Claude"

# --- context 使用率 ---------------------------------------------------------
# 計算は scripts/context-usage.sh に集約している (自動処理 hooks/context-budget.sh も同じ関数を通す)。
# ここで独自に割り算しない。v1.9.0 までは画面下部が Claude Code の済みの百分率をそのまま出し、
# hook は 200,000 固定で割っていたため、窓が 1,000,000 の会話で 17% と 83% が同時に出た。
#
# 窓サイズ (context_window_size) は**画面下部の入力 JSON にしか無い**。hook 側の入力にも
# transcript にも環境変数にも無いので、ここで観測して控えへ書き、hook はそれを読む。
[ -f "$here/context-usage.sh" ] && . "$here/context-usage.sh" 2>/dev/null || true

ctx_pct=""
if command -v harness_ctx_percent >/dev/null 2>&1; then
  ctx_session="$(harness_ctx_json_string "$input" session_id || true)"
  ctx_win_seen="$(harness_ctx_window_from_json "$input" || true)"
  [ -n "$ctx_win_seen" ] && harness_ctx_window_remember "$ctx_session" "$ctx_win_seen"
  ctx_tokens="$(harness_ctx_tokens_from_json "$input" || true)"
  if [ -n "$ctx_tokens" ]; then
    ctx_pct="$(harness_ctx_percent "$ctx_tokens" "$(harness_ctx_window "$ctx_session")")"
  fi
fi
# トークン数が取れない Claude Code (旧版) では、渡された済みの百分率をそのまま使う。
[ -n "$ctx_pct" ] || ctx_pct="$(jqf '.context_window.used_percentage')"

ctx="$(pct "$ctx_pct")"
h5="$(pct "$(jqf '.rate_limits.five_hour.used_percentage')")"
d7="$(pct "$(jqf '.rate_limits.seven_day.used_percentage')")"

branch="$(jqf '.workspace.repo.branch')"
[ -n "$branch" ] || branch="$(git -C "$root" rev-parse --abbrev-ref HEAD 2>/dev/null || true)"
[ -n "$branch" ] || branch="-"

# 共通ライブラリ (同じディレクトリ) を先に読む。進め方と台帳のパス解決はここに集約している。
# tasks-path.sh と statusline.sh はどちらもプラグイン所有で、/init と /update が対で入れ替える。
[ -f "$here/tasks-path.sh" ] && . "$here/tasks-path.sh" 2>/dev/null || true

# mode: 解決順は harness_mode (env HC_MODE > プロジェクトの mode.yml > ホームの mode.yml > normal)。
# SessionStart (hooks/session-start.sh) と /config も同じ関数を通す。ここで独自に解決しない。
# 表示は「正式名（解説）」に整える (未知の値はそのまま出す)。色は補助で、文字だけでも区別できる。
if command -v harness_mode >/dev/null 2>&1; then
  mode="$(harness_mode "$root")"
else
  mode="${HC_MODE:-normal}"
fi
[ -n "$mode" ] || mode="normal"
case "$mode" in
  normal) mode_label="normal（確認あり）";   mode_col="$GRN" ;;
  loop)   mode_label="loop（自動で進む）";    mode_col="$MAG" ;;
  *)      mode_label="$mode";                mode_col="$DIM" ;;
esac

# 未完了タスク: 台帳の解決順は scripts/tasks-path.sh (冒頭で source 済み、台帳なしは "—")
todo="—"
if command -v harness_tasks_file >/dev/null 2>&1; then
  list="$(harness_tasks_file "$root" 2>/dev/null || true)"
  if [ -n "$list" ] && [ -f "$list" ]; then todo="$(harness_open_tasks "$list")"; fi
fi

# --- お知らせ (2 行目の後段): 上から順に 1 つだけ、どれにも当たらなければ何も出さない ---
#   1. 更新あり  … SessionStart が置いたフラグの有無だけを見る (通信しない)
#   2. context 高 … 使用率が HC_CONTEXT_THRESHOLD 以上
notice=""
if [ "${HC_STATUSLINE_NOTICE:-on}" != "off" ]; then
  if [ "${HARNESS_UPDATE_CHECK:-on}" != "off" ] \
    && [ -s "${TMPDIR:-/tmp}/claude-harness-lite/update-available" ]; then
    notice="更新あり → /hirai-lite:update"
  elif command -v harness_ctx_over_threshold >/dev/null 2>&1 \
    && harness_ctx_over_threshold "${ctx_pct%%.*}"; then
    notice="きりの良いところで /hirai-lite:state save"
  fi
fi

# 1 行目 = いまの状態 (モデル名 / 残り容量 / 進め方 / ブランチ / やること)
line1="${DIM}${model}${R}${SEP}$(lbl ctx) ${ctx} ${DIM}・${R}$(lbl 5h) ${h5} ${DIM}・${R}$(lbl 7d) ${d7}"
line1="${line1}${SEP}$(lbl 'mode:') ${mode_col}${mode_label}${R}"
line1="${line1}${SEP}${DIM}${branch}${R}"
line1="${line1}${SEP}$(lbl やること) ${DIM}${todo}${R}"

# 2 行目 = 次にできる操作。設定リンクは常時、お知らせはその後ろに 1 件だけ。
line2="${LNK}設定を確認・変更 → /hirai-lite:config${R}"
[ -n "$notice" ] && line2="${line2}    ${YEL}${notice}${R}"

printf '%s\n%s\n' "$line1" "$line2"
exit 0

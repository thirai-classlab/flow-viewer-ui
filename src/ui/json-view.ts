/**
 * 真実源 JSON を「画面と対応づけて」見せるための補助。
 *
 * このプロジェクトの要件は「JSON が真実源であることを画面で常に確認できる」こと。
 * そのために必要な操作は 3 つで、いずれもここに閉じている:
 *
 *   1. buildJsonView  … 整形済み JSON の中で「どのステップがどの行か」を割り出す
 *   2. subtreeDoc     … 今いる階層のサブツリーだけを FlowDoc の形で切り出す
 *   3. parseFlowDoc   … 編集されたテキストを検証して FlowDoc に戻す（壊れていても落とさない）
 *
 * 1 は「JSON.stringify(doc, null, 2) の出力をそのまま見せる」ことを崩さないために、
 * 自前の整形器を書くのではなく **出力済みのテキストを走査**して領域を求めている。
 * 自前整形にすると JSON.stringify と 1 文字でもズレたときに「表示は正しいが真実源ではない」
 * という最悪の状態になるため。
 */

import type { FlowDoc, FlowStep, StepKind } from '../flow/schema'

/** 整形済み JSON 内の 1 領域。行は 0 始まり、文字位置は text.slice() にそのまま使える */
export type JsonRegion = {
  startLine: number
  endLine: number
  startChar: number
  endChar: number
}

export type JsonView = {
  /** JSON.stringify(doc, null, 2) そのもの */
  text: string
  lineCount: number
  /** ステップ id → その JSON オブジェクトが占める領域 */
  regionOf: Map<string, JsonRegion>
}

/** 構造行（波括弧・角括弧の開閉）を判定する。文字列値の中の括弧に引っかからない形にしてある */
const OPEN_LINE = /(^[[{]$)|(^"(?:[^"\\]|\\.)*": [[{]$)/
const ID_LINE = /^"id": "((?:[^"\\]|\\.)*)",?$/

type Frame = { startLine: number; id?: string }

/**
 * 整形済み JSON を走査し、各ステップ id が占める行範囲を求める。
 *
 * JSON.stringify(x, null, 2) の出力では
 *   - オブジェクト / 配列の開き括弧は必ず行末
 *   - 閉じ括弧は必ず行頭（インデント後の先頭文字）
 * になるため、行単位のスタックで入れ子を正しく追える。
 * 空オブジェクト `{}` / 空配列 `[]` は 1 行に収まり開閉どちらにも該当しないので、
 * 走査対象から自然に外れる（子を持たないので領域も不要）。
 *
 * @param knownIds 実在するステップ id。doc 自身の "id" や将来増える別の "id" を拾わないための絞り込み
 */
export function buildJsonView(doc: FlowDoc, knownIds: ReadonlySet<string>): JsonView {
  const text = JSON.stringify(doc, null, 2)
  const lines = text.split('\n')

  // 行頭の文字位置。改行 1 文字ぶんを足しながら積む
  const lineStart: number[] = []
  let acc = 0
  for (const line of lines) {
    lineStart.push(acc)
    acc += line.length + 1
  }

  const regionOf = new Map<string, JsonRegion>()
  const stack: Frame[] = []

  lines.forEach((raw, i) => {
    const t = raw.trim()

    if (OPEN_LINE.test(t)) {
      stack.push({ startLine: i })
      return
    }

    if (t.startsWith('}') || t.startsWith(']')) {
      const frame = stack.pop()
      if (frame === undefined) return
      // 最外周（doc 自身）は「現在地」になりえないので登録しない
      if (frame.id !== undefined && stack.length > 0 && knownIds.has(frame.id)) {
        regionOf.set(frame.id, {
          startLine: frame.startLine,
          endLine: i,
          startChar: lineStart[frame.startLine],
          endChar: lineStart[i] + raw.length,
        })
      }
      return
    }

    const m = ID_LINE.exec(t)
    if (m === null) return
    const top = stack[stack.length - 1]
    // id 行を見た時点でスタックの一番上が、その id を持つオブジェクトそのもの
    if (top !== undefined && top.id === undefined) top.id = JSON.parse(`"${m[1]}"`) as string
  })

  return { text, lineCount: lines.length, regionOf }
}

/* ------------------------------------------------------------------ *
 * サブツリーの切り出し
 * ------------------------------------------------------------------ */

export type SubtreeResult = {
  doc: FlowDoc
  /** サブツリーの外へ出入りするため落としたリンクの本数 */
  omittedLinks: number
}

function findStep(steps: readonly FlowStep[], id: string): FlowStep | null {
  for (const s of steps) {
    if (s.id === id) return s
    if (s.children !== undefined) {
      const hit = findStep(s.children, id)
      if (hit !== null) return hit
    }
  }
  return null
}

function collectIds(step: FlowStep, out: Set<string>): void {
  out.add(step.id)
  for (const c of step.children ?? []) collectIds(c, out)
}

/**
 * 今いる階層のサブツリーだけを FlowDoc の形で切り出す。
 *
 * リンクは「両端がサブツリーの内側にあるもの」だけを残す。
 * 片側だけ内側のリンク（＝階層をまたぐ例外遷移）は、切り出した JSON の中に
 * 行き先が存在しない不整合になるため落とし、本数だけを omittedLinks で返して
 * 「省略した」ことを画面に出せるようにしている。黙って消すと真実源が嘘になる。
 */
export function subtreeDoc(doc: FlowDoc, id: string): SubtreeResult | null {
  const step = findStep(doc.root, id)
  if (step === null) return null

  const ids = new Set<string>()
  collectIds(step, ids)

  const links = doc.links.filter((l) => ids.has(l.from) && ids.has(l.to))
  const omittedLinks = doc.links.filter(
    (l) => ids.has(l.from) !== ids.has(l.to),
  ).length

  return {
    doc: {
      id: `${doc.id}#${id}`,
      title: `${doc.title} › ${step.label}`,
      description: doc.description,
      root: [step],
      links,
    },
    omittedLinks,
  }
}

/* ------------------------------------------------------------------ *
 * 編集されたテキストの検証
 * ------------------------------------------------------------------ */

/**
 * StepKind の実行時リスト。
 * schema.ts は型だけを持つ（値を持たない）ため、検証に使う実体をここで定義している。
 * schema.ts 側に値として持たせられれば重複が消えるが、src/flow は変更しない約束なので
 * ここに置いたうえで「増えたら追随が必要」と明示しておく。
 */
const STEP_KINDS: readonly StepKind[] = ['start', 'end', 'task', 'decision', 'group']

export type ParseResult = { ok: true; doc: FlowDoc } | { ok: false; error: string }

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v)
}

/** ステップを再帰検証する。エラーは「どこが悪いか」が分かるパス付きで返す */
function validateSteps(value: unknown, path: string, seen: Set<string>): string | null {
  if (!Array.isArray(value)) return `${path} は配列である必要があります`
  for (let i = 0; i < value.length; i++) {
    const at = `${path}[${i}]`
    const s: unknown = value[i]
    if (!isRecord(s)) return `${at} はオブジェクトである必要があります`
    if (typeof s.id !== 'string' || s.id === '') return `${at}.id は空でない文字列である必要があります`
    if (seen.has(s.id)) return `${at}.id "${s.id}" が重複しています（id は全体で一意である必要があります）`
    seen.add(s.id)
    if (typeof s.label !== 'string') return `${at}.label は文字列である必要があります`
    if (!STEP_KINDS.includes(s.kind as StepKind)) {
      return `${at}.kind は ${STEP_KINDS.join(' / ')} のいずれかである必要があります`
    }
    if (s.children !== undefined) {
      const err = validateSteps(s.children, `${at}.children`, seen)
      if (err !== null) return err
    }
  }
  return null
}

/**
 * 編集されたテキストを FlowDoc として検証する。
 * 失敗しても例外は投げず、理由を文字列で返す。呼び出し側は直前の正常な doc を保持し続ける。
 */
export function parseFlowDoc(text: string): ParseResult {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, error: `JSON として読めません: ${e instanceof Error ? e.message : String(e)}` }
  }

  if (!isRecord(raw)) return { ok: false, error: 'ルートはオブジェクトである必要があります' }
  if (typeof raw.id !== 'string') return { ok: false, error: 'id は文字列である必要があります' }
  if (typeof raw.title !== 'string') return { ok: false, error: 'title は文字列である必要があります' }
  if (raw.description !== undefined && typeof raw.description !== 'string') {
    return { ok: false, error: 'description は文字列である必要があります' }
  }

  const ids = new Set<string>()
  const stepErr = validateSteps(raw.root, 'root', ids)
  if (stepErr !== null) return { ok: false, error: stepErr }

  if (!Array.isArray(raw.links)) return { ok: false, error: 'links は配列である必要があります' }
  for (let i = 0; i < raw.links.length; i++) {
    const at = `links[${i}]`
    const l: unknown = raw.links[i]
    if (!isRecord(l)) return { ok: false, error: `${at} はオブジェクトである必要があります` }
    if (typeof l.from !== 'string') return { ok: false, error: `${at}.from は文字列である必要があります` }
    if (typeof l.to !== 'string') return { ok: false, error: `${at}.to は文字列である必要があります` }
    // 存在しない id を指すリンクはレイアウトを静かに壊すので、ここで弾く
    if (!ids.has(l.from)) return { ok: false, error: `${at}.from "${l.from}" に対応するステップがありません` }
    if (!ids.has(l.to)) return { ok: false, error: `${at}.to "${l.to}" に対応するステップがありません` }
  }

  return { ok: true, doc: raw as unknown as FlowDoc }
}

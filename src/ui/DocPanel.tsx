/**
 * 選択中のノードの手順書パネル。
 *
 * フロー図のノードは「何をするか」を一言でしか持てない。
 * 実務で要るのは「で、具体的に何をどうするのか」なので、
 * ノード 1 つ 1 つに Markdown の手順書（FlowStep.doc）をぶら下げ、
 * ノードを選んだらここに出す。
 *
 * 閲覧モード（editable=false）でも中身は必ず読める。
 * 手順書は「見るためのもの」であって、編集できるかどうかとは関係が無いため。
 * editable=true のときだけ、編集 / プレビューの切り替えと保存が現れる。
 *
 * 見た目の CSS はこのファイル内に閉じてある（クラス名は dp- 接頭辞）。
 * 置き場所（キャンバスの右に重ねる / 既定幅 / 全画面の当て方）だけは
 * styles.css の .doc-dock が持ち、ここは中身の体裁に専念する。
 *
 * 幅のドラッグと全画面の状態はパネル自身が持つ（SidePanel と同じ形）。
 * 幅を当てる要素（.doc-dock = このパネルの root）とつまみ（.resizer）を
 * 同じコンポーネントに置かないと、ドラッグ中の幅計算と保存が 2 ファイルに割れるため。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react'
import type { FlowStep, StepKind } from '../flow/schema'
import { KIND_COLOR } from '../flow/theme'
import { renderMarkdown } from './markdown'
import { clampWidth, parseStoredWidth } from './doc-panel-width'

type Props = {
  /** 選択中のステップ。null なら何も描かない */
  step: FlowStep | null
  /** 編集 UI を出すか。false でも本文の閲覧はできる */
  editable: boolean
  /** 手順書の確定を要求する。保存ボタン / Cmd+Enter / 別ノードへ移るとき に呼ばれる */
  onChange: (id: string, doc: string) => void
  /** パネルを閉じる（＝選択解除）を要求する */
  onClose: () => void
}

type Mode = 'view' | 'edit'

/** ノード種別の日本語表記。バッジに出す */
const KIND_LABEL: Record<StepKind, string> = {
  start: '開始',
  end: '終了',
  task: '作業',
  decision: '分岐',
  group: 'グループ',
}

/** meta の各項目をどの見出しで出すか。順番もこの通りに出る */
const META_FIELDS = [
  { key: 'owner', label: '担当' },
  { key: 'sla', label: 'SLA' },
  { key: 'system', label: 'システム' },
] as const

/**
 * 手順書が空のときに「追加」から差し込むひな形。
 * 白紙の textarea を出されても書き出せないので、書く場所を先に用意する。
 */
const DOC_TEMPLATE = [
  '## 手順',
  '',
  '1. ',
  '2. ',
  '',
  '## 注意点',
  '',
  '- ',
  '',
].join('\n')

/*
 * パネル幅の下限・キャンバスに残す最低幅・クランプは doc-panel-width.ts（SidePanel と同じ考え方）。
 * 既定幅は数値で持たず styles.css の .doc-dock（min(560px, 45%)）に任せる。
 * ドラッグで決めた幅だけを数値で持ち、覚えておく。
 */
/** ドラッグで決めた幅を覚えておく鍵（App.tsx の HINT_KEY / THEME_KEY と同じ流儀） */
const WIDTH_KEY = 'flow-viewer:doc-width'

/** 前回ドラッグで決めた幅。無い / 壊れている / 下限未満 なら null（= CSS の既定幅） */
function loadWidth(): number | null {
  try {
    return parseStoredWidth(localStorage.getItem(WIDTH_KEY))
  } catch {
    return null
  }
}

function saveWidth(width: number): void {
  try {
    localStorage.setItem(WIDTH_KEY, String(Math.round(width)))
  } catch {
    // 覚えられなくても次回は既定幅に戻るだけなので、失敗は無視してよい
  }
}

/*
 * 注意: このファイルからコンポーネント以外を export しないこと。
 * React Fast Refresh がファイル単位で無効になり、開発中の反映が
 * 「差分更新」から「フルリロード」に落ちる。
 * 「id から FlowStep を引く」処理は呼び出し側（App.tsx）が持っている。
 */
export function DocPanel({ step, editable, onChange, onClose }: Props) {
  const [mode, setMode] = useState<Mode>('view')
  const [draft, setDraft] = useState('')
  const [dirty, setDirty] = useState(false)

  // 「別のノードへ移るとき、書きかけを取りこぼさない」ために
  // 最新の下書きを ref でも持つ。cleanup から読むのでレンダー値では間に合わない。
  const draftRef = useRef('')
  const dirtyRef = useRef(false)
  draftRef.current = draft
  dirtyRef.current = dirty

  const stepId = step?.id ?? null
  const stepDoc = step?.doc ?? ''
  // 選択切替の効果から「切替後の doc」を読むための控え（依存に入れずに最新を見る）
  const stepDocRef = useRef(stepDoc)
  stepDocRef.current = stepDoc

  /*
   * onChange も ref 経由で呼ぶ。
   * 呼び出し側が毎レンダー新しい関数を渡してくると、下の「移動時に確定する」効果が
   * 毎レンダー貼り直され、1 文字打つたびに保存が走ってフロー全体が再レイアウトされる。
   * 手順書は数千文字になるので、そこは確実に切っておく。
   */
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  /*
   * 選択が変わったら下書きを張り替える。
   * 依存は stepId だけ（stepDoc は意図して外してある）。ここに stepDoc を混ぜると
   * 自分の保存で発火して dirty を巻き戻すため、外からの変更追従は次の効果に分ける。
   */
  useEffect(() => {
    setDraft(stepDocRef.current)
    setDirty(false)
  }, [stepId])

  /*
   * 同じノードのまま doc が外（JSON パネル等）から書き換わったときの追従。
   * 編集中（dirty）なら書きかけを守るため触らない。
   * ノードを切り替えた直後は dirtyRef がまだ前ノードの値なので素通りするが、
   * 上の効果が先に正しい値を入れているので問題ない。
   */
  useEffect(() => {
    if (dirtyRef.current) return
    setDraft(stepDoc)
  }, [stepDoc])

  /**
   * 別のノードへ移る / パネルが消えるときに、書きかけを確定させる。
   *
   * cleanup で拾うので StrictMode の二重マウントでも安全:
   *   1 回目の cleanup 時点では dirty=false なので何も起きない。
   */
  useEffect(() => {
    if (!stepId) return
    const id = stepId
    return () => {
      if (dirtyRef.current) onChangeRef.current(id, draftRef.current)
    }
  }, [stepId])

  const commit = useCallback(() => {
    if (!stepId || !dirtyRef.current) return
    onChangeRef.current(stepId, draftRef.current)
    setDirty(false)
  }, [stepId])

  const onKeyDown = useCallback(
    (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
      // Cmd/Ctrl + Enter で保存。手順書は長文なので手を離さず確定できる形にする
      if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
        e.preventDefault()
        commit()
      }
    },
    [commit],
  )

  const startWriting = useCallback(() => {
    setMode('edit')
    setDraft((cur) => (cur.trim() === '' ? DOC_TEMPLATE : cur))
    setDirty(true)
  }, [])

  /*
   * 幅と全画面。null の幅は「CSS の既定幅のまま」で、ドラッグして初めて数値になる。
   * root（.doc-dock）は canvas-wrap の右端に貼り付いているので、
   * 幅 = 親の右端 − ポインタ x。SidePanel は window の右端で計っているが、
   * 編集モードでは右に JSON パネルが居て window の右端とは一致しないため、親で計る。
   */
  const rootRef = useRef<HTMLElement>(null)
  const [width, setWidth] = useState<number | null>(loadWidth)
  const [full, setFull] = useState(false)
  const dragging = useRef(false)
  // pointerup で保存するとき、レンダー時点の値ではなく最新値を読むための控え
  const widthRef = useRef(width)
  widthRef.current = width

  const onResizeDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
  }, [])

  const onResizeMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const wrap = rootRef.current?.parentElement
    const right = wrap ? wrap.getBoundingClientRect().right : window.innerWidth
    const wrapWidth = wrap ? wrap.clientWidth : window.innerWidth
    setWidth(clampWidth(right - e.clientX, wrapWidth))
  }, [])

  const onResizeUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
    // 保存は move ごとではなく離したときの 1 回だけ
    if (widthRef.current !== null) saveWidth(widthRef.current)
  }, [])

  // 編集できないときは常に確定済みの内容を、編集できるときは下書きを描く
  const source = editable ? draft : stepDoc
  const html = useMemo(() => renderMarkdown(source), [source])
  const hasDoc = source.trim() !== ''

  if (!step) return null

  const showEditor = editable && mode === 'edit'
  const color = KIND_COLOR[step.kind]
  const metas = META_FIELDS.filter((f) => step.meta?.[f.key])

  return (
    <section
      ref={rootRef}
      className={`doc-dock dp-root${full ? ' full' : ''}`}
      style={full || width === null ? undefined : { width }}
      aria-label="ノードの手順書"
    >
      <style href="flow-viewer-doc-panel" precedence="default">
        {DOC_PANEL_CSS}
      </style>

      {/* 全画面のときは掴む縁が無い（キャンバスを覆っているので動かす意味も無い）。
          .resizer の見た目は styles.css（SidePanel と共用） */}
      {!full && (
        <div
          className="resizer"
          onPointerDown={onResizeDown}
          onPointerMove={onResizeMove}
          onPointerUp={onResizeUp}
          role="separator"
          aria-orientation="vertical"
          title="ドラッグで幅を変える"
        />
      )}

      <header className="dp-head">
        <div className="dp-head-row">
          <span
            className="dp-kind"
            style={{ color: color.text, borderColor: color.stroke, background: color.fill }}
          >
            {KIND_LABEL[step.kind]}
          </span>
          <h2 className="dp-title">{step.label}</h2>
          <div className="dp-grow" />
          {editable && (
            <div className="dp-modes" role="group" aria-label="表示の切り替え">
              <button type="button" data-active={mode === 'view'} onClick={() => setMode('view')}>
                プレビュー
              </button>
              <button type="button" data-active={mode === 'edit'} onClick={() => setMode('edit')}>
                編集
              </button>
            </div>
          )}
          <button
            type="button"
            className="dp-full"
            data-active={full}
            onClick={() => setFull((v) => !v)}
            title="手順書をキャンバス全体へ広げる"
          >
            {full ? '戻す' : '全画面'}
          </button>
          <button type="button" className="dp-close" onClick={onClose} title="閉じる（選択を解除）">
            ×
          </button>
        </div>

        {(metas.length > 0 || step.meta?.note) && (
          <div className="dp-meta">
            {metas.map((f) => (
              <span key={f.key} className="dp-meta-item">
                <span className="dp-meta-label">{f.label}</span>
                {step.meta?.[f.key]}
              </span>
            ))}
            {step.meta?.note && <span className="dp-meta-note">{step.meta.note}</span>}
          </div>
        )}
      </header>

      {showEditor ? (
        <>
          <textarea
            className="dp-editor"
            value={draft}
            spellCheck={false}
            placeholder="Markdown で手順を書く（見出し・番号付きリスト・表・チェックリスト・コードブロックが使えます）"
            onChange={(e) => {
              setDraft(e.target.value)
              setDirty(true)
            }}
            onKeyDown={onKeyDown}
          />
          <footer className="dp-foot">
            <span className="dp-hint">
              {dirty ? (
                <>
                  <span className="dp-dot" />
                  未保存
                </>
              ) : (
                '保存済み'
              )}
              <span className="dp-key">⌘/Ctrl + Enter</span>
            </span>
            <div className="dp-grow" />
            <button
              type="button"
              onClick={() => {
                setDraft(stepDoc)
                setDirty(false)
              }}
              disabled={!dirty}
            >
              破棄
            </button>
            <button type="button" className="dp-save" onClick={commit} disabled={!dirty}>
              保存
            </button>
          </footer>
        </>
      ) : hasDoc ? (
        /*
         * renderMarkdown が marked → DOMPurify を通した文字列しか返さないので、
         * ここで innerHTML に入れてよい。他の経路から HTML を流し込まないこと。
         * スクロールする箱（.dp-body）と本文の列（.markdown-body）を分けているのは、
         * 全画面で本文幅を 880px に止めたときもスクロールバーをパネルの縁に残すため。
         */
        <div className="dp-body">
          <div className="markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
        </div>
      ) : (
        <div className="dp-empty">
          <p>ドキュメントはまだありません。</p>
          {editable ? (
            <>
              <p className="dp-empty-sub">
                このステップの手順・注意点・例外ケースを Markdown で残せます。
              </p>
              <button type="button" className="dp-save" onClick={startWriting}>
                追加
              </button>
            </>
          ) : (
            <p className="dp-empty-sub">
              編集モードに切り替えると、このステップに手順書を追加できます。
            </p>
          )}
        </div>
      )}
    </section>
  )
}

/**
 * パネルの CSS。
 *
 * React 19 の `<style href precedence>` は同じ href のものを 1 つに畳んで
 * <head> へ持ち上げてくれるので、パネルが何度マウントされても重複しない。
 * styles.css を触らずに済ませるためにこの形にしている。
 *
 * 色は styles.css の CSS 変数に乗る（未定義でも読めるようフォールバック付き）。
 */
const DOC_PANEL_CSS = `
.dp-root {
  display: flex;
  flex-direction: column;
  min-height: 0;
  height: 100%;
  overflow: hidden;
  background: var(--bg-panel, #181b26);
  color: var(--text, #dfe4f0);
}

/* ---- ヘッダ ---- */
.dp-head {
  flex: 0 0 auto;
  padding: 10px 12px;
  border-bottom: 1px solid var(--border, #2c3242);
  display: flex;
  flex-direction: column;
  gap: 7px;
}
.dp-head-row {
  display: flex;
  align-items: center;
  gap: 8px;
}
.dp-grow { flex: 1 1 auto; }
.dp-kind {
  flex: 0 0 auto;
  font-size: 11px;
  line-height: 1;
  padding: 4px 8px;
  border: 1px solid;
  border-radius: 999px;
  white-space: nowrap;
}
.dp-title {
  margin: 0;
  font-size: 15px;
  font-weight: 600;
  line-height: 1.35;
  min-width: 0;
  overflow-wrap: anywhere;
}
.dp-modes { display: flex; gap: 4px; }
.dp-modes button,
.dp-full { padding: 4px 9px; font-size: 12px; white-space: nowrap; }
.dp-close {
  padding: 2px 9px;
  font-size: 15px;
  line-height: 1.3;
}
.dp-meta {
  display: flex;
  flex-wrap: wrap;
  gap: 4px 6px;
  align-items: center;
}
.dp-meta-item {
  font-size: 11px;
  padding: 3px 8px;
  border-radius: 999px;
  border: 1px solid var(--border, #2c3242);
  background: var(--bg-raised, #1f2430);
  white-space: nowrap;
}
.dp-meta-label {
  color: var(--text-dim, #8d97ad);
  margin-right: 5px;
}
.dp-meta-note {
  font-size: 11px;
  color: var(--text-dim, #8d97ad);
  line-height: 1.6;
}

/* ---- 本文 ----
   .dp-body はスクロールする箱、.markdown-body はその中の本文の列。
   余白は mdv（24px 40px）を狭いパネル向けに詰め、全画面では mdv と同じ値に戻す */
.dp-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 20px 28px 32px;
}
.dp-root.full .dp-body { padding: 24px 40px 40px; }
.dp-empty {
  flex: 1 1 auto;
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  justify-content: center;
  gap: 8px;
  padding: 20px 16px;
  color: var(--text-dim, #8d97ad);
  line-height: 1.7;
}
.dp-empty p { margin: 0; }
.dp-empty-sub { font-size: 12px; }

/* ---- 編集 ---- */
.dp-editor {
  flex: 1 1 auto;
  min-height: 0;
  width: 100%;
  resize: none;
  border: none;
  outline: none;
  background: var(--bg, #12141c);
  color: var(--text, #dfe4f0);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 12.5px;
  line-height: 1.7;
  padding: 12px 14px;
  tab-size: 2;
}
.dp-foot {
  flex: 0 0 auto;
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px 12px;
  border-top: 1px solid var(--border, #2c3242);
}
.dp-hint {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-dim, #8d97ad);
}
.dp-key {
  font-family: ui-monospace, monospace;
  border: 1px solid var(--border, #2c3242);
  border-radius: 4px;
  padding: 1px 5px;
}
.dp-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: var(--warn, #c9a94e);
}
.dp-save:not(:disabled) {
  border-color: var(--accent, #6b8afd);
  color: var(--accent, #6b8afd);
}

/* ---- Markdown 本体 ----
   業務手順書で実際に使う記法（見出し・番号付き手順・表・引用・
   チェックリスト・コード）が全部読める体裁になっていること。
   寸法は mdv（markdownviewer2.0 の doc-preview.tsx の markdownStyles）に合わせ、
   色は hex を写さず styles.css のトークン（--text / --border / --accent …）へ写像している。
   mdv はライトしか無いので、ダークは同じトークンの読み替えで成立させる。
   ライトで 4.5:1 に届かない組み合わせだけ [data-theme='dark'] で個別に直す。 */
.markdown-body {
  font-size: 14px;
  line-height: 1.75;
}
/* 全画面では 1 行が長くなりすぎて目が戻れないので、本文の幅を 880px で止めて中央に置く。
   編集用の textarea も同じ幅に揃える（書いている行の長さ = 読む行の長さ） */
.dp-root.full .markdown-body,
.dp-root.full .dp-editor {
  max-width: 880px;
  margin: 0 auto;
}
.markdown-body > :first-child { margin-top: 0; }
.markdown-body > :last-child { margin-bottom: 0; }
.markdown-body h1,
.markdown-body h2,
.markdown-body h3,
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 {
  margin: 1.5em 0 0.5em;
  line-height: 1.4;
  font-weight: 600;
  color: var(--text, #dfe4f0);
}
.markdown-body h1 {
  font-size: 2em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border, #2c3242);
}
.markdown-body h2 {
  font-size: 1.5em;
  padding-bottom: 0.3em;
  border-bottom: 1px solid var(--border, #2c3242);
}
.markdown-body h3 { font-size: 1.25em; }
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 { font-size: 1em; }
.markdown-body p { margin: 0 0 1em; }
.markdown-body ul,
.markdown-body ol { margin: 0 0 1em; padding-left: 2em; }
.markdown-body li { margin-bottom: 0.25em; }
.markdown-body li > ul,
.markdown-body li > ol { margin: 0.25em 0 0; }
/* チェックリスト（- [ ] 記法）。中黒とチェックボックスが二重に出ると読みにくいので
   マーカーを消し、その分だけ左へ寄せて他の箇条書きと行頭を揃える
   （mdv の .task-list-item と同じ寄せ幅。marked は class を付けないので :has で拾う） */
.markdown-body li:has(> input[type='checkbox']) {
  list-style: none;
  margin-left: -1.5em;
}
.markdown-body li input[type='checkbox'] {
  margin-right: 0.5em;
  accent-color: var(--accent, #6b8afd);
  vertical-align: -1px;
}
.markdown-body hr {
  height: 0.25em;
  margin: 2em 0;
  background: var(--border, #2c3242);
  border: 0;
  border-radius: 2px;
}
.markdown-body a {
  color: var(--accent, #6b8afd);
  text-decoration: none;
  overflow-wrap: anywhere;
}
.markdown-body a:hover { text-decoration: underline; }
.markdown-body strong { font-weight: 600; color: var(--text, #dfe4f0); }
.markdown-body em { color: var(--text-dim, #8d97ad); }
/* 行内コード。mdv の「アクセントの薄い地 + アクセント文字」を --hl（強調の地）で写す。
   ダークの --hl × --accent は 3.5:1 で読めないので、文字だけ --text にする */
.markdown-body :not(pre) > code {
  padding: 0.2em 0.4em;
  font-size: 85%;
  background: var(--hl, #2f3a63);
  color: var(--accent, #6b8afd);
  border-radius: 6px;
  overflow-wrap: anywhere;
}
[data-theme='dark'] .markdown-body :not(pre) > code { color: var(--text, #dfe4f0); }
/* コードブロック。mdv は常にダーク地だが、ここは両テーマとも地色 + 枠にする
   （ダークの中に更に暗い箱を作れないため。ライトも同じ組み方にして揃える） */
.markdown-body pre {
  margin: 1em 0;
  padding: 1em;
  background: var(--bg, #12141c);
  border: 1px solid var(--border, #2c3242);
  border-radius: 8px;
  font-size: 85%;
  line-height: 1.5;
  overflow: auto;
}
/* 長い行は折り返す（mdv globals.css と同じ）。パネルが狭いので横スクロールより読める */
.markdown-body pre code {
  display: block;
  padding: 0;
  background: none;
  color: inherit;
  /* styles.css の code { font-size: 12px } に負けて pre の 85% とずれるので、pre から継承させる */
  font-size: inherit;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
}
.markdown-body blockquote {
  margin: 1em 0;
  padding: 0.5em 1em;
  color: var(--text-dim, #8d97ad);
  border-left: 0.25em solid var(--border, #2c3242);
  background: var(--bg, #12141c);
  border-radius: 0 4px 4px 0;
}
.markdown-body blockquote > :first-child { margin-top: 0; }
.markdown-body blockquote > :last-child { margin-bottom: 0; }

/* 表は横に伸びがちなので、パネルではなく表自身をスクロールさせる。
   display:block のため中身は内容幅で決まり、width:100% は箱の外形にしか効かない（mdv も同じ組み方） */
.markdown-body table {
  display: block;
  width: 100%;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  border-spacing: 0;
  margin: 1em 0;
  font-size: 13px;
}
.markdown-body th,
.markdown-body td {
  border: 1px solid var(--border, #2c3242);
  padding: 0.5em 1em;
  vertical-align: top;
  line-height: 1.6;
}
/* GFM の :---: は align 属性で来る。CSS で text-align を決め打ちすると潰れるので、属性の無い th だけ左寄せ */
.markdown-body th:not([align]) { text-align: left; }
.markdown-body th {
  background: var(--bg-raised, #1f2430);
  font-weight: 600;
  color: var(--text, #dfe4f0);
}
.markdown-body tbody tr:nth-child(2n) { background: var(--bg, #12141c); }
.markdown-body img {
  max-width: 100%;
  height: auto;
  border-radius: 8px;
  border: 1px solid var(--border, #2c3242);
}
`

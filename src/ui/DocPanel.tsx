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
 * styles.css は別担当の領域なので、そちらに手を入れずに完結させる意図。
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { KeyboardEvent as ReactKeyboardEvent } from 'react'
import type { FlowStep, StepKind } from '../flow/schema'
import { KIND_COLOR } from '../flow/theme'
import { renderMarkdown } from './markdown'

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

  // 編集できないときは常に確定済みの内容を、編集できるときは下書きを描く
  const source = editable ? draft : stepDoc
  const html = useMemo(() => renderMarkdown(source), [source])
  const hasDoc = source.trim() !== ''

  if (!step) return null

  const showEditor = editable && mode === 'edit'
  const color = KIND_COLOR[step.kind]
  const metas = META_FIELDS.filter((f) => step.meta?.[f.key])

  return (
    <section className="dp-root" aria-label="ノードの手順書">
      <style href="flow-viewer-doc-panel" precedence="default">
        {DOC_PANEL_CSS}
      </style>

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
         */
        <div className="dp-body markdown-body" dangerouslySetInnerHTML={{ __html: html }} />
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
.dp-modes button { padding: 4px 9px; font-size: 12px; }
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

/* ---- 本文 ---- */
.dp-body {
  flex: 1 1 auto;
  min-height: 0;
  overflow: auto;
  padding: 14px 16px 28px;
  line-height: 1.85;
}
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
   チェックリスト・コード）が全部読める体裁になっていること。 */
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
}
.markdown-body h1 { font-size: 18px; }
.markdown-body h2 {
  font-size: 15px;
  padding-bottom: 4px;
  border-bottom: 1px solid var(--border, #2c3242);
}
.markdown-body h3 { font-size: 13.5px; color: var(--accent, #6b8afd); }
.markdown-body h4,
.markdown-body h5,
.markdown-body h6 { font-size: 13px; color: var(--text-dim, #8d97ad); }
.markdown-body p { margin: 0 0 0.9em; }
.markdown-body ul,
.markdown-body ol { margin: 0 0 0.9em; padding-left: 1.5em; }
.markdown-body li { margin-bottom: 0.25em; }
.markdown-body li > ul,
.markdown-body li > ol { margin: 0.25em 0 0; }
/* チェックリスト（- [ ] 記法）。中黒とチェックボックスが二重に出ると読みにくいので
   マーカーを消し、その分だけ左へ寄せて他の箇条書きと行頭を揃える */
.markdown-body li:has(> input[type='checkbox']) {
  list-style: none;
  margin-left: -1.3em;
}
.markdown-body li input[type='checkbox'] {
  margin-right: 7px;
  accent-color: var(--accent, #6b8afd);
  vertical-align: -1px;
}
.markdown-body hr {
  border: none;
  border-top: 1px solid var(--border, #2c3242);
  margin: 1.4em 0;
}
.markdown-body a {
  color: var(--accent, #6b8afd);
  text-decoration: underline;
  text-underline-offset: 2px;
  overflow-wrap: anywhere;
}
.markdown-body strong { font-weight: 700; color: #fff; }
.markdown-body code {
  background: var(--bg-raised, #1f2430);
  border: 1px solid var(--border, #2c3242);
  border-radius: 4px;
  padding: 1px 5px;
  font-size: 0.92em;
  overflow-wrap: anywhere;
}
.markdown-body pre {
  margin: 0 0 1em;
  padding: 10px 12px;
  background: var(--bg, #12141c);
  border: 1px solid var(--border, #2c3242);
  border-radius: 6px;
  overflow-x: auto;
  line-height: 1.6;
}
.markdown-body pre code {
  background: none;
  border: none;
  padding: 0;
  white-space: pre;
}
.markdown-body blockquote {
  margin: 0 0 1em;
  padding: 6px 12px;
  border-left: 3px solid var(--warn, #c9a94e);
  background: rgba(201, 169, 78, 0.08);
  color: var(--text, #dfe4f0);
}
.markdown-body blockquote > :last-child { margin-bottom: 0; }

/* 表は横に伸びがちなので、パネルではなく表自身をスクロールさせる */
.markdown-body table {
  display: block;
  max-width: 100%;
  overflow-x: auto;
  border-collapse: collapse;
  margin: 0 0 1em;
  font-size: 12px;
}
.markdown-body th,
.markdown-body td {
  border: 1px solid var(--border, #2c3242);
  padding: 5px 9px;
  text-align: left;
  vertical-align: top;
  line-height: 1.6;
}
.markdown-body th {
  background: var(--bg-raised, #1f2430);
  white-space: nowrap;
  font-weight: 600;
}
.markdown-body img { max-width: 100%; height: auto; }
`

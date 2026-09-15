/**
 * 真実源 JSON のパネル。
 *
 * このプロジェクトの主役の 1 つ。「図はデータから生成されている」ことを常に見せるため、
 * 畳まれた補足情報ではなく、キャンバスと並ぶ常設パネルとして置いている。
 *
 * できること:
 *   - 整形済み JSON の表示（JSON.stringify(doc, null, 2) そのもの）
 *   - クリップボードへのコピー
 *   - **今どこを見ているか**の対応づけ … 現在地のサブツリーをハイライト + 自動スクロール、
 *     あるいは「現在地だけ」に絞り込んで表示
 *   - 編集して図へ反映（壊れた JSON でも落ちない。直前の正常な doc を保持したままエラーを出す）
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { FlowDoc } from '../flow/schema'
import type { FlatDoc } from '../flow/flatten'
import type { ViewMode } from '../flow/view-props'
import { buildJsonView, parseFlowDoc, subtreeDoc } from './json-view'

/** 表示範囲。'all' = doc 全体 / 'here' = 現在地のサブツリーだけ */
type Scope = 'all' | 'here'

type Props = {
  doc: FlowDoc
  flat: FlatDoc
  viewMode: ViewMode
  drillRoot: string | null
  /** 編集された doc を反映する */
  onApplyDoc: (doc: FlowDoc) => void
  /** 編集を捨てて元データへ戻す */
  onResetDoc: () => void
  /** 現在の doc が編集由来か */
  edited: boolean
}

const COPIED_MS = 1600

export function JsonPanel({ doc, flat, viewMode, drillRoot, onApplyDoc, onResetDoc, edited }: Props) {
  const [scope, setScope] = useState<Scope>('all')
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState('')
  const [parseError, setParseError] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  const markRef = useRef<HTMLElement | null>(null)
  const bodyRef = useRef<HTMLDivElement | null>(null)

  // 現在地が無いときにサブツリー表示は成立しないので全体へ落とす
  const effectiveScope: Scope = drillRoot === null ? 'all' : scope

  const knownIds = useMemo(() => new Set(flat.byId.keys()), [flat])

  const sub = useMemo(
    () => (effectiveScope === 'here' && drillRoot !== null ? subtreeDoc(doc, drillRoot) : null),
    [effectiveScope, drillRoot, doc],
  )

  const shownDoc = sub?.doc ?? doc
  const view = useMemo(() => buildJsonView(shownDoc, knownIds), [shownDoc, knownIds])

  // 全体表示のときだけハイライトする。サブツリー表示は「画面そのもの」なので不要
  const region = effectiveScope === 'all' && drillRoot !== null ? view.regionOf.get(drillRoot) : undefined

  // 現在地が変わったらその位置まで自動で送る。JSON 側を探し回らずに済むようにする。
  // ハイライトが無い（トップ / サブツリー表示）ときは先頭へ戻す。
  // 前の現在地のスクロール位置が残ると、別物を見ているのに同じ場所を見ている気分になるため。
  useEffect(() => {
    if (editing) return
    if (markRef.current !== null) {
      // 'start' で領域の先頭（そのステップの `{` の行）を上端に付ける。
      // center にすると長いサブツリーでは頭が画面外に隠れ、どこから始まるか読めなくなる
      markRef.current.scrollIntoView({ block: 'start', behavior: 'smooth' })
      return
    }
    bodyRef.current?.scrollTo({ top: 0 })
  }, [editing, region?.startChar, shownDoc])

  // データそのものが差し替わったら編集モードは畳む（別データの上に編集内容が残らないように）
  useEffect(() => {
    setEditing(false)
    setParseError(null)
  }, [doc.id])

  const startEdit = useCallback(() => {
    setDraft(view.text)
    setParseError(null)
    setEditing(true)
  }, [view.text])

  const handleDraft = useCallback((text: string) => {
    setDraft(text)
    // 打っている最中から検証する。反映は明示ボタンなので、ここでは知らせるだけ
    const r = parseFlowDoc(text)
    setParseError(r.ok ? null : r.error)
  }, [])

  const apply = useCallback(() => {
    const r = parseFlowDoc(draft)
    if (!r.ok) {
      setParseError(r.error)
      return
    }
    onApplyDoc(r.doc)
    setParseError(null)
    setEditing(false)
  }, [draft, onApplyDoc])

  const copy = useCallback(() => {
    void (async () => {
      try {
        await navigator.clipboard.writeText(view.text)
        setCopied(true)
      } catch (e) {
        setParseError(`コピーできませんでした: ${e instanceof Error ? e.message : String(e)}`)
      }
    })()
  }, [view.text])

  useEffect(() => {
    if (!copied) return
    const t = window.setTimeout(() => setCopied(false), COPIED_MS)
    return () => window.clearTimeout(t)
  }, [copied])

  const hereLabel = drillRoot === null ? null : (flat.byId.get(drillRoot)?.label ?? drillRoot)

  return (
    <div className="json-panel">
      <div className="json-head">
        <div className="json-head-row">
          <strong className="json-title">真実源の JSON</strong>
          {edited && <span className="tag edited">編集中</span>}
          <div className="spacer" />
          <button onClick={copy} title="表示中の JSON をクリップボードへコピー">
            {copied ? 'コピーしました' : 'コピー'}
          </button>
        </div>

        <div className="json-head-row">
          <span className="label">範囲</span>
          <button data-active={effectiveScope === 'all'} onClick={() => setScope('all')}>
            全体
          </button>
          <button
            data-active={effectiveScope === 'here'}
            onClick={() => setScope('here')}
            disabled={drillRoot === null}
            title={
              drillRoot === null
                ? 'トップにいるときは全体と同じなので選べません'
                : '今いる階層のサブツリーだけを FlowDoc の形で切り出して表示する'
            }
          >
            現在地だけ
          </button>
          <div className="spacer" />
          {editing ? (
            <>
              <button onClick={apply} data-active={parseError === null} disabled={parseError !== null}>
                図へ反映
              </button>
              <button onClick={() => setEditing(false)}>やめる</button>
            </>
          ) : (
            <>
              <button
                onClick={startEdit}
                disabled={effectiveScope === 'here'}
                title={
                  effectiveScope === 'here'
                    ? '切り出したサブツリーは編集できません（全体に戻してください）'
                    : 'JSON を直接編集して図に反映する'
                }
              >
                編集
              </button>
              {edited && (
                <button onClick={onResetDoc} title="編集を捨てて元のデータに戻す">
                  元に戻す
                </button>
              )}
            </>
          )}
        </div>

        {/* 「JSON のどこが今の画面か」を言葉でも示す。ハイライトと二重に持たせて迷子を防ぐ */}
        <div className="json-status">
          {view.lineCount} 行
          {effectiveScope === 'here' && sub !== null ? (
            <>
              {' · '}
              <span className="hl">{hereLabel}</span> のサブツリーだけを表示中
              {sub.omittedLinks > 0 && (
                <>
                  {' · '}
                  <span className="warn">外へ出入りする {sub.omittedLinks} 本のリンクは省略</span>
                </>
              )}
            </>
          ) : region !== undefined ? (
            <>
              {' · 現在地 '}
              <span className="hl">{hereLabel}</span>
              {` = ${region.startLine + 1}〜${region.endLine + 1} 行目`}
            </>
          ) : viewMode === 'nested' ? (
            ' · 入れ子モードでは全階層が同時に見えているので、JSON 全体がそのまま現在の画面'
          ) : (
            ' · 現在地はトップ。潜ると該当箇所がここでハイライトされる'
          )}
        </div>
      </div>

      {editing ? (
        <div className="json-body">
          <textarea
            className="json-edit"
            value={draft}
            spellCheck={false}
            onChange={(e) => handleDraft(e.target.value)}
            aria-label="真実源 JSON の編集"
          />
        </div>
      ) : (
        <div className="json-body" ref={bodyRef}>
          {/* 3 分割して真ん中を <mark> で囲む。行ごとに要素を作らないので大規模データでも重くならない */}
          <pre className="json-pre">
            {region === undefined ? (
              view.text
            ) : (
              <>
                {view.text.slice(0, region.startChar)}
                <mark ref={markRef}>{view.text.slice(region.startChar, region.endChar)}</mark>
                {view.text.slice(region.endChar)}
              </>
            )}
          </pre>
        </div>
      )}

      {parseError !== null && (
        <div className="json-error" role="alert">
          {parseError}
          <div className="hint">
            図は直前の正常なデータのまま表示しています。直せばそのまま反映できます。
          </div>
        </div>
      )}
    </div>
  )
}

/**
 * 右サイドパネル。JSON と情報をタブで切り替える。
 *
 * 幅はドラッグで変えられ、「全画面」でステージ全体を覆う。
 * JSON を読むときは横幅が要る（深い階層はインデントだけで 20 桁を超える）ため、
 * 固定幅のまま折り返して読ませない形にしてある。
 *
 * open=false でも null を返すだけでアンマウントはしない。
 * タブ・幅・スクロール位置といった「見る側の状態」を、開閉のたびに失わせないため。
 */

import { useCallback, useRef, useState } from 'react'
import type { PointerEvent as ReactPointerEvent } from 'react'
import type { FlowDoc } from '../flow/schema'
import type { FlatDoc } from '../flow/flatten'
import type { ViewMode } from '../flow/view-props'
import type { TestCase } from '../flow/cases'
import { JsonPanel } from './JsonPanel'
import { InfoPanel } from './InfoPanel'

type Tab = 'json' | 'info'

/** パネル幅の下限・キャンバスに残す最低幅 */
const MIN_WIDTH = 300
const MIN_CANVAS = 320
const DEFAULT_WIDTH = 460

type Props = {
  open: boolean
  doc: FlowDoc
  flat: FlatDoc
  viewMode: ViewMode
  collapsed: ReadonlySet<string>
  drillRoot: string | null
  testCase?: TestCase
  onApplyDoc: (doc: FlowDoc) => void
  onResetDoc: () => void
  edited: boolean
}

export function SidePanel(props: Props) {
  const { open, doc, flat, viewMode, collapsed, drillRoot, testCase, onApplyDoc, onResetDoc, edited } = props

  const [tab, setTab] = useState<Tab>('json')
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [full, setFull] = useState(false)
  const dragging = useRef(false)

  const onPointerDown = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId)
    dragging.current = true
  }, [])

  const onPointerMove = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const raw = window.innerWidth - e.clientX
    const max = Math.max(MIN_WIDTH, window.innerWidth - MIN_CANVAS)
    setWidth(Math.min(max, Math.max(MIN_WIDTH, raw)))
  }, [])

  const onPointerUp = useCallback((e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false
    e.currentTarget.releasePointerCapture(e.pointerId)
  }, [])

  if (!open) return null

  return (
    <aside className={`side${full ? ' full' : ''}`} style={full ? undefined : { width }}>
      {/* 全画面のときは掴む縁が無い（ステージを覆っているので動かす意味も無い） */}
      {!full && (
        <div
          className="resizer"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          role="separator"
          aria-orientation="vertical"
          title="ドラッグで幅を変える"
        />
      )}

      <div className="side-tabs">
        <button data-active={tab === 'json'} onClick={() => setTab('json')}>
          JSON
        </button>
        <button data-active={tab === 'info'} onClick={() => setTab('info')}>
          情報
          {testCase && <span className="dot" title="テストケースの説明があります" />}
        </button>
        <div className="spacer" />
        <button onClick={() => setFull((v) => !v)} data-active={full} title="パネルをステージ全体へ広げる">
          {full ? '全画面を解除' : '全画面'}
        </button>
      </div>

      <div className="side-body">
        {tab === 'json' ? (
          <JsonPanel
            doc={doc}
            flat={flat}
            viewMode={viewMode}
            drillRoot={drillRoot}
            onApplyDoc={onApplyDoc}
            onResetDoc={onResetDoc}
            edited={edited}
          />
        ) : (
          <InfoPanel
            doc={doc}
            flat={flat}
            viewMode={viewMode}
            collapsed={collapsed}
            drillRoot={drillRoot}
            testCase={testCase}
          />
        )}
      </div>
    </aside>
  )
}

/**
 * ツールバー。
 *
 * 「業務フローを読む」ツールなので、常時見えている 1 段には
 *   現在地（パンくず）→ 上へ / 中へ → 表示モード → 設定 → モード切替
 * だけを置く。フローの見た目に効く微調整（方向・アニメ・上位表示・入れ子経路・抽象度）は
 * 歯車のポップオーバーへ、フローそのものを変える操作（データ選択・折りたたみ個別指定・JSON）は
 * 編集モードの 2 段目へ退避させてある。どちらも消してはいない。
 *
 * 高さの都合:
 *   閲覧モードは 1 段（約 40px）。折り返しを禁止し、長いパンくずは横スクロールで逃がす。
 *   キャンバスの縦を最大限フローに使わせることが、このツールバーの一番の仕事。
 */

import { useEffect, useRef, useState } from 'react'
import type { ReactNode } from 'react'

import type { Direction } from '../flow/schema'
import type { ViewMode } from '../flow/view-props'
import type { FlatDoc } from '../flow/flatten'
import { pathTo } from '../flow/flatten'

import { dataSelOptions } from '../flow/data-source'
import type { DataSel } from '../flow/data-source'

/**
 * 画面のモード。
 * - view: フローを読む。ツールバー 1 段 / JSON パネル無し / キャンバス全幅
 * - edit: フローを直す。データ選択・折りたたみ・JSON パネルが現れる
 */
export type UiMode = 'view' | 'edit'

type Props = {
  mode: UiMode
  onMode: (m: UiMode) => void
  flat: FlatDoc
  dataSel: DataSel
  onDataSel: (d: DataSel) => void
  stats: { nodes: number; groups: number; leaves: number; links: number; maxDepth: number }
  viewMode: ViewMode
  onViewMode: (m: ViewMode) => void
  direction: Direction
  onDirection: (d: Direction) => void
  collapsed: ReadonlySet<string>
  onToggleCollapse: (id: string) => void
  onCollapseAll: () => void
  onExpandAll: () => void
  onCollapseDepth: (depth: number) => void
  drillRoot: string | null
  onDrillDown: (id: string | null) => void
  showContext: boolean
  onShowContext: (v: boolean) => void
  animate: boolean
  onAnimate: (v: boolean) => void
  nestPath: boolean
  onNestPath: (v: boolean) => void
  sideOpen: boolean
  onToggleSide: () => void
}

/**
 * ボタンを押すと下に出る小さなパネル。
 * 外側クリックと Esc で閉じる。子は close を受け取り、選んだら自分で閉じられる。
 */
function Popover(props: {
  label: string
  title: string
  align?: 'left' | 'right'
  children: (close: () => void) => ReactNode
}) {
  const { label, title, align = 'right', children } = props
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    // capture ではなく通常フェーズ。中のボタンの onClick を先に走らせるため
    document.addEventListener('pointerdown', onDown)
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('pointerdown', onDown)
      document.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div className="popover" ref={ref}>
      <button data-active={open} title={title} aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        {label}
      </button>
      {open && (
        <div className="popover-body" data-align={align}>
          {children(() => setOpen(false))}
        </div>
      )}
    </div>
  )
}

export function Toolbar(props: Props) {
  const {
    mode,
    onMode,
    flat,
    dataSel,
    onDataSel,
    stats,
    viewMode,
    onViewMode,
    direction,
    onDirection,
    collapsed,
    onToggleCollapse,
    onCollapseAll,
    onExpandAll,
    onCollapseDepth,
    drillRoot,
    onDrillDown,
    showContext,
    onShowContext,
    animate,
    onAnimate,
    nestPath,
    onNestPath,
    sideOpen,
    onToggleSide,
  } = props

  const crumbs = drillRoot ? pathTo(drillRoot, flat.parentOf) : []
  const isDrill = viewMode === 'drilldown'
  const isSplit = viewMode === 'split'
  // 階層を潜る導線は drilldown と split の両方で必要
  const hasDrillNav = isDrill || isSplit

  // 「今の階層から潜れる先」。入れ子モードのようにグループを畳むのではなく、中に入るための導線
  const enterable = flat.containerIds.filter((id) =>
    drillRoot === null ? flat.byId.get(id)?.parentId === undefined : flat.byId.get(id)?.parentId === drillRoot,
  )

  return (
    <div className={`toolbar${mode === 'edit' ? ' is-edit' : ''}`}>
      {/* --- 常時見える 1 段。主役は現在地 --- */}
      <div className="bar">
        <span className="app-name">業務フロー</span>

        {/* 現在地。JSON パネルのハイライトもここに追従する */}
        <nav className="crumbs" aria-label="現在地">
          <button data-active={drillRoot === null} onClick={() => onDrillDown(null)}>
            {hasDrillNav ? '部門レベル' : '全体'}
          </button>
          {crumbs.map((id) => (
            <span key={id} className="crumb">
              <span className="sep">›</span>
              <button data-active={id === drillRoot} onClick={() => onDrillDown(id)}>
                {flat.byId.get(id)?.label ?? id}
              </button>
            </span>
          ))}
        </nav>

        {drillRoot !== null && (
          <button
            className="ghost"
            onClick={() => onDrillDown(flat.byId.get(drillRoot)?.parentId ?? null)}
            title="1 つ上の階層に戻る"
          >
            ↑ 上へ
          </button>
        )}

        {/* 潜る先の一覧。キャンバス上のグループを直接押しても潜れるが、
            「この階層に何があるか」を一覧で確かめたいときの保険として残す */}
        {hasDrillNav && enterable.length > 0 && (
          <Popover label="中へ ▾" title="この階層から潜れるグループ" align="left">
            {(close) => (
              <div className="menu-list">
                {enterable.map((id) => (
                  <button
                    key={id}
                    className="menu-item"
                    onClick={() => {
                      onDrillDown(id)
                      close()
                    }}
                  >
                    {flat.byId.get(id)?.label ?? id}
                  </button>
                ))}
              </div>
            )}
          </Popover>
        )}

        <div className="spacer" />

        {/* 表示モード 3 種。閲覧モードでも全部使える */}
        <div className="seg" role="group" aria-label="表示モード">
          <button data-active={isDrill} onClick={() => onViewMode('drilldown')} title="1 画面に 1 階層だけ">
            ドリルダウン
          </button>
          <button data-active={isSplit} onClick={() => onViewMode('split')} title="左＝上位 / 右＝今の階層">
            左右分割
          </button>
          <button data-active={viewMode === 'nested'} onClick={() => onViewMode('nested')} title="全階層を入れ子で">
            入れ子
          </button>
        </div>

        {/* 見え方の微調整。常時出す必要が無いものはここに畳んである */}
        <Popover label="⚙" title="表示の詳細設定">
          {() => (
            <div className="menu">
              <div className="menu-row">
                <span className="label">方向</span>
                <button data-active={direction === 'RIGHT'} onClick={() => onDirection('RIGHT')}>
                  横 →
                </button>
                <button data-active={direction === 'DOWN'} onClick={() => onDirection('DOWN')}>
                  縦 ↓
                </button>
              </div>

              {isDrill && (
                <div className="menu-row">
                  <span className="label">上位階層</span>
                  <button
                    data-active={showContext}
                    onClick={() => onShowContext(!showContext)}
                    title="1 つ上の階層を薄く表示して、外へ出る線の行き先を見えるようにする"
                  >
                    {showContext ? '表示' : '非表示'}
                  </button>
                </div>
              )}

              {isSplit && (
                <div className="menu-row">
                  <span className="label">左ペイン</span>
                  <button
                    data-active={nestPath}
                    onClick={() => onNestPath(!nestPath)}
                    title="左ペインに最上位からの経路を入れ子で展開する。OFF なら 1 つ上の階層だけ"
                  >
                    {nestPath ? '経路を入れ子' : '1 つ上だけ'}
                  </button>
                </div>
              )}

              {!hasDrillNav && (
                <div className="menu-row">
                  <span className="label">抽象度</span>
                  <button onClick={onExpandAll}>全展開</button>
                  <button onClick={() => onCollapseDepth(1)}>業務</button>
                  <button onClick={onCollapseAll}>部門</button>
                </div>
              )}

              <div className="menu-row">
                <span className="label">アニメ</span>
                <button data-active={animate} onClick={() => onAnimate(!animate)} title="階層移動のアニメーション">
                  {animate ? 'ON' : 'OFF'}
                </button>
              </div>

              <div className="menu-note">
                {stats.maxDepth} 段 / {stats.nodes} ノード（グループ {stats.groups}）/ {stats.links} リンク
              </div>
            </div>
          )}
        </Popover>

        {mode === 'view' ? (
          <button className="primary" onClick={() => onMode('edit')} title="データ選択・JSON 編集を開く">
            編集
          </button>
        ) : (
          <>
            <button data-active={sideOpen} onClick={onToggleSide} title="真実源の JSON パネルの開閉">
              JSON
            </button>
            <button className="primary" onClick={() => onMode('view')} title="フローを読むことに集中する">
              閲覧に戻る
            </button>
          </>
        )}
      </div>

      {/* --- 編集モードだけの 2 段目。フローそのものを変える操作 --- */}
      {mode === 'edit' && (
        <div className="bar sub">
          <span className="label">データ</span>
          <select
            value={dataSel}
            onChange={(e) => onDataSel(e.target.value)}
            title="手書きサンプル / 任意深さの自動生成 / 32 種のテストケース"
          >
            {dataSelOptions().map((g) => (
              <optgroup key={g.label} label={g.label}>
                {g.options.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </optgroup>
            ))}
          </select>

          {!hasDrillNav && (
            <>
              <span className="label">折りたたみ ({collapsed.size})</span>
              <div className="chip-strip">
                {flat.containerIds.map((id) => {
                  const node = flat.byId.get(id)
                  if (!node) return null
                  return (
                    <button
                      key={id}
                      className="chip"
                      data-on={collapsed.has(id)}
                      title={`${node.label}（深さ ${node.depth}）`}
                      onClick={() => onToggleCollapse(id)}
                    >
                      {'　'.repeat(node.depth)}
                      {node.label}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

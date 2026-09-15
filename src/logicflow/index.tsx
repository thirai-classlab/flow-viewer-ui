/**
 * LogicFlow による描画（@logicflow/core 2.2.5 + @logicflow/extension 2.3.1）
 *
 * UI 側との契約はこのファイルの `FlowCanvas` ただ 1 つ。
 * `<FlowCanvas {...viewProps} />` を呼ぶだけで 5 状態（nested / drilldown ×2 / split ×2）が動く。
 *
 * 設計の前提（ライブラリ選定の実測根拠は NOTES.md に全文がある）:
 *   1. 折りたたみは共通の rewriteEdges() を使わず、dynamic-group プラグインの
 *      DynamicGroupNodeModel.toggleCollapse() / collapsedWidth / collapsedHeight /
 *      createVirtualEdge を素のまま使い、足りなかった分だけを自前で補っている。
 *   2. アニメーションのビルトインは「エッジの流動ダッシュ（.lf-edge-animation）」だけ。
 *      ビューポート系（zoom / translate / focusOn / fitView）は全部即時で、
 *      duration も easing も受け取らない。よってここのアニメーションは
 *      「CSS transition / WAAPI / 自前 rAF」+「LogicFlow のモデル API」の組み合わせ。
 *
 * ファイル構成（このディレクトリ）:
 *   layout.ts            自前レイアウト（DAG のランク付け + 入れ子の箱詰め）
 *   nodes.ts             LogicFlow データへの変換 / カスタムノード
 *   anim.ts              アニメーション CSS・ビューポート・ゴースト・位置トゥイーン
 *   lf.ts                インスタンス生成と共通テーマ
 *   drilldown.ts         drilldown モードのグラフ構築（showContext 両方）
 *   split.ts             split モードのグラフ構築（nestPath 両方）
 *   use-drill-effect.ts  nested / drilldown の描画 effect
 *   use-split-effect.ts  split の描画 effect（2 インスタンス）
 *   styles.ts            split 用 HTML パーツのスタイル
 *   NOTES.md             実装して分かったこと（採用根拠 / 踏んではいけない地雷）
 */

import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react'
import type LogicFlow from '@logicflow/core'

import type { FlowViewProps } from '../flow/view-props'
import { pathTo } from '../flow/flatten'
import { MAX_NEST_LEVELS } from '../flow/collapse'
import { CONTEXT_COLOR, SPLIT } from '../flow/theme'
import type { Viewport } from './anim'
import { ANIM_CLASS, HOST_CLASS, PANE_IN_CLASS } from './anim'
import type { Placed } from './layout'
import type { LayoutSnapshot, SplitPair } from './lf'
import { applySelection } from './nodes'
import { nestUpperRatio } from './split'
import { nestOmitButtonStyle, nestOmitStyle, splitEmptyStyle, splitHeaderStyle } from './styles'
import { useDrillEffect } from './use-drill-effect'
import { useSplitEffect } from './use-split-effect'

/* ------------------------------------------------------------------ *
 * React コンポーネント — UI 側に公開する唯一の入口
 * ------------------------------------------------------------------ */

export function FlowCanvas(props: FlowViewProps) {
  const {
    doc,
    flat,
    collapsed,
    direction,
    drillRoot,
    viewMode,
    prevDrillRoot,
    showContext,
    animate,
    nestPath,
    selectedId,
  } = props
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const hostRef = useRef<HTMLDivElement | null>(null)
  const ghostHostRef = useRef<HTMLDivElement | null>(null)
  const lfRef = useRef<LogicFlow | null>(null)
  // split の 2 ペイン。ホスト・ゴースト層・インスタンスをそれぞれ 2 セット持つ
  const upperHostRef = useRef<HTMLDivElement | null>(null)
  const lowerHostRef = useRef<HTMLDivElement | null>(null)
  const upperGhostRef = useRef<HTMLDivElement | null>(null)
  const lowerGhostRef = useRef<HTMLDivElement | null>(null)
  // 最上位（1 ペイン）では左ペインごと DOM から消えるので、
  // 「消えた左ペイン」のゴーストを置くレイヤだけ最上位側に用意しておく
  const upperExitRef = useRef<HTMLDivElement | null>(null)
  // 最上位ではインスタンスが 1 つしか無いので upper は null になりうる
  const splitLfRef = useRef<SplitPair<LogicFlow | null> | null>(null)
  const [error, setError] = useState<string | null>(null)
  // ドリルダウンで画面の外へ出入りする線の本数 / それを表す境界マーカーの数
  const [outOfScopeLinks, setOutOfScopeLinks] = useState(0)
  const [boundaryMarkers, setBoundaryMarkers] = useState(0)
  // フォーカス + コンテキスト表示の状況（画面上部の注記に出す）
  const [contextInfo, setContextInfo] = useState<{ count: number; crossing: number; parent: string } | null>(
    null,
  )
  // split の状況（ペインをまたぐ線は引かないので、本数は注記で示す）
  const [splitInfo, setSplitInfo] = useState<{
    upper: number
    lower: number
    linked: number
    cross: number
  } | null>(null)
  // 経路入れ子（nestPath）の状況。省略された祖先・入れ子段数・圏外本数・実測の縮尺
  const [nestInfo, setNestInfo] = useState<{
    levels: number
    boxDepth: number
    omitted: { id: string; label: string }[]
    outOfScope: number
    scale: number
  } | null>(null)

  // イベントハンドラは毎レンダーで作り直されるので ref 経由で最新を読む
  const cbRef = useRef({
    onToggleCollapse: props.onToggleCollapse,
    onDrillDown: props.onDrillDown,
    onSelect: props.onSelect,
  })
  cbRef.current = {
    onToggleCollapse: props.onToggleCollapse,
    onDrillDown: props.onDrillDown,
    onSelect: props.onSelect,
  }
  // プログラム側から toggleCollapse を呼ぶ間は dynamicGroup:collapse を無視する
  const syncingRef = useRef(false)
  // 直前の描画のスナップショット（ゴースト HTML / 座標 / ビューポート / 階層）
  const ghostRef = useRef<string | null>(null)
  const prevLayoutRef = useRef<LayoutSnapshot | null>(null)
  const prevViewportRef = useRef<Viewport | null>(null)
  // prevDrillRoot は「最後に潜ったときの値」で固定されるため、
  // 方向切替などの再描画でも 'enter' と誤判定される。実際に階層が変わったかは自前で持つ。
  const lastRootRef = useRef<string | null | undefined>(undefined)
  // split 用のスナップショット（drilldown 側と混ざらないよう完全に別で持つ）
  const splitGhostRef = useRef<SplitPair<string | null> | null>(null)
  const splitLayoutRef = useRef<SplitPair<Map<string, Placed>> | null>(null)
  const splitViewportRef = useRef<SplitPair<Viewport | null>>({ upper: null, lower: null })
  const lastSplitRootRef = useRef<string | null | undefined>(undefined)

  useDrillEffect({
    doc,
    flat,
    collapsed,
    direction,
    drillRoot,
    viewMode,
    prevDrillRoot,
    showContext,
    animate,
    selectedId,
    wrapRef,
    hostRef,
    ghostHostRef,
    lfRef,
    cbRef,
    syncingRef,
    ghostRef,
    prevLayoutRef,
    prevViewportRef,
    lastRootRef,
    setError,
    setOutOfScopeLinks,
    setBoundaryMarkers,
    setContextInfo,
    setSplitInfo,
    setNestInfo,
  })

  useSplitEffect({
    doc,
    flat,
    direction,
    drillRoot,
    viewMode,
    prevDrillRoot,
    animate,
    nestPath,
    selectedId,
    wrapRef,
    upperHostRef,
    lowerHostRef,
    upperGhostRef,
    lowerGhostRef,
    upperExitRef,
    splitLfRef,
    cbRef,
    splitGhostRef,
    splitLayoutRef,
    splitViewportRef,
    lastSplitRootRef,
    setError,
    setSplitInfo,
    setNestInfo,
  })

  /* 選択枠は DOM 側で付け替える。
     selectedId を描画 effect の依存に入れると、ノードを選ぶたびに LogicFlow を
     作り直す（destroy → render → 出現アニメ再生）ことになり、選ぶだけで画面が跳ねる。
     この effect は描画 effect より後に走るので、再描画直後の貼り直しもここで足りる
     — 依存に描画のきっかけ（階層・モード・向き・データ）を全部並べてあるのはそのため。 */
  useEffect(() => {
    applySelection(wrapRef.current, selectedId)
  }, [selectedId, doc, flat, viewMode, direction, drillRoot, showContext, animate, nestPath, collapsed])

  const goUp = useCallback(() => {
    if (!drillRoot) return
    const path = pathTo(drillRoot, flat.parentOf)
    props.onDrillDown(path.length >= 2 ? path[path.length - 2] : null)
  }, [drillRoot, flat.parentOf, props])

  const onDrillDown = props.onDrillDown
  // 現在位置のパンくず。キャンバス内から任意の階層へ戻れるようにする
  const crumbs = drillRoot === null ? [] : pathTo(drillRoot, flat.parentOf)

  const isSplit = viewMode === 'split'
  const currentNode = drillRoot === null ? null : (flat.byId.get(drillRoot) ?? null)
  const upperParentId = currentNode?.parentId
  // 経路入れ子で描いているか（最上位は上位階層自体が無いので対象外）
  const useNestUi = isSplit && nestPath && drillRoot !== null
  /* 左ペイン幅。入れ子は横に広がるので経路の深さに応じて広げる。
     effect 側の視野合わせも同じ式で計算している。 */
  const paneRatio = useNestUi ? nestUpperRatio(crumbs.length) : SPLIT.upperRatio
  /* 最上位へ戻ったときに重ねる「消えた左ペイン」のゴースト幅。
     直前にいた階層（prevDrillRoot）の深さで決まる。 */
  const exitPaneRatio =
    nestPath && prevDrillRoot !== null
      ? nestUpperRatio(pathTo(prevDrillRoot, flat.parentOf).length)
      : SPLIT.upperRatio
  // 左ペインの見出し = 上位階層が属する親の名前（トップ直下なら「トップ階層」）
  const upperTitle = useNestUi
    ? `全体の中の現在地（経路 ${crumbs.length} 段 / 展開 ${nestInfo?.levels ?? '-'} 段）`
    : currentNode === null
      ? '上位階層'
      : upperParentId === undefined
        ? '上位階層（トップ階層）'
        : `上位階層（${flat.byId.get(upperParentId)?.label ?? upperParentId}）`
  const lowerTitle = currentNode === null ? 'トップ階層' : currentNode.label

  return (
    <div
      ref={wrapRef}
      className={`${HOST_CLASS}${animate ? ` ${ANIM_CLASS}` : ''}`}
      style={{ width: '100%', height: '100%', position: 'relative' }}
    >
      {isSplit ? (
        /* ---- split: 左 = 上位階層 / 右 = 今いる階層の中身。境界に SPLIT.divider ----
         * 最上位（drillRoot === null）は上位階層が存在しないので、
         * 左ペインを「空のまま置く」のではなく丸ごとマウントしない。
         * 右ペインは flex:1 なので、そのまま幅 100% の全画面 1 ペインになる。 */
        <div style={{ position: 'absolute', inset: 0, display: 'flex' }}>
          {drillRoot !== null && (
            <div
              className={PANE_IN_CLASS}
              style={
                {
                  width: `${paneRatio * 100}%`,
                  // keyframes lfa-pane-in の終端がこの変数を読む（幅が可変なので定数にできない）
                  '--lfa-pane-w': `${paneRatio * 100}%`,
                  height: '100%',
                  display: 'flex',
                  flexDirection: 'column',
                  borderRight: `1px solid ${SPLIT.divider}`,
                  boxSizing: 'border-box',
                  overflow: 'hidden',
                } as CSSProperties
              }
            >
              <div style={splitHeaderStyle}>{upperTitle}</div>
              {/* 経路が MAX_NEST_LEVELS を超えて畳まれた祖先。クリックでその階層へ戻る */}
              {useNestUi && nestInfo !== null && nestInfo.omitted.length > 0 && (
                <div style={nestOmitStyle}>
                  <span style={{ color: '#6d7690', flex: '0 0 auto' }}>
                    ⋯ 上位 {nestInfo.omitted.length} 階層
                  </span>
                  {nestInfo.omitted.map((a) => (
                    <button
                      key={a.id}
                      type="button"
                      onClick={() => onDrillDown(a.id)}
                      style={nestOmitButtonStyle}
                      title={`${a.label} へ戻る`}
                    >
                      {a.label}
                    </button>
                  ))}
                </div>
              )}
              <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
                <div ref={upperHostRef} style={{ width: '100%', height: '100%' }} />
                <div
                  ref={upperGhostRef}
                  aria-hidden="true"
                  style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
                />
              </div>
            </div>
          )}
          {/* 最上位に戻ったときだけ現れる「消えた左ペイン」のゴースト置き場。
              全画面になった右ペインの上に重ねてフェードアウトさせる */}
          {drillRoot === null && (
            <div
              ref={upperExitRef}
              aria-hidden="true"
              style={{
                position: 'absolute',
                left: 0,
                top: SPLIT.headerHeight,
                bottom: 0,
                width: `${exitPaneRatio * 100}%`,
                pointerEvents: 'none',
                overflow: 'hidden',
                zIndex: 1,
              }}
            />
          )}
          <div style={{ flex: 1, minWidth: 0, height: '100%', display: 'flex', flexDirection: 'column' }}>
            <div style={splitHeaderStyle}>
              <span style={{ color: '#e5ebfa' }}>{lowerTitle}</span> の中身
              {drillRoot !== null && (
                <button
                  type="button"
                  onClick={goUp}
                  style={{
                    marginLeft: 8,
                    background: 'none',
                    border: `1px solid ${SPLIT.divider}`,
                    borderRadius: 4,
                    color: '#8d97ad',
                    cursor: 'pointer',
                    font: 'inherit',
                    padding: '0 6px',
                  }}
                >
                  ↑ 戻る
                </button>
              )}
            </div>
            {/* overflow:hidden は、幅の違うペイン間を行き来したときに
                前の描画のゴースト（1 枚絵）がペインの外へはみ出さないようにするため */}
            <div style={{ flex: 1, minHeight: 0, position: 'relative', overflow: 'hidden' }}>
              <div ref={lowerHostRef} style={{ width: '100%', height: '100%' }} />
              <div
                ref={lowerGhostRef}
                aria-hidden="true"
                style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
              />
              {splitInfo !== null && splitInfo.lower === 0 && (
                <div style={splitEmptyStyle}>このノードには子がありません</div>
              )}
            </div>
          </div>
        </div>
      ) : (
        <>
          <div ref={hostRef} style={{ width: '100%', height: '100%' }} />
          {/* 消えていく前の描画（ゴースト）を重ねる層。React は中身を触らない */}
          <div
            ref={ghostHostRef}
            aria-hidden="true"
            style={{ position: 'absolute', inset: 0, pointerEvents: 'none', zIndex: 1 }}
          />
        </>
      )}
      <div
        style={{
          position: 'absolute',
          // 経路入れ子の左ペインは縦に詰まっていて下端まで箱が来るので、
          // 注記が被らないよう右ペインの側だけに寄せる
          left: useNestUi ? `calc(${paneRatio * 100}% + 8px)` : 8,
          // split は上部に 2 つのペイン見出し帯があり、左ペインの縦積みとも重なるので
          // 注記は下端へ逃がす（両ペインとも下側は空きやすい）
          ...(isSplit ? { bottom: 8 } : { top: 8 }),
          right: 8,
          zIndex: 2,
          display: 'flex',
          gap: 8,
          alignItems: 'center',
          flexWrap: 'wrap',
          pointerEvents: 'none',
        }}
      >
        {/* split は右ペイン見出しに「↑ 戻る」を置いてある。
            drilldown / nested はシェル側のツールバーが現在地と「↑ 上へ」を出すので、
            キャンバス内に二重に置かない（フローが画面いっぱいになり、必ず箱に重なるため）。 */}
        {drillRoot !== null && !isSplit && viewMode === 'nested' && (
          <button type="button" onClick={goUp} style={{ pointerEvents: 'auto' }}>
            ↑ 上へ
          </button>
        )}
        {/* トップ階層では戻る先が無いのでパンくずごと出さない。
            フローが画面いっぱいに広がるようになり、常時出しておくと箱の上に重なるため。 */}
        {isSplit && drillRoot !== null && (
          <span
            style={{
              fontSize: 11,
              color: '#8d97ad',
              pointerEvents: 'auto',
              background: 'rgba(18,20,28,0.82)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            <button
              type="button"
              onClick={() => onDrillDown(null)}
              style={{ pointerEvents: 'auto', background: 'none', border: 'none', color: '#8d97ad', cursor: 'pointer', padding: 0 }}
            >
              トップ
            </button>
            {crumbs.map((id, i) => (
              <span key={id}>
                {' / '}
                {i === crumbs.length - 1 ? (
                  <span style={{ color: '#e5ebfa' }}>{flat.byId.get(id)?.label ?? id}</span>
                ) : (
                  <button
                    type="button"
                    onClick={() => onDrillDown(id)}
                    style={{ background: 'none', border: 'none', color: '#8d97ad', cursor: 'pointer', padding: 0 }}
                  >
                    {flat.byId.get(id)?.label ?? id}
                  </button>
                )}
              </span>
            ))}
          </span>
        )}
        {/* drilldown は「▸ 中を見る」バッジ・ホバーの光り方・pointer カーソルで
            操作を見せているので、ここで文章にはしない（説明文がフローの上を覆っていた）。
            記号の意味を言葉でしか示せない split / nested だけ短い注記を残す。 */}
        {viewMode !== 'drilldown' && (
          <span style={{ fontSize: 11, color: '#8d97ad' }}>
            {isSplit
              ? drillRoot === null
                ? '最上位は全画面 1 ペイン。箱の中へ入ると左に上位階層のペインが開く'
                : useNestUi
                  ? '左＝経路の入れ子（★ 今ここ / ⚡ 右と繋がる）。箱クリックで移動 / 右の空白をダブルクリックで戻る'
                  : '左＝上位階層（★ 今いる場所 / ⚡ 右と繋がっている）。箱クリックで移動 / 右ペインの空白をダブルクリックで戻る'
              : 'グループ左上の ± で折りたたみ / グループをダブルクリックでドリルダウン'}
          </span>
        )}
        {useNestUi && nestInfo !== null && (
          <span
            style={{
              fontSize: 11,
              color: nestInfo.outOfScope === 0 ? '#7fc99a' : '#e8b86b',
              border: `1px solid ${nestInfo.outOfScope === 0 ? '#2f5a41' : '#6a5326'}`,
              background: 'rgba(20,30,24,0.85)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            展開 {nestInfo.levels}/{MAX_NEST_LEVELS} 段（箱の深さ {nestInfo.boxDepth}）/ 左ペイン幅{' '}
            {Math.round(paneRatio * 100)}% / 縮尺 {nestInfo.scale.toFixed(2)} / 圏外リンク{' '}
            {nestInfo.outOfScope} 本
          </span>
        )}
        {isSplit && splitInfo !== null && (
          <span
            style={{
              fontSize: 11,
              color: SPLIT.linkedStroke,
              border: `1px solid ${SPLIT.linkedStroke}`,
              background: 'rgba(30,27,16,0.85)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            {splitInfo.upper === 0
              ? '最上位のため左ペインなし（LogicFlow インスタンスも 1 つだけ）'
              : `右から左へ ${splitInfo.cross} 本の関係があります（⚡ ${splitInfo.linked} 件をハイライト・ペインをまたぐ線は引きません）`}
          </span>
        )}
        {contextInfo !== null && (
          <span
            style={{
              fontSize: 11,
              color: CONTEXT_COLOR.text,
              border: `1px solid ${CONTEXT_COLOR.stroke}`,
              background: 'rgba(25,28,38,0.85)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            薄い箱＝{contextInfo.parent}の兄弟 {contextInfo.count} 件（ダブルクリックで移動）/ またぐ線{' '}
            {contextInfo.crossing} 本
          </span>
        )}
        {viewMode === 'drilldown' && outOfScopeLinks > 0 && (
          <span
            style={{
              fontSize: 11,
              color: '#e8b86b',
              border: '1px solid #6a5326',
              background: 'rgba(60,45,18,0.75)',
              borderRadius: 4,
              padding: '2px 6px',
            }}
          >
            {outOfScopeLinks} 本がこの階層の外へ出入りしています
            {boundaryMarkers > 0
              ? `（境界マーカー${boundaryMarkers}個で表示中）`
              : '（2 層でも届かないので線は省略）'}
          </span>
        )}
      </div>
      {error !== null && (
        <div
          role="alert"
          style={{
            position: 'absolute',
            inset: 0,
            zIndex: 3,
            padding: 16,
            background: 'rgba(18,20,28,0.94)',
            color: '#ff6b6b',
            font: '12px/1.6 ui-monospace, monospace',
            whiteSpace: 'pre-wrap',
            overflow: 'auto',
          }}
        >
          LogicFlow の初期化に失敗しました:{'\n'}
          {error}
        </div>
      )}
    </div>
  )
}


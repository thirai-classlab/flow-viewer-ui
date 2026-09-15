/**
 * LogicFlow アダプタ — LogicFlow インスタンスの生成と共通テーマ。
 */

import LogicFlow from '@logicflow/core'
import { DynamicGroup } from '@logicflow/extension'
import '@logicflow/core/es/index.css'
import '@logicflow/extension/es/index.css'

import type { ViewMode } from '../flow/view-props'
import { CANVAS_COLOR, LINK_COLOR } from '../flow/theme'
import type { Placed } from './layout'

export type CollapseEventArgs = { collapse: boolean; nodeModel: { id: string } }

/** dynamic-group の実 API（.d.ts に出ているものだけを拾った最小の型） */
export type DynamicGroupModel = {
  isGroup?: boolean
  isCollapsed: boolean
  toggleCollapse: (collapse?: boolean) => void
  childrenLastCollapseStateDict: Map<string, boolean>
}

/** 折れ線の角丸半径。PolylineEdge は properties.radius ?? style.radius を読む（PolylineEdge.js の getEdge） */
const EDGE_RADIUS = 8
/** ドットグリッドの間隔。16 は密で「方眼紙」に見えたので 24 に広げた（色は --fv-grid のまま） */
const GRID_SIZE = 24

const THEME = {
  baseEdge: { stroke: LINK_COLOR.normal, strokeWidth: 1.4 },
  polyline: { stroke: LINK_COLOR.normal, strokeWidth: 1.4, radius: EDGE_RADIUS },
  // 矢尻の形（solid / hollow / circle）は nodes.ts の AppPolylineEdgeModel.getArrowStyle が線種ごとに決める。
  // strokeDasharray 'none' は「破線のエッジでも矢尻は実線」のため（getArrowStyle が edgeStyle を継ぐ）
  arrow: { offset: 8, verticalLength: 4, strokeDasharray: 'none' },
  nodeText: { color: CANVAS_COLOR.text, fontSize: 12, overflowMode: 'autoWrap' as const, textWidth: 150 },
  edgeText: {
    color: CANVAS_COLOR.linkText,
    fontSize: 11,
    textWidth: 90,
    overflowMode: 'autoWrap' as const,
    background: { fill: CANVAS_COLOR.bg, stroke: 'none', wrapPadding: '2px,4px' },
  },
  outline: { stroke: CANVAS_COLOR.accent, strokeDasharray: '3,3' },
}

/**
 * LogicFlow インスタンスを 1 つ作る。
 *
 * split モードでは同じ設定で 2 つ作るのでここに集約した。
 * ポイントは plugins をインスタンスオプションで渡していること。
 * LogicFlow には静的な LogicFlow.use() もあるが、そちらは全インスタンスに
 * 効いてしまう（LogicFlow.d.ts: `static use(extension, props): void`）。
 * options.plugins（+ pluginsOptions / disabledPlugins）はインスタンス単位なので、
 * 2 インスタンス並べてもプラグイン登録が競合しない。
 */
export function createLogicFlow(container: HTMLElement): LogicFlow {
  return new LogicFlow({
    container,
    grid: { size: GRID_SIZE, visible: true, type: 'dot', config: { color: CANVAS_COLOR.grid, thickness: 1 } },
    background: { backgroundColor: CANVAS_COLOR.bg },
    isSilentMode: true,
    textEdit: false,
    adjustEdge: false,
    edgeType: 'polyline',
    style: THEME,
    plugins: [DynamicGroup],
  })
}

export type LayoutSnapshot = { mode: ViewMode; positions: Map<string, Placed> }

/** split の 2 ペインぶんをまとめて持つ入れ物（ゴースト HTML / 座標 / ビューポート） */
export type SplitPair<T> = { upper: T; lower: T }

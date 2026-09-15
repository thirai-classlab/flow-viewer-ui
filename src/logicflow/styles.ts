/**
 * LogicFlow アダプタ — split 用の HTML パーツのスタイル。
 */

import type { CSSProperties } from 'react'

import { SPLIT } from '../flow/theme'

/** 各ペインの見出し帯。高さは全アダプタ共通の SPLIT.headerHeight */
export const splitHeaderStyle: CSSProperties = {
  height: SPLIT.headerHeight,
  lineHeight: `${SPLIT.headerHeight}px`,
  flex: '0 0 auto',
  padding: '0 10px',
  fontSize: 11,
  color: SPLIT.headerText,
  background: SPLIT.headerBg,
  borderBottom: `1px solid ${SPLIT.divider}`,
  whiteSpace: 'nowrap',
  overflow: 'hidden',
  textOverflow: 'ellipsis',
  boxSizing: 'border-box',
}

/**
 * 経路入れ子で畳まれた祖先の帯。
 * キャンバス内に擬似ノードとして描くと視野合わせで一緒に縮んで読めなくなるので、
 * ペインの最上段に HTML として固定する（縮尺の影響を受けない）。
 */
export const nestOmitStyle: CSSProperties = {
  flex: '0 0 auto',
  display: 'flex',
  alignItems: 'center',
  gap: 4,
  padding: '3px 8px',
  fontSize: 11,
  background: SPLIT.omitBg,
  borderBottom: `1px solid ${SPLIT.divider}`,
  overflowX: 'auto',
  whiteSpace: 'nowrap',
  boxSizing: 'border-box',
}

export const nestOmitButtonStyle: CSSProperties = {
  flex: '0 0 auto',
  background: 'none',
  border: `1px solid ${SPLIT.divider}`,
  borderRadius: 4,
  color: SPLIT.headerText,
  cursor: 'pointer',
  font: 'inherit',
  padding: '0 6px',
}

/** ペインに描くものが無いときの案内（トップ階層の左ペインなど） */
export const splitEmptyStyle: CSSProperties = {
  position: 'absolute',
  inset: 0,
  zIndex: 2,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  pointerEvents: 'none',
  fontSize: 12,
  color: SPLIT.emptyText,
  textAlign: 'center',
  padding: 12,
}

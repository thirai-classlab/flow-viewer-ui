/**
 * ビューの状態と操作。
 *
 * ベンチマークアプリでは複数ライブラリを差し替えるための抽象（AdapterProps）だったが、
 * このプロジェクトは LogicFlow に決め打ちなので、比較用のメタ情報は落として
 * 「表示に必要な状態」だけを持つ形にしてある。
 */

import type { CollapseState, Direction, FlowDoc } from './schema'
import type { FlatDoc } from './flatten'

/**
 * 表示モデル。「具体⇔抽象の行き来」の実現方式そのものが違う。
 *
 * - drilldown: 1 画面に 1 階層だけ。グループは中身の見えない「名前だけの箱」で、
 *   潜って初めて中身が分かる。
 * - split: 画面を左右に割り、左＝上位の経路 / 右＝今いる階層の中身。
 * - nested: 全階層を入れ子の箱として一度に描き、折りたたみで畳む。
 */
export type ViewMode = 'drilldown' | 'split' | 'nested'

/**
 * 配色テーマ。既定はライト。
 * 実体は styles.css の CSS 変数（--fv-*）で、ルート要素の data-theme 属性で切り替える。
 * キャンバス側のコードは色の実値を持たない（theme.ts が var() を返す）。
 */
export type Theme = 'light' | 'dark'

export const DEFAULT_THEME: Theme = 'light'

/**
 * FlowCanvas が ref で公開する操作（将来の公開 API。第 1 号は fitAll）。
 * props は「状態を渡す」、ref は「今の描画に一度だけ効く命令」という分担にする。
 */
export type FlowViewerHandle = {
  /** 今の内容を縮尺の下限なしでキャンバスに収める（#15「全体を表示」） */
  fitAll: () => void
}

export type FlowViewProps = {
  /** 真実源の JSON */
  doc: FlowDoc
  /** 平坦化済みのビュー（親が子より前に並んでいることが保証されている） */
  flat: FlatDoc
  /** 表示モデル */
  viewMode: ViewMode
  /** 折りたたまれているグループ id（nested モードでのみ意味を持つ） */
  collapsed: CollapseState
  /** グループの折りたたみ切替を要求する */
  onToggleCollapse: (id: string) => void
  /**
   * nested の初期表示で「読める縮尺（FIT.minReadable）を割る深さ」を自動で畳むとき、
   * 畳むグループ id をまとめて要求する（#15）。collapsed が空で、この doc × viewMode で
   * まだ適用していないときに 1 回だけ呼ぶ。省略すると自動抽象化は行わない。
   */
  onAutoCollapse?: (ids: string[]) => void
  /** レイアウト方向 */
  direction: Direction
  /** 現在潜っている階層。null ならトップ */
  drillRoot: string | null
  /** 潜る / 戻るを要求する。null でトップに戻る */
  onDrillDown: (id: string | null) => void
  /** 直前の drillRoot。遷移の向き（潜った / 戻った）の判定に使う */
  prevDrillRoot: string | null
  /** drilldown で 1 つ上の階層をコンテキストとして薄く表示するか */
  showContext: boolean
  /** アニメーションを有効にするか */
  animate: boolean
  /** split の左ペインを「経路を入れ子で展開」で描くか */
  nestPath: boolean

  /**
   * 選択中のノード id。右パネルにそのノードのドキュメントを出すために使う。
   * ドリルダウン（潜る）とは別の概念で、選んでも表示階層は変わらない。
   */
  selectedId: string | null
  /**
   * ノードの選択を要求する。null で選択解除。
   *
   * 操作の割り当て:
   *   単一クリック  → 選択（このコールバック）
   *   ダブルクリック → 潜る（onDrillDown）
   * グループの「▼ 中を見る」表記部分は従来どおり単一クリックで潜る。
   */
  onSelect: (id: string | null) => void
}

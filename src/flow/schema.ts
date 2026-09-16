/**
 * 業務フローの真実源（Single Source of Truth）となる型定義。
 *
 * 設計はカタログ「付録 A-1. データモデル設計」の推奨に従う:
 *   - 正は (a) 再帰ネスト（Apache Airflow / Windmill が採用する型）
 *   - links は (b) フラット配列（階層をまたぐ例外遷移が一意に置けないため）
 *
 * この 1 ファイルが全 11 アダプタの共通入力になる。
 * アダプタ側はこの型からそれぞれのライブラリのデータ形式へ変換するだけで、
 * 「どのライブラリを選んでも JSON が真実源」という構成を実証する。
 */

export type StepKind =
  | 'start' // 開始
  | 'end' // 終了
  | 'task' // 通常の作業
  | 'decision' // 分岐（菱形）
  | 'group' // 抽象化のためのコンテナ（部門・業務のまとまり）

/** リンクの種別。折りたたみ時の集約キーにも使う */
export type LinkKind =
  | 'normal' // 通常の順路
  | 'exception' // 例外遷移。グループの外へ飛ぶのでレイアウトを壊しやすい
  | 'loopback' // 差し戻し

export type StepMeta = {
  /** 担当部門・担当者ロール */
  owner?: string
  /** 目標所要時間 */
  sla?: string
  /** 関連システム */
  system?: string
  /** 補足 */
  note?: string
}

export type FlowStep = {
  id: string
  label: string
  kind: StepKind
  /** サブフロー。ここが「具体⇔抽象の行き来」の対象になる */
  children?: FlowStep[]
  meta?: StepMeta
  /**
   * このステップの手順書・注意点を Markdown で書いたもの。
   *
   * meta が「1 行で済む属性」（担当・SLA・システム）を持つのに対し、
   * こちらは長文のドキュメントを想定する。ノードを選ぶと右パネルに描画される。
   *
   * ノードの中に直接持たせているのは、JSON 1 つで完結させるため。
   * ステップをコピー・移動するとドキュメントも一緒についてくる。
   */
  doc?: string
}

export type FlowLink = {
  from: string
  to: string
  label?: string
  kind?: LinkKind
}

export type FlowDoc = {
  id: string
  title: string
  description?: string
  root: FlowStep[]
  links: FlowLink[]
}

/** レイアウト方向。ELK の elk.direction にそのまま渡す */
export type Direction = 'RIGHT' | 'DOWN'

/** 折りたたまれているグループ id の集合 */
export type CollapseState = ReadonlySet<string>

/**
 * 全アダプタで共通の見た目。
 * ライブラリごとに色やサイズが違うと比較にならないので、ここに集約する。
 */

import type { StepKind, LinkKind } from './schema'

/**
 * ノードの実寸（レイアウト座標系）。
 *
 * 「閲覧モードでフローが主役」にするための基準値なので、ここは大きめに振ってある。
 * 旧値（task 176x56 / group 200x64）は 1280x633 の実測で縮尺 0.55 まで縮み、
 * 画面上では 110x35px・実効フォント 6.6px となってラベルが潰れていた。
 * 現在は「レイアウトの折り返し（LayoutCtx.fit）」で縮尺 ≒ 1.0 を維持できるので、
 * 実寸 ≒ 画面上の見た目の px と考えてよい。
 */
export const NODE_SIZE: Record<StepKind, { width: number; height: number }> = {
  start: { width: 152, height: 62 },
  end: { width: 152, height: 62 },
  task: { width: 212, height: 78 },
  decision: { width: 200, height: 92 },
  group: { width: 268, height: 108 }, // 折りたたみ時の既定サイズ
}

/**
 * 折りたたんだグループ / ドリルダウンで「名前だけの箱」を描くときのサイズ。
 * 下辺に「中を見る N」バッジ（BADGE_SIZE）を敷くので、その分の高さを含む。
 */
export const COLLAPSED_SIZE = { width: 268, height: 108 }

/** グループの箱に敷く「中を見る」バッジの寸法。nodes.ts のカスタム view が描く */
export const BADGE_SIZE = { height: 26, padX: 12, padY: 10, minWidth: 104 }

/**
 * アイコン（Lucide、src/icons）の 1 辺の px。
 * キャンバス側はノードの実寸に対する比率で決めた（バッジ高 26 に 12、箱の隅に 14）。
 * ツールバーのボタンは文字 13px の行高に収まる 16、チップ（11px）の中は 12。
 */
export const ICON_SIZE = { badge: 12, doc: 14, button: 16, chip: 12 }

/** ノードのラベル文字サイズ。12px を切ると日本語が潰れるので下限は 11 */
export const NODE_FONT = { label: 13, sub: 12, small: 11 }

/*
 * 色はすべて CSS 変数（styles.css の --fv-*）を参照する。
 * 実値をここに持たないのは、ライト / ダークの切替とホスト側からの上書きを
 * CSS だけで済ませるため。SVG の fill / stroke 属性も var() を受け付ける。
 */
const kindColor = (kind: StepKind) => ({
  fill: `var(--fv-node-${kind}-fill)`,
  stroke: `var(--fv-node-${kind}-stroke)`,
  text: `var(--fv-node-${kind}-text)`,
})

export const KIND_COLOR: Record<StepKind, { fill: string; stroke: string; text: string }> = {
  start: kindColor('start'),
  end: kindColor('end'),
  task: kindColor('task'),
  decision: kindColor('decision'),
  group: kindColor('group'),
}

export const LINK_COLOR: Record<LinkKind, string> = {
  normal: 'var(--fv-link-normal)',
  exception: 'var(--fv-link-exception)',
  loopback: 'var(--fv-link-loopback)',
}

/** キャンバスの地と、線上ラベルの文字色 */
export const CANVAS_COLOR = {
  bg: 'var(--fv-canvas-bg)',
  grid: 'var(--fv-grid)',
  text: 'var(--fv-text)',
  textDim: 'var(--fv-text-dim)',
  linkText: 'var(--fv-link-text)',
  accent: 'var(--fv-accent)',
}

/**
 * キャンバスの隅に重ねる情報チップと、初期化失敗時のオーバーレイ。
 * ok / warn は text と border を別シェードにして、枠が文字より一段沈むようにしている。
 */
export const CHIP_COLOR = {
  bg: 'var(--fv-chip-bg)',
  ok: { bg: 'var(--fv-chip-ok-bg)', text: 'var(--fv-chip-ok-text)', border: 'var(--fv-chip-ok-border)' },
  warn: { bg: 'var(--fv-chip-warn-bg)', text: 'var(--fv-chip-warn-text)', border: 'var(--fv-chip-warn-border)' },
  overlayBg: 'var(--fv-overlay-bg)',
  overlayErrText: 'var(--fv-overlay-err-text)',
}

export const LINK_DASH: Record<LinkKind, string | undefined> = {
  normal: undefined,
  exception: '6 4',
  loopback: '3 3',
}

/** グループのタイトル帯の高さ。ELK の padding.top と合わせる */
export const GROUP_HEADER = 36

export const LAYOUT_GAP = { node: 30, rank: 64 }

/**
 * 折り返した行と行の間隔（レイアウトの主軸を折り返したときだけ使う）。
 * ランク間隔より広くとって「ここで行が変わる」ことを見せる。
 */
export const LAYOUT_ROW_GAP = 72

/**
 * 視野合わせ（fitViewport）のパラメータ。
 *
 * padding: 旧値 72 は 820x544 のキャンバスに対して 13% を余白で捨てていた。
 * maxScale: 旧実装は Math.min(1, ...) で 1.0 に頭打ちしていたため、
 *   ノード数が少ない階層ほどキャンバスが空くという逆転が起きていた。
 *   1.0 を超えて拡大してよいことにして「縦横どちらが余っても埋まる」ようにする。
 */
export const FIT = {
  padding: 56,
  /**
   * 本編キャンバスの拡大上限。
   * ラベルは 13px なので 1.4 倍 = 実効 18px。これ以上は「大きい」ではなく
   * 「間延び」に見えるので、ノードが 2〜3 個しかない階層でもここで止める。
   */
  maxScale: 1.4,
  /** split の右ペイン（今いる階層の中身）。本編より一回り控えめ */
  maxScalePane: 1.25,
  /**
   * split の左ペイン（現在地の見取り図）は 1.0 で頭打ちにする。
   * ここは主役ではないうえ、NOTES.md の 5 階層実測（縮尺 0.78〜1.00）が
   * この上限を前提にしている。
   */
  maxScaleUpper: 1,
  /**
   * 読める縮尺の下限（#15）。ラベル 13px × 0.85 ≒ 11px = 日本語の下限（NODE_FONT の注記と同じ根拠）。
   * 折り返し廃止（#13）で長いフローが 0.49（sample3 トップ、1440x900）まで縮んだので、
   * 収める縮尺がこれを割るならここで止め、はみ出しはパン / ズームに任せる。
   * split の左ペイン（見取り図）と「全体を表示」は下限なし（minScale まで縮む）。
   */
  minReadable: 0.85,
  minScale: 0.2,
}

// --- 操作のアフォーダンス（クリックできるものを見た目で示す） -----------------

/**
 * 潜れるノード（グループ）のホバー。枠がアクセント色 2px になり、カーソルが pointer になる。
 * glow（drop-shadow）は #6 で廃止した（太い破線 + glow の重なりがチープに見える主因だった）。
 */
export const HOVER_COLOR = { stroke: 'var(--fv-accent)', strokeWidth: 2 }
/** 選択中ノード（selectedId）の枠。ホバーより強い色 + 太さで 1 つだけ目立たせる */
export const SELECT_COLOR = { stroke: 'var(--fv-select-stroke)', strokeWidth: 2.5 }
/**
 * 「中を見る N」バッジの色。枠線は無く、淡い地に文字 / chevron / 件数を同じ色で載せる。
 * ホバーはアクセント色に反転する（hoverFill / hoverText）。
 */
export const BADGE_COLOR = {
  fill: 'var(--fv-badge-fill)',
  text: 'var(--fv-badge-text)',
  hoverFill: 'var(--fv-accent)',
  hoverText: 'var(--fv-accent-contrast)',
}
/** doc（手順書）を持つノードに出す fileText アイコンの線色。背景は塗らない */
export const DOC_COLOR = { stroke: 'var(--fv-doc-stroke)' }

// --- フォーカス + コンテキスト表示 ---------------------------------------

/** コンテキスト層（1 つ上の階層）の不透明度。主役はあくまでフォーカス層。
 * ライトは地との差が小さいので、テーマごとの値を CSS 変数に持つ */
export const CONTEXT_OPACITY = 'var(--fv-context-opacity)'
/** コンテキスト層のノードサイズ。フォーカス層より一回り小さくする */
export const CONTEXT_SIZE = { width: 176, height: 58 }
/** コンテキスト層の色。彩度を落として背景に沈ませる */
export const CONTEXT_COLOR = {
  fill: 'var(--fv-context-fill)',
  stroke: 'var(--fv-context-stroke)',
  text: 'var(--fv-context-text)',
}
/** フォーカス層とコンテキスト層をまたぐエッジ（crossing）の色 */
export const CROSSING_COLOR = 'var(--fv-crossing)'

// --- 左右 2 ペイン表示（split） -------------------------------------------

export const SPLIT = {
  /** 左ペイン（上位階層）が占める幅の比率 */
  upperRatio: 0.36,
  /** ペイン間の区切り線の色 */
  divider: 'var(--fv-split-divider)',
  /** 左ペインで「今いる場所」を示す枠線色 */
  currentStroke: 'var(--fv-split-current)',
  /** 左ペインで「右ペインと繋がっている」ことを示す枠線色 */
  linkedStroke: 'var(--fv-split-linked)',
  /** linkedStroke の枠を持つノードのラベル色 */
  linkedText: 'var(--fv-split-linked-text)',
  /** ペイン見出し帯・省略帯・空表示の色 */
  headerBg: 'var(--fv-split-header-bg)',
  headerText: 'var(--fv-split-header-text)',
  omitBg: 'var(--fv-split-omit-bg)',
  emptyText: 'var(--fv-split-empty-text)',
  /** 左ペインのノードサイズ。右より一回り小さくする */
  nodeSize: { width: 152, height: 46 },
  /** 各ペインの見出し帯の高さ */
  headerHeight: 26,
  /**
   * 経路入れ子（nestPath）のときの左ペイン幅。
   * 入れ子は横に広がるので、1 つ上だけのときより広く取る。
   * 経路の段数に応じて nestRatioBase + 段数 × nestRatioStep（上限 nestRatioMax）。
   */
  nestRatioBase: 0.36,
  nestRatioStep: 0.05,
  nestRatioMax: 0.52,
  /** 入れ子 1 段あたりの内側パディング */
  nestPadding: 12,
  /** 入れ子グループのヘッダ高 */
  nestHeader: 22,
  /**
   * 左ペイン専用のノード間隔。共通の LAYOUT_GAP（node 28 / rank 64）より詰める。
   *
   * LogicFlow の実測: 5 階層の最深部で LAYOUT_GAP のままだと縮尺 0.53（11px の実効 5.8px）
   * まで落ちてラベルが潰れたが、この値にすると 0.78〜1.00 まで回復した。
   * 左ペインは幅 36〜52% しかないので、間隔を詰めるほうが可読性に効く。
   */
  nestGap: { node: 14, rank: 22 },
}

// --- アニメーション -------------------------------------------------------

/**
 * アニメーションの標準時間 (ms)。
 * 全アダプタで揃えることで「同じ動きをどのライブラリがどれだけ楽に書けるか」を比較できる。
 */
export const ANIM = {
  /** 階層を潜る / 戻るときのビュー遷移 */
  drill: 420,
  /** ノードの出現・消失 */
  fade: 220,
  /** レイアウト変更時の位置トゥイーン */
  move: 320,
  /** イージング。CSS と JS の両方で使えるよう二形式持つ */
  easingCss: 'cubic-bezier(0.22, 0.61, 0.36, 1)',
  easingName: 'ease-out' as const,
}

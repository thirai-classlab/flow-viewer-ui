/*
 * Lucide Icons（https://lucide.dev）1.46.0 から、使うものだけ path データを抜き出して同梱している。
 * 依存に lucide を足さないのは、キャンバス側（LogicFlow の h()）と React 側で同じデータを使い回すためと、
 * split の 2 インスタンスやゴースト複製で <use href> の id 参照が切れるため（inline path 固定）。
 *
 * 座標は 24×24 の viewBox。stroke=currentColor / stroke-width 2 / linecap・linejoin round が Lucide の既定。
 * 生成: scratchpad の lucide パッケージから機械的に抽出（手写しではない）。
 *
 * ISC License — Copyright (c) for portions of Lucide are held by Cole Bemis 2013-2022 as part of Feather (MIT).
 * All other copyright (c) for Lucide are held by Lucide Contributors 2022.
 * Permission to use, copy, modify, and/or distribute this software for any purpose with or without fee is hereby
 * granted, provided that the above copyright notice and this permission notice appear in all copies.
 * THE SOFTWARE IS PROVIDED "AS IS" AND THE AUTHOR DISCLAIMS ALL WARRANTIES WITH REGARD TO THIS SOFTWARE.
 */

/** SVG 要素名と属性の組。h(tag, attrs) にそのまま渡せる */
export type IconNode = readonly (readonly [tag: 'path' | 'circle' | 'line' | 'rect' | 'polyline', attrs: Record<string, string>])[]

/** Lucide の既定属性（viewBox 24 の前提で描く） */
export const ICON_DEFAULTS = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  'stroke-width': '2',
  'stroke-linecap': 'round',
  'stroke-linejoin': 'round',
} as const

export const ICONS = {
  /** 手順書あり（📄 の置き換え）（lucide: file-text） */
  fileText: [
    ['path', { d: "M6 22a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h8a2.4 2.4 0 0 1 1.704.706l3.588 3.588A2.4 2.4 0 0 1 20 8v12a2 2 0 0 1-2 2z" }],
    ['path', { d: "M14 2v5a1 1 0 0 0 1 1h5" }],
    ['path', { d: "M10 9H8" }],
    ['path', { d: "M16 13H8" }],
    ['path', { d: "M16 17H8" }],
  ],
  /** 「中を見る」バッジ・パンくず区切り（▸ › の置き換え）（lucide: chevron-right） */
  chevronRight: [
    ['path', { d: "m9 18 6-6-6-6" }],
  ],
  /** ポップオーバーを開く（▾ の置き換え）（lucide: chevron-down） */
  chevronDown: [
    ['path', { d: "m6 9 6 6 6-6" }],
  ],
  /** （予備）連続の区切り（lucide: chevrons-right） */
  chevronsRight: [
    ['path', { d: "m6 17 5-5-5-5" }],
    ['path', { d: "m13 17 5-5-5-5" }],
  ],
  /** 表示の詳細設定（⚙ の置き換え）（lucide: settings-2） */
  settings2: [
    ['path', { d: "M14 17H5" }],
    ['path', { d: "M19 7h-9" }],
    ['circle', { cx: "17", cy: "17", r: "3" }],
    ['circle', { cx: "7", cy: "7", r: "3" }],
  ],
  /** ダークテーマにする（☾ の置き換え）（lucide: moon） */
  moon: [
    ['path', { d: "M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401" }],
  ],
  /** ライトテーマにする（☀ の置き換え）（lucide: sun） */
  sun: [
    ['circle', { cx: "12", cy: "12", r: "4" }],
    ['path', { d: "M12 2v2" }],
    ['path', { d: "M12 20v2" }],
    ['path', { d: "m4.93 4.93 1.41 1.41" }],
    ['path', { d: "m17.66 17.66 1.41 1.41" }],
    ['path', { d: "M2 12h2" }],
    ['path', { d: "M20 12h2" }],
    ['path', { d: "m6.34 17.66-1.41 1.41" }],
    ['path', { d: "m19.07 4.93-1.41 1.41" }],
  ],
  /** 閉じる（✕ × の置き換え）（lucide: x） */
  x: [
    ['path', { d: "M18 6 6 18" }],
    ['path', { d: "m6 6 12 12" }],
  ],
  /** 省略された上位階層（⋯ の置き換え）（lucide: ellipsis） */
  ellipsis: [
    ['circle', { cx: "12", cy: "12", r: "1" }],
    ['circle', { cx: "19", cy: "12", r: "1" }],
    ['circle', { cx: "5", cy: "12", r: "1" }],
  ],
  /** 1 つ上の階層へ（↑ の置き換え）（lucide: arrow-up） */
  arrowUp: [
    ['path', { d: "m5 12 7-7 7 7" }],
    ['path', { d: "M12 19V5" }],
  ],
  /** 横方向（→ の置き換え）（lucide: arrow-right） */
  arrowRight: [
    ['path', { d: "M5 12h14" }],
    ['path', { d: "m12 5 7 7-7 7" }],
  ],
  /** 縦方向（↓ の置き換え）（lucide: arrow-down） */
  arrowDown: [
    ['path', { d: "M12 5v14" }],
    ['path', { d: "m19 12-7 7-7-7" }],
  ],
  /** （予備）戻る（lucide: corner-left-up） */
  cornerLeftUp: [
    ['path', { d: "M14 9 9 4 4 9" }],
    ['path', { d: "M20 20h-7a4 4 0 0 1-4-4V4" }],
  ],
  /** split 左ペインの「今ここ」（★ の置き換え候補）（lucide: star） */
  star: [
    ['path', { d: "M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z" }],
  ],
  /** split 左ペインの「右と繋がる」（⚡ の置き換え候補）（lucide: zap） */
  zap: [
    ['path', { d: "M15.914 4a1.5 1.5 0 00-2.474-1.561l-9 9A1.5 1.5 0 005.5 14h4.002a.5.5 0 01.471.666L8.086 20a1.5 1.5 0 002.475 1.56l9-9A1.5 1.5 0 0018.5 10h-3.997a.5.5 0 01-.472-.667z" }],
  ],
  /** 全画面（lucide: maximize-2） */
  maximize2: [
    ['path', { d: "M15 3h6v6" }],
    ['path', { d: "m21 3-7 7" }],
    ['path', { d: "m3 21 7-7" }],
    ['path', { d: "M9 21H3v-6" }],
  ],
  /** 全画面を戻す（lucide: minimize-2） */
  minimize2: [
    ['path', { d: "m14 10 7-7" }],
    ['path', { d: "M20 10h-6V4" }],
    ['path', { d: "m3 21 7-7" }],
    ['path', { d: "M4 14h6v6" }],
  ],
  /** 全体を表示（fitAll）（lucide: scan） */
  scan: [
    ['path', { d: "M3 7V5a2 2 0 0 1 2-2h2" }],
    ['path', { d: "M17 3h2a2 2 0 0 1 2 2v2" }],
    ['path', { d: "M21 17v2a2 2 0 0 1-2 2h-2" }],
    ['path', { d: "M7 21H5a2 2 0 0 1-2-2v-2" }],
  ],
} as const satisfies Record<string, IconNode>

export type IconName = keyof typeof ICONS

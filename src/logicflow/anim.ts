/**
 * LogicFlow アダプタ — アニメーション基盤とビューポート操作。
 *
 * drilldown（1 インスタンス）と split（2 インスタンス）の両方から使うので独立させてある。
 */

import type LogicFlow from '@logicflow/core'

import type { DrillTransition } from '../flow/collapse'
import {
  ANIM,
  BADGE_COLOR,
  CONTEXT_OPACITY,
  FIT,
  HOVER_COLOR,
  SELECT_COLOR,
  SPLIT,
} from '../flow/theme'
import type { Placed, Point } from './layout'
import { BADGE_CLASS, BADGE_PART_CLASS, CONTEXT_CLASS, DOC_CLASS, DRILL_CLASS, SELECT_CLASS } from './nodes'

/** 視野合わせの余白。旧値 72 は 820x544 のキャンバスの 13% を捨てていた */
export const FIT_PADDING = FIT.padding
/** split の左ペインは幅が狭いので余白をさらに詰める */
export const SPLIT_FIT_PADDING = 16
const MIN_SCALE = FIT.minScale
const MAX_SCALE = 8

/** 階層遷移（潜る / 戻る）で使うズーム演出の倍率 */
export const DRILL_ZOOM_FACTOR = 1.18

/* ------------------------------------------------------------------ *
 * 2.7 アニメーション基盤
 *
 * LogicFlow のビルトインアニメーションは実質「エッジの流動ダッシュ」だけ。
 *   - options.animation は { node: boolean; edge: boolean } しか無く、
 *     実際に効くのは .lf-edge-animation（stroke-dashoffset の無限ループ）のみ
 *   - transformModel.zoom / translate / focusOn と lf.fitView は全部即時。
 *     duration も easing も引数に無い（TransformModel.d.ts / LogicFlow.d.ts で確認）
 * よってここは自前。ただし LogicFlow が preact VDOM で SVG を描く構造を利用して、
 * できる限り CSS / WAAPI（＝ブラウザ側の補間）に寄せている。
 * ------------------------------------------------------------------ */

const ANIM_STYLE_ID = 'lfa-logicflow-anim'
/** アダプタ全体のラッパに常時付く class。コンテキスト層の減光はこれで効かせる */
export const HOST_CLASS = 'lfa-host'
/** animate = true のときだけ付く class。これが無ければ一切アニメーションしない */
export const ANIM_CLASS = 'lfa-on'
/** ビューポート補間中だけ付く class。ドラッグ/ホイール操作を鈍らせないため常時は付けない */
export const VIEW_ANIM_CLASS = 'lfa-view'
/** 消えていく前の描画のスナップショット（ゴースト）に付く class */
const GHOST_CLASS = 'lfa-ghost'
/**
 * split で「最上位（1 ペイン）→ 下位（2 ペイン）」に移ったとき、
 * 新しくマウントされる左ペインに付く class。
 * CSS animation は要素の挿入時に 1 度だけ再生されるので、
 * 「左ペインが現れた瞬間だけ開くアニメーションが走る」が class を付けっぱなしで成立する。
 */
export const PANE_IN_CLASS = 'lfa-pane-in'

/**
 * アニメーション用 CSS を一度だけ document.head へ流し込む。
 * 時間・イージングは全アダプタ共通の ANIM から生成するので、値は 1 箇所（theme.ts）にある。
 */
export function ensureAnimStyles() {
  if (typeof document === 'undefined') return
  if (document.getElementById(ANIM_STYLE_ID) !== null) return
  const el = document.createElement('style')
  el.id = ANIM_STYLE_ID
  el.textContent = `
.${HOST_CLASS} .${CONTEXT_CLASS} { opacity: ${CONTEXT_OPACITY}; }

/* ---- 操作のアフォーダンス ----------------------------------------------
   「破線の箱＝グループ。クリックで潜る」を文字で説明していたのをやめ、
   見た目で分かるようにする。LogicFlow は最外 <g> の class を
   BaseNodeModel.getOuterGAttributes() でしか触れないので、
   nodes.ts のカスタムモデルがここで使う class を付けている。
   glow（drop-shadow）は #6 で全部外した。枠の色と太さの遷移だけで示す。 */

/* 潜れる箱: カーソルが変わり、ホバーで枠がアクセント色 2px になる */
.${HOST_CLASS} .${DRILL_CLASS} { cursor: pointer; }
.${HOST_CLASS} .${DRILL_CLASS} .lf-basic-shape,
.${HOST_CLASS} .${DRILL_CLASS} .${BADGE_PART_CLASS.bg},
.${HOST_CLASS} .${DRILL_CLASS} .${BADGE_PART_CLASS.label},
.${HOST_CLASS} .${DRILL_CLASS} .${BADGE_PART_CLASS.count},
.${HOST_CLASS} .${DRILL_CLASS} .${BADGE_PART_CLASS.icon},
.${HOST_CLASS} .${DRILL_CLASS} .${BADGE_PART_CLASS.divider} {
  transition: stroke 140ms ease-out, stroke-width 140ms ease-out, fill 140ms ease-out;
}
.${HOST_CLASS} .${DRILL_CLASS}:hover .lf-basic-shape {
  stroke: ${HOVER_COLOR.stroke};
  stroke-width: ${HOVER_COLOR.strokeWidth};
}
/* バッジはピルごとアクセント色に反転する。文字 / 件数は fill、chevron / 区切り線は stroke で描いている */
.${HOST_CLASS} .${DRILL_CLASS}:hover .${BADGE_PART_CLASS.bg} { fill: ${BADGE_COLOR.hoverFill}; }
.${HOST_CLASS} .${DRILL_CLASS}:hover .${BADGE_PART_CLASS.label},
.${HOST_CLASS} .${DRILL_CLASS}:hover .${BADGE_PART_CLASS.count} { fill: ${BADGE_COLOR.hoverText}; }
.${HOST_CLASS} .${DRILL_CLASS}:hover .${BADGE_PART_CLASS.icon},
.${HOST_CLASS} .${DRILL_CLASS}:hover .${BADGE_PART_CLASS.divider} { stroke: ${BADGE_COLOR.hoverText}; }
/* バッジ（中を見る N）だけは単一クリックでも潜れる。押せることを明示する */
.${HOST_CLASS} .${BADGE_CLASS} { cursor: pointer; }
/* LogicFlow はノードのラベルを foreignObject の HTML で描き、その div が
   枠いっぱい（min-height = ノード高）に広がるためバッジの上に載ってしまう。
   実測: バッジ中央の elementFromPoint が .lf-node-text-auto-wrap を返し、
   バッジのクリック判定（closest('.lfa-badge')）が一度も成立しなかった。
   ラベルは読むものであって押すものではないので、当たり判定を下の図形へ通す。 */
.${HOST_CLASS} .lf-node foreignObject { pointer-events: none; }

/* 選択中のノード。ホバーより強い色と太さを使い、常に 1 つだけ目立たせる */
.${HOST_CLASS} .${SELECT_CLASS} .lf-basic-shape {
  stroke: ${SELECT_COLOR.stroke} !important;
  stroke-width: ${SELECT_COLOR.strokeWidth} !important;
  stroke-dasharray: none !important;
}
/* 選択されたら薄いコンテキスト層でも読める濃さまで戻す */
.${HOST_CLASS} .${CONTEXT_CLASS}.${SELECT_CLASS} { opacity: 1; }

/* 手順書（doc）を持つノードの fileText マーク。図の上で「読むものがある」と分かる */
.${HOST_CLASS} .${DOC_CLASS} { pointer-events: none; }

/* nested の折りたたみ ±。dynamic-group プラグインが色を固定値で描く（extension の
   dynamic-group/node.js getOperateIcon: rect fill #f4f5f6 / stroke #cecece、path stroke #818281）。
   type を再登録すると折りたたみが壊れる（NOTES.md）ので、属性セレクタで色だけテーマに寄せる。 */
.${HOST_CLASS} rect[fill="#f4f5f6"] { fill: var(--fv-bg-raised); }
.${HOST_CLASS} rect[stroke="#cecece"] { stroke: var(--fv-border); }
.${HOST_CLASS} path[stroke="#818281"] { stroke: var(--fv-text-dim); }

.${ANIM_CLASS} .lf-node {
  transform-box: fill-box;
  transform-origin: 50% 50%;
  animation: lfa-node-in ${ANIM.fade}ms ${ANIM.easingCss} both;
}
.${ANIM_CLASS} .lf-edge {
  animation: lfa-edge-in ${ANIM.fade}ms ${ANIM.easingCss} both;
}
.${ANIM_CLASS} .${CONTEXT_CLASS} {
  animation: lfa-ctx-in ${ANIM.fade}ms ${ANIM.easingCss} ${Math.round(ANIM.fade / 2)}ms both;
}
@keyframes lfa-node-in { from { opacity: 0; transform: scale(0.92); } to { opacity: 1; transform: scale(1); } }
@keyframes lfa-edge-in { from { opacity: 0; } to { opacity: 1; } }
@keyframes lfa-ctx-in { from { opacity: 0; transform: scale(0.92); } to { opacity: ${CONTEXT_OPACITY}; transform: scale(1); } }

.${VIEW_ANIM_CLASS} .lf-canvas-overlay > g,
.${VIEW_ANIM_CLASS} .modification-overlay > g {
  transition: transform ${ANIM.drill}ms ${ANIM.easingCss};
}

/* 1 ペイン ⇄ 2 ペイン: 左ペインの幅を 0 から開く。
   右ペインは flex:1 なので、この 1 本のアニメーションだけで
   「全画面 → 左が割り込んで分割」に見える（右の縮小もブラウザが補間する）。

   幅は --lfa-pane-w（インラインで与える）を参照する。経路入れ子モードでは
   経路の段数に応じて左ペイン幅が変わるため、keyframes に定数を焼き込めない。
   fill-mode を both ではなく backwards にしてあるのも同じ理由で、
   再生後にアニメーションが最終値を保持し続けると、あとから幅が変わっても
   transition が効かず（アニメーションの合成順が transition より上）カクつく。 */
.${ANIM_CLASS} .${PANE_IN_CLASS} {
  animation: lfa-pane-in ${ANIM.drill}ms ${ANIM.easingCss} backwards;
  transition: width ${ANIM.drill}ms ${ANIM.easingCss};
}
@keyframes lfa-pane-in {
  from { width: 0%; opacity: 0; }
  to { width: var(--lfa-pane-w, ${SPLIT.upperRatio * 100}%); opacity: 1; }
}

/* ゴーストは「消えていく前の絵」なので、出現アニメーションを再生させない */
.${GHOST_CLASS} .lf-node,
.${GHOST_CLASS} .lf-edge,
.${GHOST_CLASS} .${CONTEXT_CLASS} { animation: none !important; }
`
  document.head.appendChild(el)
}

/** ANIM.easingCss と同じ曲線を rAF トゥイーンでも使うため、制御点を文字列から取り出す */
function parseCubicBezier(css: string): [number, number, number, number] {
  const m = /cubic-bezier\(\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*,\s*([\d.+-]+)\s*\)/.exec(css)
  if (m === null) return [0.25, 0.1, 0.25, 1] // CSS の ease 相当
  return [Number(m[1]), Number(m[2]), Number(m[3]), Number(m[4])]
}

const EASE_POINTS = parseCubicBezier(ANIM.easingCss)

function bezierAxis(t: number, a: number, b: number): number {
  const u = 1 - t
  return 3 * u * u * t * a + 3 * u * t * t * b + t * t * t
}

/** cubic-bezier(x1,y1,x2,y2) の評価。x から t をニュートン法で逆算して y を返す */
function easeProgress(x: number): number {
  if (x <= 0) return 0
  if (x >= 1) return 1
  const [x1, y1, x2, y2] = EASE_POINTS
  let t = x
  for (let i = 0; i < 8; i += 1) {
    const err = bezierAxis(t, x1, x2) - x
    if (Math.abs(err) < 1e-4) break
    const u = 1 - t
    const d = 3 * u * u * x1 + 6 * u * t * (x2 - x1) + 3 * t * t * (1 - x2)
    if (Math.abs(d) < 1e-6) break
    t -= err / d
  }
  return bezierAxis(t, y1, y2)
}

export type Viewport = { scale: number; tx: number; ty: number }

const clampScale = (s: number) => Math.min(MAX_SCALE, Math.max(MIN_SCALE, s))

/**
 * LogicFlow のビューポートは transformModel の SCALE_X / TRANSLATE_X で決まる。
 * 絶対値で指定する API が無いので reset → zoom → translate の順で組み立てる。
 * （zoom の原点を [0,0] にすると translate は動かないので、この順で厳密に一致する）
 */
export function applyViewport(lf: LogicFlow, vp: Viewport) {
  lf.resetZoom()
  lf.resetTranslate()
  lf.zoom(vp.scale, [0, 0])
  lf.translate(vp.tx, vp.ty)
}

/**
 * 描画結果 w×h をキャンバス cw×ch に「収める」縮尺（上限 maxScale だけ効かせた生の値）。
 * nested の自動抽象化は、この値が FIT.minReadable を割るかどうかで畳む深さを決める。
 */
export function fitScale(
  w: number,
  h: number,
  cw: number,
  ch: number,
  pad = FIT_PADDING,
  maxScale = FIT.maxScale,
): number {
  return Math.min(maxScale, (cw - pad) / Math.max(w, 1), (ch - pad) / Math.max(h, 1))
}

/**
 * 描画結果 w×h をキャンバス cw×ch に収める。
 *
 * 旧実装は Math.min(1, ...) で 1.0 に頭打ちしていた。そのため
 * 「ノードが少ない階層ほどキャンバスが空く」という逆転が起きていたので、
 * 上限を FIT.maxScale まで開けてある。maxScale を呼び出し側で
 * 下げられるようにしてあるのは、split の細いペインで拡大しすぎないため。
 *
 * 下限（#15）: 収める縮尺が minScale（既定 FIT.minReadable = 0.85）を割るならそこで止める。
 * 止めた結果はみ出す軸は開始側（左 / 上）に pad/2 で寄せ、収まる軸は従来どおり中央。
 * はみ出したぶんはホイール / ドラッグのパンに任せる。
 * 「全体を表示」と split の左ペインは minScale に FIT.minScale を渡して下限を外す。
 */
export function fitViewport(
  w: number,
  h: number,
  cw: number,
  ch: number,
  pad = FIT_PADDING,
  maxScale = FIT.maxScale,
  minScale: number = FIT.minReadable,
): Viewport {
  const scale = clampScale(Math.max(minScale, fitScale(w, h, cw, ch, pad, maxScale)))
  // 0.5px は浮動小数の丸め。下限を使わなかったときは両軸とも必ずこちら（中央）になる
  const fitsW = w * scale <= cw - pad + 0.5
  const fitsH = h * scale <= ch - pad + 0.5
  return {
    scale,
    tx: fitsW ? (cw - w * scale) / 2 : pad / 2,
    ty: fitsH ? (ch - h * scale) / 2 : pad / 2,
  }
}

/**
 * 描画済みのビューポートから vp へ移す（「全体を表示」用）。
 * animate なら VIEW_ANIM_CLASS の CSS transition で補間する。直前の状態は既にペイント済みなので、
 * 描画直後の遷移で使っている 2 段 rAF は要らない（class 付与と transform 変更が同じフレームでよい）。
 * 外す timer は呼び出し側の timers に積み、effect の cleanup で確実に止める。
 */
export function transitionViewport(
  lf: LogicFlow,
  wrap: HTMLElement,
  vp: Viewport,
  animate: boolean,
  timers: number[],
) {
  if (!animate) {
    applyViewport(lf, vp)
    return
  }
  wrap.classList.add(VIEW_ANIM_CLASS)
  applyViewport(lf, vp)
  timers.push(window.setTimeout(() => wrap.classList.remove(VIEW_ANIM_CLASS), ANIM.drill + 80))
}

/** キャンバス中心を固定したままスケールだけ変える。ズームイン/アウト演出の始点に使う */
export function scaleAbout(vp: Viewport, factor: number, cw: number, ch: number): Viewport {
  const scale = clampScale(vp.scale * factor)
  const ratio = scale / vp.scale
  return {
    scale,
    tx: cw / 2 - (cw / 2 - vp.tx) * ratio,
    ty: ch / 2 - (ch / 2 - vp.ty) * ratio,
  }
}

/* ------------------------------------------------------------------ *
 * 2.8 アニメーション部品の共通化
 *   drilldown（1 インスタンス）と split（2 インスタンス）で同じ演出を使うため、
 *   ゴースト生成と位置トゥイーンを関数として切り出す。
 *   split では「2 セット分の後始末」を確実に書く必要があるので、
 *   disposers 配列を受け取って自分で登録する形にしてある。
 * ------------------------------------------------------------------ */

/** 潜る = 手前へ抜ける / 戻る = 遠ざかる。ゴーストの拡大方向を決める */
export function ghostFactor(t: DrillTransition): number {
  if (t === 'enter') return DRILL_ZOOM_FACTOR
  if (t === 'exit') return 1 / DRILL_ZOOM_FACTOR
  return 1
}

/**
 * 消えていく前の描画（HTML スナップショット）を重ねてフェードアウトさせる。
 * lf.render() はグラフを丸ごと作り直すので、消えるノードを個別に残す手段が無い。
 */
export function spawnGhost(
  layer: HTMLElement | null,
  html: string | null,
  factor: number,
  disposers: (() => void)[],
  timers: number[],
) {
  if (layer === null || html === null) return
  const ghost = document.createElement('div')
  ghost.className = GHOST_CLASS
  ghost.style.cssText = 'position:absolute;inset:0;pointer-events:none;transform-origin:50% 50%;'
  ghost.innerHTML = html
  layer.appendChild(ghost)
  if (typeof ghost.animate === 'function') {
    const anim = ghost.animate(
      [
        { opacity: 1, transform: 'scale(1)' },
        { opacity: 0, transform: `scale(${factor})` },
      ],
      { duration: ANIM.drill, easing: ANIM.easingCss, fill: 'forwards' },
    )
    anim.addEventListener('finish', () => ghost.remove())
    disposers.push(() => {
      anim.cancel()
      ghost.remove()
    })
    return
  }
  timers.push(window.setTimeout(() => ghost.remove(), ANIM.drill))
  disposers.push(() => ghost.remove())
}

/** 描画直後のエッジの折れ線とラベル位置。トゥイーン完了時にこれへ戻す */
type EdgeRouteSnapshot = { id: string; pointsList: Point[]; text: Point | null }

/** PolylineEdgeModel のうち、配線の復元に使うメンバだけ（.d.ts で確認済み） */
type PolylineLike = {
  pointsList: Point[]
  text: { x: number; y: number; value: string }
  updatePath: (pointList: Point[]) => void
  moveText: (deltaX: number, deltaY: number) => void
}

/**
 * レイアウト（dagre）が決めた配線を、描画直後のモデルから控えておく。
 * moveNode2Coordinate() → moveStartPoint / moveEndPoint は updatePoints() で
 * 自動経路に計算し直すので（PolylineEdgeModel.js）、トゥイーン中は pointsList が消える。
 */
function snapshotEdgeRoutes(lf: LogicFlow): EdgeRouteSnapshot[] {
  const out: EdgeRouteSnapshot[] = []
  for (const e of lf.graphModel.edges) {
    const m = e as unknown as Partial<PolylineLike>
    if (!Array.isArray(m.pointsList) || m.pointsList.length < 2) continue
    out.push({
      id: e.id,
      pointsList: m.pointsList.map((p) => ({ x: p.x, y: p.y })),
      text: m.text && m.text.value !== '' ? { x: m.text.x, y: m.text.y } : null,
    })
  }
  return out
}

/**
 * 控えておいた配線を再適用する。updatePath() は pointsList と points だけを差し替え、
 * startPoint / endPoint は触らない（トゥイーンの往復で元の位置に戻っているので整合する）。
 * 自動経路だったエッジは同じ折れ線が戻るだけなので、区別せず全部に掛けてよい。
 */
function restoreEdgeRoutes(lf: LogicFlow, routes: readonly EdgeRouteSnapshot[]) {
  for (const r of routes) {
    const m = lf.getEdgeModelById(r.id) as unknown as Partial<PolylineLike> | undefined
    if (m === undefined || typeof m.updatePath !== 'function') continue
    m.updatePath(r.pointsList.map((p) => ({ x: p.x, y: p.y })))
    // ラベルは handleEdgeTextMove() が自動経路上の最寄り点へ動かしているので、元の位置へ戻す
    if (r.text !== null && m.text !== undefined && typeof m.moveText === 'function') {
      m.moveText(r.text.x - m.text.x, r.text.y - m.text.y)
    }
  }
}

/**
 * ノードの絶対座標を moveNode2Coordinate() で毎フレーム動かす位置トゥイーン。
 * エッジは MobX 経由で自動追従するので線も一緒に動く。
 * ただし追従は自動経路なので、完了時にレイアウトが決めた配線（pointsList）を戻す。
 * 追加した rAF は呼び出し側の rafIds に積むので、cleanup で必ず止まる。
 */
export function tweenLayout(
  lf: LogicFlow,
  prev: Map<string, Placed>,
  next: Map<string, Placed>,
  rafIds: number[],
  onError: (message: string) => void,
) {
  const moving: { id: string; fx: number; fy: number; tx: number; ty: number }[] = []
  for (const [id, dst] of next) {
    const src = prev.get(id)
    if (src === undefined) continue
    if (Math.abs(src.x - dst.x) < 0.5 && Math.abs(src.y - dst.y) < 0.5) continue
    moving.push({ id, fx: src.x, fy: src.y, tx: dst.x, ty: dst.y })
  }
  if (moving.length === 0) return

  // apply(0) より前に控える。描画直後のモデルにはレイアウトの配線がそのまま入っている
  const routes = snapshotEdgeRoutes(lf)
  const apply = (p: number) => {
    for (const m of moving) {
      lf.graphModel.moveNode2Coordinate(m.id, m.fx + (m.tx - m.fx) * p, m.fy + (m.ty - m.fy) * p, true)
    }
  }
  apply(0) // まず前回の位置へ戻してから補間する
  const t0 = performance.now()
  const step = () => {
    try {
      const t = Math.min(1, (performance.now() - t0) / ANIM.move)
      apply(easeProgress(t))
      if (t < 1) {
        rafIds.push(requestAnimationFrame(step))
        return
      }
      restoreEdgeRoutes(lf, routes)
    } catch (e: unknown) {
      onError(e instanceof Error ? `${e.name}: ${e.message}` : String(e))
    }
  }
  rafIds.push(requestAnimationFrame(step))
}

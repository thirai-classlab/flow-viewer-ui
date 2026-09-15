/**
 * ノードの手順書（FlowStep.doc）を描くための Markdown → HTML 変換。
 *
 * このアプリの JSON は「外から受け取るもの」という前提で作ってある
 * （JSON パネルに貼り付けられるし、将来はサーバから取ってくる）。
 * つまり doc の中身は信用できない文字列なので、
 *
 *     marked でパース → DOMPurify でサニタイズ
 *
 * の 2 段を必ず通す。dangerouslySetInnerHTML に渡してよいのは
 * このモジュールが返した文字列だけ、という約束にしている。
 *
 * 業務手順書で実際に使う記法（見出し・番号付きリスト・表・コードブロック・
 * 引用・チェックリスト）が全部通るように、許可タグはそれらを網羅した
 * 明示リストにしてある。既定のホワイトリストに任せず列挙しているのは、
 * dompurify のバージョンが上がったときに許可範囲が黙って広がらないようにするため。
 */

import { Marked } from 'marked'
import DOMPurify from 'dompurify'

// --- marked ---------------------------------------------------------------

/**
 * 共有インスタンス。marked のグローバル（marked.use）を汚すと
 * 他の担当者のコードに影響が出るので、必ずインスタンスを切って使う。
 */
const md = new Marked({
  gfm: true, // 表・打ち消し線・チェックリストは GFM 拡張
  /**
   * 日本語の手順書は「1 行 1 手順」で改行だけ入れて書かれることが多い。
   * 標準 Markdown の「行末に半角スペース 2 つ」を業務担当者に強制するのは
   * 現実的でないので、単なる改行を <br> にする。
   */
  breaks: true,
  async: false,
})

// --- DOMPurify ------------------------------------------------------------

/**
 * 許可タグ。業務手順書で必要になるものだけを明示的に並べる。
 *
 *  見出し    h1〜h6
 *  段落      p / br / hr
 *  強調      strong / em / del / mark
 *  リスト    ul / ol / li（チェックリストの input を含む）
 *  表        table / thead / tbody / tr / th / td
 *  コード    pre / code
 *  引用      blockquote
 */
const ALLOWED_TAGS = [
  'h1', 'h2', 'h3', 'h4', 'h5', 'h6',
  'p', 'br', 'hr', 'div', 'span',
  'strong', 'em', 'b', 'i', 'del', 's', 'mark', 'sup', 'sub',
  'ul', 'ol', 'li', 'dl', 'dt', 'dd',
  'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td',
  'pre', 'code', 'blockquote',
  'a', 'img', 'input',
]

/**
 * 許可属性。
 * target / rel は上のレンダラが付けたものを通すために要る。
 * type / checked / disabled は GFM のチェックリスト（- [x]）が使う。
 * class は `<code class="language-ts">` のシンタックス種別に使う。
 */
const ALLOWED_ATTR = [
  'href', 'title', 'src', 'alt', 'width', 'height',
  'target', 'rel',
  'align', 'colspan', 'rowspan',
  'class',
  'type', 'checked', 'disabled',
  'start',
]

/**
 * リンクを別タブで開かせるかの判定。
 *
 * ページ内アンカー（#...）だけは同じタブのままにする。
 * 手順書の中で「→ 詳細は下記」と飛ばす用途で、これを別タブにすると壊れる。
 */
function isExternalHref(href: string): boolean {
  return !href.startsWith('#')
}

/**
 * リンクを別タブで開かせる。
 *
 * marked のレンダラ側ではなくサニタイズ後の DOM でやるのは、手順書に
 * 生の `<a href="...">` が直接書かれることがあるため。
 * レンダラの上書きだと Markdown 記法のリンクしか拾えず、取りこぼす。
 *
 * rel="noopener noreferrer" は必須。付けないと開いた先から
 * window.opener 経由でこちらのページを差し替えられる（tabnabbing）。
 */
function applyLinkTargets(host: HTMLElement): void {
  for (const a of host.querySelectorAll('a[href]')) {
    const href = a.getAttribute('href') ?? ''
    if (isExternalHref(href)) {
      a.setAttribute('target', '_blank')
      a.setAttribute('rel', 'noopener noreferrer')
    } else {
      // ページ内アンカーは同じタブのまま。手順書内の相互参照が壊れないように
      a.removeAttribute('target')
      a.removeAttribute('rel')
    }
  }
}

/**
 * 変換結果のキャッシュ。
 *
 * DocPanel は選択・編集のたびに再レンダーされるが、doc の文字列が
 * 変わっていなければパースし直す意味は無い。
 * 手順書はせいぜい数十ノードなので、単純な Map + 上限で十分。
 */
const CACHE_LIMIT = 120
const cache = new Map<string, string>()

/**
 * Markdown を、そのまま innerHTML に入れて安全な HTML 文字列に変換する。
 *
 * @param source Markdown 文字列。空・未定義なら空文字を返す
 * @returns サニタイズ済みの HTML 文字列
 */
export function renderMarkdown(source: string | undefined | null): string {
  if (!source) return ''

  const hit = cache.get(source)
  if (hit !== undefined) return hit

  // async: false を明示して string 型に確定させる（marked の parse は
  // オプション次第で Promise を返す型になっているため）
  const raw = md.parse(source, { async: false })

  /*
   * 文字列ではなく DocumentFragment で受け取る。
   * このあとリンクへ target / rel を付けるが、文字列を正規表現でいじると
   * 「コードブロックの中に書かれた <a>」まで書き換えてしまうため、
   * DOM になった状態で触るのが唯一安全な方法になる。
   */
  const frag = DOMPurify.sanitize(raw, {
    ALLOWED_TAGS,
    ALLOWED_ATTR,
    // <template> や <form> のような「文書構造ごと持っていく」タグは明示的に禁止
    FORBID_TAGS: ['style', 'script', 'iframe', 'form', 'object', 'embed', 'template'],
    FORBID_ATTR: ['style'],
    // data-* は使わないので許可しない（属性経由の情報埋め込みを塞ぐ）
    ALLOW_DATA_ATTR: false,
    ALLOW_ARIA_ATTR: false,
    RETURN_DOM_FRAGMENT: true,
  })

  const host = document.createElement('div')
  host.appendChild(frag)
  applyLinkTargets(host)
  const clean = host.innerHTML

  // 上限を超えたら一番古いものから捨てる（Map は挿入順を保つ）
  if (cache.size >= CACHE_LIMIT) {
    const oldest = cache.keys().next()
    if (!oldest.done) cache.delete(oldest.value)
  }
  cache.set(source, clean)

  return clean
}

/**
 * Markdown から装飾を落とした 1 行の要約を作る。
 * ノード一覧やツールチップで「どんな手順書が付いているか」を出すとき用。
 *
 * @param source Markdown 文字列
 * @param max 最大文字数。超えたら末尾を … にする
 */
export function markdownExcerpt(source: string | undefined | null, max = 80): string {
  if (!source) return ''
  const text = source
    .replace(/```[\s\S]*?```/g, ' ') // コードブロックごと落とす
    .replace(/^\s{0,3}#{1,6}\s+/gm, '') // 見出し記号
    .replace(/^\s{0,3}[-*+]\s+(\[[ xX]\]\s+)?/gm, '') // 箇条書き・チェックボックス
    .replace(/^\s{0,3}>\s?/gm, '') // 引用
    .replace(/\[([^\]]*)\]\([^)]*\)/g, '$1') // リンクはテキストだけ残す
    .replace(/[*_`~|]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
  return text.length > max ? `${text.slice(0, max)}…` : text
}

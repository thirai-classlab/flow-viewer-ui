import { ICONS, ICON_DEFAULTS } from './lucide'
import type { IconName } from './lucide'

type Props = {
  name: IconName
  /** 1 辺の px。ツールバーは 16、見出しは 14 が目安 */
  size?: number
  /** 装飾用なら省略（aria-hidden）。意味を持つなら文言を渡す */
  label?: string
  className?: string
}

/**
 * React 側のアイコン。stroke は currentColor なので、置いた場所の文字色で描かれる。
 * キャンバス（LogicFlow の h()）側は nodes.ts の iconShape() が同じ ICONS を使う。
 */
export function Icon({ name, size = 16, label, className }: Props) {
  return (
    <svg
      viewBox={ICON_DEFAULTS.viewBox}
      fill={ICON_DEFAULTS.fill}
      stroke={ICON_DEFAULTS.stroke}
      strokeWidth={ICON_DEFAULTS['stroke-width']}
      strokeLinecap={ICON_DEFAULTS['stroke-linecap']}
      strokeLinejoin={ICON_DEFAULTS['stroke-linejoin']}
      width={size}
      height={size}
      className={className}
      aria-hidden={label ? undefined : true}
      role={label ? 'img' : undefined}
      aria-label={label}
      focusable="false"
      style={{ flex: '0 0 auto', verticalAlign: '-0.15em' }}
    >
      {ICONS[name].map(([tag, attrs], i) => {
        const Tag = tag
        return <Tag key={i} {...attrs} />
      })}
    </svg>
  )
}

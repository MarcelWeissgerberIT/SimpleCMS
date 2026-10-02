import type { ColorName } from '../store/types'

export const colorText = (c: ColorName | undefined | null) => `var(--c-${c ?? 'default'}-text)`
export const colorBg = (c: ColorName | undefined | null) => `var(--c-${c ?? 'default'}-bg)`

/** Style object for a coloured tag/chip (select options, people …). */
export function tagStyle(c: ColorName | undefined | null): React.CSSProperties {
  const name = !c || c === 'default' ? 'gray' : c
  return { color: `var(--c-${name}-text)`, background: `var(--c-${name}-bg)` }
}

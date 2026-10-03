import type { CSSProperties } from 'react'

const CHANNELS = ['orange', 'blue', 'green', 'purple', 'yellow', 'pink', 'red', 'brown'] as const

/** "Ada Lovelace" → "AL", "grace" → "GR", "" + email → from the address. */
export function initials(name: string, email = ''): string {
  const src = name.trim() || email.split('@')[0] || '?'
  const words = src.split(/[\s._-]+/).filter(Boolean)
  const out = words.length > 1 ? words[0][0] + words[words.length - 1][0] : src.slice(0, 2)
  return out.toUpperCase()
}

/** A stable content colour per person (members have no presence colour). */
function channel(id: string): string {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return `var(--c-${CHANNELS[Math.abs(h) % CHANNELS.length]}-text)`
}

/**
 * Initials on a keycap-like square; the coloured bar underneath is the person's channel
 * (their live caret colour when we know it).
 */
export function Avatar({ name, email, id, color, size = 22, title }: { name: string; email?: string; id: string; color?: string; size?: number; title?: string }) {
  return (
    <span
      className="cl-av"
      style={{ '--av-size': `${size}px`, '--av-color': color || channel(id) } as CSSProperties}
      title={title}
      aria-hidden={title ? undefined : true}
    >
      {initials(name, email)}
    </span>
  )
}

import type { ReactNode } from 'react'

export function Switch({ checked, onChange, label, disabled }: { checked: boolean; onChange: (v: boolean) => void; label?: string; disabled?: boolean }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      className="switch"
      onClick={() => onChange(!checked)}
    />
  )
}

export function Kbd({ children }: { children: ReactNode }) {
  return <kbd className="kbd">{children}</kbd>
}

export function Led({ state = 'off', title }: { state?: 'off' | 'on' | 'ok'; title?: string }) {
  return <span className={`led${state === 'on' ? ' led--on' : state === 'ok' ? ' led--ok' : ''}`} title={title} aria-hidden={!title} />
}

/** Platform-aware modifier label. */
export const isMac = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)
export const MOD = isMac ? '⌘' : 'Ctrl'
export const ALT = isMac ? '⌥' : 'Alt'
export const SHIFT = isMac ? '⇧' : 'Shift'
/** "Mod+K" → "⌘K" / "Ctrl+K" */
export function shortcutLabel(s: string): string {
  const parts = s.split('+').map((p) => (p === 'Mod' ? MOD : p === 'Alt' ? ALT : p === 'Shift' ? SHIFT : p))
  return isMac ? parts.join('') : parts.join('+')
}

import type { ReactNode } from 'react'
import { screwAngles } from './screws'

export type SwitchSize = 'md' | 'sm'

const CORNERS = ['tl', 'tr', 'bl', 'br'] as const

/**
 * The glass rocker's parts (ui.css "Switch: glass rocker"): four slotted screws in the bezel's corners, the
 * opening with its dark floor and the LED glow, and the rocker — two glass halves engraved 0 (left, off) and I
 * (right, on). Spans only, no text: the button carries the name and the state.
 */
function SwitchArt({ seed }: { seed: string }) {
  const angles = screwAngles(seed, CORNERS.length)
  return (
    <span className="switch__art" aria-hidden="true">
      <span className="switch__well">
        <span className="switch__glow" />
        <span className="switch__rocker">
          <span className="switch__face">
            <span className="switch__half switch__half--o">
              <span className="switch__o" />
            </span>
            <span className="switch__half switch__half--i">
              <span className="switch__i" />
            </span>
          </span>
        </span>
      </span>
      {CORNERS.map((c, i) => (
        <span key={c} className={`switch__screw switch__screw--${c}`} style={{ ['--screw-rot' as string]: `${angles[i]}deg` }} />
      ))}
    </span>
  )
}

/**
 * On / off: a horizontal glass rocker ("Glas-Wippe") in a screwed, brushed-steel bezel — 0 pressed and the glass
 * milky = off, I pressed and an LED glowing through the glass = on. The LED is the signal colour unless this
 * device picked another (Settings → Appearance → Switch LED); the size follows the text size. `size="sm"` for
 * popover rows and other dense places. `seed` fastens the screws (default: the label; pass a stable id where
 * labels repeat or are translated). `describedBy` = id of a hint that describes it.
 */
export function Switch({
  checked,
  onChange,
  label,
  disabled,
  size = 'md',
  seed,
  describedBy,
}: {
  checked: boolean
  onChange: (v: boolean) => void
  label?: string
  disabled?: boolean
  size?: SwitchSize
  seed?: string
  describedBy?: string
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      aria-describedby={describedBy}
      disabled={disabled}
      className={size === 'sm' ? 'switch switch--sm' : 'switch'}
      onClick={() => onChange(!checked)}
    >
      <SwitchArt seed={seed ?? label ?? ''} />
    </button>
  )
}

/** The rocker's face alone (no role, aria-hidden): for a row that is itself the control (the page menu's menuitemcheckbox rows) or a preview. */
export function SwitchFace({ checked, size = 'md', seed = '' }: { checked: boolean; size?: SwitchSize; seed?: string }) {
  return (
    <span className={size === 'sm' ? 'switch switch--sm' : 'switch'} data-checked={checked} aria-hidden="true">
      <SwitchArt seed={seed} />
    </span>
  )
}

/** Slotted screw heads for a `.screw-plate` (or any position: relative box): the 4 corners, or 2 (top-left + bottom-right). */
export function Screws({ seed, count = 4 }: { seed: string; count?: 2 | 4 }) {
  const corners = count === 2 ? (['tl', 'br'] as const) : (['tl', 'tr', 'bl', 'br'] as const)
  const angles = screwAngles(seed, corners.length)
  return (
    <>
      {corners.map((c, i) => (
        <span key={c} className={`screw-plate__screw screw-plate__screw--${c}`} style={{ ['--screw-rot' as string]: `${angles[i]}deg` }} aria-hidden="true" />
      ))}
    </>
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

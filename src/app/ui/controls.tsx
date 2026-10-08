import type { ReactNode } from 'react'
import { screwAngles } from './screws'

export type SwitchSize = 'md' | 'sm'

/**
 * Toggle geometry in CSS px = SVG user units: the art fills the plate inside its 1 px edge, 1:1, so every
 * edge sits on the pixel grid (odd diameters on half-pixel centres, 1 px strokes). Plate md 52×26 (inner
 * 50×24), sm 40×20 (inner 38×18). Screws in the bottom corners; the engraved O top-left, the lamp with the
 * I top-right; the hex nut sits bottom-centre and the lever leans about it (--sw-lean, ui.css) toward the
 * O (off) or the lamp (on). Clearances: the ball keeps ≥ 2 px from the O, the lamp and the screws.
 */
const GEOM = {
  md: { w: 50, h: 24, screw: 3, screws: [[4.5, 19.5], [45.5, 19.5]], o: [8.5, 5.5, 3], lamp: [41.5, 5.5, 3], lampI: [3, 8], nut: [25, 18, 4], bore: 2, len: 12, ball: 3, shaft: 2 },
  sm: { w: 38, h: 18, screw: 2, screws: [[3.5, 14.5], [34.5, 14.5]], o: [6.5, 4.5, 2], lamp: [31.5, 4.5, 2], lampI: [3, 6], nut: [19, 13.5, 3], bore: 1.5, len: 9, ball: 2, shaft: 2 },
} as const

/** Hex nut with flats left / right (crisp vertical edges) around (0, 0); `a` = the apothem. */
const hex = (a: number) => {
  const r = a / Math.cos(Math.PI / 6)
  return [30, 90, 150, 210, 270, 330].map((d) => `${+(r * Math.cos((d * Math.PI) / 180)).toFixed(2)},${+(r * Math.sin((d * Math.PI) / 180)).toFixed(2)}`).join(' ')
}
const NUT = {
  md: [hex(GEOM.md.nut[2]), hex(GEOM.md.nut[2] - 1)],
  sm: [hex(GEOM.sm.nut[2]), hex(GEOM.sm.nut[2] - 1)],
}

function SwitchArt({ size, seed }: { size: SwitchSize; seed: string }) {
  const g = GEOM[size]
  const angles = screwAngles(seed, 2)
  const [ox, oy, or] = g.o
  const [lx, ly, lr] = g.lamp
  const [nx, ny] = g.nut
  return (
    <svg className="switch__art" viewBox={`0 0 ${g.w} ${g.h}`} width={g.w} height={g.h} aria-hidden="true" focusable="false">
      {g.screws.map(([x, y], i) => (
        <g key={i} transform={`translate(${x} ${y}) rotate(${angles[i]})`}>
          <circle className="switch__screw" r={g.screw} />
          <path className="switch__slot" d={`M${-g.screw + 0.5} 0H${g.screw - 0.5}`} />
        </g>
      ))}
      <circle className="switch__legend" cx={ox} cy={oy} r={or} />
      <circle className="switch__lens" cx={lx} cy={ly} r={lr} />
      <path className="switch__lamp" d={`M${lx} ${g.lampI[0]}V${g.lampI[1]}`} />
      {/* everything that moves is drawn around the pivot (local 0,0), so the CSS rotation needs no origin maths */}
      <g transform={`translate(${nx} ${ny})`}>
        <polygon className="switch__nut-edge" points={NUT[size][0]} />
        <polygon className="switch__nut" points={NUT[size][1]} />
        <circle className="switch__bore" r={g.bore} />
        <g className="switch__lever">
          <g className="switch__give">
            <path className="switch__shaft" d={`M0 0V${-g.len}`} strokeWidth={g.shaft} />
            <circle className="switch__ball" cy={-g.len} r={g.ball} />
          </g>
        </g>
      </g>
    </svg>
  )
}

/**
 * On / off: an industrial toggle switch ("Kippschalter") on a small screwed plate — lever right and the lamp
 * lit in the signal colour = on, lever left toward the engraved O = off. `size="sm"` for popover rows and other
 * dense places. `seed` fastens the screws (default: the label; pass a stable id where labels repeat or are
 * translated). `describedBy` = id of a hint that describes it.
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
      <SwitchArt size={size} seed={seed ?? label ?? ''} />
    </button>
  )
}

/** The toggle's face alone (no role, aria-hidden): for a row that is itself the control (the page menu's menuitemcheckbox rows) or a preview. */
export function SwitchFace({ checked, size = 'md', seed = '' }: { checked: boolean; size?: SwitchSize; seed?: string }) {
  return (
    <span className={size === 'sm' ? 'switch switch--sm' : 'switch'} data-checked={checked} aria-hidden="true">
      <SwitchArt size={size} seed={seed} />
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

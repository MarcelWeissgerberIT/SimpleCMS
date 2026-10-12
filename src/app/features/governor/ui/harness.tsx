/**
 * The test frame for the governor's UI pieces (DEV / ?e2e only, loaded by window.__oneGovernor.ui — never imported by the
 * app). Nothing is wired to the gate in G1 Phase A, so the browser spec mounts the pieces here with fictional props:
 *  - a field outside everything (the page editor someone types in);
 *  - optionally a dialog around the piece (the AI menu, ⌘K, a modal) or a region with its own prompt (the terminal dock);
 *  - the piece's keys write their names into a log instead of acting.
 */
import { createRoot, type Root } from 'react-dom/client'
import type { ReactNode } from 'react'
import { BrakeNote, type BrakeNoteProps } from './BrakeNote'
import { HaltCard, type HaltCardProps } from './HaltCard'
import { ConsumptionPlate, type ConsumptionPlateProps } from './ConsumptionPlate'
import { MonthBar, type MonthBarProps } from './MonthBar'

export type PieceKind = 'note' | 'halt' | 'plate' | 'month'

export interface FrameOpts {
  /** a role="dialog" around the piece */
  dialog?: boolean
  /** a role="region" around the piece with its own prompt field (the terminal's dock) */
  region?: boolean
  /** the frame's width in px (default: the window's) */
  width?: number
}

const log: string[] = []
let root: Root | null = null
let host: HTMLElement | null = null
let opts: FrameOpts = {}
let piece: ReactNode = null

const note = (name: string) => () => {
  log.push(name)
}

function render(): void {
  if (!root) return
  const inner = <div data-testid="gv-h-slot">{piece}</div>
  const wrapped = opts.dialog ? (
    <div role="dialog" aria-label="Frame dialog" data-testid="gv-h-dialog">
      {inner}
    </div>
  ) : opts.region ? (
    <div role="region" aria-label="Frame dock" data-testid="gv-h-region">
      <input data-testid="gv-h-prompt" aria-label="Frame prompt" />
      {inner}
    </div>
  ) : (
    inner
  )
  root.render(
    <div style={{ display: 'grid', gap: 16, padding: 16, maxWidth: opts.width ?? 'none' }}>
      <textarea data-testid="gv-h-field" aria-label="Frame field" rows={2} />
      {wrapped}
    </div>,
  )
}

/** Open the frame (replacing an open one). */
export function openFrame(o: FrameOpts = {}): void {
  closeFrame()
  opts = o
  log.length = 0
  host = document.createElement('div')
  host.dataset.testid = 'gv-harness'
  host.style.cssText = 'position:fixed;inset:0;z-index:2147483000;overflow:auto;background:var(--bg);color:var(--ink)'
  document.body.appendChild(host)
  root = createRoot(host)
  render()
}

/** Show a piece with fictional props (its callbacks write into the log). */
export function showPiece(kind: PieceKind, props: Record<string, unknown>): void {
  if (!root) openFrame()
  if (kind === 'note') piece = <BrakeNote {...(props as unknown as BrakeNoteProps)} onAllow={note('note-allow')} onCheaper={note('note-cheaper')} onCancel={note('note-cancel')} onAdjust={note('note-adjust')} />
  else if (kind === 'halt') piece = <HaltCard {...(props as unknown as HaltCardProps)} onAllow={note('halt-allow')} onCheaper={note('halt-cheaper')} onStop={note('halt-stop')} onEscape={note('halt-escape')} />
  else if (kind === 'plate') piece = <ConsumptionPlate {...(props as unknown as ConsumptionPlateProps)} onSetBudget={note('plate-set')} />
  else piece = <MonthBar {...(props as unknown as MonthBarProps)} />
  render()
}

export const frameLog = (): string[] => [...log]

export function closeFrame(): void {
  root?.unmount()
  host?.remove()
  root = null
  host = null
  piece = null
}

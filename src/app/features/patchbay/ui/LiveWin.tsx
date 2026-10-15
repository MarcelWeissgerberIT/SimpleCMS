/**
 * The live signal on a module (plan §3.10) — its LED and its window, the same on the rack (Module.tsx) and on the strands
 * (Strands.tsx). `useModuleLive` reads this module's slice of the live view (live/live.ts useLive: its entry, its clock's
 * FIRED time, whether a run in flight writes it, its run's money) — one selector per module, so a run re-renders the
 * modules it touches, never the rack; `LiveLed` draws the LED (a run's blink: CSS, ≤ 5 s, its delay taken once per run
 * so a remount resumes it); `LiveWindow` the window (liveWin.ts) — only a running window ticks once a second (ui/now.ts).
 */
import { useMemo, type CSSProperties } from 'react'
import { useShallow } from 'zustand/react/shallow'
import type { Translate } from '@/shared/i18n'
import { useLive } from '../live/live'
import type { LiveEntry } from '../live/core'
import { moduleOfJack } from '../live/legs'
import type { Model, Module, ModuleCost, ModuleKey } from '../types'
import { blinkSince, liveLed, liveWindow, runCostKey, type LiveLed as Led } from './liveWin'
import { useNow } from './now'

export interface ModuleLive {
  entry: LiveEntry | null
  fired: number | null
  /** a run in flight writes this module (a cable of it ends here) */
  written: boolean
  runCost: ModuleCost | null
}

const targets = new WeakMap<Model, Map<string, ModuleKey>>()

/** Edge id → the module its cable ends at (a net flag's: none) — once per model. */
export function edgeTargets(model: Model): Map<string, ModuleKey> {
  let m = targets.get(model)
  if (m) return m
  m = new Map()
  for (const e of model.edges) {
    const k = moduleOfJack(e.to)
    if (k) m.set(e.id, k)
  }
  targets.set(model, m)
  return m
}

/** This module's slice of the live view. */
export function useModuleLive(m: Module, model: Model): ModuleLive {
  const entry = useLive(useShallow((s) => s.modules[m.key] ?? null))
  const fired = useLive((s) => s.fired[m.key] ?? null)
  const written = useLive((s) => {
    if (!s.hot.length) return false
    const to = edgeTargets(model)
    return s.hot.some((id) => to.get(id) === m.key)
  })
  const key = runCostKey(m, entry?.state === 'running' ? entry.run : null)
  const runCost = useLive(useShallow((s) => (key ? (s.runCosts[key] ?? null) : null)))
  return { entry, fired, written, runCost }
}

/** The LED a live state lights, now (null: the module's own LED stands). */
export const ledOf = (live: ModuleLive): Led => liveLed(live.entry, live.fired, live.written, Date.now())

/** Is anything live to show in the window (decided without a ticking clock: a running timer ticks inside it)? */
export function hasLiveWindow(live: ModuleLive, t: Translate, lang: 'en' | 'de'): boolean {
  return liveWindow({ entry: live.entry, fired: live.fired, runCost: live.runCost, now: Date.now(), t, lang }) !== null
}

const LED_CLASS: Record<NonNullable<Led>, string> = {
  hot: 'led led--on pb-led--hot',
  lit: 'led led--on pb-led--hot',
  error: 'led pb-led--err',
  budget: 'led pb-led--warn',
  held: 'led pb-led--held',
}

/** The live LED: a run's blink (≤ 5 s from its start — CSS; the delay taken once per start resumes it on a remount). */
export function LiveLed({ led, live }: { led: NonNullable<Led>; live: ModuleLive }) {
  const since = led === 'hot' ? blinkSince(live.entry, live.fired) : null
  // taken once per start: a later render never shifts a running animation
  const delay = useMemo(() => (since === null ? null : Math.min(0, since - Date.now())), [since])
  return <span className={LED_CLASS[led]} data-live-led={led} data-hot={delay !== null || undefined} style={delay !== null ? ({ ['--pb-hot-delay']: `${Math.round(delay)}ms` } as CSSProperties) : undefined} aria-hidden="true" data-testid="pb-live-led" />
}

/** The live window (liveWin.ts): an LCD reading or a lamp's word; a running one ticks once a second. */
export function LiveWindow({ m, live, t, lang }: { m: Module; live: ModuleLive; t: Translate; lang: 'en' | 'de' }) {
  const running = live.entry?.state === 'running'
  const now = useNow(running)
  const w = liveWindow({ entry: live.entry, fired: live.fired, runCost: live.runCost, now, t, lang })
  if (!w) return null
  return (
    <span className={`pb-win${w.lcd ? ' pb-win--lcd' : ''}${w.big ? ' pb-win--big' : ''}`} data-live={w.kind} data-module={m.key} title={w.title} data-testid="pb-livewin">
      <b>{w.main}</b>
      {w.sub && <small>{w.sub}</small>}
    </span>
  )
}

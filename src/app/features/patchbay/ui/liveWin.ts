/**
 * What a module's window and LED say live (plan §1.7, §3.10, §6 U28 / U29) — pure: the live entry (live/core.ts), the
 * clock's FIRED time, the run's money and the time in, the words out. The rack (Module.tsx) and the strands
 * (Strands.tsx) draw the same answer (LiveWin.tsx).
 *
 *  - a run in flight: the LCD "RUNNING 0:04" with the run's money under it ("$0.21", "≈" for an estimate, "price
 *    unknown" — never $0) or "on the server"; the LED in signal, blinking while the run is under 5 s old (CSS: 8 × 0.6 s,
 *    the delay resumes it on a remount — never with reduced motion, never after noBlink());
 *  - a clock that fired: the LCD "07:30:00 FIRED" for 60 s (its LED as a run's);
 *  - after a failed run: "! FAILED" with the red lamp (`--pb-red`) — "!" and a word, never colour alone;
 *  - over its own budget: "! BUDGET" with the amber lamp; held by the Regler: "HELD" — never red, a ringed LED;
 *  - a database with open proposals: the big LCD "+3 FOR REVIEW";
 *  - a module a run in flight writes: its LED in signal (steady).
 * Nothing live: null — the module keeps its plain window (runs today, the worker's word).
 *
 * Also pure here (the Node specs drive them): `cableLabels` — "3 PROPOSALS" on the wire carrying an agent's cable to the
 * database its open proposals target (Rack.tsx feeds Wires with them) — and `dotAt` — where a run's dot is at a moment
 * (Comet.tsx draws it).
 */
import type { Translate } from '@/shared/i18n'
import { fmtUsd } from '../../../lib/money'
import { LEG_MS, type LiveEntry, type LiveLeg } from '../live/core'
import { moduleOfJack } from '../live/legs'
import type { Layout } from '../layout'
import type { Model, Module, ModuleCost, ModuleKey } from '../types'

const P = 'features.patchbay'

/** A clock's FIRED window stays this long (live/core.ts FIRED_MS). */
export const FIRED_SHOWN_MS = 60_000
/** A run's LED blinks at most this long from its start (the CSS: 8 × 0.6 s). */
export const BLINK_MAX_MS = 4_800

export type LiveWinKind = 'run' | 'fired' | 'failed' | 'budget' | 'held' | 'review'

export interface LiveWin {
  kind: LiveWinKind
  /** the LCD (dark glass, light figures) — a reading; plain chips for the lamps' words */
  lcd: boolean
  /** the big figure ("+3") */
  big?: boolean
  main: string
  sub?: string
  title: string
  /** the timer ticks (the window re-renders once a second) */
  ticks?: boolean
}

export type LiveLed = 'hot' | 'lit' | 'error' | 'budget' | 'held' | null

/** "0:04", "12:30", "1:02:05". */
export function elapsed(ms: number): string {
  const s = Math.max(0, Math.floor(ms / 1000))
  const h = Math.floor(s / 3600)
  const m = Math.floor((s % 3600) / 60)
  const ss = String(s % 60).padStart(2, '0')
  return h > 0 ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`
}

/** "07:30:00" in the UI's language (24 h). */
export const clockTime = (at: number, lang: string): string => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(at))

/** The ledger series of a module's run (live/costs.ts: `agent:<id>:<run>` …) — null: no money per run. */
export function runCostKey(m: Pick<Module, 'ref'>, run: string | null | undefined): string | null {
  if (!run) return null
  const r = m.ref
  switch (r.kind) {
    case 'agent':
      return `agent:${r.id}:${run}`
    case 'script':
      return `script:${r.id}:${run}`
    case 'organise':
      return `mail:${run}`
    case 'autofill':
      return `autofill:${r.db}:${r.prop}:${run}`
    default:
      return null
  }
}

/** Money as a window shows it: "≈ $0.21", "price unknown" (an unpriced response, never $0), nothing for none yet. */
export function moneyOf(c: ModuleCost | null | undefined, lang: 'en' | 'de', t: Translate): string | null {
  if (!c) return null
  if (c.usd > 0) return `${c.estimate ? '≈ ' : ''}${fmtUsd(c.usd, lang)}`
  if (c.unpriced > 0) return t(`${P}.live.priceUnknown`)
  return null
}

export interface LiveFacts {
  entry?: LiveEntry | null
  /** the clock fired at (ms) */
  fired?: number | null
  /** the run's money (runCosts[runCostKey]) */
  runCost?: ModuleCost | null
  now: number
  lang: 'en' | 'de'
  t: Translate
}

/** The live window of a module (null: nothing live — its plain window stands). */
export function liveWindow(f: LiveFacts): LiveWin | null {
  const { entry: e, t, lang, now } = f
  if (e?.state === 'running') {
    const since = e.since ?? now
    const money = moneyOf(f.runCost, lang, t)
    const at = clockTime(since, lang)
    return {
      kind: 'run',
      lcd: true,
      main: t(`${P}.live.running`, { t: elapsed(now - since) }),
      ...(money ? { sub: money } : e.server ? { sub: t(`${P}.live.server`) } : {}),
      title: t(e.server ? `${P}.live.serverTitle` : e.elsewhere ? `${P}.live.elsewhereTitle` : `${P}.live.runningTitle`, { time: at }),
      ticks: true,
    }
  }
  if (f.fired && now - f.fired < FIRED_SHOWN_MS) {
    const at = clockTime(f.fired, lang)
    return { kind: 'fired', lcd: true, main: at, sub: t(`${P}.live.fired`), title: t(`${P}.live.firedTitle`, { time: at }) }
  }
  if (e?.state === 'error') return { kind: 'failed', lcd: false, main: `! ${t(`${P}.live.failed`)}`, title: t(`${P}.live.failedTitle`) }
  if (e?.state === 'budget') return { kind: 'budget', lcd: false, main: `! ${t(`${P}.live.budget`)}`, title: t(`${P}.live.budgetTitle`) }
  // the Regler's own wording ("held by the governor" / "vom Regler angehalten")
  if (e?.state === 'held') return { kind: 'held', lcd: false, main: t(`${P}.live.held`), title: t('features.governor.status.heldLower') }
  if (e?.review && e.review > 0) {
    const n = e.review
    return { kind: 'review', lcd: true, big: true, main: t(`${P}.live.reviewN`, { n }), sub: t(`${P}.live.reviewWord`), title: t(n === 1 ? `${P}.live.reviewTitle.one` : `${P}.live.reviewTitle`, { n }) }
  }
  return null
}

/**
 * The LED a live state lights: a run in flight or a clock that fired ('hot': signal, blinking under 5 s), a module a
 * run in flight writes ('lit': signal, steady), the lamps of a run's end — red, amber, held (a ring, never red).
 */
export function liveLed(e: LiveEntry | null | undefined, fired: number | null | undefined, written: boolean, now: number): LiveLed {
  if (e?.state === 'running') return 'hot'
  if (fired && now - fired < FIRED_SHOWN_MS) return 'hot'
  if (e?.state === 'error') return 'error'
  if (e?.state === 'budget') return 'budget'
  if (e?.state === 'held') return 'held'
  if (written) return 'lit'
  return null
}

/** When the hot LED's blink began (a run's start, a clock's firing) — the CSS delay resumes it from there. */
export const blinkSince = (e: LiveEntry | null | undefined, fired: number | null | undefined): number | null => (e?.state === 'running' ? (e.since ?? null) : (fired ?? null))

/**
 * B14 — the cable labels "3 PROPOSALS": a wire that carries an agent's cable to a database gets the number of that
 * agent's open proposals for it (live.ts `cables`, keyed `<agent>|<database>`); a bus wire adds its cables up.
 */
export function cableLabels(model: Model, layout: Pick<Layout, 'wires'>, cables: Readonly<Record<string, number>>, t: Translate): Map<string, string> {
  const out = new Map<string, string>()
  // Orders B10: a cable's own words stand without a live count — the planner's "KETTE ↵", a hand-on's "nächster Schritt"
  const tagged = model.edges.some((e) => e.tag)
  if (!Object.keys(cables).length && !tagged) return out
  const edges = new Map(model.edges.map((e) => [e.id, e]))
  for (const w of layout.wires) {
    const seen = new Set<string>()
    let n = 0
    let tag: 'chainHand' | 'next' | null = null
    for (const id of w.edges) {
      const e = edges.get(id)
      if (e?.tag === 'chainHand' || (e?.tag === 'next' && !tag)) tag = e.tag
      const from = e ? moduleOfJack(e.from) : null
      const to = e ? moduleOfJack(e.to) : null
      if (!from || !to) continue
      const k = `${from}|${to}`
      if (seen.has(k)) continue
      seen.add(k)
      n += cables[k] ?? 0
    }
    if (n > 0) out.set(w.id, t(n === 1 ? `${P}.live.proposals.one` : `${P}.live.proposals`, { n }))
    else if (tag) out.set(w.id, t(`${P}.wire.${tag}`))
  }
  return out
}

/** How long a dot fades where its last leg arrived (Comet.tsx). */
export const FADE_MS = 160

/** A run's dot at a moment: the edge it travels, how far (0–1), how visible. */
export interface Dot {
  edge: string
  t: number
  opacity: number
}

/**
 * Where a run's dot is at `now` (null: hidden) — the leg playing (600 ms along its cable), else the last one that ended
 * fading where it arrived (FADE_MS). A leg whose cable is not drawn (`drawn` says no) is skipped in its slot.
 */
export function dotAt(legs: readonly LiveLeg[], now: number, drawn: (edgeId: string) => boolean): Dot | null {
  let playing: LiveLeg | null = null
  let ended: LiveLeg | null = null
  for (const l of legs) {
    if (!drawn(l.edgeId)) continue
    if (l.at <= now && now < l.at + LEG_MS) playing = l
    else if (l.at + LEG_MS <= now && (!ended || l.at > ended.at)) ended = l
  }
  if (playing) return { edge: playing.edgeId, t: (now - playing.at) / LEG_MS, opacity: 1 }
  if (ended && now < ended.at + LEG_MS + FADE_MS) return { edge: ended.edgeId, t: 1, opacity: 1 - (now - ended.at - LEG_MS) / FADE_MS }
  return null
}

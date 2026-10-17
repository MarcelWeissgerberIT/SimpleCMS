/**
 * § 00 — the setup lamps (plan §3.7, §1.11, §6 U7 / U26 / U27): one lamp per step of the setup that exists, in order —
 * an `<ol>`, each lamp an `<li>` whose mono label carries its state as text ("DONE / NEXT / LATER" — never colour
 * alone), the lamp worked on `aria-current="step"`; sockets: done = a filled green dot, next = an ink ring, later =
 * dark; the fill line joining them is decoration (`aria-hidden`).
 *
 * Under each: number, name, one sentence of state (its data bold), a trace "● → ● pressed 16:19" once a step that ran
 * went green. Keys: only the lamp worked on carries the primary key ("↵ Create database"); green lamps open their step
 * as a quiet link; later lamps a dashed `aria-disabled` "after 04". Every key carries the lamps' DOM contract
 * (setup/focus.ts: `data-pb-lamp`, `data-pb-profile`, `data-pb-recipe` on 04–06) — the arrival after a step that left
 * the page, and the dialogs' "after", find the next lamp's key by it. A press runs exactly that lamp's step
 * (setup/act.ts runLamp). Vertical (`vlamps`) below 960 px × the text size, measured.
 */
import { useLayoutEffect, useRef, useState } from 'react'
import { CornerDownLeft, Lock } from 'lucide-react'
import type { Translate } from '@/shared/i18n'
import type { SetupLamp } from '../types'
import type { LampSet } from '../setup/lamps'
import { keyLabel } from '../setup/lamps'
import { lampNo } from '../setup/keys'
import { runLamp } from '../setup/act'
import { Rich } from './rich'
import { announce } from './store'

const P = 'features.patchbay'
/** Below this width (× the text size) the lamps stand one under the other (§3.7). */
export const LAMPS_ROW_MIN = 960

const scale = (): number => {
  try {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-scale')) || 1
  } catch {
    return 1
  }
}

/** Is the box narrower than the lamps need in a row (960 px × the text size)? Measured. */
export function useVertical(box: React.RefObject<HTMLElement | null>, force?: boolean): boolean {
  const [v, setV] = useState(!!force)
  useLayoutEffect(() => {
    if (force) {
      setV(true)
      return
    }
    const el = box.current
    if (!el) return
    const check = () => setV(el.clientWidth > 0 && el.clientWidth < LAMPS_ROW_MIN * scale())
    check()
    const ro = new ResizeObserver(check)
    ro.observe(el)
    return () => ro.disconnect()
  }, [box, force])
  return v
}

const stateWord = (l: SetupLamp): string => (l.state === 'ok' ? 'done' : l.state === 'dark' ? 'later' : l.state)

/** The time of a trace ("16:19"). */
const timeOf = (at: number, lang: string) => new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit' }).format(new Date(at))

function LampKey({ lamp, set, profileId, t, prev, name }: { lamp: SetupLamp; set: LampSet; profileId: string; t: Translate; prev: number; name: string }) {
  const attrs = {
    'data-pb-lamp': String(lamp.n),
    'data-pb-profile': profileId,
    ...(lamp.n >= 4 && set.recipe ? { 'data-pb-recipe': set.recipe } : {}),
  }
  if (lamp.state === 'dark') {
    const after = t(`${P}.setup.after`, { n: lampNo(prev) })
    return (
      <button type="button" className="btn pb-lamp__key pb-lamp__key--later" aria-disabled="true" onClick={() => announce(`${name} — ${after}`)} data-testid="pb-lamp-key" {...attrs}>
        <Lock size={13} strokeWidth={1.75} aria-hidden="true" />
        {after}
      </button>
    )
  }
  const label = keyLabel(lamp)
  if (!label || !lamp.action) return null
  const press = (el: HTMLElement) => {
    if (!runLamp(lamp, { profileId, recipeId: set.recipe, from: el })) announce(t(`${P}.setup.after`, { n: lampNo(prev) }))
  }
  if (lamp.state === 'ok')
    return (
      <button type="button" className="pb-lamp__link" aria-label={`${t(label.key, label.vars)}: ${name}`} onClick={(e) => press(e.currentTarget)} data-testid="pb-lamp-key" {...attrs}>
        {t(label.key, label.vars)}
      </button>
    )
  const primary = lamp.state === 'next'
  return (
    <button type="button" className={primary ? 'btn btn--primary pb-lamp__key' : 'btn pb-lamp__key'} aria-keyshortcuts="Enter" onClick={(e) => press(e.currentTarget)} data-testid="pb-lamp-key" {...attrs}>
      {primary && (
        <span className="kbd pb-lamp__kbd" aria-hidden="true">
          <CornerDownLeft size={10} strokeWidth={2} />
        </span>
      )}
      {t(label.key, label.vars)}
    </button>
  )
}

export function Lamps({ set, profileId, t, lang, vertical }: { set: LampSet; profileId: string; t: Translate; lang: string; vertical: boolean }) {
  const lamps = set.lamps
  // the fill line runs through the green lamps from the first one on (decoration — the words say each lamp's state)
  let run = 0
  while (run < lamps.length && lamps[run].state === 'ok') run++
  const fill = lamps.length > 1 ? Math.max(0, run - 1) / (lamps.length - 1) : 0
  const listRef = useRef<HTMLOListElement>(null)
  return (
    <div className="pb-lampsbox" data-v={vertical || undefined} style={{ ['--n' as string]: lamps.length }}>
      <span className="pb-lamps__line" aria-hidden="true">
        <i style={vertical ? { height: `${fill * 100}%` } : { width: `${fill * 100}%` }} />
      </span>
      <ol className="pb-lamps" ref={listRef} aria-label={t(`${P}.setup.lampsAria`, { n: set.done, m: lamps.length })} data-testid="pb-setup-lamps">
        {lamps.map((l, i) => {
          const name = t(`${P}.lamp.${l.id}`)
          const current = l.state === 'next' || l.state === 'busy'
          return (
            <li key={l.n} className="pb-lamp" data-s={l.state} data-n={l.n} data-optional={l.optional || undefined} aria-current={current ? 'step' : undefined} data-testid="pb-lamp">
              <span className="pb-lamp__sock" aria-hidden="true" />
              <span className="pb-lamp__body">
                <span className="pb-lamp__head">
                  <span className="pb-lamp__no" data-next={current || undefined}>
                    {lampNo(l.n)}
                  </span>
                  <span className="pb-lamp__name">{name}</span>
                  {/* Orders B10: an optional step (05 KONTEXT) — dim, never red; leaving it out is a valid end */}
                  {l.optional && <span className="label pb-lamp__opt">{t(`${P}.setup.optional`)}</span>}
                  <span className="label pb-lamp__st" data-testid="pb-lamp-state">
                    {t(`${P}.setup.state.${stateWord(l)}`)}
                  </span>
                </span>
                <span className="pb-lamp__say">
                  <Rich text={t(l.say.key, l.say.vars)} />
                </span>
                {l.trace && (
                  <span className="pb-lamp__trace">
                    <span className="led pb-led--warn" aria-hidden="true" />
                    <span aria-hidden="true">→</span>
                    <span className="led pb-led--ok" aria-hidden="true" />
                    {t(`${P}.setup.trace`, { time: timeOf(l.trace.at, lang) })}
                  </span>
                )}
                <LampKey lamp={l} set={set} profileId={profileId} t={t} prev={i > 0 ? lamps[i - 1].n : 0} name={name} />
              </span>
            </li>
          )
        })}
      </ol>
    </div>
  )
}

/**
 * WERKZEUGE / TOOLS — what a person opens now and then (Agenda … Import), inside the sidebar's `nav` under the daily
 * rows, as ONE strip of keycaps: Agenda · Graph · Agents · Scripts · Patchbay · Building blocks │ Templates · Import
 * (the two after the hairline open a dialog; viewers get neither).
 *
 * The head is a readout: at rest "TOOLS", or what waits most — open fuses, then the agents' proposals, then the
 * Patchbay's NEW — in short words ("PATCHBAY · 1 OPEN", "AGENTS · 3 TO REVIEW"; NEW only while nothing is counted);
 * under the pointer or the focus, that key's name and state. Each key's accessible name says it as a sentence. Never
 * cut: where the widest text it may show does not fit, the head keeps two lines (`useReadoutLines`). The eight keys
 * share one row at every width. The LEDs and counts ride the keys' top edges, NEW is a dot bottom left — clear of the
 * glyph (Agents' count — hidden while Preflight is on —, the Patchbay's LED / grey "?" through its own key, test ids
 * kept). One Tab stop (the open tool's key, else the first), ← / → / Home / End move along (WAI-ARIA toolbar).
 *
 * NAMES (aria-pressed) turns the strip into today's labelled rows — per device, localStorage `one.shell.tools` =
 * { mode: 'keys' | 'list', phoneOpen }. A coarse pointer (iPad docked, a phone) shows the keys as a labelled 4 × 2 grid
 * of ≥ 44 px keys (no hover there) — sidebar.css.
 *
 * In the phone drawer TOOLS starts as ONE folded 36 px row: its name, an LED with the sum of what waits (open fuses +
 * the agents' proposals; NEW when only the Patchbay's is new) — never a count of the tools it hides. A tap unfolds the
 * grid (aria-expanded); the choice is `phoneOpen`.
 */
import { useLayoutEffect, useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Bot, CalendarClock, ChevronDown, LayoutTemplate, Shapes, SquareCode, Upload, Waypoints } from 'lucide-react'
import { useUI } from '../../store/ui'
import { navigate, useRoute } from '../../lib/router'
import { AgentsNavBadge, PatchbayNavRow, useAgentsAttention, usePatchbayCounts, usePatchbaySeen, usePreflightOn } from '../../features'
import { useT } from '../../i18n'
import { closeMobileSidebar } from '../lib/actions'
import { useIsMobile, useLocalPref } from '../lib/hooks'
import { useReadOnly } from '../cloud/state'
import { NavRow } from './NavRow'

type Mode = 'keys' | 'list'
interface Pref {
  mode: Mode
  /** the phone drawer's tool row unfolded (slice 2) */
  phoneOpen: boolean
}

/** This device's tool prefs: anything odd reads as the default (keys, folded on a phone). */
export function readTools(v: unknown): Pref {
  const p = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof Pref, unknown>>
  return { mode: p.mode === 'list' ? 'list' : 'keys', phoneOpen: p.phoneOpen === true }
}

interface Tool {
  id: string
  icon: ReactNode
  label: string
  /** the name on the key itself (the labelled grid on a coarse pointer): short, with soft hyphens where it may break */
  key: string
  active: boolean
  /** its state in words (a count, NEW) — after the name in the key's accessible name */
  state: string[]
  /** the same, short — after the name in the readout (one state: a count before NEW) */
  say: string[]
  badge?: ReactNode
  /** opens a dialog (Templates, Import): drawn after the hairline */
  dialog?: true
  onClick: () => void
}

const P = 'features.patchbay'

export function ToolStrip() {
  const t = useT()
  const route = useRoute()
  const readOnly = useReadOnly()
  // Preflight's plate counts the agents' proposals: their own count goes while it is on
  const preflightOn = usePreflightOn()
  const agentsN = useAgentsAttention()
  const agents = preflightOn ? 0 : agentsN
  const pb = usePatchbayCounts()
  const seen = usePatchbaySeen()
  const fuses = pb.ready ? pb.open : 0
  const unknown = pb.ready ? pb.unknown : 0
  const [raw, setRaw] = useLocalPref<unknown>('one.shell.tools', { mode: 'keys', phoneOpen: false })
  const pref = readTools(raw)
  const phone = useIsMobile()
  const go = (fn: () => void) => () => {
    closeMobileSidebar()
    fn()
  }
  const pbTitle = t(`${P}.title`)
  const pbState = [
    fuses > 0 ? t(fuses === 1 ? `${P}.nav.fuses.one` : `${P}.nav.fuses`, { n: fuses }) : unknown > 0 ? t(unknown === 1 ? `${P}.nav.unknown.one` : `${P}.nav.unknown`, { n: unknown }) : '',
    seen ? '' : t(`${P}.new`),
  ].filter(Boolean)
  // the readout's words: the count, else NEW — "SCHALTPLAN · 2 OFFEN" fits the head, the sentence is the key's name
  const pbSay = fuses > 0 ? [t('shell.tools.say.fuses', { n: fuses })] : unknown > 0 ? [t('shell.tools.say.unknown', { n: unknown })] : seen ? [] : [t(`${P}.new`)]
  const k = (id: string) => t(`shell.tools.key.${id}`)
  const tools: Tool[] = [
    { id: 'agenda', icon: <CalendarClock size={16} />, label: t('shell.nav.agenda'), key: k('agenda'), active: route.name === 'agenda', state: [], say: [], onClick: go(() => navigate({ name: 'agenda' })) },
    { id: 'graph', icon: <Waypoints size={16} />, label: t('shell.nav.graph'), key: k('graph'), active: route.name === 'graph', state: [], say: [], onClick: go(() => navigate({ name: 'graph' })) },
    {
      id: 'agents',
      icon: <Bot size={16} />,
      label: t('features.agents.title'),
      key: k('agents'),
      active: route.name === 'agents',
      state: agents ? [t(agents === 1 ? 'features.agents.navReview.one' : 'features.agents.navReview', { n: agents })] : [],
      say: agents ? [t('shell.tools.say.review', { n: agents })] : [],
      badge: preflightOn ? undefined : <AgentsNavBadge />,
      onClick: go(() => navigate({ name: 'agents' })),
    },
    { id: 'scripts', icon: <SquareCode size={16} />, label: t('features.script.title'), key: k('scripts'), active: route.name === 'scripts', state: [], say: [], onClick: go(() => navigate({ name: 'scripts' })) },
    // the Patchbay draws its own key (its LED, "?", NEW and test ids — features/patchbay)
    { id: 'patchbay', icon: null, label: pbTitle, key: k('patchbay'), active: route.name === 'patchbay', state: pbState, say: pbSay, onClick: () => {} },
    { id: 'kit', icon: <Shapes size={16} />, label: t('features.kit.title'), key: k('kit'), active: route.name === 'kit', state: [], say: [], onClick: go(() => navigate({ name: 'kit' })) },
    ...(readOnly
      ? []
      : ([
          { id: 'templates', icon: <LayoutTemplate size={16} />, label: t('shell.nav.templates'), key: k('templates'), active: false, state: [], say: [], dialog: true, onClick: go(() => useUI.getState().openModal({ type: 'templates', parentId: null })) },
          { id: 'import', icon: <Upload size={16} />, label: t('shell.nav.import'), key: k('import'), active: false, state: [], say: [], dialog: true, onClick: go(() => useUI.getState().openModal({ type: 'import' })) },
        ] as Tool[])),
  ]
  // a second line (narrow sidebar, big text) starts after the dot: "SCHALTPLAN ·" / "1 OFFEN"
  const said = (x: Tool) => [x.label, ...x.say].join('\u00a0· ')

  // at rest: what waits most — open fuses, then proposals, then NEW — else the strip's name
  const urgent = fuses > 0 ? said(tools.find((x) => x.id === 'patchbay')!) : agents > 0 ? said(tools.find((x) => x.id === 'agents')!) : !seen ? t('shell.tools.readoutNew', { tool: pbTitle }) : null
  const [pointed, setPointed] = useState<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const hot = pointed ?? focused
  const readout = pref.mode === 'keys' && hot !== null && tools[hot] ? said(tools[hot]) : (urgent ?? t('shell.tools.title'))
  // every text the readout may show now: where the widest does not fit one line, the head keeps two lines for good
  const lines = useReadoutLines([t('shell.tools.title'), ...(urgent ? [urgent] : []), ...(pref.mode === 'keys' ? tools.map(said) : [])])

  // roving focus: one Tab stop — the open tool's key, else the first; the arrows move along
  const keys = useRef<(HTMLButtonElement | null)[]>([])
  const [focusAt, setFocusAt] = useState<number | null>(null)
  const activeAt = Math.max(0, tools.findIndex((x) => x.active))
  const stop = focusAt !== null && focusAt < tools.length ? focusAt : activeAt
  const indexOf = (el: EventTarget | null) => (el instanceof Node ? keys.current.findIndex((k) => !!k && k.contains(el)) : -1)
  const onKey = (e: KeyboardEvent<HTMLDivElement>) => {
    const i = indexOf(e.target)
    if (i < 0 || e.altKey || e.metaKey || e.ctrlKey) return
    let to: number | null = null
    if (e.key === 'ArrowRight') to = (i + 1) % tools.length
    else if (e.key === 'ArrowLeft') to = (i - 1 + tools.length) % tools.length
    else if (e.key === 'Home') to = 0
    else if (e.key === 'End') to = tools.length - 1
    if (to === null) return
    e.preventDefault()
    e.stopPropagation()
    setFocusAt(to)
    keys.current[to]?.focus()
  }
  const keyProps = (i: number) => ({
    tabIndex: i === stop ? 0 : -1,
    'aria-label': [tools[i].label, ...tools[i].state].join(', '),
    ref: (el: HTMLButtonElement | null) => {
      keys.current[i] = el
    },
  })

  const names = (
    <button type="button" className="sb-tools__names" aria-pressed={pref.mode === 'list'} aria-label={t('shell.tools.namesAria')} onClick={() => setRaw({ ...pref, mode: pref.mode === 'list' ? 'keys' : 'list' })}>
      {t('shell.tools.names')}
    </button>
  )
  const head = (
    <div
      ref={lines.ref}
      className="sb-tools__head"
      aria-hidden
      data-hot={pref.mode === 'keys' && hot !== null ? '' : undefined}
      data-urgent={hot === null && urgent ? '' : undefined}
      data-lines={lines.two ? '2' : undefined}
    >
      <span className="sb-tools__readout">{readout}</span>
      <span className="sb-sect__leader" />
      <span className="sb-tools__ruler" />
    </div>
  )

  // the phone drawer: one folded row until a tap opens it (what waits: an LED and its sum, viewers' fuses in neutral ink)
  const waiting = fuses + agents
  const lit = (readOnly ? 0 : fuses) + agents
  const fold = phone && (
    <button
      type="button"
      className="sb-tools__fold"
      aria-expanded={pref.phoneOpen}
      aria-controls={pref.phoneOpen ? 'sb-tools-body' : undefined}
      aria-label={[t('shell.tools.title'), waiting ? t(waiting === 1 ? 'shell.tools.waiting.one' : 'shell.tools.waiting', { n: waiting }) : !seen ? t(`${P}.new`) : ''].filter(Boolean).join(', ')}
      onClick={() => setRaw({ ...pref, phoneOpen: !pref.phoneOpen })}
    >
      <span className="sb-tools__readout">{t('shell.tools.title')}</span>
      <span className="sb-sect__leader" aria-hidden />
      {waiting > 0 ? (
        <span className="sb-navrow__badge sb-tools__sum" data-viewer={lit ? undefined : ''} aria-hidden>
          <span className={lit ? 'led led--on' : 'led'} />
          {waiting > 99 ? '99+' : String(waiting).padStart(2, '0')}
        </span>
      ) : (
        !seen && (
          <span className="sb-tools__newtag" aria-hidden>
            {t(`${P}.new`)}
          </span>
        )
      )}
      <ChevronDown size={14} className="sb-tools__chev" aria-hidden />
    </button>
  )
  if (phone && !pref.phoneOpen)
    return (
      <div className="sb-tools" data-mode={pref.mode} data-phone="folded">
        {fold}
      </div>
    )

  if (pref.mode === 'list')
    return (
      <div className="sb-tools" data-mode="list" data-phone={phone ? 'open' : undefined}>
        {fold || head}
        <div className="sb-tools__list" id="sb-tools-body" role="group" aria-label={t('shell.tools.title')}>
          {tools.map((x) => (x.id === 'patchbay' ? <PatchbayNavRow key={x.id} active={x.active} /> : <NavRow key={x.id} icon={x.icon} label={x.label} active={x.active} badge={x.badge} onClick={x.onClick} />))}
        </div>
        {names}
      </div>
    )

  return (
    <div className="sb-tools" data-mode="keys" data-phone={phone ? 'open' : undefined}>
      {fold || head}
      <div
        id="sb-tools-body"
        className="sb-tools__keys"
        role="toolbar"
        aria-label={t('shell.tools.title')}
        onKeyDown={onKey}
        onPointerOver={(e: PointerEvent<HTMLDivElement>) => {
          const i = indexOf(e.target)
          setPointed(i < 0 ? null : i)
        }}
        onPointerLeave={() => setPointed(null)}
        onFocus={(e: FocusEvent<HTMLDivElement>) => {
          const i = indexOf(e.target)
          if (i >= 0) {
            setFocused(i)
            setFocusAt(i)
          }
        }}
        onBlur={(e: FocusEvent<HTMLDivElement>) => {
          if (e.currentTarget.contains(e.relatedTarget as Node | null)) return
          setFocused(null)
          // back to the open tool's key as the strip's Tab stop
          setFocusAt(null)
        }}
      >
        {tools.map((x, i) => (
          <span key={x.id} className="sb-tools__cell" data-dialog={x.dialog && !tools[i - 1]?.dialog ? 'first' : undefined}>
            {x.id === 'patchbay' ? (
              <PatchbayNavRow active={x.active} variant="key" keyProps={keyProps(i)} keyLabel={x.key} />
            ) : (
              <button type="button" className="sb-tool" data-active={x.active || undefined} aria-current={x.active ? 'page' : undefined} onClick={x.onClick} {...keyProps(i)}>
                <span className="sb-tool__icon" aria-hidden>
                  {x.icon}
                </span>
                <span className="sb-tool__label">{x.key}</span>
                {x.badge}
              </button>
            )}
          </span>
        ))}
      </div>
      {names}
    </div>
  )
}

/**
 * The readout is one line where the widest text it may show fits (the strip's name, what waits, every key's name and
 * state); else — a narrow sidebar with big text — it keeps two lines, also while it shows a short text, so pointing at the
 * keys never moves them. Measured with a hidden ruler (the readout's font, set as close as under the pointer) whenever
 * the head or NAMES changes size (the sidebar's width, the text size, the language) or the texts change.
 */
function useReadoutLines(texts: string[]) {
  const ref = useRef<HTMLDivElement>(null)
  const [two, setTwo] = useState(false)
  const key = texts.join('\n')
  useLayoutEffect(() => {
    const head = ref.current
    const ruler = head?.querySelector<HTMLElement>('.sb-tools__ruler')
    if (!head || !ruler) return
    const fit = () => {
      const room = head.clientWidth - (parseFloat(getComputedStyle(head).paddingLeft) || 0)
      if (room <= 0) return
      let widest = 0
      for (const text of key.split('\n')) {
        ruler.textContent = text
        widest = Math.max(widest, ruler.getBoundingClientRect().width)
      }
      ruler.textContent = ''
      setTwo(widest > room + 0.5)
    }
    fit()
    const ro = new ResizeObserver(fit)
    ro.observe(head)
    const names = head.parentElement?.querySelector('.sb-tools__names')
    if (names) ro.observe(names)
    return () => ro.disconnect()
  }, [key])
  return { ref, two }
}

/**
 * WERKZEUGE / TOOLS — what a person opens now and then (Agenda … Import), inside the sidebar's `nav` under the daily
 * rows, as ONE strip of keycaps: Agenda · Graph · Agents · Scripts · Patchbay · Building blocks │ Templates · Import
 * (the two after the hairline open a dialog; viewers get neither).
 *
 * The head is a readout: at rest "TOOLS", or what waits most — open fuses, then the agents' proposals, then the
 * Patchbay's NEW ("PATCHBAY · 1 OPEN FUSE"); under the pointer or the focus, that key's name and state. Each key's
 * accessible name carries the same words (a cut "…" in the readout is only looks). The LEDs and counts sit in the keys'
 * corners (Agents' count — hidden while Preflight is on —, the Patchbay's LED / grey "?" through its own key, test ids
 * kept). One Tab stop (the open tool's key, else the first), ← / → / Home / End move along (WAI-ARIA toolbar).
 *
 * NAMES (aria-pressed) turns the strip into today's labelled rows — per device, localStorage `one.shell.tools` =
 * { mode: 'keys' | 'list', phoneOpen }. A coarse pointer (iPad docked, a phone) shows the keys as a labelled 4 × 2 grid
 * of ≥ 44 px keys (no hover there) — sidebar.css.
 */
import { useRef, useState, type FocusEvent, type KeyboardEvent, type PointerEvent, type ReactNode } from 'react'
import { Bot, CalendarClock, LayoutTemplate, Shapes, SquareCode, Upload, Waypoints } from 'lucide-react'
import { useUI } from '../../store/ui'
import { navigate, useRoute } from '../../lib/router'
import { AgentsNavBadge, PatchbayNavRow, useAgentsAttention, usePatchbayCounts, usePatchbaySeen, usePreflightOn } from '../../features'
import { useT } from '../../i18n'
import { closeMobileSidebar } from '../lib/actions'
import { useLocalPref } from '../lib/hooks'
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
  active: boolean
  /** its state in words (a count, NEW) — after the name in the readout and in the key's accessible name */
  state: string[]
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
  const go = (fn: () => void) => () => {
    closeMobileSidebar()
    fn()
  }
  const pbTitle = t(`${P}.title`)
  const pbState = [
    fuses > 0 ? t(fuses === 1 ? `${P}.nav.fuses.one` : `${P}.nav.fuses`, { n: fuses }) : unknown > 0 ? t(unknown === 1 ? `${P}.nav.unknown.one` : `${P}.nav.unknown`, { n: unknown }) : '',
    seen ? '' : t(`${P}.new`),
  ].filter(Boolean)
  const tools: Tool[] = [
    { id: 'agenda', icon: <CalendarClock size={16} />, label: t('shell.nav.agenda'), active: route.name === 'agenda', state: [], onClick: go(() => navigate({ name: 'agenda' })) },
    { id: 'graph', icon: <Waypoints size={16} />, label: t('shell.nav.graph'), active: route.name === 'graph', state: [], onClick: go(() => navigate({ name: 'graph' })) },
    {
      id: 'agents',
      icon: <Bot size={16} />,
      label: t('features.agents.title'),
      active: route.name === 'agents',
      state: agents ? [t('features.agents.navReview', { n: agents })] : [],
      badge: preflightOn ? undefined : <AgentsNavBadge />,
      onClick: go(() => navigate({ name: 'agents' })),
    },
    { id: 'scripts', icon: <SquareCode size={16} />, label: t('features.script.title'), active: route.name === 'scripts', state: [], onClick: go(() => navigate({ name: 'scripts' })) },
    // the Patchbay draws its own key (its LED, "?", NEW and test ids — features/patchbay)
    { id: 'patchbay', icon: null, label: pbTitle, active: route.name === 'patchbay', state: pbState, onClick: () => {} },
    { id: 'kit', icon: <Shapes size={16} />, label: t('features.kit.title'), active: route.name === 'kit', state: [], onClick: go(() => navigate({ name: 'kit' })) },
    ...(readOnly
      ? []
      : ([
          { id: 'templates', icon: <LayoutTemplate size={16} />, label: t('shell.nav.templates'), active: false, state: [], dialog: true, onClick: go(() => useUI.getState().openModal({ type: 'templates', parentId: null })) },
          { id: 'import', icon: <Upload size={16} />, label: t('shell.nav.import'), active: false, state: [], dialog: true, onClick: go(() => useUI.getState().openModal({ type: 'import' })) },
        ] as Tool[])),
  ]
  const said = (x: Tool) => [x.label, ...x.state].join(' · ')

  // at rest: what waits most — open fuses, then proposals, then NEW — else the strip's name
  const urgent = fuses > 0 ? said(tools.find((x) => x.id === 'patchbay')!) : agents > 0 ? said(tools.find((x) => x.id === 'agents')!) : !seen ? t('shell.tools.readoutNew', { tool: pbTitle }) : null
  const [pointed, setPointed] = useState<number | null>(null)
  const [focused, setFocused] = useState<number | null>(null)
  const hot = pointed ?? focused
  const readout = pref.mode === 'keys' && hot !== null && tools[hot] ? said(tools[hot]) : (urgent ?? t('shell.tools.title'))

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
    <div className="sb-tools__head" aria-hidden data-hot={pref.mode === 'keys' && hot !== null ? '' : undefined} data-urgent={hot === null && urgent ? '' : undefined}>
      <span className="sb-tools__readout">{readout}</span>
      <span className="sb-sect__leader" />
    </div>
  )

  if (pref.mode === 'list')
    return (
      <div className="sb-tools" data-mode="list">
        {head}
        <div className="sb-tools__list" role="group" aria-label={t('shell.tools.title')}>
          {tools.map((x) => (x.id === 'patchbay' ? <PatchbayNavRow key={x.id} active={x.active} /> : <NavRow key={x.id} icon={x.icon} label={x.label} active={x.active} badge={x.badge} onClick={x.onClick} />))}
        </div>
        {names}
      </div>
    )

  return (
    <div className="sb-tools" data-mode="keys">
      {head}
      <div
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
              <PatchbayNavRow active={x.active} variant="key" keyProps={keyProps(i)} />
            ) : (
              <button type="button" className="sb-tool" data-active={x.active || undefined} aria-current={x.active ? 'page' : undefined} onClick={x.onClick} {...keyProps(i)}>
                <span className="sb-tool__icon" aria-hidden>
                  {x.icon}
                </span>
                <span className="sb-tool__label">{x.label}</span>
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

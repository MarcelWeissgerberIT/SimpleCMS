/**
 * #/patchbay — the page (a lazy chunk, route.tsx; plan §3.3). The head (HeaderMenu.tsx), the readout strip, and the
 * bench: the rack (Rack.tsx — modules, net flags, folds, bus chips, the cable layer, the legend) or, where the rack
 * would not be readable, the strands view (Strands.tsx): below 880 px × the text size, or once a module's name box fell
 * under ~12ch (measured) — so XL text, a 1024 / 1280 window and an open Outbox dock or AI terminal all stay readable.
 * The empty rack (no cable at all) says so in one sentence with "New agent" / "New automation" (Empty.tsx).
 *
 * Opening the page reads the expensive inputs (state.ts openModel, via the live signal's startLive — ref-counted, B13)
 * and rebuilds as they arrive, and as the workspace changes under it (once per frame, through the input memo); the layout is seeded with this device's previous row order (layout.ts loadOrder) and the
 * order of a whole-rack layout is kept for the next visit. The numbers the page computed are published for the sidebar
 * LED and ⌘K (counts.ts; B8 adds the idle computation after first paint, so the LED knows before the first visit).
 *
 * `m` (a module key) selects that module — unfolding its fold, or the automation a single-use script is folded into —
 * and gives it the keyboard once it is on the rack (the strands view: its strand's name key, the card marked; a module
 * without a strand: the line or the "Not processed" name that names it); nothing to land on → the h1 and a word why.
 * `f` (a fuse's path key) does what F does, once per link: selects that fuse, gives its tab (strands: its card) the
 * keyboard, brings it into view and says so — a model rebuilt later never snaps the selection back. The same link
 * opened again while it shows (open.ts onPatchbayAsk) acts again. Esc or a click on the empty bench clears the selection.
 *
 * Keys on the page (§3.9, B7; focus in the page or nowhere — the body, the main region a click on plain text leaves it
 * on — nobody typing): J opens the jack picker (JackPicker.tsx — ↵ puts the
 * keyboard on that jack, Esc gives it back to where J was pressed); F selects the next open fuse in F-order, gives the
 * keyboard to its tab (B8's `[data-pb-fuse-tab]`) and brings it into view. The arrow keys, ↵ and Space live on the rack
 * (Rack.tsx, Module.tsx); "§ In plain words" sits under the rack (Plain.tsx). Announcements go to one polite region.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useLang, useT } from '../../../i18n'
import { navigate } from '../../../lib/router'
import { focusIsNowhere, focusLost, restoreFocus } from '../../../ui/focus'
import { typing } from '../../../ui/keys'
import { useCloud } from '../../../cloud'
import { useWorkspace } from '../../../store/store'
import { openIntegrations } from '../../agents'
import { fuseCounts } from '../fuses'
import { defaultPreset, layoutRack, loadOrder, saveOrder } from '../layout'
import { startLive, useLive } from '../live/live'
import { sumRuns } from '../live/runs'
import { sumCosts } from '../live/costs'
import type { PatchbayRouteProps } from '../route'
import { patchbayScope } from '../scope'
import { noteShownFuse, onPatchbayAsk } from '../open'
import { refreshModel, usePatchbay } from '../state'
import type { FilterPreset, FuseState, Model, ModuleKey } from '../types'
import { Empty } from './Empty'
import { FuseArea } from './FuseList'
import { activeGlyph, fuseRowsOf } from './fuseRows'
import { Header, type HeadKeys } from './HeaderMenu'
import { JackPicker, pickerRows, type PickerRow } from './JackPicker'
import { litByHover, litByJack, litByNet, litBySelection } from './lit'
import { openPicture } from './picture'
import { Rack } from './Rack'
import { markSeen } from './seen'
import type { RackCtx } from './RackContext'
import { Readout } from './Readout'
import { Plain } from './Plain'
import { announce, openFold, resetPbUI, selectFuse, selectModule, usePbUI } from './store'
import { Strands } from './Strands'
import { fuseMarks, useWords, type Words } from './words'
import '../patchbay.css'

const P = 'features.patchbay'
/** The rack needs this much width (× the text size); below it the strands view takes over (§6 U14). */
const RACK_MIN = 880
/** Below this (× the text size) the readout keeps RUNS TODAY and FUSE only (§3.8). */
const PHONE_MAX = 600

/** "Fuse F1 selected — Mails · new row → Inbox-Helfer → …": what F and a `?f=` link say. */
function fuseSaid(f: FuseState, model: Model, words: Words): string {
  const path = [f.chain.source, f.chain.decider, ...f.chain.steps.map((x) => x.from)]
    .filter((k, j, all): k is string => !!k && all.indexOf(k) === j)
    .map((k) => model.modules.find((m) => m.key === k))
    .filter((m): m is NonNullable<typeof m> => !!m)
    .map((m) => words.name(m))
  return words.t(`${P}.fuse.selected`, { f: f.label, path: path.join(' → ') })
}

/** Is the keyboard on the page — in it, or nowhere (the body, the main region a click on plain text leaves it on)? */
const keysHere = (page: HTMLElement | null, at: Element | null): boolean => !!page && (focusIsNowhere(at) || (!!at && page.contains(at)))

const textScale = (): number => {
  try {
    return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--text-scale')) || 1
  } catch {
    return 1
  }
}

export default function Patchbay(props: PatchbayRouteProps) {
  const t = useT()
  const lang = useLang() as 'en' | 'de'
  const h1 = useRef<HTMLHeadingElement>(null)
  const pageRef = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(0)
  const [tightAt, setTightAt] = useState<number | null>(null)
  const say = usePbUI((s) => s.say)
  const tight = usePbUI((s) => s.tight)
  // a link the page already shows, opened again (the same hash): act again
  const [ask, setAsk] = useState(0)
  useEffect(() => onPatchbayAsk(() => setAsk((n) => n + 1)), [])
  // the jack picker: open at the element J was pressed on (the keyboard goes back there on Esc)
  const [picker, setPicker] = useState<HTMLElement | null>(null)

  // the live signal (B13) holds the model open: the lazy inputs are read and the model rebuilt as they arrive
  useEffect(() => startLive(), [])
  // the workspace changed under the page (an agent saved, a path allowed, a server switched on): the input is read again
  // once per frame — the memo answers with the same input (nothing rebuilt) unless the wiring signature moved
  useEffect(() => {
    let frame = 0
    const soon = () => {
      if (!frame) frame = requestAnimationFrame(() => {
        frame = 0
        refreshModel()
      })
    }
    const stopWs = useWorkspace.subscribe(soon)
    const stopCloud = useCloud.subscribe(soon)
    return () => {
      stopWs()
      stopCloud()
      if (frame) cancelAnimationFrame(frame)
    }
  }, [])
  useEffect(() => {
    markSeen()
    return () => resetPbUI()
  }, [])

  // the keyboard lands on the title — only when nobody has it (⌘K, a link, a lamp left it nowhere)
  useEffect(() => {
    let id = requestAnimationFrame(() => {
      id = requestAnimationFrame(() => {
        if (focusIsNowhere() && !props.m) h1.current?.focus({ preventScroll: true })
      })
    })
    return () => cancelAnimationFrame(id)
  }, [props.m])

  const model = usePatchbay((s) => s.model)
  const input = usePatchbay((s) => s.input)
  const live = useLive(useShallow((s) => ({ runs: s.runs, costs: s.costs, costsRead: s.costsRead, modules: s.modules })))
  const words = useWords(model, input)
  const ui = usePbUI(useShallow((s) => ({ hover: s.hover, selected: s.selected, net: s.net, filter: s.filter, unfolded: s.unfolded, cursor: s.cursor, jack: s.jack, fuse: s.fuse })))
  const readOnly = useCloud((s) => s.readOnly)
  const marks = useMemo(() => (model ? fuseMarks(model) : null), [model])

  // the width the page has (the strands threshold, the head's tiers)
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [])

  const scale = width ? textScale() : 1
  const narrow = width > 0 && (width < RACK_MIN * scale || (tightAt !== null && width <= tightAt))
  const phone = width > 0 && width < PHONE_MAX * scale

  const fuses = useMemo(() => (model ? fuseCounts(model as never) : { open: 0, allowed: 0, unknown: 0 }), [model])
  const filter: FilterPreset | null = model ? (ui.filter === 'auto' ? defaultPreset(model, fuses.open) : ui.filter) : null
  const running = useMemo(() => Object.entries(live.modules).filter(([, v]) => v.state === 'running').map(([k]) => k as ModuleKey), [live.modules])
  const [prev] = useState(() => loadOrder(patchbayScope()))
  const layout = useMemo(() => (model ? layoutRack(model, { prev, filter, running, fuses: model.fuses, unfolded: ui.unfolded }) : null), [model, prev, filter, running, ui.unfolded])

  // the order of a whole rack is this device's for the next visit (a filtered one would put the rest at the bottom)
  useEffect(() => {
    if (layout && !layout.filter && !layout.band) saveOrder(patchbayScope(), layout.order)
  }, [layout])

  // LED = lamp = readout: the counts are published where the model is built (state.ts), the page's and the background's

  const lit = useMemo(() => {
    if (!model) return null
    if (ui.selected && model.modules.some((m) => m.key === ui.selected)) return litBySelection(model, ui.selected)
    if (ui.net) return litByNet(model, ui.net)
    if (ui.jack) return litByJack(model, ui.jack)
    if (ui.hover) return litByHover(model, ui.hover)
    return null
  }, [model, ui.selected, ui.net, ui.jack, ui.hover])

  // a module's name box under ~12ch with its own tiers spent (its jack labels short, then gone — Module.tsx): the rack
  // is not readable here — the strands view takes over at this width and below
  useLayoutEffect(() => {
    if (tight > 0 && !narrow && width > 0) setTightAt(width)
  }, [tight, narrow, width])
  // a wider window: measure again
  useEffect(() => {
    if (tightAt !== null && width > tightAt + 40) setTightAt(null)
  }, [width, tightAt])

  // the fuse the page shows (⌘K "next fuse" goes on from it, open.ts)
  const shownFuse = model ? activeGlyph(fuseRowsOf(model), ui.fuse) : null
  useEffect(() => noteShownFuse(shownFuse), [shownFuse])
  useEffect(() => () => noteShownFuse(null), [])

  // ?m= — select that module (unfold its fold; a folded script is its automation's) and give it the keyboard. Done when
  // the keyboard landed on it — a fold the auto filter closed meanwhile is opened again, the next frame tries again; and
  // while the link names it, a later "Fuse paths only" of its own (the lazy inputs pass 30 modules) never folds it away
  // under the person: its fold opens again and, the keyboard lost with it, it takes the keyboard back
  const landedM = useRef<string | null>(null)
  useEffect(() => {
    const want = props.m
    if (!want || !model || !layout || !words) return
    const token = `${want}|${ask}`
    const landed = landedM.current === token
    let key: ModuleKey | null = model.modules.some((x) => x.key === want) ? want : null
    if (!key && want.startsWith('script:')) {
      const id = decodeURIComponent(want.slice('script:'.length))
      key = model.modules.find((x) => x.folds?.script === id)?.key ?? null
    }
    const nowhere = () => {
      landedM.current = token
      if (focusIsNowhere() || pageRef.current?.contains(document.activeElement)) h1.current?.focus({ preventScroll: true })
      announce(t(`${P}.notOnRack`))
    }
    if (!key) return landed ? undefined : nowhere()
    if (!narrow) {
      const fold = layout.slots.find((s) => s.kind === 'fold' && !s.open && s.modules.includes(key!))
      if (fold && (!landed || usePbUI.getState().filter === 'auto')) {
        openFold(fold.id)
        return
      }
    }
    const target = key
    if (landed) {
      const back = requestAnimationFrame(() => {
        const el = narrow ? null : pageRef.current?.querySelector<HTMLElement>(`.pb-mod[data-key="${CSS.escape(target)}"]`)
        if (el && focusLost()) el.focus({ preventScroll: true })
      })
      return () => cancelAnimationFrame(back)
    }
    if (usePbUI.getState().selected !== target) selectModule(target)
    let tries = 0
    let frame = 0
    const land = () => {
      const page = pageRef.current
      if (!page) return
      const esc = CSS.escape(target)
      const el = narrow
        ? (page.querySelector<HTMLElement>(`.pb-strand[data-key="${esc}"] .pb-strand__open`) ??
          page.querySelector<HTMLElement>(`.pb-strands__restn[data-key="${esc}"]`) ??
          page.querySelector<HTMLElement>(`.pb-line[data-key="${esc}"]`))
        : page.querySelector<HTMLElement>(`.pb-mod[data-key="${esc}"]`)
      if (el) {
        el.scrollIntoView({ block: 'center', behavior: 'auto' })
        el.focus({ preventScroll: true })
        if (document.activeElement === el) {
          landedM.current = token
          const m = model.modules.find((x) => x.key === target)
          if (m) announce(t(`${P}.selected`, { name: words.name(m) }))
          return
        }
      }
      if (++tries < 12) frame = requestAnimationFrame(land)
      else nowhere()
    }
    frame = requestAnimationFrame(land)
    return () => cancelAnimationFrame(frame)
  }, [props.m, ask, model, layout, words, narrow, t])

  // ?f= — what F does, once per link (a model rebuilt later never snaps the selection back): the fuse selected, its tab
  // (strands: its card) given the keyboard and brought into view, said
  const pickedF = useRef<string | null>(null)
  const landedF = useRef<string | null>(null)
  useEffect(() => {
    const f = props.f
    if (!f || !model || !words) return
    const token = `${f}|${ask}`
    if (landedF.current === token) return
    const fuse = (model.fuses as FuseState[]).find((x) => x.key === f)
    if (!fuse) return
    if (pickedF.current !== token) {
      pickedF.current = token
      selectFuse(f)
    }
    let tries = 0
    let frame = 0
    const land = () => {
      const page = pageRef.current
      const tab = page?.querySelector<HTMLElement>(`[data-pb-fuse-tab="${CSS.escape(f)}"]`)
      if (tab) {
        landedF.current = token
        const plate = narrow ? tab : (page?.querySelector<HTMLElement>('#pb-fuse-plate') ?? tab)
        plate.scrollIntoView({ block: 'nearest', behavior: 'auto' })
        tab.focus({ preventScroll: true })
        announce(fuseSaid(fuse, model, words))
        return
      }
      if (++tries < 20) frame = requestAnimationFrame(land)
      else landedF.current = token
    }
    frame = requestAnimationFrame(land)
    return () => cancelAnimationFrame(frame)
  }, [props.f, ask, model, words, narrow])

  // Esc: the selection goes (never the keyboard: focus stays where it is)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || typing()) return
      const s = usePbUI.getState()
      if (!s.selected && !s.net) return
      if (!keysHere(pageRef.current, document.activeElement)) return
      if (document.activeElement?.closest('[data-popover], [role="dialog"]')) return
      selectModule(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  /** Select a fuse and bring its plate (the strands view: its card) into view (no plate: its glyph). */
  const showFuse = useCallback((key: string) => {
    selectFuse(key)
    const plate = pageRef.current?.querySelector(`.pb-fcard[data-pb-fuse-tab="${CSS.escape(key)}"]`) ?? document.getElementById('pb-fuse-plate')
    if (plate) plate.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    else pageRef.current?.querySelector(`.pb-fuse[data-fuse="${CSS.escape(key)}"]`)?.scrollIntoView({ block: 'nearest' })
  }, [])
  const onFuse = useCallback(() => {
    if (marks?.open.length) showFuse(marks.open[0].key)
  }, [marks, showFuse])

  // F: the next open fuse (F-order, wrapping) — its tab takes the keyboard (B8), it comes into view, it is announced
  const nextFuse = useCallback(() => {
    if (!model || !marks || !words) return
    const open = marks.open
    if (!open.length) {
      announce(t(`${P}.fuse.noneOpen`))
      return
    }
    const cur = usePbUI.getState().fuse
    const i = open.findIndex((f) => f.key === cur)
    const next = open[(i + 1) % open.length]
    showFuse(next.key)
    const tab = document.querySelector<HTMLElement>(`[data-pb-fuse-tab="${CSS.escape(next.key)}"]`)
    if (tab) tab.focus({ preventScroll: true })
    announce(fuseSaid(next, model, words))
  }, [model, marks, words, t, showFuse])

  // J and F (focus in the page, nobody typing, no menu / dialog open over it)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return
      const k = e.key.toLowerCase()
      if (k !== 'j' && k !== 'f') return
      const page = pageRef.current
      const at = document.activeElement
      if (!page || typing() || !keysHere(page, at)) return
      if (at?.closest('[data-popover], [role="dialog"]')) return
      // J finds a jack on the rack (the strands view has none)
      if (k === 'j' && !page.querySelector('.pb-rack')) return
      e.preventDefault()
      if (k === 'f') nextFuse()
      // from nowhere the picker hangs at the rack's tab stop (Esc gives the keyboard there), else at the h1
      else setPicker(at instanceof HTMLElement && page.contains(at) ? at : (page.querySelector<HTMLElement>('.pb-rack [data-stop][tabindex="0"]') ?? h1.current))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [nextFuse])

  const rows = useMemo(() => (picker && model && layout && words ? pickerRows(model, layout, words) : []), [picker, model, layout, words])
  const closePicker = (why: 'escape' | 'outside') => {
    const from = picker
    setPicker(null)
    // Esc: the keyboard goes back to where J was pressed; a press outside leaves it where the press put it
    requestAnimationFrame(() => {
      if (from?.isConnected && (why === 'escape' || focusLost() || focusIsNowhere())) restoreFocus(from)
    })
  }
  const pickJack = (row: PickerRow) => {
    setPicker(null)
    const focusJack = (tries: number) => {
      const el = pageRef.current?.querySelector<HTMLElement>(`.pb-jk[data-jack="${CSS.escape(row.jack)}"]`)
      if (el) {
        el.focus({ preventScroll: true })
        el.scrollIntoView({ block: 'center', inline: 'nearest' })
        announce(t(`${P}.picker.found`, { jack: el.getAttribute('aria-label') ?? row.name }))
        return
      }
      if (tries > 0) requestAnimationFrame(() => focusJack(tries - 1))
    }
    if (row.folded) {
      const fold = layout?.slots.find((x) => x.kind === 'fold' && !x.open && x.modules.includes(row.module))
      if (fold) openFold(fold.id)
    }
    requestAnimationFrame(() => focusJack(12))
  }

  const keys: HeadKeys = {
    asList: () => navigate({ name: 'workspace', section: 'automation' }),
    picture: model && words ? (from) => openPicture(model, words, from) : null,
    drop: readOnly ? null : () => openIntegrations(),
  }

  const runs = useMemo(() => (model ? sumRuns({ n: live.runs }, model.modules.map((m) => m.key)) : 0), [model, live.runs])
  const money = useMemo(() => (model ? sumCosts(live.costs, model.modules.map((m) => m.key)) : { usd: 0, estimate: false, unpriced: 0 }), [model, live.costs])
  // the rack's one tab stop: where the keyboard was last, else the selection, else the first module
  const onRack = (id: string | null) => !!id && !!layout?.slots.some((s) => s.id === id)
  const entry = onRack(ui.cursor) ? ui.cursor : onRack(ui.selected) ? ui.selected : (layout?.slots.find((s) => s.kind === 'module')?.id ?? null)
  const ctx: RackCtx | null = model && input && words && marks ? { model, input, words, marks, lit, runs: live.runs, costs: live.costs, entry } : null
  const profiles = layout?.profiles ?? []

  return (
    <div className="pb" ref={pageRef} data-testid="patchbay-page" data-view={narrow ? 'strands' : 'rack'}>
      <Header ref={h1} t={t} input={input} filter={filter} profiles={profiles} hasFuses={!!marks?.open.length} keys={keys} width={width} />
      {model && (
        <Readout t={t} lang={lang} model={model} runs={runs} money={money} costsRead={live.costsRead} fuses={fuses} phone={phone} onFuse={onFuse} />
      )}
      {ctx && layout && (model!.edges.length === 0 ? <Empty model={model!} input={input!} words={words!} layout={layout} drop={keys.drop} /> : narrow ? <Strands model={model!} input={input!} words={words!} marks={marks!} runs={live.runs} running={running} /> : <Rack ctx={ctx} layout={layout} onFuse={showFuse} />)}
      {ctx && layout && !narrow && model!.edges.length > 0 && <FuseArea model={model!} input={input!} words={words!} />}
      {ctx && layout && !narrow && model!.edges.length > 0 && <Plain model={model!} input={input!} words={words!} />}
      {picker && words && <JackPicker anchor={picker} rows={rows} t={words.t} onPick={pickJack} onClose={closePicker} />}
      {/* 12 characters of a module's name: the narrowest name box the rack accepts (measured, never guessed) */}
      <span className="pb-probe" aria-hidden="true" />
      <div className="visually-hidden" role="status" aria-live="polite" aria-label={t(`${P}.liveRegion`)} data-testid="pb-live">
        <span key={say.n}>{say.text}</span>
      </div>
    </div>
  )
}

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
 * and gives it the keyboard; `f` (a fuse's path key) selects that fuse (its plate is B8's). Esc or a click on the empty
 * bench clears the selection.
 */
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useLang, useT } from '../../../i18n'
import { navigate } from '../../../lib/router'
import { focusIsNowhere } from '../../../ui/focus'
import { typing } from '../../../ui/keys'
import { useCloud } from '../../../cloud'
import { useWorkspace } from '../../../store/store'
import { openIntegrations } from '../../agents'
import { setPatchbayCounts } from '../counts'
import { fuseCounts } from '../fuses'
import { defaultPreset, layoutRack, loadOrder, saveOrder } from '../layout'
import { startLive, useLive } from '../live/live'
import { sumRuns } from '../live/runs'
import { sumCosts } from '../live/costs'
import type { PatchbayRouteProps } from '../route'
import { patchbayScope } from '../scope'
import { refreshModel, usePatchbay } from '../state'
import type { FilterPreset, ModuleKey } from '../types'
import { Empty } from './Empty'
import { Header, type HeadKeys } from './HeaderMenu'
import { litByHover, litByNet, litBySelection } from './lit'
import { openPicture } from './picture'
import { Rack } from './Rack'
import { markSeen } from './seen'
import type { RackCtx } from './RackContext'
import { Readout } from './Readout'
import { openFold, resetPbUI, selectFuse, selectModule, usePbUI } from './store'
import { Strands } from './Strands'
import { fuseMarks, useWords } from './words'
import '../patchbay.css'

const P = 'features.patchbay'
/** The rack needs this much width (× the text size); below it the strands view takes over (§6 U14). */
const RACK_MIN = 880
/** Below this (× the text size) the readout keeps RUNS TODAY and FUSE only (§3.8). */
const PHONE_MAX = 600

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
  const [say, setSay] = useState('')

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
  const ui = usePbUI(useShallow((s) => ({ hover: s.hover, selected: s.selected, net: s.net, filter: s.filter, unfolded: s.unfolded })))
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

  // LED = readout: the numbers this page computed (B8 computes them in idle before the first visit too)
  useEffect(() => {
    if (!model || !marks) return
    const open = [...marks.open].sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)))
    setPatchbayCounts({ ...fuses, ready: true, ...(open[0] ? { first: open[0].key } : {}) })
  }, [model, marks, fuses])

  const lit = useMemo(() => {
    if (!model) return null
    if (ui.selected && model.modules.some((m) => m.key === ui.selected)) return litBySelection(model, ui.selected)
    if (ui.net) return litByNet(model, ui.net)
    if (ui.hover) return litByHover(model, ui.hover)
    return null
  }, [model, ui.selected, ui.net, ui.hover])

  // a module's name box under ~12ch: the rack is not readable here — the strands view takes over at this width and below
  useLayoutEffect(() => {
    const el = pageRef.current
    if (!el || narrow || !layout) return
    const probe = el.querySelector<HTMLElement>('.pb-probe')
    const min = probe?.offsetWidth ?? 0
    if (!min) return
    for (const b of el.querySelectorAll<HTMLElement>('.pb-mod__body')) {
      if (b.clientWidth > 0 && b.clientWidth < min) {
        setTightAt(width)
        return
      }
    }
  }, [width, narrow, layout, words])
  // a wider window: measure again
  useEffect(() => {
    if (tightAt !== null && width > tightAt + 40) setTightAt(null)
  }, [width, tightAt])

  // ?m= — select that module (unfold its fold; a folded script is its automation's) and give it the keyboard
  const handled = useRef<string | null>(null)
  useEffect(() => {
    const want = props.m
    if (!want || !model || !layout || !words || handled.current === want) return
    let key: ModuleKey | null = model.modules.some((x) => x.key === want) ? want : null
    if (!key && want.startsWith('script:')) {
      const id = decodeURIComponent(want.slice('script:'.length))
      key = model.modules.find((x) => x.folds?.script === id)?.key ?? null
    }
    if (!key) {
      handled.current = want
      setSay(t(`${P}.notOnRack`, { name: want }))
      return
    }
    const fold = layout.slots.find((s) => s.kind === 'fold' && !s.open && s.modules.includes(key!))
    if (fold) {
      openFold(fold.id)
      return
    }
    handled.current = want
    selectModule(key)
    const target = key
    requestAnimationFrame(() => {
      const el = pageRef.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(target)}"]`)
      if (!el) return
      el.scrollIntoView({ block: 'center', behavior: 'auto' })
      el.focus({ preventScroll: true })
      const m = model.modules.find((x) => x.key === target)
      if (m) setSay(t(`${P}.selected`, { name: words.name(m) }))
    })
  }, [props.m, model, layout, words, t])

  // ?f= — that fuse is selected (its plate: B8)
  useEffect(() => {
    if (props.f && model?.fuses.some((x) => x.key === props.f)) selectFuse(props.f)
  }, [props.f, model])

  // Esc: the selection goes (never the keyboard: focus stays where it is)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || typing()) return
      const s = usePbUI.getState()
      if (!s.selected && !s.net) return
      if (!pageRef.current?.contains(document.activeElement) && document.activeElement !== document.body) return
      selectModule(null)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const onFuse = useCallback(() => {
    if (!marks?.open.length) return
    const first = [...marks.open].sort((a, b) => Number(a.label.slice(1)) - Number(b.label.slice(1)))[0]
    selectFuse(first.key)
    const plate = document.getElementById('pb-fuse-plate')
    if (plate) plate.scrollIntoView({ block: 'nearest', behavior: 'smooth' })
    else pageRef.current?.querySelector('.pb-mod[data-path]')?.scrollIntoView({ block: 'nearest' })
  }, [marks])

  const keys: HeadKeys = {
    asList: () => navigate({ name: 'workspace', section: 'automation' }),
    picture: model && words ? (from) => openPicture(model, words, from) : null,
    drop: readOnly ? null : () => openIntegrations(),
  }

  const runs = useMemo(() => (model ? sumRuns({ n: live.runs }, model.modules.map((m) => m.key)) : 0), [model, live.runs])
  const money = useMemo(() => (model ? sumCosts(live.costs, model.modules.map((m) => m.key)) : { usd: 0, estimate: false, unpriced: 0 }), [model, live.costs])
  const entry = ui.selected ?? (layout?.slots.find((s) => s.kind === 'module')?.id ?? null)
  const ctx: RackCtx | null = model && input && words && marks ? { model, input, words, marks, lit, runs: live.runs, costs: live.costs, entry } : null
  const profiles = layout?.profiles ?? []

  return (
    <div className="pb" ref={pageRef} data-testid="patchbay-page" data-view={narrow ? 'strands' : 'rack'}>
      <Header ref={h1} t={t} input={input} filter={filter} profiles={profiles} hasFuses={!!marks?.open.length} keys={keys} width={width} />
      {model && (
        <Readout t={t} lang={lang} model={model} runs={runs} money={money} costsRead={live.costsRead} fuses={fuses} phone={phone} onFuse={onFuse} />
      )}
      {ctx && layout && (model!.edges.length === 0 ? <Empty model={model!} input={input!} words={words!} layout={layout} drop={keys.drop} /> : narrow ? <Strands model={model!} words={words!} marks={marks!} runs={live.runs} /> : <Rack ctx={ctx} layout={layout} />)}
      {/* 12 characters of a module's name: the narrowest name box the rack accepts (measured, never guessed) */}
      <span className="pb-probe" aria-hidden="true" />
      <div className="visually-hidden" role="status" aria-live="polite" aria-label={t(`${P}.liveRegion`)} data-testid="pb-live">
        {say}
      </div>
    </div>
  )
}

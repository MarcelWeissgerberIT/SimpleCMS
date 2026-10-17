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
 *
 * B12 — the profile drop and the setup (plan §1.12, §3.7): a `.integration.json` dropped anywhere on the page, the head's
 * chip (a file, Paste) — DropFlow.tsx; the visit where a profile was dropped or "Set up in the Patchbay" pressed shows
 * its band (setup/record.ts: the visit, and the record `<scope>|setup` this device keeps): the model with the recipe's
 * ghosts and planned cables (setup/merge.ts), the band and the lamps on the rack (or the card in the strands view), what
 * the profile does not touch folded; later visits show the one-line strip (SetupStrip.tsx) above the normal rack, the
 * ghosts dotted in place. The visit ends when the page closes — unless a setup step left it (the way back is set then).
 *
 * B16 — patching (P4, plan §1.13, §2.9, §3.9): the head's Patching switch (this device's; off by default, hidden for
 * viewers, read-only members and the strands view). On: a press on a jack that moves pulls a cable (PatchDrag.tsx), a
 * click / tap or J on a jack opens "Connect to …" (ConnectPicker.tsx), Delete / Backspace on a jack unplugs it; each
 * patch is planned (the editors' checks first), asked once at the target jack where it asks ("+F2" — PatchPop.tsx) and
 * written with a toast and its Undo (patchRun.ts; Mod+Z on the route takes back the newest key, drop or patch). Off: J
 * still finds jacks, nothing else patches.
 */
// B17: first — its module marks the chunk's arrival (the first rack paint is measured from there)
import { useRackPaint } from './paintMark'
import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { useShallow } from 'zustand/react/shallow'
import { useLang, useT } from '../../../i18n'
import { navigate } from '../../../lib/router'
import { focusIsNowhere, focusLost, restoreFocus } from '../../../ui/focus'
import { typing } from '../../../ui/keys'
import { useCloud } from '../../../cloud'
import { useWorkspace } from '../../../store/store'
import { fuseCounts } from '../fuses'
import { defaultPreset, layoutRack, loadOrder, saveOrder } from '../layout'
import { startLive, useLive } from '../live/live'
import { announcementText } from '../live/announce'
import { sumRuns } from '../live/runs'
import { sumCosts } from '../live/costs'
import type { PatchbayRouteProps } from '../route'
import { patchbayScope } from '../scope'
import { noteShownFuse, onPatchbayAsk } from '../open'
import { refreshModel, usePatchbay } from '../state'
import type { FilterPreset, FuseState, Model, ModuleKey } from '../types'
import { Empty } from './Empty'
import { FuseArea } from './FuseList'
import { UndoKeysHost } from './FuseKeys'
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
import { announce, announceRun, openFold, resetPbUI, selectFuse, selectModule, usePbUI } from './store'
import { Strands } from './Strands'
import { countOf, fuseMarks, useWords, type Words, type WordsExtra } from './words'
import { useSetupLamps } from '../setup/facts'
import { setOf } from '../setup/lamps'
import { ghostsOf } from '../setup/ghosts'
import { withGhosts, withProfileModules } from '../setup/merge'
import { moduleKey } from '../ref'
import { lampNo } from '../setup/keys'
import { focusLampKey } from '../setup/focus'
import { readReturn } from '../setup/return'
import { endSetupVisit, loadSetupRecord, markSetupVisit, pickRecipe, setupVisit, useSetupRecord } from '../setup/record'
import { closeSetup, dropUndoAt, dropUndoOpen, endDrop, noteLamps, useDrop } from '../setup/drop'
import { DropChip, DropPlate, runDropUndo, useDropFlow } from './DropFlow'
import { DropZone, useDragZone } from './DropZone'
import { PasteProfile } from './PasteProfile'
import { BandHead, SetupCard, SetupPlate, type BandInfo } from './SetupBand'
import { SetupStrip } from './SetupStrip'
import { OrdersBand } from './OrdersBand'
import { usePlateWordsOf } from './plateParts'
import { lastPatch, setPatching, usePatchSwitch } from '../patching'
import { resetPatchUI, setPick, usePatchUI } from './patchUI'
import { pickChoice, runPatchUndo, startPatch, unplugJack } from './patchRun'
import { ConnectPicker } from './ConnectPicker'
import { PatchPop } from './PatchPop'
import { scrollBehavior } from './motion'
import type { PatchPointer } from './PatchDrag'
import '../patchbay.css'

const P = 'features.patchbay'
/** No step chips (a profile without a recipe: nothing to make on the rack). */
const NO_CHIPS: Record<ModuleKey, number[]> = Object.freeze({}) as Record<ModuleKey, number[]>

/** The rack needs this much width (× the text size); below it the strands view takes over (§6 U14). */
const RACK_MIN = 880
/** Below this (× the text size) the readout keeps RUNS TODAY and FUSE only (§3.8). */
const PHONE_MAX = 600
/** B16: the jacks' keys while patching (their description). */
const PATCH_KEYS = { keysId: 'pb-patch-keys' }
/** What Mod+Z on the route takes back besides the keys (newest first): the profile drop (B12), a patch (B16). */
const UNDO_EXTRAS = [
  { at: dropUndoAt, run: () => void runDropUndo() },
  { at: () => lastPatch()?.at ?? null, run: (pw: Parameters<typeof runPatchUndo>[0]) => void runPatchUndo(pw) },
]

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
    return () => {
      resetPbUI()
      resetPatchUI()
    }
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

  const base = usePatchbay((s) => s.model)
  const input = usePatchbay((s) => s.input)
  // B17: the first bench painted after the chunk / after this visit's first render (User Timing, the perf spec); what
  // lies below the bench (the fuse list and plate, "§ In plain words") mounts in the frame after it
  const painted = useRackPaint(!!base)
  const live = useLive(useShallow((s) => ({ runs: s.runs, costs: s.costs, costsRead: s.costsRead, modules: s.modules })))
  const ui = usePbUI(useShallow((s) => ({ hover: s.hover, selected: s.selected, net: s.net, filter: s.filter, unfolded: s.unfolded, cursor: s.cursor, jack: s.jack, fuse: s.fuse })))
  const readOnly = useCloud((s) => s.readOnly)

  // ---- B12: the setup — the visit's band (a drop, "Set up in the Patchbay") or the strip of a setup this device keeps
  useEffect(() => void loadSetupRecord(), [])
  // the visit ends with the page — unless a setup step left it (the way back names that profile): back, it goes on
  useEffect(
    () => () => {
      const v = setupVisit()
      const back = readReturn()
      if (v && back && back.profileId === v.profileId) return
      endSetupVisit()
      // fix mid: the drop's Undo lives only as long as its visit (a later visit never offers it)
      endDrop()
    },
    [],
  )
  const setupRec = useSetupRecord()
  const integrations = useWorkspace((s) => s.integrations)
  const there = (id: string | undefined | null) => !!id && !!integrations?.some((p) => p.id === id)
  const visit = setupRec.visit && there(setupRec.visit.profileId) ? setupRec.visit : null
  const kept = setupRec.rec && !setupRec.rec.closed && there(setupRec.rec.profileId) ? setupRec.rec : null
  const setupId = visit?.profileId ?? kept?.profileId ?? null
  const bandOn = !!visit
  const existing = useMemo(() => (base ? new Set(base.modules.map((m) => m.key)) : undefined), [base])
  const lamps = useSetupLamps(setupId, existing ? { existing } : {})
  const set = lamps ? setOf(lamps.sets, visit?.recipeId ?? kept?.recipeId ?? null) : null
  const recipe = lamps && set ? (lamps.profile.recipes.find((r) => r.recipeId === set.recipe) ?? null) : null
  const plan = useMemo(() => (recipe && setupId && base ? ghostsOf(setupId, recipe, { existing, edges: new Set(base.edges.map((e) => e.id)) }) : null), [recipe, setupId, base, existing])
  const ghosted = useMemo(() => (base ? withGhosts(base, plan) : null), [base, plan])
  // fix mid: a profile without a recipe (lamps 00–03, §6 U26) has no ghosts — the servers it matches are its modules in
  // the band (never folded under "Not touched by the profile")
  const ownServers = useMemo(() => (bandOn && !plan && lamps ? lamps.facts.servers.map((x) => moduleKey({ kind: 'server', id: x.id, name: x.name })) : null), [bandOn, plan, lamps])
  const model = useMemo(() => (ghosted && ownServers && setupId ? withProfileModules(ghosted, setupId, ownServers) : ghosted), [ghosted, ownServers, setupId])
  const extra = useMemo<WordsExtra | null>(() => (plan ? { names: plan.names, chips: plan.chips } : null), [plan])
  const words = useWords(model, input, extra)
  const marks = useMemo(() => (model ? fuseMarks(model) : null), [model])
  const pw = usePlateWordsOf(model, input, words)
  const drop = useDrop((s) => s.done)
  // the drop's Undo is over once a lamp that was not green after the drop turns green (§6 U4)
  useEffect(() => {
    if (setupId && lamps) noteLamps(setupId, lamps.sets)
  }, [setupId, lamps])
  // a lamp turning green while the page shows it: said politely ("04 done · 05 next")
  const lastNext = useRef<{ id: string | null; n: number | null }>({ id: null, n: null })
  useEffect(() => {
    if (!set || !setupId) return
    const prev = lastNext.current
    const now = set.next?.n ?? null
    lastNext.current = { id: `${setupId}|${set.recipe}`, n: now }
    if (prev.id !== `${setupId}|${set.recipe}` || prev.n === null || prev.n === now) return
    const was = set.lamps.find((l) => l.n === prev.n)
    if (was?.state !== 'ok') return
    announce(now === null ? t(`${P}.setup.arrivedAll`) : t(`${P}.setup.arrived`, { done: lampNo(prev.n), next: lampNo(now) }))
  }, [set, setupId, t])
  const [bandOpen, setBandOpen] = useState(false)
  useEffect(() => setBandOpen(false), [setupId, bandOn])
  const flow = useDropFlow(t)
  const [chipAt, setChipAt] = useState<HTMLElement | null>(null)
  const zone = useDragZone(pageRef, flow.onFiles, true)

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

  // B16 — patching: this device's switch, the person's rights (never a viewer or a read-only member), the rack (the
  // strands view has no jacks)
  const patchOn = usePatchSwitch((s) => s.on)
  const canPatch = !!input && !input.ctx.readOnly && input.ctx.role !== 'viewer'
  const patching = patchOn && canPatch && !narrow
  const pick = usePatchUI((s) => s.pick)
  const pop = usePatchUI((s) => s.pop)
  // switched off (or the rights or the view went): nothing of a patch in flight stays
  useEffect(() => {
    if (!patching) resetPatchUI()
  }, [patching])

  const fuses = useMemo(() => (model ? fuseCounts(model as never) : { open: 0, allowed: 0, unknown: 0 }), [model])
  const filter: FilterPreset | null = model ? (ui.filter === 'auto' ? defaultPreset(model, fuses.open) : ui.filter) : null
  const running = useMemo(() => Object.entries(live.modules).filter(([, v]) => v.state === 'running').map(([k]) => k as ModuleKey), [live.modules])
  const [prev] = useState(() => loadOrder(patchbayScope()))
  // the drop visit: the band holds the profile's modules, the rest folds below it (until ↵ unfolds the whole rack)
  const partition = bandOn && !bandOpen && !!setupId
  const layout = useMemo(() => (model ? layoutRack(model, { prev, filter, running, fuses: model.fuses, unfolded: ui.unfolded, setup: partition ? { profile: setupId! } : null }) : null), [model, prev, filter, running, ui.unfolded, partition, setupId])

  // the order of a whole rack is this device's for the next visit (a filtered one would put the rest at the bottom; a
  // setup's ghosts are no modules of it yet)
  useEffect(() => {
    if (layout && !layout.filter && !layout.band && !model?.counts.ghosts) saveOrder(patchbayScope(), layout.order)
  }, [layout, model])

  // LED = lamp = readout: the counts are published where the model is built (state.ts), the page's and the background's

  // B14 — runs said politely (§1.7, §6 U6): the live core throttles them (one per module per 10 s, one per 3 s overall,
  // a start and an end per run — never the ticking timer); the page says each new one once in its polite region. What
  // was said before this page mounted is not said again.
  const said = useLive((s) => s.announce)
  const saidId = useRef<number | null>(useLive.getState().announce?.id ?? null)
  useEffect(() => {
    if (!said || said.id === saidId.current || !model || !words) return
    saidId.current = said.id
    const m = model.modules.find((x) => x.key === said.module)
    // B17: after the person's own words had their time (a deep link's "… selected" is never cut off)
    if (m) announceRun(announcementText(said, words.name(m), t))
  }, [said, model, words, t])

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
    if (!fuse) {
      // fix ui-words: a link to a fuse this device does not show open (closed or changed meanwhile, or only visible in
      // another member's browser) is said — once the inputs had a moment (a lazy reading may still bring it). Its path
      // almost open now: that grey row is selected and its tab takes the keyboard.
      const near = fuseRowsOf(model).byKey.get(`n:${f}`)
      const timer = window.setTimeout(() => {
        landedF.current = token
        if (near) {
          selectFuse(near.key)
          requestAnimationFrame(() => {
            const tab = pageRef.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(near.key)}"]`)
            if (tab) {
              tab.scrollIntoView({ block: 'nearest', behavior: 'auto' })
              tab.focus({ preventScroll: true })
            }
          })
          announce(t(`${P}.fuse.nearNow`))
          return
        }
        if (focusIsNowhere() || pageRef.current?.contains(document.activeElement)) h1.current?.focus({ preventScroll: true })
        announce(t(`${P}.fuse.notHere`))
      }, 1200)
      return () => window.clearTimeout(timer)
    }
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
  }, [props.f, ask, model, words, narrow, t])

  // Esc: the selection goes (never the keyboard: focus stays where it is). One rung per press (§3.9, fix ui-words): heard
  // on the document after the page's own keys (a drag, a jack, a popover, an asking key take it first and stop it) and
  // before the shell's window listener — a press that deselects is taken (preventDefault), so the recorder deck, focus
  // mode or the side peek do not close with it
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || e.defaultPrevented || typing()) return
      const s = usePbUI.getState()
      if (!s.selected && !s.net) return
      if (!keysHere(pageRef.current, document.activeElement)) return
      if (document.activeElement?.closest('[data-popover], [role="dialog"]')) return
      e.preventDefault()
      selectModule(null)
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  /** Select a fuse and bring its plate (the strands view: its card) into view (no plate: its glyph). */
  const showFuse = useCallback((key: string) => {
    selectFuse(key)
    const plate = pageRef.current?.querySelector(`.pb-fcard[data-pb-fuse-tab="${CSS.escape(key)}"]`) ?? document.getElementById('pb-fuse-plate')
    if (plate) plate.scrollIntoView({ block: 'nearest', behavior: scrollBehavior() })
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

  // J and F (focus in the page, nobody typing, no menu / dialog open over it); B16 with patching on: J on a jack opens
  // "Connect to …", Delete / Backspace on a jack unplugs it
  const patchRef = useRef<{ on: boolean; model: Model | null; input: typeof input; pw: typeof pw }>({ on: false, model: null, input: null, pw: null })
  patchRef.current = { on: patching, model, input, pw }
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || e.repeat) return
      const k = e.key.toLowerCase()
      const del = k === 'delete' || k === 'backspace'
      if (k !== 'j' && k !== 'f' && !del) return
      const page = pageRef.current
      const at = document.activeElement
      if (!page || typing() || !keysHere(page, at)) return
      if (at?.closest('[data-popover], [role="dialog"]')) return
      const jack = at instanceof HTMLElement && at.matches('.pb-jk[data-jack]') && page.contains(at) ? at : null
      const pr = patchRef.current
      if (del) {
        if (!jack || !pr.on || !pr.model || !pr.input || !pr.pw) return
        e.preventDefault()
        unplugJack(jack, pr.model, pr.input, pr.pw)
        return
      }
      // J finds a jack on the rack (the strands view has none)
      if (k === 'j' && !page.querySelector('.pb-rack')) return
      e.preventDefault()
      if (k === 'f') nextFuse()
      // patching: J on a jack connects it
      else if (jack && pr.on) setPick({ jack: jack.dataset.jack!, anchor: jack })
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
    // the drop chip: hidden while a band is on (and for viewers)
    drop: readOnly || bandOn ? null : (from) => setChipAt(from),
    patch:
      canPatch && !narrow
        ? {
            on: patchOn,
            set: (on) => {
              setPatching(on)
              announce(t(on ? `${P}.patch.onSay` : `${P}.patch.offSay`))
            },
          }
        : null,
  }
  // the rack's pointer while patching: a drop plans the patch at the jack it landed on, a click / tap opens the picker
  const pointer = useMemo<PatchPointer | null>(
    () =>
      patching && model && input && pw
        ? {
            model,
            input,
            drop: (patch, anchor, source) => startPatch(patch, { anchor, source }, pw),
            pick: (el) => setPick({ jack: el.dataset.jack!, anchor: el }),
            say: { start: (jack) => t(`${P}.patch.dragSay`, { jack }), cancelled: t(`${P}.patch.cancelled`) },
          }
        : null,
    [patching, model, input, pw, t],
  )
  const closeConnect = (why: 'escape' | 'outside') => {
    const from = pick?.anchor
    setPick(null)
    requestAnimationFrame(() => {
      if (from?.isConnected && (why === 'escape' || focusLost() || focusIsNowhere())) restoreFocus(from)
    })
  }
  const closeChip = () => {
    const from = chipAt
    setChipAt(null)
    requestAnimationFrame(() => {
      if (from?.isConnected && focusLost()) restoreFocus(from)
    })
  }

  // the band: its tab, its Undo (until the first lamp write) or "Close setup", the lamps, the fold line
  const profile = setupId ? integrations?.find((p) => p.id === setupId) : undefined
  const info: BandInfo | null =
    setupId && profile
      ? {
          profileId: setupId,
          profileName: profile.name,
          ...(visit?.file ? { file: visit.file } : {}),
          // the drop's Undo only in the visit the drop opened (never "Show the whole setup" later, never another visit)
          undo: drop && drop.profileId === setupId && dropUndoOpen(drop) ? { open: drop.open, team: drop.team, replaced: drop.before?.name ?? null } : null,
        }
      : null
  const onCloseSetup = () => {
    if (!setupId) return
    closeSetup(setupId)
    announce(t(`${P}.setup.closedSay`))
    requestAnimationFrame(() => requestAnimationFrame(() => (pageRef.current?.querySelector<HTMLElement>('[data-testid="pb-drop"]') ?? h1.current)?.focus()))
  }
  // "Show the whole setup" (the strip): the strip goes, the band comes — its next lamp's key takes the keyboard (the
  // page's one primary key), else the h1 (fix ui-words: never the body)
  const onOpenSetup = () => {
    if (!setupId) return
    const next = set?.next ?? null
    markSetupVisit(setupId)
    const fallback = () => {
      if (focusLost() || focusIsNowhere()) h1.current?.focus()
    }
    if (next) void focusLampKey(next, { profile: setupId }).then((ok) => !ok && fallback())
    else requestAnimationFrame(() => requestAnimationFrame(fallback))
  }
  const onPick = (id: string) => setupId && pickRecipe(setupId, id)
  // the setup's facts come from the lamps (a profile without a recipe has no plan, but its lamps and card all the same)
  const setupFacts = useMemo(() => {
    if (!set) return null
    const fields: Record<ModuleKey, number> = {}
    const dbGhost = plan?.modules.find((m) => m.kind === 'database' && m.tags.includes('ghost'))
    if (dbGhost && recipe?.database.fields !== undefined) fields[dbGhost.key] = recipe.database.fields
    return { chips: plan?.chips ?? NO_CHIPS, next: set.next?.n ?? null, fields }
  }, [plan, set, recipe])
  const untouched = layout?.band ? { modules: layout.band.untouched.length, cables: layout.band.cables } : { modules: 0, cables: 0 }

  const runs = useMemo(() => (model ? sumRuns({ n: live.runs }, model.modules.map((m) => m.key)) : 0), [model, live.runs])
  const money = useMemo(() => (model ? sumCosts(live.costs, model.modules.map((m) => m.key)) : { usd: 0, estimate: false, unpriced: 0 }), [model, live.costs])
  // the rack's one tab stop: where the keyboard was last, else the selection, else the first module
  const onRack = (id: string | null) => !!id && !!layout?.slots.some((s) => s.id === id)
  const entry = onRack(ui.cursor) ? ui.cursor : onRack(ui.selected) ? ui.selected : (layout?.slots.find((s) => s.kind === 'module')?.id ?? null)
  const ctx: RackCtx | null = model && input && words && marks ? { model, input, words, marks, lit, runs: live.runs, costs: live.costs, entry, setup: setupFacts, patching: patching ? PATCH_KEYS : null } : null
  const profiles = layout?.profiles ?? []

  return (
    <div className="pb" ref={pageRef} data-testid="patchbay-page" data-view={narrow ? 'strands' : 'rack'}>
      <Header ref={h1} t={t} input={input} filter={filter} profiles={profiles} hasFuses={!!marks?.open.length} keys={keys} width={width} />
      {model && (
        <Readout t={t} lang={lang} model={model} runs={runs} money={money} costsRead={live.costsRead} fuses={fuses} phone={phone} onFuse={onFuse} setup={set && setupId ? { done: set.done, total: set.lamps.length, band: bandOn } : null} />
      )}
      <DropPlate t={t} flow={flow} />
      {setupId && !bandOn && set && <SetupStrip t={t} profileId={setupId} set={set} onOpen={onOpenSetup} onClose={onCloseSetup} />}
      {/* Orders B10: the work orders' band — while a work-orders database exists, or opened from Settings › Coding worker */}
      {input && (props.orders || !!input.orders?.length) && <OrdersBand input={input} t={t} lang={lang} />}
      <div className="pb-benchwrap">
        {ctx &&
          layout &&
          // the empty rack's sentence — not in a setup's visit: its band (or card) and lamps show on the rack instead
          (model!.edges.length === 0 && !bandOn ? (
            <Empty model={model!} input={input!} words={words!} layout={layout} drop={keys.drop} />
          ) : narrow ? (
            <Strands
              model={model!}
              input={input!}
              words={words!}
              marks={marks!}
              runs={live.runs}
              running={running}
              setup={
                setupFacts
                  ? {
                      chips: setupFacts.chips,
                      next: setupFacts.next,
                      card: bandOn && info && set && lamps ? <SetupCard t={t} lang={lang} info={info} sets={lamps.sets} set={set} recipes={lamps.profile.recipes} onPick={onPick} onUndo={() => void runDropUndo()} onClose={onCloseSetup} /> : null,
                      band: bandOn && layout.band ? { untouched: layout.band.untouched } : null,
                    }
                  : null
              }
            />
          ) : (
            <Rack
              ctx={ctx}
              layout={layout}
              onFuse={showFuse}
              patching={pointer}
              band={
                bandOn && info && set && lamps
                  ? {
                      head: <BandHead t={t} info={info} onUndo={() => void runDropUndo()} onClose={onCloseSetup} />,
                      plate: <SetupPlate t={t} lang={lang} profileId={info.profileId} sets={lamps.sets} set={set} recipes={lamps.profile.recipes} onPick={onPick} />,
                      aria: t(`${P}.band.aria`, { name: info.profileName, g: countOf(t, 'ghosts', model!.counts.ghosts), p: countOf(t, 'planned', model!.counts.planned) }),
                      folded: !bandOpen,
                      onToggle: () => setBandOpen(!bandOpen),
                      untouched,
                      undo: !!info.undo?.open,
                    }
                  : null
              }
            />
          ))}
        <DropZone t={t} kind={zone} />
      </div>
      {painted && ctx && layout && !narrow && model!.edges.length > 0 && <FuseArea model={model!} input={input!} words={words!} />}
      {painted && ctx && layout && !narrow && model!.edges.length > 0 && <Plain model={model!} input={input!} words={words!} />}
      {picker && words && <JackPicker anchor={picker} rows={rows} t={words.t} onPick={pickJack} onClose={closePicker} />}
      {patching && pick && model && input && pw && (
        <ConnectPicker key={`${pick.jack}|${pick.only ?? ''}`} anchor={pick.anchor} jack={pick.jack} only={pick.only} model={model} input={input} pw={pw} onPick={(c) => pickChoice(c, { el: pick.anchor, key: pick.jack }, pw)} onClose={closeConnect} />
      )}
      {patching && pop && pw && <PatchPop pop={pop} pw={pw} />}
      {patching && (
        <p id={PATCH_KEYS.keysId} className="visually-hidden">
          {t(`${P}.patch.jackKeys`)}
        </p>
      )}
      {model && input && words && <UndoKeysHost page={pageRef} model={model} input={input} words={words} extra={UNDO_EXTRAS} />}
      <input
        ref={flow.fileRef}
        type="file"
        accept=".json,application/json"
        className="visually-hidden"
        tabIndex={-1}
        aria-hidden="true"
        onChange={(e) => {
          flow.onFiles(e.currentTarget.files)
          e.currentTarget.value = ''
        }}
        data-testid="pb-drop-input"
      />
      <DropChip t={t} anchor={chipAt} onClose={closeChip} flow={flow} />
      <PasteProfile t={t} flow={flow} />
      {/* 12 characters of a module's name: the narrowest name box the rack accepts (measured, never guessed) */}
      <span className="pb-probe" aria-hidden="true" />
      <div className="visually-hidden" role="status" aria-live="polite" aria-label={t(`${P}.liveRegion`)} data-testid="pb-live">
        <span key={say.n}>{say.text}</span>
      </div>
    </div>
  )
}

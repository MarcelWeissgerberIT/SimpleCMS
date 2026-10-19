/**
 * One module on the rack (plan §3.3 anatomy, §3.9 semantics): `[in jacks] [body] [window] [out jacks]`, a 2U agent with
 * its read-only knobs row. The body is the kind line (LED · mono label · tags · net tags · "F1"), the name and a mono
 * sub-line; the window a plain chip (runs today on this device) — or, live (B14, LiveWin.tsx), the LCD of a run in
 * flight ("RUNNING 0:04 · $0.21"), a clock's "07:30:00 FIRED", a database's "+3 FOR REVIEW", "! FAILED" / "HELD" /
 * "! BUDGET" after a run, with the LED to match (a run's blinks ≤ 5 s). Four corner screws.
 *
 * Semantics: a focusable `role="group"` ("module"), labelled kind + name, described by its strand sentence (plain.ts
 * describe), `aria-keyshortcuts="Enter Space J"`; never a button. Pointer grammar (§6 U5): hover lights its cables in
 * ink; a click selects it (its chains light, the rest dims) and shows "Open ↵"; a double-click or that key opens its
 * editor. The keyboard: ↵ opens, Space selects without scrolling (its Klartext sentence lights in place), the arrows rove
 * (Rack.tsx — the module is one stop, `data-stop`, of a single tab stop); its jacks take the keyboard only through J.
 *
 * Variants: `data-path` (on an open fuse's path: the dashed signal frame — the only orange frame), blocked (hatched),
 * unknown here (a grey "?"), 2U (`data-u="2"`), dimmed while another module is selected; a ghost (B12, `data-ghost`: a
 * module a setup lamp will make — dotted ink-3 edge, no screws, its lamps' step chips "04" (the one worked on now in
 * ink), the window "not created" / a database's "24 fields").
 */
import { memo, useLayoutEffect, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent, type RefObject } from 'react'
import { CornerDownLeft } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { fmtUsd as fmt } from '../../../lib/money'
import { typing } from '../../../ui/keys'
import type { Module as ModuleT, ModelInput } from '../types'
import { runningOrderCount } from '../../coding'
import { buttonLabelIn } from './buttonLabel'
import { fuseGroupLabel } from '../render'
import { useFitTier } from './fit'
import { Jack } from './Jack'
import { edgesAt } from './lit'
import { canOpen, openModule } from './open'
import { useRack } from './RackContext'
import { benchPainted, onBenchPainted, useBenchPainted } from './paintMark'
import { lampNo } from '../setup/keys'
import { announce, noteTight, selectModule, setCursor, setHover, usePbUI } from './store'
import { hasLiveWindow, ledOf, LiveLed, LiveWindow, useModuleLive } from './LiveWin.tsx'
import { useDragOver, useModuleAccept } from './patchUI'

const P = 'features.patchbay'

/** A button block's label, read from its page (the model keeps ids only). */
function useButtonLabel(m: ModuleT): string | null {
  const ref = m.ref.kind === 'button' ? m.ref : null
  return useWorkspace((s) => (ref ? buttonLabelIn(s.pages[ref.page]?.content, ref.block) : null))
}

/**
 * The jack labels' tier (plan §3.3, §6 U14): 0 = full ("EVERYTHING · 4 DB"), 1 = short ("4 DB", "OUT 1"), 2 = none (the
 * jack's title and name keep the words). While the name box is narrower than the page's 12ch probe — or the kind line
 * would cut a mode tag below its word (`squeeze`: the labels give way before a tag does) — the next tier is tried
 * before the frame is painted; a module whose last tier still leaves the name under 12ch is "tight" — the page
 * then shows the strands view (noteTight). Another width or other words start again at 0. Measured, never guessed.
 */
function useJackFit(mod: RefObject<HTMLElement | null>, body: RefObject<HTMLElement | null>, max: number, content: string, key: string, squeeze: boolean): number {
  const [tier, setTier] = useState(0)
  const width = useRef(0)
  useLayoutEffect(() => setTier(0), [content])
  useLayoutEffect(() => {
    const el = mod.current
    if (!el) return
    width.current = el.clientWidth
    const ro = new ResizeObserver(() => {
      if (el.clientWidth === width.current) return
      width.current = el.clientWidth
      setTier(0)
    })
    ro.observe(el)
    return () => {
      ro.disconnect()
      noteTight(key, false)
    }
  }, [mod, key])
  useLayoutEffect(() => {
    const b = body.current
    if (!b || b.clientWidth === 0) return
    const min = b.closest('.pb')?.querySelector<HTMLElement>('.pb-probe')?.offsetWidth ?? 0
    const narrow = min > 0 && b.clientWidth < min
    // the name would be cut ("Every weekday at 0…" beside a FIRED window — fix ui-words): the jack labels give way first
    const n = b.querySelector<HTMLElement>('.pb-mod__n')
    const cut = !!n && n.clientWidth > 0 && n.scrollWidth > n.clientWidth + 1
    // `squeeze`: the kind line would cut a mode tag below its word — the jack labels give way first
    if ((narrow || squeeze || cut) && tier < max) setTier(tier + 1)
    else noteTight(key, narrow)
  })
  return tier
}

/** A net chip the kind line shrank below its first whole word ("MA…"): the fit lets it go (never a stub of a word). */
function netCut(row: HTMLElement): boolean {
  const t = row.querySelector<HTMLElement>('.pb-net__t')
  const word = row.querySelector<HTMLElement>('.pb-net__w')
  if (!t || !word || t.offsetWidth === 0) return false
  return t.scrollWidth > t.clientWidth + 1 && t.clientWidth + 1 < word.offsetWidth
}

function Knob({ v, ticks, label, value, onOpen, title }: { v: number; ticks: number; label: string; value: string; onOpen: () => void; title: string }) {
  const ang = (x: number) => ((-135 + 270 * x) * Math.PI) / 180
  const a = ang(v)
  return (
    <button type="button" className="pb-knob" onClick={onOpen} title={title} tabIndex={-1}>
      <svg viewBox="-12 -12 24 24" aria-hidden="true">
        {Array.from({ length: ticks }, (_, i) => {
          const tv = ticks === 1 ? 0.5 : i / (ticks - 1)
          const ta = ang(tv)
          return <line key={i} x1={Math.sin(ta) * 10.2} y1={-Math.cos(ta) * 10.2} x2={Math.sin(ta) * 12} y2={-Math.cos(ta) * 12} className={Math.abs(tv - v) < 0.001 ? 'pb-k-tick pb-k-tick--on' : 'pb-k-tick'} />
        })}
        <circle r="8.6" className="pb-k-face" />
        <circle r="5.6" className="pb-k-cap" />
        <line x1={Math.sin(a) * 2} y1={-Math.cos(a) * 2} x2={Math.sin(a) * 7.6} y2={-Math.cos(a) * 7.6} className="pb-k-ptr" />
      </svg>
      <span className="pb-knob__t">
        <span className="label">{label}</span>
        <b>{value}</b>
      </span>
    </button>
  )
}

/** B17: the module a mouse entered before the bench was painted — it lights once the bench is painted (none at a visit's end). */
let enteredEarly: ModuleT['key'] | null = null
onBenchPainted((on) => {
  const key = enteredEarly
  enteredEarly = null
  if (on && key) setHover(key)
})

/**
 * B17: a module's screen-reader description (its paths, fuses and runs in words) is written once the bench was painted
 * (paintMark.ts) — a frame later, not part of the first rack's work; the selected module's at once (a deep link lands
 * the keyboard on it in the first frames, its description is read then).
 */
function Describe({ m, now }: { m: ModuleT; now: boolean }) {
  const { words: w } = useRack()
  const painted = useBenchPainted()
  return painted || now ? <>{w.describe(m)}</> : null
}

function ModuleView({ m, row, span, descId }: { m: ModuleT; row: number; span: 1 | 2; descId: string }) {
  const { model, input, words: w, marks, lit, runs, costs, entry, setup, patching } = useRack()
  // B16: a drag lights this module when a jack of it it may plug into is not drawn yet (it takes the drop)
  const accept = useModuleAccept(m.key)
  const dropOver = useDragOver(m.key, true)
  const t = w.t
  const selected = usePbUI((s) => s.selected === m.key)
  const ref = useRef<HTMLDivElement>(null)
  const buttonLabel = useButtonLabel(m)
  const fuses = marks.modules.get(m.key) ?? []
  const name = w.name(m)
  const kind = w.kind(m)
  const sub = m.ref.kind === 'button' ? null : w.sub(m)
  const tags = w.tags(m)
  const unknown = m.tags.includes('unknownHere')
  const blocked = !!m.blocked || m.tags.includes('blocked')
  // why it cannot run (plan §3.3: "blocked: … + reason line", "unknown here: … the one-line reason")
  const blockedWhy = m.blocked ? t(`${P}.blocked.${m.blocked}`) : null
  // a pipeline whose worker is offline is off (grey); too old or unsafe: amber — its word in the window
  const worker = w.worker(m)
  const off = m.idle || blocked || unknown || m.tags.includes('disabled') || m.tags.includes('byHand') || m.tags.includes('ghost') || worker?.led === 'off'
  const dim = !!lit && lit.mode !== 'hover' && !lit.modules.has(m.key)
  const isLit = !!lit && lit.modules.has(m.key)
  const n = runs[m.key] ?? 0
  const cost = costs[m.key]
  // a profile's setup: the lamps that make or touch it ("01" "02" on its server, "04" on what lamp 04 makes)
  const ghost = m.tags.includes('ghost')
  const steps = setup?.chips[m.key] ?? []
  const fields = setup?.fields[m.key]
  const ghostWin = ghost ? (fields !== undefined ? t(fields === 1 ? `${P}.ghost.fields.one` : `${P}.ghost.fields`, { n: fields }) : m.kind === 'agent' ? t(`${P}.tag.ghost`) : null) : null
  // B14 — the live signal: the LED of a run in flight (blinking ≤ 5 s) or of its end's lamp, the window's reading
  const live = useModuleLive(m, model)
  const led = ghost ? null : ledOf(live)
  const liveWin = !ghost && hasLiveWindow(live, t, w.lang)

  // "Whole workspace" and a server known only at run time have no editor here: ↵ says so (and is not offered)
  const open = () => {
    if (canOpen(m)) openModule(m, ref.current)
    else announce(t(`${P}.openNothing`))
  }
  const onClick = (e: MouseEvent) => {
    if ((e.target as Element).closest('button')) return
    e.stopPropagation()
    selectModule(m.key)
  }
  const onKeyDown = (e: KeyboardEvent<HTMLDivElement>) => {
    if (e.target !== e.currentTarget || typing() || e.altKey || e.ctrlKey || e.metaKey) return
    if (e.key === 'Enter') {
      e.preventDefault()
      open()
    } else if (e.key === ' ') {
      // Space selects in place — never a scroll (its Klartext strand lights where it is, Plain.tsx)
      e.preventDefault()
      toggle()
    }
  }
  const toggle = () => {
    const on = usePbUI.getState().selected !== m.key
    selectModule(on ? m.key : null)
    if (on) announce(t(`${P}.selected`, { name }))
  }
  const jackKeys = {
    open,
    select: toggle,
    back: () => ref.current?.focus(),
  }
  const roleLabel = t(`${P}.a11y.jack`)
  const onEnter = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    // B17: not before the bench was painted (lighting it re-renders the whole rack inside the first frame) — the module
    // the mouse is over then lights once the bench is painted
    if (benchPainted()) setHover(m.key)
    else enteredEarly = m.key
  }
  const onLeave = (e: PointerEvent) => {
    if (e.pointerType !== 'mouse') return
    if (enteredEarly === m.key) enteredEarly = null
    if (usePbUI.getState().hover === m.key) setHover(null)
  }

  // reads without a cable — "everything" is said by the EVERYTHING jack already
  const readNets = m.nets.filter((x) => !('everything' in x.place))
  const nets = readNets.slice(0, 1)
  const moreNets = readNets.length - nets.length
  // the kind line never wraps: the net chip goes first, then the mode tags shorten, then they go — the kind, "?" and
  // the F tags stay (what went is in the module's description and the chip's title)
  // (the profile's id goes with them) … and last, the F tags fold into one group chip ("F2 · F3 · F4 +1", the glyph's
  // rule), then into the shortest ("F2 +4") — every label stays in the chip's title and in the description, never clipped
  const kRef = useRef<HTMLDivElement>(null)
  const fit = useFitTier(kRef, fuses.length > 1 ? 5 : 3, `${w.lang}|${kind}|${tags.map((x) => x.text).join()}|${readNets.length}|${fuses.join()}|${m.profile ?? ''}|${steps.join()}`, netCut)
  const fuseTitles = fuses.map((f) => t(`${P}.tag.fuseTitle`, { f })).join(' · ')
  // the jack labels give way before the rack does (a narrow name box): short, then none
  const bodyRef = useRef<HTMLDivElement>(null)
  const jackLabels = [...m.inJacks, ...m.outJacks].map((j) => w.jack(j, m)).filter(Boolean)
  const jfit = useJackFit(ref, bodyRef, jackLabels.length ? 2 : 0, `${w.lang}|${jackLabels.join()}|${n}|${worker?.word ?? ''}|${liveWin ? (live.entry?.state ?? 'fired') : ''}`, m.key, fit >= 2)
  const knobs = m.u === 2 && m.knobs
  const model1 = knobs ? w.knobModel(m) : null
  const budget = knobs ? w.knobBudget(m) : null

  return (
    <div
      ref={ref}
      className="pb-mod"
      role="group"
      aria-roledescription={t(`${P}.a11y.module`)}
      aria-label={`${kind} ${buttonLabel ?? name}`}
      aria-describedby={descId}
      aria-keyshortcuts={canOpen(m) ? 'Enter Space J' : 'Space J'}
      tabIndex={entry === m.key ? 0 : -1}
      data-stop={m.key}
      data-key={m.key}
      data-kind={m.kind}
      data-u={m.u}
      data-path={fuses.length ? '' : undefined}
      data-selected={selected || undefined}
      data-dim={dim || undefined}
      data-lit={isLit || undefined}
      data-blocked={blocked || undefined}
      data-unknown={unknown || undefined}
      data-jfit={jfit || undefined}
      data-ghost={ghost || undefined}
      data-live={led ?? undefined}
      data-paccept={accept || undefined}
      data-pover={dropOver || undefined}
      data-testid="pb-module"
      style={{ gridColumn: m.col * 2 - 1, gridRow: `${row + 1} / span ${span}` }}
      onClick={onClick}
      onDoubleClick={open}
      onKeyDown={onKeyDown}
      onFocus={(e) => e.target === e.currentTarget && setCursor(m.key)}
      onPointerEnter={onEnter}
      onPointerLeave={onLeave}
    >
      <i className="pb-sc pb-sc--tl" aria-hidden="true" />
      <i className="pb-sc pb-sc--tr" aria-hidden="true" />
      <i className="pb-sc pb-sc--bl" aria-hidden="true" />
      <i className="pb-sc pb-sc--br" aria-hidden="true" />
      <div className="pb-mod__in">
        {m.inJacks.map((j) => (
          <Jack key={j.key} jack={j} label={w.jack(j, m, jfit)} title={w.jackTitle(j, m, w.peers(j.key))} roleLabel={roleLabel} keys={jackKeys} patching={patching} lit={!!lit && edgesAt(model, j.key).some((e) => lit.edges.has(e.id))} />
        ))}
      </div>
      <div className="pb-mod__body" ref={bodyRef}>
        <div className="pb-mod__k" ref={kRef} data-fit={fit || undefined}>
          {led ? <LiveLed led={led} live={live} /> : <span className={`led${off ? '' : worker?.led === 'warn' ? ' pb-led--warn' : ' pb-led--ok'}`} aria-hidden="true" />}
          <span className="label pb-mod__kind">{kind}</span>
          {steps.map((s) => (
            <span key={s} className="pb-step" data-next={setup?.next === s || undefined} title={t(`${P}.ghost.step`, { n: lampNo(s) })} data-testid="pb-step">
              {lampNo(s)}
            </span>
          ))}
          {tags.slice(0, 2).map((x) => (
            <span key={x.tag} className="pb-tag" data-tag={x.tag} title={x.text}>
              {x.text}
            </span>
          ))}
          {unknown && (
            <span className="pb-tag pb-tag--q" title={t(`${P}.tag.unknownTitle`)}>
              ?
            </span>
          )}
          {fuses.map((f) => (
            <span key={f} className="pb-tag pb-tag--f" title={t(`${P}.tag.fuseTitle`, { f })}>
              {f}
            </span>
          ))}
          {fuses.length > 1 && (
            <>
              <span className="pb-tag pb-tag--fg" data-fold="group" title={fuseTitles}>
                {fuseGroupLabel(fuses)}
              </span>
              <span className="pb-tag pb-tag--fg" data-fold="short" title={fuseTitles}>
                {`${fuses[0]} +${fuses.length - 1}`}
              </span>
            </>
          )}
          {/* the profile's id sits on what it matched (the server); the modules it touches carry it in the filter — in a
              setup its lamps' chips stand there instead (the band's tab names the profile) */}
          {m.profile && m.kind === 'server' && steps.length === 0 && (
            <span className="pb-tag" data-tag="profile" title={m.profile.toUpperCase()}>
              {m.profile.toUpperCase()}
            </span>
          )}
          {nets.map((x, i) => {
            const label = w.net(x, m)
            return (
              <span key={i} className="pb-net" data-tainted={x.tainted || undefined} title={m.nets.map((y) => w.netTitle(y, m)).join(' · ')}>
                <span className="pb-net__t">{label}</span>
                {moreNets > 0 && <span className="pb-net__more">{t(`${P}.net.more`, { n: moreNets })}</span>}
                <span className="pb-net__w" aria-hidden="true" data-w={`${label.split(/\s+/)[0]}…`} />
              </span>
            )
          })}
        </div>
        <div className="pb-mod__n" title={buttonLabel ?? name}>
          {m.ref.kind === 'button' && buttonLabel !== null ? (
            <>
              {buttonLabel} <span className="pb-mod__q">{t(`${P}.sub.onPage`, { page: (m.ref.kind === 'button' && input.pages[m.ref.page]?.title.trim()) || t(`${P}.untitled`) })}</span>
            </>
          ) : (
            name
          )}
        </div>
        {blockedWhy ? (
          <div className="pb-mod__s pb-mod__s--why" title={blockedWhy} data-testid="pb-blocked-why">
            {blockedWhy}
          </div>
        ) : m.ref.kind === 'planner' ? (
          <PlannerLamps input={input} db={m.ref.db} t={t} />
        ) : (
          sub && <div className="pb-mod__s">{sub}</div>
        )}
      </div>
      {ghostWin ? (
        <span className="pb-win pb-win--ghost" data-testid="pb-ghost-win">
          {ghostWin}
        </span>
      ) : liveWin ? (
        <LiveWindow m={m} live={live} t={t} lang={w.lang} />
      ) : m.kind === 'planner' ? (
        <PlannerWin n={n} t={t} />
      ) : worker ? (
        <span className="pb-win" data-worker={worker.led} title={worker.title} data-testid="pb-worker">
          {worker.word}
          {n > 0 && <small>{t(`${P}.win.runs`, { n })}</small>}
        </span>
      ) : (
        n > 0 && (
          <span className="pb-win" title={t(n === 1 ? `${P}.win.runsTitle.one` : `${P}.win.runsTitle`, { n })}>
            {t(`${P}.win.runs`, { n })}
            {cost && cost.usd > 0 && <small>{`${cost.estimate ? '≈ ' : ''}${fmt(cost.usd, w.lang)}`}</small>}
          </span>
        )
      )}
      <div className="pb-mod__out">
        {m.outJacks.map((j) => (
          <Jack key={j.key} jack={j} label={w.jack(j, m, jfit)} title={w.jackTitle(j, m, w.peers(j.key))} roleLabel={roleLabel} keys={jackKeys} patching={patching} guessedTitle={t(`${P}.jack.guessed`)} lit={!!lit && edgesAt(model, j.key).some((e) => lit.edges.has(e.id))} />
        ))}
      </div>
      {model1 && budget && (
        <div className="pb-knobs">
          <Knob v={model1.v} ticks={model1.ticks} label={t(`${P}.knob.model`)} value={model1.label} onOpen={open} title={t(`${P}.knob.edit`)} />
          <Knob v={budget.v} ticks={budget.ticks} label={t(`${P}.knob.budget`)} value={budget.label} onOpen={open} title={t(`${P}.knob.edit`)} />
        </div>
      )}
      {selected && canOpen(m) && (
        <button type="button" className="pb-mod__open" onClick={open} title={t(`${P}.openTitle`)} tabIndex={-1} data-testid="pb-open">
          {t(`${P}.open`)}
          <CornerDownLeft size={11} strokeWidth={1.8} aria-hidden="true" />
        </button>
      )}
      <span id={descId} className="visually-hidden">
        <Describe m={m} now={selected} />
      </span>
    </div>
  )
}

export const Module = memo(ModuleView)

/**
 * Orders B10 — the planner's three lamps: CODING (on here) · WORKER (online, up to date) · KONTEXT (OPTIONAL: the
 * server the person picked, tested — none is a valid state: dark, never red). Each says its state in its title.
 */
function PlannerLamps({ input, db, t }: { input: ModelInput; db: string; t: (k: string, v?: Record<string, string | number>) => string }) {
  const o = input.orders?.find((x) => x.db === db)
  const name = o?.config?.server ?? null
  const s = name ? input.servers.find((x) => x.server.name === name) : undefined
  const coding = input.codingOn !== false
  const worker = input.worker.online && input.worker.verdict !== 'unsafe' && input.worker.verdict !== 'outdated'
  const ctx: 'ok' | 'warn' | 'none' = !name ? 'none' : s?.server.enabled && s.state === 'ok' ? 'ok' : 'warn'
  const lamp = (on: boolean, warn: boolean, label: string, state: string, extra?: string) => (
    <span className="pb-plamp" title={`${label} · ${state}`} data-on={on || undefined}>
      <span className={`led${on ? ' pb-led--ok' : warn ? ' pb-led--warn' : ''}`} aria-hidden="true" />
      {label}
      {extra && <small>{extra}</small>}
    </span>
  )
  return (
    <div className="pb-mod__s pb-plamps" data-testid="pb-planner-lamps">
      {lamp(coding, false, t(`${P}.planner.coding`), t(`${P}.planner.${coding ? 'on' : 'off'}`))}
      {lamp(worker, input.worker.online, t(`${P}.planner.worker`), t(`${P}.planner.${worker ? 'on' : input.worker.online ? 'old' : 'off'}`))}
      {lamp(ctx === 'ok', ctx === 'warn', t(`${P}.planner.context`), t(`${P}.planner.${ctx === 'ok' ? 'tested' : ctx === 'warn' ? 'untested' : 'none'}`), t(`${P}.planner.optional`))}
    </div>
  )
}

/** Orders B10 — the planner's window: the chains running now ("2 Ketten laufen"), else its runs today. */
function PlannerWin({ n, t }: { n: number; t: (k: string, v?: Record<string, string | number>) => string }) {
  const chains = useWorkspace((s) => runningOrderCount(s))
  if (!chains && !n) return null
  return (
    <span className="pb-win" data-testid="pb-planner-win">
      {chains ? t(chains === 1 ? `${P}.win.chains.one` : `${P}.win.chains`, { n: chains }) : t(`${P}.win.runs`, { n })}
      {chains > 0 && n > 0 && <small>{t(`${P}.win.runs`, { n })}</small>}
    </span>
  )
}

/**
 * The strands view (plan §3.8, §6 U13 / U14) — what the rack becomes on a phone, and wherever the bench is narrower
 * than 880 px × the text size or a module's name would fall under ~12ch (XL text at 1024 / 1280, an open dock):
 *
 *  - the order is fixed when the page opens (layout.ts strandOrder): the fuse cards (FuseList.tsx FuseCards — then the
 *    grey rows nothing counts), "§ 02 Strands · n" one card per processor by name, then "§ 03 Not processed · n"
 *    naming every other module. Nothing reorders under the finger: a strand that starts running lights IN PLACE and a
 *    chip "running · <name> ↓" jumps to it — it floats at the foot of the view (a zero-height sticky slot that is there
 *    from page open), so its coming and going never moves a card (§6 U13; iOS Safari has no scroll anchoring);
 *  - a strand card: its header (LED, kind, tags, F tags, runs today — a pipeline's worker word when it cannot run), its
 *    name, one line per connection — "from …" / "to …", "can set “…”" / "can open merge requests" where the AI decides
 *    (the rack's dashed cable — the phone has no legend, so the words carry it), "reads …" for every read without a
 *    cable (the rack's net chips); the arrows are decoration, the words carry the direction; content from outside
 *    tagged, a way out with who stands in between — and the knob line in mono (model · budget per run);
 *  - a tap on a card opens its editor (its name is that key for the keyboard); a tap on a line opens that line's module
 *    (a place: its page). No patching here; hit targets ≥ 40 px.
 * `?m=` (Patchbay.tsx) lands on the strand's name key and marks the card (`data-selected`, ink); a module without a
 * strand of its own on a line that names it (`data-key`) or its name under "Not processed".
 *
 * B12 — a profile's setup (§3.8, mock-2): in the drop visit the list is the setup's — the band's card with the lamps
 * one under the other, "§ 01 What gets created" (the recipe's planned processors as dotted strands, their lamps' step
 * chips), "§ 02 Not touched · 8 modules folded" (every name listed; ↵ shows the strands), then the fuse cards. Later
 * visits keep the normal list; a planned strand stays dotted in place.
 */
import { useMemo, useRef, useState, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { navigate } from '../../../lib/router'
import { strandOrder } from '../layout'
import { gitAction } from '../plain'
import type { Model, ModelInput, Module, ModuleKey, Place } from '../types'
import { FuseCards } from './FuseList'
import { edgesAt, moduleOfJack } from './lit'
import { canOpen, openModule } from './open'
import { SLOT, Slotted } from './slot'
import { lampNo } from '../setup/keys'
import { usePbUI } from './store'
import type { FuseMarks, Words } from './words'

const P = 'features.patchbay'

type LineTarget = { kind: 'module'; m: Module } | { kind: 'place'; place: Place; label: string }

interface Line {
  side: 'in' | 'out'
  id: string
  /** the words, SLOT where the name goes ("from {name}", "kann {name} setzen"; none: the words say it all) */
  say: string
  name: string
  target: LineTarget
  /** the module the line names (`?m=` of a module without a strand lands here) */
  key?: ModuleKey
  /** a tag after the words: content from outside (hatched), or who stands before a way out */
  tag?: { text: string; outside?: boolean }
}

/** A field of a place in the language's quotes ("“Weiterleiten”"), else null. */
function fieldOf(p: Place, w: Words): string | null {
  if (!('db' in p) || !p.prop || p.prop === '*' || p.prop === '+row' || p.prop === '-row') return null
  return `${w.t(`${P}.q.open`)}${w.fieldName(p.db, p.prop)}${w.t(`${P}.q.close`)}`
}

/** What a line names, for its key's title. */
const lineName = (l: Line, w: Words): string => l.name || (l.target.kind === 'module' ? w.name(l.target.m) : l.target.label)

/** One line per connection of a processor (deduplicated by what it connects to), then one per read without a cable. */
function linesOf(model: Model, w: Words, m: Module): Line[] {
  const t = w.t
  const byKey = new Map(model.modules.map((x) => [x.key, x]))
  const out: Line[] = []
  const seen = new Set<string>()
  // the databases its starts come from ("from Mails · new row"): a read of them says nothing new
  const fromDbs = new Set<string>()
  const dir = (side: 'in' | 'out') => t(side === 'in' ? `${P}.strands.from` : `${P}.strands.to`, { name: SLOT })
  for (const side of ['in', 'out'] as const) {
    for (const j of side === 'in' ? m.inJacks : m.outJacks) {
      for (const e of edgesAt(model, j.key)) {
        const other = side === 'in' ? e.from : e.to
        // the AI decides (the rack's dashed cable): said as "can …", never like a fixed write
        const can = side === 'out' && !!e.can
        let line: Line | null = null
        if (other.startsWith('net:')) {
          const net = model.nets.find((n) => n.key === other)
          if (net) {
            const field = can ? fieldOf(net.place, w) : null
            const name = field ?? w.flag(net)
            const say = !can ? dir(side) : t(field ? `${P}.strands.canSet` : `${P}.strands.canWrite`, { name: SLOT })
            line = { side, id: `${side}:${other}`, say, name, target: { kind: 'place', place: net.place, label: w.flag(net) } }
          }
        } else {
          const k = moduleOfJack(model, other)
          const om = k ? byKey.get(k) : undefined
          if (om) {
            const gate = om.kind === 'outbound' || om.kind === 'outbox' ? w.tags(om).find((x) => ['outbound', 'afterApproval', 'asksFirst', 'byHand'].includes(x.tag)) : undefined
            // a way out says who stands in between; a server touched by a profile carries its id ("IN-01")
            const tag = gate ? { text: gate.text } : om.kind === 'server' && om.profile ? { text: om.profile } : null
            let say = dir(side)
            let name = w.name(om)
            if (can) {
              const r = om.ref
              if (om.kind === 'everything') {
                say = t(`${P}.strands.canWriteAll`)
                name = ''
              } else if (r.kind === 'outbound' && r.exit === 'git' && r.method) {
                // "can open merge requests" — the Klartext's own words for the git action
                say = t(`${P}.plain.c.git.${r.method}`) !== `${P}.plain.c.git.${r.method}` ? t(`${P}.plain.c.git.${r.method}`) : t(`${P}.strands.canSend`, { name: SLOT })
                name = say.includes(SLOT) ? `${t(`${P}.exit.git`)} · ${gitAction(w.ctx, r.method)}` : ''
              } else if (om.kind === 'outbound' || om.kind === 'outbox' || om.kind === 'server') say = t(`${P}.strands.canSend`, { name: SLOT })
              else say = t(`${P}.strands.canWrite`, { name: SLOT })
            }
            line = { side, id: `${side}:${om.key}`, say, name, key: om.key, target: { kind: 'module', m: om }, ...(tag ? { tag } : {}) }
          }
        }
        if (!line || seen.has(line.id)) continue
        seen.add(line.id)
        if (side === 'in' && e.outside) line.tag = { text: t(`${P}.tag.outside`), outside: true }
        if (side === 'in') {
          const src = line.target.kind === 'module' ? line.target.m.ref : null
          if (src?.kind === 'rowTrigger') fromDbs.add(src.db)
          else if (line.target.kind === 'place' && 'db' in line.target.place) fromDbs.add(line.target.place.db)
        }
        out.push(line)
      }
    }
  }
  // reads without a cable (the rack's net chips): "reads Tessera Handoff", "reads Tasks" — after the starts, before the
  // writes
  const reads: Line[] = []
  for (const n of m.nets) {
    const all = 'everything' in n.place
    if ('db' in n.place && fromDbs.has(n.place.db)) continue
    const name = all ? '' : w.net(n, m)
    const id = `net:${all ? 'everything' : name}`
    if (seen.has(id)) continue
    seen.add(id)
    reads.push({
      side: 'in',
      id,
      say: all ? t(`${P}.strands.readsAll`) : t(`${P}.strands.reads`, { name: SLOT }),
      name,
      target: { kind: 'place', place: n.place, label: name },
      ...(n.tainted ? { tag: { text: t(`${P}.tag.outside`), outside: true } } : {}),
    })
  }
  return [...out.filter((l) => l.side === 'in'), ...reads, ...out.filter((l) => l.side === 'out')]
}

/** Open what a line names: a module's editor, a place's page. */
function openLine(l: Line, from: HTMLElement): void {
  if (l.target.kind === 'module') {
    if (canOpen(l.target.m)) openModule(l.target.m, from)
    return
  }
  const p = l.target.place
  if ('db' in p) navigate({ name: 'page', id: p.db })
  else if ('page' in p) navigate({ name: 'page', id: p.page })
}

const lineOpens = (l: Line): boolean => (l.target.kind === 'module' ? canOpen(l.target.m) : 'db' in l.target.place || 'page' in l.target.place)

function StrandCard({ m, model, w, fuses, runs, running, steps = [], next = null }: { m: Module; model: Model; w: Words; fuses: string[]; runs: number; running: boolean; steps?: number[]; next?: number | null }) {
  const t = w.t
  const ghost = m.tags.includes('ghost')
  const nameKey = useRef<HTMLButtonElement>(null)
  const lines = useMemo(() => linesOf(model, w, m), [model, w, m])
  const opens = canOpen(m)
  const selected = usePbUI((s) => s.selected === m.key)
  const worker = w.worker(m)
  // a tap anywhere on the card opens its editor (its keys open their own targets)
  const onCard = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest('button, a')) return
    if (opens) openModule(m, nameKey.current)
  }
  const knobs = m.knobs ? { model: w.knobModel(m).label, budget: w.knobBudget(m).label } : null
  return (
    <article className="pb-strand" data-path={fuses.length ? '' : undefined} data-live={running || undefined} data-selected={selected || undefined} data-ghost={ghost || undefined} data-key={m.key} data-testid="pb-strand" onClick={onCard}>
      <span className="pb-strand__h">
        <span className={running ? 'led led--on' : m.tags.includes('disabled') || worker?.led === 'off' ? 'led' : worker?.led === 'warn' ? 'led pb-led--warn' : 'led pb-led--ok'} aria-hidden="true" />
        <span className="label">{ghost ? `${w.kind(m)} · ${t(`${P}.ghost.planned`)}` : w.kind(m)}</span>
        {w.tags(m)
          .slice(0, 2)
          .map((x) => (
            <span key={x.tag} className="pb-tag" data-tag={x.tag}>
              {x.text}
            </span>
          ))}
        {fuses.map((f) => (
          <span key={f} className="pb-tag pb-tag--f">
            {f}
          </span>
        ))}
        <span className="pb-strand__sp" />
        {steps.map((n) => (
          <span key={n} className="pb-step" data-next={next === n || undefined} title={t(`${P}.ghost.step`, { n: lampNo(n) })}>
            {lampNo(n)}
          </span>
        ))}
        {worker && (
          <span className="pb-win" data-worker={worker.led} title={worker.title} data-testid="pb-worker">
            {worker.word}
          </span>
        )}
        {runs > 0 && (
          <span className="pb-win" title={t(runs === 1 ? `${P}.win.runsTitle.one` : `${P}.win.runsTitle`, { n: runs })}>
            {t(`${P}.win.runs`, { n: runs })}
          </span>
        )}
      </span>
      <span className="pb-strand__n">
        <button type="button" ref={nameKey} className="pb-strand__open" aria-disabled={opens ? undefined : 'true'} title={opens ? t(`${P}.openTitle`) : undefined} onClick={(e) => opens && openModule(m, e.currentTarget)} data-testid="pb-strand-open">
          {w.name(m)}
        </button>
      </span>
      {lines.length > 0 && (
        <ul className="pb-lines">
          {lines.map((l) => (
            <li key={l.id}>
              {lineOpens(l) ? (
                <button type="button" className="pb-line" title={t(`${P}.strands.openLine`, { name: lineName(l, w) })} onClick={(e) => openLine(l, e.currentTarget)} data-key={l.key} data-testid="pb-line">
                  <LineBody l={l} />
                </button>
              ) : (
                <span className="pb-line" tabIndex={l.key ? -1 : undefined} data-key={l.key} data-testid="pb-line">
                  <LineBody l={l} />
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
      {knobs && (
        <span className="pb-knobline">
          <span className="label">
            {t(`${P}.knob.model`)} <b>{knobs.model}</b>
          </span>
          <span className="label">
            {t(`${P}.knob.budget`)} <b>{knobs.budget}</b>
          </span>
        </span>
      )}
    </article>
  )
}

function LineBody({ l }: { l: Line }) {
  return (
    <>
      <span className="pb-line__ar" aria-hidden="true">
        {l.side === 'in' ? '←' : '→'}
      </span>
      <span className="pb-line__t">
        <Slotted text={l.say}>
          <b>{l.name}</b>
        </Slotted>
      </span>
      {l.tag && (
        <span className="pb-tag" data-tag={l.tag.outside ? 'outside' : undefined}>
          {l.tag.text}
        </span>
      )}
    </>
  )
}

/** The drop visit's list (B12): the band's card, what the recipe makes, what it does not touch. */
export interface StrandsSetup {
  card: ReactNode
  /** the lamps that make or touch each module, and the one worked on */
  chips: Record<ModuleKey, number[]>
  next: number | null
  /** the drop visit: the setup's list (null: later visits — the normal list, planned strands dotted in place) */
  band: { untouched: ModuleKey[] } | null
}

export function Strands({ model, input, words: w, marks, runs, running, setup }: { model: Model; input: ModelInput; words: Words; marks: FuseMarks; runs: Record<ModuleKey, number>; running: readonly ModuleKey[]; setup?: StrandsSetup | null }) {
  const t = w.t
  const [showAll, setShowAll] = useState(false)
  const root = useRef<HTMLDivElement>(null)
  const selectedKey = usePbUI((s) => s.selected)
  // the order is fixed for this visit (a run starting never reorders the list)
  const first = useRef<ReturnType<typeof strandOrder> | null>(null)
  const order = useMemo(() => {
    const fresh = strandOrder(model, { name: (k) => { const m = model.modules.find((x) => x.key === k); return m ? w.name(m) : k }, lang: w.lang, fuses: marks.open })
    const prev = first.current
    if (!prev) return (first.current = fresh)
    const keep = (old: ModuleKey[], now: ModuleKey[]) => [...old.filter((k) => now.includes(k)), ...now.filter((k) => !old.includes(k))]
    return { fuses: fresh.fuses, strands: keep(prev.strands, fresh.strands), rest: keep(prev.rest, fresh.rest) }
  }, [model, w, marks])
  const byKey = new Map(model.modules.map((m) => [m.key, m]))
  const strands = order.strands.map((k) => byKey.get(k)).filter((m): m is Module => !!m)
  const rest = order.rest.map((k) => byKey.get(k)).filter((m): m is Module => !!m)
  // the first running strand in list order: the floating chip jumps there (the list itself never moves)
  const live = strands.find((m) => running.includes(m.key)) ?? null
  const jump = () => {
    if (!live) return
    const card = root.current?.querySelector<HTMLElement>(`.pb-strand[data-key="${CSS.escape(live.key)}"]`)
    if (!card) return
    card.scrollIntoView({ block: 'center', behavior: 'smooth' })
    card.querySelector<HTMLElement>('.pb-strand__open')?.focus({ preventScroll: true })
  }

  return (
    <div className="pb-strands" role="region" aria-label={t(`${P}.strands.aria`)} data-testid="pb-strands" ref={root}>
      {setup?.band ? (
        <>
          {setup.card}
          <div className="pb-sh">
            <span className="label pb-colh__n">§ 01</span>
            <span className="label">{t(`${P}.setup.created`)}</span>
            <span className="pb-colh__rule" aria-hidden="true" />
          </div>
          <ul className="pb-strands__list">
            {strands
              .filter((m) => m.tags.includes('ghost'))
              .map((m) => (
                <li key={m.key}>
                  <StrandCard m={m} model={model} w={w} fuses={[]} runs={0} running={false} steps={setup.chips[m.key]} next={setup.next} />
                </li>
              ))}
          </ul>
          <div className="pb-sh">
            <span className="label pb-colh__n">§ 02</span>
            <span className="label">{t(setup.band.untouched.length === 1 ? `${P}.setup.untouchedShort.one` : `${P}.setup.untouchedShort`, { m: setup.band.untouched.length })}</span>
            <span className="pb-colh__rule" aria-hidden="true" />
          </div>
          <button type="button" className="pb-fold pb-fold--names" aria-expanded={showAll} title={t(`${P}.band.foldedTitle`)} onClick={() => setShowAll(!showAll)} data-testid="pb-strands-untouched">
            <span className="pb-fold__names">{setup.band.untouched.map((k) => (byKey.get(k) ? w.name(byKey.get(k)!) : k)).join(', ')}</span>
            <span className="pb-fold__sp" />
            <span className="visually-hidden">{t(showAll ? `${P}.band.fold` : `${P}.band.unfold`)}</span>
            {showAll ? <ChevronUp size={14} strokeWidth={1.75} aria-hidden="true" /> : <ChevronDown size={14} strokeWidth={1.75} aria-hidden="true" />}
          </button>
          {showAll && (
            <ul className="pb-strands__list">
              {strands
                .filter((m) => !m.tags.includes('ghost'))
                .map((m) => (
                  <li key={m.key}>
                    <StrandCard m={m} model={model} w={w} fuses={marks.modules.get(m.key) ?? []} runs={runs[m.key] ?? 0} running={running.includes(m.key)} />
                  </li>
                ))}
            </ul>
          )}
          <FuseCards model={model} input={input} words={w} />
        </>
      ) : (
        <>
      <FuseCards model={model} input={input} words={w} />
      <div className="pb-sh">
        <span className="label pb-colh__n">§ 02</span>
        <span className="label">
          {t(`${P}.strands.head`)} · {strands.length}
        </span>
        <span className="pb-colh__rule" aria-hidden="true" />
      </div>
      <ul className="pb-strands__list">
        {strands.map((m) => (
          <li key={m.key}>
            <StrandCard m={m} model={model} w={w} fuses={marks.modules.get(m.key) ?? []} runs={runs[m.key] ?? 0} running={running.includes(m.key)} steps={setup?.chips[m.key]} next={setup?.next ?? null} />
          </li>
        ))}
      </ul>
      {rest.length > 0 && (
        <>
          <div className="pb-sh">
            <span className="label pb-colh__n">§ 03</span>
            <span className="label">
              {t(`${P}.strands.rest`)} · {rest.length}
            </span>
            <span className="pb-colh__rule" aria-hidden="true" />
          </div>
          <p className="pb-strands__rest" data-testid="pb-strands-rest">
            {rest.map((m, i) => (
              <span key={m.key}>
                {i > 0 && ' · '}
                <span className="pb-strands__restn" data-key={m.key} data-selected={selectedKey === m.key || undefined} tabIndex={-1}>
                  {w.name(m)}
                </span>
              </span>
            ))}
          </p>
        </>
      )}
        </>
      )}
      {/* the chip's slot: zero height, sticky at the foot of the view, there from page open — the chip floats in it */}
      <div className="pb-jumpbar" data-testid="pb-jumpbar">
        {live && (
          <button type="button" className="pb-jump" title={t(`${P}.live.jumpTitle`)} onClick={jump} data-testid="pb-jump">
            <span className="led led--on" aria-hidden="true" />
            <span className="pb-jump__t">{t(`${P}.live.jump`, { name: w.name(live) })}</span>
          </button>
        )}
      </div>
    </div>
  )
}

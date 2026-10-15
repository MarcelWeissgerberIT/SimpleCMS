/**
 * The strands view (plan §3.8, §6 U13 / U14) — what the rack becomes on a phone, and wherever the bench is narrower
 * than 880 px × the text size or a module's name would fall under ~12ch (XL text at 1024 / 1280, an open dock):
 *
 *  - the order is fixed when the page opens (layout.ts strandOrder): the fuse cards (FuseList.tsx FuseCards — then the
 *    grey rows nothing counts), "§ 02 Strands · n" one card per processor by name, then "§ 03 Not processed · n"
 *    naming every other module. Nothing reorders under the finger: a strand that starts running lights IN PLACE and a
 *    sticky chip "running · <name> ↓" at the top jumps to it;
 *  - a strand card: its header (LED, kind, tags, F tags, runs today), its name, one line per connection — "from …" /
 *    "to …" (the arrows are decoration, the words carry the direction), content from outside tagged, a way out with
 *    who stands in between — and the knob line in mono (model · budget per run) for an agent that has one;
 *  - a tap on a card opens its editor (its name is that key for the keyboard); a tap on a line opens that line's module
 *    (a place: its page). No patching here; hit targets ≥ 40 px.
 */
import { useMemo, useRef, type MouseEvent } from 'react'
import { navigate } from '../../../lib/router'
import { strandOrder } from '../layout'
import type { Model, ModelInput, Module, ModuleKey, Place } from '../types'
import { FuseCards } from './FuseList'
import { edgesAt, moduleOfJack } from './lit'
import { canOpen, openModule } from './open'
import type { FuseMarks, Words } from './words'

const P = 'features.patchbay'

type LineTarget = { kind: 'module'; m: Module } | { kind: 'place'; place: Place; label: string }

interface Line {
  side: 'in' | 'out'
  id: string
  name: string
  target: LineTarget
  /** a tag after the words: content from outside (hatched), or who stands before a way out */
  tag?: { text: string; outside?: boolean }
}

/** One line per connection of a processor (deduplicated by what it connects to). */
function linesOf(model: Model, w: Words, m: Module): Line[] {
  const byKey = new Map(model.modules.map((x) => [x.key, x]))
  const out: Line[] = []
  const seen = new Set<string>()
  for (const side of ['in', 'out'] as const) {
    for (const j of side === 'in' ? m.inJacks : m.outJacks) {
      for (const e of edgesAt(model, j.key)) {
        const other = side === 'in' ? e.from : e.to
        let line: Line | null = null
        if (other.startsWith('net:')) {
          const net = model.nets.find((n) => n.key === other)
          if (net) line = { side, id: `${side}:${other}`, name: w.flag(net), target: { kind: 'place', place: net.place, label: w.flag(net) } }
        } else {
          const k = moduleOfJack(model, other)
          const om = k ? byKey.get(k) : undefined
          if (om) {
            const gate = om.kind === 'outbound' || om.kind === 'outbox' ? w.tags(om).find((x) => ['outbound', 'afterApproval', 'asksFirst', 'byHand'].includes(x.tag)) : undefined
            // a way out says who stands in between; a server touched by a profile carries its id ("IN-01")
            const tag = gate ? { text: gate.text } : om.kind === 'server' && om.profile ? { text: om.profile } : null
            line = { side, id: `${side}:${om.key}`, name: w.name(om), target: { kind: 'module', m: om }, ...(tag ? { tag } : {}) }
          }
        }
        if (!line || seen.has(line.id)) continue
        seen.add(line.id)
        if (side === 'in' && e.outside) line.tag = { text: w.t(`${P}.tag.outside`), outside: true }
        out.push(line)
      }
    }
  }
  return out
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

function StrandCard({ m, model, w, fuses, runs, running }: { m: Module; model: Model; w: Words; fuses: string[]; runs: number; running: boolean }) {
  const t = w.t
  const nameKey = useRef<HTMLButtonElement>(null)
  const lines = useMemo(() => linesOf(model, w, m), [model, w, m])
  const opens = canOpen(m)
  // a tap anywhere on the card opens its editor (its keys open their own targets)
  const onCard = (e: MouseEvent<HTMLElement>) => {
    if ((e.target as Element).closest('button, a')) return
    if (opens) openModule(m, nameKey.current)
  }
  const knobs = m.knobs ? { model: w.knobModel(m).label, budget: w.knobBudget(m).label } : null
  return (
    <article className="pb-strand" data-path={fuses.length ? '' : undefined} data-live={running || undefined} data-key={m.key} data-testid="pb-strand" onClick={onCard}>
      <span className="pb-strand__h">
        <span className={running ? 'led led--on' : m.tags.includes('disabled') ? 'led' : 'led pb-led--ok'} aria-hidden="true" />
        <span className="label">{w.kind(m)}</span>
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
                <button type="button" className="pb-line" title={t(`${P}.strands.openLine`, { name: l.name })} onClick={(e) => openLine(l, e.currentTarget)} data-testid="pb-line">
                  <LineBody l={l} w={w} />
                </button>
              ) : (
                <span className="pb-line" data-testid="pb-line">
                  <LineBody l={l} w={w} />
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

function LineBody({ l, w }: { l: Line; w: Words }) {
  return (
    <>
      <span className="pb-line__ar" aria-hidden="true">
        {l.side === 'in' ? '←' : '→'}
      </span>
      <span className="pb-line__t">
        {w.t(l.side === 'in' ? `${P}.strands.from` : `${P}.strands.to`)} <b>{l.name}</b>
      </span>
      {l.tag && (
        <span className="pb-tag" data-tag={l.tag.outside ? 'outside' : undefined}>
          {l.tag.text}
        </span>
      )}
    </>
  )
}

export function Strands({ model, input, words: w, marks, runs, running }: { model: Model; input: ModelInput; words: Words; marks: FuseMarks; runs: Record<ModuleKey, number>; running: readonly ModuleKey[] }) {
  const t = w.t
  const root = useRef<HTMLDivElement>(null)
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
  // the first running strand in list order: the sticky chip jumps there (the list itself never moves)
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
      {live && (
        <button type="button" className="pb-jump" title={t(`${P}.live.jumpTitle`)} onClick={jump} data-testid="pb-jump">
          <span className="led led--on" aria-hidden="true" />
          {t(`${P}.live.jump`, { name: w.name(live) })}
        </button>
      )}
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
            <StrandCard m={m} model={model} w={w} fuses={marks.modules.get(m.key) ?? []} runs={runs[m.key] ?? 0} running={running.includes(m.key)} />
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
            {rest.map((m) => w.name(m)).join(' · ')}
          </p>
        </>
      )}
    </div>
  )
}

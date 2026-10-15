/**
 * The rack (plan §3.3): one screwed plate holding ONE grid whose rows all three columns share — `[§ 01] chan [§ 02]
 * chan [§ 03]` — with the column heads in row 1 and every slot of the layout (layout.ts: modules, net flags, folds, bus
 * chips) at `grid-row: row + 1`; the cable layer over it (Wires.tsx) and the legend under the grid.
 *
 * Semantics (§3.9): each column is a `role="list"` ("§ 01 Sources") of its slots in row order — the wrappers are
 * `display: contents`, so the grid places the slots themselves; the rack region carries a visually-hidden hint. A click
 * on the empty bench clears the selection.
 *
 * Keyboard (§3.9): ONE tab stop for the whole rack (roving: the slot the keyboard was on last, else the selection, else
 * the first module); modules, net flags, folds and "+n" chips are stops (`data-stop`), the arrows move between them
 * (roving.ts: ↑ / ↓ in the column, ← / → to the neighbour column at the same row, Home / End), never scrolling the page
 * beyond bringing the stop into view; Tab leaves the rack. The fuses' glyphs (Wires.tsx) get every fuse in F-order and
 * the active one (store.ts activeFuse).
 */
import { useMemo, useRef, type KeyboardEvent, type MouseEvent } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Screws } from '../../../ui/controls'
import type { FoldSlot, Layout, Slot } from '../layout'
import type { Column, FuseState } from '../types'
import { BusChip } from './BusChip'
import { Legend } from './Legend'
import { Module } from './Module'
import { NetFlag } from './NetFlag'
import { RackContext, useRack, type RackCtx } from './RackContext'
import { roveKeyOf, nextStop, stopsOf } from './roving'
import { activeFuse, lightNet, selectModule, setCursor, toggleFold, usePbUI } from './store'
import { Wires, type GlyphFuse } from './Wires'
import { fuseNo } from './words'

const P = 'features.patchbay'
const COLS: Column[] = [1, 2, 3]

function Fold({ slot }: { slot: FoldSlot }) {
  const { model, words: w, entry } = useRack()
  const f = w.fold(slot)
  const open = !!slot.open
  const labels = slot.fuses.map((k) => model.fuses.find((x) => x.key === k)?.label).filter((x): x is string => !!x)
  return (
    <button
      type="button"
      className="pb-fold"
      data-why={slot.why}
      data-open={open || undefined}
      aria-expanded={open}
      title={f.title}
      data-testid="pb-fold"
      data-stop={slot.id}
      tabIndex={entry === slot.id ? 0 : -1}
      style={{ gridColumn: slot.col * 2 - 1, gridRow: slot.row + 1 }}
      onFocus={(e) => e.target === e.currentTarget && setCursor(slot.id)}
      onClick={(e) => {
        e.stopPropagation()
        toggleFold(slot.id)
      }}
    >
      <span className="pb-fold__leds" aria-hidden="true">
        <span className="led" />
        <span className="led" />
        <span className="led" />
      </span>
      <span className="label pb-fold__label">{f.label}</span>
      {!open && <span className="pb-fold__names">{f.names.join(' · ')}</span>}
      {labels.map((l) => (
        <span key={l} className="pb-tag pb-tag--f">
          {l}
        </span>
      ))}
      <span className="pb-fold__sp" />
      <span className="visually-hidden">{w.t(open ? `${P}.fold.fold` : `${P}.fold.show`)}</span>
      {open ? <ChevronUp size={13} strokeWidth={1.75} aria-hidden="true" /> : <ChevronDown size={13} strokeWidth={1.75} aria-hidden="true" />}
    </button>
  )
}

function SlotView({ slot, i }: { slot: Slot; i: number }) {
  const { model } = useRack()
  if (slot.kind === 'module') {
    const m = model.modules.find((x) => x.key === slot.id)
    return m ? <Module m={m} row={slot.row} span={slot.span} descId={`pb-d-${i}`} /> : null
  }
  if (slot.kind === 'flag') {
    const net = model.nets.find((n) => n.key === slot.net)
    return net ? <NetFlag slot={slot} net={net} /> : null
  }
  if (slot.kind === 'fold') return <Fold slot={slot} />
  return <BusChip slot={slot} />
}

export function Rack({ ctx, layout, onFuse }: { ctx: RackCtx; layout: Layout; onFuse: (key: string) => void }) {
  const bench = useRef<HTMLDivElement>(null)
  const t = ctx.words.t
  const selectedFuse = usePbUI((s) => s.fuse)
  const stops = useMemo(() => stopsOf(layout), [layout])
  // every fuse gets a glyph (allowed ones in ink), F-order; the active one carries the leader / stub
  const glyphs = useMemo<GlyphFuse[]>(
    () =>
      (ctx.model.fuses as FuseState[])
        .map((f) => ({ key: f.key, label: f.label, at: f.at, allowed: f.allowed?.state === 'allowed' }))
        .sort((a, b) => fuseNo(a.label) - fuseNo(b.label)),
    [ctx.model],
  )
  const active = activeFuse(selectedFuse, glyphs, ctx.marks.open)
  // arrow keys: the roving stop moves (a jack's arrows go on from its module); never a scroll of the page
  const onKeyDown = (e: KeyboardEvent<HTMLElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return
    const move = roveKeyOf(e.key)
    if (!move) return
    const target = e.target as HTMLElement
    const from = target.closest<HTMLElement>('[data-stop]')
    if (!from || !e.currentTarget.contains(from)) return
    if (target !== from && !target.matches('.pb-jk')) return
    e.preventDefault()
    const id = nextStop(stops, from.dataset.stop!, move)
    if (!id) return
    const el = e.currentTarget.querySelector<HTMLElement>(`[data-stop="${CSS.escape(id)}"]`)
    if (!el) return
    el.focus({ preventScroll: true })
    el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }
  const byCol = useMemo(() => {
    const out = new Map<Column, Array<{ slot: Slot; i: number }>>()
    layout.slots.forEach((slot, i) => {
      const list = out.get(slot.col) ?? []
      list.push({ slot, i })
      out.set(slot.col, list)
    })
    for (const list of out.values()) list.sort((a, b) => a.slot.row - b.slot.row)
    return out
  }, [layout])
  const clear = (e: MouseEvent) => {
    if ((e.target as Element).closest('.pb-mod, .pb-flag, .pb-fold, .pb-bus, button, a')) return
    selectModule(null)
    lightNet(null)
  }
  const counts = ctx.model.counts
  return (
    <RackContext.Provider value={ctx}>
      <div className="pb-bench" ref={bench} data-testid="pb-bench">
        <section className="pb-rack screw-plate" aria-label={t(`${P}.rack.aria`, { m: counts.modules, c: counts.cables })} aria-describedby="pb-rack-hint" onClick={clear} onKeyDown={onKeyDown} data-testid="pb-rack">
          <Screws seed="patchbay-rack" />
          <p id="pb-rack-hint" className="visually-hidden">
            {t(`${P}.rack.hint`)}
          </p>
          <div className="pb-grid" style={{ gridTemplateRows: `auto repeat(${Math.max(1, layout.rows)}, auto)` }}>
            {COLS.map((col) => (
              <div key={`h${col}`} className="pb-colh" style={{ gridColumn: col * 2 - 1, gridRow: 1 }} data-testid={`pb-colh-${col}`}>
                <span className="label pb-colh__n">§ 0{col}</span>
                <span className="label pb-colh__name">{ctx.words.colName(col)}</span>
                <span className="pb-colh__rule" aria-hidden="true" />
                <span className="label pb-colh__count">{ctx.words.colCount(layout.cols[col])}</span>
              </div>
            ))}
            {COLS.map((col) => (
              <div key={col} className="pb-col" role="list" aria-label={t(`${P}.a11y.column`, { n: col, name: ctx.words.colName(col) })} data-col={col}>
                {(byCol.get(col) ?? []).map(({ slot, i }) => (
                  <div key={slot.id} className="pb-li" role="listitem">
                    <SlotView slot={slot} i={i} />
                  </div>
                ))}
              </div>
            ))}
          </div>
          {ctx.model.edges.length > 0 && <Legend />}
        </section>
        <Wires bench={bench} layout={layout} model={ctx.model} lit={ctx.lit} fuseEdges={ctx.marks.edges} fuses={glyphs} active={active} onFuse={onFuse} t={t} />
      </div>
    </RackContext.Provider>
  )
}

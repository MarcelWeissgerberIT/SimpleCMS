/**
 * The rack (plan §3.3): one screwed plate holding ONE grid whose rows all three columns share — `[§ 01] chan [§ 02]
 * chan [§ 03]` — with the column heads in row 1 and every slot of the layout (layout.ts: modules, net flags, folds, bus
 * chips) at `grid-row: row + 1`; the cable layer over it (Wires.tsx) and the legend under the grid.
 *
 * Semantics (§3.9): each column is a `role="list"` ("§ 01 Sources") of its slots in row order — the wrappers are
 * `display: contents`, so the grid places the slots themselves; the rack region carries a visually-hidden hint. A click
 * on the empty bench clears the selection.
 */
import { useMemo, useRef, type MouseEvent } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { Screws } from '../../../ui/controls'
import type { FoldSlot, Layout, Slot } from '../layout'
import type { Column } from '../types'
import { BusChip } from './BusChip'
import { Legend } from './Legend'
import { Module } from './Module'
import { NetFlag } from './NetFlag'
import { RackContext, useRack, type RackCtx } from './RackContext'
import { lightNet, selectModule, toggleFold } from './store'
import { Wires } from './Wires'

const P = 'features.patchbay'
const COLS: Column[] = [1, 2, 3]

function Fold({ slot }: { slot: FoldSlot }) {
  const { model, words: w } = useRack()
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
      style={{ gridColumn: slot.col * 2 - 1, gridRow: slot.row + 1 }}
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

export function Rack({ ctx, layout }: { ctx: RackCtx; layout: Layout }) {
  const bench = useRef<HTMLDivElement>(null)
  const t = ctx.words.t
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
        <section className="pb-rack screw-plate" aria-label={t(`${P}.rack.aria`, { m: counts.modules, c: counts.cables })} aria-describedby="pb-rack-hint" onClick={clear}>
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
        <Wires bench={bench} layout={layout} model={ctx.model} lit={ctx.lit} fuseEdges={ctx.marks.edges} />
      </div>
    </RackContext.Provider>
  )
}

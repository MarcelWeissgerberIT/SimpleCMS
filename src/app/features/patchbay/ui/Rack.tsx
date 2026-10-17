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
 * the active one (fuseRows.ts activeGlyph: the fuse list's selected row when it is a fuse — B8).
 *
 * The setup band (B12, plan §3.7, mock-2 — the visit where a profile was dropped or "Set up in the Patchbay" pressed):
 * the column heads count "2 + 1 new · 3 idle"; under them the dashed band holds the profile's modules (layout.ts
 * bandPartition: real ones, ghosts, what a planned cable reaches — the rows the layout gave them) and the lamps plate;
 * below it "Not touched by the profile · 8 modules · 7 cables folded" and one fold per column naming every module (F
 * tags kept) — ↵ on that line unfolds the whole rack inside the band, and folds it again. The legend becomes the
 * setup's (planned · not created yet · "04" · F1 · ↵ next lamp · Mod+Z profile back).
 */
import { useMemo, useRef, type KeyboardEvent, type MouseEvent, type ReactNode } from 'react'
import { ChevronDown, ChevronUp, CornerDownLeft } from 'lucide-react'
import { Screws } from '../../../ui/controls'
import type { FoldSlot, Layout, Slot } from '../layout'
import type { Column, FuseState } from '../types'
import { BusChip } from './BusChip'
import { Legend } from './Legend'
import { Module } from './Module'
import { NetFlag } from './NetFlag'
import { RackContext, useRack, type RackCtx } from './RackContext'
import { roveKeyOf, nextStop, stopsOf } from './roving'
import { lightNet, selectModule, setCursor, toggleFold, usePbUI } from './store'
import { activeGlyph, fuseRowsOf } from './fuseRows'
import { Wires, type GlyphFuse } from './Wires'
import { countOf, fuseNo } from './words'
import { useLive } from '../live/live'
import { cableLabels } from './liveWin'
import { DragCable, usePatchPointer, type PatchPointer } from './PatchDrag'



const P = 'features.patchbay'
const COLS: Column[] = [1, 2, 3]

function Fold({ slot, unfold }: { slot: FoldSlot; unfold?: (() => void) | undefined }) {
  const { model, words: w, entry } = useRack()
  const f = w.fold(slot)
  const open = !!slot.open
  const labels = slot.fuses.map((k) => model.fuses.find((x) => x.key === k)?.label).filter((x): x is string => !!x)
  // what a dropped profile does not touch (the band's fold line, mock-2): the count, every name (wrapped, never cut),
  // "from outside" and the F tags — the line above the folds unfolds them
  if (slot.why === 'setup') {
    const outside = slot.modules.some((k) => model.modules.find((m) => m.key === k)?.tags.includes('outside'))
    return (
      <div
        className="pb-fold pb-fold--setup"
        data-why="setup"
        title={f.title}
        data-testid="pb-fold"
        data-stop={slot.id}
        tabIndex={entry === slot.id ? 0 : -1}
        role="group"
        aria-label={`${f.label}: ${f.names.join(', ')}`}
        style={{ gridColumn: slot.col * 2 - 1, gridRow: slot.row + 1 }}
        onFocus={(e) => e.target === e.currentTarget && setCursor(slot.id)}
        // ↵ / Space unfold what the profile does not touch, as the line's "Unfold" key does (§3.9, fix ui-words) — the
        // keyboard goes on to that key (this fold is gone once unfolded); never a scroll of the page
        onKeyDown={(e) => {
          if (e.target !== e.currentTarget || e.altKey || e.ctrlKey || e.metaKey || (e.key !== 'Enter' && e.key !== ' ')) return
          e.preventDefault()
          if (!unfold) return
          const rack = e.currentTarget.closest('.pb-rack')
          unfold()
          requestAnimationFrame(() => rack?.querySelector<HTMLElement>('[data-testid="pb-untouched-key"]')?.focus({ preventScroll: true }))
        }}
        aria-keyshortcuts="Enter"
      >
        <span className="label pb-fold__label">{slot.modules.length}</span>
        <span className="pb-fold__names">{f.names.join(', ')}</span>
        <span className="pb-fold__sp" />
        {outside && (
          <span className="pb-tag" data-tag="outside">
            {w.t(`${P}.tag.outside`)}
          </span>
        )}
        {labels.map((l) => (
          <span key={l} className="pb-tag pb-tag--f">
            {l}
          </span>
        ))}
      </div>
    )
  }
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

function SlotView({ slot, i, unfold }: { slot: Slot; i: number; unfold?: (() => void) | undefined }) {
  const { model } = useRack()
  if (slot.kind === 'module') {
    const m = model.modules.find((x) => x.key === slot.id)
    return m ? <Module m={m} row={slot.row} span={slot.span} descId={`pb-d-${i}`} /> : null
  }
  if (slot.kind === 'flag') {
    const net = model.nets.find((n) => n.key === slot.net)
    return net ? <NetFlag slot={slot} net={net} /> : null
  }
  if (slot.kind === 'fold') return <Fold slot={slot} unfold={unfold} />
  return <BusChip slot={slot} />
}

/** The setup band on the rack (B12): its head, its lamps plate, the fold line under it. */
export interface RackBand {
  /** the band's tab and its Undo / "Close setup" key (SetupBand.tsx BandHead) */
  head: ReactNode
  /** § 00 — the lamps (SetupBand.tsx SetupPlate) */
  plate: ReactNode
  aria: string
  /** the untouched part folded below the band (false: unfolded — the whole rack inside the band) */
  folded: boolean
  onToggle: () => void
  /** what the fold line counts ("8 modules · 7 cables") */
  untouched: { modules: number; cables: number }
  /** the drop's Undo is still offered (the legend names Mod+Z) */
  undo: boolean
}

export function Rack({ ctx, layout, onFuse, band, patching }: { ctx: RackCtx; layout: Layout; onFuse: (key: string) => void; band?: RackBand | null; patching?: PatchPointer | null }) {
  const bench = useRef<HTMLDivElement>(null)
  // B16 — patching: a press on a jack pulls a cable, a click / tap opens "Connect to …" (PatchDrag.tsx)
  usePatchPointer(bench, patching ?? null)
  const t = ctx.words.t
  const selectedFuse = usePbUI((s) => s.fuse)
  const stops = useMemo(() => stopsOf(layout), [layout])
  // every fuse gets a glyph (allowed ones in ink), F-order; the active one carries the leader / stub
  const glyphs = useMemo<GlyphFuse[]>(
    () =>
      (ctx.model.fuses as FuseState[])
        .map((f) => ({ key: f.key, label: f.label, at: f.at, allowed: f.allowed?.state === 'allowed', sig: f.sig }))
        .sort((a, b) => fuseNo(a.label) - fuseNo(b.label)),
    [ctx.model],
  )
  // the glyph carrying the leader / stub: the fuse list's selected row when it is a fuse (an almost-open path or an
  // unknown part selected: none)
  const active = activeGlyph(fuseRowsOf(ctx.model), selectedFuse)
  const cables = useLive((s) => s.cables)
  const labels = useMemo(() => cableLabels(ctx.model, layout, cables, t), [ctx.model, layout, cables, t])
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
  const clear = (e: MouseEvent) => {
    if ((e.target as Element).closest('.pb-mod, .pb-flag, .pb-fold, .pb-bus, button, a')) return
    selectModule(null)
    lightNet(null)
  }
  const counts = ctx.model.counts
  const bandMode = !!band
  const partition = bandMode && band!.folded
  const lists = (slots: Array<{ slot: Slot; i: number }>, key: string, shift: (s: Slot, i: number) => Slot, unfold?: () => void) =>
    COLS.map((col) => (
      <div key={`${key}${col}`} className="pb-col" role="list" aria-label={t(`${P}.a11y.column`, { n: col, name: ctx.words.colName(col) })} data-col={col}>
        {slots
          .filter((x) => x.slot.col === col)
          .sort((a, b) => a.slot.row - b.slot.row)
          .map(({ slot, i }, j) => (
            <div key={slot.id} className="pb-li" role="listitem">
              <SlotView slot={shift(slot, j)} i={i} unfold={unfold} />
            </div>
          ))}
      </div>
    ))
  // the column heads during the setup: "2 + 1 new · 3 idle" — every real module of the column (drawn or folded), the
  // ghosts as new, the idle ones
  const bandCount = (col: Column) => {
    const of = ctx.model.modules.filter((m) => m.col === col)
    const ghosts = of.filter((m) => m.tags.includes('ghost')).length
    const idle = of.filter((m) => m.idle).length
    const real = of.length - ghosts - idle
    return [`${real}${ghosts ? ` ${t(`${P}.band.new`, { n: ghosts })}` : ''}`, ...(idle ? [t(`${P}.col.idle`, { n: idle })] : [])].join(' · ')
  }
  const heads = COLS.map((col) => (
    <div key={`h${col}`} className="pb-colh" style={{ gridColumn: col * 2 - 1, gridRow: 1 }} data-testid={`pb-colh-${col}`}>
      <span className="label pb-colh__n">§ 0{col}</span>
      <span className="label pb-colh__name">{ctx.words.colName(col)}</span>
      <span className="pb-colh__rule" aria-hidden="true" />
      <span className="label pb-colh__count">{bandMode ? bandCount(col) : ctx.words.colCount(layout.cols[col])}</span>
    </div>
  ))
  const indexed = layout.slots.map((slot, i) => ({ slot, i }))
  const inBand = partition ? indexed.filter((x) => x.slot.kind !== 'fold') : indexed
  // each column's folds in the layout's order (what the profile does not touch first)
  const folds = partition ? indexed.filter((x) => x.slot.kind === 'fold') : []
  const bandRows = Math.max(1, ...inBand.map((x) => x.slot.row + x.slot.span - 1))
  return (
    <RackContext.Provider value={ctx}>
      <div className="pb-bench" ref={bench} data-testid="pb-bench" data-patching={patching ? '' : undefined}>
        <section className="pb-rack screw-plate" aria-label={t(`${P}.rack.aria`, { m: countOf(t, 'modules', counts.modules), c: countOf(t, 'cables', counts.cables) })} aria-describedby="pb-rack-hint" onClick={clear} onKeyDown={onKeyDown} data-testid="pb-rack">
          <Screws seed="patchbay-rack" />
          {/* Orders B10: the cables drawn under the modules (Wires.tsx — the work orders' loops inside § 02) */}
          <div className="pb-under" data-pb-under="" aria-hidden="true" />
          <p id="pb-rack-hint" className="visually-hidden">
            {t(`${P}.rack.hint`)}
          </p>
          {bandMode ? (
            <>
              <div className="pb-grid pb-grid--heads">{heads}</div>
              <div className="pb-band" role="group" aria-label={band!.aria} data-testid="pb-band">
                {band!.head}
                {/* the band's rows are the layout's (row 1 = its first content row: the heads sit above the band) */}
                <div className="pb-grid pb-grid--band" style={{ gridTemplateRows: `repeat(${bandRows}, auto)` }}>
                  {lists(inBand, 'b', (slot) => ({ ...slot, row: slot.row - 1 }))}
                </div>
                {band!.plate}
              </div>
              <div className="pb-untouched" data-testid="pb-untouched">
                <span className="label pb-untouched__t">{t(`${P}.band.untouched`, { m: countOf(t, 'modules', band!.untouched.modules), c: countOf(t, 'cables', band!.untouched.cables) })}</span>
                <span className="pb-colh__rule" aria-hidden="true" />
                <button type="button" className="pb-untouched__key" aria-expanded={!band!.folded} title={t(`${P}.band.foldedTitle`)} onClick={band!.onToggle} data-testid="pb-untouched-key">
                  <CornerDownLeft size={11} strokeWidth={1.9} aria-hidden="true" />
                  <span className="label">{t(band!.folded ? `${P}.band.unfold` : `${P}.band.fold`)}</span>
                </button>
              </div>
              {partition && folds.length > 0 && (
                <div className="pb-grid pb-grid--folds" data-testid="pb-band-folds">
                  {/* each column's folds one under the other: what the profile does not touch first */}
                  {lists(folds, 'f', (slot, j) => ({ ...slot, row: j }), band!.onToggle)}
                </div>
              )}
            </>
          ) : (
            <div className="pb-grid" style={{ gridTemplateRows: `auto repeat(${Math.max(1, layout.rows)}, auto)` }}>
              {heads}
              {lists(indexed, '', (slot) => slot)}
            </div>
          )}
          {ctx.model.edges.length > 0 && <Legend band={bandMode ? { undo: band!.undo } : null} patching={!!patching} />}
        </section>
        <Wires bench={bench} layout={layout} model={ctx.model} lit={ctx.lit} fuseEdges={ctx.marks.edges} fuses={glyphs} active={active} onFuse={onFuse} labels={labels} t={t} />
        {patching && <DragCable t={t} />}
      </div>
    </RackContext.Provider>
  )
}

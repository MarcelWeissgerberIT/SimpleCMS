/**
 * The fuse list (plan §3.5, §1.21, §6 U15) under the rack: a vertical `role="tablist"` in fixed F-order — one row per
 * open fuse (label, its path in one line, its state), then the allowed ones, then the closed plates of this visit (key 1
 * / 2 pressed here, B10), then grey rows nothing counts: parts unknown here and paths almost open (≤ 12, "+n more") —
 * with the selected row's plate as the tab panel (FusePlate.tsx). Keys 1 / 2 / 3 press the selected fuse's keys while
 * the list or its plate has the keyboard (nobody typing; Enter on a button stays the button's).
 *
 * Keyboard: the list is one tab stop (roving); ↑ / ↓ / Home / End move and select (the plate follows); F on the page
 * selects the next open fuse and gives its tab the keyboard (`data-pb-fuse-tab`). A module selected on the rack takes the
 * plate to its path: its fuse, else the path almost open it lies on ("A person checks first", §3.3 pointer grammar).
 * `#pb-fuse-plate` is the area the cable layer's leader runs to; the FUSE cell and a glyph bring it into view.
 *
 * The phone and the strands view (FuseCards): one card per fuse — the lamps in a row, the path downwards with the
 * decider's first write said between the chips, the sentence, the keys stacked full width (no digits on touch) — then
 * the closed plates of this visit and the grey rows.
 */
import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent, type ReactNode } from 'react'
import { typing } from '../../../ui/keys'
import { useKeyStack, type KeyDone } from '../keys'
import { chainModules } from '../layout'
import { blinkOf, blinkStyle } from '../blink'
import { nearSay, unknownSay } from '../fuses'
import type { Model, ModelInput } from '../types'
import { FuseHead, FusePlate, onlyVisibleIn } from './FusePlate'
import { fuseRowsOf, selectedRow, shownRows, withClosed, type FuseRow } from './fuseRows'
import { ClosedPlate } from './ClosedPlate'
import { FuseKeys, useFuseKeys, wordsOfKey } from './FuseKeys'
import { FusePath, FuseSentence, ShortLamps, pathLine, usePlateWords, type PlateWords } from './plateParts'
import { selectFuse, usePbUI } from './store'
import { SLOT } from './slot'
import type { Words } from './words'

const P = 'features.patchbay'

/** What a row's tab says: its first line (label + state) and the path / place in one line. */
function rowText(row: FuseRow, pw: PlateWords): { head: string; line: string; state?: string } {
  const t = pw.w.t
  if (row.kind === 'fuse') return { head: row.fuse.label, state: t(`${P}.plate.state.${row.state}`), line: pathLine(row.fuse.chain, pw) }
  if (row.kind === 'near') return { head: pw.say(nearSay(row.near)), line: pathLine(row.near.chain, pw) }
  if (row.kind === 'closed') return { head: row.done.fuse.label, state: t(row.done.device ? `${P}.closed.stateHere` : `${P}.closed.state`), line: pathLine(row.done.chain, wordsOfKey(row.done, pw)) }
  const m = pw.model.modules.find((x) => x.key === row.part.module)
  const only = onlyVisibleIn(row.part, pw)
  return { head: t(`${P}.plate.unknown.tab`), line: only ?? (m ? pw.w.name(m) : pw.say(unknownSay(row.part))) }
}

/** Does a row's path run through `key`? */
function rowHas(row: FuseRow, key: string, model: Model): boolean {
  if (row.kind === 'unknown') return row.part.module === key
  return chainModules(row.kind === 'fuse' ? row.fuse.chain : row.kind === 'closed' ? row.done.chain : row.near.chain, model).includes(key)
}

function FuseTab({ row, i, selected, pw, onKey }: { row: FuseRow; i: number; selected: boolean; pw: PlateWords; onKey: (e: KeyboardEvent<HTMLButtonElement>) => void }) {
  const text = rowText(row, pw)
  const open = row.kind === 'fuse' && row.state !== 'allowed'
  const blink = useMemo(() => (open && row.kind === 'fuse' ? blinkOf(row.key, row.fuse.sig ?? row.key) : { on: false, delay: 0 }), [open, row])
  return (
    <button
      type="button"
      role="tab"
      id={`pb-ftab-${i}`}
      className="pb-ftab"
      data-kind={row.kind}
      data-state={row.kind === 'fuse' ? row.state : undefined}
      data-row={row.key}
      data-pb-fuse-tab={row.kind === 'fuse' ? row.key : undefined}
      aria-selected={selected}
      aria-controls="pb-fuse-panel"
      tabIndex={selected ? 0 : -1}
      title={text.line}
      onClick={() => selectFuse(row.key)}
      onKeyDown={onKey}
      data-testid="pb-ftab"
    >
      <span className="pb-ftab__h">
        {row.kind === 'fuse' ? (
          <>
            <span className={open ? 'led led--on pb-fuse-led' : 'led pb-fuse-led'} data-blink={blink.on || undefined} style={blinkStyle(blink) as CSSProperties | undefined} aria-hidden="true" />
            <span className={row.state === 'allowed' ? 'pb-tag pb-tag--fa' : 'pb-tag pb-tag--f'}>{text.head}</span>
            <span className="label pb-ftab__state">{text.state}</span>
          </>
        ) : row.kind === 'closed' ? (
          <>
            <span className="led pb-fuse-led" aria-hidden="true" />
            <span className="pb-tag pb-tag--fa">{text.head}</span>
            <span className="label pb-ftab__state">{text.state}</span>
          </>
        ) : row.kind === 'near' ? (
          <>
            <span className="pb-ring" aria-hidden="true" />
            <span className="label pb-ftab__why">{text.head}</span>
          </>
        ) : (
          <>
            <span className="pb-tag pb-tag--q" aria-hidden="true">
              ?
            </span>
            <span className="label pb-ftab__why">{text.head}</span>
          </>
        )}
      </span>
      <span className="pb-ftab__line">{text.line}</span>
    </button>
  )
}

/** The fuse list and the selected row's plate (desktop: under the rack). Nothing to list: nothing drawn. */
export function FuseArea({ model, input, words }: { model: Model; input: ModelInput; words: Words }) {
  const pw = usePlateWords(model, input, words)
  const t = words.t
  const picked = usePbUI((s) => s.fuse)
  const selectedModule = usePbUI((s) => s.selected)
  const [allNear, setAllNear] = useState(false)
  const list = useRef<HTMLDivElement>(null)
  const closed = useClosedHere()
  const rows = withClosed(fuseRowsOf(model), closed)
  const sel = selectedRow(rows, picked)
  // the selected row is always in the list (a near miss past the 12 a module on the rack picked is spliced in after
  // them): the tablist keeps exactly one tab stop and the panel its label
  const listed = shownRows(rows, allNear)
  const spliced = !!sel && !listed.includes(sel)
  const shown = spliced ? [...listed, sel!] : listed
  const hiddenNear = allNear ? 0 : rows.hiddenNear - (spliced ? 1 : 0)

  // a module selected on the rack: the plate shows its path — the fuse it lies on, else its path almost open (a row
  // already shown that runs through it stays, unless a fuse runs through it too)
  useEffect(() => {
    if (!selectedModule) return
    const all = withClosed(fuseRowsOf(model), closedNow())
    const cur = selectedRow(all, usePbUI.getState().fuse)
    const hit = all.rows.find((r) => r.kind !== 'unknown' && rowHas(r, selectedModule, model))
    if (cur && rowHas(cur, selectedModule, model) && (cur.kind === 'fuse' || hit?.kind !== 'fuse')) return
    if (hit) selectFuse(hit.key)
  }, [selectedModule, model])

  if (!rows.rows.length || !sel) return null
  const selIndex = shown.findIndex((r) => r.key === sel.key)

  // ↑ / ↓ / Home / End: move along the list and select (the plate follows)
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return
    const i = shown.findIndex((r) => r.key === e.currentTarget.dataset.row)
    let next = -1
    if (e.key === 'ArrowDown') next = (i + 1) % shown.length
    else if (e.key === 'ArrowUp') next = (i - 1 + shown.length) % shown.length
    else if (e.key === 'Home') next = 0
    else if (e.key === 'End') next = shown.length - 1
    if (next < 0) return
    e.preventDefault()
    selectFuse(shown[next].key)
    list.current?.querySelector<HTMLElement>(`#pb-ftab-${next}`)?.focus({ preventScroll: true })
  }

  // "+n more" goes once pressed: the keyboard moves on to the first row it brought (selected, its plate shown)
  const showAllNear = () => {
    const first = listed.length
    setAllNear(true)
    requestAnimationFrame(() => {
      const all = shownRows(rows, true)
      const row = all[first]
      if (!row) return
      selectFuse(row.key)
      list.current?.querySelector<HTMLElement>(`[data-row="${CSS.escape(row.key)}"]`)?.focus({ preventScroll: true })
    })
  }
  const firstGrey = shown.findIndex((r) => r.kind !== 'fuse' && r.kind !== 'closed')
  return (
    <section className="pb-fuses" id="pb-fuse-plate" aria-label={t(`${P}.plate.aria`)} onKeyDown={digitKeys} data-testid="pb-fuses">
      <div className="pb-flist">
        <div className="pb-flist__tabs" role="tablist" aria-orientation="vertical" aria-label={t(`${P}.plate.aria`)} ref={list} data-testid="pb-flist">
          {shown.map((row, i) => (
            <FuseRowSlot key={row.key} grey={i === firstGrey} label={t(`${P}.plate.notCounted`)}>
              <FuseTab row={row} i={i} selected={row.key === sel.key} pw={pw} onKey={onKey} />
            </FuseRowSlot>
          ))}
        </div>
        {hiddenNear > 0 && (
          <button type="button" className="pb-flist__more" title={t(`${P}.plate.near.moreTitle`)} onClick={showAllNear} data-testid="pb-flist-more">
            {t(`${P}.near.more`, { n: hiddenNear })}
          </button>
        )}
      </div>
      <div className="pb-fpanel" role="tabpanel" id="pb-fuse-panel" aria-labelledby={selIndex >= 0 ? `pb-ftab-${selIndex}` : undefined} tabIndex={0} data-testid="pb-fpanel">
        <FusePlate row={sel} pw={pw} />
      </div>
    </section>
  )
}

/**
 * 1 / 2 / 3 with the keyboard in the fuse list or its plate (a card on the phone): the selected fuse's key of that
 * number — pressed as its button is (a refused one says why). Nobody typing, no modifier; Enter stays the buttons'.
 */
function digitKeys(e: KeyboardEvent<HTMLElement>): void {
  if (e.altKey || e.ctrlKey || e.metaKey || e.shiftKey || e.repeat || e.defaultPrevented) return
  if (e.key !== '1' && e.key !== '2' && e.key !== '3') return
  if (typing(document.activeElement)) return
  const plate = e.currentTarget.querySelector<HTMLElement>('[data-pb-plate]') ?? (e.currentTarget.matches('[data-pb-plate]') ? e.currentTarget : null)
  const key = plate?.querySelector<HTMLButtonElement>(`[data-pb-key="${e.key}"]`)
  if (!key) return
  e.preventDefault()
  key.click()
}

/** This visit's closed plates (keys 1 / 2 pressed on the page and not taken back), oldest first. */
function useClosedHere(): KeyDone[] {
  const ids = usePbUI((s) => s.closed)
  const stack = useKeyStack((s) => s.done)
  return useMemo(() => ids.map((id) => stack.find((d) => d.id === id)).filter((d): d is KeyDone => !!d && !d.undone), [ids, stack])
}
const closedNow = (): KeyDone[] => {
  const stack = useKeyStack.getState().done
  return usePbUI
    .getState()
    .closed.map((id) => stack.find((d) => d.id === id))
    .filter((d): d is KeyDone => !!d && !d.undone)
}

/** A tab, with the "Not counted" divider before the first grey row (decoration: each tab names its own kind). */
function FuseRowSlot({ grey, label, children }: { grey: boolean; label: string; children: ReactNode }) {
  return (
    <>
      {grey && (
        <span className="label pb-flist__div" aria-hidden="true">
          {label}
        </span>
      )}
      {children}
    </>
  )
}

/** One fuse as a card (the phone, the strands view). */
function FuseCard({ row, pw }: { row: Extract<FuseRow, { kind: 'fuse' }>; pw: PlateWords }) {
  const t = pw.w.t
  const f = row.fuse
  const keys = useFuseKeys(f, pw)
  const open = row.state !== 'allowed'
  const blink = useMemo(() => (open ? blinkOf(f.key, f.sig ?? f.key) : { on: false, delay: 0 }), [open, f.key, f.sig])
  const id = `pb-fcard-${f.label}`
  return (
    <article className="pb-fcard" data-state={row.state} data-pb-fuse-tab={f.key} data-pb-plate={f.key} tabIndex={-1} aria-labelledby={id} onKeyDown={digitKeys} data-testid="pb-fcard">
      <div className="pb-fcard__h">
        <span className={open ? 'led led--on pb-fuse-led' : 'led pb-fuse-led'} data-blink={blink.on || undefined} style={blinkStyle(blink) as CSSProperties | undefined} aria-hidden="true" />
        <h2 className="label pb-fcard__title" id={id}>
          <FuseHead text={t(open ? `${P}.fuse.head` : `${P}.plate.headAllowed`, { f: SLOT })} label={f.label} />
        </h2>
      </div>
      <ShortLamps lamps={f.lamps} pw={pw} />
      <FusePath chain={f.chain} pw={pw} hot={open} vertical />
      <FuseSentence chain={f.chain} pw={pw} className="pb-fcard__say" />
      <FuseKeys f={f} pw={pw} keys={keys} variant="card" />
    </article>
  )
}

/** The phone's fuse cards, then the grey rows nothing counts. */
export function FuseCards({ model, input, words }: { model: Model; input: ModelInput; words: Words }) {
  const pw = usePlateWords(model, input, words)
  const t = words.t
  const [allNear, setAllNear] = useState(false)
  const greyList = useRef<HTMLUListElement>(null)
  const closed = useClosedHere()
  const rows = withClosed(fuseRowsOf(model), closed)
  const shown = shownRows(rows, allNear)
  if (!rows.rows.length) return null
  const grey = shown.filter((r) => r.kind !== 'fuse' && r.kind !== 'closed')
  // "+n more" goes once pressed: the keyboard moves on to the first grey row it brought
  const showAllNear = () => {
    const first = grey.length
    setAllNear(true)
    requestAnimationFrame(() => greyList.current?.querySelectorAll<HTMLElement>('.pb-grey')[first]?.focus({ preventScroll: true }))
  }
  return (
    <section className="pb-fcards" id="pb-fuse-plate" aria-label={t(`${P}.plate.aria`)} data-testid="pb-fcards">
      {shown.map((r) => (r.kind === 'fuse' ? <FuseCard key={r.key} row={r} pw={pw} /> : r.kind === 'closed' ? <ClosedPlate key={r.key} done={r.done} pw={pw} /> : null))}
      {grey.length > 0 && (
        <div className="pb-greys">
          <span className="label pb-flist__div">{t(`${P}.plate.notCounted`)}</span>
          <ul className="pb-greys__list" ref={greyList}>
            {grey.map((r) => {
              const text = rowText(r, pw)
              return (
                <li key={r.key} className="pb-grey" data-kind={r.kind} tabIndex={-1} data-testid="pb-grey">
                  {r.kind === 'near' ? (
                    <span className="pb-ring" aria-hidden="true" />
                  ) : (
                    <span className="pb-tag pb-tag--q" aria-hidden="true">
                      ?
                    </span>
                  )}
                  <span className="pb-grey__t">
                    <span className="label">{text.head}</span>
                    <span className="pb-grey__line">{text.line}</span>
                  </span>
                </li>
              )
            })}
          </ul>
          {rows.hiddenNear > 0 && !allNear && (
            <button type="button" className="pb-flist__more" onClick={showAllNear} data-testid="pb-greys-more">
              {t(`${P}.near.more`, { n: rows.hiddenNear })}
            </button>
          )}
        </div>
      )}
    </section>
  )
}

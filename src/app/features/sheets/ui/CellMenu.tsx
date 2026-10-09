/**
 * The touch cell menu: one paper panel for the selection — opened by tapping the selection again,
 * by a long press (at the threshold, the finger still down) or by the "⋯" key on the selection.
 * Rows: Pick a value ›, + Area, Edit; key rows: Copy · Cut · Paste | Fill ↓ · Fill → · Clear |
 * Chart · More… (the cell menu's other entries, in place). Read-only: Copy alone.
 *
 * It sits above the selection (below where there's no room, the side with more room and a scroll
 * where neither fits; a sheet docked to the screen's edge only when the selection fills the screen)
 * — never on the selected cells. Esc, a press outside, a scroll or an action close it.
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { ArrowDownToLine, ArrowRightToLine, ChartColumnBig, ChevronLeft, ChevronRight, ClipboardPaste, Copy, Ellipsis, Eraser, ListChecks, PencilLine, Scissors, SquareDashedPlus } from 'lucide-react'
import { MenuList, type MenuEntry } from '../../../ui/Menu'
import { outsidePress } from '../../../ui/gesture'
import { PickPanel } from './PickList'

type T = (key: string, vars?: Record<string, string | number>) => string

/** 'press': a press outside · 'dismiss': Esc, a scroll · 'action': an entry was taken */
export type MenuClose = 'press' | 'dismiss' | 'action'

export interface CellMenuProps {
  /** the selection's visible box in client coordinates (null: out of view) */
  getBox: () => DOMRect | null
  /** the selection as the name box shows it ("A1:A5", "C1 +1") and how many cells it has */
  label: string
  cells: number
  editable: boolean
  /** "Pick a value": the active cell, its column and the column's entries */
  pick: { addr: string; column: string; entries: string[] }
  /** "+ Area" is latched */
  areaOn: boolean
  canFillDown: boolean
  canFillRight: boolean
  /** the cell menu's entries (More…) */
  more: MenuEntry[]
  t: T
  on: Record<'area' | 'edit' | 'copy' | 'cut' | 'paste' | 'fillDown' | 'fillRight' | 'clear' | 'chart', () => void> & { pick: (value: string) => void }
  onClose: (how: MenuClose) => void
}

interface Entry {
  id: string
  /** full name (accessible name) */
  label: string
  /** the visible text: the label on a row, a mono legend on a key */
  text: string
  icon: typeof Copy
  disabled?: boolean
  /** latched (aria-pressed) */
  on?: boolean
  /** right side of a row: a count, a chevron */
  hint?: ReactNode
  run: () => void
}

/** a group of rows (label lines) or of keys (one line of keys) */
type Group = { kind: 'rows' | 'keys'; items: Entry[] }

const MARGIN = 8
/** between the selection and the menu (clear of the handles, which step aside while it is open) */
const GAP = 8
/** less room than this on both sides: a sheet docked to the screen's edge */
const MIN_ROOM = 176

/** The visual viewport in layout coordinates (fixed positions): above the on-screen keyboard. */
function viewport() {
  const vv = window.visualViewport
  return vv ? { left: vv.offsetLeft, top: vv.offsetTop, width: vv.width, height: vv.height } : { left: 0, top: 0, width: window.innerWidth, height: window.innerHeight }
}

/** Where the menu goes: above the box, else below, else the roomier side (scrolling), else docked. */
function place(el: HTMLElement, box: DOMRect | null) {
  const vp = viewport()
  el.style.maxHeight = 'none'
  el.classList.remove('is-docked')
  const w = el.offsetWidth
  const h = el.offsetHeight
  const bottom = vp.top + vp.height - MARGIN
  const b = box ?? new DOMRect(vp.left + vp.width / 2, bottom, 0, 0)
  const left = Math.round(Math.max(vp.left + MARGIN, Math.min(b.left, vp.left + vp.width - MARGIN - w)))
  const above = b.top - GAP - (vp.top + MARGIN)
  const below = bottom - (b.bottom + GAP)
  let top: number
  let max = h
  if (h <= above) top = b.top - GAP - h
  else if (h <= below) top = b.bottom + GAP
  else if (Math.max(above, below) >= MIN_ROOM) {
    max = Math.max(above, below)
    top = below >= above ? b.bottom + GAP : b.top - GAP - max
  } else {
    // the selection fills the screen: docked to the edge it covers less of
    el.classList.add('is-docked')
    max = Math.min(h, Math.round(vp.height * 0.6))
    const atBottom = bottom - max
    const atTop = vp.top + MARGIN
    const coverBottom = Math.max(0, b.bottom - atBottom)
    const coverTop = Math.max(0, atTop + max - b.top)
    top = coverBottom <= coverTop ? atBottom : atTop
    el.style.left = `${vp.left + MARGIN}px`
    el.style.top = `${Math.round(top)}px`
    el.style.maxHeight = `${max}px`
    return
  }
  el.style.left = `${left}px`
  el.style.top = `${Math.round(top)}px`
  if (max < h) el.style.maxHeight = `${Math.floor(max)}px`
}

const icon = (C: typeof Copy) => <C size={16} strokeWidth={1.75} aria-hidden />

export function CellMenu({ getBox, label, cells, editable, pick, areaOn, canFillDown, canFillRight, more, t, on, onClose }: CellMenuProps) {
  const ref = useRef<HTMLDivElement>(null)
  const [view, setView] = useState<'main' | 'pick' | 'more'>('main')
  const boxRef = useRef(getBox)
  boxRef.current = getBox
  const closeRef = useRef(onClose)
  closeRef.current = onClose

  /** an entry: close first (the keyboard goes back), then act */
  const act = (run: () => void) => () => {
    onClose('action')
    run()
  }

  /** an entry: its full name, its visible text (keys: a mono legend), what it does (closing the menu first) */
  const entry = (id: string, label: string, text: string, i: typeof Copy, run: () => void, extra: Partial<Entry> = {}): Entry => ({ id, label, text, icon: i, run: act(run), ...extra })
  const copy = entry('copy', t('features.sheets.copy'), t('features.sheets.touch.copy'), Copy, on.copy)
  const groups: Group[] = editable
    ? [
        {
          kind: 'rows',
          items: [
            {
              ...entry('pick', t('features.sheets.menu.pick', { addr: pick.addr }), t('features.sheets.menu.pickShort'), ListChecks, () => undefined),
              disabled: !pick.entries.length,
              hint: (
                <>
                  <span className="sh-cmenu__count">{pick.entries.length || '—'}</span>
                  <ChevronRight size={14} aria-hidden />
                </>
              ),
              run: () => setView('pick'),
            },
            entry('area', t('features.sheets.touch.addArea'), t('features.sheets.touch.area'), SquareDashedPlus, on.area, { on: areaOn, hint: areaOn ? <i className="led led--on" aria-hidden /> : undefined }),
            entry('edit', t('features.sheets.menu.edit', { addr: pick.addr }), t('features.sheets.menu.editShort'), PencilLine, on.edit),
          ],
        },
        {
          kind: 'keys',
          items: [copy, entry('cut', t('features.sheets.cut'), t('features.sheets.touch.cut'), Scissors, on.cut), entry('paste', t('features.sheets.paste'), t('features.sheets.touch.paste'), ClipboardPaste, on.paste)],
        },
        {
          kind: 'keys',
          items: [
            entry('fill-down', t('features.sheets.fillDown'), t('features.sheets.touch.fillDown'), ArrowDownToLine, on.fillDown, { disabled: !canFillDown }),
            entry('fill-right', t('features.sheets.fillRight'), t('features.sheets.touch.fillRight'), ArrowRightToLine, on.fillRight, { disabled: !canFillRight }),
            entry('clear', t('features.sheets.clear'), t('features.sheets.touch.clear'), Eraser, on.clear),
          ],
        },
        {
          kind: 'keys',
          items: [
            entry('chart', t('features.sheets.touch.chart'), t('features.sheets.touch.chartShort'), ChartColumnBig, on.chart),
            { ...entry('more', t('features.sheets.touch.more'), t('features.sheets.menu.more'), Ellipsis, () => undefined), run: () => setView('more') },
          ],
        },
      ]
    : [{ kind: 'rows', items: [copy] }]

  // above / below the selection, measured before the first paint and whenever the content changes size
  useLayoutEffect(() => {
    if (ref.current) place(ref.current, boxRef.current())
  }, [view, label])

  // into a sub-view: the focus onto its back row (not the search field: no keyboard pops up); back: the menu
  const shown = useRef(view)
  useEffect(() => {
    if (shown.current === view) return
    shown.current = view
    ref.current?.querySelector<HTMLElement>(view === 'main' ? '[data-autofocus]' : '.sh-cmenu__back')?.focus({ preventScroll: true })
  }, [view])

  useEffect(() => {
    const el = ref.current
    if (!el) return
    const again = () => place(el, boxRef.current())
    const ro = new ResizeObserver(again)
    ro.observe(el)
    const vv = window.visualViewport
    vv?.addEventListener('resize', again)
    window.addEventListener('resize', again)
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.stopPropagation()
      e.preventDefault()
      closeRef.current('dismiss')
    }
    // a press outside — its pointerdown or, where pointer events fail, its touchstart
    const onDown = (e: PointerEvent | TouchEvent) => {
      const target = e.target as Element
      if (el.contains(target) || target.closest?.('[data-popover]')) return
      // not the second click of the double-click that closed a dialog over it
      outsidePress(e, () => closeRef.current('press'))
    }
    const onScroll = (e: Event) => {
      if (el.contains(e.target as Node)) return
      // the search field brought the keyboard up (the page scrolls it into view): stay, re-placed
      if (el.contains(document.activeElement) && document.activeElement?.tagName === 'INPUT') return again()
      closeRef.current('dismiss')
    }
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('pointerdown', onDown, true)
    document.addEventListener('touchstart', onDown, { capture: true, passive: true })
    window.addEventListener('scroll', onScroll, true)
    // the focus into the menu, onto no entry (a finger opened it: no focus ring, no keyboard)
    const id = requestAnimationFrame(() => el.querySelector<HTMLElement>('[data-autofocus]')?.focus({ preventScroll: true }))
    return () => {
      cancelAnimationFrame(id)
      ro.disconnect()
      vv?.removeEventListener('resize', again)
      window.removeEventListener('resize', again)
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('pointerdown', onDown, true)
      document.removeEventListener('touchstart', onDown, true)
      window.removeEventListener('scroll', onScroll, true)
    }
  }, [])

  /** arrows move along the entries (rows, then the keys line by line) */
  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    const step = ({ ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 } as Record<string, number>)[e.key] ?? 0
    if (!step && e.key !== 'Home' && e.key !== 'End') return
    const items = [...e.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')]
    if (!items.length) return
    e.preventDefault()
    const i = items.indexOf(document.activeElement as HTMLButtonElement)
    const next = e.key === 'Home' ? 0 : e.key === 'End' ? items.length - 1 : i < 0 ? (step > 0 ? 0 : items.length - 1) : (i + step + items.length) % items.length
    items[next].focus()
  }

  const back = (text: string) => (
    <button type="button" className="sh-cmenu__back" onClick={() => setView('main')} aria-label={`${t('common.back')}: ${text}`}>
      <ChevronLeft size={15} strokeWidth={1.75} aria-hidden />
      <span className="label">{text}</span>
    </button>
  )

  return createPortal(
    <div
      ref={ref}
      className="sh-cmenu"
      data-popover=""
      role="dialog"
      aria-label={t('features.sheets.menu.title', { ref: label })}
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="sh-cmenu__body" tabIndex={-1} data-autofocus="" onKeyDown={view === 'main' ? onKeyDown : undefined}>
        {view === 'main' && (
          <>
            <div className="sh-cmenu__head label">
              <span className="sh-cmenu__ref">{label}</span>
              <span>{t(cells === 1 ? 'features.sheets.menu.cells1' : 'features.sheets.menu.cells', { n: cells })}</span>
            </div>
            <div className="sh-cmenu__list" role="menu" aria-label={t('features.sheets.menu.actions')}>
              {groups.map((g, gi) => (
                <div key={gi} className={`sh-cmenu__group is-${g.kind}`} role="group">
                  {g.items.map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      role="menuitem"
                      className={g.kind === 'rows' ? 'sh-cmenu__row' : 'sh-cmenu__key'}
                      data-entry={k.id}
                      aria-label={k.label}
                      aria-pressed={k.on === undefined ? undefined : k.on}
                      disabled={k.disabled}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={k.run}
                    >
                      {icon(k.icon)}
                      <span className={g.kind === 'rows' ? 'sh-cmenu__text' : 'sh-cmenu__legend'}>{k.text}</span>
                      {k.hint && <span className="sh-cmenu__hint">{k.hint}</span>}
                    </button>
                  ))}
                </div>
              ))}
            </div>
          </>
        )}
        {view === 'pick' && (
          <>
            {back(t('features.sheets.menu.pickHead', { addr: pick.addr }))}
            <PickPanel entries={pick.entries} column={pick.column} t={t} onPick={(v) => act(() => on.pick(v))()} autoFocus={false} touch />
          </>
        )}
        {view === 'more' && (
          <>
            {back(t('features.sheets.touch.more'))}
            <div className="sh-cmenu__more">
              <MenuList entries={more} onClose={() => onClose('action')} />
            </div>
          </>
        )}
      </div>
    </div>,
    document.body,
  )
}

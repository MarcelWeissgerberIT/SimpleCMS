/**
 * Touch action bar: an ink key strip floating above the selection (below it when there is no
 * room) — Copy · Cut · Paste · Fill ↓ · Fill → · Clear · Chart · + Area · ⋯. It never takes the
 * keyboard (the grid or the formula keeps it), hides while anything scrolls, and stacks its key
 * groups in two rows where one row doesn't fit (⋯ stays at the end).
 */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react'
import { ArrowDownToLine, ArrowRightToLine, ChartColumnBig, ClipboardPaste, Copy, Ellipsis, Eraser, Scissors, SquareDashedPlus } from 'lucide-react'

export interface BarKey {
  id: string
  /** full name (aria-label, tooltip) */
  label: string
  /** mono legend under the icon */
  legend: string
  icon: ReactNode
  disabled?: boolean
  /** latched (aria-pressed) */
  on?: boolean
  /** latched by a long-press drag: drawn as a hint (the next long press adds) */
  hint?: boolean
  onPress: (el: HTMLButtonElement) => void
}

export interface TouchBarProps {
  /** the visible part of the selection in client coordinates (null: out of view) */
  getBox: () => DOMRect | null
  /** changes whenever the box moves for another reason than scrolling (selection, sheet, mode) */
  boxKey: string
  /** whose scrolling ancestors move the box */
  contextElement: Element | null
  /** the bar stays inside (the page's scroll column) */
  boundary: Element | null
  /** groups of keys (a rule between groups) */
  groups: BarKey[][]
  /** pinned at the end */
  more?: BarKey
  label: string
  /** 'over' the box (below it when there is no room); 'inside' its bottom-right corner */
  placement?: 'over' | 'inside'
}

/** room for the top-left handle above the selection, for the bottom-right handle + fill tab below it */
const ABOVE = 12
const BELOW = 46
const INSET = 8
const SETTLE_MS = 220

/** One key of the strip (also the long-press sheet's keys). */
export function Key({ k, autoFocus }: { k: BarKey; autoFocus?: boolean }) {
  return (
    <button
      type="button"
      className={`sh-touchbar__key${k.hint ? ' is-hint' : ''}`}
      data-key={k.id}
      data-autofocus={autoFocus ? '' : undefined}
      aria-label={k.label}
      title={k.label}
      aria-pressed={k.on === undefined ? undefined : k.on}
      disabled={k.disabled}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => k.onPress(e.currentTarget)}
    >
      {k.icon}
      <span className="sh-touchbar__legend">{k.legend}</span>
    </button>
  )
}

export function TouchBar({ getBox, boxKey, contextElement, boundary, groups, more, label, placement = 'over' }: TouchBarProps) {
  const [quiet, setQuiet] = useState(false)
  /** one row didn't fit (a narrow phone, long legends): the groups wrap */
  const [stacked, setStacked] = useState(false)
  const keysEl = useRef<HTMLDivElement | null>(null)
  const floatingEl = useRef<HTMLDivElement | null>(null)
  const boxRef = useRef(getBox)
  boxRef.current = getBox
  const last = useRef<DOMRect>(new DOMRect())

  const { refs, floatingStyles, update, isPositioned } = useFloating({
    placement: placement === 'over' ? 'top' : 'bottom-end',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    middleware:
      placement === 'over'
        ? [
            offset(({ placement: p }) => (p.startsWith('bottom') ? BELOW : ABOVE)),
            flip({ boundary: boundary ?? 'clippingAncestors', padding: 8, fallbackPlacements: ['bottom'] }),
            shift({ boundary: boundary ?? 'clippingAncestors', padding: 8 }),
          ]
        : [offset(({ rects }) => ({ mainAxis: -rects.floating.height - INSET, alignmentAxis: INSET }))],
  })

  useLayoutEffect(() => {
    refs.setPositionReference({
      getBoundingClientRect: () => {
        const b = boxRef.current()
        if (b) last.current = b
        return last.current
      },
      contextElement: contextElement ?? undefined,
    })
  }, [refs, contextElement])

  useLayoutEffect(() => {
    update()
  }, [boxKey, update])

  const legends = groups.map((g) => g.map((k) => k.legend).join()).join('|')
  useLayoutEffect(() => setStacked(false), [legends])
  useLayoutEffect(() => {
    const el = keysEl.current
    if (el && !stacked && el.scrollWidth > el.clientWidth + 1) setStacked(true)
  })

  // out of the way while the page or the grid scrolls; back where the selection is once it settles
  useEffect(() => {
    let timer = 0
    const onScroll = (e: Event) => {
      if (floatingEl.current?.contains(e.target as Node)) return
      setQuiet(true)
      window.clearTimeout(timer)
      timer = window.setTimeout(() => setQuiet(false), SETTLE_MS)
    }
    window.addEventListener('scroll', onScroll, true)
    return () => {
      window.removeEventListener('scroll', onScroll, true)
      window.clearTimeout(timer)
    }
  }, [])

  if (quiet || !getBox()) return null
  return createPortal(
    <div
      ref={(el) => {
        floatingEl.current = el
        refs.setFloating(el)
      }}
      className={`sh-touchbar${stacked ? ' is-stacked' : ''}`}
      data-popover=""
      role="toolbar"
      aria-label={label}
      style={{ ...floatingStyles, visibility: isPositioned ? undefined : 'hidden' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      <div ref={keysEl} className="sh-touchbar__keys">
        {groups.map((g, i) => (
          <div key={i} className="sh-touchbar__group">
            {g.map((k) => (
              <Key key={k.id} k={k} />
            ))}
          </div>
        ))}
      </div>
      {more && <Key k={more} />}
    </div>,
    document.body,
  )
}

interface SheetKeysOptions {
  t: (key: string, vars?: Record<string, string | number>) => string
  /** select: the selection's keys · point: building a formula reference (only "+ Area") */
  mode: 'select' | 'point'
  editable: boolean
  /** "+ Area" is latched ('hold': by a long-press drag — the next long press adds another area) */
  addArea: boolean | 'hold'
  fillDown: boolean
  fillRight: boolean
  on: Record<'copy' | 'cut' | 'paste' | 'fillDown' | 'fillRight' | 'clear' | 'chart' | 'area', () => void> & { more: (el: HTMLElement) => void }
}

const icon = (C: typeof Copy) => <C size={16} strokeWidth={1.75} />

/** The spreadsheet's keys: Copy · Cut · Paste | Fill ↓ · Fill → · Clear | Chart · + Area, ⋯ — read-only: Copy. */
export function sheetBarKeys({ t, mode, editable, addArea, fillDown, fillRight, on }: SheetKeysOptions): { groups: BarKey[][]; more?: BarKey } {
  const k = (id: string, label: string, legend: string, i: typeof Copy, onPress: () => void, extra: Partial<BarKey> = {}): BarKey => ({
    id,
    label: t(label),
    legend: t(legend),
    icon: icon(i),
    onPress,
    ...extra,
  })
  const area = k('area', 'features.sheets.touch.addArea', 'features.sheets.touch.area', SquareDashedPlus, on.area, { on: !!addArea, hint: addArea === 'hold' })
  if (mode === 'point') return { groups: [[area]] }
  const copy = k('copy', 'features.sheets.copy', 'features.sheets.touch.copy', Copy, on.copy)
  if (!editable) return { groups: [[copy]] }
  return {
    groups: [
      [copy, k('cut', 'features.sheets.cut', 'features.sheets.touch.cut', Scissors, on.cut), k('paste', 'features.sheets.paste', 'features.sheets.touch.paste', ClipboardPaste, on.paste)],
      [
        k('fill-down', 'features.sheets.fillDown', 'features.sheets.touch.fillDown', ArrowDownToLine, on.fillDown, { disabled: !fillDown }),
        k('fill-right', 'features.sheets.fillRight', 'features.sheets.touch.fillRight', ArrowRightToLine, on.fillRight, { disabled: !fillRight }),
        k('clear', 'features.sheets.clear', 'features.sheets.touch.clear', Eraser, on.clear),
      ],
      [k('chart', 'features.sheets.touch.chart', 'features.sheets.touch.chartShort', ChartColumnBig, on.chart), area],
    ],
    more: { ...k('more', 'features.sheets.touch.more', 'features.sheets.touch.moreShort', Ellipsis, () => undefined), onPress: on.more },
  }
}

/**
 * CodeArea — the shared highlighted text field for code and written instructions (agent jobs, One Script,
 * configuration). A plain <textarea> with transparent text lies over the highlighted lines (render.tsx), with
 * the same font and metrics, so the browser keeps doing selection, undo, IME, spell-free typing and
 * accessibility; the lines underneath only paint.
 *
 * - line numbers, the current line (while focused), soft wrap (toggle in the bar; remembered per device with
 *   `storageKey`), a height people can drag (`resizable`)
 * - Tab / Shift+Tab indent and outdent (the whole selection), Enter keeps the indentation (`enter`), a closing
 *   bracket on an empty line steps back; Esc, then Tab leaves the field (no keyboard trap — a visually hidden
 *   hint says so, and the first Esc does not close a surrounding dialog)
 * - the bracket pair at the caret; with `brackets="strict"` unmatched brackets are marked too
 * - problems (`markers`): squiggle, a mark in the gutter, the message after the line's end (never over the
 *   code) and a list below the field whose entries jump to the place; the list describes the textarea
 * - open placeholders (`placeholders` = a pattern): highlighted, counted in the bar ("3 placeholders open"),
 *   "Next placeholder" selects the next one
 * - token colours from tokens.css --syn-* (ui/code/syntax.css)
 *
 * Geometry for callers that float things over the text (completion lists): `overlay(geo)` renders inside the
 * area's box; geo.pointAt(offset) is exact without wrap (monospace math) and measured with wrap.
 */
import { useCallback, useDeferredValue, useEffect, useId, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type Ref, type TextareaHTMLAttributes } from 'react'
import { WrapText } from 'lucide-react'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'
import { useT } from '../../i18n'
import type { CodeMarker, MarkerSeverity, Tokenizer } from './types'
import { lineIndexAt, lineStarts, markerRange, offsetAt as offsetOf, tokensByLine, withRanges, type LineSeg } from './lines'
import { findPlaceholders } from './placeholders'
import { pairAt, scanBrackets } from './brackets'
import { Row, decoSig, segSig, type LineDeco, type RenderToken } from './render'
import './syntax.css'
import './code.css'

export interface CodeGeometry {
  /** where an offset's character starts, relative to the area's box (scrolling included) */
  pointAt: (offset: number) => { x: number; y: number }
  lineH: number
  charW: number
  /** the visible box of the text (relative to the area's box): overlays keep inside it */
  box: { left: number; top: number; width: number; height: number }
}

export interface CodeAreaHandle {
  textarea: HTMLTextAreaElement | null
  geometry: () => CodeGeometry
  /** the text offset under a point of the screen (null outside the text) */
  offsetAtPoint: (clientX: number, clientY: number) => number | null
  /** replace [from, to) keeping the browser's undo stack */
  insert: (from: number, to: number, text: string) => void
  /** focus and select a place (1-based line / col), scrolled into view */
  reveal: (line: number, col: number, len?: number) => void
}

export interface CodeAreaProps {
  value: string
  onChange?: (value: string, caret: number) => void
  tokenize?: Tokenizer
  markers?: CodeMarker[]
  /** open placeholders to highlight and count (null / absent = none) */
  placeholders?: RegExp | null
  onPlaceholders?: (count: number) => void
  lineNumbers?: boolean
  /** soft wrap at first (the bar's switch changes it; `storageKey` remembers it) */
  wrap?: boolean
  wrapToggle?: boolean
  /** per device: soft wrap and the dragged height (localStorage `one.code.<storageKey>`) */
  storageKey?: string
  resizable?: boolean
  /** the height comes from the caller's CSS (`--ca-height` on the area) instead of the rows below */
  fixedHeight?: boolean
  /** the height without a dragged one: grows with the text between these */
  minRows?: number
  maxRows?: number
  /** 'match' = the pair at the caret · 'strict' = also every unmatched bracket · false = none */
  brackets?: 'match' | 'strict' | false
  /** Enter: keep the indentation (code) · continue the list (Markdown) · the browser's own */
  enter?: 'indent' | 'list' | 'plain'
  /** Tab / Shift+Tab indent (false: Tab moves on, as in any field) */
  indent?: boolean
  readOnly?: boolean
  maxLength?: number
  placeholder?: string
  id?: string
  ariaLabel?: string
  /** more ids that describe the field (a hint, an error) */
  describedBy?: string
  invalid?: boolean
  disabled?: boolean
  /** draws a token itself (One Script's @ chips: exactly as wide as their text) */
  renderToken?: RenderToken
  /** first look at every key; true = handled */
  onKeyDown?: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean | void
  onSelectionChange?: (from: number, to: number) => void
  onFocusChange?: (focused: boolean) => void
  /** the bar: its left part (null = none), the whole bar off with false */
  bar?: ReactNode | false
  /** the problems list below the field (default on) */
  problemList?: boolean
  className?: string
  inputClassName?: string
  inputProps?: TextareaHTMLAttributes<HTMLTextAreaElement> & Record<`data-${string}`, string | undefined>
  overlay?: (geo: CodeGeometry) => ReactNode
  /** focus a place: { line, col, n } (a new n each time) */
  jump?: { line: number; col: number; len?: number; n: number } | null
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>
  ref?: Ref<CodeAreaHandle>
  testId?: string
}

const SYNC_MAX = 20_000
const INDENT = '  '
const SEV_RANK: Record<MarkerSeverity, number> = { error: 3, warning: 2, info: 1 }
const STORE = 'one.code.'

interface Stored {
  wrap?: boolean
  h?: number
}
function loadStored(key?: string): Stored {
  if (!key) return {}
  try {
    const v = JSON.parse(safeLocalGet(STORE + key) ?? 'null') as Stored | null
    return v && typeof v === 'object' ? { wrap: typeof v.wrap === 'boolean' ? v.wrap : undefined, h: typeof v.h === 'number' && v.h > 40 && v.h < 5000 ? Math.round(v.h) : undefined } : {}
  } catch {
    return {}
  }
}
function saveStored(key: string | undefined, patch: Stored) {
  if (!key) return
  const next = { ...loadStored(key), ...patch }
  safeLocalSet(STORE + key, JSON.stringify(next))
}

export function CodeArea(props: CodeAreaProps) {
  const {
    value,
    onChange,
    tokenize,
    markers,
    placeholders = null,
    onPlaceholders,
    lineNumbers = true,
    wrap: wrapInit = false,
    wrapToggle = true,
    storageKey,
    resizable = false,
    fixedHeight = false,
    minRows = 4,
    maxRows = 24,
    brackets = 'match',
    enter = 'indent',
    indent = true,
    readOnly,
    maxLength,
    placeholder,
    id: idProp,
    ariaLabel,
    describedBy,
    invalid,
    disabled,
    renderToken,
    onKeyDown,
    onSelectionChange,
    onFocusChange,
    bar,
    problemList = true,
    className,
    inputClassName,
    inputProps,
    overlay,
    jump,
    textareaRef,
    ref,
    testId,
  } = props
  const t = useT()
  const uid = useId()
  const id = idProp ?? `${uid}-ca`
  const hintId = `${id}-keys`
  const listId = `${id}-problems`
  const root = useRef<HTMLDivElement | null>(null)
  const scroller = useRef<HTMLDivElement | null>(null)
  const ta = useRef<HTMLTextAreaElement | null>(null)
  const measure = useRef<HTMLSpanElement | null>(null)
  const escaped = useRef(false)
  const [sel, setSel] = useState({ from: 0, to: 0 })
  const [focused, setFocused] = useState(false)
  const [metrics, setMetrics] = useState({ charW: 7.8, lineH: 20, padX: 12, padY: 10 })
  const [, setScrollTick] = useState(0)
  const stored = useMemo(() => loadStored(storageKey), [storageKey])
  const [wrap, setWrap] = useState(stored.wrap ?? wrapInit)
  const [height, setHeight] = useState<number | null>(resizable ? (stored.h ?? null) : null)

  /* ---------------------------------------------------------------- text, tokens, decorations */

  const deferred = useDeferredValue(value)
  const source = value.length <= SYNC_MAX ? value : deferred
  const starts = useMemo(() => lineStarts(value), [value])
  const lines = useMemo(() => value.split('\n'), [value])
  const phHits = useMemo(() => (placeholders ? findPlaceholders(source, placeholders) : []), [source, placeholders])
  const tokens = useMemo(() => withRanges(tokenize ? tokenize(source) : [], phHits, 'ph'), [source, tokenize, phHits])
  const srcLines = useMemo(() => (source === value ? lines : source.split('\n')), [source, value, lines])
  const segsByLine = useMemo(() => tokensByLine(source, source === value ? starts : lineStarts(source), tokens), [source, value, starts, tokens])
  const bracketInfo = useMemo(() => (brackets ? scanBrackets(source, tokens) : null), [brackets, source, tokens])
  const phCount = useMemo(() => (placeholders ? (source === value ? phHits.length : findPlaceholders(value, placeholders).length) : 0), [placeholders, phHits, source, value])

  useEffect(() => {
    onPlaceholders?.(phCount)
  }, [phCount, onPlaceholders])

  // problems → per line: squiggles, the gutter mark, the message after the line
  const problems = useMemo(() => {
    const byLine = new Map<number, { decos: LineDeco[]; mark: MarkerSeverity | null; lens: string | null; lensRank: number }>()
    const at = (i: number) => {
      let e = byLine.get(i)
      if (!e) byLine.set(i, (e = { decos: [], mark: null, lens: null, lensRank: 0 }))
      return e
    }
    for (const m of markers ?? []) {
      const r = markerRange(value, starts, m)
      const first = lineIndexAt(starts, r.from)
      const last = lineIndexAt(starts, Math.max(r.from, r.to - 1))
      for (let li = first; li <= last; li++) {
        const ls = starts[li]
        const le = li + 1 < starts.length ? starts[li + 1] - 1 : value.length
        const a = Math.max(r.from, ls) - ls
        const b = Math.min(r.to, le) - ls
        at(li).decos.push({ start: a, end: Math.max(a, b), kind: m.severity })
      }
      const e = at(first)
      if (!e.mark || SEV_RANK[m.severity] > SEV_RANK[e.mark]) e.mark = m.severity
      if (SEV_RANK[m.severity] > e.lensRank) {
        e.lens = m.message
        e.lensRank = SEV_RANK[m.severity]
      }
    }
    if (bracketInfo && brackets === 'strict' && source === value)
      for (const off of bracketInfo.unmatched) {
        const li = lineIndexAt(starts, off)
        at(li).decos.push({ start: off - starts[li], end: off - starts[li] + 1, kind: 'bad' })
      }
    return byLine
  }, [markers, value, starts, bracketInfo, brackets, source])

  const caretLine = lineIndexAt(starts, sel.to)
  const caretCol = sel.to - starts[caretLine]
  const match = focused && sel.from === sel.to && bracketInfo && source === value ? pairAt(bracketInfo, value, sel.to) : null

  /* ---------------------------------------------------------------- metrics */

  useLayoutEffect(() => {
    const el = measure.current
    const area = ta.current
    if (!el || !area) return
    const read = () => {
      const w = el.getBoundingClientRect().width / 10
      const cs = getComputedStyle(area)
      const lh = parseFloat(cs.lineHeight)
      const next = { charW: w > 0 ? w : 7.8, lineH: Number.isFinite(lh) && lh > 0 ? lh : 20, padX: parseFloat(cs.paddingLeft) || 0, padY: parseFloat(cs.paddingTop) || 0 }
      setMetrics((m) => (Math.abs(m.charW - next.charW) < 0.01 && m.lineH === next.lineH && m.padX === next.padX && m.padY === next.padY ? m : next))
    }
    read()
    const ro = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(read) : null
    ro?.observe(el)
    void document.fonts?.ready.then(read)
    return () => ro?.disconnect()
  }, [])

  /* ---------------------------------------------------------------- geometry */

  const gutterW = () => ta.current?.offsetLeft ?? 0
  const geometry = useCallback((): CodeGeometry => {
    const sc = scroller.current
    const rootBox = root.current?.getBoundingClientRect()
    const scBox = sc?.getBoundingClientRect()
    const offX = rootBox && scBox ? scBox.left - rootBox.left : 0
    const offY = rootBox && scBox ? scBox.top - rootBox.top : 0
    const left = sc?.scrollLeft ?? 0
    const top = sc?.scrollTop ?? 0
    const g = gutterW()
    const pointAt = (offset: number) => {
      const st = lineStarts(ta.current?.value ?? value)
      const li = lineIndexAt(st, offset)
      const col = offset - st[li]
      if (!wrap) return { x: offX + g + metrics.padX + col * metrics.charW - left, y: offY + metrics.padY + li * metrics.lineH - top }
      // soft wrap: measure the drawn line
      const row = sc?.querySelectorAll<HTMLElement>('.ca__row')[li]
      const text = row?.querySelector<HTMLElement>('.ca__text')
      const rect = text ? caretRect(text, col) : null
      if (rect && rootBox) return { x: rect.left - rootBox.left, y: rect.top - rootBox.top }
      return { x: offX + g + metrics.padX - left, y: offY + (row ? row.offsetTop : metrics.padY + li * metrics.lineH) - top }
    }
    return { pointAt, lineH: metrics.lineH, charW: metrics.charW, box: { left: offX + g, top: offY, width: (sc?.clientWidth ?? 0) - g, height: sc?.clientHeight ?? 0 } }
  }, [metrics, value, wrap])

  const offsetAtPoint = (clientX: number, clientY: number): number | null => {
    const el = ta.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const y = clientY - r.top - metrics.padY
    const x = clientX - r.left - metrics.padX
    const ls = (el.value ?? value).split('\n')
    let li: number
    let col: number
    if (wrap) {
      const rows = scroller.current?.querySelectorAll<HTMLElement>('.ca__row')
      li = -1
      rows?.forEach((row, i) => {
        if (clientY >= row.getBoundingClientRect().top) li = i
      })
      col = Math.floor(x / metrics.charW)
    } else {
      li = Math.floor(y / metrics.lineH)
      col = Math.floor(x / metrics.charW)
    }
    if (li < 0 || li >= ls.length || col < 0 || col > ls[li].length) return null
    let off = 0
    for (let i = 0; i < li; i++) off += ls[i].length + 1
    return off + col
  }

  /** keeps the caret's line in view (the textarea itself never scrolls: the box around it does) */
  const revealOffset = useCallback(
    (offset: number) => {
      const sc = scroller.current
      if (!sc) return
      const st = lineStarts(ta.current?.value ?? value)
      const li = lineIndexAt(st, offset)
      const row = sc.querySelectorAll<HTMLElement>('.ca__row')[li]
      const top = row ? row.offsetTop : metrics.padY + li * metrics.lineH
      const h = row ? row.offsetHeight : metrics.lineH
      if (top < sc.scrollTop + metrics.padY) sc.scrollTop = Math.max(0, top - metrics.padY - metrics.lineH)
      else if (top + h > sc.scrollTop + sc.clientHeight - metrics.padY) sc.scrollTop = top + h - sc.clientHeight + metrics.padY + metrics.lineH
      if (!wrap) {
        const x = gutterW() + metrics.padX + (offset - st[li]) * metrics.charW
        const g = gutterW()
        if (x < sc.scrollLeft + g + metrics.padX) sc.scrollLeft = Math.max(0, x - g - metrics.padX * 2)
        else if (x > sc.scrollLeft + sc.clientWidth - metrics.padX * 2) sc.scrollLeft = x - sc.clientWidth + metrics.padX * 3
      }
    },
    [metrics, value, wrap],
  )

  /* ---------------------------------------------------------------- editing */

  const insert = useCallback(
    (from: number, to: number, text: string, select?: [number, number]) => {
      const el = ta.current
      if (!el) return
      el.focus()
      el.setSelectionRange(from, to)
      const before = el.value
      // keeps the textarea's own undo stack (falls back to a plain replace)
      const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
      if (!ok || el.value === before) {
        if (el.value === before && before.slice(from, to) !== text) {
          const next = before.slice(0, from) + text + before.slice(to)
          onChange?.(next, from + text.length)
          requestAnimationFrame(() => {
            el.setSelectionRange(select?.[0] ?? from + text.length, select?.[1] ?? from + text.length)
          })
          return
        }
      }
      if (select) el.setSelectionRange(select[0], select[1])
    },
    [onChange],
  )

  const reveal = useCallback(
    (line: number, col: number, len = 0) => {
      const el = ta.current
      if (!el) return
      const st = lineStarts(el.value)
      const off = offsetOf(el.value, st, line, col)
      el.focus({ preventScroll: true })
      el.setSelectionRange(off, Math.min(el.value.length, off + len))
      setSel({ from: off, to: off + len })
      requestAnimationFrame(() => revealOffset(off))
    },
    [revealOffset],
  )

  // typing keeps the caret in view (after the lines are drawn again)
  useLayoutEffect(() => {
    const el = ta.current
    if (el && document.activeElement === el) revealOffset(el.selectionEnd)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  useImperativeHandle(ref, () => ({ textarea: ta.current, geometry, offsetAtPoint, insert: (a, b, s) => insert(a, b, s), reveal }))

  useEffect(() => {
    if (jump) reveal(jump.line, jump.col, jump.len ?? 0)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.n])

  const setRef = (el: HTMLTextAreaElement | null) => {
    ta.current = el
    if (textareaRef) textareaRef.current = el
  }

  const keyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    inputProps?.onKeyDown?.(e)
    if (e.defaultPrevented) return
    if (onKeyDown?.(e)) return
    const el = e.currentTarget
    if (e.key === 'Shift' || e.key === 'Control' || e.key === 'Alt' || e.key === 'Meta') return
    if (e.key === 'Escape') {
      // the first Esc only lets go of Tab (and keeps a dialog around open); a second one goes on
      if (indent && !escaped.current) {
        escaped.current = true
        e.stopPropagation()
      }
      return
    }
    if (readOnly || disabled) return
    const v = el.value
    const { selectionStart: a, selectionEnd: b } = el
    if (e.key === 'Tab' && indent && !e.metaKey && !e.ctrlKey && !e.altKey) {
      if (escaped.current) return
      e.preventDefault()
      const ls = v.lastIndexOf('\n', a - 1) + 1
      const multi = a !== b && v.slice(a, b).includes('\n')
      if (e.shiftKey || multi) {
        const endAt = b > a && v[b - 1] === '\n' ? b - 1 : b
        const le = v.indexOf('\n', endAt)
        const block = v.slice(ls, le < 0 ? v.length : le)
        const out = e.shiftKey ? block.replace(/^( {1,2}|\t)/gm, '') : block.replace(/^(?=.)/gm, INDENT)
        if (out === block) return
        const range: [number, number] = multi ? [ls, ls + out.length] : [Math.max(ls, a + (out.length - block.length)), Math.max(ls, b + (out.length - block.length))]
        insert(ls, ls + block.length, out, range)
        return
      }
      insert(a, b, INDENT)
      return
    }
    escaped.current = false
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey && enter !== 'plain' && !e.nativeEvent.isComposing) {
      const ls = v.lastIndexOf('\n', a - 1) + 1
      const head = v.slice(ls, a)
      const lead = /^[ \t]*/.exec(head)![0]
      if (enter === 'list') {
        const m = /^(\s*)([-*+]|(\d{1,9})([.)]))(\s+)(\[[ xX]\]\s+)?/.exec(head)
        if (!m) {
          if (!lead) return
          e.preventDefault()
          insert(a, b, `\n${lead}`)
          return
        }
        e.preventDefault()
        // an empty item ends the list
        if (head.length === m[0].length && !v.slice(b, (v.indexOf('\n', b) + 1 || v.length + 1) - 1).trim()) {
          insert(ls, a, '')
          return
        }
        const marker = m[3] ? `${Number(m[3]) + 1}${m[4]}` : m[2]
        insert(a, b, `\n${m[1]}${marker}${m[5]}${m[6] ? '[ ] ' : ''}`)
        return
      }
      e.preventDefault()
      const opens = /[{([]\s*$/.test(head)
      const closes = /^\s*[})\]]/.test(v.slice(b, v.indexOf('\n', b) < 0 ? v.length : v.indexOf('\n', b)))
      if (opens && closes) {
        const mid = `\n${lead}${INDENT}`
        insert(a, b, `${mid}\n${lead}`, [a + mid.length, a + mid.length])
        return
      }
      insert(a, b, `\n${lead}${opens ? INDENT : ''}`)
      return
    }
    if (enter === 'indent' && a === b && (e.key === '}' || e.key === ']' || e.key === ')')) {
      const ls = v.lastIndexOf('\n', a - 1) + 1
      const head = v.slice(ls, a)
      if (/^ {2,}$/.test(head)) {
        e.preventDefault()
        insert(a - 2, a, e.key)
      }
    }
  }

  const syncSel = () => {
    const el = ta.current
    if (!el) return
    const next = { from: el.selectionStart, to: el.selectionEnd }
    setSel((s) => (s.from === next.from && s.to === next.to ? s : next))
    onSelectionChange?.(next.from, next.to)
  }

  const nextPlaceholder = () => {
    const el = ta.current
    if (!el || !placeholders) return
    const hits = findPlaceholders(el.value, placeholders)
    if (!hits.length) return
    const h = hits.find((x) => x.start >= el.selectionEnd) ?? hits[0]
    el.focus({ preventScroll: true })
    el.setSelectionRange(h.start, h.end)
    setSel({ from: h.start, to: h.end })
    requestAnimationFrame(() => revealOffset(h.start))
  }

  /* ---------------------------------------------------------------- height */

  const autoMin = minRows * metrics.lineH + metrics.padY * 2
  const autoMax = maxRows * metrics.lineH + metrics.padY * 2
  const drag = useRef<{ y: number; h: number } | null>(null)
  const setH = (h: number) => {
    const next = Math.round(Math.max(autoMin, Math.min(h, 4000)))
    setHeight(next)
    saveStored(storageKey, { h: next })
  }
  const grip = resizable ? (
    <button
      type="button"
      className="ca__grip"
      aria-label={t('ui.code.resize')}
      title={t('ui.code.resizeHint')}
      onPointerDown={(e) => {
        const sc = scroller.current
        if (!sc) return
        e.preventDefault()
        e.currentTarget.setPointerCapture(e.pointerId)
        drag.current = { y: e.clientY, h: sc.getBoundingClientRect().height }
      }}
      onPointerMove={(e) => {
        if (drag.current) setH(drag.current.h + e.clientY - drag.current.y)
      }}
      onPointerUp={() => (drag.current = null)}
      onPointerCancel={() => (drag.current = null)}
      onDoubleClick={() => {
        setHeight(null)
        saveStored(storageKey, { h: undefined })
      }}
      onKeyDown={(e) => {
        const sc = scroller.current
        if (!sc) return
        const step = e.shiftKey ? metrics.lineH * 6 : metrics.lineH
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
          e.preventDefault()
          setH(sc.getBoundingClientRect().height + (e.key === 'ArrowDown' ? step : -step))
        } else if (e.key === 'Home') {
          e.preventDefault()
          setHeight(null)
          saveStored(storageKey, { h: undefined })
        }
      }}
    >
      <svg width="10" height="10" viewBox="0 0 10 10" aria-hidden>
        <path d="M1 4h8M1 7h8" stroke="currentColor" strokeWidth="1" strokeLinecap="square" fill="none" />
      </svg>
    </button>
  ) : null

  /* ---------------------------------------------------------------- render */

  const digits = Math.max(2, String(lines.length).length)
  const shownMarkers = useMemo(
    () =>
      [...(markers ?? [])].sort((a, b) => a.line - b.line || a.col - b.col || SEV_RANK[b.severity] - SEV_RANK[a.severity]),
    [markers],
  )
  const describe = [hintId, problemList && shownMarkers.length ? listId : null, describedBy, inputProps?.['aria-describedby']].filter(Boolean).join(' ') || undefined
  const sizeStyle = height !== null ? { height } : fixedHeight ? undefined : { minHeight: autoMin, maxHeight: autoMax }

  return (
    <div
      ref={root}
      className={`ca${className ? ` ${className}` : ''}`}
      data-wrap={wrap ? 'on' : 'off'}
      data-ln={lineNumbers ? 'on' : 'off'}
      data-focused={focused || undefined}
      data-invalid={invalid || undefined}
      data-disabled={disabled || undefined}
      data-testid={testId}
      style={{ ['--ca-digits' as string]: digits }}
    >
      <div
        ref={scroller}
        className="ca__scroll"
        style={sizeStyle}
        onScroll={() => {
          if (overlay) setScrollTick((n) => n + 1)
        }}
      >
        <div className="ca__sheet">
          <span ref={measure} className="ca__measure" aria-hidden>
            0000000000
          </span>
          <div className="ca__layer" aria-hidden>
            {lines.map((text, i) => {
              const fresh = srcLines[i] === text
              const segs: LineSeg[] = fresh ? (segsByLine[i] ?? []) : []
              const p = problems.get(i)
              let decos = p?.decos ?? []
              if (match) {
                const extra: LineDeco[] = []
                for (const off of match) {
                  const li = lineIndexAt(starts, off)
                  if (li === i) extra.push({ start: off - starts[i], end: off - starts[i] + 1, kind: 'match' })
                }
                if (extra.length) decos = [...decos, ...extra]
              }
              return (
                <Row
                  key={i}
                  n={i + 1}
                  text={text}
                  segs={segs}
                  decos={decos}
                  mark={p?.mark ?? null}
                  lens={wrap ? null : (p?.lens ?? null)}
                  cur={focused && i === caretLine}
                  ln={lineNumbers}
                  renderToken={renderToken}
                  segSig={segSig(segs)}
                  decoSig={decoSig(decos)}
                />
              )
            })}
          </div>
          <textarea
            {...inputProps}
            ref={setRef}
            id={id}
            className={`ca__input${inputClassName ? ` ${inputClassName}` : ''}`}
            value={value}
            spellCheck={false}
            autoCapitalize="off"
            autoComplete="off"
            autoCorrect="off"
            wrap={wrap ? 'soft' : 'off'}
            readOnly={readOnly}
            disabled={disabled}
            maxLength={maxLength}
            placeholder={placeholder}
            aria-label={ariaLabel}
            aria-invalid={invalid || shownMarkers.some((m) => m.severity === 'error') || undefined}
            aria-describedby={describe}
            onChange={(e) => {
              onChange?.(e.target.value, e.target.selectionStart)
              syncSel()
              inputProps?.onChange?.(e)
            }}
            onKeyDown={keyDown}
            onSelect={(e) => {
              syncSel()
              inputProps?.onSelect?.(e)
            }}
            onKeyUp={(e) => {
              if (/^(Arrow|Page|Home|End)/.test(e.key)) revealOffset(e.currentTarget.selectionEnd)
              inputProps?.onKeyUp?.(e)
            }}
            onFocus={(e) => {
              setFocused(true)
              onFocusChange?.(true)
              syncSel()
              inputProps?.onFocus?.(e)
            }}
            onBlur={(e) => {
              setFocused(false)
              escaped.current = false
              onFocusChange?.(false)
              inputProps?.onBlur?.(e)
            }}
          />
        </div>
      </div>
      {overlay?.(geometry())}
      {bar !== false && (
        <div className="ca__bar">
          {bar ? <span className="ca__bar-start">{bar}</span> : null}
          {placeholders && (
            <span className="ca__ph" data-open={phCount > 0 || undefined}>
              <span className={`led${phCount ? ' led--on' : ''}`} aria-hidden />
              <span role="status" data-testid="ca-placeholders">
                {phCount === 0 ? t('ui.code.placeholders.none') : t(phCount === 1 ? 'ui.code.placeholders.one' : 'ui.code.placeholders.other', { count: phCount })}
              </span>
              {phCount > 0 && (
                <button type="button" className="ca__barbtn" onMouseDown={(e) => e.preventDefault()} onClick={nextPlaceholder}>
                  {t('ui.code.placeholders.next')}
                </button>
              )}
            </span>
          )}
          <span className="ca__spacer" />
          <span className="ca__pos mono" aria-hidden>
            {t('ui.code.pos', { line: caretLine + 1, col: caretCol + 1 })}
          </span>
          {wrapToggle && (
            <button
              type="button"
              className="ca__barbtn ca__barbtn--icon"
              aria-pressed={wrap}
              aria-label={t('ui.code.wrap')}
              title={t('ui.code.wrap')}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => {
                setWrap(!wrap)
                saveStored(storageKey, { wrap: !wrap })
              }}
            >
              <WrapText size={14} strokeWidth={1.7} aria-hidden />
            </button>
          )}
          {grip}
        </div>
      )}
      {problemList && shownMarkers.length > 0 && (
        <ul className="ca__problems" id={listId} aria-label={t('ui.code.problems')} data-testid="ca-problems">
          {shownMarkers.map((m, i) => (
            <li key={`${m.line}:${m.col}:${i}`}>
              <button type="button" className="ca__problem" data-sev={m.severity} onClick={() => reveal(m.line, m.col, Math.max(0, (m.endLine ?? m.line) === m.line && m.endCol ? m.endCol - m.col : 0))}>
                <span className={`ca__sev ca__sev--${m.severity}`} aria-hidden />
                <span className="visually-hidden">{t(`ui.code.sev.${m.severity}`)}: </span>
                <span className="ca__problem-at mono" aria-label={t('ui.code.at', { line: m.line, col: m.col })}>
                  {m.line}:{m.col}
                </span>
                <span className="ca__problem-msg">{m.message}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
      <p className="visually-hidden" id={hintId}>
        {indent ? t('ui.code.hint') : ''}
      </p>
    </div>
  )
}

/** The rectangle of a caret at a column of a drawn line (its text nodes in order — soft wrap draws no chips). */
function caretRect(text: HTMLElement, col: number): DOMRect | null {
  let left = col
  const walker = document.createTreeWalker(text, NodeFilter.SHOW_TEXT)
  for (let n = walker.nextNode(); n; n = walker.nextNode()) {
    const len = n.textContent?.length ?? 0
    if (left <= len) {
      const r = document.createRange()
      r.setStart(n, left)
      r.setEnd(n, left)
      const rect = r.getClientRects()[0] ?? r.getBoundingClientRect()
      return rect
    }
    left -= len
  }
  return null
}


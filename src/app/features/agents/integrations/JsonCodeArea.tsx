/**
 * A JSON code area: a plain textarea over a highlighted layer (same monospace metrics, so every character sits where
 * the caret expects it), line numbers with a mark per problem line, a squiggle under each marked range, the message
 * on hover. Keys: Tab / Shift+Tab indent and outdent (Esc, then Tab, leaves the field), Enter keeps the indentation
 * (one level more after "{" or "["). One small component on purpose — { value, onChange, markers } — so a shared
 * code area can take its place later.
 *
 * Bounded work per keystroke: only the lines in view (plus a margin) are highlighted and numbered, a very long line
 * is shown without colours (its marks stay), and a text longer than `plainAbove` is a plain textarea (no layer).
 */
import { memo, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent, type ReactNode } from 'react'
import './integrations.css'

/** Lines rendered above and below the visible ones. */
const OVERSCAN = 24
/** A line longer than this is not split into coloured tokens (one minified line would be thousands of spans). */
const LONG_LINE = 2_000

export interface CodeMarker {
  line: number
  col: number
  /** exclusive end column on the same line (default: the token at `col`) */
  endCol?: number
  severity: 'error' | 'warning'
  message: string
}

export interface JsonCodeAreaProps {
  value: string
  onChange?: (value: string) => void
  markers?: CodeMarker[]
  readOnly?: boolean
  ariaLabel: string
  id?: string
  describedBy?: string
  /** put the caret at a line / column (and bring it into view); `n` makes a repeated jump to the same place count */
  jump?: { line: number; col: number; n: number } | null
  /** longer texts (characters) are shown as a plain textarea: no colours, no marks (default 200,000) */
  plainAbove?: number
}

type Tok = { text: string; cls: string }

/** One line of JSON as tokens (a key is a string followed by ":"); a very long line is one plain token. */
function tokens(line: string): Tok[] {
  if (line.length > LONG_LINE) return [{ text: line, cls: '' }]
  const out: Tok[] = []
  const re = /("(?:[^"\\]|\\.)*"?)|(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|\b(true|false|null)\b|([{}[\],:])|(\s+)|(.)/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line))) {
    if (m[1] !== undefined) {
      const rest = line.slice(re.lastIndex)
      out.push({ text: m[1], cls: /^\s*:/.test(rest) ? 'key' : 'str' })
    } else if (m[2] !== undefined) out.push({ text: m[2], cls: 'num' })
    else if (m[3] !== undefined) out.push({ text: m[3], cls: 'lit' })
    else if (m[4] !== undefined) out.push({ text: m[4], cls: 'punct' })
    else if (m[5] !== undefined) out.push({ text: m[5], cls: '' })
    else out.push({ text: m[6], cls: 'bad' })
  }
  return out
}

/** The marked range of a line (1-based columns, end exclusive); without an end: the token at the column, at least 1. */
function rangeOf(line: string, m: CodeMarker): [number, number] {
  const from = Math.max(0, Math.min(line.length, m.col - 1))
  if (m.endCol && m.endCol > m.col) return [from, Math.min(line.length, m.endCol - 1)]
  const rest = line.slice(from)
  const tok = /^("(?:[^"\\]|\\.)*"?|-?\d[\d.eE+-]*|\w+|\S)/.exec(rest)
  return [from, from + Math.max(1, tok ? tok[0].length : 1)]
}

/** The same marks (by what they mark): an unchanged line keeps its rendering. */
const sameMarks = (a: CodeMarker[] | undefined, b: CodeMarker[] | undefined): boolean =>
  a === b || (!!a && !!b && a.length === b.length && a.every((m, i) => m.col === b[i].col && m.endCol === b[i].endCol && m.severity === b[i].severity))

/** One highlighted line: its tokens, split at the marked ranges' edges. */
const Line = memo(
  function Line({ line, marks }: { line: string; marks?: CodeMarker[] }) {
    const ranges = (marks ?? []).map((m) => ({ r: rangeOf(line, m), sev: m.severity }))
    const parts: ReactNode[] = []
    let at = 0
    tokens(line).forEach((tok, k) => {
      const cuts = new Set<number>([0, tok.text.length])
      for (const { r } of ranges) for (const edge of r) if (edge > at && edge < at + tok.text.length) cuts.add(edge - at)
      const sorted = [...cuts].sort((a, b) => a - b)
      for (let c = 0; c < sorted.length - 1; c++) {
        const s = at + sorted[c]
        const e = at + sorted[c + 1]
        const hit = ranges.find(({ r }) => s >= r[0] && e <= r[1])
        const cls = [tok.cls ? `jca-tok--${tok.cls}` : '', hit ? `jca-mark jca-mark--${hit.sev}` : ''].filter(Boolean).join(' ')
        parts.push(
          cls ? (
            <span key={`${k}-${c}`} className={cls}>
              {line.slice(s, e)}
            </span>
          ) : (
            line.slice(s, e)
          ),
        )
      }
      at += tok.text.length
    })
    // a mark past the end of the line (an unexpected end): a caret-wide squiggle
    const past = ranges.find(({ r }) => r[0] >= line.length)
    if (past)
      parts.push(
        <span key="end" className={`jca-mark jca-mark--${past.sev}`}>
          {' '}
        </span>,
      )
    return <div className="jca__line">{parts.length ? parts : ' '}</div>
  },
  (a, b) => a.line === b.line && sameMarks(a.marks, b.marks),
)

export function JsonCodeArea({ value, onChange, markers = [], readOnly, ariaLabel, id, describedBy, jump, plainAbove = 200_000 }: JsonCodeAreaProps) {
  const input = useRef<HTMLTextAreaElement>(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  // the field's line height and visible height (px): which lines are in view
  const [box, setBox] = useState({ line: 20, height: 480 })
  const escaped = useRef(false)
  const plain = value.length > plainAbove
  const lines = useMemo(() => value.split('\n'), [value])
  const marks = useMemo(() => {
    const m = new Map<number, CodeMarker[]>()
    if (!plain) for (const x of markers) m.set(x.line, [...(m.get(x.line) ?? []), x])
    return m
  }, [markers, plain])
  const width = String(lines.length).length
  // the window of lines rendered (0-based, end exclusive)
  const first = Math.max(0, Math.floor(scroll.top / box.line) - OVERSCAN)
  const last = Math.min(lines.length, Math.ceil((scroll.top + box.height) / box.line) + OVERSCAN)
  const shown = lines.slice(first, last)

  // measure once and whenever the field changes size (text size, window)
  useLayoutEffect(() => {
    const el = input.current
    if (!el) return
    const measure = () => {
      const line = parseFloat(getComputedStyle(el).lineHeight) || 20
      setBox((b) => (b.line === line && b.height === el.clientHeight ? b : { line, height: el.clientHeight || b.height }))
    }
    measure()
    if (typeof ResizeObserver === 'undefined') return
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // a jump from the problem list: caret there, the line in view
  useLayoutEffect(() => {
    const el = input.current
    if (!el || !jump) return
    const starts = [0]
    for (let i = 0; i < value.length; i++) if (value[i] === '\n') starts.push(i + 1)
    const lineStart = starts[Math.min(jump.line, starts.length) - 1] ?? 0
    const lineEnd = jump.line < starts.length ? starts[jump.line] - 1 : value.length
    const at = Math.min(lineEnd, lineStart + Math.max(0, jump.col - 1))
    el.focus()
    el.setSelectionRange(at, at)
    const lh = parseFloat(getComputedStyle(el).lineHeight) || 20
    const top = (jump.line - 1) * lh
    if (top < el.scrollTop || top > el.scrollTop + el.clientHeight - lh * 2) el.scrollTop = Math.max(0, top - el.clientHeight / 3)
    // jump is the trigger; value is read at that moment
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump])

  useEffect(() => {
    const el = input.current
    if (el && (el.scrollTop !== scroll.top || el.scrollLeft !== scroll.left)) setScroll({ top: el.scrollTop, left: el.scrollLeft })
    // a new text (format, load a file) may scroll the field: keep the layer with it
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value])

  /** Replace the selection (undoable where the browser keeps a native undo stack). */
  const insert = (el: HTMLTextAreaElement, text: string, from = el.selectionStart, to = el.selectionEnd) => {
    el.setSelectionRange(from, to)
    if (!document.execCommand('insertText', false, text)) {
      el.setRangeText(text, from, to, 'end')
      onChange?.(el.value)
    }
  }

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (e.key === 'Escape') {
      escaped.current = true
      return
    }
    const wasEscaped = escaped.current
    escaped.current = false
    if (readOnly) return
    if (e.key === 'Tab' && !wasEscaped && !e.altKey && !e.metaKey && !e.ctrlKey) {
      e.preventDefault()
      const { selectionStart: s, selectionEnd: end } = el
      const v = el.value
      const lineStart = v.lastIndexOf('\n', s - 1) + 1
      if (e.shiftKey || s !== end) {
        // indent / outdent every selected line
        const blockEnd = v.indexOf('\n', end - (end > s && v[end - 1] === '\n' ? 1 : 0))
        const stop = blockEnd < 0 ? v.length : blockEnd
        const block = v.slice(lineStart, stop)
        const next = e.shiftKey ? block.replace(/^ {1,2}/gm, '') : block.replace(/^/gm, '  ')
        insert(el, next, lineStart, stop)
        el.setSelectionRange(lineStart, lineStart + next.length)
      } else insert(el, '  ')
      return
    }
    if (e.key === 'Enter' && !e.shiftKey && !e.altKey && !e.metaKey && !e.ctrlKey && !e.nativeEvent.isComposing) {
      e.preventDefault()
      const s = el.selectionStart
      const v = el.value
      const lineStart = v.lastIndexOf('\n', s - 1) + 1
      const indent = /^[ \t]*/.exec(v.slice(lineStart, s))![0]
      const before = v.slice(lineStart, s).trimEnd()
      const opens = before.endsWith('{') || before.endsWith('[')
      const closes = /^\s*[}\]]/.test(v.slice(s, v.indexOf('\n', s) < 0 ? v.length : v.indexOf('\n', s)))
      if (opens && closes) {
        insert(el, `\n${indent}  \n${indent}`)
        const at = s + 1 + indent.length + 2
        el.setSelectionRange(at, at)
      } else insert(el, `\n${indent}${opens ? '  ' : ''}`)
    }
  }

  const spacer = first > 0 ? <div className="jca__spacer" style={{ height: first * box.line }} /> : null
  return (
    <div className="jca" data-readonly={readOnly || undefined} data-plain={plain || undefined} style={{ ['--jca-gutter' as string]: `${width + 2}ch` }}>
      <div className="jca__gutter" aria-hidden>
        <div className="jca__nums" style={{ transform: `translateY(${-scroll.top}px)` }}>
          {spacer}
          {shown.map((_, k) => {
            const n = first + k + 1
            const ms = marks.get(n)
            const sev = ms?.some((m) => m.severity === 'error') ? 'error' : ms?.length ? 'warning' : undefined
            return (
              <div key={n} className="jca__ln" data-mark={sev} title={ms?.map((m) => m.message).join('\n')}>
                {n}
              </div>
            )
          })}
        </div>
      </div>
      <div className="jca__field">
        {!plain && (
          <div className="jca__clip" aria-hidden>
            <pre className="jca__layer" style={{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>
              {spacer}
              {shown.map((line, k) => (
                <Line key={first + k} line={line} marks={marks.get(first + k + 1)} />
              ))}
            </pre>
          </div>
        )}
        <textarea
          ref={input}
          id={id}
          className="jca__input"
          value={value}
          onChange={(e) => onChange?.(e.target.value)}
          onKeyDown={onKey}
          onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}
          readOnly={readOnly}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          autoComplete="off"
          wrap="off"
          aria-label={ariaLabel}
          aria-invalid={markers.some((m) => m.severity === 'error') || undefined}
          aria-describedby={describedBy}
          data-testid="jca-input"
        />
      </div>
    </div>
  )
}

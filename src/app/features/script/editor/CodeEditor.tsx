/**
 * One Script — the code editor: a plain textarea with a highlighted layer behind it (same monospace
 * metrics, so every character sits where the caret expects it), line numbers, @ references shown as
 * chips (the stable token `@[Label](p:id)` stays the text: chips survive renames, copy and paste),
 * the error of the last check or run (squiggle, gutter mark, the message at the end of its line) and an
 * IDE-like completion list (complete.ts): @ references, type-aware members after ".", the database's
 * properties inside where / set …, option values after `Status = `, snippets with tab stops.
 *
 * Keys: the list opens while typing (1 character), after "." and "@", inside an option text, and on
 * Ctrl+Space (⌥Esc on a Mac); ↑ ↓ choose, Enter / Tab take, Esc closes — Enter is never taken while
 * it is closed. A snippet's places: Tab / Shift+Tab, Esc leaves them. F1 or Mod+I shows what the name
 * at the caret is (Ctrl / ⌘ + hover too). Tab / Shift+Tab indent, Enter keeps the indentation,
 * Backspace after a chip removes the whole chip; Esc then Tab leaves the editor. The parent handles run
 * keys (onKey).
 */
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { useT } from '../../../i18n'
import type { Translate } from '@/shared/i18n'
import { PageIcon } from '../../../ui/PageIcon'
import { analyze, segments, type Segment } from './analyze'
import { activeParam, callAt, candidatesFor, completionAt, docAt, sigParams, type CallInfo, type Candidate, type DocInfo } from './complete'
import { diffEdit, expandSnippet, shiftSession, type Session } from './snippets'
import { tyLabel, type PropInfo, type Ty, type WsInfo } from './types'
import type { RefCandidate } from './workspace'

export type { RefCandidate } from './workspace'

export interface EditorError {
  start: number | null
  end: number | null
  line: number | null
  message: string
}

export interface CodeEditorProps {
  value: string
  onChange: (code: string) => void
  error?: EditorError | null
  readOnly?: boolean
  /** @ candidates for what was typed after "@" */
  refs: (query: string) => RefCandidate[]
  /** what the editor knows about the workspace (databases, their properties, people) */
  ws: WsInfo
  /** every property name the code's databases have (highlighting) */
  propNames: Set<string>
  /** keys the editor doesn't handle (run, dry run, stop, evaluate, save) — true = handled */
  onKey?: (e: ReactKeyboardEvent<HTMLTextAreaElement>) => boolean
  onSelectionChange?: (from: number, to: number) => void
  ariaLabel: string
  textareaRef?: React.MutableRefObject<HTMLTextAreaElement | null>
  /** a line to bring into view and put the caret on (e.g. the console's error link) */
  jump?: { line: number; col: number; n: number } | null
}

interface Item {
  key: string
  label: string
  kind: string
  insert: string
  snippet?: string
  /** right column */
  detail: string
  sig?: string
  doc?: string
  /** "→ rows · Projects" */
  type?: string
  /** a property's options (doc line) */
  options?: string[]
  icon?: RefCandidate['icon']
}

interface Menu {
  items: Item[]
  active: number
  /** what an accepted item replaces: from … the caret (+ `tail` characters after it) */
  from: number
  tail: number
}

const LINE_H = 20
const PAD_Y = 10
const PAD_X = 12
const DEBOUNCE_MS = 30
/** Up to this size the list follows every key at once; longer code waits for a pause in typing. */
const SYNC_MAX = 8000

/** The source of a reference token. */
export const refToken = (c: Pick<RefCandidate, 'label' | 'kind' | 'id'>) => `@[${c.label.replace(/[\]\\]/g, (x) => `\\${x}`).replace(/\n/g, ' ')}](${c.kind}:${c.id})`

const isMac = () => typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform || navigator.userAgent)

/* ------------------------------------------------------------------ texts of candidates */

/** The first description that exists. */
function docText(t: Translate, keys: string[] | undefined): string {
  for (const k of keys ?? []) {
    const v = t(k)
    if (v !== k) return v
  }
  return ''
}

/** "rows · Projects", "text", "a list of texts" … */
export function tyText(t: Translate, ty: Ty | null | undefined, ws: WsInfo): string {
  const l = tyLabel(ty ?? null, ws)
  if (!l) return ''
  if (l.key === 'list' && l.of) return t('features.script.ty.listOf', { of: t(`features.script.ty.${l.of}`) })
  if (l.key === 'ns') return l.of ?? ''
  const base = t(`features.script.ty.${l.key}`)
  return l.of && l.key !== 'list' ? `${base} · ${l.of}` : base
}

const propTypeText = (t: Translate, p: PropInfo) => t(`features.script.pt.${p.type}`)

function toItem(c: Candidate, t: Translate, ws: WsInfo): Item {
  const type = tyText(t, c.ty, ws)
  let detail = ''
  if (c.prop) detail = propTypeText(t, c.prop)
  else if (c.kind === 'snip') detail = t('features.script.ed.kind.snippet')
  else if (c.kind === 'kw') detail = t('features.script.ed.kind.keyword')
  else if (c.kind === 'var' || c.kind === 'field') detail = type
  else if (c.kind === 'member') detail = type || c.sig || ''
  else if (c.kind === 'fn') detail = c.sig ?? ''
  else if (c.kind === 'named') detail = t('features.script.ed.kind.named')
  else if (c.kind === 'value') detail = t('features.script.ed.kind.value')
  const options = c.prop && c.kind !== 'option' && c.prop.options.length ? c.prop.options : undefined
  return { key: `${c.kind}:${c.label}`, label: c.label, kind: c.kind, insert: c.insert, snippet: c.snippet, detail, sig: c.snippet ? c.snippet.replace(/\$\{\d+:?([^}]*)\}/g, '$1').replace(/\$\d/g, '').replace(/\t/g, '  ') : c.sig, doc: docText(t, c.doc), type: c.kind === 'var' || c.kind === 'field' ? undefined : type || undefined, options }
}

function refItem(c: RefCandidate, t: Translate): Item {
  const what = t(`features.script.ed.ref.${c.what === 'row' ? 'row' : c.what}`)
  return { key: `ref-${c.kind}:${c.id}`, label: c.label, kind: `ref-${c.kind}`, insert: refToken(c), detail: c.in ? `${what} · ${c.in}` : what, icon: c.icon }
}

const GLYPH: Record<string, string> = { prop: '◆', field: '◇', member: '.', fn: 'ƒ', var: 'x', kw: '§', snip: '{}', option: '"', value: '=', named: ':' }

/* ------------------------------------------------------------------ the layer */

/**
 * An @ reference as a chip. It takes exactly the width of its source text (`@[Label](p:id)`, in `ch`
 * of the monospace font), so the caret in the textarea above still lines up: the label as a pill, the
 * id as a faint tail in what is left.
 */
function Chip({ code, seg }: { code: string; seg: Segment }) {
  const raw = code.slice(seg.start, seg.end)
  const m = /^@\[(.*)\]\(([pusa]):([\w-]+)\)$/s.exec(raw)
  if (!m) return <span className="sc-tok sc-tok--ref">{raw}</span>
  const label = m[1].replace(/\\([\]\\])/g, '$1')
  return (
    <span className={`sc-chip sc-chip--${m[2]}`} style={{ width: `${[...raw].length}ch` }} title={`${label} · ${m[2]}:${m[3]}`}>
      <span className="sc-chip__pill">
        <span className="sc-chip__at">@</span>
        {label}
      </span>
      <span className="sc-chip__tail">{m[3]}</span>
    </span>
  )
}

/** One line of the highlighted layer (positions relative to the line). Unchanged lines are not rendered again. */
const LineRun = memo(
  function LineRun({ text, segs, errFrom, errTo }: { text: string; segs: Segment[]; sig: string; errFrom: number; errTo: number }) {
    const out: ReactNode[] = []
    let at = 0
    const push = (from: number, to: number, cls: string | null, key: string) => {
      if (to <= from) return
      // the error range gets a squiggle (split where it starts / ends)
      const cuts = [from, to]
      if (errFrom > from && errFrom < to) cuts.splice(1, 0, errFrom)
      if (errTo > from && errTo < to) cuts.splice(cuts.length - 1, 0, errTo)
      for (let i = 0; i < cuts.length - 1; i++) {
        const a = cuts[i]
        const b = cuts[i + 1]
        const err = errFrom >= 0 && a >= errFrom && b <= errTo
        const c = [cls ? `sc-tok sc-tok--${cls}` : '', err ? 'sc-squiggle' : ''].filter(Boolean).join(' ')
        out.push(
          c ? (
            <span key={`${key}-${i}`} className={c}>
              {text.slice(a, b)}
            </span>
          ) : (
            text.slice(a, b)
          ),
        )
      }
    }
    segs.forEach((sg, i) => {
      push(at, sg.start, null, `g${i}`)
      if (sg.cls === 'ref') {
        const chip = <Chip key={`r${i}`} code={text} seg={sg} />
        out.push(errFrom >= sg.start && errFrom < sg.end ? <span key={`re${i}`} className="sc-squiggle">{chip}</span> : chip)
      } else push(sg.start, sg.end, sg.cls, `s${i}`)
      at = sg.end
    })
    push(at, text.length, null, 'end')
    return <>{out}</>
  },
  (a, b) => a.text === b.text && a.sig === b.sig && a.errFrom === b.errFrom && a.errTo === b.errTo,
)

/** The highlighted layer: the same characters as the textarea, styled — line by line. */
function Layer({ code, segs, error }: { code: string; segs: Segment[]; error: EditorError | null }) {
  const errFrom = error?.start ?? -1
  const errTo = error && error.end !== null && error.start !== null ? Math.max(error.end, error.start + 1) : -1
  const lines = code.split('\n')
  const out: ReactNode[] = []
  let start = 0
  let si = 0
  lines.forEach((text, i) => {
    const end = start + text.length
    const mine: Segment[] = []
    while (si < segs.length && segs[si].start < end + (i === lines.length - 1 ? 1 : 0)) {
      const sg = segs[si++]
      if (sg.start >= start) mine.push({ ...sg, start: sg.start - start, end: Math.min(sg.end, end) - start })
    }
    // the error range on this line (a range over several lines: its part here)
    const ef = errFrom >= 0 && errFrom <= end && errTo > start ? Math.max(0, errFrom - start) : -1
    const et = ef >= 0 ? Math.min(text.length, errTo - start) : -1
    const sig = mine.map((x) => `${x.start}-${x.end}${x.cls}`).join(',')
    out.push(<LineRun key={i} text={text} segs={mine} sig={sig} errFrom={ef} errTo={et} />)
    if (i < lines.length - 1) out.push('\n')
    start = end + 1
  })
  // a final newline needs a character after it to take up its line
  out.push('\n ')
  return <>{out}</>
}

/** Code shown read-only with the editor's colours and chips (template previews). */
export function CodePreview({ code, className }: { code: string; className?: string }) {
  const segs = useMemo(() => segments(analyze(code), new Set()), [code])
  return (
    <pre className={`sc-preview${className ? ` ${className}` : ''}`}>
      <Layer code={code} segs={segs} error={null} />
    </pre>
  )
}

/** A signature with its active parameter marked. */
function Signature({ sig, active }: { sig: string; active: number }) {
  const ps = sigParams(sig)
  const p = active >= 0 ? ps[active] : undefined
  if (!p) return <code>{sig}</code>
  return (
    <code>
      {sig.slice(0, p.start)}
      <mark className="sc-code__arg">{sig.slice(p.start, p.end)}</mark>
      {sig.slice(p.end)}
    </code>
  )
}

/** Line numbers (rendered again only when the count, the current line or the error line change). */
const Gutter = memo(function Gutter({ lines, top, width, errLine, curLine }: { lines: number; top: number; width: number; errLine: number | null; curLine: number }) {
  return (
    <div className="sc-code__gutter" style={{ width }} aria-hidden>
      <div style={{ transform: `translateY(${-top}px)` }}>
        {Array.from({ length: lines }, (_, i) => (
          <div key={i} className={`sc-code__ln${i + 1 === errLine ? ' sc-code__ln--err' : ''}${i === curLine ? ' sc-code__ln--cur' : ''}`}>
            {i + 1}
          </div>
        ))}
      </div>
    </div>
  )
})

/** Rough heights of the list's parts (placing it without measuring the page). */
const ITEM_H = 28
const ITEM_H_TOUCH = 36
const LIST_MAX = 232

/* ------------------------------------------------------------------ the editor */

export function CodeEditor({ value, onChange, error = null, readOnly, refs, ws, propNames, onKey, onSelectionChange, ariaLabel, textareaRef, jump }: CodeEditorProps) {
  const t = useT()
  const ta = useRef<HTMLTextAreaElement | null>(null)
  const field = useRef<HTMLDivElement | null>(null)
  const pop = useRef<HTMLDivElement | null>(null)
  const measure = useRef<HTMLSpanElement | null>(null)
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [menu, setMenu] = useState<Menu | null>(null)
  const [doc, setDoc] = useState<{ info: DocInfo; by: 'key' | 'mouse' } | null>(null)
  const [charW, setCharW] = useState(7.8)
  const [, setTick] = useState(0)
  const escaped = useRef(false)
  const suppress = useRef(false)
  const timer = useRef(0)
  const session = useRef<Session | null>(null)
  /** where the pointer last was: the browser also sends mousemove when the list appears under a resting pointer */
  const pointer = useRef({ x: -1, y: -1 })
  const moved = (e: ReactMouseEvent) => {
    if (e.clientX === pointer.current.x && e.clientY === pointer.current.y) return false
    pointer.current = { x: e.clientX, y: e.clientY }
    return true
  }
  const bump = () => setTick((n) => n + 1)

  const analysis = useMemo(() => analyze(value), [value])
  const segs = useMemo(() => segments(analysis, propNames), [analysis, propNames])
  const lines = useMemo(() => value.split('\n').length, [value])
  const ph = useCallback((key: string) => t(`features.script.snip.ph.${key}`), [t])

  useLayoutEffect(() => {
    if (measure.current) {
      const w = measure.current.getBoundingClientRect().width / 10
      if (w > 0) setCharW(w)
    }
  }, [])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const setRef = (el: HTMLTextAreaElement | null) => {
    ta.current = el
    if (textareaRef) textareaRef.current = el
  }

  // jump to a line (the console's "2:14" links)
  useEffect(() => {
    if (!jump || !ta.current) return
    const el = ta.current
    const ls = value.split('\n')
    let off = 0
    for (let i = 0; i < Math.min(jump.line - 1, ls.length); i++) off += ls[i].length + 1
    off += Math.max(0, Math.min(jump.col - 1, (ls[jump.line - 1] ?? '').length))
    el.focus()
    el.setSelectionRange(off, off)
    el.scrollTop = Math.max(0, (jump.line - 4) * LINE_H)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jump?.n])

  /* ---------------------------------------------------------------- geometry */

  const xy = (off: number) => {
    const line = value.slice(0, off).split('\n').length - 1
    const col = off - (value.lastIndexOf('\n', off - 1) + 1)
    return { line, col, x: PAD_X + col * charW - scroll.left, y: PAD_Y + line * LINE_H - scroll.top }
  }

  /** The text offset under a point of the textarea. */
  const offsetAt = (clientX: number, clientY: number): number | null => {
    const el = ta.current
    if (!el) return null
    const r = el.getBoundingClientRect()
    const line = Math.floor((clientY - r.top - PAD_Y + el.scrollTop) / LINE_H)
    const col = Math.floor((clientX - r.left - PAD_X + el.scrollLeft) / charW)
    const ls = value.split('\n')
    if (line < 0 || line >= ls.length || col < 0 || col > ls[line].length) return null
    let off = 0
    for (let i = 0; i < line; i++) off += ls[i].length + 1
    return off + col
  }

  /* ---------------------------------------------------------------- completion */

  const close = () => {
    window.clearTimeout(timer.current)
    setMenu(null)
  }

  const refresh = (code: string, offset: number, forced: boolean) => {
    const el = ta.current
    if (!el || el.value !== code || readOnly) return
    const a = analyze(code)
    const ctx = completionAt(code, a, offset, ws, forced)
    if (!ctx) return setMenu(null)
    const list = ctx.kind === 'ref' ? refs(ctx.query).map((c) => refItem(c, t)) : candidatesFor(ctx, ws, ph).map((c) => toItem(c, t, ws))
    if (!list.length) return setMenu(null)
    const typed = code.slice(ctx.from, offset)
    if (!forced && list.length === 1 && (list[0].insert === typed || list[0].label === typed) && !list[0].snippet) return setMenu(null)
    setMenu({ items: list, active: 0, from: ctx.from, tail: Math.max(0, ctx.to - offset) })
  }

  const schedule = (code: string, offset: number, forced = false) => {
    window.clearTimeout(timer.current)
    if (forced || code.length <= SYNC_MAX) return refresh(code, offset, forced)
    timer.current = window.setTimeout(() => refresh(code, offset, false), DEBOUNCE_MS)
  }

  const insertText = (from: number, to: number, text: string) => {
    const el = ta.current
    if (!el) return
    el.focus()
    el.setSelectionRange(from, to)
    // keeps the textarea's own undo stack (falls back to a plain replace)
    const ok = typeof document.execCommand === 'function' && document.execCommand('insertText', false, text)
    if (!ok || el.value !== value.slice(0, from) + text + value.slice(to)) {
      if (el.value === value) {
        const next = value.slice(0, from) + text + value.slice(to)
        onChange(next)
        requestAnimationFrame(() => el.setSelectionRange(from + text.length, from + text.length))
      }
    }
  }

  const insertSnippet = (from: number, to: number, body: string) => {
    const el = ta.current
    if (!el) return
    const lineStart = value.lastIndexOf('\n', from - 1) + 1
    const indent = /^[ \t]*/.exec(value.slice(lineStart, from))![0]
    const ex = expandSnippet(body, indent)
    suppress.current = true
    insertText(from, to, ex.text)
    const stops = ex.stops.map((s) => ({ n: s.n, start: from + s.start, end: from + s.end }))
    session.current = stops.length ? { stops, end: from + ex.end, at: 0 } : null
    const first = stops[0]
    if (first) el.setSelectionRange(first.start, first.end)
    else el.setSelectionRange(from + ex.end, from + ex.end)
    setCaret(el.selectionStart)
    bump()
    // a place right after "@" opens the references at once
    if (first && first.start === first.end) schedule(el.value, first.start)
  }

  const accept = (it: Item) => {
    const el = ta.current
    if (!el || !menu) return
    const end = el.selectionEnd + menu.tail
    close()
    if (it.snippet) return insertSnippet(menu.from, end, it.snippet)
    const text = it.kind.startsWith('ref') ? `${it.insert} ` : it.insert
    suppress.current = true
    insertText(menu.from, end, text)
    // the next step right away: a call's properties, a property's values
    if ((text.endsWith('(') || text.endsWith(': ')) && el.value.length) schedule(el.value, el.selectionStart)
  }

  /* ---------------------------------------------------------------- snippet places */

  const jumpStop = (dir: 1 | -1): boolean => {
    const s = session.current
    const el = ta.current
    if (!s || !el) return false
    const next = s.at + dir
    if (next >= s.stops.length) {
      el.setSelectionRange(s.end, s.end)
      session.current = null
    } else {
      s.at = Math.max(0, next)
      el.setSelectionRange(s.stops[s.at].start, s.stops[s.at].end)
    }
    setCaret(el.selectionStart)
    bump()
    return true
  }

  /* ---------------------------------------------------------------- keys */

  const refAt = (offset: number, side: 'before' | 'after') => analysis.tokens.find((tk) => tk.type === 'ref' && (side === 'before' ? tk.pos.end === offset : tk.pos.start === offset))

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (doc && e.key !== 'Control' && e.key !== 'Meta') setDoc(null)
    if (menu) {
      const n = menu.items.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        return setMenu({ ...menu, active: (menu.active + d + n) % n })
      }
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault()
        return setMenu({ ...menu, active: Math.max(0, Math.min(n - 1, menu.active + (e.key === 'PageDown' ? 8 : -8))) })
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        return accept(menu.items[menu.active])
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        return close()
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') close()
    }
    // Ctrl+Space (⌥Esc on a Mac): the list for what is at the caret
    if (((e.key === ' ' || e.code === 'Space') && e.ctrlKey && !e.metaKey && !e.altKey) || (e.key === 'Escape' && e.altKey && isMac())) {
      e.preventDefault()
      e.stopPropagation()
      return schedule(el.value, el.selectionStart, true)
    }
    // F1 / Mod+I: what the name at the caret is
    if (e.key === 'F1' || ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'i')) {
      e.preventDefault()
      const info = docAt(el.value, analyze(el.value), el.selectionStart, ws)
      setDoc(info ? { info, by: 'key' } : null)
      return
    }
    if (session.current && e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      jumpStop(e.shiftKey ? -1 : 1)
      return
    }
    if (session.current && e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      session.current = null
      bump()
      return
    }
    if (onKey?.(e)) return
    if (readOnly) return
    const { selectionStart: a, selectionEnd: b } = el
    if (e.key === 'Escape') {
      escaped.current = true
      return
    }
    if (e.key === 'Tab') {
      if (escaped.current) return
      e.preventDefault()
      const ls = value.slice(0, a).lastIndexOf('\n') + 1
      if (e.shiftKey) {
        const lineEnd = value.indexOf('\n', b)
        const block = value.slice(ls, lineEnd < 0 ? value.length : lineEnd)
        const out = block.replace(/^ {1,2}/gm, '')
        if (out !== block) insertText(ls, ls + block.length, out)
        return
      }
      if (a !== b && value.slice(a, b).includes('\n')) {
        const lineEnd = value.indexOf('\n', b - 1)
        const block = value.slice(ls, lineEnd < 0 ? value.length : lineEnd)
        insertText(ls, ls + block.length, block.replace(/^/gm, '  '))
        return
      }
      insertText(a, b, '  ')
      return
    }
    escaped.current = false
    if (e.key === 'Enter' && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      const ls = value.slice(0, a).lastIndexOf('\n') + 1
      const indent = /^[ \t]*/.exec(value.slice(ls, a))![0]
      const opens = /[{([]\s*$/.test(value.slice(ls, a))
      insertText(a, b, `\n${indent}${opens ? '  ' : ''}`)
      return
    }
    if (e.key === '}' && a === b) {
      const ls = value.slice(0, a).lastIndexOf('\n') + 1
      const lead = value.slice(ls, a)
      if (/^ {2,}$/.test(lead)) {
        e.preventDefault()
        insertText(a - 2, a, '}')
        return
      }
    }
    if (e.key === 'Backspace' && a === b) {
      const r = refAt(a, 'before')
      if (r) {
        e.preventDefault()
        insertText(r.pos.start, r.pos.end, '')
        return
      }
    }
    if (e.key === 'Delete' && a === b) {
      const r = refAt(a, 'after')
      if (r) {
        e.preventDefault()
        insertText(r.pos.start, r.pos.end, '')
        return
      }
    }
  }

  const onSelect = () => {
    const el = ta.current
    if (!el) return
    const { selectionStart: a, selectionEnd: b } = el
    // a chip is one unit: a caret inside it moves to its end
    if (a === b) {
      const inside = analysis.tokens.find((tk) => tk.type === 'ref' && tk.pos.start < a && a < tk.pos.end)
      if (inside) {
        el.setSelectionRange(inside.pos.end, inside.pos.end)
        setCaret(inside.pos.end)
        onSelectionChange?.(inside.pos.end, inside.pos.end)
        return
      }
    }
    // leaving a snippet ends its places
    const s = session.current
    if (s && (a < Math.min(...s.stops.map((x) => x.start)) || b > Math.max(s.end, ...s.stops.map((x) => x.end)))) {
      session.current = null
      bump()
    }
    setCaret(b)
    onSelectionChange?.(a, b)
  }

  /* ---------------------------------------------------------------- Ctrl / ⌘ + hover */

  const onMouseMove = (e: ReactMouseEvent<HTMLTextAreaElement>) => {
    moved(e)
    if (!(e.ctrlKey || e.metaKey)) {
      if (doc?.by === 'mouse') setDoc(null)
      return
    }
    const off = offsetAt(e.clientX, e.clientY)
    const info = off === null ? null : docAt(value, analysis, off, ws)
    if (!info) return doc?.by === 'mouse' ? setDoc(null) : undefined
    if (doc?.info.from !== info.from || doc.by !== 'mouse') setDoc({ info, by: 'mouse' })
  }

  /* ---------------------------------------------------------------- placing the list */

  const caretLine = value.slice(0, caret).split('\n').length - 1
  const caretCol = caret - (value.lastIndexOf('\n', caret - 1) + 1)
  const caretX = PAD_X + caretCol * charW - scroll.left
  const caretY = PAD_Y + caretLine * LINE_H - scroll.top

  // where the field is on the screen: measured when it matters (focus, scrolling, resizing), not after every key
  const fieldBox = useRef<{ top: number; width: number } | null>(null)
  useEffect(() => {
    const measureField = () => {
      const r = field.current?.getBoundingClientRect()
      if (r) fieldBox.current = { top: r.top, width: r.width }
    }
    measureField()
    const vv = window.visualViewport
    window.addEventListener('resize', measureField)
    window.addEventListener('scroll', measureField, true)
    vv?.addEventListener('resize', measureField)
    vv?.addEventListener('scroll', measureField)
    ta.current?.addEventListener('focus', measureField)
    const el = ta.current
    return () => {
      window.removeEventListener('resize', measureField)
      window.removeEventListener('scroll', measureField, true)
      vv?.removeEventListener('resize', measureField)
      vv?.removeEventListener('scroll', measureField)
      el?.removeEventListener('focus', measureField)
    }
  }, [])

  const place = useMemo(() => {
    if (!menu) return null
    const fb = fieldBox.current
    const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 560px), (pointer: coarse)').matches
    const it = menu.items[menu.active]
    const listH = Math.min(menu.items.length * (touch ? ITEM_H_TOUCH : ITEM_H) + 8, LIST_MAX)
    const h = listH + (it && (it.sig || it.doc || it.type || it.options) ? 66 : 0) + (touch ? 0 : 24)
    const fieldW = fb?.width ?? 600
    const w = Math.min(460, fieldW - 8)
    const left = Math.max(4, Math.min(caretX, fieldW - w - 4))
    // the visible part of the page (an on-screen keyboard makes it shorter)
    const vv = typeof window !== 'undefined' ? window.visualViewport : null
    const bottom = vv ? vv.offsetTop + vv.height : typeof window !== 'undefined' ? window.innerHeight : 900
    const top0 = fb?.top ?? 0
    const roomBelow = bottom - (top0 + caretY + LINE_H + 2) - 8
    const roomAbove = top0 + caretY - 2 - Math.max(0, vv?.offsetTop ?? 0) - 8
    const above = h > roomBelow && roomAbove > roomBelow
    const max = Math.max(120, Math.min(LIST_MAX + 90, above ? roomAbove : roomBelow))
    return { left, top: above ? caretY - 2 - Math.min(h, max) : caretY + LINE_H + 2, above, max }
  }, [menu, caretX, caretY])

  // the active item stays in view (only when it changes: no layout work while typing)
  const shownActive = useRef(-1)
  useEffect(() => {
    if (!menu) {
      shownActive.current = -1
      return
    }
    if (menu.active === shownActive.current) return
    if (shownActive.current >= 0 || menu.active > 0) pop.current?.querySelector(`#sc-complete-${menu.active}`)?.scrollIntoView({ block: 'nearest' })
    shownActive.current = menu.active
  }, [menu])

  // signature help: the call at the caret, a moment after typing / moving stops
  const [call, setCall] = useState<CallInfo | null>(null)
  useEffect(() => {
    if (!focused || menu) return setCall(null)
    const timer = window.setTimeout(() => setCall(callAt(value, analysis, caret, ws)), DEBOUNCE_MS)
    return () => window.clearTimeout(timer)
  }, [focused, menu, value, analysis, caret, ws])

  /* ---------------------------------------------------------------- render */

  // while choosing from the list, the half-typed code is not nagged about
  const shownError = menu ? null : error
  const errLine = shownError?.line ?? null
  const gutterW = Math.max(2, String(lines).length) * charW + 22
  const active = menu ? menu.items[menu.active] : null
  const stops = session.current?.stops.filter((s, i) => i >= (session.current?.at ?? 0) && s.end > s.start) ?? []
  const docPos = doc ? xy(doc.info.from) : null

  return (
    <div className={`sc-code${readOnly ? ' sc-code--ro' : ''}`}>
      <span ref={measure} className="sc-code__measure" aria-hidden>
        0000000000
      </span>
      <Gutter lines={lines} top={scroll.top} width={gutterW} errLine={errLine} curLine={focused ? caretLine : -1} />
      <div ref={field} className="sc-code__field">
        <div className="sc-code__clip" aria-hidden>
          <pre className="sc-code__layer" style={{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>
            <Layer code={value} segs={segs} error={shownError} />
          </pre>
          {stops.map((s) => {
            const p = xy(s.start)
            return <span key={`${s.n}:${s.start}`} className="sc-code__stop" style={{ left: p.x - 1, top: p.y, width: (s.end - s.start) * charW + 2 }} data-testid="sc-stop" />
          })}
          {shownError?.line && shownError.message && (
            <div className="sc-code__lens" style={{ top: PAD_Y + (shownError.line - 1) * LINE_H - scroll.top }}>
              {shownError.message}
            </div>
          )}
        </div>
        <textarea
          ref={setRef}
          className="sc-code__input"
          value={value}
          spellCheck={false}
          autoCapitalize="off"
          autoComplete="off"
          autoCorrect="off"
          readOnly={readOnly}
          aria-label={ariaLabel}
          aria-invalid={!!error || undefined}
          aria-autocomplete="list"
          aria-haspopup="listbox"
          aria-expanded={!!menu}
          aria-controls={menu ? 'sc-complete' : undefined}
          aria-activedescendant={menu ? `sc-complete-${menu.active}` : undefined}
          aria-describedby={doc ? 'sc-doc' : undefined}
          onChange={(e) => {
            const next = e.target.value
            const off = e.target.selectionStart
            // a snippet's places move with the edit (an edit outside them ends the snippet)
            if (session.current) {
              const d = diffEdit(value, next)
              session.current = shiftSession(session.current, d.from, d.to, d.len)
              bump()
            }
            onChange(next)
            setCaret(off)
            if (suppress.current) {
              suppress.current = false
              close()
            } else schedule(next, off)
          }}
          onKeyDown={onKeyDown}
          onKeyUp={(e) => {
            if ((e.key === 'Control' || e.key === 'Meta') && doc?.by === 'mouse') setDoc(null)
          }}
          onSelect={onSelect}
          onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            setDoc(null)
            window.setTimeout(() => {
              if (document.activeElement !== ta.current) setMenu(null)
            }, 150)
          }}
          onClick={() => {
            close()
            setDoc(null)
          }}
          onMouseMove={onMouseMove}
          onMouseLeave={() => doc?.by === 'mouse' && setDoc(null)}
        />
        {menu && (
          <div ref={pop} className={`sc-complete${place?.above ? ' is-above' : ''}`} style={{ left: place?.left ?? Math.max(4, caretX), top: place?.top ?? caretY + LINE_H + 2 }} data-testid="sc-complete">
            <ul id="sc-complete" className="sc-complete__list" role="listbox" aria-label={t('features.script.ed.suggestions')} style={{ maxHeight: place ? Math.max(84, place.max - 64) : undefined }}>
              {menu.items.map((it, i) => (
                <li
                  key={it.key}
                  id={`sc-complete-${i}`}
                  role="option"
                  aria-selected={i === menu.active}
                  className={`sc-complete__item${i === menu.active ? ' is-active' : ''}`}
                  data-kind={it.kind}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => accept(it)}
                  onMouseMove={(e) => moved(e) && setMenu((m) => (m && m.active !== i ? { ...m, active: i } : m))}
                >
                  <span className={`sc-complete__kind sc-complete__kind--${it.kind}`} aria-hidden>
                    {it.icon ? <PageIcon icon={it.icon} size={13} /> : it.kind.startsWith('ref') ? '@' : (GLYPH[it.kind] ?? '·')}
                  </span>
                  <span className="sc-complete__label">{it.label}</span>
                  <span className="sc-complete__detail">{it.detail}</span>
                </li>
              ))}
            </ul>
            {active && (active.sig || active.doc || active.type || active.options) && (
              <div className="sc-complete__doc" data-testid="sc-complete-doc">
                {active.sig && <code className="sc-complete__sig">{active.sig}</code>}
                {active.type && <span className="sc-complete__type label">→ {active.type}</span>}
                {active.doc && <p className="sc-complete__text">{active.doc}</p>}
                {active.options && <p className="sc-complete__opts">{active.options.slice(0, 8).join(' · ')}</p>}
              </div>
            )}
            <div className="sc-complete__keys label" aria-hidden>
              <span>
                <kbd className="kbd">↑</kbd>
                <kbd className="kbd">↓</kbd>
              </span>
              <span>
                <kbd className="kbd">↵</kbd> / <kbd className="kbd">⇥</kbd> {t('features.script.ed.take')}
              </span>
              <span>
                <kbd className="kbd">esc</kbd>
              </span>
            </div>
          </div>
        )}
        {doc && docPos && (
          <div id="sc-doc" role="tooltip" className="sc-doc" style={{ left: Math.max(4, docPos.x), top: docPos.y + LINE_H + 2 }} data-testid="sc-doc">
            <DocCard info={doc.info} ws={ws} />
          </div>
        )}
      </div>
      <div className="sc-code__bar" aria-live="polite">
        {call ? (
          <span className="sc-code__sig" data-testid="sc-sig">
            <Signature sig={call.sig} active={activeParam(call.sig, call.index, call.named)} />
            <span className="sc-code__sigdesc">{docText(t, call.doc)}</span>
          </span>
        ) : (
          <span className="sc-code__hint">{t('features.script.ed.hint')}</span>
        )}
        <span className="sc-code__pos mono">{t('features.script.ed.pos', { line: caretLine + 1, col: caretCol + 1 })}</span>
      </div>
    </div>
  )
}

/** The doc of a name (F1, Mod+I, Ctrl / ⌘ + hover). */
function DocCard({ info, ws }: { info: DocInfo; ws: WsInfo }) {
  const t = useT()
  const type = tyText(t, info.ty, ws)
  const text = docText(t, info.doc)
  return (
    <>
      <div className="sc-doc__head">
        <code className="sc-doc__name">{info.sig ?? info.label}</code>
        {info.prop ? <span className="label">{propTypeText(t, info.prop)}</span> : info.variable ? <span className="label">{t('features.script.ed.kind.variable')}</span> : null}
      </div>
      {type && <p className="sc-doc__type label">→ {type}</p>}
      {text && <p className="sc-doc__text">{text}</p>}
      {info.prop && info.prop.options.length > 0 && <p className="sc-doc__opts">{info.prop.options.slice(0, 12).join(' · ')}</p>}
      {!type && !text && !info.prop && <p className="sc-doc__text">{t('features.script.ed.noDoc')}</p>}
    </>
  )
}

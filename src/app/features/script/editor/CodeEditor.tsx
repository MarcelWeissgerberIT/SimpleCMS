/**
 * One Script — the code editor, on the shared code area (ui/code/CodeArea: a textarea over highlighted lines,
 * line numbers, the current line, bracket pairs and unmatched brackets, problems with a list below that jumps to
 * them, Tab / Shift+Tab, Enter keeps the indentation, Esc then Tab leaves). On top of it: the language's own
 * highlighting (analyze.ts), @ references shown as chips (the stable token `@[Label](p:id)` stays the text: chips
 * survive renames, copy and paste), the error of the last check or run — and where a bracket before it was never
 * closed, the likely cause — and an IDE-like completion list (complete.ts): @ references, type-aware members after
 * ".", the database's properties inside where / set …, option values after `Status = `, snippets with tab stops.
 *
 * Keys: the list opens while typing (1 character), after "." and "@", inside an option text, and on Ctrl+Space (⌥Esc
 * on a Mac); ↑ ↓ choose, Enter / Tab take, Esc closes — Enter is never taken while it is closed. A snippet's places:
 * Tab / Shift+Tab, Esc leaves them. F1 or Mod+I shows what the name at the caret is (Ctrl / ⌘ + hover too).
 * Backspace after a chip removes the whole chip. The parent handles run keys (onKey).
 */
import { useCallback, useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent } from 'react'
import { useT } from '../../../i18n'
import type { Translate } from '@/shared/i18n'
import { PageIcon } from '../../../ui/PageIcon'
import { CodeArea, CodeView, bracketMarkers, lineColAt, lineStarts, type CodeAreaHandle, type CodeGeometry, type CodeMarker, type CodeToken, type SynClass } from '../../../ui/code'
import { analyze, segments, type Segment, type SegClass } from './analyze'
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

/* ------------------------------------------------------------------ chips, previews, signatures */

/**
 * An @ reference as a chip. It takes exactly the width of its source text (`@[Label](p:id)`, in `ch` of the
 * monospace font), so the caret in the textarea above still lines up: the label as a pill, the id as a faint tail
 * in what is left.
 */
function Chip({ raw }: { raw: string }) {
  const m = /^@\[(.*)\]\(([pusa]):([\w-]+)\)$/s.exec(raw)
  if (!m) return <span className="syn-ref">{raw}</span>
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

/** Code shown read-only with the editor's colours and chips (template previews). */
export function CodePreview({ code, className }: { code: string; className?: string }) {
  const tokenize = useCallback((c: string) => toTokens(segments(analyze(c), new Set())), [])
  return <CodeView code={code} tokenize={tokenize} renderToken={renderChip} className={`sc-preview${className ? ` ${className}` : ''}`} />
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

/** Rough heights of the list's parts (placing it without measuring the page). */
const ITEM_H = 28
const ITEM_H_TOUCH = 36
const LIST_MAX = 232

/* ------------------------------------------------------------------ the editor */

const SEG_SYN: Partial<Record<SegClass, SynClass>> = { kw: 'kw', fn: 'fn', prop: 'prop', var: 'var', num: 'num', str: 'str', ref: 'ref', comment: 'comment', op: 'op', err: 'err' }

/** The language's own highlight segments as the code area's tokens (plain names stay plain). */
function toTokens(segs: Segment[]): CodeToken[] {
  const out: CodeToken[] = []
  for (const s of segs) {
    const cls = SEG_SYN[s.cls]
    if (cls && s.end > s.start) out.push({ start: s.start, end: s.end, cls })
  }
  return out
}

const renderChip = (tok: CodeToken, text: string) => (tok.cls === 'ref' ? <Chip raw={text} /> : null)

export function CodeEditor({ value, onChange, error = null, readOnly, refs, ws, propNames, onKey, onSelectionChange, ariaLabel, textareaRef, jump }: CodeEditorProps) {
  const t = useT()
  const area = useRef<CodeAreaHandle | null>(null)
  const ta = useRef<HTMLTextAreaElement | null>(null)
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [menu, setMenu] = useState<Menu | null>(null)
  const [doc, setDoc] = useState<{ info: DocInfo; by: 'key' | 'mouse' } | null>(null)
  const [, setTick] = useState(0)
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
  // the last result is kept: the area and the bracket check below ask for the same text
  const tokenize = useMemo(() => {
    let last: { code: string; tokens: CodeToken[] } | null = null
    return (code: string) => {
      if (last?.code !== code) last = { code, tokens: toTokens(segments(analyze(code), propNames)) }
      return last.tokens
    }
  }, [propNames])
  const ph = useCallback((key: string) => t(`features.script.snip.ph.${key}`), [t])

  useEffect(() => () => window.clearTimeout(timer.current), [])

  const setRef = (el: HTMLTextAreaElement | null) => {
    ta.current = el
    if (textareaRef) textareaRef.current = el
  }
  const taRef = useMemo(() => ({ get current() { return ta.current }, set current(el: HTMLTextAreaElement | null) { setRef(el) } }), []) // eslint-disable-line react-hooks/exhaustive-deps

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

  const insertText = (from: number, to: number, text: string) => area.current?.insert(from, to, text)

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

  /* ---------------------------------------------------------------- keys (the area does indentation, Enter, Esc then Tab) */

  const refAt = (offset: number, side: 'before' | 'after') => analysis.tokens.find((tk) => tk.type === 'ref' && (side === 'before' ? tk.pos.end === offset : tk.pos.start === offset))

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>): boolean => {
    const el = e.currentTarget
    if (doc && e.key !== 'Control' && e.key !== 'Meta') setDoc(null)
    if (menu) {
      const n = menu.items.length
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const d = e.key === 'ArrowDown' ? 1 : -1
        setMenu({ ...menu, active: (menu.active + d + n) % n })
        return true
      }
      if (e.key === 'PageDown' || e.key === 'PageUp') {
        e.preventDefault()
        setMenu({ ...menu, active: Math.max(0, Math.min(n - 1, menu.active + (e.key === 'PageDown' ? 8 : -8))) })
        return true
      }
      if ((e.key === 'Enter' || e.key === 'Tab') && !e.shiftKey && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault()
        accept(menu.items[menu.active])
        return true
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        close()
        return true
      }
      if (e.key === 'ArrowLeft' || e.key === 'ArrowRight' || e.key === 'Home' || e.key === 'End') close()
    }
    // Ctrl+Space (⌥Esc on a Mac): the list for what is at the caret
    if (((e.key === ' ' || e.code === 'Space') && e.ctrlKey && !e.metaKey && !e.altKey) || (e.key === 'Escape' && e.altKey && isMac())) {
      e.preventDefault()
      e.stopPropagation()
      schedule(el.value, el.selectionStart, true)
      return true
    }
    // F1 / Mod+I: what the name at the caret is
    if (e.key === 'F1' || ((e.metaKey || e.ctrlKey) && !e.shiftKey && !e.altKey && e.key.toLowerCase() === 'i')) {
      e.preventDefault()
      const info = docAt(el.value, analyze(el.value), el.selectionStart, ws)
      setDoc(info ? { info, by: 'key' } : null)
      return true
    }
    if (session.current && e.key === 'Tab' && !e.metaKey && !e.ctrlKey && !e.altKey) {
      e.preventDefault()
      jumpStop(e.shiftKey ? -1 : 1)
      return true
    }
    if (session.current && e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      session.current = null
      bump()
      return true
    }
    if (onKey?.(e)) return true
    if (readOnly) return false
    const { selectionStart: a, selectionEnd: b } = el
    if (e.key === 'Backspace' && a === b) {
      const r = refAt(a, 'before')
      if (r) {
        e.preventDefault()
        insertText(r.pos.start, r.pos.end, '')
        return true
      }
    }
    if (e.key === 'Delete' && a === b) {
      const r = refAt(a, 'after')
      if (r) {
        e.preventDefault()
        insertText(r.pos.start, r.pos.end, '')
        return true
      }
    }
    return false
  }

  const onSelect = (a: number, b: number) => {
    const el = ta.current
    if (!el) return
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
    const off = area.current?.offsetAtPoint(e.clientX, e.clientY) ?? null
    const info = off === null ? null : docAt(value, analysis, off, ws)
    if (!info) return doc?.by === 'mouse' ? setDoc(null) : undefined
    if (doc?.info.from !== info.from || doc.by !== 'mouse') setDoc({ info, by: 'mouse' })
  }

  // the active item stays in view (only when it changes: no layout work while typing)
  const pop = useRef<HTMLDivElement | null>(null)
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

  /* ---------------------------------------------------------------- problems */

  // while choosing from the list, the half-typed code is not nagged about
  const shownError = menu ? null : error
  const markers = useMemo<CodeMarker[]>(() => {
    if (!shownError || shownError.line === null) return []
    const starts = lineStarts(value)
    const at = shownError.start !== null ? lineColAt(starts, Math.min(shownError.start, value.length)) : { line: shownError.line, col: 1 }
    const end = shownError.end !== null && shownError.start !== null && shownError.end > shownError.start ? lineColAt(starts, Math.min(shownError.end, value.length)) : null
    const main: CodeMarker = { line: at.line, col: at.col, endCol: end && end.line === at.line && end.col > at.col ? end.col : undefined, message: shownError.message, severity: 'error' }
    // the cause behind "expected ')'": a bracket opened before the error and never closed
    const cause = shownError.start !== null ? bracketMarkers(value, tokenize(value), t, { before: shownError.start, severity: 'warning' }) : []
    return [...cause, main]
  }, [shownError, value, tokenize, t])

  /* ---------------------------------------------------------------- floating parts */

  const overlay = (geo: CodeGeometry) => {
    const touch = typeof window !== 'undefined' && !!window.matchMedia?.('(max-width: 560px), (pointer: coarse)').matches
    const stops = session.current?.stops.filter((s, i) => i >= (session.current?.at ?? 0) && s.end > s.start) ?? []
    const c = geo.pointAt(caret)
    const inBox = (y: number) => y >= geo.box.top - 2 && y <= geo.box.top + geo.box.height - geo.lineH + 2
    const active = menu ? menu.items[menu.active] : null
    let place: { left: number; top: number; above: boolean; max: number } | null = null
    if (menu) {
      const rootTop = ta.current?.closest('.ca')?.getBoundingClientRect().top ?? 0
      const listH = Math.min(menu.items.length * (touch ? ITEM_H_TOUCH : ITEM_H) + 8, LIST_MAX)
      const h = listH + (active && (active.sig || active.doc || active.type || active.options) ? 66 : 0) + (touch ? 0 : 24)
      const fieldW = geo.box.left + geo.box.width
      const w = Math.min(460, fieldW - 8)
      const left = Math.max(4, Math.min(c.x, fieldW - w - 4))
      // the visible part of the page (an on-screen keyboard makes it shorter)
      const vv = typeof window !== 'undefined' ? window.visualViewport : null
      const bottom = vv ? vv.offsetTop + vv.height : typeof window !== 'undefined' ? window.innerHeight : 900
      const roomBelow = bottom - (rootTop + c.y + geo.lineH + 2) - 8
      const roomAbove = rootTop + c.y - 2 - Math.max(0, vv?.offsetTop ?? 0) - 8
      const above = h > roomBelow && roomAbove > roomBelow
      const max = Math.max(120, Math.min(LIST_MAX + 90, above ? roomAbove : roomBelow))
      place = { left, top: above ? c.y - 2 - Math.min(h, max) : c.y + geo.lineH + 2, above, max }
    }
    const docPos = doc ? geo.pointAt(doc.info.from) : null
    return (
      <>
        {stops.map((s) => {
          const p = geo.pointAt(s.start)
          return inBox(p.y) ? <span key={`${s.n}:${s.start}`} className="sc-code__stop" style={{ left: p.x - 1, top: p.y, width: (s.end - s.start) * geo.charW + 2, height: geo.lineH }} data-testid="sc-stop" aria-hidden /> : null
        })}
        {menu && place && (
          <div ref={pop} className={`sc-complete${place.above ? ' is-above' : ''}`} style={{ left: place.left, top: place.top }} data-testid="sc-complete">
            <ul id="sc-complete" className="sc-complete__list" role="listbox" aria-label={t('features.script.ed.suggestions')} style={{ maxHeight: Math.max(84, place.max - 64) }}>
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
          <div id="sc-doc" role="tooltip" className="sc-doc" style={{ left: Math.max(4, docPos.x), top: docPos.y + geo.lineH + 2 }} data-testid="sc-doc">
            <DocCard info={doc.info} ws={ws} />
          </div>
        )}
      </>
    )
  }

  /* ---------------------------------------------------------------- render */

  return (
    <CodeArea
      ref={area}
      className={`sc-code${readOnly ? ' sc-code--ro' : ''}`}
      inputClassName="sc-code__input"
      value={value}
      onChange={(next, off) => {
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
      tokenize={tokenize}
      markers={markers}
      renderToken={renderChip}
      brackets="strict"
      enter="indent"
      fixedHeight
      wrapToggle={false}
      readOnly={readOnly}
      ariaLabel={ariaLabel}
      describedBy={doc ? 'sc-doc' : undefined}
      textareaRef={taRef}
      jump={jump}
      onKeyDown={onKeyDown}
      onSelectionChange={onSelect}
      onFocusChange={(on) => {
        setFocused(on)
        if (!on) {
          setDoc(null)
          window.setTimeout(() => {
            if (document.activeElement !== ta.current) setMenu(null)
          }, 150)
        }
      }}
      inputProps={{
        'aria-autocomplete': 'list',
        'aria-haspopup': 'listbox',
        'aria-expanded': !!menu,
        'aria-controls': menu ? 'sc-complete' : undefined,
        'aria-activedescendant': menu ? `sc-complete-${menu.active}` : undefined,
        onKeyUp: (e) => {
          if ((e.key === 'Control' || e.key === 'Meta') && doc?.by === 'mouse') setDoc(null)
        },
        onClick: () => {
          close()
          setDoc(null)
        },
        onMouseMove,
        onMouseLeave: () => doc?.by === 'mouse' && setDoc(null),
      }}
      overlay={overlay}
      bar={
        call ? (
          <span className="sc-code__sig" data-testid="sc-sig">
            <Signature sig={call.sig} active={activeParam(call.sig, call.index, call.named)} />
            <span className="sc-code__sigdesc">{docText(t, call.doc)}</span>
          </span>
        ) : (
          <span className="sc-code__hint">{t('features.script.ed.hint')}</span>
        )
      }
    />
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

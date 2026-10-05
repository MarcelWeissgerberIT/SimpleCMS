/**
 * One Script — the code editor: a plain textarea with a highlighted layer behind it (same monospace
 * metrics, so every character sits where the caret expects it), line numbers, @ references shown as
 * chips (the stable token `@[Label](p:id)` stays the text: chips survive renames, copy and paste),
 * autocomplete for @ references, names, members and property names, signature help, and the error
 * of the last check or run (squiggle, gutter mark, the message at the end of its line).
 *
 * Keys: Tab / Shift+Tab indent, Enter keeps the indentation, Mod+/ comments lines, Backspace after a
 * chip removes the whole chip; Esc then Tab leaves the editor. The parent handles run keys (onKey).
 */
import { useEffect, useLayoutEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useT } from '../../../i18n'
import { analyze, completionAt, memberCandidates, nameCandidates, openCall, segments, signatureOf, type Segment } from './analyze'

export interface RefCandidate {
  label: string
  /** 'p' page / database · 'u' person · 'a' agent · 's' script */
  kind: 'p' | 'u' | 'a' | 's'
  id: string
  /** what it is: "DATABASE", "PAGE", "PERSON" … */
  detail: string
}

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
  /** property names of a database (by id, else by name) */
  propsOf: (dbId: string | null, dbName: string | null) => string[]
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
  label: string
  insert: string
  detail: string
  kind: string
}

const LINE_H = 20
const PAD_Y = 10
const PAD_X = 12

/** The source of a reference token. */
export const refToken = (c: Pick<RefCandidate, 'label' | 'kind' | 'id'>) => `@[${c.label.replace(/[\]\\]/g, (x) => `\\${x}`).replace(/\n/g, ' ')}](${c.kind}:${c.id})`

const IDENT = /^[\p{L}_][\p{L}\p{N}_]*$/u
const nameCode = (n: string) => (IDENT.test(n) ? n : `\`${n.replace(/`/g, '')}\``)

function Chip({ code, seg }: { code: string; seg: Segment }) {
  const raw = code.slice(seg.start, seg.end)
  const m = /^@\[(.*)\]\(([pusa]):([\w-]+)\)$/s.exec(raw)
  if (!m) return <span className="sc-tok sc-tok--ref">{raw}</span>
  const labelRaw = m[1]
  return (
    <span className={`sc-chip sc-chip--${m[2]}`}>
      <span className="sc-chip__at">@</span>
      <span className="sc-chip__gap">[</span>
      <span className="sc-chip__label">{labelRaw}</span>
      <span className="sc-chip__gap">](</span>
      <span className="sc-chip__id">
        {m[2]}:{m[3]}
      </span>
      <span className="sc-chip__gap">)</span>
    </span>
  )
}

/** The highlighted layer: the same characters as the textarea, styled. */
function Layer({ code, segs, error }: { code: string; segs: Segment[]; error: EditorError | null }) {
  const out: ReactNode[] = []
  let at = 0
  const errFrom = error?.start ?? -1
  const errTo = error && error.end !== null && error.start !== null ? Math.max(error.end, error.start + 1) : -1
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
            {code.slice(a, b)}
          </span>
        ) : (
          code.slice(a, b)
        ),
      )
    }
  }
  segs.forEach((s, i) => {
    push(at, s.start, null, `g${i}`)
    if (s.cls === 'ref') {
      const chip = <Chip key={`r${i}`} code={code} seg={s} />
      out.push(errFrom >= s.start && errFrom < s.end ? <span key={`re${i}`} className="sc-squiggle">{chip}</span> : chip)
    } else push(s.start, s.end, s.cls, `s${i}`)
    at = s.end
  })
  push(at, code.length, null, 'end')
  // a final newline needs a character after it to take up its line
  out.push('\n ')
  return <>{out}</>
}

export function CodeEditor({ value, onChange, error = null, readOnly, refs, propsOf, propNames, onKey, onSelectionChange, ariaLabel, textareaRef, jump }: CodeEditorProps) {
  const t = useT()
  const ta = useRef<HTMLTextAreaElement | null>(null)
  const layer = useRef<HTMLPreElement | null>(null)
  const gutter = useRef<HTMLDivElement | null>(null)
  const measure = useRef<HTMLSpanElement | null>(null)
  const [caret, setCaret] = useState(0)
  const [focused, setFocused] = useState(false)
  const [scroll, setScroll] = useState({ top: 0, left: 0 })
  const [items, setItems] = useState<Item[] | null>(null)
  const [active, setActive] = useState(0)
  const [replaceFrom, setReplaceFrom] = useState(0)
  const [charW, setCharW] = useState(7.8)
  const escaped = useRef(false)
  const suppress = useRef(false)

  const analysis = useMemo(() => analyze(value), [value])
  const segs = useMemo(() => segments(analysis, propNames), [analysis, propNames])
  const lines = useMemo(() => value.split('\n').length, [value])

  useLayoutEffect(() => {
    if (measure.current) {
      const w = measure.current.getBoundingClientRect().width / 10
      if (w > 0) setCharW(w)
    }
  }, [])

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

  /* ---------------------------------------------------------------- completion */

  const refresh = (code: string, offset: number) => {
    const ctx = completionAt(code, analyze(code), offset)
    if (!ctx) return setItems(null)
    let list: Item[] = []
    if (ctx.kind === 'ref') {
      list = refs(ctx.query).map((c) => ({ label: c.label, insert: refToken(c), detail: c.detail, kind: `ref-${c.kind}` }))
    } else if (ctx.kind === 'member') {
      const props = ctx.on === 'row' ? propsOf(ctx.dbId, ctx.dbName) : []
      const p = ctx.prefix.toLowerCase()
      list = [
        ...props.filter((n) => n.toLowerCase().startsWith(p) && IDENT.test(n)).map((n) => ({ label: n, insert: n, detail: t('features.script.ed.property'), kind: 'prop' })),
        ...memberCandidates(ctx.on, ctx.prefix).map((f) => ({ label: f.name, insert: f.prop ? f.name : `${f.name}(`, detail: f.sig, kind: 'fn' })),
      ]
    } else {
      const p = ctx.prefix.toLowerCase()
      const props = ctx.propsOf ? propsOf(ctx.propsOf.dbId, ctx.propsOf.dbName).filter((n) => n.toLowerCase().startsWith(p) || nameCode(n).toLowerCase().startsWith(p)) : []
      list = [...props.map((n) => ({ label: n, insert: nameCode(n), detail: t('features.script.ed.property'), kind: 'prop' })), ...(ctx.prefix ? nameCandidates(analyze(code), ctx.prefix) : [])]
    }
    list = list.filter((x, i) => list.findIndex((y) => y.label === x.label && y.kind === x.kind) === i).slice(0, 30)
    if (!list.length || (list.length === 1 && list[0].insert === code.slice(ctx.from, offset))) return setItems(null)
    setReplaceFrom(ctx.from)
    setItems(list)
    setActive(0)
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

  const accept = (it: Item) => {
    const el = ta.current
    if (!el) return
    const end = el.selectionStart
    suppress.current = true
    insertText(replaceFrom, end, it.kind.startsWith('ref') ? `${it.insert} ` : it.insert)
    setItems(null)
  }

  /* ---------------------------------------------------------------- keys */

  const refAt = (offset: number, side: 'before' | 'after') => analysis.tokens.find((tk) => tk.type === 'ref' && (side === 'before' ? tk.pos.end === offset : tk.pos.start === offset))

  const onKeyDown = (e: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    const el = e.currentTarget
    if (items) {
      if (e.key === 'ArrowDown') {
        e.preventDefault()
        return setActive((a) => (a + 1) % items.length)
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault()
        return setActive((a) => (a - 1 + items.length) % items.length)
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        return accept(items[active])
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        return setItems(null)
      }
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
    if ((e.metaKey || e.ctrlKey) && e.key === '/') {
      e.preventDefault()
      const ls = value.slice(0, a).lastIndexOf('\n') + 1
      const lineEnd = value.indexOf('\n', Math.max(b - 1, a))
      const block = value.slice(ls, lineEnd < 0 ? value.length : lineEnd)
      const all = block.split('\n').every((l) => /^\s*#/.test(l) || !l.trim())
      insertText(ls, ls + block.length, all ? block.replace(/^(\s*)# ?/gm, '$1') : block.replace(/^/gm, '# '))
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
    setCaret(b)
    onSelectionChange?.(a, b)
  }

  /* ---------------------------------------------------------------- geometry */

  const caretLine = value.slice(0, caret).split('\n').length - 1
  const caretCol = caret - (value.lastIndexOf('\n', caret - 1) + 1)
  const caretX = PAD_X + caretCol * charW - scroll.left
  const caretY = PAD_Y + caretLine * LINE_H - scroll.top
  const call = focused && !items ? openCall(analysis, caret) : null
  const sig = call ? signatureOf(call.name, call.member) : null
  const errLine = error?.line ?? null
  const gutterW = Math.max(2, String(lines).length) * charW + 22

  return (
    <div className={`sc-code${readOnly ? ' sc-code--ro' : ''}`}>
      <span ref={measure} className="sc-code__measure" aria-hidden>
        0000000000
      </span>
      <div className="sc-code__gutter" style={{ width: gutterW }} aria-hidden>
        <div ref={gutter} style={{ transform: `translateY(${-scroll.top}px)` }}>
          {Array.from({ length: lines }, (_, i) => (
            <div key={i} className={`sc-code__ln${i + 1 === errLine ? ' sc-code__ln--err' : ''}${i === caretLine && focused ? ' sc-code__ln--cur' : ''}`}>
              {i + 1}
            </div>
          ))}
        </div>
      </div>
      <div className="sc-code__field">
        <div className="sc-code__clip" aria-hidden>
          <pre ref={layer} className="sc-code__layer" style={{ transform: `translate(${-scroll.left}px, ${-scroll.top}px)` }}>
            <Layer code={value} segs={segs} error={error} />
          </pre>
          {error?.line && error.message && (
            <div className="sc-code__lens" style={{ top: PAD_Y + (error.line - 1) * LINE_H - scroll.top }}>
              {error.message}
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
          aria-expanded={!!items}
          aria-controls={items ? 'sc-complete' : undefined}
          aria-activedescendant={items ? `sc-complete-${active}` : undefined}
          onChange={(e) => {
            onChange(e.target.value)
            const off = e.target.selectionStart
            setCaret(off)
            if (suppress.current) {
              suppress.current = false
              setItems(null)
            } else refresh(e.target.value, off)
          }}
          onKeyDown={onKeyDown}
          onSelect={onSelect}
          onScroll={(e) => setScroll({ top: e.currentTarget.scrollTop, left: e.currentTarget.scrollLeft })}
          onFocus={() => setFocused(true)}
          onBlur={() => {
            setFocused(false)
            window.setTimeout(() => setItems(null), 150)
          }}
          onClick={() => setItems(null)}
        />
        {items && (
          <ul id="sc-complete" className="sc-complete" role="listbox" aria-label={t('features.script.ed.suggestions')} style={{ left: Math.max(4, Math.min(caretX, 9999)), top: caretY + LINE_H + 2 }}>
            {items.map((it, i) => (
              <li
                key={`${it.kind}:${it.label}`}
                id={`sc-complete-${i}`}
                role="option"
                aria-selected={i === active}
                className={`sc-complete__item${i === active ? ' is-active' : ''}`}
                onMouseDown={(e) => {
                  e.preventDefault()
                  accept(it)
                }}
                onMouseEnter={() => setActive(i)}
              >
                <span className={`sc-complete__kind sc-complete__kind--${it.kind}`} aria-hidden>
                  {it.kind.startsWith('ref') ? '@' : it.kind === 'prop' ? '◆' : it.kind === 'fn' ? 'ƒ' : it.kind === 'kw' ? '§' : '·'}
                </span>
                <span className="sc-complete__label">{it.label}</span>
                <span className="sc-complete__detail">{it.detail}</span>
              </li>
            ))}
          </ul>
        )}
      </div>
      <div className="sc-code__bar" aria-live="polite">
        {sig ? (
          <span className="sc-code__sig">
            <code>{sig.sig}</code>
            <span className="sc-code__sigdesc">{t(`features.script.fn.${sig.name}`)}</span>
          </span>
        ) : (
          <span className="sc-code__hint">{t('features.script.ed.hint')}</span>
        )}
        <span className="sc-code__pos mono">
          {t('features.script.ed.pos', { line: caretLine + 1, col: caretCol + 1 })}
        </span>
      </div>
    </div>
  )
}

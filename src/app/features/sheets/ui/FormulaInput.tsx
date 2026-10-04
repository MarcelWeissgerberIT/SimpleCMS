/**
 * The formula input (formula bar and in-cell editor): an <input> over a coloured mirror of its
 * text — every DS(…) group in its colour, other references in theirs (the grid draws the same
 * colours) — with function / dataset autocomplete and a signature hint (current argument marked).
 * Plain text may carry a ghost completion (AutoComplete from the column): drawn selected after
 * the typed text in the mirror, never part of the input's value until it is accepted.
 */
import { useEffect, useId, useMemo, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { callAt, getFunction, listFunctions, paintFormula, wordAt, type FnSpec } from '../engine'
import { DS_COLORS } from '../model'
import { useT } from '../../../i18n'
import { Floating } from './Floating'

export const groupColor = (id: number) => DS_COLORS[id % DS_COLORS.length]

interface Suggestion {
  name: string
  kind: 'fn' | 'ds'
  hint: string
}

export interface FormulaInputProps {
  value: string
  /** caret position (controlled: the parent also moves it when pointing inserts a reference) */
  caret: number
  onChange: (text: string, caret: number) => void
  onCaret?: (caret: number) => void
  onKeyDown?: (e: KeyboardEvent<HTMLInputElement>) => void
  onFocus?: () => void
  onBlur?: () => void
  inputRef: RefObject<HTMLInputElement | null>
  /** this input is the one being edited (popups only then) */
  active: boolean
  datasets: string[]
  lang: 'en' | 'de'
  className?: string
  ariaLabel: string
  readOnly?: boolean
  placeholder?: string
  style?: React.CSSProperties
  /** AutoComplete: the entry that completes the typed text (shown after it, selected) */
  ghost?: string | null
}

/** Coloured segments of the text (formulas only). */
function mirror(text: string): ReactNode[] {
  if (text[0] !== '=') return [text]
  const body = text.slice(1)
  const { tokens, groups, tokenGroup } = paintFormula(body)
  const color = new Array<number>(body.length).fill(-1)
  const kind = new Array<string>(body.length).fill('')
  for (const g of groups) if (g.kind === 'ds') for (let i = g.s; i < g.e && i < body.length; i++) color[i] = g.id
  tokens.forEach((tk, i) => {
    const cls = tk.t === 'fn' ? 'fn' : tk.t === 'str' ? 'str' : tk.t === 'err' || tk.t === 'bad' ? 'err' : tk.t === 'ref' ? 'ref' : tk.t === 'num' ? 'num' : ''
    for (let j = tk.s; j < tk.e; j++) {
      kind[j] = cls
      if (tokenGroup[i] >= 0 && (tk.t === 'ref' || groups[tokenGroup[i]]?.kind === 'ref')) color[j] = tokenGroup[i]
    }
  })
  const out: ReactNode[] = [
    <span key="eq" className="fx-m fx-m--op">
      =
    </span>,
  ]
  let i = 0
  while (i < body.length) {
    let j = i + 1
    while (j < body.length && color[j] === color[i] && kind[j] === kind[i]) j++
    const c = color[i]
    out.push(
      <span key={i} className={`fx-m${kind[i] ? ` fx-m--${kind[i]}` : ''}${c >= 0 ? ' fx-m--group' : ''}`} style={c >= 0 ? { color: `var(--c-${groupColor(c)}-text)` } : undefined}>
        {body.slice(i, j)}
      </span>,
    )
    i = j
  }
  return out
}

function signature(spec: FnSpec, arg: number, lang: 'en' | 'de'): ReactNode {
  const lastRepeat = spec.args.findIndex((a) => a.repeat)
  const at = lastRepeat >= 0 && arg >= spec.args.length ? spec.args.length - 1 : Math.min(arg, spec.args.length - 1)
  return (
    <>
      <span className="fx-sig__name">{spec.name}(</span>
      {spec.args.map((a, i) => (
        <span key={i}>
          {i > 0 && '; '}
          <span className={i === at ? 'fx-sig__arg is-current' : 'fx-sig__arg'}>
            {a.optional ? `[${a.name}]` : a.name}
            {a.repeat ? '; …' : ''}
          </span>
        </span>
      ))}
      <span className="fx-sig__name">)</span>
      <span className="fx-sig__desc">{spec.description[lang] || spec.description.en}</span>
    </>
  )
}

export function FormulaInput({ value, caret, onChange, onCaret, onKeyDown, onFocus, onBlur, inputRef, active, datasets, lang, className, ariaLabel, readOnly, placeholder, style, ghost }: FormulaInputProps) {
  const t = useT()
  const listId = useId()
  const [index, setIndex] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  const [focused, setFocused] = useState(false)

  const formula = value[0] === '='
  const rest = !formula && ghost && ghost.length > value.length && ghost.toLocaleLowerCase().startsWith(value.toLocaleLowerCase()) ? ghost.slice(value.length) : ''
  const body = formula ? value.slice(1) : ''
  const caretB = caret - 1

  const word = formula && active ? wordAt(body, caretB) : null
  const call = formula && active ? callAt(body, caretB) : null
  const inDS = call?.name === 'DS'

  const suggestions = useMemo<Suggestion[]>(() => {
    if (!word || dismissed === `${word.start}:${word.word}`) return []
    const w = word.word.toUpperCase()
    const out: Suggestion[] = []
    if (inDS) for (const d of datasets) if (d.toUpperCase().startsWith(w)) out.push({ name: d, kind: 'ds', hint: 'DS' })
    for (const f of listFunctions()) {
      if (out.length >= 8) break
      if (f.name.startsWith(w) && !(f.name === w && body[caretB] === '(')) out.push({ name: f.name, kind: 'fn', hint: f.description[lang] || f.description.en })
    }
    return out
  }, [word?.word, word?.start, inDS, datasets, dismissed, lang, body, caretB]) // eslint-disable-line react-hooks/exhaustive-deps

  const open = active && focused && suggestions.length > 0
  const sel = Math.min(index, Math.max(0, suggestions.length - 1))
  const spec = !open && active && focused && call ? getFunction(call.name) : null

  useEffect(() => setIndex(0), [word?.word])

  // keep the mirror scrolled with the input
  const sync = () => {
    const el = inputRef.current
    const m = el?.previousElementSibling as HTMLElement | null
    if (el && m) m.scrollLeft = el.scrollLeft
  }
  useEffect(sync)

  const track = () => {
    const el = inputRef.current
    if (!el) return
    const c = el.selectionStart ?? el.value.length
    if (c !== caret) onCaret?.(c)
    sync()
  }

  const accept = (s: Suggestion) => {
    if (!word) return
    const start = word.start + 1
    const next = value[caret] === '('
    const insert = s.kind === 'fn' && !next ? `${s.name}(` : s.name
    const text = value.slice(0, start) + insert + value.slice(caret)
    const pos = start + insert.length + (s.kind === 'fn' && next ? 1 : 0)
    onChange(text, pos)
    requestAnimationFrame(() => {
      // not when typing went on before this frame: the caret is already where it belongs
      const el = inputRef.current
      if (el && el.value === text) el.setSelectionRange(pos, pos)
      sync()
    })
  }

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (open) {
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault()
        const n = suggestions.length
        setIndex((sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
        return
      }
      if (e.key === 'Enter' || e.key === 'Tab') {
        e.preventDefault()
        accept(suggestions[sel])
        return
      }
      if (e.key === 'Escape') {
        e.preventDefault()
        e.stopPropagation()
        if (word) setDismissed(`${word.start}:${word.word}`)
        return
      }
    }
    onKeyDown?.(e)
  }

  return (
    <div ref={setAnchor} className={`fx-input${formula ? ' is-formula' : ''} ${className ?? ''}`} style={style}>
      <div className="fx-input__mirror" aria-hidden>
        {formula ? (
          mirror(value)
        ) : rest ? (
          <>
            <span className="fx-ghost__typed">{value}</span>
            <span className="fx-ghost" data-ghost="">
              {rest}
            </span>
          </>
        ) : null}
      </div>
      <input
        ref={inputRef}
        className="fx-input__field"
        value={value}
        readOnly={readOnly}
        placeholder={placeholder}
        spellCheck={false}
        autoComplete="off"
        aria-label={ariaLabel}
        aria-description={rest ? ghost! : undefined}
        aria-autocomplete={formula ? 'list' : 'both'}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${sel}` : undefined}
        onChange={(e) => {
          const c = e.target.selectionStart ?? e.target.value.length
          setDismissed(null)
          onChange(e.target.value, c)
        }}
        onSelect={track}
        onKeyUp={track}
        onMouseUp={track}
        onScroll={sync}
        onKeyDown={keyDown}
        onFocus={() => {
          setFocused(true)
          onFocus?.()
        }}
        onBlur={() => {
          setFocused(false)
          onBlur?.()
        }}
      />
      {open && (
        <Floating anchor={anchor} className="fx-pop fx-suggest" id={listId} role="listbox">
          <div className="fx-pop__label label" aria-hidden>
            {t('features.sheets.fn.suggestions')}
          </div>
          {suggestions.map((s, i) => (
            <div
              key={`${s.kind}:${s.name}`}
              id={`${listId}-${i}`}
              role="option"
              aria-selected={i === sel}
              className={`fx-suggest__item${i === sel ? ' is-active' : ''}`}
              onMouseDown={(e) => {
                e.preventDefault()
                accept(s)
              }}
              onMouseEnter={() => setIndex(i)}
            >
              <span className={`fx-suggest__name${s.kind === 'ds' ? ' is-ds' : ''}`}>{s.name}</span>
              <span className="fx-suggest__hint">{s.hint}</span>
            </div>
          ))}
        </Floating>
      )}
      {spec && call && (
        <Floating anchor={anchor} className="fx-pop fx-sig" role="tooltip">
          {signature(spec, call.arg, lang)}
        </Floating>
      )}
    </div>
  )
}

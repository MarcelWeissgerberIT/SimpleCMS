/**
 * The formula input (formula bar and in-cell editor): an <input> over a coloured mirror of its
 * text — every DS(…) group in its colour, other references in theirs (the grid draws the same
 * colours) — with function / dataset autocomplete and a signature hint (current argument marked).
 * Plain text may carry a ghost completion (AutoComplete from the column): drawn selected after
 * the typed text in the mirror, never part of the input's value until it is accepted.
 * Phone keyboards send no usable keydown (key "Unidentified" / 229, compositions, replacement
 * text): what happened is read from the input events (inputType) instead — a Backspace that only
 * drops the ghost is a cancelled `beforeinput`.
 */
import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type ReactNode, type RefObject } from 'react'
import { getFunction, paintFormula, type FnSpec } from '../engine'
import { DS_COLORS } from '../model'
import { useT } from '../../../i18n'
import { Floating } from './Floating'
import { acceptSuggestion, argIndex, formulaContext, formulaSuggestions, type Suggestion } from './suggest'

export const groupColor = (id: number) => DS_COLORS[id % DS_COLORS.length]

export interface FormulaInputProps {
  value: string
  /** caret position (controlled: the parent also moves it when pointing inserts a reference) */
  caret: number
  /** a change of the text — `inputType` of the input event that made it (insertText, deleteContentBackward, insertCompositionText …) */
  onChange: (text: string, caret: number, inputType?: string) => void
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
  /** a Backspace / Delete at the end only drops the ghost (keyboards that send no Backspace keydown) */
  onDropGhost?: () => void
  /** touch: the suggestion strip shows the suggestions and the signature (no popups under the input; ↵ still takes the first) */
  touch?: boolean
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

/** A function's signature, the argument at the caret marked (also the touch strip's first row). */
export function signature(spec: FnSpec, arg: number, lang: 'en' | 'de', description = true): ReactNode {
  const at = argIndex(spec, arg)
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
      {description && <span className="fx-sig__desc">{spec.description[lang] || spec.description.en}</span>}
    </>
  )
}

export function FormulaInput({ value, caret, onChange, onCaret, onKeyDown, onFocus, onBlur, inputRef, active, datasets, lang, className, ariaLabel, readOnly, placeholder, style, ghost, onDropGhost, touch }: FormulaInputProps) {
  const t = useT()
  const listId = useId()
  const [index, setIndex] = useState(0)
  const [dismissed, setDismissed] = useState<string | null>(null)
  const [anchor, setAnchor] = useState<HTMLDivElement | null>(null)
  const [focused, setFocused] = useState(false)

  const formula = value[0] === '='
  const rest = !formula && ghost && ghost.length > value.length && ghost.toLocaleLowerCase().startsWith(value.toLocaleLowerCase()) ? ghost.slice(value.length) : ''

  const ctx = formula && active ? formulaContext(value, caret) : null
  const word = ctx?.word ?? null
  const call = ctx?.call ?? null

  const suggestions = useMemo<Suggestion[]>(
    () => (!word || dismissed === `${word.start}:${word.word}` ? [] : formulaSuggestions(ctx, datasets, lang)),
    [word?.word, word?.start, ctx?.inDS, datasets, dismissed, lang, ctx?.body, caret], // eslint-disable-line react-hooks/exhaustive-deps
  )

  /** the keys work the list (↑↓ ↵ Tab Esc) — on touch it is drawn by the strip, not here */
  const listed = active && focused && suggestions.length > 0
  const open = listed && !touch
  const sel = Math.min(index, Math.max(0, suggestions.length - 1))
  const spec = !listed && !touch && active && focused && call ? getFunction(call.name) : null

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

  // a Backspace / Delete the keydown didn't see (phone keyboards): with a ghost at the end it only drops the ghost
  const drop = useRef({ rest, onDropGhost })
  drop.current = { rest, onDropGhost }
  useEffect(() => {
    const el = inputRef.current
    if (!el) return
    const onBefore = (e: InputEvent) => {
      if (e.inputType !== 'deleteContentBackward' && e.inputType !== 'deleteContentForward') return
      const { rest: shown, onDropGhost: dropGhost } = drop.current
      if (!shown || !dropGhost || e.isComposing || !e.cancelable) return
      if (el.selectionStart !== el.value.length || el.selectionEnd !== el.value.length) return
      e.preventDefault()
      dropGhost()
    }
    el.addEventListener('beforeinput', onBefore)
    return () => el.removeEventListener('beforeinput', onBefore)
  }, [inputRef])

  const accept = (s: Suggestion) => {
    if (!word) return
    const { text, caret: pos } = acceptSuggestion(value, caret, word.start, s)
    onChange(text, pos)
    requestAnimationFrame(() => {
      // not when typing went on before this frame: the caret is already where it belongs
      const el = inputRef.current
      if (el && el.value === text) el.setSelectionRange(pos, pos)
      sync()
    })
  }

  const keyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    // an IME composition owns its keys (↵ confirms the composed text there)
    if (listed && !e.nativeEvent.isComposing && e.keyCode !== 229) {
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
        autoCorrect="off"
        enterKeyHint="done"
        aria-label={ariaLabel}
        aria-description={rest ? ghost! : undefined}
        aria-autocomplete={formula ? 'list' : 'both'}
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open ? `${listId}-${sel}` : undefined}
        onChange={(e) => {
          const c = e.target.selectionStart ?? e.target.value.length
          setDismissed(null)
          onChange(e.target.value, c, (e.nativeEvent as InputEvent).inputType)
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

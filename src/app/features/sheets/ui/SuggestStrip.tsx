/**
 * Touch suggestion strip: while a cell is edited on touch, a row of finger-sized chips right above
 * the cell editor / formula bar, kept inside the visual viewport (above the on-screen keyboard).
 *  - text: the column entries that complete what was typed (AutoComplete's rules; ↵ takes the first)
 *  - formula: the functions (with their arguments) and datasets that complete the word at the
 *    caret; where a reference can go, "Pick range" (the keyboard steps aside, the grid points)
 *    and the saved datasets as DS(…)
 *  - picking a range: "Keep typing" and "Done"
 * Inside a function call its signature heads the strip (the argument at the caret marked) — on
 * touch the input's own popups stay closed. Chips never take the focus (no keyboard flicker): a
 * press keeps it in the input.
 */
import { useEffect, useLayoutEffect, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { autoUpdate, flip, offset, shift, useFloating } from '@floating-ui/react'
import { Check, Keyboard, SquareDashedMousePointer } from 'lucide-react'
import type { ColorName } from '../../../store/types'
import { colName, completeEntries, getFunction, type FnSpec } from '../engine'
import { signature } from './FormulaInput'
import { acceptSuggestion, argsText, formulaContext, formulaSuggestions } from './suggest'

const MAX = 5

export interface StripChip {
  id: string
  kind: 'value' | 'fn' | 'ds' | 'action'
  content: ReactNode
  /** accessible name where the content isn't one */
  label?: string
  /** ↵ on the keyboard takes this one */
  enter?: boolean
  onPress: () => void
}

export interface SuggestStripProps {
  /** the cell editor or the formula bar (looked up after every render) */
  getAnchor: () => Element | null
  value: string
  caret: number
  /** the edited cell's column */
  col: number
  /** the column's entries (null: AutoComplete is off) */
  entries: string[] | null
  /** the proposal ↵ takes (AutoComplete) */
  completion: string | null
  datasets: Array<{ name: string; color: ColorName }>
  lang: 'en' | 'de'
  t: (key: string, vars?: Record<string, string | number>) => string
  /** a reference can go at the caret */
  pointable: boolean
  /** the keyboard is put away: the grid points */
  picking: boolean
  /** take a column entry (ends the edit) */
  onValue: (entry: string) => void
  /** a new formula text + caret */
  onText: (text: string, caret: number) => void
  onPickRange: () => void
  onKeepTyping: () => void
  onDone: () => void
}

const icon = (C: typeof Check) => <C size={15} strokeWidth={1.75} aria-hidden />

const action = (id: string, C: typeof Check, text: string, onPress: () => void): StripChip => ({
  id,
  kind: 'action',
  content: (
    <>
      {icon(C)}
      {text}
    </>
  ),
  onPress,
})

interface StripContent {
  label: ReactNode
  chips: StripChip[]
  /** the function call around the caret (its signature heads the strip) */
  sig: { spec: FnSpec; arg: number } | null
}

/** The strip's chips, its spec label and signature for the edit as it stands. */
export function stripChips(p: Omit<SuggestStripProps, 'getAnchor'>): StripContent {
  const { t, value, caret } = p
  const ctx = formulaContext(value, caret)
  const callSpec = ctx?.call ? getFunction(ctx.call.name) : undefined
  const sig = ctx?.call && callSpec ? { spec: callSpec, arg: ctx.call.arg } : null
  if (p.picking)
    return {
      sig,
      label: (
        <>
          <span className="led led--on" aria-hidden />
          {t('features.sheets.strip.range')}
        </>
      ),
      chips: [action('keep', Keyboard, t('features.sheets.strip.keepTyping'), p.onKeepTyping), action('done', Check, t('features.sheets.strip.done'), p.onDone)],
    }

  if (!ctx) {
    const list = p.entries && caret === value.length ? completeEntries(p.entries, value, p.lang, MAX) : []
    return {
      sig: null,
      label: t('features.sheets.strip.column', { col: colName(p.col) }),
      chips: list.map((e, i) => ({ id: `v:${e}`, kind: 'value', content: e, enter: i === 0 && e === p.completion, onPress: () => p.onValue(e) })),
    }
  }

  const chips: StripChip[] = []
  const names = p.datasets.map((d) => d.name)
  const swatch = (name: string) => {
    const d = p.datasets.find((x) => x.name === name)
    return <i className="sh-strip__swatch" style={{ background: `var(--c-${d?.color ?? 'gray'}-text)` }} aria-hidden />
  }
  /** a dataset at the caret (replacing the word being typed): its name inside DS(…), else DS(NAME) */
  const dsChip = (name: string, from: number): StripChip => ({
    id: `ds:${name}`,
    kind: 'ds',
    label: t('features.sheets.strip.ds', { name }),
    content: (
      <>
        {swatch(name)}
        <span className="sh-strip__ds">DS · {name.toUpperCase()}</span>
      </>
    ),
    onPress: () => {
      const insert = ctx.inDS ? name : `DS(${name})`
      p.onText(value.slice(0, from) + insert + value.slice(caret), from + insert.length)
    },
  })

  if (ctx.word) {
    const word = ctx.word
    formulaSuggestions(ctx, names, p.lang, MAX).forEach((s, i) => {
      const spec = s.kind === 'fn' ? getFunction(s.name) : null
      chips.push(
        s.kind === 'ds'
          ? { ...dsChip(s.name, word.start + 1), enter: i === 0 }
          : {
              id: `fn:${s.name}`,
              kind: 'fn',
              label: spec ? `${s.name}${argsText(spec)}` : s.name,
              enter: i === 0,
              content: (
                <>
                  <span className="sh-strip__fn">{s.name}</span>
                  {spec && <span className="sh-strip__args">{argsText(spec)}</span>}
                </>
              ),
              onPress: () => {
                const next = acceptSuggestion(value, caret, word.start, s)
                p.onText(next.text, next.caret)
              },
            },
      )
    })
    // outside DS(…) a dataset may be meant as well
    if (!ctx.inDS) for (const n of names) if (chips.length < MAX && n.toUpperCase().startsWith(word.word.toUpperCase())) chips.push(dsChip(n, word.start + 1))
  } else if (p.pointable) {
    chips.push(action('range', SquareDashedMousePointer, t('features.sheets.strip.pickRange'), p.onPickRange))
    for (const n of names.slice(0, MAX - 1)) chips.push(dsChip(n, caret))
  }
  // while a word is completed, its suggestions are the point (the signature comes back after)
  return { label: t('features.sheets.strip.formula'), chips, sig: ctx.word && chips.length ? null : sig }
}

export function SuggestStrip(props: SuggestStripProps) {
  const { getAnchor, t } = props
  const { label, chips, sig } = stripChips(props)
  const { refs, floatingStyles, update, isPositioned } = useFloating({
    placement: 'top-start',
    strategy: 'fixed',
    whileElementsMounted: autoUpdate,
    // the default root boundary is the visual viewport: above the on-screen keyboard
    middleware: [offset(6), flip({ padding: 8, fallbackPlacements: ['bottom-start'] }), shift({ padding: 8, crossAxis: true })],
  })

  useLayoutEffect(() => {
    refs.setReference(getAnchor())
  })

  // the keyboard opening / closing resizes the visual viewport, nothing else tells
  useEffect(() => {
    const vv = window.visualViewport
    if (!vv) return
    vv.addEventListener('resize', update)
    vv.addEventListener('scroll', update)
    return () => {
      vv.removeEventListener('resize', update)
      vv.removeEventListener('scroll', update)
    }
  }, [update])

  if (!chips.length && !sig) return null
  return createPortal(
    <div
      ref={refs.setFloating}
      className="sh-strip"
      data-popover=""
      role="toolbar"
      aria-label={t('features.sheets.strip.label')}
      style={{ ...floatingStyles, visibility: isPositioned ? undefined : 'hidden' }}
      onMouseDown={(e) => e.preventDefault()}
    >
      {sig && (
        <div className="sh-strip__sig fx-sig" role="note">
          {signature(sig.spec, sig.arg, props.lang, false)}
        </div>
      )}
      {chips.length > 0 && (
        <div className="sh-strip__row">
          <span className="sh-strip__label label">{label}</span>
          <div className="sh-strip__chips">
            {chips.map((c) => (
              <button key={c.id} type="button" tabIndex={-1} className={`sh-strip__chip is-${c.kind}${c.enter ? ' is-enter' : ''}`} data-chip={c.id} aria-label={c.label} onMouseDown={(e) => e.preventDefault()} onClick={c.onPress}>
                {c.content}
                {c.enter && (
                  <span className="kbd sh-strip__enter" aria-hidden>
                    ↵
                  </span>
                )}
              </button>
            ))}
          </div>
        </div>
      )}
    </div>,
    document.body,
  )
}

/** Small form controls of the chart builder (segmented choice, labelled field, native select). */
import { useId, useRef, type KeyboardEvent, type ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'

export interface SegItem<T extends string> {
  value: T
  label: string
  disabled?: boolean
}

/** A radio group drawn as one row of keys; ← → move the choice. */
export function Seg<T extends string>({ value, items, onChange, label, size = 'md' }: { value: T; items: SegItem<T>[]; onChange: (v: T) => void; label: string; size?: 'sm' | 'md' }) {
  const ref = useRef<HTMLDivElement>(null)
  const onKey = (e: KeyboardEvent) => {
    const dir = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!dir) return
    e.preventDefault()
    const enabled = items.filter((i) => !i.disabled)
    const at = enabled.findIndex((i) => i.value === value)
    const next = enabled[(at + dir + enabled.length) % enabled.length]
    if (!next) return
    onChange(next.value)
    requestAnimationFrame(() => ref.current?.querySelector<HTMLElement>(`[data-value="${CSS.escape(next.value)}"]`)?.focus())
  }
  return (
    <div ref={ref} className={`chb-seg chb-seg--${size}`} role="radiogroup" aria-label={label} onKeyDown={onKey}>
      {items.map((it) => {
        const on = it.value === value
        return (
          <button key={it.value} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} data-value={it.value} disabled={it.disabled} className="chb-seg__key" onClick={() => onChange(it.value)}>
            {it.label}
          </button>
        )
      })}
    </div>
  )
}

export function Field({ label, children, hint, wide }: { label: string; children: (id: string) => ReactNode; hint?: string; wide?: boolean }) {
  const id = useId()
  return (
    <div className={`chb-field${wide ? ' chb-field--wide' : ''}`}>
      <label className="label chb-field__label" htmlFor={id}>
        {label}
      </label>
      {children(id)}
      {hint && <span className="chb-field__hint">{hint}</span>}
    </div>
  )
}

export function Select({ id, value, onChange, options, ariaLabel }: { id?: string; value: string; onChange: (v: string) => void; options: Array<{ value: string; label: string }>; ariaLabel?: string }) {
  return (
    <span className="chb-select">
      <select id={id} className="input chb-select__el" value={value} onChange={(e) => onChange(e.target.value)} aria-label={ariaLabel}>
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
      <ChevronDown size={14} strokeWidth={1.75} className="chb-select__chev" aria-hidden />
    </span>
  )
}

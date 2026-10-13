/**
 * A threshold stepper (section 06): "− [0,70] +" — two decimals in the UI's decimal sign. The field is a spinbutton
 * (↑ / ↓ and + / − step, a typed value is read on blur or Enter, clamped and put on the step); the − / + keys step too
 * and take ← / → while they hold the focus. Nothing outside [min, max] is ever written. A key at its end is
 * aria-disabled, never disabled: the focus stays on it (a disabled key would drop it on the page's body).
 */
import { useEffect, useState, type KeyboardEvent } from 'react'
import { Minus, Plus } from 'lucide-react'
import type { Lang } from '@/shared/i18n'
import { fmtP } from './JevLine'

export interface StepperProps {
  value: number
  min: number
  max: number
  step: number
  onChange: (v: number) => void
  lang: Lang
  /** the field's name ("Mark below") */
  label: string
  /** "lower" / "higher" for the keys */
  less: string
  more: string
  disabled?: boolean
  describedBy?: string
  testId?: string
}

/** A typed threshold → a number (",": the German decimal sign; null: not one). */
export function readP(text: string): number | null {
  const s = text.trim().replace(',', '.')
  if (!/^\d*(\.\d+)?$/.test(s) || !s || s === '.') return null
  const v = Number(s)
  return Number.isFinite(v) ? v : null
}

const onStep = (v: number, min: number, max: number, step: number): number => {
  const n = Math.round(Math.round(v / step) * step * 100) / 100
  return Math.min(max, Math.max(min, n))
}

export function Stepper({ value, min, max, step, onChange, lang, label, less, more, disabled, describedBy, testId }: StepperProps) {
  const [text, setText] = useState(() => fmtP(value, lang))
  useEffect(() => setText(fmtP(value, lang)), [value, lang])
  const commit = (raw: string) => {
    const v = readP(raw)
    const next = v === null ? value : onStep(v, min, max, step)
    setText(fmtP(next, lang))
    if (next !== value) onChange(next)
  }
  const by = (d: number) => {
    const next = onStep(value + d * step, min, max, step)
    if (next !== value) onChange(next)
  }
  const fieldKey = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'ArrowUp' || e.key === '+') {
      e.preventDefault()
      by(1)
    } else if (e.key === 'ArrowDown' || e.key === '-') {
      e.preventDefault()
      by(-1)
    } else if (e.key === 'Enter') {
      e.preventDefault()
      commit(text)
    }
  }
  const keyKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
      e.preventDefault()
      by(e.key === 'ArrowRight' ? 1 : -1)
    }
  }
  const atMin = !disabled && value <= min
  const atMax = !disabled && value >= max
  return (
    <span className="jev-step" data-testid={testId}>
      <button type="button" className="jev-step__key" onClick={() => !atMin && by(-1)} onKeyDown={keyKey} disabled={disabled} aria-disabled={atMin || undefined} aria-label={`${label}: ${less}`}>
        <Minus size={12} strokeWidth={1.75} aria-hidden />
      </button>
      <input
        className="jev-step__field mono"
        type="text"
        inputMode="decimal"
        autoComplete="off"
        spellCheck={false}
        role="spinbutton"
        aria-label={label}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={value}
        aria-valuetext={fmtP(value, lang)}
        aria-describedby={describedBy}
        disabled={disabled}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onBlur={() => commit(text)}
        onKeyDown={fieldKey}
      />
      <button type="button" className="jev-step__key" onClick={() => !atMax && by(1)} onKeyDown={keyKey} disabled={disabled} aria-disabled={atMax || undefined} aria-label={`${label}: ${more}`}>
        <Plus size={12} strokeWidth={1.75} aria-hidden />
      </button>
    </span>
  )
}

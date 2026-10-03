/** Small shared controls of the templates UI (save dialog, template banner). */
import { useRef } from 'react'
import { useT } from '../../i18n'
import type { TemplateCategory } from '../../store/types'
import { TEMPLATE_CATEGORIES } from './own'

const CHOICES: Array<TemplateCategory | null> = [null, ...TEMPLATE_CATEGORIES]

/** Category of a template as a row of mono chips (radio group, arrow keys move). */
export function CategoryChips({ value, onChange, disabled, label }: { value: TemplateCategory | null; onChange: (c: TemplateCategory | null) => void; disabled?: boolean; label: string }) {
  const t = useT()
  const ref = useRef<HTMLDivElement>(null)
  const onKey = (e: React.KeyboardEvent) => {
    const i = CHOICES.indexOf(value)
    const d = e.key === 'ArrowRight' || e.key === 'ArrowDown' ? 1 : e.key === 'ArrowLeft' || e.key === 'ArrowUp' ? -1 : 0
    if (!d || disabled) return
    e.preventDefault()
    const next = (i + d + CHOICES.length) % CHOICES.length
    onChange(CHOICES[next])
    ref.current?.querySelectorAll<HTMLElement>('[role="radio"]')[next]?.focus()
  }
  return (
    <div className="tpl-chips" role="radiogroup" aria-label={label} ref={ref} onKeyDown={onKey}>
      {CHOICES.map((c) => (
        <button
          key={c ?? 'none'}
          type="button"
          role="radio"
          aria-checked={value === c}
          tabIndex={value === c ? 0 : -1}
          className="tpl-filter__tab"
          disabled={disabled}
          onClick={() => onChange(c)}
        >
          {c ? t(`features.tpl.cat.${c}`) : t('features.tpl.unsorted')}
        </button>
      ))}
    </div>
  )
}

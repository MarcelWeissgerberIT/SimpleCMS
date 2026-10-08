import type { CSSProperties } from 'react'
import { X } from 'lucide-react'
import { useT } from '../../i18n'
import { titleIfClipped } from '../../ui/clip'
import type { Filter } from './query'
import { chipLabel, type FilterEnv, type FilterIndex } from './filters'

/**
 * The filters taken out of the ⌘K field: one key each, removed by a click, Enter, Space, Delete or
 * Backspace (the field gets the focus back). Their keys stop here — the list underneath would otherwise
 * open its selected row on Enter.
 */
export function Chips({ chips, fx, env, onRemove }: { chips: Filter[]; fx: FilterIndex; env: FilterEnv; onRemove: (i: number) => void }) {
  const t = useT()
  if (!chips.length) return null
  return (
    <span className="pal-chips" role="list" aria-label={t('shell.palette.chips')}>
      {chips.map((f, i) => {
        const c = chipLabel(fx, f, env, t)
        const said = `${c.neg ? `${t('shell.palette.not')} ` : ''}${c.key === '@' ? '@' : `${c.key}: `}${c.value}`
        return (
          <span role="listitem" key={`${i}:${f.raw}`} className="pal-chips__item">
            <button
              type="button"
              className="pal-chip"
              data-neg={c.neg || undefined}
              aria-label={t('shell.palette.chipRemove', { filter: said })}
              onMouseEnter={(e) => titleIfClipped(e, '.pal-chip__v')}
              onFocus={(e) => titleIfClipped(e, '.pal-chip__v')}
              onClick={() => onRemove(i)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ' || e.key === 'Delete' || e.key === 'Backspace') {
                  e.preventDefault()
                  e.stopPropagation()
                  onRemove(i)
                } else if (e.key === 'Home' || e.key === 'End' || e.key === 'ArrowUp' || e.key === 'ArrowDown') e.stopPropagation()
              }}
            >
              {c.neg && <span className="pal-chip__not">{t('shell.palette.not')}</span>}
              <span className="pal-chip__k">{c.key}</span>
              {c.color && <span className="pal-dot" style={{ '--dot': `var(--c-${c.color}-text)` } as CSSProperties} aria-hidden />}
              <span className="pal-chip__v">{c.value}</span>
              <X size={12} strokeWidth={2} aria-hidden className="pal-chip__x" />
            </button>
          </span>
        )
      })}
    </span>
  )
}

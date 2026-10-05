/**
 * One memory — "MEMORY · 2" for a compact answer (⌘K "?"): a key that lists what went along with the
 * request, each a link to its entry (side peek).
 */
import { useState } from 'react'
import { useT } from '../../../i18n'
import { openEntry } from './open'
import type { MemoryUse } from './types'
import './memory.css'

export function MemoryNote({ use, onOpen }: { use: MemoryUse; onOpen?: () => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  if (use.off) return null
  return (
    <span className="mem-note">
      <button type="button" className="term-head__mem mem-note__key" aria-expanded={open} onClick={() => setOpen((v) => !v)} title={t('features.memory.chipTitle')} data-testid="memory-note">
        {t('features.memory.chip', { count: use.items.length })}
      </button>
      {open && (
        <ul className="mem-note__list" aria-label={t('features.memory.list.usedBy')}>
          {!use.items.length && <li className="mem-note__none">{t('features.memory.list.none')}</li>}
          {use.items.map((it) => (
            <li key={it.id}>
              <button
                type="button"
                className="mem-note__item"
                onClick={() => {
                  onOpen?.()
                  openEntry(it.id)
                }}
              >
                <span className="mem-note__label">{it.label}</span>
                <span className="mem-note__text">{it.text}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </span>
  )
}

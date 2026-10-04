/**
 * "Pick from list" (Alt+↓ / the cell menu): the distinct texts of the cell's column in a small
 * listbox — type to narrow, ↑↓ to move, ↵ to take, Esc to close. PickPanel is the list itself
 * (also inside the touch cell menu's "Pick a value", finger-sized there).
 */
import { useId, useMemo, useState } from 'react'
import { Popover } from '../../../ui/Popover'

type T = (key: string, vars?: Record<string, string | number>) => string

export interface PickListProps {
  anchor: Element | null
  entries: string[]
  /** the column letter (spec label) */
  column: string
  /** text to start the search with (what was typed in the cell) */
  initial?: string
  t: T
  onPick: (value: string) => void
  onClose: () => void
}

export interface PickPanelProps {
  entries: string[]
  column: string
  initial?: string
  t: T
  onPick: (value: string) => void
  /** the search field takes the keyboard when the panel opens */
  autoFocus?: boolean
  /** finger-sized rows (the touch sheet) */
  touch?: boolean
}

const fold = (s: string) => s.toLocaleLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function PickPanel({ entries, column, initial = '', t, onPick, autoFocus = true, touch }: PickPanelProps) {
  const id = useId()
  const [q, setQ] = useState(initial)
  const [active, setActive] = useState(0)
  const list = useMemo(() => {
    const f = fold(q.trim())
    if (!f) return entries
    // starts-with first, then contains
    const starts = entries.filter((e) => fold(e).startsWith(f))
    return [...starts, ...entries.filter((e) => !starts.includes(e) && fold(e).includes(f))]
  }, [entries, q])
  const sel = Math.min(active, Math.max(0, list.length - 1))

  return (
    <div className={`sh-pick__panel${touch ? ' is-touch' : ''}`}>
      <input
        className="input sh-pick__search"
        data-autofocus={autoFocus ? '' : undefined}
        value={q}
        placeholder={t('features.sheets.pick.search')}
        aria-label={t('features.sheets.pick.search')}
        role="combobox"
        aria-expanded
        aria-controls={id}
        aria-activedescendant={list.length ? `${id}-${sel}` : undefined}
        spellCheck={false}
        autoComplete="off"
        autoCorrect="off"
        enterKeyHint="done"
        onChange={(e) => {
          setQ(e.target.value)
          setActive(0)
        }}
        onKeyDown={(e) => {
          if (e.nativeEvent.isComposing) return
          const n = list.length || 1
          if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault()
            setActive((sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
          } else if (e.key === 'Home' || e.key === 'End') {
            if (!list.length) return
            e.preventDefault()
            setActive(e.key === 'Home' ? 0 : list.length - 1)
          } else if ((e.key === 'Enter' || e.key === 'Tab') && list[sel] !== undefined) {
            e.preventDefault()
            onPick(list[sel])
          }
        }}
      />
      <div className="sh-pick__list" id={id} role="listbox" aria-label={t('features.sheets.pick.title')}>
        {list.length === 0 && <div className="sh-pick__empty">{entries.length ? t('features.sheets.pick.none') : t('features.sheets.pick.empty')}</div>}
        {list.map((e, i) => (
          <div
            key={e}
            id={`${id}-${i}`}
            role="option"
            aria-selected={i === sel}
            className={`sh-pick__item${i === sel ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onMouseDown={(ev) => ev.preventDefault()}
            onClick={() => onPick(e)}
            ref={i === sel ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
          >
            {e}
          </div>
        ))}
      </div>
      <div className="sh-pick__foot label" aria-hidden>
        {t(list.length === 1 ? 'features.sheets.pick.count1' : 'features.sheets.pick.count', { n: list.length, col: column })}
      </div>
    </div>
  )
}

export function PickList({ anchor, entries, column, initial = '', t, onPick, onClose }: PickListProps) {
  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} placement="bottom-start" className="sh-pick" role="dialog" aria-label={t('features.sheets.pick.title')}>
      <PickPanel entries={entries} column={column} initial={initial} t={t} onPick={onPick} />
    </Popover>
  )
}

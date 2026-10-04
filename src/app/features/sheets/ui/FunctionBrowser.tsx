/**
 * "fx" function browser: search by name, description (EN + DE) or the German Excel name
 * (SVERWEIS → VLOOKUP), filter by category, insert at the caret. Custom functions come from the
 * registry; "Edit functions…" opens the builder.
 */
import { useMemo, useState, useSyncExternalStore } from 'react'
import { Popover } from '../../../ui/Popover'
import { listFunctions, registryVersion, subscribeRegistry, type FnCategory, type FnSpec } from '../engine'
import { HelpLink } from '../../../help'

const CATS: FnCategory[] = ['data', 'math', 'stats', 'logic', 'text', 'date', 'lookup', 'info', 'custom']

export interface FunctionBrowserProps {
  anchor: Element | null
  onClose: () => void
  onInsert: (name: string) => void
  onEditFunctions?: () => void
  lang: 'en' | 'de'
  t: (key: string, vars?: Record<string, string | number>) => string
}

const fold = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '')

export function FunctionBrowser({ anchor, onClose, onInsert, onEditFunctions, lang, t }: FunctionBrowserProps) {
  const version = useSyncExternalStore(subscribeRegistry, registryVersion)
  const [q, setQ] = useState('')
  const [cat, setCat] = useState<FnCategory | 'all'>('all')
  const [active, setActive] = useState(0)
  const all = useMemo(() => listFunctions(), [version])
  const cats = CATS.filter((c) => all.some((f) => f.category === c))
  const list = useMemo(() => {
    const words = fold(q).split(/\s+/).filter(Boolean)
    return all.filter((f) => {
      if (cat !== 'all' && f.category !== cat) return false
      if (!words.length) return true
      const hay = fold(`${f.name} ${f.description.en} ${f.description.de} ${f.keywords ?? ''}`)
      return words.every((w) => hay.includes(w))
    })
  }, [all, q, cat])
  const sel = Math.min(active, Math.max(0, list.length - 1))

  const pick = (f: FnSpec) => {
    onInsert(f.name)
    onClose()
  }

  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} placement="bottom-start" className="fxb" aria-label={t('features.sheets.functions')} role="dialog">
      <div className="fxb__head">
        <input
          className="input fxb__search"
          data-autofocus=""
          value={q}
          placeholder={t('features.sheets.fn.search')}
          aria-label={t('features.sheets.fn.search')}
          onChange={(e) => {
            setQ(e.target.value)
            setActive(0)
          }}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
              e.preventDefault()
              const n = list.length || 1
              setActive((sel + (e.key === 'ArrowDown' ? 1 : n - 1)) % n)
            } else if (e.key === 'Enter' && list[sel]) {
              e.preventDefault()
              pick(list[sel])
            }
          }}
        />
        <div className="fxb__cats" role="group">
          {(['all', ...cats] as const).map((c) => (
            <button key={c} type="button" className={`fxb__cat${cat === c ? ' is-active' : ''}`} aria-pressed={cat === c} onClick={() => setCat(c)}>
              {t(c === 'all' ? 'features.sheets.fn.all' : `features.sheets.fn.cat.${c}`)}
            </button>
          ))}
        </div>
      </div>
      <div className="fxb__list" role="listbox" aria-label={t('features.sheets.functions')}>
        {list.length === 0 && <div className="fxb__empty">{t('features.sheets.fn.empty')}</div>}
        {list.map((f, i) => (
          <button
            key={f.name}
            type="button"
            role="option"
            aria-selected={i === sel}
            className={`fxb__item${i === sel ? ' is-active' : ''}`}
            onMouseEnter={() => setActive(i)}
            onClick={() => pick(f)}
            ref={i === sel ? (el) => el?.scrollIntoView({ block: 'nearest' }) : undefined}
          >
            <span className="fxb__sig">
              <span className="fxb__name">{f.name}</span>({f.args.map((a) => (a.optional ? `[${a.name}]` : a.name) + (a.repeat ? '; …' : '')).join('; ')})
            </span>
            <span className="fxb__cat-tag label">{t(`features.sheets.fn.cat.${f.category}`)}</span>
            <span className="fxb__desc">{f.description[lang] || f.description.en}</span>
            {i === sel && <span className="fxb__ex">{f.example}</span>}
          </button>
        ))}
      </div>
      <div className="fxb__foot">
        <span className="label">
          {list.length === 1 ? t('features.sheets.fn.count1') : t('features.sheets.fn.count', { n: list.length })}
          <HelpLink id="spreadsheets" />
        </span>
        {onEditFunctions && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              onClose()
              onEditFunctions()
            }}
          >
            {t('features.sheets.fn.edit')}
          </button>
        )}
      </div>
    </Popover>
  )
}

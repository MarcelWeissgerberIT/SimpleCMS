/**
 * The header's filter (plan §3.3, §6 U15): "All databases ▾" opens a popover — presets first (Everything · Fuse paths
 * only · Running now · Profile <id>), then the rack's databases (search, tick several). A filter keeps what is within 2
 * cables of what it picks ("Fuse paths only": exactly the open fuses' paths); the rest folds with its names ("9 modules
 * hidden by the filter"). Past 30 modules with an open fuse the page opens on "Fuse paths only" by itself.
 */
import { useMemo, useState } from 'react'
import { Check, ChevronDown, ListFilter } from 'lucide-react'
import { Popover } from '../../../ui/Popover'
import type { Translate } from '@/shared/i18n'
import type { FilterPreset, ModelInput } from '../types'
import { setFilter } from './store'

const P = 'features.patchbay'

const same = (a: FilterPreset | null, b: FilterPreset | null): boolean => JSON.stringify(a) === JSON.stringify(b)

/** The key's words for a filter in force. */
export function filterLabel(t: Translate, f: FilterPreset | null, input: ModelInput | null): string {
  if (!f) return t(`${P}.filter.all`)
  if (f.kind === 'fuses') return t(`${P}.filter.fuses`)
  if (f.kind === 'running') return t(`${P}.filter.running`)
  if (f.kind === 'profile') return t(`${P}.filter.profile`, { id: f.id.toUpperCase() })
  if (f.ids.length === 1) return input?.pages[f.ids[0]]?.title.trim() || t(`${P}.filter.dbs.one`)
  return t(`${P}.filter.dbs`, { n: f.ids.length })
}

/** The filter key (its popover is FilterPanel — the header's ⋯ menu opens the same panel). */
export function FilterKey({ t, input, filter, open, onOpen }: { t: Translate; input: ModelInput; filter: FilterPreset | null; open: boolean; onOpen: (el: HTMLElement) => void }) {
  return (
    <button type="button" className="btn pb-key" aria-haspopup="dialog" aria-expanded={open} data-testid="pb-filter" onClick={(e) => onOpen(e.currentTarget)}>
      <ListFilter size={14} strokeWidth={1.7} aria-hidden="true" />
      {filterLabel(t, filter, input)}
      <ChevronDown size={14} strokeWidth={1.7} aria-hidden="true" />
    </button>
  )
}

export function FilterPanel({ t, input, filter, profiles, hasFuses, anchor, onClose }: { t: Translate; input: ModelInput; filter: FilterPreset | null; profiles: string[]; hasFuses: boolean; anchor: HTMLElement | null; onClose: () => void }) {
  const [q, setQ] = useState('')
  const dbs = useMemo(() => input.databases.map((d) => ({ id: d.id, title: input.pages[d.id]?.title.trim() || t(`${P}.untitled`) })).sort((a, b) => a.title.localeCompare(b.title)), [input, t])
  const shown = dbs.filter((d) => !q.trim() || d.title.toLowerCase().includes(q.trim().toLowerCase()))
  const picked = filter?.kind === 'databases' ? filter.ids : []
  const pick = (f: FilterPreset | null) => {
    setFilter(f)
    onClose()
  }
  const toggleDb = (id: string) => {
    const next = picked.includes(id) ? picked.filter((x) => x !== id) : [...picked, id]
    setFilter(next.length ? { kind: 'databases', ids: next } : null)
  }
  const presets: Array<{ f: FilterPreset | null; label: string; off?: boolean }> = [
    { f: null, label: t(`${P}.filter.everything`) },
    { f: { kind: 'fuses' }, label: t(`${P}.filter.fuses`), off: !hasFuses },
    { f: { kind: 'running' }, label: t(`${P}.filter.running`) },
    ...profiles.map((id) => ({ f: { kind: 'profile', id } as FilterPreset, label: t(`${P}.filter.profile`, { id: id.toUpperCase() }) })),
  ]
  return (
    <Popover open={!!anchor} anchor={anchor} onClose={onClose} placement="bottom-end" className="pb-filter" role="dialog" aria-label={t(`${P}.filter.title`)}>
      <div className="label pb-filter__h">{t(`${P}.filter.presets`)}</div>
      <ul className="pb-filter__list" role="list">
        {presets.map((p) => {
          const on = same(filter, p.f)
          return (
            <li key={p.label}>
              <button type="button" className="pb-filter__item" aria-pressed={on} aria-disabled={p.off || undefined} onClick={() => !p.off && pick(p.f)} data-testid="pb-filter-preset">
                <span className="pb-filter__tick" aria-hidden="true">
                  {on && <Check size={13} strokeWidth={2} />}
                </span>
                {p.label}
              </button>
            </li>
          )
        })}
      </ul>
      <div className="label pb-filter__h">{t(`${P}.filter.databases`)}</div>
      <input className="input pb-filter__q" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t(`${P}.filter.search`)} aria-label={t(`${P}.filter.search`)} />
      <ul className="pb-filter__list pb-filter__dbs" role="list">
        {shown.map((d) => {
          const on = picked.includes(d.id)
          return (
            <li key={d.id}>
              <button type="button" className="pb-filter__item" aria-pressed={on} onClick={() => toggleDb(d.id)}>
                <span className="pb-filter__tick" aria-hidden="true">
                  {on && <Check size={13} strokeWidth={2} />}
                </span>
                <span className="pb-filter__name">{d.title}</span>
              </button>
            </li>
          )
        })}
        {!shown.length && <li className="pb-filter__none">{t(`${P}.filter.none`)}</li>}
      </ul>
      <p className="label pb-filter__foot">{t(`${P}.filter.near`)}</p>
    </Popover>
  )
}

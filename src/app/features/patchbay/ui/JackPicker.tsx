/**
 * The jack picker (plan §3.9, key J): a cmdk list in a Popover — every jack on the rack as "Module · jack → what it is
 * cabled to" (fuzzy over the module's name and kind, the jack's label and the names at the other end). P0–P3 only find:
 * ↵ / click puts the keyboard on that jack (a folded module's fold opens first; jacks of targets bundled into a "+n" chip
 * are reached through the chip). Esc closes and gives the keyboard back to where J was pressed (the page does that —
 * Patchbay.tsx). B16 adds "Connect to …" on a focused jack.
 */
import { useEffect, useMemo, useRef } from 'react'
import { Command, defaultFilter } from 'cmdk'
import { Popover } from '../../../ui/Popover'
import type { Layout } from '../layout'
import type { Model } from '../types'
import type { Words } from './words'

const P = 'features.patchbay'

export interface PickerRow {
  jack: string
  module: string
  name: string
  kind: string
  label: string
  to: string[]
  folded: boolean
}

/** Every jack the picker offers: modules on the rack or in a fold that opens (bundled targets are the chip's). */
export function pickerRows(model: Model, layout: Layout, w: Words): PickerRow[] {
  const placed = new Set<string>()
  const foldable = new Set<string>()
  for (const s of layout.slots) {
    if (s.kind === 'module') placed.add(s.id)
    else if (s.kind === 'fold') for (const k of s.modules) foldable.add(k)
  }
  const rows: PickerRow[] = []
  for (const m of model.modules) {
    const onRack = placed.has(m.key)
    if (!onRack && !foldable.has(m.key)) continue
    const name = w.name(m)
    const kind = w.kind(m)
    for (const j of [...m.inJacks, ...m.outJacks]) {
      rows.push({ jack: j.key, module: m.key, name, kind, label: w.jack(j, m) || w.t(`${P}.jack.role.${j.role}`), to: w.peers(j.key), folded: !onRack })
    }
  }
  return rows
}

/** How many of an item's keywords are its own (module name, kind, jack label) — the rest name the other end. */
const OWN = 3

/**
 * Fuzzy over everything, but a jack whose own words match (its module, its kind, its label) ranks above one that only
 * names it at the other end — "Inbox-Helfer" finds Inbox-Helfer's jacks first, then the jacks cabled to it.
 */
export function pickerFilter(value: string, search: string, keywords?: string[]): number {
  const own = defaultFilter(value, search, keywords?.slice(0, OWN))
  if (own > 0) return 0.5 + own / 2
  return defaultFilter(value, search, keywords) / 2
}

export function JackPicker({ anchor, rows, t, onPick, onClose }: { anchor: Element | null; rows: PickerRow[]; t: Words['t']; onPick: (row: PickerRow) => void; onClose: (why: 'escape' | 'outside') => void }) {
  const closeRef = useRef(onClose)
  closeRef.current = onClose
  // Esc closes the picker only (the page's Esc would clear the selection) — taken before the popover's own listener
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return
      e.preventDefault()
      e.stopPropagation()
      closeRef.current('escape')
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [])
  const byJack = useMemo(() => new Map(rows.map((r) => [r.jack, r])), [rows])
  // another search: the best match is first — the list starts at the top again (cmdk keeps the old scroll otherwise)
  const list = useRef<HTMLDivElement>(null)
  const onSearch = () => requestAnimationFrame(() => list.current && (list.current.scrollTop = 0))
  return (
    <Popover open={!!anchor} anchor={anchor} onClose={() => closeRef.current('outside')} placement="bottom-start" className="pb-pick-pop" aria-label={t(`${P}.picker.title`)}>
      <Command label={t(`${P}.picker.title`)} loop filter={pickerFilter} className="pb-pick" data-testid="pb-jack-picker">
        <Command.Input className="pb-pick__input" placeholder={t(`${P}.picker.search`)} data-autofocus="" onValueChange={onSearch} />
        <Command.List ref={list} className="pb-pick__list">
          <Command.Empty className="pb-pick__empty">{t(`${P}.picker.empty`)}</Command.Empty>
          {rows.map((r) => (
            <Command.Item
              key={r.jack}
              value={r.jack}
              keywords={[r.name, r.kind, r.label, ...r.to]}
              className="pb-pick__row"
              data-jack={r.jack}
              onSelect={(v) => {
                const row = byJack.get(v) ?? r
                onPick(row)
              }}
            >
              <span className="pb-pick__k label">{r.kind}</span>
              <span className="pb-pick__n">
                {r.name} · <b>{r.label}</b>
              </span>
              <span className="pb-pick__to">
                {r.to.length ? t(`${P}.picker.to`, { to: r.to.join(', ') }) : t(`${P}.picker.free`)}
                {r.folded && <span className="pb-pick__folded label">{t(`${P}.picker.folded`)}</span>}
              </span>
            </Command.Item>
          ))}
        </Command.List>
      </Command>
    </Popover>
  )
}

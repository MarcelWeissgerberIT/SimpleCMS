/** Field-like pickers for the automation editor (built on the shared Menu). */
import type { ReactNode } from 'react'
import { ChevronDown } from 'lucide-react'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'
import { useWorkspace } from '../../store/store'
import { tagStyle } from '../../lib/colors'
import type { Database, PropertyDef, PropertyValue } from '../../store/types'
import { SETTABLE } from './recipes'

export function Picker({ label, entries, placeholder, searchable, ariaLabel, width }: { label: ReactNode; entries: MenuEntry[]; placeholder?: string; searchable?: boolean; ariaLabel: string; width?: number }) {
  const menu = useMenu()
  const t = useT()
  return (
    <>
      <button type="button" className="auto-pick" onClick={menu.toggle} aria-haspopup="menu" aria-expanded={menu.open} aria-label={ariaLabel}>
        <span className="auto-pick__label">{label ?? <span className="faint">{placeholder}</span>}</span>
        <ChevronDown size={14} className="faint" />
      </button>
      <Menu {...menu.props} entries={entries} searchable={searchable} searchPlaceholder={t('common.search')} width={width} />
    </>
  )
}

const TYPE_GLYPH: Partial<Record<PropertyDef['type'], string>> = {
  title: 'Aa',
  text: '¶',
  number: '#',
  select: '◉',
  multi_select: '☰',
  status: '◐',
  date: '▦',
  person: '@',
  checkbox: '☑',
  url: '↗',
  email: '✉',
  phone: '☏',
  rating: '★',
}

export function PropertyPicker({ db, value, onChange, allowAny, settableOnly, ariaLabel }: { db: Database; value: string | null; onChange: (id: string | null) => void; allowAny?: boolean; settableOnly?: boolean; ariaLabel: string }) {
  const t = useT()
  const props = db.properties.filter((p) => SETTABLE.has(p.type) && (!settableOnly || p.type !== 'title'))
  const current = db.properties.find((p) => p.id === value)
  const entries: MenuEntry[] = [
    ...(allowAny ? [{ label: t('features.auto.anyProperty'), checked: !value, onSelect: () => onChange(null) } as MenuEntry] : []),
    ...props.map((p) => ({ label: p.name, icon: <span className="auto-glyph mono">{TYPE_GLYPH[p.type] ?? '·'}</span>, checked: p.id === value, onSelect: () => onChange(p.id) })),
  ]
  return (
    <Picker
      ariaLabel={ariaLabel}
      entries={entries}
      searchable={entries.length > 8}
      label={current ? (
        <>
          <span className="auto-glyph mono">{TYPE_GLYPH[current.type] ?? '·'}</span> {current.name}
        </>
      ) : allowAny ? t('features.auto.anyProperty') : null}
      placeholder={t('features.auto.pickProperty')}
    />
  )
}

/** Human label for a configured value. */
export function useValueLabel() {
  const t = useT()
  const people = useWorkspace((s) => s.people)
  return (prop: PropertyDef | undefined, value: PropertyValue | undefined): ReactNode => {
    if (value === undefined) return t('features.auto.anyValue')
    if (!prop) return String(value)
    switch (prop.type) {
      case 'checkbox':
        return value ? t('features.auto.checked') : t('features.auto.unchecked')
      case 'select':
      case 'status':
      case 'multi_select': {
        const o = prop.options?.find((x) => x.id === (Array.isArray(value) ? value[0] : value))
        return o ? (
          <span className="tag" style={tagStyle(o.color)}>
            {o.name}
          </span>
        ) : (
          t('features.auto.empty_')
        )
      }
      case 'person':
        return people.find((p) => p.id === (Array.isArray(value) ? value[0] : value))?.name ?? t('features.auto.empty_')
      case 'date':
        return value === '@today' ? t('features.auto.today') : value === '@now' ? t('features.auto.now') : value ? String((value as { start?: string }).start ?? value) : t('features.auto.empty_')
      default:
        return value === null || value === '' ? t('features.auto.empty_') : String(value)
    }
  }
}

export function ValuePicker({ prop, value, onChange, allowAny, ariaLabel }: { prop: PropertyDef | undefined; value: PropertyValue | undefined; onChange: (v: PropertyValue | undefined) => void; allowAny?: boolean; ariaLabel: string }) {
  const t = useT()
  const people = useWorkspace((s) => s.people)
  const label = useValueLabel()
  if (!prop) return <span className="auto-pick auto-pick--off faint">{t('features.auto.pickPropertyFirst')}</span>

  const any: MenuEntry[] = allowAny ? [{ label: t('features.auto.anyValue'), checked: value === undefined, onSelect: () => onChange(undefined) }, { kind: 'separator' }] : []
  let entries: MenuEntry[] | null = null
  switch (prop.type) {
    case 'checkbox':
      entries = [...any, { label: t('features.auto.checked'), checked: value === true, onSelect: () => onChange(true) }, { label: t('features.auto.unchecked'), checked: value === false, onSelect: () => onChange(false) }]
      break
    case 'select':
    case 'status':
    case 'multi_select':
      entries = [
        ...any,
        ...(prop.options ?? []).map((o) => ({
          label: o.name,
          icon: <span className="auto-swatch" style={tagStyle(o.color)} />,
          checked: (Array.isArray(value) ? value[0] : value) === o.id,
          onSelect: () => onChange(prop.type === 'multi_select' && !allowAny ? [o.id] : o.id),
        })),
        ...(allowAny ? [] : [{ kind: 'separator' } as MenuEntry, { label: t('features.auto.clear'), onSelect: () => onChange(prop.type === 'multi_select' ? [] : null) }]),
      ]
      break
    case 'person':
      entries = [
        ...any,
        ...people.map((p) => ({ label: p.name, checked: (Array.isArray(value) ? value[0] : value) === p.id, onSelect: () => onChange(allowAny ? p.id : [p.id]) })),
        ...(allowAny ? [] : [{ kind: 'separator' } as MenuEntry, { label: t('features.auto.clear'), onSelect: () => onChange([]) }]),
      ]
      break
    case 'date':
      entries = allowAny
        ? [...any, { label: t('features.auto.empty_'), checked: value === null, onSelect: () => onChange(null) }]
        : [
            { label: t('features.auto.today'), checked: value === '@today', onSelect: () => onChange('@today') },
            { label: t('features.auto.now'), checked: value === '@now', onSelect: () => onChange('@now') },
            { label: t('features.auto.clear'), checked: value === null, onSelect: () => onChange(null) },
          ]
      break
  }
  if (entries) return <Picker ariaLabel={ariaLabel} entries={entries} label={label(prop, value)} searchable={entries.length > 10} />

  // free text / number
  const numeric = prop.type === 'number' || prop.type === 'rating'
  return (
    <span className="auto-valuefield">
      <input
        className="input"
        aria-label={ariaLabel}
        type={numeric ? 'number' : 'text'}
        placeholder={allowAny ? t('features.auto.anyValue') : t('features.auto.valuePlaceholder')}
        value={value === undefined || value === null ? '' : String(value)}
        onChange={(e) => {
          const raw = e.target.value
          if (raw === '') onChange(allowAny ? undefined : numeric ? null : '')
          else onChange(numeric ? Number(raw) : raw)
        }}
      />
    </span>
  )
}

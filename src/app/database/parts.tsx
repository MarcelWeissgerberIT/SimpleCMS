/**
 * Small UI building blocks for the database area (dropdown select, segmented control,
 * property-type picker entries, sortable list rows).
 */
import { useEffect, useState, type ReactNode } from 'react'
import { ChevronDown, Eye, GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Menu as UiMenu, MenuList, type MenuEntry, type MenuProps } from '../ui/Menu'
import { Popover } from '../ui/Popover'
import type { PropertyDef, PropertyType } from '../store/types'
import { CREATABLE_TYPES, TYPE_ICON } from './model/schema'
import { useT } from '../i18n'
import { Tooltip } from '../ui/Tooltip'
import type { Translate } from '@/shared/i18n'

/** An extra entry for what was typed into a searchable menu (e.g. "Create property “X”"), or null. */
export type QueryEntry = (query: string) => MenuEntry | null

export interface DbMenuProps extends MenuProps {
  /** Appended while the search field holds text (makes the menu searchable). */
  create?: QueryEntry
}

/** The shared Menu with this area's localized search placeholder + empty label. */
export function Menu({ create, ...props }: DbMenuProps) {
  const t = useT()
  const labels = { searchPlaceholder: t('database.menu.search'), emptyLabel: t('database.menu.empty') }
  if (create) return <QueryMenu {...labels} {...props} create={create} />
  return <UiMenu {...labels} {...props} />
}

/**
 * The shared menu plus one entry built from the typed query. The search field belongs to the
 * shared MenuList, so the query is read from its input events as they bubble up.
 */
function QueryMenu({ create, entries, open, anchor, placement = 'bottom-start', className, width, ...list }: MenuProps & { create: QueryEntry }) {
  const [query, setQuery] = useState('')
  useEffect(() => {
    if (!open) setQuery('')
  }, [open])
  const extra = query.trim() ? create(query) : null
  return (
    <Popover open={open} anchor={anchor} onClose={list.onClose} placement={placement} className={className} style={width ? { width } : undefined} role="menu">
      <div onInput={(e) => e.target instanceof HTMLInputElement && setQuery(e.target.value)}>
        <MenuList {...list} searchable entries={extra ? [...entries, extra] : entries} />
      </div>
    </Popover>
  )
}

export interface SelectItem<V extends string> {
  value: V
  label: string
  icon?: ReactNode
}

/** Compact dropdown button that opens a menu of choices. */
export function Select<V extends string>({
  value,
  items,
  onChange,
  placeholder,
  searchable,
  className,
  width,
  ariaLabel,
  disabled,
  create,
}: {
  value: V | null | undefined
  items: SelectItem<V>[]
  onChange: (v: V) => void
  placeholder?: string
  searchable?: boolean
  className?: string
  width?: number
  ariaLabel?: string
  disabled?: boolean
  /** An entry for the typed query, e.g. "Create property “X”" (the menu becomes searchable). */
  create?: QueryEntry
}) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const cur = items.find((i) => i.value === value)
  return (
    <>
      <button
        type="button"
        className={`db-select ${className ?? ''}`}
        aria-haspopup="menu"
        aria-label={ariaLabel}
        disabled={disabled}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        {cur?.icon && <span className="db-select__icon">{cur.icon}</span>}
        <span className={`db-select__label${cur ? '' : ' faint'}`}>{cur?.label ?? placeholder ?? '—'}</span>
        <ChevronDown size={12} className="db-select__chev" />
      </button>
      <Menu
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        searchable={searchable ?? items.length > 8}
        width={width}
        create={create}
        entries={items.map((i) => ({ label: i.label, icon: i.icon, checked: i.value === value, onSelect: () => onChange(i.value) }))}
      />
    </>
  )
}

/** Hardware-style segmented switch. `disabled`: all of it, or just the listed values. */
export function Segmented<V extends string>({ value, items, onChange, ariaLabel, disabled }: { value: V; items: SelectItem<V>[]; onChange: (v: V) => void; ariaLabel?: string; disabled?: boolean | V[] }) {
  return (
    <div className="db-seg" role="radiogroup" aria-label={ariaLabel}>
      {items.map((i) => (
        <button
          key={i.value}
          type="button"
          role="radio"
          aria-checked={i.value === value}
          className="db-seg__btn"
          disabled={disabled === true || (Array.isArray(disabled) && disabled.includes(i.value))}
          onClick={() => onChange(i.value)}
          title={i.label}
        >
          {i.icon}
          {(!i.icon || items.length <= 4) && <span>{i.label}</span>}
        </button>
      ))}
    </div>
  )
}

/** VIEW ONLY plate (a viewer in a team workspace) — the same cue as the shell's topbar tag. */
export function ViewOnlyTag() {
  const t = useT()
  return (
    <Tooltip label={t('database.viewOnlyHint')}>
      <span className="db-viewonly" tabIndex={0} data-testid="db-view-only">
        <Eye size={12} strokeWidth={2} aria-hidden />
        <span className="db-viewonly__text">{t('database.viewOnly')}</span>
      </span>
    </Tooltip>
  )
}

export function TypeIcon({ type, size = 14 }: { type: PropertyType; size?: number }) {
  const I = TYPE_ICON[type]
  return <I size={size} strokeWidth={1.7} aria-hidden />
}

export function PropIcon({ prop, size = 14 }: { prop: Pick<PropertyDef, 'type'>; size?: number }) {
  return <TypeIcon type={prop.type} size={size} />
}

/** Menu entries for choosing a property type (`only`: just these types, in the usual groups). */
export function typeEntries(t: Translate, onPick: (type: PropertyType) => void, current?: PropertyType, only?: PropertyType[]): MenuEntry[] {
  const out: MenuEntry[] = []
  const groups = CREATABLE_TYPES.map((g) => (only ? g.filter((type) => only.includes(type)) : g)).filter((g) => g.length)
  groups.forEach((group, gi) => {
    if (gi > 0) out.push({ kind: 'separator' })
    for (const type of group)
      out.push({
        label: t(`database.type.${type}`),
        icon: <TypeIcon type={type} />,
        checked: current === type,
        keywords: type,
        onSelect: () => onPick(type),
      })
  })
  return out
}

/** A row in a dnd-kit sortable list with a grip handle. */
export function SortableRow({ id, children, className }: { id: string; children: ReactNode; className?: string }) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`db-sortrow ${className ?? ''}`}
      data-dragging={isDragging}
      style={{ transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null), transition }}
    >
      <button type="button" className="db-grip" aria-label={t('database.dragToReorder')} {...attributes} {...listeners}>
        <GripVertical size={13} />
      </button>
      {children}
    </div>
  )
}

/** "{count} thing" / "{count} things" via <key>.one / <key>.other. */
export function plural(t: Translate, key: string, count: number): string {
  return t(`${key}.${count === 1 ? 'one' : 'other'}`, { count })
}

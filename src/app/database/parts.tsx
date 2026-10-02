/**
 * Small UI building blocks for the database area (dropdown select, segmented control,
 * property-type picker entries, sortable list rows).
 */
import { useState, type ReactNode } from 'react'
import { ChevronDown, GripVertical } from 'lucide-react'
import { useSortable } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Menu, type MenuEntry } from '../ui/Menu'
import type { PropertyDef, PropertyType } from '../store/types'
import { CREATABLE_TYPES, TYPE_ICON } from './model/schema'
import type { Translate } from '@/shared/i18n'

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
}: {
  value: V | null | undefined
  items: SelectItem<V>[]
  onChange: (v: V) => void
  placeholder?: string
  searchable?: boolean
  className?: string
  width?: number
  ariaLabel?: string
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
        entries={items.map((i) => ({ label: i.label, icon: i.icon, checked: i.value === value, onSelect: () => onChange(i.value) }))}
      />
    </>
  )
}

/** Hardware-style segmented switch. */
export function Segmented<V extends string>({ value, items, onChange, ariaLabel }: { value: V; items: SelectItem<V>[]; onChange: (v: V) => void; ariaLabel?: string }) {
  return (
    <div className="db-seg" role="radiogroup" aria-label={ariaLabel}>
      {items.map((i) => (
        <button key={i.value} type="button" role="radio" aria-checked={i.value === value} className="db-seg__btn" onClick={() => onChange(i.value)} title={i.label}>
          {i.icon}
          {(!i.icon || items.length <= 4) && <span>{i.label}</span>}
        </button>
      ))}
    </div>
  )
}

export function TypeIcon({ type, size = 14 }: { type: PropertyType; size?: number }) {
  const I = TYPE_ICON[type]
  return <I size={size} strokeWidth={1.7} aria-hidden />
}

export function PropIcon({ prop, size = 14 }: { prop: Pick<PropertyDef, 'type'>; size?: number }) {
  return <TypeIcon type={prop.type} size={size} />
}

/** Menu entries for choosing a property type. */
export function typeEntries(t: Translate, onPick: (type: PropertyType) => void, current?: PropertyType): MenuEntry[] {
  const out: MenuEntry[] = []
  CREATABLE_TYPES.forEach((group, gi) => {
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
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id })
  return (
    <div
      ref={setNodeRef}
      className={`db-sortrow ${className ?? ''}`}
      data-dragging={isDragging}
      style={{ transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null), transition }}
    >
      <button type="button" className="db-grip" aria-label="Drag" {...attributes} {...listeners}>
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

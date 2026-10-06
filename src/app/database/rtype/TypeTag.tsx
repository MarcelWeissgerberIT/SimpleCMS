/**
 * Record types in databases — the small pieces: a type's tag ("● Lead"), the picker entries (the row page's
 * chip, a table's Type cell, "+" in a free-board lane) and the row page's type chip.
 */
import { useState } from 'react'
import { ChevronDown, CircleSlash, ExternalLink, Plus, Shapes } from 'lucide-react'
import type { Database, ID, Kit, Page, PropertyDef, RecordType } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { PageIcon } from '../../ui/PageIcon'
import type { MenuEntry } from '../../ui/Menu'
import type { Translate } from '@/shared/i18n'
import { useT } from '../../i18n'
import { Menu, TypeIcon } from '../parts'
import { allTypes, heldTypes, isTypeProp, recordTypeHref, setRowType, typeOfRow } from '../model/recordTypes'
import { NewTypeDialog } from './NewTypeDialog'
import './rtype.css'

/** A property's glyph in pickers: its type's icon — the Type column gets the record-type glyph. */
export function PropGlyph({ prop, size = 14 }: { prop: Pick<PropertyDef, 'id' | 'type'>; size?: number }) {
  return isTypeProp(prop) ? <Shapes size={size} strokeWidth={1.7} aria-hidden /> : <TypeIcon type={prop.type} size={size} />
}

/** The type's colour LED (and icon when it has one). */
export function TypeMark({ rt, size = 14 }: { rt: Pick<RecordType, 'color' | 'icon'>; size?: number }) {
  return (
    <span className="rtype-mark" data-color={rt.color ?? 'default'} style={{ ['--rt' as string]: `var(--c-${rt.color ?? 'default'}-text)` }}>
      <span className="rtype-led" aria-hidden />
      {rt.icon && <PageIcon icon={rt.icon} size={size} fallback={false} />}
    </span>
  )
}

/** "● Lead" — a record type as a tag. */
export function TypeTag({ rt, compact }: { rt: Pick<RecordType, 'name' | 'color' | 'icon'>; compact?: boolean }) {
  return (
    <span className="rtype-tag" data-compact={compact || undefined} style={{ ['--rt' as string]: `var(--c-${rt.color ?? 'default'}-text)` }}>
      <span className="rtype-led" aria-hidden />
      {rt.icon && <PageIcon icon={rt.icon} size={13} fallback={false} />}
      <span className="rtype-tag__name">{rt.name}</span>
    </span>
  )
}

export interface TypeEntriesOpts {
  db: Database
  kit: Kit | undefined
  current: ID | null
  onPick: (typeId: ID | null) => void
  /** "New record type…" (absent: not offered) */
  onNew?: () => void
  /** the label of "no type" ("None" on a row, "Plain card" on a free board) */
  noneLabel?: string
  /** a label per type ("New Lead"), default: its name */
  labelOf?: (rt: RecordType) => string
}

/** Menu entries to pick a record type: the database's types, none, the workspace's other types, a new one. */
export function typeEntries(t: Translate, o: TypeEntriesOpts): MenuEntry[] {
  const held = heldTypes(o.db, o.kit)
  const others = o.db.locked ? [] : allTypes(o.kit).filter((rt) => !held.some((h) => h.id === rt.id))
  const label = o.labelOf ?? ((rt: RecordType) => rt.name)
  const entry = (rt: RecordType): MenuEntry => ({ id: `rtype-${rt.id}`, label: label(rt), icon: <TypeMark rt={rt} />, checked: o.current === rt.id, keywords: rt.name, onSelect: () => o.onPick(rt.id) })
  const out: MenuEntry[] = []
  if (held.length) out.push({ kind: 'section', label: t('database.rtype.section') }, ...held.map(entry))
  out.push({ id: 'rtype-none', label: o.noneLabel ?? t('database.rtype.none'), icon: <CircleSlash size={14} />, checked: o.current === null, onSelect: () => o.onPick(null) })
  if (others.length) out.push({ kind: 'separator' }, { label: t('database.rtype.others'), icon: <Shapes size={14} />, submenu: others.map(entry) })
  if (o.onNew && !o.db.locked) out.push({ kind: 'separator' }, { id: 'rtype-new', label: t('database.rtype.new'), icon: <Plus size={14} />, onSelect: o.onNew })
  return out
}

/** The row page's type chip ("● Lead ▾" / "+ Type"): pick, change or clear the row's record type. */
export function RowTypeChip({ row, db, readOnly }: { row: Page; db: Database; readOnly: boolean }) {
  const t = useT()
  const kit = useWorkspace((s) => s.kit)
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [creating, setCreating] = useState(false)
  const rt = typeOfRow(row, kit)
  const any = Object.keys(kit?.recordTypes ?? {}).length > 0
  // nobody uses record types here: nothing on the row page
  if (!rt && (!any || readOnly)) return null
  return (
    <div className="rtype-row">
      <span className="label rtype-row__label">{t('database.rtype.column')}</span>
      <button
        type="button"
        className="rtype-chip"
        data-empty={!rt || undefined}
        disabled={readOnly}
        aria-haspopup="menu"
        aria-label={rt ? t('database.rtype.change', { type: rt.name }) : t('database.rtype.pick')}
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        {rt ? <TypeTag rt={rt} /> : <span className="rtype-chip__add">{t('database.rtype.pick')}</span>}
        {!readOnly && <ChevronDown size={12} />}
      </button>
      {rt && (
        <a className="rtype-row__open" href={recordTypeHref(rt.id)} title={t('database.rtype.openKit')} aria-label={t('database.rtype.openKit')}>
          <ExternalLink size={12} />
        </a>
      )}
      <Menu
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        searchable={allTypes(kit).length > 8}
        width={240}
        entries={typeEntries(t, { db, kit, current: row.recordType ?? null, onPick: (id) => setRowType(row.id, id), onNew: () => setCreating(true) })}
      />
      {creating && <NewTypeDialog dbId={db.id} onClose={() => setCreating(false)} onCreated={(id) => setRowType(row.id, id)} />}
    </div>
  )
}

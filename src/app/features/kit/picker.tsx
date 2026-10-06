/**
 * Building blocks in a database's property-type picker (add property / change type): "Own types" from
 * the kit, "Bind to a list…" (select / multi-select with a shared list's items) and "New own type…"
 * (opens #/kit on the base menu). Picking one hands the caller a property definition for the normal
 * database property actions (insertProperty / the type change) — they respect Database.locked.
 */
import type { Translate } from '@/shared/i18n'
import { List as ListIcon, Plus, Shapes } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { storedTypeOf } from '../../store/kit'
import type { ID, PropertyDef } from '../../store/types'
import type { MenuEntry } from '../../ui/Menu'
import { PageIcon } from '../../ui/PageIcon'
import { useCloud } from '../../cloud'
import { openKit } from './open'
import { propertyDefFor, propertyDefForList } from './model'

/** What a picked own type / list adds or changes a property into. */
export type OwnPropertyDef = Partial<PropertyDef> & Pick<PropertyDef, 'type' | 'name'>

/**
 * The kit's entries for a type picker (appended after the standard types). `current`: the property
 * being changed (its own type / list shows checked).
 */
export function kitTypeEntries(t: Translate, onPick: (def: OwnPropertyDef) => void, current?: Pick<PropertyDef, 'custom' | 'listId' | 'type'>): MenuEntry[] {
  const kit = useWorkspace.getState().kit
  const own = Object.values(kit?.propTypes ?? {}).sort((a, b) => a.name.localeCompare(b.name))
  const lists = Object.values(kit?.lists ?? {}).sort((a, b) => a.name.localeCompare(b.name))
  const out: MenuEntry[] = [{ kind: 'separator' }, { kind: 'section', label: t('features.kit.picker.own') }]
  for (const o of own)
    out.push({
      id: `kit-type-${o.id}`,
      label: o.name,
      icon: o.icon ? <PageIcon icon={o.icon} size={14} /> : <Shapes size={14} strokeWidth={1.7} aria-hidden />,
      hint: o.base === 'free' ? t('features.kit.base.free') : t(`database.type.${o.base}`),
      checked: current?.custom === o.id && current.type === storedTypeOf(o.base),
      keywords: `own type eigener typ ${o.base}`,
      onSelect: () => onPick(propertyDefFor(o)),
    })
  if (lists.length)
    out.push({
      id: 'kit-bind-list',
      label: t('features.kit.picker.bindList'),
      icon: <ListIcon size={14} strokeWidth={1.7} aria-hidden />,
      keywords: 'list liste shared gemeinsam bind binden',
      submenu: lists.map((l) => ({
        id: `kit-list-${l.id}`,
        label: l.name,
        icon: l.icon ? <PageIcon icon={l.icon} size={14} /> : <ListIcon size={14} strokeWidth={1.7} aria-hidden />,
        hint: String(l.items.length),
        checked: current?.listId === l.id,
        submenu: (['select', 'multi_select'] as const).map((type) => ({
          id: `kit-list-${l.id}-${type}`,
          label: t(`database.type.${type}`),
          checked: current?.listId === l.id && current.type === type,
          onSelect: () => onPick(propertyDefForList(l, type)),
        })),
      })),
    })
  if (!useCloud.getState().readOnly)
    out.push({
      id: 'kit-new-type',
      label: t('features.kit.picker.newType'),
      icon: <Plus size={14} strokeWidth={1.8} aria-hidden />,
      keywords: 'new own type neuer eigener typ building blocks bausteine',
      onSelect: () => openKit('types', null, { create: true }),
    })
  return out
}

/** The id of a picked list / own type (for tests and callers that only need to know). */
export const isOwnDef = (def: OwnPropertyDef): def is OwnPropertyDef & { custom: ID } => !!def.custom

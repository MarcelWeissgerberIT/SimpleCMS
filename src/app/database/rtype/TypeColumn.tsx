/**
 * The table's Type column (a computed, view-level column — model/recordTypes TYPE_PROP_ID): the cell shows
 * the row's record type, its header menu sorts / filters / groups by type or hides the column.
 */
import { memo } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, EyeOff, Funnel, Group, Shapes } from 'lucide-react'
import type { Kit, Page } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { Popover } from '../../ui/Popover'
import { MenuList, type MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'
import type { DbModel } from '../hooks'
import { setViewQuery } from '../model/lock'
import { TYPE_PROP_ID, typeOfRow } from '../model/recordTypes'
import { TypeTag } from './TypeTag'

export const TypeCell = memo(function TypeCell({ row, kit }: { row: Page; kit: Kit | undefined }) {
  const rt = typeOfRow(row, kit)
  return rt ? <TypeTag rt={rt} compact /> : null
})

export function TypeColumnMenu({ m, anchor, onClose, onFilter }: { m: DbModel; anchor: HTMLElement; onClose: () => void; onFilter: (id: string) => void }) {
  const t = useT()
  const { db, view } = m
  const sort = (direction: 'asc' | 'desc') => setViewQuery(db.id, view.id, { sorts: [{ propertyId: TYPE_PROP_ID, direction }, ...view.sorts.filter((x) => x.propertyId !== TYPE_PROP_ID)] })
  const entries: MenuEntry[] = [
    { label: t('database.sort.asc'), icon: <ArrowUpNarrowWide size={14} />, onSelect: () => sort('asc') },
    { label: t('database.sort.desc'), icon: <ArrowDownWideNarrow size={14} />, onSelect: () => sort('desc') },
    { label: t('database.filter.filterBy'), icon: <Funnel size={14} />, onSelect: () => onFilter(TYPE_PROP_ID) },
  ]
  if (!m.fixed) {
    entries.push({
      label: t('database.rtype.groupBy'),
      icon: <Group size={14} />,
      checked: view.groupBy === TYPE_PROP_ID,
      onSelect: () => useWorkspace.getState().updateView(db.id, view.id, { groupBy: view.groupBy === TYPE_PROP_ID ? null : TYPE_PROP_ID, hiddenGroups: [] }),
    })
    entries.push({ kind: 'separator' })
    entries.push({ label: t('database.prop.hide'), icon: <EyeOff size={14} />, onSelect: () => useWorkspace.getState().updateView(db.id, view.id, { visibleProperties: view.visibleProperties.filter((x) => x !== TYPE_PROP_ID) }) })
  }
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-start" className="db-propmenu" aria-label={t('database.rtype.column')}>
      <div className="db-propmenu__head">
        <span className="db-propmenu__icon">
          <Shapes size={15} strokeWidth={1.7} aria-hidden />
        </span>
        <span className="db-propmenu__title">
          <span className="db-propmenu__name">{t('database.rtype.column')}</span>
          <span className="label">{t('database.rtype.computed')}</span>
        </span>
      </div>
      <MenuList entries={entries} onClose={onClose} />
    </Popover>
  )
}

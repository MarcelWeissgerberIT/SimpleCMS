/**
 * Shared pieces for all view layouts: actions context, empty state, row context menu,
 * group labels, collapsed-group state.
 */
import { createContext, useContext } from 'react'
import { ArrowUpRight, Copy, FilePlus2, Link, Maximize2, Trash } from 'lucide-react'
import type { ID, Page, PropertyValue } from '../../store/types'
import { useUI } from '../../store/ui'
import { Menu } from '../../ui/Menu'
import { Kbd } from '../../ui/controls'
import { useT } from '../../i18n'
import { openPage, pageHref } from '../../lib/router'
import { useWorkspace } from '../../store/store'
import { deleteRows, duplicateRows, openRow } from '../model/actions'
import { countFilters, type RowGroup } from '../model/query'
import { OptionTag, StatusTag, Avatar } from '../cells/display'
import { saveRowAsTemplate } from '../toolbar/Templates'
import { useModel, useLocalState } from '../hooks'
import type { PopoverAnchor } from '../../ui/Popover'

export interface ViewActions {
  /** Create a row (with filter defaults + extra presets); returns its id. */
  newRow: (opts?: { properties?: Record<ID, PropertyValue>; index?: number; open?: boolean; editTitle?: boolean; after?: Page }) => ID
  /** Row whose title should go into edit mode once rendered. */
  editTitleOf: ID | null
  clearEditTitle: () => void
  open: (row: Page) => void
  contextMenu: (row: Page, anchor: PopoverAnchor) => void
}

export const ViewActionsContext = createContext<ViewActions | null>(null)
export function useViewActions(): ViewActions {
  const a = useContext(ViewActionsContext)
  if (!a) throw new Error('ViewActionsContext missing')
  return a
}

export function EmptyState({ onAdd }: { onAdd?: () => void }) {
  const t = useT()
  const m = useModel()
  const filters = countFilters(m.view.filter)
  const narrowed = filters > 0 || !!m.search.trim()
  if (narrowed && m.allRows.length > 0)
    return (
      <div className="db-empty">
        <span className="db-empty__line" aria-hidden />
        <span className="label">{t('database.emptyFiltered', { count: filters + (m.search.trim() ? 1 : 0) })}</span>
        <button
          type="button"
          className="btn btn--sm"
          onClick={() => {
            useWorkspace.getState().updateView(m.db.id, m.view.id, { filter: null })
          }}
        >
          {t('database.clearFilters')}
        </button>
        <span className="db-empty__line" aria-hidden />
      </div>
    )
  return (
    <div className="db-empty">
      <span className="db-empty__line" aria-hidden />
      <button type="button" className="db-empty__cta" onClick={onAdd}>
        <span className="label">{t('database.emptyNoEntries')}</span>
        <Kbd>⏎</Kbd>
        <span className="label">{t('database.emptyToAdd')}</span>
      </button>
      <span className="db-empty__line" aria-hidden />
    </div>
  )
}

export function RowContextMenu({ row, anchor, onClose }: { row: Page; anchor: PopoverAnchor; onClose: () => void }) {
  const t = useT()
  const m = useModel()
  return (
    <Menu
      open
      anchor={anchor}
      onClose={onClose}
      entries={[
        { label: t('common.open'), icon: <ArrowUpRight size={14} />, onSelect: () => openRow(row.id, m.view) },
        { label: t('database.row.openFull'), icon: <Maximize2 size={14} />, onSelect: () => openPage(row.id) },
        {
          label: t('common.copyLink'),
          icon: <Link size={14} />,
          onSelect: () => {
            const url = `${location.origin}${location.pathname}${pageHref(row.id)}`
            void navigator.clipboard?.writeText(url).then(() => useUI.getState().toast(t('common.copied')))
          },
        },
        { kind: 'separator' },
        { label: t('common.duplicate'), icon: <Copy size={14} />, hint: '', onSelect: () => duplicateRows(m.db.id, [row.id]) },
        { label: t('database.templates.saveRow'), icon: <FilePlus2 size={14} />, onSelect: () => saveRowAsTemplate(m.db, row) },
        { kind: 'separator' },
        { label: t('common.delete'), icon: <Trash size={14} />, danger: true, onSelect: () => deleteRows([row.id]) },
      ]}
    />
  )
}

export function GroupLabel({ group }: { group: RowGroup }) {
  if (group.option) return group.option.group ? <StatusTag option={group.option} /> : <OptionTag option={group.option} />
  if (group.person)
    return (
      <span className="db-person">
        <Avatar person={group.person} />
        <span className="db-person__name">{group.person.name}</span>
      </span>
    )
  return <span className={`db-grouplabel${group.empty ? ' is-empty' : ''}`}>{group.label}</span>
}

/** Collapsed group keys (per viewer, per view). */
export function useCollapsed(viewId: ID): [Set<string>, (key: string) => void] {
  const [list, setList] = useLocalState<string[]>(`one.db.collapsed.${viewId}`, [])
  const set = new Set(list)
  const toggle = (key: string) => setList((cur) => (cur.includes(key) ? cur.filter((k) => k !== key) : [...cur, key]))
  return [set, toggle]
}

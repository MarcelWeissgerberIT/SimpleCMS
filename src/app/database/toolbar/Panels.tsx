/**
 * Toolbar panels: Sort (multi-level), Group, Properties (show/hide + reorder).
 */
import { useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Eye, EyeOff, Plus, Trash, X } from 'lucide-react'
import type { ID, PropertyType, Sort } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { Popover } from '../../ui/Popover'
import { Menu } from '../../ui/Menu'
import { useT } from '../../i18n'
import { Segmented, Select, SortableRow, TypeIcon, typeEntries } from '../parts'
import { BOARD_GROUP_TYPES, TABLE_GROUP_TYPES } from '../model/schema'
import { insertProperty } from '../model/actions'
import type { DbModel } from '../hooks'

function useSortSensors() {
  return useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
}

/* ---------------- Sort ---------------- */

export function SortPanel({ m, anchor, onClose }: { m: DbModel; anchor: Element; onClose: () => void }) {
  const t = useT()
  const sensors = useSortSensors()
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)
  const sorts = m.view.sorts
  const save = (next: Sort[]) => useWorkspace.getState().updateView(m.db.id, m.view.id, { sorts: next })
  const ids = sorts.map((s) => s.propertyId)
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    save(arrayMove(sorts, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over.id))))
  }
  const available = m.db.properties.filter((p) => !ids.includes(p.id))
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-end" className="db-panel">
      <div className="db-panel__head">
        <span className="label">{t('database.sort.title')}</span>
      </div>
      {sorts.length === 0 && <div className="db-panel__empty label">{t('database.sort.none')}</div>}
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={ids} strategy={verticalListSortingStrategy}>
          {sorts.map((s, i) => (
            <SortableRow key={s.propertyId} id={s.propertyId} className="db-sortrule">
              <Select
                value={s.propertyId}
                searchable
                items={m.db.properties.filter((p) => p.id === s.propertyId || !ids.includes(p.id)).map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> }))}
                onChange={(id) => save(sorts.map((x, j) => (j === i ? { ...x, propertyId: id } : x)))}
              />
              <Segmented
                value={s.direction}
                items={[
                  { value: 'asc', label: t('database.sort.ascShort') },
                  { value: 'desc', label: t('database.sort.descShort') },
                ]}
                onChange={(d) => save(sorts.map((x, j) => (j === i ? { ...x, direction: d } : x)))}
              />
              <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.remove')} onClick={() => save(sorts.filter((_, j) => j !== i))}>
                <X size={13} />
              </button>
            </SortableRow>
          ))}
        </SortableContext>
      </DndContext>
      <div className="db-panel__actions">
        <button type="button" className="btn btn--ghost btn--sm" disabled={!available.length} onClick={(e) => setAddAnchor(e.currentTarget)}>
          <Plus size={13} /> {t('database.sort.add')}
        </button>
        {sorts.length > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => save([])}>
            <Trash size={13} /> {t('database.sort.clear')}
          </button>
        )}
      </div>
      <Menu
        open={!!addAnchor}
        anchor={addAnchor}
        onClose={() => setAddAnchor(null)}
        searchable
        entries={available.map((p) => ({ label: p.name, icon: <TypeIcon type={p.type} />, onSelect: () => save([...sorts, { propertyId: p.id, direction: 'asc' }]) }))}
      />
    </Popover>
  )
}

/* ---------------- Group ---------------- */

export function GroupPanel({ m, anchor, onClose }: { m: DbModel; anchor: Element; onClose: () => void }) {
  const t = useT()
  const view = m.view
  const types: PropertyType[] = view.type === 'board' ? BOARD_GROUP_TYPES : TABLE_GROUP_TYPES
  const candidates = m.db.properties.filter((p) => types.includes(p.type))
  const upd = (patch: Parameters<ReturnType<typeof useWorkspace.getState>['updateView']>[2]) => useWorkspace.getState().updateView(m.db.id, view.id, patch)
  const hidden = new Set(view.hiddenGroups ?? [])
  const toggle = (key: string) => {
    const next = new Set(hidden)
    if (next.has(key)) next.delete(key)
    else next.add(key)
    upd({ hiddenGroups: [...next] })
  }
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-end" className="db-panel">
      <div className="db-panel__head">
        <span className="label">{t('database.group.title')}</span>
      </div>
      <div className="db-cfg__row">
        <span className="label">{t('database.group.by')}</span>
        <Select
          value={view.groupBy ?? '__none'}
          items={[
            ...(view.type === 'board' ? [] : [{ value: '__none', label: t('database.group.noGrouping') }]),
            ...candidates.map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> })),
          ]}
          onChange={(v) => upd({ groupBy: v === '__none' ? null : v, hiddenGroups: [] })}
        />
      </div>
      {m.groups && (
        <>
          <div className="db-panel__sub label">{t('database.group.visibility')}</div>
          <div className="db-panel__list">
            {m.groups.map((g) => (
              <button key={g.key} type="button" className="menu-item" onClick={() => toggle(g.key)}>
                <span className="menu-item__label">{g.label}</span>
                <span className="label">{g.rows.length}</span>
                {hidden.has(g.key) ? <EyeOff size={14} className="faint" /> : <Eye size={14} />}
              </button>
            ))}
          </div>
        </>
      )}
    </Popover>
  )
}

/* ---------------- Properties ---------------- */

export function PropertiesPanel({ m, anchor, onClose, onCreated }: { m: DbModel; anchor: Element; onClose: () => void; onCreated?: (id: ID) => void }) {
  const t = useT()
  const sensors = useSortSensors()
  const [q, setQ] = useState('')
  const [typeAnchor, setTypeAnchor] = useState<HTMLElement | null>(null)
  const view = m.view
  const visible = view.visibleProperties.filter((id) => m.propMap.get(id) && m.propMap.get(id)!.type !== 'title')
  const hiddenProps = m.db.properties.filter((p) => p.type !== 'title' && !visible.includes(p.id))
  const save = (ids: ID[]) => useWorkspace.getState().updateView(m.db.id, view.id, { visibleProperties: ids })
  const match = (name: string) => !q.trim() || name.toLowerCase().includes(q.trim().toLowerCase())
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    save(arrayMove(visible, visible.indexOf(String(e.active.id)), visible.indexOf(String(e.over.id))))
  }
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-end" className="db-panel db-panel--props">
      <div className="db-panel__head">
        <span className="label">{t('database.props.title')}</span>
        <span style={{ flex: 1 }} />
        <span className="label">
          {visible.length}/{m.db.properties.length - 1}
        </span>
      </div>
      <div style={{ padding: '0 4px 4px' }}>
        <input className="input" value={q} placeholder={t('database.props.search')} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="db-panel__sub">
        <span className="label">{t('database.props.shown')}</span>
        {visible.length > 0 && (
          <button type="button" className="db-panel__link" onClick={() => save([])}>
            {t('database.props.hideAll')}
          </button>
        )}
      </div>
      <div className="db-propsrow db-propsrow--title">
        <span className="db-grip db-grip--ghost" />
        <TypeIcon type="title" />
        <span className="db-propsrow__name">{m.titleProp.name}</span>
        <span className="label">{t('database.props.always')}</span>
      </div>
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        <SortableContext items={visible} strategy={verticalListSortingStrategy}>
          {visible.map((id) => {
            const p = m.propMap.get(id)!
            if (!match(p.name)) return null
            return (
              <SortableRow key={id} id={id} className="db-propsrow">
                <TypeIcon type={p.type} />
                <span className="db-propsrow__name">{p.name}</span>
                <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.prop.hide')} onClick={() => save(visible.filter((x) => x !== id))}>
                  <Eye size={14} />
                </button>
              </SortableRow>
            )
          })}
        </SortableContext>
      </DndContext>
      {hiddenProps.length > 0 && (
        <>
          <div className="db-panel__sub">
            <span className="label">{t('database.props.hidden')}</span>
            <button type="button" className="db-panel__link" onClick={() => save([...visible, ...hiddenProps.map((p) => p.id)])}>
              {t('database.props.showAll')}
            </button>
          </div>
          {hiddenProps
            .filter((p) => match(p.name))
            .map((p) => (
              <div key={p.id} className="db-propsrow is-hidden">
                <span className="db-grip db-grip--ghost" />
                <TypeIcon type={p.type} />
                <span className="db-propsrow__name">{p.name}</span>
                <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.props.show')} onClick={() => save([...visible, p.id])}>
                  <EyeOff size={14} />
                </button>
              </div>
            ))}
        </>
      )}
      <div className="db-panel__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={(e) => setTypeAnchor(e.currentTarget)}>
          <Plus size={13} /> {t('database.props.new')}
        </button>
      </div>
      <Menu
        open={!!typeAnchor}
        anchor={typeAnchor}
        onClose={() => setTypeAnchor(null)}
        searchable
        entries={typeEntries(t, (type) => {
          const id = insertProperty(m.db, m.view, { type, name: t(`database.type.${type}`) })
          onCreated?.(id)
        })}
      />
    </Popover>
  )
}

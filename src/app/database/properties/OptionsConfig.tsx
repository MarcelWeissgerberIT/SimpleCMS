/**
 * Option list editor inside the property menu: reorder (drag), edit, add; status grouped.
 */
import { useState } from 'react'
import { DndContext, PointerSensor, KeyboardSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { Plus } from 'lucide-react'
import type { Database, PropertyDef, SelectOption, StatusGroup } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { OptionTag, StatusTag } from '../cells/display'
import { OptionEditMenu, STATUS_GROUPS } from '../cells/OptionPicker'
import { newOption } from '../model/actions'
import { SortableRow } from '../parts'

export function OptionsConfig({ db, prop }: { db: Database; prop: PropertyDef }) {
  const t = useT()
  const options = prop.options ?? []
  const isStatus = prop.type === 'status'
  const [edit, setEdit] = useState<{ option: SelectOption; el: HTMLElement } | null>(null)
  const [adding, setAdding] = useState<StatusGroup | 'plain' | null>(null)
  const [name, setName] = useState('')
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const save = (opts: SelectOption[]) => useWorkspace.getState().updateProperty(db.id, prop.id, { options: opts })
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = options.findIndex((o) => o.id === e.active.id)
    const to = options.findIndex((o) => o.id === e.over!.id)
    if (from < 0 || to < 0) return
    const moved = arrayMove(options, from, to)
    if (isStatus) {
      // dropping into another group's area adopts that group
      const target = options[to]
      moved[to] = { ...moved[to], group: target.group ?? 'todo' }
    }
    save(moved)
  }
  const add = (group?: StatusGroup) => {
    const n = name.trim()
    if (!n) return setAdding(null)
    save([...options, newOption(n, options, group)])
    setName('')
  }

  const renderList = (list: SelectOption[]) => (
    <SortableContext items={list.map((o) => o.id)} strategy={verticalListSortingStrategy}>
      {list.map((o) => (
        <SortableRow key={o.id} id={o.id} className="db-optcfg__row">
          <button type="button" className="db-optcfg__tag" onClick={(e) => setEdit({ option: o, el: e.currentTarget })}>
            {isStatus ? <StatusTag option={o} /> : <OptionTag option={o} />}
          </button>
        </SortableRow>
      ))}
    </SortableContext>
  )

  const addRow = (group: StatusGroup | 'plain') =>
    adding === group ? (
      <div className="db-optcfg__add">
        <input
          className="input"
          autoFocus
          value={name}
          placeholder={t('database.option.newPlaceholder')}
          onChange={(e) => setName(e.target.value)}
          onBlur={() => add(group === 'plain' ? undefined : group)}
          onKeyDown={(e) => {
            e.stopPropagation()
            if (e.key === 'Enter') {
              e.preventDefault()
              add(group === 'plain' ? undefined : group)
            }
            if (e.key === 'Escape') setAdding(null)
          }}
        />
      </div>
    ) : (
      <button type="button" className="db-optcfg__addbtn" onClick={() => (setAdding(group), setName(''))}>
        <Plus size={13} /> {t('database.option.add')}
      </button>
    )

  return (
    <div className="db-optcfg">
      <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
        {isStatus ? (
          STATUS_GROUPS.map((g) => (
            <div key={g} className="db-optcfg__group">
              <div className="label db-optcfg__label">
                <span className="db-status__led" data-group={g} /> {t(`database.status.group.${g}`)}
              </div>
              {renderList(options.filter((o) => (o.group ?? 'todo') === g))}
              {addRow(g)}
            </div>
          ))
        ) : (
          <>
            <div className="label db-optcfg__label">{t('database.option.options')}</div>
            {renderList(options)}
            {addRow('plain')}
          </>
        )}
      </DndContext>
      {edit && <OptionEditMenu db={db} prop={prop} option={edit.option} anchor={edit.el} onClose={() => setEdit(null)} />}
    </div>
  )
}

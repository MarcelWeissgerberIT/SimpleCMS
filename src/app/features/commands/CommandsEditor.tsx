/**
 * "Edit commands…" — a spec sheet of a database's command menu: the order (drag the grip, or Alt+↑ / ↓),
 * defaults switched on / off, own commands (label, icon, kind + its settings). Edits stay in a draft and
 * are written once when the sheet closes (Done / Esc). A locked database (or a viewer) sees it read-only.
 */
import { useId, useRef, useState } from 'react'
import { ArrowDown, ArrowUp, ChevronLeft, GripVertical, Lock, Pencil, Plus, Trash2, Zap } from 'lucide-react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { useWorkspace } from '../../store/store'
import type { DbCommand, ID } from '../../store/types'
import { Modal } from '../../ui/Modal'
import { Menu, useMenu } from '../../ui/Menu'
import { Popover } from '../../ui/Popover'
import { PageIcon } from '../../ui/PageIcon'
import { IconPicker } from '../../ui/IconPicker'
import { ALT, Switch } from '../../ui/controls'
import { useCloud } from '../../cloud'
import { useT } from '../../i18n'
import { newId } from '../../lib/ids'
import { defaultsFor } from './defaults'
import { mergeCommands, ownLabel, readDbCommands, saveDbCommands } from './model'
import { kindLabel, useKinds } from './registry'
import { CmdGlyph } from './parts'
import type { CommandKindDef, DefaultSpec } from './types'
import './commands.css'

type Item =
  | { id: string; source: 'default'; hidden: boolean; spec: DefaultSpec }
  | { id: string; source: 'own'; command: DbCommand }
  /** a stored default that doesn't apply now (no templates any more …): kept in its place, not shown */
  | { id: string; source: 'gone'; command: DbCommand }

const pad2 = (n: number) => String(n).padStart(2, '0')

function initial(dbId: ID): Item[] {
  const db = useWorkspace.getState().databases[dbId]
  return mergeCommands(readDbCommands(db?.commands), defaultsFor(dbId), { keep: true }).map<Item>((e) =>
    e.source === 'default' ? { id: e.id, source: 'default', hidden: e.hidden, spec: e.spec } : e.source === 'own' ? { id: e.id, source: 'own', command: e.command } : e,
  )
}

const toStored = (items: Item[]): DbCommand[] => items.map((it) => (it.source === 'default' ? { id: it.id, kind: 'default', ...(it.hidden ? { hidden: true } : {}) } : it.command))

/** Indexes of the shown items inside the full list. */
const shownSlots = (list: Item[]) => list.map((x, i) => (x.source === 'gone' ? -1 : i)).filter((i) => i >= 0)

export function CommandsEditor({ databaseId, onClose }: { databaseId: ID; onClose: () => void }) {
  const t = useT()
  const readOnly = useCloud((s) => s.readOnly)
  const locked = useWorkspace((s) => !!s.databases[databaseId]?.locked)
  const name = useWorkspace((s) => s.pages[databaseId]?.title.trim() ?? '') || t('common.untitled')
  const editable = !locked && !readOnly
  const kinds = useKinds((s) => s.kinds)
  const [items, setItems] = useState<Item[]>(() => initial(databaseId))
  const [open, setOpen] = useState<string | null>(null)
  const dirty = useRef(false)
  const latest = useRef(items)
  latest.current = items
  const listRef = useRef<HTMLOListElement>(null)
  const addMenu = useMenu()
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))

  const update = (fn: (list: Item[]) => Item[]) => {
    if (!editable) return
    dirty.current = true
    setItems(fn)
  }
  const close = () => {
    if (dirty.current && editable) saveDbCommands(databaseId, toStored(latest.current))
    onClose()
  }
  const focusRow = (id: string) => requestAnimationFrame(() => listRef.current?.querySelector<HTMLElement>(`[data-cmd="${globalThis.CSS.escape(id)}"] .dbc-grip`)?.focus())

  const move = (id: string, dir: -1 | 1) => {
    update((list) => {
      const slots = shownSlots(list)
      const k = slots.findIndex((i) => list[i].id === id)
      const j = k + dir
      if (k < 0 || j < 0 || j >= slots.length) return list
      const next = [...list]
      ;[next[slots[k]], next[slots[j]]] = [next[slots[j]], next[slots[k]]]
      return next
    })
    focusRow(id)
  }
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    update((list) => {
      const slots = shownSlots(list)
      const ids = slots.map((i) => list[i].id)
      const order = arrayMove(ids, ids.indexOf(String(e.active.id)), ids.indexOf(String(e.over!.id)))
      const byId = new Map(list.map((x) => [x.id, x]))
      const next = [...list]
      slots.forEach((slot, j) => (next[slot] = byId.get(order[j])!))
      return next
    })
  }
  const toggle = (id: string) =>
    update((list) =>
      list.map((x) => {
        if (x.id !== id) return x
        if (x.source === 'default') return { ...x, hidden: !x.hidden }
        if (x.source === 'own') return { ...x, command: { ...x.command, hidden: !x.command.hidden || undefined } }
        return x
      }),
    )
  const changeOwn = (id: string, fn: (c: DbCommand) => DbCommand) => update((list) => list.map((x) => (x.id === id && x.source === 'own' ? { ...x, command: fn(x.command) } : x)))
  const remove = (id: string) => {
    const shown = items.filter((x) => x.source !== 'gone')
    const at = shown.findIndex((x) => x.id === id)
    update((list) => list.filter((x) => x.id !== id))
    const next = shown[at + 1] ?? shown[at - 1]
    if (next) focusRow(next.id)
  }
  const add = (def: CommandKindDef) => {
    const id = newId()
    update((list) => [...list, { id, source: 'own', command: { id, kind: def.kind, label: '', icon: null, config: (def.create?.(databaseId) ?? {}) as Record<string, unknown> } }])
    setOpen(id)
  }

  const shown = items.filter((x) => x.source !== 'gone')
  const editing = open ? items.find((x): x is Extract<Item, { source: 'own' }> => x.id === open && x.source === 'own') : undefined

  return (
    <Modal
      open
      onClose={close}
      label={t('features.cmd.ed.label')}
      title={t('features.cmd.ed.title', { db: name })}
      width={600}
      className="dbc"
      footer={
        <>
          <span className="dbc__foot-hint label">
            <kbd className="kbd">esc</kbd> {t('features.cmd.ed.saves')}
          </span>
          <button type="button" className="btn btn--ink" onClick={close}>
            {t('common.done')}
          </button>
        </>
      }
    >
      {!editable && (
        <p className="dbc-lock" role="note" data-testid="dbc-lock">
          <Lock size={13} strokeWidth={1.8} aria-hidden /> <span>{t(locked ? 'features.cmd.ed.locked' : 'features.cmd.ed.viewOnly')}</span>
        </p>
      )}
      {editing ? (
        <OwnDetail
          databaseId={databaseId}
          command={editing.command}
          editable={editable}
          onChange={(fn) => changeOwn(editing.id, fn)}
          onBack={() => {
            setOpen(null)
            focusRow(editing.id)
          }}
        />
      ) : (
        <>
          <p className="dbc-hint">{t('features.cmd.ed.hint')}</p>
          <div className="dbc__head">
            <span className="label">{t('features.cmd.ed.section')}</span>
            <span className="dbc__rule" aria-hidden />
            <span className="label faint">{pad2(shown.filter((x) => (x.source === 'default' ? !x.hidden : !x.command.hidden)).length)}</span>
          </div>
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={shown.map((x) => x.id)} strategy={verticalListSortingStrategy}>
              <ol className="dbc-list" ref={listRef} aria-label={t('features.cmd.ed.section')}>
                {shown.map((item, i) => (
                  <Row
                    key={item.id}
                    item={item as Exclude<Item, { source: 'gone' }>}
                    index={i}
                    total={shown.length}
                    editable={editable}
                    kinds={kinds}
                    onMove={(dir) => move(item.id, dir)}
                    onToggle={() => toggle(item.id)}
                    onEdit={() => setOpen(item.id)}
                    onRemove={() => remove(item.id)}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
          <button type="button" className="btn btn--sm dbc-add" disabled={!editable} aria-haspopup="menu" aria-expanded={addMenu.open} onClick={(e) => (addMenu.open ? addMenu.close() : addMenu.openAt(e.currentTarget))}>
            <Plus size={13} /> {t('features.cmd.ed.add')}
          </button>
          <Menu
            {...addMenu.props}
            width={260}
            entries={Object.values(kinds).map((def) => ({ label: kindLabel(def), icon: <CmdGlyph icon={def.icon} />, onSelect: () => add(def) }))}
          />
        </>
      )}
    </Modal>
  )
}

function Row({
  item,
  index,
  total,
  editable,
  kinds,
  onMove,
  onToggle,
  onEdit,
  onRemove,
}: {
  item: Exclude<Item, { source: 'gone' }>
  index: number
  total: number
  editable: boolean
  kinds: Record<string, CommandKindDef>
  onMove: (dir: -1 | 1) => void
  onToggle: () => void
  onEdit: () => void
  onRemove: () => void
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: !editable })
  const own = item.source === 'own'
  const def = own ? (kinds[item.command.kind] ?? null) : null
  const label = own ? ownLabel(item.command) : item.spec.label
  const hidden = own ? !!item.command.hidden : item.hidden
  const icon = own ? item.command.icon ? <PageIcon icon={item.command.icon} size={15} /> : <CmdGlyph icon={def?.icon ?? Zap} /> : <CmdGlyph icon={item.spec.icon} />
  const sub = own ? (def ? kindLabel(def) : item.command.kind) : t(`features.cmd.ed.group.${item.spec.group}`)
  return (
    <li
      ref={setNodeRef}
      className="dbc-row"
      data-cmd={item.id}
      data-hidden={hidden || undefined}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null), transition }}
      onKeyDown={(e) => {
        if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
        e.preventDefault()
        e.stopPropagation()
        onMove(e.key === 'ArrowUp' ? -1 : 1)
      }}
    >
      <button type="button" className="dbc-grip" aria-label={`${label} — ${t('features.cmd.ed.drag', { alt: ALT })}`} disabled={!editable} {...attributes} {...listeners}>
        <GripVertical size={13} aria-hidden />
      </button>
      <span className="dbc-row__num">{pad2(index + 1)}</span>
      <span className="dbc-row__icon">{icon}</span>
      <span className="dbc-row__main">
        <span className="dbc-row__name">{label}</span>
        <span className="dbc-row__kind">{sub}</span>
      </span>
      <span className="dbc-row__tools">
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => onMove(-1)} disabled={!editable || index === 0} aria-label={`${t('features.cmd.ed.up')}: ${label}`} title={t('features.cmd.ed.up')}>
          <ArrowUp size={13} />
        </button>
        <button type="button" className="icon-btn icon-btn--sm" onClick={() => onMove(1)} disabled={!editable || index === total - 1} aria-label={`${t('features.cmd.ed.down')}: ${label}`} title={t('features.cmd.ed.down')}>
          <ArrowDown size={13} />
        </button>
        {own && (
          <>
            <button type="button" className="icon-btn icon-btn--sm" onClick={onEdit} aria-label={t('features.cmd.ed.editOne', { name: label })} title={t('common.edit')}>
              <Pencil size={13} />
            </button>
            <button type="button" className="icon-btn icon-btn--sm" onClick={onRemove} disabled={!editable} aria-label={t('features.cmd.ed.delete', { name: label })} title={t('common.delete')}>
              <Trash2 size={13} />
            </button>
          </>
        )}
        <Switch checked={!hidden} onChange={onToggle} label={t('features.cmd.ed.show', { name: label })} disabled={!editable} />
      </span>
    </li>
  )
}

/** An own command: label, icon, its kind's settings. */
function OwnDetail({ databaseId, command, editable, onChange, onBack }: { databaseId: ID; command: DbCommand; editable: boolean; onChange: (fn: (c: DbCommand) => DbCommand) => void; onBack: () => void }) {
  const t = useT()
  const ids = useId()
  const def = useKinds((s) => s.kinds[command.kind]) ?? null
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null)
  const kindName = def ? kindLabel(def) : command.kind
  const Picker = def?.Picker
  return (
    <div className="dbc-detail">
      <button type="button" className="dbc-back" onClick={onBack}>
        <ChevronLeft size={14} aria-hidden /> {t('features.cmd.ed.back')}
      </button>
      <div className="dbc-detail__top">
        <div className="dbc-field">
          <span className="label">{t('features.cmd.ed.icon')}</span>
          <button type="button" className="dbc-iconkey" aria-label={t('features.cmd.ed.iconPick')} disabled={!editable} onClick={(e) => setIconAnchor(iconAnchor ? null : e.currentTarget)}>
            {command.icon ? <PageIcon icon={command.icon} size={18} /> : <CmdGlyph icon={def?.icon ?? Zap} />}
          </button>
        </div>
        <div className="dbc-field dbc-field--grow">
          <label className="label" htmlFor={`${ids}-label`}>
            {t('features.cmd.ed.name')}
          </label>
          <input
            id={`${ids}-label`}
            className="input"
            value={command.label ?? ''}
            placeholder={kindName}
            maxLength={60}
            readOnly={!editable}
            data-autofocus=""
            onChange={(e) => onChange((c) => ({ ...c, label: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                onBack()
              }
            }}
          />
        </div>
        <div className="dbc-field">
          <span className="label">{t('features.cmd.ed.kind')}</span>
          <span className="dbc-kind">
            <CmdGlyph icon={def?.icon ?? Zap} /> {kindName}
          </span>
        </div>
      </div>
      {Picker ? (
        <fieldset className="dbc-detail__body" disabled={!editable}>
          <Picker databaseId={databaseId} config={command.config ?? {}} onChange={(fn) => onChange((c) => ({ ...c, config: fn(c.config ?? {}) }))} />
        </fieldset>
      ) : (
        <p className="dbc-note">{t('features.cmd.ed.unknown', { kind: command.kind })}</p>
      )}
      <Popover open={!!iconAnchor} anchor={iconAnchor} onClose={() => setIconAnchor(null)} bare>
        <IconPicker
          onSelect={(icon) => {
            onChange((c) => ({ ...c, icon }))
            setIconAnchor(null)
          }}
          onRemove={() => {
            onChange((c) => ({ ...c, icon: null }))
            setIconAnchor(null)
          }}
        />
      </Popover>
    </div>
  )
}

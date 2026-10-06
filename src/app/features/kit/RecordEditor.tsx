/**
 * #/kit/records/<id> — one record type ("Bug", "Lead", "Invoice"), edited as a draft (Save / Revert,
 * Mod+S): name, icon, colour, description; its properties (standard types, own types, select lists from
 * a shared list; rename, reorder by drag or Alt+↑/↓, remove — the databases keep a removed property as a
 * plain one with its values); the content a new record starts with (Markdown here, stored as a page
 * body); the databases holding it. Saving goes through upsertRecordType: every database holding the type
 * follows (locked ones stay as they are).
 */
import { useMemo, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { GripVertical, Plus, X } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { storedTypeOf } from '../../store/kit'
import type { ColorName, PropertyType, RecordType, RecordTypeProp } from '../../store/types'
import { useT } from '../../i18n'
import { toast } from '../../store/ui'
import { newId } from '../../lib/ids'
import { Menu } from '../../ui/Menu'
import type { MenuEntry } from '../../ui/Menu'
import { PageIcon } from '../../ui/PageIcon'
import { TypeIcon } from '../../database'
import { docToMarkdown, markdownToDoc } from '../../editor'
import { RECORD_TYPES, databasesOfRecordType } from './model'
import { EntryHead, SaveBar, Section, Swatches, UsedList, pad2 } from './ui'

const ws = () => useWorkspace.getState()
const sig = (x: RecordType) => JSON.stringify({ ...x, createdAt: 0, updatedAt: 0, createdBy: null, updatedBy: null })

export function RecordEditor({ rt, n }: { rt: RecordType; n: number }) {
  const t = useT()
  const readOnly = useCloud((s) => s.readOnly)
  const databases = useWorkspace((s) => s.databases)
  const pages = useWorkspace((s) => s.pages)
  const kit = useWorkspace((s) => s.kit)
  const [draft, setDraft] = useState<RecordType>(rt)
  const [content, setContent] = useState(() => (rt.content ? docToMarkdown(rt.content).trim() : ''))
  const [seen, setSeen] = useState(rt)
  const savedMd = useMemo(() => (rt.content ? docToMarkdown(rt.content).trim() : ''), [rt.content])
  if (seen !== rt) {
    setSeen(rt)
    if (sig(draft) === sig(seen)) {
      setDraft(rt)
      setContent(rt.content ? docToMarkdown(rt.content).trim() : '')
    }
  }
  const [removedNote, setRemovedNote] = useState(false)
  const dirty = sig(draft) !== sig(rt) || content.trim() !== savedMd
  const patch = (p: Partial<RecordType>) => setDraft((d) => ({ ...d, ...p }))
  const setProps = (properties: RecordTypeProp[]) => patch({ properties })
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)

  const save = () => {
    const md = content.trim()
    const next: RecordType = { ...draft, content: md ? markdownToDoc(md) : null }
    ws().upsertRecordType(next)
    toast(t('features.kit.save.saved', { name: next.name }))
  }
  const freeName = (name: string) => {
    let n2 = name
    for (let i = 2; draft.properties.some((p) => p.name.toLowerCase() === n2.toLowerCase()); i++) n2 = `${name} ${i}`
    return n2
  }
  const add = (p: Omit<RecordTypeProp, 'id'>) => {
    setProps([...draft.properties, { ...p, id: newId(), name: freeName(p.name) }])
    requestAnimationFrame(() => document.querySelector<HTMLInputElement>('.kt-rprop:last-child .kt-rprop__name')?.select())
  }
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = draft.properties.findIndex((p) => p.id === e.active.id)
    const to = draft.properties.findIndex((p) => p.id === e.over!.id)
    if (from >= 0 && to >= 0) setProps(arrayMove(draft.properties, from, to))
  }

  const addEntries: MenuEntry[] = useMemo(() => {
    const out: MenuEntry[] = [{ kind: 'section', label: t('features.kit.records.standard') }]
    for (const type of RECORD_TYPES) out.push({ label: t(`database.type.${type}`), icon: <TypeIcon type={type} />, keywords: type, onSelect: () => add({ name: t(`database.type.${type}`), type, ...(type === 'select' || type === 'multi_select' || type === 'status' ? { options: [] } : {}) }) })
    const own = Object.values(kit?.propTypes ?? {})
    if (own.length) {
      out.push({ kind: 'section', label: t('features.kit.records.own') })
      for (const o of own) out.push({ label: o.name, icon: o.icon ? <PageIcon icon={o.icon} size={14} /> : <TypeIcon type={storedTypeOf(o.base)} />, hint: o.base === 'free' ? t('features.kit.base.free') : t(`database.type.${o.base}`), onSelect: () => add({ name: o.name, type: storedTypeOf(o.base), custom: o.id, ...(o.listId ? { listId: o.listId } : {}) }) })
    }
    const lists = Object.values(kit?.lists ?? {})
    if (lists.length) {
      out.push({ kind: 'section', label: t('features.kit.records.lists') })
      for (const l of lists)
        out.push({
          label: l.name,
          icon: l.icon ? <PageIcon icon={l.icon} size={14} /> : <TypeIcon type="select" />,
          hint: t('features.kit.records.fromList'),
          submenu: (['select', 'multi_select'] as const).map((type) => ({ label: t(`database.type.${type}`), icon: <TypeIcon type={type} />, onSelect: () => add({ name: l.name, type, listId: l.id, options: [] }) })),
        })
    }
    return out
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [kit, t, draft.properties])

  const usedIn = useMemo(() => databasesOfRecordType(rt.id), [rt.id, databases, pages]) // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div className="kt-editor" data-testid="kt-record-editor">
      <EntryHead
        code={`RT-${pad2(n)}`}
        icon={draft.icon}
        name={draft.name}
        description={draft.description ?? ''}
        readOnly={readOnly}
        placeholder={t('features.kit.records.namePlaceholder')}
        onIcon={(icon) => patch({ icon })}
        onName={(name) => patch({ name })}
        onDescription={(description) => patch({ description })}
        onDelete={() => {
          const name = rt.name
          ws().deleteRecordType(rt.id)
          window.location.hash = '#/kit/records'
          toast(t('features.kit.records.deleted', { name }))
        }}
        extra={<span>{t('features.kit.records.kind')}</span>}
      />
      <div className="kt-grid kt-grid--top">
        <span className="label">{t('features.kit.records.color')}</span>
        <Swatches value={draft.color} disabled={readOnly} label={t('features.kit.records.color')} onChange={(color: ColorName) => patch({ color })} />
      </div>
      <Section num="01" title={t('features.kit.records.properties')} aside={<span className="mono">{pad2(draft.properties.length)}</span>}>
        {draft.properties.length > 0 ? (
          <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
            <SortableContext items={draft.properties.map((p) => p.id)} strategy={verticalListSortingStrategy}>
              <ol className="kt-rprops" aria-label={t('features.kit.records.properties')}>
                {draft.properties.map((p, i) => (
                  <PropRow
                    key={p.id}
                    p={p}
                    n={i + 1}
                    readOnly={readOnly}
                    onChange={(next) => setProps(draft.properties.map((x) => (x.id === p.id ? next : x)))}
                    onRemove={() => {
                      setProps(draft.properties.filter((x) => x.id !== p.id))
                      if (usedIn.length) setRemovedNote(true)
                    }}
                    onMove={(by) => {
                      const j = i + by
                      if (j < 0 || j >= draft.properties.length) return
                      setProps(arrayMove(draft.properties, i, j))
                    }}
                  />
                ))}
              </ol>
            </SortableContext>
          </DndContext>
        ) : (
          <p className="kt-empty-line">{t('features.kit.records.noProps')}</p>
        )}
        {removedNote && (
          <p className="kt-note kt-note--info" role="status" data-testid="kt-removed-note">
            {t('features.kit.records.removedNote')}
          </p>
        )}
        {!readOnly && (
          <button type="button" className="btn btn--sm kt-add" onClick={(e) => setAddAnchor(e.currentTarget)} data-testid="kt-record-add-prop" disabled={draft.properties.length >= 50}>
            <Plus size={13} strokeWidth={1.9} aria-hidden /> {t('features.kit.records.addProp')}
          </button>
        )}
        <Menu open={!!addAnchor} anchor={addAnchor} onClose={() => setAddAnchor(null)} entries={addEntries} searchable searchPlaceholder={t('features.kit.search')} emptyLabel={t('features.kit.searchEmpty')} />
      </Section>
      <Section num="02" title={t('features.kit.records.content')}>
        <p className="kt-note">{t('features.kit.records.contentHelp')}</p>
        <textarea
          className="input kt-markdown"
          value={content}
          readOnly={readOnly}
          rows={6}
          placeholder={t('features.kit.records.contentPlaceholder')}
          aria-label={t('features.kit.records.content')}
          data-testid="kt-record-content"
          onChange={(e) => setContent(e.target.value)}
        />
      </Section>
      <Section num="03" title={t('features.kit.records.usedIn')} aside={<span className="mono">{pad2(usedIn.length)}</span>}>
        <UsedList empty={t('features.kit.records.unused')} items={usedIn.map((u) => ({ key: u.db.id, dbId: u.db.id, label: u.title || t('common.untitled'), meta: `${t('features.kit.records.rows', { n: u.rows })}${u.db.locked ? ` · ${t('features.kit.records.locked')}` : ''}` }))} />
      </Section>
      <SaveBar
        dirty={dirty}
        readOnly={readOnly}
        onSave={save}
        onRevert={() => {
          setDraft(rt)
          setContent(savedMd)
          setRemovedNote(false)
        }}
        note={usedIn.length && dirty ? <span className="kt-savebar__note">{t('features.kit.records.follows', { n: usedIn.length })}</span> : undefined}
      />
    </div>
  )
}

function PropRow({ p, n, readOnly, onChange, onRemove, onMove }: { p: RecordTypeProp; n: number; readOnly: boolean; onChange: (p: RecordTypeProp) => void; onRemove: () => void; onMove: (by: -1 | 1) => void }) {
  const t = useT()
  const kit = useWorkspace((s) => s.kit)
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: p.id, disabled: readOnly })
  const own = p.custom ? kit?.propTypes[p.custom] : undefined
  const list = p.listId ? kit?.lists[p.listId] : undefined
  const kind = own ? own.name : list ? t('features.kit.records.listOf', { list: list.name }) : t(`database.type.${p.type as PropertyType}`)
  return (
    <li ref={setNodeRef} className="kt-rprop" data-dragging={isDragging || undefined} style={{ transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null), transition }}>
      {!readOnly && (
        <button type="button" className="kt-grip" aria-label={t('features.kit.items.drag', { name: p.name })} {...attributes} {...listeners}>
          <GripVertical size={13} aria-hidden />
        </button>
      )}
      <span className="kt-item__n label">{pad2(n)}</span>
      <span className="kt-rprop__icon">{own?.icon ? <PageIcon icon={own.icon} size={14} /> : <TypeIcon type={p.type} />}</span>
      <input
        className="kt-rprop__name"
        value={p.name}
        readOnly={readOnly}
        maxLength={80}
        aria-label={t('features.kit.records.propName', { n })}
        onChange={(e) => onChange({ ...p, name: e.target.value })}
        onBlur={(e) => !e.target.value.trim() && onChange({ ...p, name: kind })}
        onKeyDown={(e) => {
          if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
            e.preventDefault()
            onMove(e.key === 'ArrowUp' ? -1 : 1)
            const el = e.currentTarget
            requestAnimationFrame(() => el.focus())
          }
        }}
      />
      <span className="kt-rprop__kind label">{kind}</span>
      {!readOnly && (
        <button type="button" className="icon-btn icon-btn--sm" aria-label={t('features.kit.records.removeProp', { name: p.name })} onClick={onRemove} data-testid="kt-record-remove-prop">
          <X size={13} aria-hidden />
        </button>
      )}
    </li>
  )
}

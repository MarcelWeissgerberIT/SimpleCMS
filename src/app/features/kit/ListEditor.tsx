/**
 * #/kit/lists/<id> — one shared list: name, icon, description; its items (add, paste many lines, rename,
 * colour, reorder by drag or Alt+↑/↓, delete — an item rows still use asks first: remove anyway or
 * replace with another item); "Fill with Claude" (a prompt + optionally a page Claude may read →
 * proposals to tick); where it is used. Every change is saved at once (upsertList keeps every bound
 * property in step).
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { DndContext, KeyboardSensor, PointerSensor, closestCenter, useSensor, useSensors, type DragEndEvent } from '@dnd-kit/core'
import { SortableContext, arrayMove, sortableKeyboardCoordinates, useSortable, verticalListSortingStrategy } from '@dnd-kit/sortable'
import { CSS } from '@dnd-kit/utilities'
import { Check, GripVertical, Plus, Square, X } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { inTemplate } from '../../store/selectors'
import type { ColorName, ID, OptionList, SelectOption } from '../../store/types'
import { COLOR_NAMES } from '../../store/types'
import { useT } from '../../i18n'
import { tagStyle } from '../../lib/colors'
import { toast } from '../../store/ui'
import { PageIcon } from '../../ui/PageIcon'
import { isAIConfigured } from '../ai/client'
import { blocksUsingList, itemsFromText, newItems, propsOfList, removeItem } from './model'
import { proposeItems, type Proposal } from './claude'
import { ColorKey, EntryHead, PickButton, Section, UsedList, pad2 } from './ui'

const ws = () => useWorkspace.getState()
/** AIError's message is already the friendly sentence in the UI language. */
const aiErrorMessage = (e: unknown) => (e instanceof Error ? e.message : String(e))

function save(list: OptionList, patch: Partial<OptionList>): void {
  ws().upsertList({ ...list, ...patch })
}

export function ListEditor({ list, n }: { list: OptionList; n: number }) {
  const t = useT()
  const readOnly = useCloud((s) => s.readOnly)
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const kit = useWorkspace((s) => s.kit)
  // rows per item, in one pass over the workspace
  const usage = useMemo(() => {
    const counts = new Map<ID, number>()
    for (const item of list.items) counts.set(item.id, 0)
    const props = propsOfList(list.id)
    if (props.length) {
      const byDb = new Map<ID, string[]>()
      for (const u of props) byDb.set(u.db.id, [...(byDb.get(u.db.id) ?? []), u.prop.id])
      for (const p of Object.values(pages)) {
        if (!p.databaseId || p.trashed) continue
        for (const pid of byDb.get(p.databaseId) ?? []) {
          const v = p.properties[pid]
          for (const id of Array.isArray(v) ? (v as ID[]) : typeof v === 'string' ? [v] : []) if (counts.has(id)) counts.set(id, (counts.get(id) ?? 0) + 1)
        }
      }
    }
    return { counts, props }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [list, pages, databases])
  const blocks = useMemo(() => blocksUsingList(list.id), [list.id, kit])

  const used = [
    ...usage.props.map((u) => ({ key: `${u.db.id}:${u.prop.id}`, dbId: u.db.id, label: <>{u.title || t('common.untitled')} <span className="faint">›</span> {u.prop.name}</>, meta: t('features.kit.used.property') })),
    ...blocks.types.map((x) => ({ key: `t:${x.id}`, href: `#/kit/types/${x.id}`, label: x.name, meta: t('features.kit.used.ownType') })),
    ...blocks.records.map((x) => ({ key: `r:${x.id}`, href: `#/kit/records/${x.id}`, label: x.name, meta: t('features.kit.used.recordType') })),
  ]

  return (
    <div className="kt-editor" data-testid="kt-list-editor">
      <EntryHead
        code={`LS-${pad2(n)}`}
        icon={list.icon}
        name={list.name}
        description={list.description ?? ''}
        readOnly={readOnly}
        placeholder={t('features.kit.lists.namePlaceholder')}
        onIcon={(icon) => save(list, { icon })}
        onName={(name) => save(list, { name })}
        onDescription={(description) => save(list, { description })}
        onDelete={() => {
          const name = list.name
          ws().deleteList(list.id)
          window.location.hash = '#/kit/lists'
          toast(t('features.kit.lists.deleted', { name }))
        }}
        extra={<span>{t('features.kit.lists.kind')}</span>}
      />
      <Section num="01" title={t('features.kit.lists.items')} aside={<span className="mono" data-testid="kt-item-count">{pad2(list.items.length)}</span>}>
        <Items list={list} counts={usage.counts} readOnly={readOnly} />
      </Section>
      {!readOnly && (
        <Section num="02" title={t('features.kit.fill.title')}>
          <FillWithClaude list={list} />
        </Section>
      )}
      <Section num={readOnly ? '02' : '03'} title={t('features.kit.used.title')} aside={<span className="mono">{pad2(used.length)}</span>}>
        <UsedList items={used} empty={t('features.kit.lists.unused')} />
      </Section>
    </div>
  )
}

/* ------------------------------------------------------------------ items */

function Items({ list, counts, readOnly }: { list: OptionList; counts: Map<ID, number>; readOnly: boolean }) {
  const t = useT()
  const [draft, setDraft] = useState('')
  const [removing, setRemoving] = useState<ID | null>(null)
  const sensors = useSensors(useSensor(PointerSensor, { activationConstraint: { distance: 3 } }), useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates }))
  const listRef = useRef<HTMLOListElement>(null)

  const add = (names: string[]) => {
    const items = newItems(names, list.items)
    if (!items.length) return 0
    save(list, { items: [...list.items, ...items] })
    return items.length
  }
  const commitDraft = () => {
    const names = itemsFromText(draft)
    if (!names.length) return
    const n = add(names)
    setDraft('')
    if (names.length > 1) toast(t('features.kit.items.added', { n }))
  }
  const move = (id: ID, by: -1 | 1) => {
    const i = list.items.findIndex((o) => o.id === id)
    const j = i + by
    if (i < 0 || j < 0 || j >= list.items.length) return
    save(list, { items: arrayMove(list.items, i, j) })
    requestAnimationFrame(() => listRef.current?.querySelector<HTMLInputElement>(`[data-item="${id}"] .kt-item__name`)?.focus())
  }
  const onDragEnd = (e: DragEndEvent) => {
    if (!e.over || e.active.id === e.over.id) return
    const from = list.items.findIndex((o) => o.id === e.active.id)
    const to = list.items.findIndex((o) => o.id === e.over!.id)
    if (from >= 0 && to >= 0) save(list, { items: arrayMove(list.items, from, to) })
  }

  return (
    <div className="kt-items">
      {list.items.length > 0 && (
        <DndContext sensors={sensors} collisionDetection={closestCenter} onDragEnd={onDragEnd}>
          <SortableContext items={list.items.map((o) => o.id)} strategy={verticalListSortingStrategy}>
            <ol className="kt-items__list" ref={listRef} aria-label={t('features.kit.lists.items')}>
              {list.items.map((o, i) => (
                <ItemRow
                  key={o.id}
                  item={o}
                  n={i + 1}
                  uses={counts.get(o.id) ?? 0}
                  readOnly={readOnly}
                  removing={removing === o.id}
                  list={list}
                  onRemove={() => {
                    if ((counts.get(o.id) ?? 0) > 0) setRemoving(o.id)
                    else save(list, { items: list.items.filter((x) => x.id !== o.id) })
                  }}
                  onCancelRemove={() => setRemoving(null)}
                  onMove={(by) => move(o.id, by)}
                />
              ))}
            </ol>
          </SortableContext>
        </DndContext>
      )}
      {!list.items.length && <p className="kt-empty-line">{t('features.kit.items.none')}</p>}
      {!readOnly && (
        <div className="kt-items__add">
          <Plus size={14} strokeWidth={1.8} aria-hidden />
          <textarea
            className="kt-items__input"
            rows={1}
            value={draft}
            placeholder={t('features.kit.items.addPlaceholder')}
            aria-label={t('features.kit.items.add')}
            data-testid="kt-item-add"
            onChange={(e) => setDraft(e.target.value)}
            onPaste={(e) => {
              const text = e.clipboardData.getData('text/plain')
              if (!/[\n\t]/.test(text.trim())) return
              e.preventDefault()
              const n = add(itemsFromText(text))
              toast(t('features.kit.items.added', { n }))
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault()
                commitDraft()
              }
            }}
          />
          <span className="kt-hint label">{t('features.kit.items.pasteHint')}</span>
        </div>
      )}
    </div>
  )
}

function ItemRow({
  item,
  n,
  uses,
  readOnly,
  removing,
  list,
  onRemove,
  onCancelRemove,
  onMove,
}: {
  item: SelectOption
  n: number
  uses: number
  readOnly: boolean
  removing: boolean
  list: OptionList
  onRemove: () => void
  onCancelRemove: () => void
  onMove: (by: -1 | 1) => void
}) {
  const t = useT()
  const { attributes, listeners, setNodeRef, transform, transition, isDragging } = useSortable({ id: item.id, disabled: readOnly })
  const [name, setName] = useState(item.name)
  const [replaceWith, setReplaceWith] = useState<ID | null>(null)
  useEffect(() => setName(item.name), [item.name])
  const commit = () => {
    const v = name.replace(/\s+/g, ' ').trim()
    if (!v || v === item.name) return setName(item.name)
    if (list.items.some((o) => o.id !== item.id && o.name.toLowerCase() === v.toLowerCase())) {
      toast(t('features.kit.items.duplicate', { name: v }))
      return setName(item.name)
    }
    save(list, { items: list.items.map((o) => (o.id === item.id ? { ...o, name: v } : o)) })
  }
  const setColor = (color: ColorName) => save(list, { items: list.items.map((o) => (o.id === item.id ? { ...o, color } : o)) })
  const others = list.items.filter((o) => o.id !== item.id)
  return (
    <li
      ref={setNodeRef}
      className="kt-item"
      data-item={item.id}
      data-dragging={isDragging || undefined}
      style={{ transform: CSS.Transform.toString(transform ? { ...transform, x: 0 } : null), transition }}
    >
      <div className="kt-item__row">
        {!readOnly && (
          <button type="button" className="kt-grip" aria-label={t('features.kit.items.drag', { name: item.name })} {...attributes} {...listeners}>
            <GripVertical size={13} aria-hidden />
          </button>
        )}
        <span className="kt-item__n label">{pad2(n)}</span>
        <ColorKey value={item.color} onChange={setColor} disabled={readOnly} label={t('features.kit.items.color', { name: item.name })} />
        <input
          className="kt-item__name"
          value={name}
          readOnly={readOnly}
          aria-label={t('features.kit.items.name', { n })}
          maxLength={200}
          onChange={(e) => setName(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.altKey && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
              e.preventDefault()
              commit()
              onMove(e.key === 'ArrowUp' ? -1 : 1)
            } else if (e.key === 'Enter') {
              e.preventDefault()
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'Escape') setName(item.name)
          }}
        />
        <span className="kt-item__tag tag" style={tagStyle(item.color)} aria-hidden>
          {item.name}
        </span>
        {uses > 0 && (
          <span className="kt-item__uses label" title={t('features.kit.items.usesTitle', { n: uses })}>
            {t('features.kit.items.uses', { n: uses })}
          </span>
        )}
        {!readOnly && (
          <button type="button" className="icon-btn icon-btn--sm kt-item__del" aria-label={t('features.kit.items.remove', { name: item.name })} onClick={onRemove} data-testid="kt-item-remove">
            <X size={13} aria-hidden />
          </button>
        )}
      </div>
      {removing && (
        <div className="kt-item__confirm" role="alert" data-testid="kt-item-confirm">
          <span>{t('features.kit.items.usedIn', { n: uses })}</span>
          <span className="kt-item__confirmkeys">
            {others.length > 0 && (
              <>
                <PickButton
                  value={replaceWith}
                  placeholder={t('features.kit.items.replacePick')}
                  label={t('features.kit.items.replacePick')}
                  testId="kt-item-replace-pick"
                  items={others.map((o) => ({ value: o.id, label: o.name, icon: <span className="kt-dot" style={tagStyle(o.color)} /> }))}
                  onChange={setReplaceWith}
                />
                <button
                  type="button"
                  className="btn btn--sm"
                  disabled={!replaceWith}
                  data-testid="kt-item-replace"
                  onClick={() => {
                    const target = others.find((o) => o.id === replaceWith)
                    const k = removeItem(list, item.id, replaceWith)
                    onCancelRemove()
                    toast(t('features.kit.items.replaced', { n: k, name: target?.name ?? '' }))
                  }}
                >
                  {t('features.kit.items.replace')}
                </button>
              </>
            )}
            <button
              type="button"
              className="btn btn--sm btn--danger"
              data-testid="kt-item-remove-anyway"
              onClick={() => {
                const k = removeItem(list, item.id, null)
                onCancelRemove()
                toast(t('features.kit.items.removedFrom', { n: k }))
              }}
            >
              {t('features.kit.items.removeAnyway')}
            </button>
            <button type="button" className="btn btn--sm btn--ghost" onClick={onCancelRemove}>
              {t('common.cancel')}
            </button>
          </span>
        </div>
      )}
    </li>
  )
}

/* ------------------------------------------------------------------ Fill with Claude */

const NO_PAGE = '__none'

function FillWithClaude({ list }: { list: OptionList }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const [prompt, setPrompt] = useState('')
  const [pageId, setPageId] = useState<string>(NO_PAGE)
  const [state, setState] = useState<{ phase: 'idle' | 'asking' | 'done' | 'error'; items: Proposal[]; on: Set<number>; error?: string }>({ phase: 'idle', items: [], on: new Set() })
  const abort = useRef<AbortController | null>(null)
  useEffect(() => () => abort.current?.abort(), [])
  const configured = isAIConfigured()

  const pageItems = useMemo(() => {
    const live = Object.values(pages).filter((p) => !p.trashed && !p.databaseId && p.kind !== 'database' && p.title.trim() && !inTemplate(pages, p.id))
    live.sort((a, b) => b.updatedAt - a.updatedAt)
    return [{ value: NO_PAGE, label: t('features.kit.fill.noPage') }, ...live.slice(0, 200).map((p) => ({ value: p.id, label: p.title.trim(), icon: <PageIcon icon={p.icon} size={14} /> }))]
  }, [pages, t])

  const ask = async () => {
    if (!prompt.trim() || state.phase === 'asking') return
    abort.current?.abort()
    const ctrl = new AbortController()
    abort.current = ctrl
    setState({ phase: 'asking', items: [], on: new Set() })
    try {
      const items = await proposeItems({ prompt, listName: list.name, existing: list.items.map((o) => o.name), pageId: pageId === NO_PAGE ? null : pageId, signal: ctrl.signal })
      if (ctrl.signal.aborted) return
      setState({ phase: 'done', items, on: new Set(items.map((_, i) => i)) })
    } catch (e) {
      if (ctrl.signal.aborted) return setState({ phase: 'idle', items: [], on: new Set() })
      setState({ phase: 'error', items: [], on: new Set(), error: aiErrorMessage(e) })
    }
  }
  const apply = () => {
    const live = ws().kit?.lists[list.id] ?? list
    const picked = state.items.filter((_, i) => state.on.has(i)).map((p) => ({ name: p.name, color: p.color !== 'default' && COLOR_NAMES.includes(p.color as ColorName) ? (p.color as ColorName) : undefined }))
    const items = newItems(picked, live.items)
    save(live, { items: [...live.items, ...items] })
    setState({ phase: 'idle', items: [], on: new Set() })
    setPrompt('')
    toast(t('features.kit.items.added', { n: items.length }))
  }
  const toggle = (i: number) => setState((s) => {
    const on = new Set(s.on)
    if (on.has(i)) on.delete(i)
    else on.add(i)
    return { ...s, on }
  })

  if (!configured)
    return (
      <p className="kt-empty-line" data-testid="kt-fill-nokey">
        {t('features.kit.fill.noKey')}
      </p>
    )
  return (
    <div className="kt-fill" data-testid="kt-fill">
      <p className="kt-note">{t('features.kit.fill.lead')}</p>
      <div className="kt-fill__row">
        <input
          className="input kt-fill__prompt"
          value={prompt}
          placeholder={t('features.kit.fill.placeholder')}
          aria-label={t('features.kit.fill.prompt')}
          data-testid="kt-fill-prompt"
          onChange={(e) => setPrompt(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void ask()
            }
          }}
        />
        <PickButton value={pageId} items={pageItems} onChange={setPageId} placeholder={t('features.kit.fill.noPage')} label={t('features.kit.fill.page')} testId="kt-fill-page" />
        {state.phase === 'asking' ? (
          <button type="button" className="btn" onClick={() => abort.current?.abort()}>
            <Square size={11} strokeWidth={2} aria-hidden /> {t('features.kit.fill.stop')}
          </button>
        ) : (
          <button type="button" className="btn btn--primary" disabled={!prompt.trim()} onClick={() => void ask()} data-testid="kt-fill-ask">
            <span className="kt-ai" aria-hidden>AI</span> {t('features.kit.fill.ask')}
          </button>
        )}
      </div>
      <p className="kt-fill__privacy label">{pageId === NO_PAGE ? t('features.kit.fill.sendsPrompt') : t('features.kit.fill.sendsPage')}</p>
      {state.phase === 'asking' && (
        <p className="kt-fill__status label">
          <span className="led led--on kt-led--live" aria-hidden /> {t('features.kit.fill.asking')}
        </p>
      )}
      {state.phase === 'error' && (
        <p className="kt-fill__error" role="alert">
          {state.error}
        </p>
      )}
      {state.phase === 'done' && (
        <div className="kt-proposals" data-testid="kt-proposals">
          {state.items.length === 0 ? (
            <p className="kt-empty-line">{t('features.kit.fill.nothing')}</p>
          ) : (
            <>
              <div className="kt-proposals__head label">
                <span>{t('features.kit.fill.proposed', { n: state.items.length })}</span>
                <span className="kt-rule" aria-hidden />
                <button type="button" className="kt-link" onClick={() => setState((s) => ({ ...s, on: s.on.size === s.items.length ? new Set() : new Set(s.items.map((_, i) => i)) }))}>
                  {state.on.size === state.items.length ? t('features.kit.fill.none') : t('features.kit.fill.all')}
                </button>
              </div>
              <ul className="kt-proposals__list">
                {state.items.map((p, i) => (
                  <li key={i}>
                    <label className="kt-proposal">
                      <input type="checkbox" checked={state.on.has(i)} onChange={() => toggle(i)} />
                      <span className="kt-proposal__box" aria-hidden>
                        {state.on.has(i) && <Check size={11} strokeWidth={3} />}
                      </span>
                      <span className="tag" style={tagStyle(p.color !== 'default' && COLOR_NAMES.includes(p.color as ColorName) ? (p.color as ColorName) : 'default')}>
                        {p.name}
                      </span>
                    </label>
                  </li>
                ))}
              </ul>
            </>
          )}
          <div className="kt-proposals__keys">
            <button type="button" className="btn btn--ghost" onClick={() => setState({ phase: 'idle', items: [], on: new Set() })}>
              {t('features.kit.fill.discard')}
            </button>
            {state.items.length > 0 && (
              <button type="button" className="btn btn--primary" disabled={!state.on.size} onClick={apply} data-testid="kt-fill-apply">
                {t('features.kit.fill.add', { n: state.on.size })}
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}


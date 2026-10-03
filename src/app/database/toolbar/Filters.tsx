/**
 * Filter builder (AND/OR groups, operators per type) and the removable filter chips bar.
 */
import { useEffect, useState } from 'react'
import { ArrowUpDown, Plus, Trash, X, CalendarDays, Layers, Lock } from 'lucide-react'
import { SortPanel } from './Panels'
import type { Database, DateValue, Filter, FilterGroup, FilterOperator, ID, PropertyDef, PropertyValue, View } from '../../store/types'
import { Popover } from '../../ui/Popover'
import { useT } from '../../i18n'
import { newId } from '../../lib/ids'
import { Menu, Select, TypeIcon } from '../parts'
import { DatePicker } from '../cells/DatePicker'
import { ActorAvatar, Avatar, MeAvatar } from '../cells/display'
import { tagStyle } from '../../lib/colors'
import { VALUELESS_OPS, operatorsFor } from '../model/schema'
import { countFilters, inferKind, isGroup } from '../model/query'
import { formatDateValue, todayISO } from '../model/format'
import type { DbModel } from '../hooks'
import { LOCAL_ACTOR, ME_TOKEN, actorKind, isActorType, type ActorKind } from '../model/actors'
import { currentQuery, resetSessionQuery, setViewQuery, useSessionOverlay } from '../model/lock'
import { SessionNote } from './Lock'
import type { Translate } from '@/shared/i18n'
import { plural } from '../parts'
import { usePropertyCreate } from '../create/entry'

const REL_DATES = ['today', 'tomorrow', 'yesterday', 'one_week_ago', 'one_week_from_now', 'one_month_ago', 'one_month_from_now'] as const

export function emptyGroup(): FilterGroup {
  return { id: newId(), op: 'and', items: [] }
}

function useKindOf(m: DbModel) {
  return (prop: PropertyDef) => inferKind(m.resolver, m.db, prop, m.allRows)
}

export function newFilterFor(m: DbModel, prop: PropertyDef): Filter {
  const kind = inferKind(m.resolver, m.db, prop, m.allRows)
  return { id: newId(), propertyId: prop.id, operator: operatorsFor(kind)[0] }
}

/* ---------------- value text (chips) ---------------- */

export function filterValueText(m: DbModel, f: Filter, t: Translate): string {
  const prop = m.propMap.get(f.propertyId)
  if (!prop || VALUELESS_OPS.includes(f.operator)) return ''
  const v = f.value
  if (v === undefined || v === null || v === '') return ''
  if (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select') return prop.options?.find((o) => o.id === v)?.name ?? ''
  if (v === ME_TOKEN && (prop.type === 'person' || isActorType(prop.type))) return t('database.me')
  if (prop.type === 'person') return m.resolver.ctx.people.find((p) => p.id === v)?.name ?? ''
  if (isActorType(prop.type)) return m.resolver.actorName(String(v))
  if (typeof v === 'object' && !Array.isArray(v) && 'start' in v) {
    const dv = v as DateValue
    if ((REL_DATES as readonly string[]).includes(dv.start)) return t(`database.filter.date.${dv.start}`)
    return formatDateValue(dv, m.resolver.ctx.lang, m.resolver.ctx.labels, false)
  }
  return String(v)
}

/* ---------------- value editor ---------------- */

function FilterValue({ m, filter, onChange }: { m: DbModel; filter: Filter; onChange: (v: PropertyValue) => void }) {
  const t = useT()
  const prop = m.propMap.get(filter.propertyId)
  const kindOf = useKindOf(m)
  const [dateAnchor, setDateAnchor] = useState<HTMLElement | null>(null)
  if (!prop || VALUELESS_OPS.includes(filter.operator)) return <span className="db-frule__novalue" />
  const kind = kindOf(prop)
  const v = filter.value
  if (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select') {
    return (
      <Select
        value={(v as string) ?? null}
        placeholder={t('database.filter.pickOption')}
        className="db-frule__value"
        items={(prop.options ?? []).map((o) => ({
          value: o.id,
          label: o.name,
          icon: prop.type === 'status' ? <span className="db-status__led" data-group={o.group ?? 'todo'} /> : <span className="db-swatch" style={tagStyle(o.color)} />,
        }))}
        onChange={onChange}
      />
    )
  }
  if (prop.type === 'person' || isActorType(prop.type)) {
    const people = m.resolver.ctx.people
    // "Me" first: resolved per viewer when the filter runs (model/actors)
    const items = [
      { value: ME_TOKEN, label: t('database.me'), icon: <MeAvatar /> },
      ...(isActorType(prop.type) ? actorChoices(m, prop) : people.map((p) => p.id)).map((id) => {
        const person = people.find((p) => p.id === id)
        const kind = actorKind(id, people)
        return {
          value: id,
          label: person ? person.name : m.resolver.actorName(id),
          icon: person ? <Avatar person={person} size={16} /> : <ActorAvatar kind={kind as Exclude<ActorKind, 'person'>} name={m.resolver.actorName(id)} size={16} />,
        }
      }),
    ]
    return <Select value={(v as string) ?? null} placeholder={t('database.filter.pickPerson')} className="db-frule__value" items={items} onChange={onChange} />
  }
  if (kind === 'date') {
    const dv = v as DateValue | undefined
    const rel = dv && (REL_DATES as readonly string[]).includes(dv.start) ? dv.start : dv ? 'exact' : null
    return (
      <span className="db-frule__value db-frule__date">
        <Select
          value={rel}
          placeholder={t('database.filter.pickDate')}
          items={[...REL_DATES.map((r) => ({ value: r as string, label: t(`database.filter.date.${r}`) })), { value: 'exact', label: t('database.filter.date.exact') }]}
          onChange={(x) => {
            if (x === 'exact') onChange({ start: todayISO() })
            else onChange({ start: x })
          }}
        />
        {rel === 'exact' && (
          <>
            <button type="button" className="btn btn--sm" onClick={(e) => setDateAnchor(e.currentTarget)}>
              <CalendarDays size={13} /> {filterValueText(m, filter, t)}
            </button>
            <Popover open={!!dateAnchor} anchor={dateAnchor} onClose={() => setDateAnchor(null)} className="db-pop db-pop--date">
              <DatePicker value={dv ?? null} allowRange={false} onChange={(d) => d && onChange({ start: d.start.slice(0, 10) })} />
            </Popover>
          </>
        )}
      </span>
    )
  }
  return (
    <input
      className="input db-frule__value"
      type={kind === 'number' ? 'number' : 'text'}
      value={v === null || v === undefined ? '' : String(v)}
      placeholder={t('database.filter.valuePlaceholder')}
      onChange={(e) => onChange(kind === 'number' ? (e.target.value === '' ? null : Number(e.target.value)) : e.target.value)}
      onKeyDown={(e) => e.stopPropagation()}
    />
  )
}

/**
 * Who a created_by / last_edited_by filter can name: the workspace people (team workspaces) and
 * whoever else made rows here (API tokens, webhooks, former members). Locally only "Me".
 */
function actorChoices(m: DbModel, prop: PropertyDef): string[] {
  const out: string[] = m.resolver.ctx.me.id === null ? [] : m.resolver.ctx.people.map((p) => p.id)
  for (const row of m.allRows) {
    const v = m.resolver.value(m.db, prop, row)
    if (typeof v === 'string' && v !== LOCAL_ACTOR && !out.includes(v)) out.push(v)
  }
  return out
}

/* ---------------- rule + group editors ---------------- */

function FilterRule({ m, filter, onChange, onRemove, onDialog }: { m: DbModel; filter: Filter; onChange: (f: Filter) => void; onRemove: () => void; onDialog?: () => void }) {
  const t = useT()
  const kindOf = useKindOf(m)
  const createEntry = usePropertyCreate(m.db, { beforeDialog: onDialog })
  const prop = m.propMap.get(filter.propertyId)
  const ops: FilterOperator[] = prop ? operatorsFor(kindOf(prop)) : []
  return (
    <div className="db-frule">
      <Select
        value={filter.propertyId}
        searchable
        className="db-frule__prop"
        items={m.db.properties.map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> }))}
        onChange={(id) => {
          const p = m.propMap.get(id)
          if (p) onChange({ ...newFilterFor(m, p), id: filter.id })
        }}
        create={(q) => createEntry(q, (p) => onChange({ ...newFilterFor(m, p), id: filter.id }))}
      />
      <Select
        value={filter.operator}
        className="db-frule__op"
        items={ops.map((o) => ({ value: o, label: t(`database.op.${o}`) }))}
        onChange={(op) => onChange({ ...filter, operator: op, value: VALUELESS_OPS.includes(op) ? undefined : filter.value })}
      />
      <FilterValue m={m} filter={filter} onChange={(v) => onChange({ ...filter, value: v })} />
      <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.remove')} onClick={onRemove}>
        <Trash size={13} />
      </button>
    </div>
  )
}

/** Wording of the builder where it edits something other than the view filter (e.g. colour rules). */
export interface GroupEditorLabels {
  empty?: string
  addRule?: string
}

/**
 * AND/OR group editor (rules + one level of nested groups). Also used by colour rules.
 * `onDialog`: close the surrounding panel before the relation dialog opens (property pickers).
 */
export function GroupEditor({
  m,
  group,
  depth,
  onChange,
  onRemove,
  labels,
  onDialog,
}: {
  m: DbModel
  group: FilterGroup
  depth: number
  onChange: (g: FilterGroup) => void
  onRemove?: () => void
  labels?: GroupEditorLabels
  onDialog?: () => void
}) {
  const t = useT()
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)
  const createEntry = usePropertyCreate(m.db, { beforeDialog: onDialog })
  const setItem = (i: number, it: Filter | FilterGroup) => onChange({ ...group, items: group.items.map((x, j) => (j === i ? it : x)) })
  const removeItem = (i: number) => onChange({ ...group, items: group.items.filter((_, j) => j !== i) })
  return (
    <div className={`db-fgroup${depth > 0 ? ' db-fgroup--nested' : ''}`}>
      {group.items.length === 0 && <div className="label db-fgroup__empty">{labels?.empty ?? t('database.filter.noRules')}</div>}
      {group.items.map((it, i) => (
        <div key={it.id} className="db-fgroup__item">
          <span className="db-fgroup__conj">
            {i === 0 ? (
              <span className="label">{t('database.filter.where')}</span>
            ) : i === 1 ? (
              <Select
                value={group.op}
                className="db-fgroup__opsel"
                items={[
                  { value: 'and', label: t('database.filter.and') },
                  { value: 'or', label: t('database.filter.or') },
                ]}
                onChange={(op) => onChange({ ...group, op })}
              />
            ) : (
              <span className="label">{t(`database.filter.${group.op}`)}</span>
            )}
          </span>
          {isGroup(it) ? (
            <GroupEditor m={m} group={it} depth={depth + 1} onChange={(g) => setItem(i, g)} onRemove={() => removeItem(i)} labels={labels} onDialog={onDialog} />
          ) : (
            <FilterRule m={m} filter={it} onChange={(f) => setItem(i, f)} onRemove={() => removeItem(i)} onDialog={onDialog} />
          )}
        </div>
      ))}
      <div className="db-fgroup__actions">
        <button type="button" className="btn btn--ghost btn--sm" onClick={(e) => setAddAnchor(e.currentTarget)}>
          <Plus size={13} /> {labels?.addRule ?? t('database.filter.addRule')}
        </button>
        {depth === 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => onChange({ ...group, items: [...group.items, { ...emptyGroup(), op: group.op === 'and' ? 'or' : 'and' }] })}>
            <Layers size={13} /> {t('database.filter.addGroup')}
          </button>
        )}
        {onRemove && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={onRemove}>
            <Trash size={13} /> {t('database.filter.removeGroup')}
          </button>
        )}
      </div>
      <Menu
        open={!!addAnchor}
        anchor={addAnchor}
        onClose={() => setAddAnchor(null)}
        searchable
        searchPlaceholder={t('database.filter.searchProps')}
        entries={m.db.properties.map((p) => ({ label: p.name, icon: <TypeIcon type={p.type} />, onSelect: () => onChange({ ...group, items: [...group.items, newFilterFor(m, p)] }) }))}
        create={(q) => createEntry(q, (p) => onChange({ ...group, items: [...group.items, newFilterFor(m, p)] }))}
      />
    </div>
  )
}

/** Full filter builder popover. */
export function FilterPopover({ m, anchor, onClose }: { m: DbModel; anchor: Element; onClose: () => void }) {
  const t = useT()
  const view = m.view
  const group = view.filter ?? emptyGroup()
  const save = (g: FilterGroup) => setViewQuery(m.db.id, view.id, { filter: g.items.length ? g : null })
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-end" className="db-filterpop">
      <div className="db-filterpop__head">
        <span className="label">{t('database.filter.title')}</span>
        <span style={{ flex: 1 }} />
        {countFilters(view.filter) > 0 && (
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => save(emptyGroup())}>
            {t('database.filter.clearAll')}
          </button>
        )}
      </div>
      {m.locked && <SessionNote m={m} />}
      <GroupEditor m={m} group={group} depth={0} onChange={save} onDialog={onClose} />
    </Popover>
  )
}

/* ---------------- chips bar ---------------- */

function RulePopover({ m, view, filter, anchor, onClose }: { m: DbModel; view: View; filter: Filter; anchor: Element; onClose: () => void }) {
  const live = view.filter?.items.find((x) => x.id === filter.id) as Filter | undefined
  if (!live) return null
  const save = (f: Filter | null) => {
    const g = currentQuery(m.db.id, view.id).filter
    if (!g) return
    const items = f ? g.items.map((x) => (x.id === f.id ? f : x)) : g.items.filter((x) => x.id !== filter.id)
    setViewQuery(m.db.id, view.id, { filter: items.length ? { ...g, items } : null })
    if (!f) onClose()
  }
  return (
    <Popover open anchor={anchor} onClose={onClose} className="db-filterpop db-filterpop--single">
      <FilterRule m={m} filter={live} onChange={save} onRemove={() => save(null)} onDialog={onClose} />
    </Popover>
  )
}

export function FilterChips({ m, autoOpen, onAutoOpened }: { m: DbModel; autoOpen?: ID | null; onAutoOpened?: () => void }) {
  const [builder, setBuilder] = useState<Element | null>(null)
  const t = useT()
  const view = m.view
  const [open, setOpen] = useState<{ id: ID; el: Element } | null>(null)
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)
  const [sortAnchor, setSortAnchor] = useState<HTMLElement | null>(null)
  const createEntry = usePropertyCreate(m.db)
  const g = view.filter
  const items = g?.items ?? []
  const [pending, setPending] = useState<ID | null>(null)
  const target = pending ?? autoOpen ?? null
  useEffect(() => {
    if (!target) return
    const id = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-chip-id="${target}"]`)
      if (el) setOpen({ id: target, el })
      setPending(null)
      onAutoOpened?.()
    })
    return () => cancelAnimationFrame(id)
  }, [target]) // eslint-disable-line react-hooks/exhaustive-deps
  const addFilter = (p: PropertyDef) => {
    const f = newFilterFor(m, p)
    const base = currentQuery(m.db.id, view.id).filter ?? emptyGroup()
    setViewQuery(m.db.id, view.id, { filter: { ...base, items: [...base.items, f] } })
    setPending(f.id)
  }
  const removeItem = (id: ID) => {
    const rest = items.filter((x) => x.id !== id)
    setViewQuery(m.db.id, view.id, { filter: rest.length ? { ...g!, items: rest } : null })
  }
  const sortCount = view.sorts.length
  // view only: the chips say what the view filters and sorts by, nothing more
  const ro = m.readOnly
  // locked database: this tab's own filters / sorts (model/lock) — say so, offer the saved ones back
  const session = !!useSessionOverlay(m.db.id, view.id)
  if (!items.length && !sortCount && !session) return null
  return (
    <div className="db-chipsbar" role="toolbar" aria-label={t('database.filter.title')}>
      {session && (
        <span className="db-chipsbar__session" title={t('database.lock.sessionOnly')}>
          <Lock size={11} strokeWidth={2} aria-hidden />
          <span>{t('database.lock.notSaved')}</span>
          <button type="button" className="db-panel__link" onClick={() => resetSessionQuery(m.db.id)}>
            {t('database.lock.reset')}
          </button>
        </span>
      )}
      {sortCount > 0 && (
        <span className="db-fchip db-fchip--sort">
          <button type="button" className="db-fchip__main" aria-haspopup="dialog" disabled={ro} onClick={(e) => setSortAnchor(sortAnchor ? null : e.currentTarget)}>
            <ArrowUpDown size={12} />
            <span className="db-fchip__op">{t('database.sort.title')}</span>
            {view.sorts.map((s, i) => (
              <span key={i} className="db-fchip__val">
                {m.propMap.get(s.propertyId)?.name ?? t('database.filter.deletedProp')} {s.direction === 'asc' ? '↑' : '↓'}
              </span>
            ))}
          </button>
          {!ro && (
            <button type="button" className="db-fchip__x" aria-label={t('database.sort.clear')} title={t('database.sort.clear')} onClick={() => setViewQuery(m.db.id, view.id, { sorts: [] })}>
              <X size={12} />
            </button>
          )}
        </span>
      )}
      {sortAnchor && sortCount > 0 && <SortPanel m={m} anchor={sortAnchor} onClose={() => setSortAnchor(null)} />}
      {items.length > 1 && <span className="label db-chipsbar__op">{t(`database.filter.${g!.op}`)}</span>}
      {items.map((it) => {
        if (isGroup(it))
          return (
            <span key={it.id} className="db-fchip">
              <button type="button" className="db-fchip__main" disabled={ro} onClick={(e) => setBuilder(e.currentTarget)}>
                <Layers size={12} />
                <span>{plural(t, 'database.filter.groupChip', countFilters(it))}</span>
              </button>
              {!ro && (
                <button type="button" className="db-fchip__x" aria-label={t('common.remove')} onClick={() => removeItem(it.id)}>
                  <X size={12} />
                </button>
              )}
            </span>
          )
        const prop = m.propMap.get(it.propertyId)
        const val = filterValueText(m, it, t)
        if (!prop)
          // a rule on a property that no longer exists: inert (it filters nothing) — say so, offer removal
          return (
            <span key={it.id} className="db-fchip" data-orphan="true" title={t('database.filter.orphanHint')}>
              <span className="db-fchip__main">
                <span className="db-fchip__prop">{t('database.filter.deletedProp')}</span>
                <span className="db-fchip__op">{t('database.filter.inactive')}</span>
              </span>
              {!ro && (
                <button type="button" className="db-fchip__x" aria-label={t('common.remove')} onClick={() => removeItem(it.id)}>
                  <X size={12} />
                </button>
              )}
            </span>
          )
        return (
          <span key={it.id} className="db-fchip" data-incomplete={!VALUELESS_OPS.includes(it.operator) && !val}>
            <button type="button" data-chip-id={it.id} className="db-fchip__main" disabled={ro} onClick={(e) => setOpen({ id: it.id, el: e.currentTarget })}>
              <TypeIcon type={prop.type} size={12} />
              <span className="db-fchip__prop">{prop.name}</span>
              <span className="db-fchip__op">{t(`database.op.${it.operator}`)}</span>
              {val && <span className="db-fchip__val">{val}</span>}
            </button>
            {!ro && (
              <button type="button" className="db-fchip__x" aria-label={t('common.remove')} onClick={() => removeItem(it.id)}>
                <X size={12} />
              </button>
            )}
          </span>
        )
      })}
      {!ro && (
        <button type="button" className="db-chipsbar__add" onClick={(e) => setAddAnchor(e.currentTarget)}>
          <Plus size={12} /> {t('database.filter.add')}
        </button>
      )}
      <Menu
        open={!!addAnchor}
        anchor={addAnchor}
        onClose={() => setAddAnchor(null)}
        searchable
        searchPlaceholder={t('database.filter.searchProps')}
        entries={m.db.properties.map((p) => ({ label: p.name, icon: <TypeIcon type={p.type} />, onSelect: () => addFilter(p) }))}
        create={(q) => createEntry(q, addFilter)}
      />
      {builder && <FilterPopover m={m} anchor={builder} onClose={() => setBuilder(null)} />}
      {open &&
        (() => {
          const f = items.find((x) => x.id === open.id)
          return f && !isGroup(f) ? <RulePopover m={m} view={view} filter={f} anchor={open.el} onClose={() => setOpen(null)} /> : null
        })()}
    </div>
  )
}

export type { Database }

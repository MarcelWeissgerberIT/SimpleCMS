/**
 * The visual query builder: database → conditions (property · operator by type · value picker),
 * AND / OR and one level of groups → sort → limit → fields. Every change writes the code; the code
 * drives the builder (model.ts round trip). Code it can't show: "Edit as text", the text stays.
 */
import { useEffect, useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../../store/selectors'
import type { Database, Page, PropertyDef } from '../../../store/types'
import { useT } from '../../../i18n'
import { fromCode, isGroup, newQuery, toCode, type BCond, type BGroup, type BOp, type BQuery, type BVal } from './model'

type Kind = 'text' | 'number' | 'select' | 'multi' | 'date' | 'checkbox' | 'files'

function kindOf(p: PropertyDef): Kind {
  switch (p.type) {
    case 'number':
    case 'rating':
    case 'unique_id':
      return 'number'
    case 'select':
    case 'status':
      return 'select'
    case 'multi_select':
    case 'person':
    case 'relation':
      return 'multi'
    case 'date':
    case 'created_time':
    case 'last_edited_time':
      return 'date'
    case 'checkbox':
      return 'checkbox'
    case 'files':
      return 'files'
    default:
      return 'text'
  }
}

export const OPS_BY_KIND: Record<Kind, BOp[]> = {
  text: ['=', '!=', 'contains', 'not_contains', 'starts_with', 'ends_with', 'empty', 'not_empty'],
  number: ['=', '!=', '<', '<=', '>', '>=', 'empty', 'not_empty'],
  select: ['=', '!=', 'empty', 'not_empty'],
  multi: ['contains', 'not_contains', 'empty', 'not_empty'],
  date: ['=', '<', '>', '<=', '>=', 'empty', 'not_empty'],
  checkbox: ['='],
  files: ['empty', 'not_empty'],
}

const noValue = (op: BOp) => op === 'empty' || op === 'not_empty'

/** A first value for a property / operator. */
function defaultValue(p: PropertyDef | undefined, op: BOp): BVal {
  if (noValue(op)) return { kind: 'none' }
  if (!p) return { kind: 'text', v: '' }
  switch (kindOf(p)) {
    case 'number':
      return { kind: 'number', v: 0 }
    case 'date':
      return { kind: 'today', days: 0 }
    case 'checkbox':
      return { kind: 'bool', v: true }
    case 'select':
    case 'multi': {
      if (p.type === 'person') {
        const first = useWorkspace.getState().people[0]
        return first ? { kind: 'person', id: first.id, label: first.name } : { kind: 'me' }
      }
      return { kind: 'text', v: p.options?.[0]?.name ?? '' }
    }
  }
  return { kind: 'text', v: '' }
}

function liveDatabases(): Array<{ db: Database; page: Page }> {
  const { pages, databases } = useWorkspace.getState()
  return Object.values(databases)
    .map((db) => ({ db, page: pages[db.id] }))
    .filter((x): x is { db: Database; page: Page } => !!x.page && !x.page.trashed && !isEffectivelyTrashed(pages, x.page.id) && !inTemplate(pages, x.page.id) && !x.db.system)
    .sort((a, b) => (a.page.title || '').localeCompare(b.page.title || ''))
}

/** The database a query names (by reference id, else by title). */
function dbOf(q: BQuery): Database | null {
  const { databases, pages } = useWorkspace.getState()
  if (q.db.id) return databases[q.db.id] ?? null
  const n = q.db.label.trim().toLowerCase()
  const hits = liveDatabases().filter((x) => x.page.title.trim().toLowerCase() === n)
  return hits.length === 1 ? hits[0].db : (Object.values(databases).find((d) => pages[d.id]?.title.trim().toLowerCase() === n) ?? null)
}

/* ------------------------------------------------------------------ value picker */

function ValuePicker({ prop, op, value, onChange, label }: { prop: PropertyDef | undefined; op: BOp; value: BVal; onChange: (v: BVal) => void; label: string }) {
  const t = useT()
  const people = useWorkspace((s) => s.people)
  const pages = useWorkspace((s) => s.pages)
  const [draft, setDraft] = useState(value.kind === 'number' ? String(value.v) : '')
  useEffect(() => {
    if (value.kind === 'number') setDraft(String(value.v))
  }, [value])
  if (noValue(op)) return <span className="sc-qb__novalue" aria-hidden />
  const kind = prop ? kindOf(prop) : 'text'
  if (kind === 'checkbox')
    return (
      <select className="sc-qb__ctl" aria-label={label} value={value.kind === 'bool' && !value.v ? 'false' : 'true'} onChange={(e) => onChange({ kind: 'bool', v: e.target.value === 'true' })}>
        <option value="true">{t('features.script.qb.checked')}</option>
        <option value="false">{t('features.script.qb.unchecked')}</option>
      </select>
    )
  if (kind === 'date') {
    const mode = value.kind === 'date' ? 'date' : 'today'
    const days = value.kind === 'today' ? value.days : 0
    return (
      <span className="sc-qb__date">
        <select
          className="sc-qb__ctl"
          aria-label={label}
          value={mode === 'date' ? 'date' : days === 0 ? 'today' : days > 0 ? 'plus' : 'minus'}
          onChange={(e) => {
            const v = e.target.value
            if (v === 'date') onChange({ kind: 'date', v: new Date().toISOString().slice(0, 10) })
            else if (v === 'today') onChange({ kind: 'today', days: 0 })
            else onChange({ kind: 'today', days: v === 'plus' ? Math.abs(days) || 3 : -(Math.abs(days) || 7) })
          }}
        >
          <option value="today">{t('features.script.qb.today')}</option>
          <option value="plus">{t('features.script.qb.todayPlus')}</option>
          <option value="minus">{t('features.script.qb.todayMinus')}</option>
          <option value="date">{t('features.script.qb.aDate')}</option>
        </select>
        {mode === 'today' && days !== 0 && (
          <input
            className="sc-qb__ctl sc-qb__num"
            type="number"
            min={1}
            aria-label={t('features.script.qb.days')}
            value={Math.abs(days)}
            onChange={(e) => {
              const n = Math.max(1, Math.round(Number(e.target.value) || 1))
              onChange({ kind: 'today', days: days > 0 ? n : -n })
            }}
          />
        )}
        {mode === 'today' && days !== 0 && <span className="sc-qb__unit label">{t('features.script.qb.daysUnit')}</span>}
        {value.kind === 'date' && <input className="sc-qb__ctl" type="date" aria-label={label} value={value.v} onChange={(e) => e.target.value && onChange({ kind: 'date', v: e.target.value })} />}
      </span>
    )
  }
  if (prop?.type === 'person') {
    const cur = value.kind === 'person' ? value.id : value.kind === 'me' ? '@me' : ''
    return (
      <select
        className="sc-qb__ctl"
        aria-label={label}
        value={cur}
        onChange={(e) => {
          if (e.target.value === '@me') return onChange({ kind: 'me' })
          const p = people.find((x) => x.id === e.target.value)
          if (p) onChange({ kind: 'person', id: p.id, label: p.name })
        }}
      >
        <option value="@me">{t('features.script.qb.me')}</option>
        {people.map((p) => (
          <option key={p.id} value={p.id}>
            {p.name}
          </option>
        ))}
      </select>
    )
  }
  if (prop?.type === 'relation') {
    const rows = Object.values(pages)
      .filter((p) => p.databaseId === prop.relationDatabaseId && !p.trashed)
      .slice(0, 300)
    const cur = value.kind === 'page' ? value.id : ''
    return (
      <select
        className="sc-qb__ctl"
        aria-label={label}
        value={cur}
        onChange={(e) => {
          const p = rows.find((x) => x.id === e.target.value)
          if (p) onChange({ kind: 'page', id: p.id, label: p.title || t('common.untitled') })
        }}
      >
        <option value="" disabled>
          —
        </option>
        {rows.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title || t('common.untitled')}
          </option>
        ))}
      </select>
    )
  }
  if (prop?.options && (kind === 'select' || kind === 'multi')) {
    const cur = value.kind === 'text' ? value.v : ''
    const known = prop.options.some((o) => o.name === cur)
    return (
      <select className="sc-qb__ctl" aria-label={label} value={known ? cur : ''} onChange={(e) => onChange({ kind: 'text', v: e.target.value })}>
        {!known && <option value="">{cur || '—'}</option>}
        {prop.options.map((o) => (
          <option key={o.id} value={o.name}>
            {o.name}
          </option>
        ))}
      </select>
    )
  }
  if (kind === 'number')
    return (
      <input
        className="sc-qb__ctl sc-qb__num"
        inputMode="decimal"
        aria-label={label}
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => {
          const n = Number(draft.replace(',', '.'))
          if (Number.isFinite(n)) onChange({ kind: 'number', v: n })
          else setDraft(value.kind === 'number' ? String(value.v) : '0')
        }}
        onKeyDown={(e) => e.key === 'Enter' && (e.target as HTMLInputElement).blur()}
      />
    )
  return <input className="sc-qb__ctl" aria-label={label} value={value.kind === 'text' ? value.v : ''} onChange={(e) => onChange({ kind: 'text', v: e.target.value })} />
}

/* ------------------------------------------------------------------ conditions */

function CondRow({ db, cond, onChange, onRemove, n }: { db: Database; cond: BCond; onChange: (c: BCond) => void; onRemove: () => void; n: string }) {
  const t = useT()
  const prop = db.properties.find((p) => p.name === cond.prop)
  const ops = prop ? OPS_BY_KIND[kindOf(prop)] : OPS_BY_KIND.text
  return (
    <li className="sc-qb__cond" data-testid="sc-qb-cond">
      <span className="sc-qb__n mono" aria-hidden>
        {n}
      </span>
      <select
        className="sc-qb__ctl"
        aria-label={t('features.script.qb.property')}
        value={prop ? prop.name : ''}
        onChange={(e) => {
          const p = db.properties.find((x) => x.name === e.target.value)
          const op = p ? OPS_BY_KIND[kindOf(p)][0] : '='
          onChange({ prop: e.target.value, op, value: defaultValue(p, op) })
        }}
      >
        {!prop && <option value="">{cond.prop}</option>}
        {db.properties.map((p) => (
          <option key={p.id} value={p.name}>
            {p.name}
          </option>
        ))}
      </select>
      <select
        className="sc-qb__ctl sc-qb__op"
        aria-label={t('features.script.qb.operator')}
        value={cond.op}
        onChange={(e) => {
          const op = e.target.value as BOp
          onChange({ ...cond, op, value: noValue(op) ? { kind: 'none' } : noValue(cond.op) ? defaultValue(prop, op) : cond.value })
        }}
      >
        {(ops.includes(cond.op) ? ops : [cond.op, ...ops]).map((o) => (
          <option key={o} value={o}>
            {t(`features.script.qb.op.${o}`)}
          </option>
        ))}
      </select>
      <ValuePicker prop={prop} op={cond.op} value={cond.value} onChange={(value) => onChange({ ...cond, value })} label={t('features.script.qb.value')} />
      <button type="button" className="sc-qb__x" onClick={onRemove} aria-label={t('features.script.qb.removeCond')}>
        <X size={14} strokeWidth={1.8} aria-hidden />
      </button>
    </li>
  )
}

function OpToggle({ op, onChange, label }: { op: 'and' | 'or'; onChange: (op: 'and' | 'or') => void; label: string }) {
  const t = useT()
  return (
    <span className="sc-seg" role="group" aria-label={label}>
      {(['and', 'or'] as const).map((o) => (
        <button key={o} type="button" className={`sc-seg__b${op === o ? ' is-on' : ''}`} aria-pressed={op === o} onClick={() => onChange(o)}>
          {t(`features.script.qb.${o}`)}
        </button>
      ))}
    </span>
  )
}

function GroupBox({ db, group, onChange, depth, path }: { db: Database; group: BGroup; onChange: (g: BGroup | null) => void; depth: number; path: string }) {
  const t = useT()
  const first = db.properties.find((p) => p.type !== 'title') ?? db.properties[0]
  const addCond = () => {
    const op = first ? OPS_BY_KIND[kindOf(first)][0] : '='
    onChange({ ...group, items: [...group.items, { prop: first?.name ?? '', op, value: defaultValue(first, op) }] })
  }
  const set = (i: number, x: BCond | BGroup | null) => {
    const items = [...group.items]
    if (x === null) items.splice(i, 1)
    else items[i] = x
    onChange(depth > 0 && !items.length ? null : { ...group, items })
  }
  return (
    <div className={`sc-qb__group${depth ? ' sc-qb__group--nested' : ''}`}>
      {group.items.length > 1 && (
        <div className="sc-qb__grouphead">
          <span className="label">{t('features.script.qb.match')}</span>
          <OpToggle op={group.op} onChange={(op) => onChange({ ...group, op })} label={t('features.script.qb.match')} />
        </div>
      )}
      <ul className="sc-qb__conds">
        {group.items.map((x, i) =>
          isGroup(x) ? (
            <li key={`g${i}`} className="sc-qb__sub">
              <GroupBox db={db} group={x} depth={depth + 1} path={`${path}${i + 1}.`} onChange={(g) => set(i, g)} />
            </li>
          ) : (
            <CondRow key={`c${i}`} n={`${path}${i + 1}`} db={db} cond={x} onChange={(c) => set(i, c)} onRemove={() => set(i, null)} />
          ),
        )}
      </ul>
      <div className="sc-qb__adds">
        <button type="button" className="btn btn--ghost btn--sm" onClick={addCond}>
          <Plus size={13} strokeWidth={1.8} aria-hidden /> {t('features.script.qb.addCond')}
        </button>
        {depth === 0 && (
          <button
            type="button"
            className="btn btn--ghost btn--sm"
            onClick={() => {
              const op = first ? OPS_BY_KIND[kindOf(first)][0] : '='
              onChange({ ...group, items: [...group.items, { op: group.op === 'and' ? 'or' : 'and', items: [{ prop: first?.name ?? '', op, value: defaultValue(first, op) }] }] })
            }}
          >
            <Plus size={13} strokeWidth={1.8} aria-hidden /> {t('features.script.qb.addGroup')}
          </button>
        )}
      </div>
    </div>
  )
}

/* ------------------------------------------------------------------ the builder */

export function Builder({ code, onChange, onEditAsText }: { code: string; onChange: (code: string) => void; onEditAsText: () => void }) {
  const t = useT()
  const model = useMemo(() => (code.trim() ? fromCode(code) : null), [code])
  const databases = useWorkspace((s) => s.databases)
  const titles = useWorkspace((s) => s.pages)
  const dbs = useMemo(() => liveDatabases(), [databases, titles]) // eslint-disable-line react-hooks/exhaustive-deps
  const write = (q: BQuery) => onChange(toCode(q))
  const db = model ? dbOf(model) : null

  if (code.trim() && !model)
    return (
      <section className="sc-qb sc-qb--off" aria-label={t('features.script.qb.title')} data-testid="sc-qb-unsupported">
        <h2 className="sc-pane__head label">{t('features.script.qb.title')}</h2>
        <p className="sc-qb__lead">{t('features.script.qb.unsupported')}</p>
        <button type="button" className="btn btn--sm" onClick={onEditAsText}>
          {t('features.script.qb.editAsText')}
        </button>
      </section>
    )

  return (
    <section className="sc-qb" aria-label={t('features.script.qb.title')} data-testid="sc-qb">
      <h2 className="sc-pane__head label">{t('features.script.qb.title')}</h2>
      <div className="sc-qb__step">
        <span className="sc-qb__label label">{t('features.script.qb.database')}</span>
        <select
          className="sc-qb__ctl sc-qb__db"
          aria-label={t('features.script.qb.database')}
          value={db?.id ?? ''}
          onChange={(e) => {
            const pick = dbs.find((x) => x.db.id === e.target.value)
            if (!pick) return
            write(model && model.db.id === pick.db.id ? model : { ...newQuery(pick.db.id, pick.page.title || t('common.untitled')), head: model?.head ?? '' })
          }}
        >
          <option value="" disabled>
            {t('features.script.qb.pickDb')}
          </option>
          {dbs.map((x) => (
            <option key={x.db.id} value={x.db.id}>
              {x.page.title || t('common.untitled')}
            </option>
          ))}
        </select>
      </div>
      {model && db && (
        <>
          <div className="sc-qb__step sc-qb__step--block">
            <span className="sc-qb__label label">{t('features.script.qb.where')}</span>
            <GroupBox db={db} group={model.where} depth={0} path="" onChange={(g) => write({ ...model, where: g ?? { op: 'and', items: [] } })} />
          </div>
          <div className="sc-qb__step sc-qb__step--block">
            <span className="sc-qb__label label">{t('features.script.qb.sort')}</span>
            <ul className="sc-qb__conds">
              {model.sort.map((s, i) => (
                <li key={i} className="sc-qb__cond" data-testid="sc-qb-sort">
                  <span className="sc-qb__n mono" aria-hidden>
                    {i + 1}
                  </span>
                  <select
                    className="sc-qb__ctl"
                    aria-label={t('features.script.qb.property')}
                    value={s.prop}
                    onChange={(e) => write({ ...model, sort: model.sort.map((x, j) => (j === i ? { ...x, prop: e.target.value } : x)) })}
                  >
                    {!db.properties.some((p) => p.name === s.prop) && <option value={s.prop}>{s.prop}</option>}
                    {db.properties.map((p) => (
                      <option key={p.id} value={p.name}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                  <span className="sc-seg" role="group" aria-label={t('features.script.qb.direction')}>
                    {([false, true] as const).map((desc) => (
                      <button key={String(desc)} type="button" className={`sc-seg__b${s.desc === desc ? ' is-on' : ''}`} aria-pressed={s.desc === desc} onClick={() => write({ ...model, sort: model.sort.map((x, j) => (j === i ? { ...x, desc } : x)) })}>
                        {t(desc ? 'features.script.qb.desc' : 'features.script.qb.asc')}
                      </button>
                    ))}
                  </span>
                  <button type="button" className="sc-qb__x" onClick={() => write({ ...model, sort: model.sort.filter((_, j) => j !== i) })} aria-label={t('features.script.qb.removeSort')}>
                    <X size={14} strokeWidth={1.8} aria-hidden />
                  </button>
                </li>
              ))}
            </ul>
            <div className="sc-qb__adds">
              <button
                type="button"
                className="btn btn--ghost btn--sm"
                onClick={() => {
                  const used = new Set(model.sort.map((s) => s.prop))
                  const p = db.properties.find((x) => !used.has(x.name) && x.type === 'date') ?? db.properties.find((x) => !used.has(x.name))
                  if (p) write({ ...model, sort: [...model.sort, { prop: p.name, desc: false }] })
                }}
              >
                <Plus size={13} strokeWidth={1.8} aria-hidden /> {t('features.script.qb.addSort')}
              </button>
            </div>
          </div>
          <div className="sc-qb__step">
            <label className="sc-qb__label label" htmlFor="sc-qb-limit">
              {t('features.script.qb.limit')}
            </label>
            <LimitInput value={model.limit} onChange={(limit) => write({ ...model, limit })} />
          </div>
          <div className="sc-qb__step sc-qb__step--block">
            <span className="sc-qb__label label">{t('features.script.qb.fields')}</span>
            <div className="sc-qb__fields" role="group" aria-label={t('features.script.qb.fields')}>
              {db.properties.map((p) => {
                const on = model.select.includes(p.name)
                return (
                  <button
                    key={p.id}
                    type="button"
                    className={`sc-qb__field${on ? ' is-on' : ''}`}
                    aria-pressed={on}
                    onClick={() => write({ ...model, select: on ? model.select.filter((x) => x !== p.name) : db.properties.filter((x) => x.name === p.name || model.select.includes(x.name)).map((x) => x.name) })}
                  >
                    {p.name}
                  </button>
                )
              })}
            </div>
            <p className="sc-qb__hint">{t('features.script.qb.fieldsHint')}</p>
          </div>
        </>
      )}
      {model && !db && <p className="sc-qb__lead">{t('features.script.qb.noDb', { name: model.db.label })}</p>}
    </section>
  )
}

function LimitInput({ value, onChange }: { value: number | null; onChange: (n: number | null) => void }) {
  const t = useT()
  const [draft, setDraft] = useState(value === null ? '' : String(value))
  useEffect(() => setDraft(value === null ? '' : String(value)), [value])
  const commit = () => {
    const s = draft.trim()
    if (!s) return onChange(null)
    const n = Math.round(Number(s))
    if (Number.isFinite(n) && n >= 0) onChange(n)
    else setDraft(value === null ? '' : String(value))
  }
  return (
    <input
      id="sc-qb-limit"
      className="sc-qb__ctl sc-qb__num"
      inputMode="numeric"
      placeholder={t('features.script.qb.all')}
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => e.key === 'Enter' && commit()}
    />
  )
}

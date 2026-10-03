/**
 * Data brings fields the database doesn't have (meeting action items, CSV columns): one short
 * list, one row per field — create it (editable name + type), or in "map" mode also put it into
 * an existing property, or skip it. Nothing is created until the confirm button; the caller gets
 * what each field became and owns the follow-up (and its undo: dropCreated).
 */
import { useMemo, useState, type ReactNode } from 'react'
import { Lock } from 'lucide-react'
import type { ID, NumberFormat, PropertyDef, PropertyType, SelectOption } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { pageTitle } from '../../store/selectors'
import { Modal } from '../../ui/Modal'
import { Kbd } from '../../ui/controls'
import { useT } from '../../i18n'
import { Select, TypeIcon } from '../parts'
import { useDbReadOnly } from '../readonly'
import { isComputed } from '../model/schema'
import { createPropertiesQuick, creatableTypes, propertyByName, type QuickProperty } from './quick'
import './create.css'

/** Types data can arrive in (computed and relation types are configured, not filled). */
export const DATA_TYPES: PropertyType[] = ['text', 'number', 'select', 'multi_select', 'status', 'date', 'person', 'checkbox', 'rating', 'url', 'email', 'phone', 'files']

export interface PropertySuggestion {
  key: string
  name: string
  type: PropertyType
  /** One mono line under the field, e.g. sample values or "2 action items". */
  detail?: string
  options?: SelectOption[]
  numberFormat?: NumberFormat
  /** Start unchecked ("check") / skipped ("map"). */
  off?: boolean
  /** "map": start on this existing property. */
  mapTo?: ID
  /** The type can't change (shown, not picked). */
  fixedType?: boolean
}

/** What a field became: a property (created or existing) or nothing (skipped). */
export interface SuggestionResult {
  key: string
  prop: PropertyDef | null
  created: boolean
}

export interface CreatePropertiesDialogProps {
  dbId: ID
  suggestions: PropertySuggestion[]
  /** "check": create or leave out (checkbox) · "map": create / use an existing property / skip. Default "check". */
  mode?: 'check' | 'map'
  title: string
  label?: string
  intro?: ReactNode
  /** Extra block under the list (e.g. columns that matched by name). */
  extra?: ReactNode
  /** Types the type pickers offer. Default: DATA_TYPES. */
  types?: PropertyType[]
  confirmLabel: string
  /** A second way on without creating anything (e.g. "Send without"); omitted = only Cancel. */
  skipLabel?: string
  onConfirm: (results: SuggestionResult[]) => void
  onSkip?: () => void
  onClose: () => void
}

type Action = 'create' | 'skip' | `map:${string}`

interface RowState {
  action: Action
  name: string
  type: PropertyType
}

export function CreatePropertiesDialog({ dbId, suggestions, mode = 'check', title, label, intro, extra, types, confirmLabel, skipLabel, onConfirm, onSkip, onClose }: CreatePropertiesDialogProps) {
  const t = useT()
  const db = useWorkspace((s) => s.databases[dbId])
  const dbName = useWorkspace((s) => pageTitle(s.pages[dbId], t('common.untitled')))
  const readOnly = useDbReadOnly()
  const canCreate = !!db && !readOnly && db.locked !== true
  const allowed = useMemo(() => creatableTypes(types ?? DATA_TYPES), [types])
  const [rows, setRows] = useState<Record<string, RowState>>(() =>
    Object.fromEntries(
      suggestions.map((s) => [
        s.key,
        { action: s.mapTo ? (`map:${s.mapTo}` as Action) : s.off || !canCreate ? 'skip' : 'create', name: s.name, type: s.fixedType || allowed.includes(s.type) ? s.type : 'text' },
      ]),
    ),
  )
  const set = (key: string, patch: Partial<RowState>) => setRows((r) => ({ ...r, [key]: { ...r[key], ...patch } }))

  // properties a field can go into: everything that holds typed-in values
  const targets = (db?.properties ?? []).filter((p) => !isComputed(p))
  const toCreate = suggestions.filter((s) => rows[s.key].action === 'create')
  const names = toCreate.map((s) => rows[s.key].name.trim().toLowerCase())
  const problem = (s: PropertySuggestion): string | null => {
    const r = rows[s.key]
    if (r.action !== 'create') return null
    const n = r.name.trim()
    if (!n) return t('database.create.nameMissing')
    if (db && propertyByName(db, n)) return t('database.create.taken', { name: n })
    if (names.filter((x) => x === n.toLowerCase()).length > 1) return t('database.create.twice', { name: n })
    return null
  }
  const blocked = suggestions.some((s) => !!problem(s))

  const confirm = () => {
    if (blocked) return
    const inputs: Array<{ key: string; input: QuickProperty }> = toCreate.map((s) => {
      const r = rows[s.key]
      const keep = r.type === s.type
      return { key: s.key, input: { name: r.name.trim(), type: r.type, ...(keep && s.options ? { options: s.options } : {}), ...(keep && s.numberFormat ? { numberFormat: s.numberFormat } : {}) } }
    })
    const made = canCreate ? createPropertiesQuick(dbId, inputs.map((x) => x.input)) : []
    const byKey = new Map(inputs.map((x, i) => [x.key, made[i] ?? null]))
    const fresh = useWorkspace.getState().databases[dbId]
    onConfirm(
      suggestions.map((s) => {
        const r = rows[s.key]
        if (r.action === 'create') return { key: s.key, prop: byKey.get(s.key) ?? null, created: !!byKey.get(s.key) }
        if (r.action.startsWith('map:')) return { key: s.key, prop: fresh?.properties.find((p) => p.id === r.action.slice(4)) ?? null, created: false }
        return { key: s.key, prop: null, created: false }
      }),
    )
  }

  const actionItems = (): Array<{ value: Action; label: string; icon?: ReactNode }> => [
    ...(canCreate ? [{ value: 'create' as Action, label: t('database.create.asNew') }] : []),
    ...targets.map((p) => ({ value: `map:${p.id}` as Action, label: t('database.create.into', { name: p.name }), icon: <TypeIcon type={p.type} /> })),
    { value: 'skip' as Action, label: t('database.create.skip') },
  ]

  return (
    <Modal
      open
      onClose={onClose}
      label={label ?? t('database.create.labelMany')}
      title={title}
      width={mode === 'map' ? 620 : 520}
      className="dbc dbc--many"
      footer={
        <>
          <span className="label dbc__keys" aria-hidden>
            <Kbd>↵</Kbd> {t('database.create.keyConfirm')} · <Kbd>Esc</Kbd> {t('database.create.keyCancel')}
          </span>
          {skipLabel && onSkip ? (
            <button type="button" className="btn" onClick={onSkip}>
              {skipLabel}
            </button>
          ) : (
            <button type="button" className="btn" onClick={onClose}>
              {t('common.cancel')}
            </button>
          )}
          <button type="button" className="btn btn--primary" data-testid="dbc-confirm" disabled={blocked} onClick={confirm}>
            {confirmLabel}
          </button>
        </>
      }
    >
      {intro && <p className="dbc__intro">{intro}</p>}
      {!canCreate && (
        <p className="dbc__note dbc__note--lock" role="note">
          <Lock size={12} strokeWidth={2} aria-hidden /> {readOnly ? t('database.viewOnlyHint') : t('database.create.lockedMany', { db: dbName })}
        </p>
      )}
      <ol className="dbc__list" data-mode={mode}>
        {suggestions.map((s, i) => {
          const r = rows[s.key]
          const err = problem(s)
          const on = r.action === 'create'
          return (
            <li key={s.key} className="dbc__item" data-action={r.action === 'create' || r.action === 'skip' ? r.action : 'map'}>
              <span className="dbc__num label" aria-hidden>
                {String(i + 1).padStart(2, '0')}
              </span>
              {mode === 'check' ? (
                <input
                  type="checkbox"
                  className="dbc__check"
                  checked={on}
                  disabled={!canCreate}
                  aria-label={t('database.create.include', { name: r.name || s.name })}
                  onChange={(e) => set(s.key, { action: e.target.checked ? 'create' : 'skip' })}
                />
              ) : (
                <span className="dbc__field">
                  <span className="dbc__fieldname">{s.name}</span>
                  {s.detail && <span className="dbc__detail label">{s.detail}</span>}
                </span>
              )}
              <span className="dbc__controls">
                {mode === 'map' && (
                  <Select<Action>
                    value={r.action}
                    className="dbc__action"
                    searchable={targets.length > 6}
                    ariaLabel={t('database.create.actionFor', { name: s.name })}
                    items={actionItems()}
                    onChange={(v) => set(s.key, { action: v })}
                  />
                )}
                {(mode === 'check' || on) && (
                  <>
                    <input
                      className="input dbc__name"
                      value={r.name}
                      maxLength={120}
                      disabled={!on}
                      aria-label={t('database.create.nameFor', { name: s.name })}
                      aria-invalid={!!err || undefined}
                      onChange={(e) => set(s.key, { name: e.target.value })}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
                          e.preventDefault()
                          confirm()
                        }
                      }}
                    />
                    {s.fixedType ? (
                      <span className="dbc__typeplate" data-off={!on || undefined}>
                        <TypeIcon type={r.type} size={13} />
                        {t(`database.type.${r.type}`)}
                      </span>
                    ) : (
                      <Select
                        value={r.type}
                        className="dbc__type"
                        disabled={!on}
                        searchable
                        ariaLabel={t('database.create.typeFor', { name: s.name })}
                        items={allowed.map((x) => ({ value: x, label: t(`database.type.${x}`), icon: <TypeIcon type={x} /> }))}
                        onChange={(v) => set(s.key, { type: v })}
                      />
                    )}
                  </>
                )}
              </span>
              {mode === 'check' && s.detail && <span className="dbc__detail label">{s.detail}</span>}
              {err && (
                <span className="dbc__note dbc__note--error dbc__err" role="alert">
                  {err}
                </span>
              )}
            </li>
          )
        })}
      </ol>
      {extra}
    </Modal>
  )
}

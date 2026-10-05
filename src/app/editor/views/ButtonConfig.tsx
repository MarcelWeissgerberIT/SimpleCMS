/**
 * Button configuration — a spec sheet in a modal: label, style, and the ordered action list.
 * Edits stay in a draft and are written to the node once, when the sheet closes.
 */
import { useId, useMemo, useRef, useState, type ReactNode } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import { ArrowDown, ArrowUp, ChevronDown, ExternalLink, FilePlus2, ListPlus, MessageSquare, PencilLine, Plus, SquareCode, Trash2, Webhook, X, type LucideIcon } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { Switch } from '../../ui/controls'
import { PageIcon } from '../../ui/PageIcon'
import { useWorkspace } from '../../store/store'
import { pageTitle, sortPages } from '../../store/selectors'
import type { Database, PropertyDef, PropertyValue } from '../../store/types'
import { tagStyle } from '../../lib/colors'
import { useT } from '../../i18n'
import { ACTION_TYPES, BUTTON_VARIANTS, newAction, type ButtonAction, type ButtonActionType, type ButtonVariant, type PropertyPreset } from '../schema/button'
import { cleanTemplate, SETTABLE_TYPES, VARIABLES } from '../lib/buttonRun'
import { livePages } from '../lib/livePages'
import { TemplateEditor } from './ButtonTemplate'
// the action list is also shown outside a button (database commands): its styles come along
import './button.css'

export interface ButtonDraft {
  label: string
  variant: ButtonVariant
  actions: ButtonAction[]
}

type Act<T extends ButtonActionType> = Extract<ButtonAction, { type: T }>

const ACTION_ICON: Record<ButtonActionType, LucideIcon> = {
  insert_blocks: ListPlus,
  add_page: FilePlus2,
  edit_properties: PencilLine,
  webhook: Webhook,
  open: ExternalLink,
  message: MessageSquare,
  run_script: SquareCode,
}

const TYPE_GLYPH: Partial<Record<PropertyDef['type'], string>> = {
  text: '¶',
  number: '#',
  select: '◉',
  status: '◐',
  date: '▦',
  checkbox: '☑',
  url: '↗',
  email: '✉',
  phone: '☏',
}

const pad2 = (n: number) => String(n).padStart(2, '0')

/** Open/close a menu at its trigger. (useMenu().toggle reads the event inside a state updater, after React released it.) */
const toggleMenu = (menu: ReturnType<typeof useMenu>, el: Element) => (menu.open ? menu.close() : menu.openAt(el))

function finish(d: ButtonDraft, fallback: string): ButtonDraft {
  return {
    label: d.label.trim() || fallback,
    variant: d.variant,
    actions: d.actions.map((a) => (a.type === 'insert_blocks' ? { ...a, content: cleanTemplate(a.content) } : a.type === 'webhook' || a.type === 'open' ? { ...a, url: a.url.trim() } : a)),
  }
}

export function ButtonConfig({ initial, pageId, onDone }: { initial: ButtonDraft; pageId: string | null; onDone: (next: ButtonDraft) => void }) {
  const t = useT()
  const [draft, setDraft] = useState<ButtonDraft>(initial)
  const latest = useRef(draft)
  latest.current = draft
  const ids = useId()
  const rowDb = useWorkspace((s) => {
    const p = pageId ? s.pages[pageId] : undefined
    return p?.databaseId ? (s.databases[p.databaseId] ?? null) : null
  })
  const close = () => onDone(finish(latest.current, t('editor.button.default')))
  const setActions = (fn: (list: ButtonAction[]) => ButtonAction[]) => setDraft((d) => ({ ...d, actions: fn(d.actions) }))

  return (
    <Modal
      open
      onClose={close}
      label={t('editor.button.section')}
      title={t('editor.button.configure')}
      width={600}
      className="bcfg"
      footer={
        <>
          <span className="bcfg__foot-hint label">
            <kbd className="kbd">esc</kbd> {t('editor.button.saves')}
          </span>
          <button type="button" className="btn btn--ink" onClick={close}>
            {t('common.done')}
          </button>
        </>
      }
    >
      <div className="bcfg__top">
        <div className="bcfg__field bcfg__field--grow">
          <label className="label" htmlFor={`${ids}-label`}>
            {t('editor.button.label')}
          </label>
          <input
            id={`${ids}-label`}
            className="input bcfg__label-input"
            value={draft.label}
            placeholder={t('editor.button.default')}
            maxLength={80}
            data-autofocus=""
            onFocus={(e) => e.currentTarget.select()}
            onChange={(e) => setDraft((d) => ({ ...d, label: e.target.value }))}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                close()
              }
            }}
          />
        </div>
        <div className="bcfg__field">
          <span className="label" id={`${ids}-style`}>
            {t('editor.button.style')}
          </span>
          <div className="bcfg__variants" role="radiogroup" aria-labelledby={`${ids}-style`}>
            {BUTTON_VARIANTS.map((v) => (
              <button key={v} type="button" role="radio" aria-checked={draft.variant === v} className="bcfg__variant" onClick={() => setDraft((d) => ({ ...d, variant: v }))}>
                <span className={`ob-key ob-key--${v} ob-key--mini`} aria-hidden>
                  <span className="ob-key__led" />
                </span>
                <span>{t(`editor.button.variant.${v}`)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <ButtonActionsEditor actions={draft.actions} update={setActions} pageId={pageId} rowDb={rowDb} />
    </Modal>
  )
}

export interface ButtonActionsEditorProps {
  actions: ButtonAction[]
  /** change the list (an updater: several changes in one tick never overwrite each other) */
  update: (fn: (list: ButtonAction[]) => ButtonAction[]) => void
  /** where the actions live (pickers list the pages near it) */
  pageId: string | null
  /** the database whose rows "Edit properties" sets (null: not offered) */
  rowDb: Database | null
  /** the action types offered (default: all) */
  types?: ButtonActionType[]
  /** a new action of a type (default: newAction(type)) */
  create?: (type: ButtonActionType) => ButtonAction
  /** a line under an action's fields, by type */
  notes?: Partial<Record<ButtonActionType, string>>
  /** the webhook payload shown under "Webhook" (default: the button's) */
  payload?: string
}

/** The ordered action list of a button's settings (also the database commands' "Actions" kind, features/commands). */
export function ButtonActionsEditor({ actions, update, pageId, rowDb, types = ACTION_TYPES, create = newAction, notes, payload }: ButtonActionsEditorProps) {
  const t = useT()
  const addMenu = useMenu()
  const move = (i: number, dir: -1 | 1) =>
    update((list) => {
      const next = [...list]
      const [a] = next.splice(i, 1)
      next.splice(i + dir, 0, a)
      return next
    })

  const addEntries: MenuEntry[] = types.map((type) => {
    const Icon = ACTION_ICON[type]
    const unavailable = type === 'edit_properties' && !rowDb
    return {
      label: t(`editor.button.action.${type}`),
      icon: <Icon size={15} strokeWidth={1.7} />,
      disabled: unavailable,
      hint: unavailable ? t('editor.button.onlyRows') : undefined,
      onSelect: () => update((list) => [...list, create(type)]),
    }
  })

  const count = actions.length
  return (
    <>
      <div className="bcfg__head">
        <span className="label">{t('editor.button.actions')}</span>
        <span className="bcfg__rule" aria-hidden />
        <span className="label faint">{pad2(count)}</span>
      </div>

      {count === 0 ? (
        <p className="bcfg__empty">{t('editor.button.emptyHint')}</p>
      ) : (
        <ol className="bcfg__list">
          {actions.map((a, i) => (
            <ActionCard
              key={a.id}
              index={i}
              total={count}
              action={a}
              pageId={pageId}
              rowDb={rowDb}
              note={notes?.[a.type]}
              payload={payload}
              onChange={(next) => update((list) => list.map((x, j) => (j === i ? next : x)))}
              onMove={(dir) => move(i, dir)}
              onRemove={() => update((list) => list.filter((_, j) => j !== i))}
            />
          ))}
        </ol>
      )}
      <button type="button" className="btn btn--sm bcfg__add" onClick={(e) => toggleMenu(addMenu, e.currentTarget)} aria-haspopup="menu" aria-expanded={addMenu.open}>
        <Plus size={13} /> {t('editor.button.add')}
      </button>
      <Menu {...addMenu.props} entries={addEntries} className="bcfg-menu" width={280} />
    </>
  )
}

/* ------------------------------------------------------------------ */
/* One action                                                          */
/* ------------------------------------------------------------------ */

function ActionCard({
  index,
  total,
  action,
  pageId,
  rowDb,
  note,
  payload,
  onChange,
  onMove,
  onRemove,
}: {
  index: number
  total: number
  action: ButtonAction
  pageId: string | null
  rowDb: Database | null
  note?: string
  payload?: string
  onChange: (a: ButtonAction) => void
  onMove: (dir: -1 | 1) => void
  onRemove: () => void
}) {
  const t = useT()
  const Icon = ACTION_ICON[action.type]
  const name = t(`editor.button.action.${action.type}`)
  let body: ReactNode
  switch (action.type) {
    case 'insert_blocks':
      body = <InsertFields action={action} pageId={pageId} onChange={onChange} />
      break
    case 'add_page':
      body = <AddPageFields action={action} pageId={pageId} onChange={onChange} />
      break
    case 'edit_properties':
      body = rowDb ? <PresetList db={rowDb} mode="edit" values={action.values} onChange={(values) => onChange({ ...action, values })} /> : <p className="bcfg__note">{t('editor.button.err.notRow')}</p>
      break
    case 'webhook':
      body = <WebhookFields action={action} payload={payload} onChange={onChange} />
      break
    case 'open':
      body = <OpenFields action={action} pageId={pageId} onChange={onChange} />
      break
    case 'message':
      body = <VarInput label={t('editor.button.message.text')} value={action.text} placeholder={t('editor.button.message.placeholder')} onChange={(text) => onChange({ ...action, text })} />
      break
    case 'run_script':
      body = <ScriptFields action={action} onChange={onChange} />
      break
  }
  return (
    <li className="bcfg-card" aria-label={t('editor.button.actionN', { n: index + 1, name })}>
      <div className="bcfg-card__head">
        <span className="bcfg-card__num">{pad2(index + 1)}</span>
        <Icon size={14} strokeWidth={1.75} aria-hidden />
        <span className="bcfg-card__name">{name}</span>
        <span className="bcfg-card__tools">
          <button type="button" className="icon-btn icon-btn--sm" onClick={() => onMove(-1)} disabled={index === 0} aria-label={t('editor.button.moveUp')} title={t('editor.button.moveUp')}>
            <ArrowUp size={13} />
          </button>
          <button type="button" className="icon-btn icon-btn--sm" onClick={() => onMove(1)} disabled={index === total - 1} aria-label={t('editor.button.moveDown')} title={t('editor.button.moveDown')}>
            <ArrowDown size={13} />
          </button>
          <button type="button" className="icon-btn icon-btn--sm" onClick={onRemove} aria-label={t('editor.button.remove')} title={t('editor.button.remove')}>
            <Trash2 size={13} />
          </button>
        </span>
      </div>
      <div className="bcfg-card__body">
        {body}
        {note && <p className="bcfg__note">{note}</p>}
      </div>
    </li>
  )
}

/* ------------------------------------------------------------------ */
/* Shared field pieces                                                 */
/* ------------------------------------------------------------------ */

function VarChips({ onPick }: { onPick: (v: string) => void }) {
  const t = useT()
  return (
    <div className="bcfg-vars" role="group" aria-label={t('editor.button.vars')}>
      <span className="label">{t('editor.button.vars')}</span>
      {VARIABLES.map((v) => (
        <button key={v} type="button" className="bcfg-vars__chip" onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(v)} title={t('editor.button.vars.insert', { v })}>
          {v}
        </button>
      ))}
    </div>
  )
}

/** Text input with variable chips that insert at the caret. */
function VarInput({ label, value, placeholder, onChange }: { label: string; value: string; placeholder?: string; onChange: (v: string) => void }) {
  const id = useId()
  const ref = useRef<HTMLInputElement>(null)
  const insert = (v: string) => {
    const el = ref.current
    const start = el?.selectionStart ?? value.length
    const end = el?.selectionEnd ?? value.length
    onChange(value.slice(0, start) + v + value.slice(end))
    requestAnimationFrame(() => {
      el?.focus()
      el?.setSelectionRange(start + v.length, start + v.length)
    })
  }
  return (
    <div className="bcfg__field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <input ref={ref} id={id} className="input" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} />
      <VarChips onPick={insert} />
    </div>
  )
}

/** A field-like button that opens a menu. */
function Picker({ label, placeholder, entries, ariaLabel, searchable, searchPlaceholder }: { label: ReactNode; placeholder: string; entries: MenuEntry[]; ariaLabel: string; searchable?: boolean; searchPlaceholder?: string }) {
  const t = useT()
  const menu = useMenu()
  return (
    <>
      <button type="button" className="bcfg-pick" onClick={(e) => toggleMenu(menu, e.currentTarget)} aria-haspopup="menu" aria-expanded={menu.open} aria-label={ariaLabel}>
        <span className="bcfg-pick__label">{label ?? <span className="faint">{placeholder}</span>}</span>
        <ChevronDown size={14} className="faint" aria-hidden />
      </button>
      <Menu {...menu.props} entries={entries} searchable={searchable} searchPlaceholder={searchPlaceholder ?? t('common.search')} emptyLabel={t('editor.slash.empty')} className="bcfg-menu" width={280} />
    </>
  )
}

function Segmented<V extends string>({ label, options, value, onChange }: { label: string; options: Array<{ value: V; label: string }>; value: V | null; onChange: (v: V) => void }) {
  return (
    <div className="bcfg-seg" role="radiogroup" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" role="radio" aria-checked={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Action fields                                                       */
/* ------------------------------------------------------------------ */

function InsertFields({ action, pageId, onChange }: { action: Act<'insert_blocks'>; pageId: string | null; onChange: (a: ButtonAction) => void }) {
  const t = useT()
  const editorRef = useRef<Editor | null>(null)
  const latest = useRef(action)
  latest.current = action
  return (
    <div className="bcfg__field">
      <span className="label">{t('editor.button.blocks')}</span>
      <TemplateEditor
        content={action.content}
        pageId={pageId}
        label={t('editor.button.blocks')}
        onChange={(content: JSONContent[]) => onChange({ ...latest.current, content })}
        onEditor={(ed) => (editorRef.current = ed)}
      />
      <VarChips
        onPick={(v) => {
          const ed = editorRef.current
          if (ed && !ed.isDestroyed) ed.chain().focus().insertContent(v).run()
        }}
      />
      <p className="bcfg__note">{t('editor.button.blocks.hint')}</p>
    </div>
  )
}

function databaseEntries(current: string | null, onPick: (id: string) => void, untitled: string, near: string | null): MenuEntry[] {
  const { pages, databases } = useWorkspace.getState()
  const dbs = sortPages(livePages(pages, near).filter((p) => p.kind === 'database' && databases[p.id]))
  return dbs.map((p) => ({ label: pageTitle(p, untitled), icon: <PageIcon icon={p.icon} kind="database" size={15} />, checked: p.id === current, onSelect: () => onPick(p.id) }))
}

function AddPageFields({ action, pageId, onChange }: { action: Act<'add_page'>; pageId: string | null; onChange: (a: ButtonAction) => void }) {
  const t = useT()
  const db = useWorkspace((s) => (action.databaseId ? (s.databases[action.databaseId] ?? null) : null))
  const dbPage = useWorkspace((s) => (action.databaseId ? s.pages[action.databaseId] : undefined))
  const entries = useMemo(
    () => databaseEntries(action.databaseId, (id) => onChange({ ...action, databaseId: id, values: id === action.databaseId ? action.values : [] }), t('common.untitled'), pageId),
    [action, onChange, t, pageId],
  )
  return (
    <>
      <div className="bcfg__field">
        <span className="label">{t('editor.button.db')}</span>
        <Picker
          ariaLabel={t('editor.button.db')}
          placeholder={t('editor.button.db.pick')}
          searchable
          searchPlaceholder={t('editor.button.db.search')}
          entries={entries.length ? entries : [{ label: t('editor.button.db.none'), disabled: true }]}
          label={
            dbPage && db ? (
              <>
                <PageIcon icon={dbPage.icon} kind="database" size={15} /> {pageTitle(dbPage, t('common.untitled'))}
              </>
            ) : null
          }
        />
      </div>
      <VarInput label={t('editor.button.pageTitle')} value={action.title} placeholder={t('editor.button.pageTitle.placeholder')} onChange={(title) => onChange({ ...action, title })} />
      {db && <PresetList db={db} mode="create" values={action.values} onChange={(values) => onChange({ ...action, values })} />}
      <label className="bcfg__switch">
        <Switch checked={action.open} onChange={(open) => onChange({ ...action, open })} label={t('editor.button.openAfter')} />
        <span>{t('editor.button.openAfter')}</span>
      </label>
    </>
  )
}

const BUTTON_PAYLOAD = `{
  "event": "button_clicked",
  "button": { "label": "…" },
  "page": {
    "id": "…", "title": "…", "url": "…",
    "properties": { "Status": "…" },
    "markdown": "…"
  },
  "timestamp": "…",
  "source": "simplecms-one"
}`

function WebhookFields({ action, payload = BUTTON_PAYLOAD, onChange }: { action: Act<'webhook'>; payload?: string; onChange: (a: ButtonAction) => void }) {
  const t = useT()
  const id = useId()
  const invalid = !!action.url.trim() && !/^https?:\/\/\S+$/i.test(action.url.trim())
  return (
    <>
      <div className="bcfg__field">
        <label className="label" htmlFor={id}>
          {t('editor.button.webhook.url')}
        </label>
        <div className="bcfg__row">
          <Segmented label={t('editor.button.webhook.method')} value={action.method} options={[{ value: 'POST', label: 'POST' }, { value: 'PUT', label: 'PUT' }]} onChange={(method) => onChange({ ...action, method })} />
          <input id={id} className="input bcfg__mono" type="url" inputMode="url" value={action.url} placeholder="https://n8n.example.com/webhook/…" aria-invalid={invalid} onChange={(e) => onChange({ ...action, url: e.target.value })} />
        </div>
        {invalid && <p className="bcfg__note is-error">{t('editor.button.err.url')}</p>}
      </div>
      <details className="bcfg-payload">
        <summary className="label">{t('editor.button.webhook.payload')}</summary>
        <pre>{payload}</pre>
      </details>
    </>
  )
}

function OpenFields({ action, pageId, onChange }: { action: Act<'open'>; pageId: string | null; onChange: (a: ButtonAction) => void }) {
  const t = useT()
  const id = useId()
  const target = useWorkspace((s) => (action.pageId ? s.pages[action.pageId] : undefined))
  const entries = useMemo<MenuEntry[]>(() => {
    const pages = sortPages(livePages(useWorkspace.getState().pages, pageId).filter((p) => p.id !== pageId))
    return pages.map((p) => ({ label: pageTitle(p, t('common.untitled')), icon: <PageIcon icon={p.icon} kind={p.kind} size={15} />, checked: p.id === action.pageId, onSelect: () => onChange({ ...action, pageId: p.id, url: '' }) }))
  }, [action, onChange, pageId, t])
  return (
    <div className="bcfg__field">
      <label className="label" htmlFor={id}>
        {t('editor.button.open.target')}
      </label>
      {action.pageId ? (
        <div className="bcfg-chip">
          <PageIcon icon={target?.icon ?? null} kind={target?.kind ?? 'page'} size={15} />
          <span className="bcfg-chip__title">{target ? pageTitle(target, t('common.untitled')) : t('editor.button.err.pageMissing')}</span>
          <button type="button" className="icon-btn icon-btn--sm" onClick={() => onChange({ ...action, pageId: null })} aria-label={t('editor.button.open.clear')}>
            <X size={13} />
          </button>
        </div>
      ) : (
        <div className="bcfg__row">
          <input id={id} className="input bcfg__mono" value={action.url} placeholder="https://…" onChange={(e) => onChange({ ...action, url: e.target.value })} />
          <Picker ariaLabel={t('editor.button.open.page')} placeholder={t('editor.button.open.page')} searchable entries={entries} label={null} />
        </div>
      )}
    </div>
  )
}

/** "Run script": one of the workspace's saved scripts (features/script), run for this page. */
function ScriptFields({ action, onChange }: { action: Act<'run_script'>; onChange: (a: ButtonAction) => void }) {
  const t = useT()
  const scripts = useWorkspace((s) => s.scripts)
  const list = useMemo(() => Object.values(scripts ?? {}).filter((x) => x.kind === 'script').sort((a, b) => a.name.localeCompare(b.name)), [scripts])
  const cur = action.scriptId ? scripts?.[action.scriptId] : undefined
  const entries: MenuEntry[] = list.length
    ? list.map((s) => ({ label: s.name, icon: s.icon ? <PageIcon icon={s.icon} size={15} /> : <SquareCode size={15} strokeWidth={1.7} />, checked: s.id === action.scriptId, onSelect: () => onChange({ ...action, scriptId: s.id }) }))
    : [{ label: t('editor.button.script.none'), disabled: true }]
  return (
    <div className="bcfg__field">
      <span className="label">{t('editor.button.script.label')}</span>
      <Picker
        ariaLabel={t('editor.button.script.label')}
        placeholder={t('editor.button.script.pick')}
        searchable={list.length > 6}
        entries={entries}
        label={cur ? cur.name : action.scriptId ? <span className="faint">{t('editor.button.err.scriptMissing')}</span> : null}
      />
      <p className="bcfg__note">{t('editor.button.script.hint')}</p>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Property presets                                                    */
/* ------------------------------------------------------------------ */

function defaultValue(prop: PropertyDef, mode: 'create' | 'edit'): PropertyValue {
  switch (prop.type) {
    case 'select':
    case 'status':
      return prop.options?.[0]?.id ?? null
    case 'checkbox':
      return mode === 'edit' ? '@toggle' : true
    case 'date':
      return '@today'
    case 'number':
      return null
    default:
      return ''
  }
}

function PresetList({ db, mode, values, onChange }: { db: Database; mode: 'create' | 'edit'; values: PropertyPreset[]; onChange: (v: PropertyPreset[]) => void }) {
  const t = useT()
  const settable = db.properties.filter((p) => SETTABLE_TYPES.has(p.type))
  const free = settable.filter((p) => !values.some((v) => v.propertyId === p.id))
  const menu = useMenu()
  const entries: MenuEntry[] = free.length
    ? free.map((p) => ({ label: p.name, icon: <span className="bcfg-glyph" aria-hidden>{TYPE_GLYPH[p.type] ?? '·'}</span>, onSelect: () => onChange([...values, { propertyId: p.id, value: defaultValue(p, mode) }]) }))
    : [{ label: t('editor.button.noProps'), disabled: true }]
  return (
    <div className="bcfg__field">
      <span className="label">{t(mode === 'edit' ? 'editor.button.setValues' : 'editor.button.values')}</span>
      {values.length > 0 && (
        <ul className="bcfg-presets">
          {values.map((v, i) => {
            const prop = db.properties.find((p) => p.id === v.propertyId)
            return (
              <li key={v.propertyId} className="bcfg-preset">
                <span className="bcfg-preset__prop" title={prop?.name}>
                  <span className="bcfg-glyph" aria-hidden>{prop ? (TYPE_GLYPH[prop.type] ?? '·') : '?'}</span>
                  <span className="bcfg-preset__name">{prop?.name ?? t('editor.button.err.prop')}</span>
                </span>
                <span className="bcfg-preset__value">{prop && <PresetValue prop={prop} mode={mode} value={v.value} onChange={(value) => onChange(values.map((x, j) => (j === i ? { ...x, value } : x)))} />}</span>
                <button type="button" className="icon-btn icon-btn--sm" onClick={() => onChange(values.filter((_, j) => j !== i))} aria-label={t('editor.button.removeValue', { name: prop?.name ?? '' })}>
                  <X size={13} />
                </button>
              </li>
            )
          })}
        </ul>
      )}
      <button type="button" className="btn btn--ghost btn--sm bcfg__add-value" onClick={(e) => toggleMenu(menu, e.currentTarget)} aria-haspopup="menu" aria-expanded={menu.open}>
        <Plus size={13} /> {t('editor.button.addValue')}
      </button>
      <Menu {...menu.props} entries={entries} className="bcfg-menu" width={240} />
    </div>
  )
}

function PresetValue({ prop, mode, value, onChange }: { prop: PropertyDef; mode: 'create' | 'edit'; value: PropertyValue; onChange: (v: PropertyValue) => void }) {
  const t = useT()
  const aria = t('editor.button.valueOf', { name: prop.name })
  if (prop.type === 'select' || prop.type === 'status') {
    const current = prop.options?.find((o) => o.id === value)
    return (
      <Picker
        ariaLabel={aria}
        placeholder={t('editor.button.value.pick')}
        entries={[
          ...(prop.options ?? []).map((o) => ({ label: o.name, icon: <span className="bcfg-swatch" style={tagStyle(o.color)} aria-hidden />, checked: o.id === value, onSelect: () => onChange(o.id) })),
          { kind: 'separator' as const },
          { label: t('editor.button.value.empty'), checked: !value, onSelect: () => onChange(null) },
        ]}
        label={
          current ? (
            <span className="tag" style={tagStyle(current.color)}>
              {current.name}
            </span>
          ) : value === null ? (
            <span className="faint">{t('editor.button.value.empty')}</span>
          ) : null
        }
      />
    )
  }
  if (prop.type === 'checkbox') {
    const options: Array<{ value: string; label: string }> = [
      { value: 'true', label: t('editor.button.value.checked') },
      { value: 'false', label: t('editor.button.value.unchecked') },
      ...(mode === 'edit' ? [{ value: '@toggle', label: t('editor.button.value.toggle') }] : []),
    ]
    return <Segmented label={aria} value={value === '@toggle' ? '@toggle' : String(!!value)} options={options} onChange={(v) => onChange(v === '@toggle' ? '@toggle' : v === 'true')} />
  }
  if (prop.type === 'date') {
    const mode2 = value === '@today' || value === '@now' ? value : value && typeof value === 'object' && !Array.isArray(value) ? 'date' : 'empty'
    const fixed = value && typeof value === 'object' && !Array.isArray(value) ? value.start.slice(0, 10) : ''
    const today = new Date()
    const iso = `${today.getFullYear()}-${pad2(today.getMonth() + 1)}-${pad2(today.getDate())}`
    return (
      <span className="bcfg__row">
        <Segmented
          label={aria}
          value={mode2}
          options={[
            { value: '@today', label: t('editor.button.value.today') },
            { value: '@now', label: t('editor.button.value.now') },
            { value: 'date', label: t('editor.button.value.date') },
            { value: 'empty', label: t('editor.button.value.empty') },
          ]}
          onChange={(v) => onChange(v === 'date' ? { start: fixed || iso } : v === 'empty' ? null : v)}
        />
        {mode2 === 'date' && <input className="input bcfg__date" type="date" value={fixed} aria-label={aria} onChange={(e) => e.target.value && onChange({ start: e.target.value })} />}
      </span>
    )
  }
  if (prop.type === 'number') {
    return <input className="input" type="number" value={typeof value === 'number' ? value : ''} aria-label={aria} onChange={(e) => onChange(e.target.value === '' ? null : Number(e.target.value))} />
  }
  return <input className="input" value={typeof value === 'string' ? value : ''} aria-label={aria} placeholder={t('editor.button.value.text')} onChange={(e) => onChange(e.target.value)} />
}

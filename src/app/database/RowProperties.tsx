/**
 * Property panel shown under a row page's title: icon + name + value editor per property,
 * "Add a property", hide-empty toggle. Keyboard: ↑↓ between rows, Enter edits.
 */
import { useMemo, useRef, useState } from 'react'
import { ChevronDown, ChevronUp, Plus } from 'lucide-react'
import type { Database, ID, Page, PropertyDef, PropertyValue } from '../store/types'
import { usePage, useDatabase } from '../store/selectors'
import { useT } from '../i18n'
import { useResolver, useLocalState } from './hooks'
import { ValueView } from './cells/display'
import { ValueEditorBase, canEdit } from './cells/ValueEditor'
import { Menu, TypeIcon, typeEntries } from './parts'
import { PropertyMenu } from './properties/PropertyMenu'
import { writeValue, insertProperty } from './model/actions'
import { isEmptyValue, type Resolver } from './model/resolve'
import { AutofillHost, AutofillRowControl, AutofillTag, autofillOf } from './autofill'
import { useDbReadOnly } from './readonly'
import './database.css'

export function RowProperties({ pageId }: { pageId: ID }) {
  const row = usePage(pageId)
  const db = useDatabase(row?.databaseId)
  if (!row || !db) return null
  return <RowPropertiesInner row={row} db={db} />
}

function RowPropertiesInner({ row, db }: { row: Page; db: Database }) {
  const resolver = useResolver(db.id)
  const [hideEmpty, setHideEmpty] = useLocalState<boolean>(`one.db.hideEmpty.${db.id}`, false)
  const readOnly = useDbReadOnly()
  return (
    <>
      <PropertyRows
        db={db}
        row={row}
        resolver={resolver}
        props={db.properties.filter((p) => p.type !== 'title')}
        getValue={(p) => row.properties[p.id] ?? null}
        onChange={(p, v) => writeValue(db.id, p, row.id, v)}
        hideEmpty={hideEmpty}
        setHideEmpty={setHideEmpty}
        allowAdd={!readOnly}
        autofill
        readOnly={readOnly}
      />
      <AutofillHost />
    </>
  )
}

export interface PropertyRowsProps {
  db: Database
  /** Row (or a synthetic row for templates) used for display + computed values. */
  row: Page
  resolver: Resolver
  props: PropertyDef[]
  getValue: (p: PropertyDef) => PropertyValue
  onChange: (p: PropertyDef, v: PropertyValue) => void
  hideEmpty?: boolean
  setHideEmpty?: (v: boolean) => void
  allowAdd?: boolean
  /** Disable the property menu (templates). */
  noPropMenu?: boolean
  /** A real row: show AI autofill state + "fill" buttons for autofilled properties. */
  autofill?: boolean
  /** View only (a viewer in a team workspace): values read, nothing opens an editor or a menu. */
  readOnly?: boolean
}

export function PropertyRows({ db, row, resolver, props, getValue, onChange, hideEmpty, setHideEmpty, allowAdd, noPropMenu: noMenu, autofill, readOnly }: PropertyRowsProps) {
  const noPropMenu = noMenu || readOnly
  const editable = (p: PropertyDef) => canEdit(p) && !readOnly
  const t = useT()
  const [editing, setEditing] = useState<{ prop: PropertyDef; el: HTMLElement; text?: string } | null>(null)
  const [menu, setMenu] = useState<{ prop: PropertyDef; el: HTMLElement } | null>(null)
  const [addAnchor, setAddAnchor] = useState<HTMLElement | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const values = useMemo(() => new Map(props.map((p) => [p.id, resolver.value(db, p, row)])), [props, resolver, db, row])
  const emptyIds = props.filter((p) => isEmptyValue(p, values.get(p.id)) && p.type !== 'checkbox').map((p) => p.id)
  const shown = hideEmpty ? props.filter((p) => !emptyIds.includes(p.id)) : props

  const open = (p: PropertyDef, el: HTMLElement, text?: string) => {
    if (!editable(p)) return
    if (p.type === 'checkbox') return onChange(p, !(getValue(p) === true))
    setEditing({ prop: p, el, text })
  }

  const focusRow = (i: number) => listRef.current?.querySelectorAll<HTMLElement>('.db-prow__value')[i]?.focus()

  return (
    <div className="db-props" ref={listRef}>
      {shown.map((p, i) => {
        const v = values.get(p.id)
        const empty = isEmptyValue(p, v) && p.type !== 'checkbox'
        const ai = !!autofill && !!autofillOf(p) && !readOnly
        return (
          <div key={p.id} className="db-prow" data-type={p.type} data-ai={ai || undefined}>
            <button
              type="button"
              className="db-prow__name"
              tabIndex={-1}
              disabled={noPropMenu}
              onClick={(e) => setMenu({ prop: p, el: e.currentTarget })}
              title={p.description || p.name}
            >
              <TypeIcon type={p.type} size={14} />
              <span>{p.name}</span>
              {ai && <AutofillTag dbId={db.id} prop={p} />}
            </button>
            <div
              className="db-prow__value"
              tabIndex={0}
              role="button"
              data-readonly={!editable(p)}
              data-editing={editing?.prop.id === p.id}
              onClick={(e) => open(p, e.currentTarget)}
              onKeyDown={(e) => {
                if (e.target !== e.currentTarget) return
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault()
                  open(p, e.currentTarget)
                } else if (e.key === 'ArrowDown') {
                  e.preventDefault()
                  focusRow(i + 1)
                } else if (e.key === 'ArrowUp') {
                  e.preventDefault()
                  focusRow(i - 1)
                } else if ((e.key === 'Backspace' || e.key === 'Delete') && editable(p) && !empty) {
                  e.preventDefault()
                  onChange(p, p.type === 'multi_select' || p.type === 'person' || p.type === 'relation' || p.type === 'files' ? [] : p.type === 'checkbox' ? false : p.type === 'text' || p.type === 'url' || p.type === 'email' || p.type === 'phone' ? '' : null)
                } else if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey && ['text', 'number', 'url', 'email', 'phone'].includes(p.type)) {
                  e.preventDefault()
                  open(p, e.currentTarget, e.key)
                }
              }}
            >
              {empty ? (
                <span className="db-prow__empty">{editable(p) ? t('database.empty') : '—'}</span>
              ) : (
                <ValueView db={db} prop={p} row={row} r={resolver} v={v} variant="panel" interactive={p.type === 'rating' && !readOnly} />
              )}
            </div>
            {ai && <AutofillRowControl dbId={db.id} prop={p} rowId={row.id} />}
          </div>
        )
      })}
      <div className="db-props__foot">
        {allowAdd && (
          <button type="button" className="db-props__btn" onClick={(e) => setAddAnchor(e.currentTarget)}>
            <Plus size={14} /> {t('database.props.addProperty')}
          </button>
        )}
        {setHideEmpty && emptyIds.length > 0 && (
          <button type="button" className="db-props__btn" onClick={() => setHideEmpty(!hideEmpty)}>
            {hideEmpty ? <ChevronDown size={14} /> : <ChevronUp size={14} />}
            {hideEmpty ? t('database.props.showEmpty', { count: emptyIds.length }) : t('database.props.hideEmpty')}
          </button>
        )}
      </div>
      {editing && !readOnly && (
        <ValueEditorBase
          db={db}
          prop={editing.prop}
          value={getValue(editing.prop)}
          onChange={(v) => onChange(editing.prop, v)}
          anchor={editing.el}
          initialText={editing.text}
          minWidth={320}
          rowId={row.id}
          onClose={(reason) => {
            const el = editing.el
            setEditing(null)
            if (reason !== 'outside') requestAnimationFrame(() => el.focus())
          }}
        />
      )}
      {menu && !noPropMenu && <PropertyMenu db={db} view={null} prop={menu.prop} anchor={menu.el} resolver={resolver} onClose={() => setMenu(null)} />}
      <Menu
        open={!!addAnchor}
        anchor={addAnchor}
        onClose={() => setAddAnchor(null)}
        searchable
        entries={typeEntries(t, (type) => {
          const id = insertProperty(db, null, { type, name: t(`database.type.${type}`) })
          requestAnimationFrame(() => {
            const all = listRef.current?.querySelectorAll<HTMLElement>('.db-prow__name')
            const el = all?.[all.length - 1]
            const prop = { id, type, name: t(`database.type.${type}`) } as PropertyDef
            if (el) setMenu({ prop, el })
          })
        })}
      />
    </div>
  )
}

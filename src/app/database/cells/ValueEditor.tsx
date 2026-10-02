/**
 * Opens the right editor for a property value, anchored to an element.
 *  - ValueEditorBase: value + onChange (templates, bulk edit, filters)
 *  - ValueEditor: bound to one or many rows (writes through writeValue)
 */
import { useEffect, useRef } from 'react'
import { useWorkspace } from '../../store/store'
import type { Database, DateValue, Page, PropertyDef, PropertyValue } from '../../store/types'
import { Popover } from '../../ui/Popover'
import { writeValue } from '../model/actions'
import { isReadOnly } from '../model/schema'
import { TextEditor, useEscapeFlag, type DoneReason } from './TextEditor'
import { OptionPicker } from './OptionPicker'
import { DatePicker } from './DatePicker'
import { FilesEditor, PersonPicker, RelationPicker } from './pickers'
import { Rating } from './display'

export const TEXT_EDIT_TYPES = ['title', 'text', 'number', 'url', 'email', 'phone']

export function canEdit(prop: PropertyDef): boolean {
  return !isReadOnly(prop)
}

export interface ValueEditorBaseProps {
  db: Database
  prop: PropertyDef
  value: PropertyValue
  onChange: (v: PropertyValue) => void
  anchor: HTMLElement
  onClose: (reason?: DoneReason) => void
  initialText?: string
  minWidth?: number
}

export function ValueEditorBase({ db, prop, value, onChange, anchor, onClose, initialText, minWidth }: ValueEditorBaseProps) {
  const esc = useEscapeFlag()
  if (!canEdit(prop)) return null
  if (TEXT_EDIT_TYPES.includes(prop.type)) {
    return (
      <TextEditor
        anchor={anchor}
        prop={prop}
        value={value as string | number | null}
        initialText={initialText}
        minWidth={minWidth}
        onCommit={(v, reason) => {
          const changed = prop.type === 'number' ? v !== value : (v ?? '') !== (value ?? '')
          if (changed) onChange(prop.type === 'number' ? v : String(v ?? ''))
          onClose(reason)
        }}
      />
    )
  }
  let body: React.ReactNode = null
  let cls = 'db-pop'
  switch (prop.type) {
    case 'select':
    case 'status':
    case 'multi_select':
      body = <OptionPicker db={db} prop={prop} value={value as string | string[] | null} onChange={onChange} onClose={() => onClose('enter')} initialQuery={initialText} />
      break
    case 'date':
      body = <DatePicker value={(value as DateValue | null) ?? null} onChange={onChange} />
      cls = 'db-pop db-pop--date'
      break
    case 'person':
      body = <PersonPicker value={(value as string[] | null) ?? []} onChange={onChange} onClose={() => onClose('tab')} initialQuery={initialText} />
      break
    case 'relation':
      body = <RelationPicker prop={prop} value={(value as string[] | null) ?? []} onChange={onChange} onClose={() => onClose('tab')} initialQuery={initialText} />
      break
    case 'files':
      body = <FilesEditor value={(value as string[] | null) ?? []} onChange={onChange} />
      break
    case 'rating':
      body = (
        <div className="db-pop__rating">
          <Rating value={(value as number) ?? 0} max={prop.ratingMax ?? 5} size={18} onChange={(n) => onChange(n || null)} />
        </div>
      )
      break
    case 'checkbox':
      return null
  }
  if (!body) return null
  return (
    <Popover open anchor={anchor} onClose={() => onClose(esc.current ? 'escape' : 'outside')} placement="bottom-start" offset={2} className={cls} autoFocus={false}>
      <FocusPrimary />
      {body}
    </Popover>
  )
}

/**
 * Focus the editor's primary field ([data-autofocus]) once mounted. The generic popover focus
 * would pick the first focusable in DOM order — a chip's × in front of the search field.
 */
function FocusPrimary() {
  const ref = useRef<HTMLSpanElement>(null)
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      const root = ref.current?.parentElement
      const el = root?.querySelector<HTMLElement>('[data-autofocus]') ?? root?.querySelector<HTMLElement>('input, textarea, [tabindex="0"]')
      el?.focus({ preventScroll: true })
    })
    return () => cancelAnimationFrame(id)
  }, [])
  return <span ref={ref} hidden />
}

export interface ValueEditorProps {
  db: Database
  prop: PropertyDef
  rows: Page[]
  anchor: HTMLElement
  onClose: (reason?: DoneReason) => void
  initialText?: string
  minWidth?: number
}

export function ValueEditor({ db, prop, rows, anchor, onClose, initialText, minWidth }: ValueEditorProps) {
  const first = rows[0]
  const live = useWorkspace((s) => (first ? s.pages[first.id] : undefined)) ?? first
  if (!first) return null
  const current: PropertyValue = prop.type === 'title' ? live?.title ?? '' : (live?.properties[prop.id] ?? null)
  return (
    <ValueEditorBase
      db={db}
      prop={prop}
      value={current}
      anchor={anchor}
      onClose={onClose}
      initialText={initialText}
      minWidth={minWidth}
      onChange={(v) => {
        for (const r of rows) writeValue(db.id, prop, r.id, v)
      }}
    />
  )
}

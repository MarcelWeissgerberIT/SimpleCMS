/**
 * A free board's card: its record type's colour bar + mark, the title, and the fields of its own type (the
 * ones picked for that type in the view's card settings, else the first 3 non-empty) — "+ Lane" too.
 */
import { memo, useState } from 'react'
import { Plus } from 'lucide-react'
import type { Page, PropertyDef } from '../../../store/types'
import { PageIcon } from '../../../ui/PageIcon'
import { useT } from '../../../i18n'
import type { DbModel } from '../../hooks'
import { ValueView } from '../../cells/display'
import { isEmptyValue } from '../../model/resolve'
import { cardFields, isTypeProp, typeOfRow } from '../../model/recordTypes'
import { TitleInput } from '../cards'
import { TypeMark } from '../../rtype/TypeTag'
import { addLane } from './lanes'
import './free.css'

export const FreeCardBody = memo(function FreeCardBody({ m, row, props, editing, onEditDone }: { m: DbModel; row: Page; props: PropertyDef[]; editing?: boolean; onEditDone?: (cancelled: boolean) => void }) {
  const t = useT()
  const rt = typeOfRow(row, m.kit)
  const fields = cardFields(m.resolver, m.db, m.view, row, props.filter((p) => !isTypeProp(p)))
  const values = fields.map((p) => ({ p, v: m.resolver.value(m.db, p, row) })).filter(({ p, v }) => !isEmptyValue(p, v) || p.type === 'checkbox')
  return (
    <div className="dbc-body fb-card">
      {rt && (
        <div className="fb-card__type">
          <TypeMark rt={rt} size={12} />
          <span className="label">{rt.name}</span>
        </div>
      )}
      <div className="dbc-title">
        {row.icon && <PageIcon icon={row.icon} size={16} />}
        {editing && onEditDone && !m.readOnly ? <TitleInput row={row} onDone={onEditDone} /> : <span className={row.title ? '' : 'is-empty'}>{row.title || t('common.untitled')}</span>}
      </div>
      {values.length > 0 && (
        <dl className="fb-card__fields">
          {values.map(({ p, v }) => (
            <div key={p.id} className="fb-card__field" data-type={p.type}>
              <dt className="label">{p.name}</dt>
              <dd>
                <ValueView db={m.db} prop={p} row={row} r={m.resolver} v={v} variant="card" interactive={!m.readOnly && (p.type === 'checkbox' || p.type === 'rating')} />
              </dd>
            </div>
          ))}
        </dl>
      )}
    </div>
  )
})

/** The record type's colour of a card (for its bar), or null. */
export function cardColor(m: DbModel, row: Page): string | null {
  const rt = typeOfRow(row, m.kit)
  return rt ? `var(--c-${rt.color ?? 'default'}-text)` : null
}

/** "+ Lane" at the end of a free board: a name, Enter adds it. */
export function AddLane({ m, laneId }: { m: DbModel; laneId: string }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const commit = () => {
    if (name.trim()) addLane(m.db.id, laneId, name)
    setName('')
    setOpen(false)
  }
  if (!open)
    return (
      <button type="button" className="fb-addlane" data-testid="fb-add-lane" onClick={() => setOpen(true)}>
        <Plus size={14} /> {t('database.free.addLane')}
      </button>
    )
  return (
    <div className="fb-addlane fb-addlane--open">
      <input
        className="input"
        autoFocus
        value={name}
        placeholder={t('database.free.laneName')}
        aria-label={t('database.free.laneName')}
        onChange={(e) => setName(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          e.stopPropagation()
          if (e.key === 'Enter') commit()
          if (e.key === 'Escape') {
            setName('')
            setOpen(false)
          }
        }}
      />
    </div>
  )
}

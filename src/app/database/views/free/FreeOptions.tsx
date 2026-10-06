/**
 * Layout… of a free board: where its lanes come from (its own options or a shared list — "Lanes from list") and
 * the card fields per record type (default: the first 3 filled ones).
 */
import { useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ID } from '../../../store/types'
import { useWorkspace } from '../../../store/store'
import { useT } from '../../../i18n'
import type { DbModel } from '../../hooks'
import { Menu, Select } from '../../parts'
import { heldTypes, PLAIN_KEY, rowProps } from '../../model/recordTypes'
import { TypeMark } from '../../rtype/TypeTag'
import { bindLanesToList, laneOf } from './lanes'

const OWN = '__own__'

export function FreeOptions({ m }: { m: DbModel }) {
  const t = useT()
  const lane = laneOf(m.db, m.view)
  const lists = Object.values(m.kit?.lists ?? {}).sort((a, b) => a.name.localeCompare(b.name))
  if (!lane) return null
  return (
    <>
      {!m.fixed && (
        <div className="db-cfg__row">
          <span className="label">{t('database.free.lanesFrom')}</span>
          <Select
            value={lane.listId ?? OWN}
            ariaLabel={t('database.free.lanesFrom')}
            items={[{ value: OWN, label: t('database.free.lanesOwn') }, ...lists.map((l) => ({ value: l.id, label: l.name }))]}
            onChange={(v) => bindLanesToList(m.db.id, lane.id, v === OWN ? null : v)}
          />
        </div>
      )}
      <div className="db-panel__sub label">{t('database.free.cardFields')}</div>
      {[...heldTypes(m.db, m.kit).map((rt) => ({ key: rt.id, rt })), { key: PLAIN_KEY, rt: null }].map(({ key, rt }) => (
        <CardFieldsRow key={key} m={m} typeKey={key} label={rt ? rt.name : t('database.free.plainCard')} mark={rt ? <TypeMark rt={rt} size={12} /> : null} />
      ))}
    </>
  )
}

function CardFieldsRow({ m, typeKey, label, mark }: { m: DbModel; typeKey: ID; label: string; mark: React.ReactNode }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const laneId = m.view.groupBy
  // the fields a card of this type can show: its type's and the database's own (not the lane, not the title)
  const fake = { recordType: typeKey === PLAIN_KEY ? null : typeKey }
  const fields = rowProps(m.db.properties, fake).filter((p) => p.type !== 'title' && p.id !== laneId)
  const picked = m.view.typeFields?.[typeKey]
  const save = (ids: ID[] | null) => {
    const next = { ...(m.view.typeFields ?? {}) }
    if (ids) next[typeKey] = ids
    else delete next[typeKey]
    useWorkspace.getState().updateView(m.db.id, m.view.id, { typeFields: next })
  }
  const toggle = (id: ID) => {
    const cur = picked ?? []
    save(cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id])
  }
  return (
    <div className="db-cfg__row">
      <span className="fb-cfgname">
        {mark}
        <span>{label}</span>
      </span>
      <button type="button" className="db-select" disabled={m.fixed} aria-haspopup="menu" aria-label={`${t('database.free.cardFields')}: ${label}`} onClick={(e) => setAnchor(e.currentTarget)}>
        <span className="db-select__label">{picked ? fields.filter((f) => picked.includes(f.id)).map((f) => f.name).join(', ') || '—' : t('database.free.cardFieldsAuto')}</span>
        <ChevronDown size={12} className="db-select__chev" />
      </button>
      <Menu
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        entries={[
          { label: t('database.free.cardFieldsAuto'), checked: !picked, onSelect: () => save(null) },
          { kind: 'separator' },
          ...fields.map((f) => ({ label: f.name, checked: !!picked?.includes(f.id), keepOpen: true, onSelect: () => toggle(f.id) })),
        ]}
      />
    </div>
  )
}

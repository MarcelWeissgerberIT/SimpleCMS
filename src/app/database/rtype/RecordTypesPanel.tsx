/**
 * Database → "Record types": the types this database holds (fields, rows of each, open in #/kit, detach —
 * the properties stay as plain ones), attach one of the workspace's types, a new type (empty or from this
 * database's properties). Locked databases: read only.
 */
import { useState } from 'react'
import { ExternalLink, Lock, Plus, Shapes, Unlink } from 'lucide-react'
import type { ID, PropertyDef } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { Popover } from '../../ui/Popover'
import { useT } from '../../i18n'
import { t as tr } from '../../i18n'
import { Select } from '../parts'
import type { DbModel } from '../hooks'
import { allTypes, detachType, heldTypes, recordTypeHref } from '../model/recordTypes'
import { HelpLink } from '../../help'
import { TypeMark, TypeTag } from './TypeTag'
import { NewTypeDialog } from './NewTypeDialog'
import './rtype.css'

export function RecordTypesPanel({ m, anchor, onClose }: { m: DbModel; anchor: Element; onClose: () => void }) {
  const t = useT()
  const kit = m.kit
  const held = heldTypes(m.db, kit)
  const others = allTypes(kit).filter((rt) => !held.some((h) => h.id === rt.id))
  const [dialog, setDialog] = useState<'new' | 'props' | null>(null)
  const fixed = m.fixed
  const rowsOf = (id: ID) => m.allRows.filter((r) => r.recordType === id).length
  if (dialog) return <NewTypeDialog dbId={m.db.id} fromProps={dialog === 'props'} onClose={() => (setDialog(null), onClose())} />
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-end" className="db-panel rtype-panel" resizable="db-rtypes">
      <div className="db-panel__head">
        <span className="label">{t('database.rtype.panel')}</span>
        <HelpLink id="free-board" />
        <span style={{ flex: 1 }} />
        <span className="label">{held.length}</span>
      </div>
      {m.locked && (
        <p className="rtype-panel__note" role="note">
          <Lock size={12} strokeWidth={2} aria-hidden /> {t('database.rtype.locked')}
        </p>
      )}
      {held.length === 0 && <div className="db-panel__empty label">{t('database.rtype.noneHeld')}</div>}
      <ul className="rtype-panel__list">
        {held.map((rt) => {
          const n = m.db.properties.filter((p) => p.fromType?.id === rt.id).length
          return (
            <li key={rt.id} className="rtype-panel__row" data-testid={`rtype-held-${rt.id}`}>
              <TypeTag rt={rt} />
              <span className="label rtype-panel__meta">{t('database.rtype.meta', { fields: n, rows: rowsOf(rt.id) })}</span>
              <span style={{ flex: 1 }} />
              <a className="icon-btn icon-btn--sm" href={recordTypeHref(rt.id)} title={t('database.rtype.openKit')} aria-label={t('database.rtype.openKit')} onClick={onClose}>
                <ExternalLink size={13} />
              </a>
              {!fixed && (
                <button type="button" className="icon-btn icon-btn--sm" title={t('database.rtype.detach')} aria-label={`${t('database.rtype.detach')}: ${rt.name}`} onClick={() => detachWithUndo(m.db.id, rt.id, rt.name)}>
                  <Unlink size={13} />
                </button>
              )}
            </li>
          )
        })}
      </ul>
      {!fixed && (
        <>
          {others.length > 0 && (
            <div className="db-cfg__row">
              <span className="label">{t('database.rtype.attach')}</span>
              <Select
                value={null}
                placeholder={t('database.rtype.attachPick')}
                ariaLabel={t('database.rtype.attach')}
                items={others.map((rt) => ({ value: rt.id, label: rt.name, icon: <TypeMark rt={rt} /> }))}
                onChange={(id) => useWorkspace.getState().attachRecordType(m.db.id, id)}
              />
            </div>
          )}
          <div className="db-panel__actions rtype-panel__actions">
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDialog('new')}>
              <Plus size={13} /> {t('database.rtype.new')}
            </button>
            {m.db.properties.some((p) => p.type !== 'title' && !p.fromType) && (
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setDialog('props')}>
                <Shapes size={13} /> {t('database.rtype.fromProps')}
              </button>
            )}
          </div>
        </>
      )}
    </Popover>
  )
}

/** Detach a type (properties stay, rows lose the type) — the toast's Undo links everything back. */
export function detachWithUndo(dbId: ID, typeId: ID, name: string): void {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  if (!db) return
  const linked: Array<{ id: ID; from: NonNullable<PropertyDef['fromType']> }> = db.properties.filter((p) => p.fromType?.id === typeId).map((p) => ({ id: p.id, from: { ...p.fromType! } }))
  const rows = Object.values(s.pages).filter((p) => p.databaseId === dbId && p.recordType === typeId).map((p) => p.id)
  if (!detachType(dbId, typeId)) return
  useUI.getState().toast({
    message: tr('database.rtype.detached', { type: name }),
    action: {
      label: tr('common.undo'),
      run: () => {
        const st = useWorkspace.getState()
        if (!st.databases[dbId] || !st.kit?.recordTypes[typeId]) return
        for (const l of linked) if (st.databases[dbId].properties.some((p) => p.id === l.id)) st.updateProperty(dbId, l.id, { fromType: l.from })
        if (!useWorkspace.getState().attachRecordType(dbId, typeId)) return
        for (const id of rows) useWorkspace.getState().setRecordType(id, typeId)
      },
    },
  })
}

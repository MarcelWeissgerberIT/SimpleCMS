/**
 * "New record type…" — a name, a colour and its fields: properties this database already has (they become
 * the type's, linked in place, values kept) and new ones (name + type). The type is created in the
 * workspace's building blocks and attached to the database; the full editor lives in #/kit.
 */
import { useMemo, useState } from 'react'
import { Plus, X } from 'lucide-react'
import { COLOR_NAMES, type ColorName, type ID, type PropertyType } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { RECORD_PROP_TYPES } from '../../store/kit'
import { Modal } from '../../ui/Modal'
import { Kbd } from '../../ui/controls'
import { useT } from '../../i18n'
import { Select, TypeIcon } from '../parts'
import { canTypeProp, createRecordType } from '../model/recordTypes'
import './rtype.css'

interface Field {
  key: number
  name: string
  type: PropertyType
}

const FIELD_TYPES: PropertyType[] = RECORD_PROP_TYPES.filter((x) => x !== 'relation' && x !== 'files')

export function NewTypeDialog({ dbId, onClose, onCreated, fromProps }: { dbId: ID | null; onClose: () => void; onCreated?: (id: ID) => void; fromProps?: boolean }) {
  const t = useT()
  const db = useWorkspace((s) => (dbId ? s.databases[dbId] : undefined))
  const kit = useWorkspace((s) => s.kit)
  const [name, setName] = useState('')
  const [color, setColor] = useState<ColorName>('orange')
  const [picked, setPicked] = useState<Set<ID>>(() => new Set())
  const [fields, setFields] = useState<Field[]>(() => (fromProps ? [] : [{ key: 1, name: '', type: 'text' }]))
  const eligible = useMemo(() => (db ? db.properties.filter(canTypeProp) : []), [db])
  const clean = name.trim()
  const taken = !!clean && Object.values(kit?.recordTypes ?? {}).some((rt) => rt.name.toLowerCase() === clean.toLowerCase())
  const ready = !!clean && !taken
  const submit = () => {
    if (!ready) return
    const id = createRecordType(dbId, { name: clean, color, fromProps: [...picked], fields: fields.filter((f) => f.name.trim()) })
    if (!id) return
    onClose()
    onCreated?.(id)
  }
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.nativeEvent.isComposing) {
      e.preventDefault()
      submit()
    }
  }
  const toggle = (id: ID) =>
    setPicked((cur) => {
      const next = new Set(cur)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })

  return (
    <Modal
      open
      onClose={onClose}
      label={t('database.rtype.dialog.label')}
      title={fromProps ? t('database.rtype.fromProps') : t('database.rtype.dialog.title')}
      width={480}
      className="rtype-dlg"
      footer={
        <>
          <span className="label rtype-dlg__keys" aria-hidden>
            <Kbd>↵</Kbd> {t('database.create.keyCreate')}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" data-testid="rtype-create" disabled={!ready} onClick={submit}>
            {t('database.rtype.dialog.create')}
          </button>
        </>
      }
    >
      <div className="rtype-dlg__form">
        <label className="rtype-dlg__row">
          <span className="label">{t('database.rtype.dialog.name')}</span>
          <input
            className="input"
            data-autofocus=""
            value={name}
            maxLength={80}
            placeholder={t('database.rtype.dialog.namePh')}
            aria-invalid={taken || undefined}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={onEnter}
          />
        </label>
        {taken && <p className="rtype-dlg__err">{t('database.rtype.dialog.taken')}</p>}
        <div className="rtype-dlg__row">
          <span className="label">{t('database.rtype.dialog.color')}</span>
          <div className="rtype-swatches" role="radiogroup" aria-label={t('database.rtype.dialog.color')}>
            {COLOR_NAMES.map((c) => (
              <button
                key={c}
                type="button"
                role="radio"
                aria-checked={color === c}
                aria-label={t(`color.${c}`)}
                title={t(`color.${c}`)}
                className="rtype-swatch"
                style={{ ['--rt' as string]: `var(--c-${c}-text)` }}
                onClick={() => setColor(c)}
              />
            ))}
          </div>
        </div>
        {eligible.length > 0 && (
          <fieldset className="rtype-dlg__set">
            <legend className="label">{t('database.rtype.dialog.fromDb')}</legend>
            <div className="rtype-dlg__props">
              {eligible.map((p) => (
                <label key={p.id} className="rtype-dlg__prop">
                  <input type="checkbox" checked={picked.has(p.id)} onChange={() => toggle(p.id)} />
                  <TypeIcon type={p.type} />
                  <span>{p.name}</span>
                </label>
              ))}
            </div>
          </fieldset>
        )}
        <fieldset className="rtype-dlg__set">
          <legend className="label">{t('database.rtype.dialog.fields')}</legend>
          {fields.map((f, i) => (
            <div key={f.key} className="rtype-dlg__field">
              <input
                className="input"
                value={f.name}
                maxLength={80}
                aria-label={t('database.rtype.dialog.fieldName', { n: i + 1 })}
                placeholder={t('database.rtype.dialog.fieldPh')}
                onChange={(e) => setFields((cur) => cur.map((x) => (x.key === f.key ? { ...x, name: e.target.value } : x)))}
                onKeyDown={onEnter}
              />
              <Select
                value={f.type}
                ariaLabel={t('database.rtype.dialog.fieldType')}
                items={FIELD_TYPES.map((type) => ({ value: type, label: t(`database.type.${type}`), icon: <TypeIcon type={type} /> }))}
                onChange={(type) => setFields((cur) => cur.map((x) => (x.key === f.key ? { ...x, type } : x)))}
              />
              <button type="button" className="icon-btn icon-btn--sm" aria-label={t('common.remove')} onClick={() => setFields((cur) => cur.filter((x) => x.key !== f.key))}>
                <X size={13} />
              </button>
            </div>
          ))}
          <button type="button" className="btn btn--ghost btn--sm" onClick={() => setFields((cur) => [...cur, { key: Date.now(), name: '', type: 'text' }])}>
            <Plus size={13} /> {t('database.rtype.dialog.addField')}
          </button>
        </fieldset>
        <p className="rtype-dlg__hint">{t('database.rtype.dialog.hint')}</p>
      </div>
    </Modal>
  )
}

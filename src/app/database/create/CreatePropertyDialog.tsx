/**
 * The short "create property" dialog: name · type · for relations the target database and the
 * two-way switch with the reverse property's name. Keyboard first: the name field has focus,
 * ↵ creates, Esc cancels. Locked databases (and viewers) get the reason instead of a Create button.
 */
import { useMemo, useState } from 'react'
import { ArrowLeftRight, Lock } from 'lucide-react'
import type { ID, PropertyDef, PropertyType } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed, pageTitle, sortPages } from '../../store/selectors'
import { Modal } from '../../ui/Modal'
import { PageIcon } from '../../ui/PageIcon'
import { Kbd, Switch } from '../../ui/controls'
import { useT } from '../../i18n'
import { Select, TypeIcon } from '../parts'
import { useDbReadOnly } from '../readonly'
import { canCreateProperties, createPropertyQuick, creatableTypes, propertyByName } from './quick'
import { closeCreateProperty, useCreateDialog, useCreateHost } from './state'
import './create.css'

export interface CreatePropertyDialogProps {
  dbId: ID
  /** Prefilled name (default: the target database's name for relations, else the type's name). */
  name?: string
  /** Preselected type (default: relation when a target is given, else text). */
  type?: PropertyType
  /** Types to choose from; a single type is fixed (no type field). Default: every creatable type. */
  types?: PropertyType[]
  /** relation: preselected target database; lockTarget keeps it fixed. */
  relationDatabaseId?: ID
  lockTarget?: boolean
  /** The property was created (and the dialog should close). */
  onCreated: (prop: PropertyDef) => void
  onClose: () => void
}

export function CreatePropertyDialog({ dbId, name: initialName, type: initialType, types, relationDatabaseId, lockTarget, onCreated, onClose }: CreatePropertyDialogProps) {
  const t = useT()
  const untitled = t('common.untitled')
  const db = useWorkspace((s) => s.databases[dbId])
  const pages = useWorkspace((s) => s.pages)
  const databases = useWorkspace((s) => s.databases)
  const readOnly = useDbReadOnly()
  const allowed = useMemo(() => creatableTypes(types), [types])
  const [type, setType] = useState<PropertyType>(initialType ?? (relationDatabaseId ? 'relation' : allowed.includes('text') ? 'text' : allowed[0] ?? 'text'))
  const [target, setTarget] = useState<ID | null>(relationDatabaseId ?? null)
  const targetName = target ? pageTitle(pages[target], untitled) : ''
  const dbName = pageTitle(pages[dbId], untitled)
  const self = target === dbId
  const [name, setName] = useState(initialName ?? (type === 'relation' && target ? targetName : t(`database.type.${type}`)))
  const [nameTouched, setNameTouched] = useState(initialName !== undefined)
  const [twoWay, setTwoWay] = useState(true)
  const [reverse, setReverse] = useState<string | null>(null)

  const locked = !readOnly && db?.locked === true
  const isRelation = type === 'relation'
  const targetEditable = !!target && canCreateProperties(target)
  const reverseName = reverse ?? (self ? t('database.relation.reverseName', { name: name.trim() || t('database.type.relation') }) : dbName)
  const taken = !!db && !!propertyByName(db, name)
  const ready = !!db && !readOnly && !locked && !!name.trim() && !taken && (!isRelation || !!target)

  const targets = useMemo(
    () =>
      sortPages(Object.values(pages).filter((p) => p.kind === 'database' && databases[p.id] && !p.trashed && !isEffectivelyTrashed(pages, p.id))).map((p) => ({
        value: p.id,
        label: pageTitle(p, untitled),
        icon: <PageIcon icon={p.icon} kind="database" size={14} />,
      })),
    [pages, databases, untitled],
  )

  const submit = () => {
    if (!ready) return
    const prop = createPropertyQuick(dbId, {
      name: name.trim(),
      type,
      ...(isRelation && target ? { relation: { databaseId: target, twoWay: twoWay && targetEditable, reverseName: reverseName.trim() } } : {}),
    })
    if (prop) onCreated(prop)
    else onClose()
  }
  const onEnter = (e: React.KeyboardEvent) => {
    if (e.key !== 'Enter' || e.nativeEvent.isComposing) return
    e.preventDefault()
    submit()
  }

  const pickType = (next: PropertyType) => {
    setType(next)
    // an untouched name follows the type (or the relation's target)
    if (!nameTouched) setName(next === 'relation' && target ? targetName : t(`database.type.${next}`))
  }
  const pickTarget = (id: ID) => {
    setTarget(id)
    if (!nameTouched) setName(pageTitle(pages[id], untitled))
  }

  return (
    <Modal
      open
      onClose={onClose}
      label={isRelation ? t('database.create.labelRelation') : t('database.create.label')}
      title={isRelation && target ? t('database.create.relationTitle', { db: targetName }) : t('database.create.title')}
      width={460}
      className="dbc"
      footer={
        <>
          <span className="label dbc__keys" aria-hidden>
            <Kbd>↵</Kbd> {t('database.create.keyCreate')} · <Kbd>Esc</Kbd> {t('database.create.keyCancel')}
          </span>
          <button type="button" className="btn" onClick={onClose}>
            {t('common.cancel')}
          </button>
          <button type="button" className="btn btn--primary" data-testid="dbc-create" disabled={!ready} onClick={submit}>
            {t('database.create.create')}
          </button>
        </>
      }
    >
      {(locked || readOnly) && (
        <p className="dbc__note dbc__note--lock" role="note">
          <Lock size={12} strokeWidth={2} aria-hidden /> {readOnly ? t('database.viewOnlyHint') : t('database.create.locked')}
        </p>
      )}
      <div className="dbc__form">
        <label className="dbc__row">
          <span className="label">{t('database.create.name')}</span>
          <input
            className="input"
            data-autofocus=""
            value={name}
            maxLength={120}
            aria-invalid={taken || undefined}
            onChange={(e) => {
              setName(e.target.value)
              setNameTouched(true)
            }}
            onKeyDown={onEnter}
          />
        </label>
        {taken && (
          <p className="dbc__note dbc__note--error" role="alert">
            {t('database.create.taken', { name: name.trim() })}
          </p>
        )}
        {allowed.length > 1 && (
          <div className="dbc__row">
            <span className="label">{t('database.create.type')}</span>
            <Select
              value={type}
              searchable
              ariaLabel={t('database.create.type')}
              items={allowed.map((x) => ({ value: x, label: t(`database.type.${x}`), icon: <TypeIcon type={x} /> }))}
              onChange={pickType}
            />
          </div>
        )}
        {isRelation && (
          <div className="dbc__row">
            <span className="label">{t('database.create.target')}</span>
            {lockTarget && target ? (
              <span className="dbc__plate">
                <PageIcon icon={pages[target]?.icon} kind="database" size={14} />
                <span>{targetName}</span>
              </span>
            ) : (
              <Select value={target} searchable placeholder={t('database.relation.pickTarget')} ariaLabel={t('database.create.target')} items={targets} onChange={pickTarget} />
            )}
          </div>
        )}
      </div>
      {isRelation && target && (
        <div className="dbc__twoway" data-on={(twoWay && targetEditable) || undefined}>
          <label className="dbc__switchrow">
            <ArrowLeftRight size={14} strokeWidth={1.7} aria-hidden />
            <span className="dbc__switchtext">{t('database.relation.twoWay', { db: targetName })}</span>
            <Switch checked={twoWay && targetEditable} disabled={!targetEditable} label={t('database.relation.twoWay', { db: targetName })} onChange={setTwoWay} />
          </label>
          {twoWay && targetEditable && (
            <label className="dbc__row">
              <span className="label">{t('database.create.reverseName', { db: targetName })}</span>
              <input className="input" value={reverseName} maxLength={120} onChange={(e) => setReverse(e.target.value)} onKeyDown={onEnter} />
            </label>
          )}
          {!targetEditable && <p className="dbc__note">{t('database.create.targetLocked', { db: targetName })}</p>}
          {twoWay && targetEditable && <p className="dbc__note">{self ? t('database.create.twoWaySelf') : t('database.create.twoWayNote', { db: targetName, name: reverseName.trim() || untitled })}</p>}
        </div>
      )}
    </Modal>
  )
}

/** Mount point for the area's create dialog (openCreateProperty). Safe to render more than once. */
export function CreatePropertyHost() {
  const primary = useCreateHost()
  const req = useCreateDialog((s) => s.req)
  if (!primary || !req) return null
  const { key, onCreated, ...rest } = req
  return (
    <CreatePropertyDialog
      key={key}
      {...rest}
      onClose={closeCreateProperty}
      onCreated={(prop) => {
        closeCreateProperty()
        onCreated?.(prop)
      }}
    />
  )
}

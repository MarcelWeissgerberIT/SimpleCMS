/**
 * Property menu (table header / property panel): rename, type-specific settings,
 * change type, sort, filter, hide, insert left/right, duplicate, delete, wrap.
 */
import { useEffect, useRef, useState } from 'react'
import {
  ArrowDownWideNarrow,
  ArrowLeftToLine,
  ArrowRightToLine,
  ArrowUpNarrowWide,
  Copy,
  EyeOff,
  Funnel,
  TextWrap,
  Trash,
  SquareFunction,
  Repeat,
  Lock,
  Blocks,
  RefreshCw,
} from 'lucide-react'
import type { Database, NumberDisplay, NumberFormat, PropertyDef, PropertyType, RollupFn, View } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { templateScope } from '../../store/selectors'
import { Popover } from '../../ui/Popover'
import { MenuList, type MenuEntry } from '../../ui/Menu'
import { Switch } from '../../ui/controls'
import { useT } from '../../i18n'
import { newId } from '../../lib/ids'
import { PageIcon } from '../../ui/PageIcon'
import { OptionsConfig } from './OptionsConfig'
import { FormulaEditor } from './FormulaEditor'
import { Segmented, Select, TypeIcon, typeEntries } from '../parts'
import { changePropertyToOwn, changePropertyType, deletePropertyWithUndo, disableTwoWay, duplicateProperty, enableTwoWay, insertProperty, pairedRelation, rowsOf, twoWayBlocker } from '../model/actions'
import { ROLLUP_FNS, isOptionType, operatorsFor, valueKind } from '../model/schema'
import type { Resolver } from '../model/resolve'
import { AiGlyph, autofillOf, canAutofill, openAutofillPanel } from '../autofill'
import { setViewQuery } from '../model/lock'
import { openKit, ownTypeOf, recomputeProperty } from '../../features'
import { toast } from '../../store/ui'

export interface PropertyMenuProps {
  db: Database
  view: View | null
  prop: PropertyDef
  anchor: Element
  resolver: Resolver
  onClose: () => void
  /** Show table-only items (insert left/right, wrap). */
  tableMode?: boolean
  /** Called after a new property is inserted (to open its menu). */
  onInserted?: (id: string) => void
  /** Called when "Filter" is chosen (toolbar opens a filter for it). */
  onFilter?: (propId: string) => void
  /** Locked database (model/lock): only sorting and filtering (this tab only) — nothing else changes. */
  locked?: boolean
}

export function PropertyMenu({ db, view, prop, anchor, resolver, onClose, tableMode, onInserted, onFilter, locked }: PropertyMenuProps) {
  const t = useT()
  const s = useWorkspace.getState()
  const [name, setName] = useState(prop.name)
  const [formulaOpen, setFormulaOpen] = useState(false)
  const isTitle = prop.type === 'title'

  const commitName = () => {
    const n = name.trim()
    if (n && n !== prop.name && !locked) s.updateProperty(db.id, prop.id, { name: n })
  }

  const setSort = (direction: 'asc' | 'desc') => {
    if (!view) return
    setViewQuery(db.id, view.id, { sorts: [{ propertyId: prop.id, direction }, ...view.sorts.filter((x) => x.propertyId !== prop.id)] })
  }

  const confirmDelete = () => deletePropertyWithUndo(db, prop)

  const entries: MenuEntry[] = []
  if (!isTitle && !locked) {
    entries.push({
      label: t('database.prop.type'),
      icon: <Repeat size={14} />,
      hint: t(`database.type.${prop.type}`),
      submenu: typeEntries(t, (type: PropertyType, def) => (def ? changePropertyToOwn(resolver, db, prop, def) : changePropertyType(resolver, db, prop, type)), prop.type, undefined, { current: prop }),
    })
  }
  // building blocks (features/kit): the own type / shared list behind the property, a value script's recompute
  const own = ownTypeOf(prop)
  const list = prop.listId ? s.kit?.lists[prop.listId] : undefined
  if (own) entries.push({ label: t('features.kit.menu.openType', { name: own.name }), icon: <Blocks size={14} />, onSelect: () => openKit('types', own.id) })
  if (list) entries.push({ label: t('features.kit.menu.editList', { name: list.name }), icon: <Blocks size={14} />, onSelect: () => openKit('lists', list.id) })
  if (own?.scripts?.value)
    entries.push({
      label: t('features.kit.menu.recompute'),
      icon: <RefreshCw size={14} />,
      onSelect: () => void recomputeProperty(db.id, prop.id).then((n) => toast(t('features.kit.menu.recomputed', { n }))),
    })
  if (prop.type === 'formula' && !locked)
    entries.push({ label: t('database.formula.edit'), icon: <SquareFunction size={14} />, onSelect: () => setFormulaOpen(true), keepOpen: true })
  if (canAutofill(prop) && !locked) {
    const ai = autofillOf(prop)
    entries.push({
      label: t('database.autofill.menu'),
      icon: <AiGlyph />,
      hint: ai ? (ai.auto ? t('database.autofill.menuAuto') : t('database.autofill.menuOn')) : undefined,
      keywords: 'ai autofill claude ki',
      onSelect: () => {
        commitName()
        openAutofillPanel(db.id, prop.id)
      },
    })
  }
  if (view) {
    if (entries.length) entries.push({ kind: 'separator' })
    entries.push({ label: t('database.sort.asc'), icon: <ArrowUpNarrowWide size={14} />, onSelect: () => setSort('asc') })
    entries.push({ label: t('database.sort.desc'), icon: <ArrowDownWideNarrow size={14} />, onSelect: () => setSort('desc') })
    entries.push({
      label: t('database.filter.filterBy'),
      icon: <Funnel size={14} />,
      onSelect: () => {
        if (onFilter) return onFilter(prop.id)
        const kind = valueKind(prop.type)
        const op = operatorsFor(kind === 'computed' ? 'text' : kind)[0]
        const filter = view.filter ?? { id: newId(), op: 'and' as const, items: [] }
        setViewQuery(db.id, view.id, { filter: { ...filter, items: [...filter.items, { id: newId(), propertyId: prop.id, operator: op }] } })
      },
    })
    if (!isTitle && !locked)
      entries.push({
        label: t('database.prop.hide'),
        icon: <EyeOff size={14} />,
        onSelect: () => s.updateView(db.id, view.id, { visibleProperties: view.visibleProperties.filter((x) => x !== prop.id) }),
      })
    if (tableMode && !locked)
      entries.push({
        label: t('database.prop.wrap'),
        icon: <TextWrap size={14} />,
        checked: !!view.wrapCells,
        onSelect: () => s.updateView(db.id, view.id, { wrapCells: !view.wrapCells }),
      })
  }
  if (tableMode && view && !locked) {
    entries.push({ kind: 'separator' })
    const ins = (side: 'left' | 'right') => {
      if (isTitle && side === 'left') return
      const id = insertProperty(db, view, { type: 'text', name: t('database.type.text') }, { anchorId: prop.id, side })
      onInserted?.(id)
    }
    if (!isTitle) entries.push({ label: t('database.prop.insertLeft'), icon: <ArrowLeftToLine size={14} />, onSelect: () => ins('left') })
    entries.push({ label: t('database.prop.insertRight'), icon: <ArrowRightToLine size={14} />, onSelect: () => ins('right') })
  }
  if (!isTitle && !locked) {
    entries.push({ kind: 'separator' })
    entries.push({ label: t('database.prop.duplicate'), icon: <Copy size={14} />, onSelect: () => duplicateProperty(db, view, prop) })
    entries.push({ label: t('database.prop.delete'), icon: <Trash size={14} />, danger: true, onSelect: confirmDelete })
  }

  return (
    <>
      <Popover open={!formulaOpen} anchor={anchor} onClose={() => (commitName(), onClose())} placement="bottom-start" className="db-propmenu" aria-label={prop.name}>
        <div className="db-propmenu__head">
          <span className="db-propmenu__icon">
            <TypeIcon type={prop.type} size={15} />
          </span>
          {locked ? (
            <span className="db-propmenu__title">
              <span className="db-propmenu__name">{prop.name}</span>
              <span className="label db-propmenu__locked">
                <Lock size={10} strokeWidth={2.2} aria-hidden /> {t('database.lock.propHint')}
              </span>
            </span>
          ) : (
            <input
              className="input"
              data-autofocus=""
              value={name}
              aria-label={t('database.prop.name')}
              onChange={(e) => setName(e.target.value)}
              onBlur={commitName}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  commitName()
                  onClose()
                }
              }}
            />
          )}
        </div>
        {!locked && <PropertyConfig db={db} prop={prop} onEditFormula={() => setFormulaOpen(true)} />}
        <MenuList entries={entries} onClose={onClose} />
      </Popover>
      {formulaOpen && (
        <FormulaEditor
          db={db}
          prop={useWorkspace.getState().databases[db.id]?.properties.find((p) => p.id === prop.id) ?? prop}
          rows={rowsOf(db.id)}
          resolver={resolver}
          onClose={() => {
            setFormulaOpen(false)
            onClose()
          }}
        />
      )}
    </>
  )
}

/** Type-specific settings block. */
export function PropertyConfig({ db, prop, onEditFormula }: { db: Database; prop: PropertyDef; onEditFormula: () => void }) {
  const t = useT()
  const s = useWorkspace.getState()
  const databases = useWorkspace((st) => st.databases)
  const pages = useWorkspace((st) => st.pages)
  const live = useWorkspace((st) => st.databases[db.id]?.properties.find((p) => p.id === prop.id)) ?? prop
  const upd = (patch: Partial<PropertyDef>) => s.updateProperty(db.id, prop.id, patch)
  // two-way off removes a property on the other database: ask first
  const [confirmOff, setConfirmOff] = useState(false)

  const list = live.listId ? useWorkspace.getState().kit?.lists[live.listId] : undefined
  if (list && (live.type === 'select' || live.type === 'multi_select'))
    return (
      <div className="db-cfg">
        <div className="db-cfg__note">{t('features.kit.menu.fromList', { name: list.name })}</div>
      </div>
    )
  if (isOptionType(live.type)) return <OptionsConfig db={db} prop={live} />

  if (live.type === 'number') {
    const formats: NumberFormat[] = ['number', 'comma', 'percent', 'euro', 'dollar', 'pound']
    const displays: NumberDisplay[] = ['number', 'bar', 'ring']
    return (
      <div className="db-cfg">
        <div className="db-cfg__row">
          <span className="label">{t('database.number.format')}</span>
          <Select value={live.numberFormat ?? 'number'} items={formats.map((f) => ({ value: f, label: t(`database.number.fmt.${f}`) }))} onChange={(v) => upd({ numberFormat: v })} />
        </div>
        <div className="db-cfg__row">
          <span className="label">{t('database.number.showAs')}</span>
          <Segmented value={live.numberDisplay ?? 'number'} items={displays.map((d) => ({ value: d, label: t(`database.number.display.${d}`) }))} onChange={(v) => upd({ numberDisplay: v })} />
        </div>
      </div>
    )
  }

  if (live.type === 'relation') {
    // template databases (features/templates) only from a database of the same template
    const scope = templateScope(pages, db.id)
    const targets = Object.values(databases)
      .map((d) => ({ d, p: pages[d.id] }))
      .filter((x) => x.p && !x.p.trashed && scope(x.d.id))
    const pair = pairedRelation(db.id, live)
    const blocker = twoWayBlocker(db.id, live)
    const target = live.relationDatabaseId ? pages[live.relationDatabaseId] : undefined
    const targetName = target?.title || t('common.untitled')
    return (
      <div className="db-cfg">
        <div className="db-cfg__row">
          <span className="label">{t('database.relation.target')}</span>
          <Select
            value={live.relationDatabaseId ?? null}
            placeholder={t('database.relation.pickTarget')}
            searchable
            items={targets.map((x) => ({ value: x.d.id, label: x.p.title || t('common.untitled'), icon: <PageIcon icon={x.p.icon} kind="database" size={14} /> }))}
            onChange={(v) => {
              setConfirmOff(false)
              upd({ relationDatabaseId: v })
            }}
          />
        </div>
        {target && (
          <label className="db-cfg__row db-cfg__row--switch">
            <span>{t('database.relation.twoWay', { db: targetName })}</span>
            <Switch
              size="sm"
              seed="twoWay"
              checked={!!pair && !confirmOff}
              disabled={!pair && !!blocker}
              label={t('database.relation.twoWay', { db: targetName })}
              onChange={(on) => {
                if (on) {
                  setConfirmOff(false)
                  if (!pair) enableTwoWay(db.id, live)
                } else if (pair) setConfirmOff(true)
              }}
            />
          </label>
        )}
        {pair && confirmOff && (
          <div className="db-cfg__confirm" role="alert">
            <span>{t('database.relation.twoWayOffConfirm', { prop: pair.prop.name, db: targetName })}</span>
            <span className="db-cfg__confirmbtns">
              <button type="button" className="btn btn--ghost btn--sm" onClick={() => setConfirmOff(false)}>
                {t('common.cancel')}
              </button>
              <button
                type="button"
                className="btn btn--sm btn--danger"
                data-autofocus=""
                onClick={() => {
                  setConfirmOff(false)
                  disableTwoWay(db.id, live)
                }}
              >
                {t('database.relation.twoWayOff', { prop: pair.prop.name })}
              </button>
            </span>
          </div>
        )}
        {target && blocker && <div className="db-cfg__note">{t('database.relation.twoWayBlocked', { prop: blocker.name, db: targetName })}</div>}
        {pair && !confirmOff && <div className="db-cfg__note">{t('database.relation.pairedWith', { prop: pair.prop.name, db: targetName })}</div>}
      </div>
    )
  }

  if (live.type === 'rollup') {
    const rels = db.properties.filter((p) => p.type === 'relation')
    const cfg = live.rollup ?? { relationPropertyId: rels[0]?.id ?? '', targetPropertyId: '', fn: 'count' as RollupFn }
    const rel = rels.find((p) => p.id === cfg.relationPropertyId)
    const tdb = rel?.relationDatabaseId ? databases[rel.relationDatabaseId] : undefined
    return (
      <div className="db-cfg">
        {!rels.length && <div className="db-cfg__note">{t('database.rollup.needRelation')}</div>}
        <div className="db-cfg__row">
          <span className="label">{t('database.rollup.relation')}</span>
          <Select
            value={cfg.relationPropertyId || null}
            placeholder={t('database.rollup.pick')}
            items={rels.map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type="relation" /> }))}
            onChange={(v) => upd({ rollup: { ...cfg, relationPropertyId: v, targetPropertyId: '' } })}
          />
        </div>
        <div className="db-cfg__row">
          <span className="label">{t('database.rollup.property')}</span>
          <Select
            value={cfg.targetPropertyId || null}
            placeholder={t('database.rollup.pick')}
            searchable
            items={(tdb?.properties ?? []).map((p) => ({ value: p.id, label: p.name, icon: <TypeIcon type={p.type} /> }))}
            onChange={(v) => upd({ rollup: { ...cfg, targetPropertyId: v } })}
          />
        </div>
        <div className="db-cfg__row">
          <span className="label">{t('database.rollup.calculate')}</span>
          <Select value={cfg.fn} searchable items={ROLLUP_FNS.map((f) => ({ value: f, label: t(`database.calc.${f}`) }))} onChange={(v) => upd({ rollup: { ...cfg, fn: v } })} />
        </div>
      </div>
    )
  }

  if (live.type === 'formula')
    return (
      <div className="db-cfg">
        <button type="button" className="db-cfg__formula" onClick={onEditFormula}>
          <code>{live.formula?.trim() || t('database.formula.emptySource')}</code>
        </button>
      </div>
    )

  if (live.type === 'unique_id')
    return (
      <div className="db-cfg">
        <div className="db-cfg__row">
          <span className="label">{t('database.uid.prefix')}</span>
          <PrefixField value={live.idPrefix ?? ''} onSave={(v) => v !== (live.idPrefix ?? '') && upd({ idPrefix: v })} />
        </div>
      </div>
    )

  if (live.type === 'rating')
    return (
      <div className="db-cfg">
        <div className="db-cfg__row">
          <span className="label">{t('database.rating.max')}</span>
          <Segmented value={String(live.ratingMax ?? 5) as '3' | '5' | '10'} items={(['3', '5', '10'] as const).map((n) => ({ value: n, label: n }))} onChange={(v) => upd({ ratingMax: Number(v) })} />
        </div>
      </div>
    )

  return null
}

/**
 * Unique-ID prefix input. Saves on Enter, blur, and when the menu closes around it (click away / Esc
 * unmount the field before it ever blurs).
 */
function PrefixField({ value, onSave }: { value: string; onSave: (v: string) => void }) {
  const t = useT()
  const draft = useRef<string | null>(null)
  const save = useRef(onSave)
  save.current = onSave
  const flush = () => {
    if (draft.current === null) return
    const v = draft.current.trim().toUpperCase()
    draft.current = null
    save.current(v)
  }
  useEffect(() => flush, [])
  return (
    <input
      className="input db-cfg__input"
      aria-label={t('database.uid.prefix')}
      defaultValue={value}
      placeholder="TASK"
      maxLength={12}
      onChange={(e) => (draft.current = e.target.value)}
      onBlur={flush}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') flush()
      }}
    />
  )
}

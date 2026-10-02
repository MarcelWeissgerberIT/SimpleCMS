/**
 * Property menu (table header / property panel): rename, type-specific settings,
 * change type, sort, filter, hide, insert left/right, duplicate, delete, wrap.
 */
import { useState } from 'react'
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
} from 'lucide-react'
import type { Database, NumberDisplay, NumberFormat, PropertyDef, PropertyType, RollupFn, View } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { Popover } from '../../ui/Popover'
import { MenuList, type MenuEntry } from '../../ui/Menu'
import { Switch } from '../../ui/controls'
import { useT, t as tStatic } from '../../i18n'
import { newId } from '../../lib/ids'
import { PageIcon } from '../../ui/PageIcon'
import { OptionsConfig } from './OptionsConfig'
import { FormulaEditor } from './FormulaEditor'
import { Segmented, Select, TypeIcon, typeEntries } from '../parts'
import { changePropertyType, disableTwoWay, duplicateProperty, enableTwoWay, insertProperty, pairedRelation, rowsOf } from '../model/actions'
import { ROLLUP_FNS, isOptionType, operatorsFor, valueKind } from '../model/schema'
import type { Resolver } from '../model/resolve'

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
}

export function PropertyMenu({ db, view, prop, anchor, resolver, onClose, tableMode, onInserted, onFilter }: PropertyMenuProps) {
  const t = useT()
  const s = useWorkspace.getState()
  const [name, setName] = useState(prop.name)
  const [formulaOpen, setFormulaOpen] = useState(false)
  const isTitle = prop.type === 'title'

  const commitName = () => {
    const n = name.trim()
    if (n && n !== prop.name) s.updateProperty(db.id, prop.id, { name: n })
  }

  const setSort = (direction: 'asc' | 'desc') => {
    if (!view) return
    s.updateView(db.id, view.id, { sorts: [{ propertyId: prop.id, direction }, ...view.sorts.filter((x) => x.propertyId !== prop.id)] })
  }

  const confirmDelete = () => deletePropertyWithUndo(db, prop)

  const entries: MenuEntry[] = []
  if (!isTitle) {
    entries.push({
      label: t('database.prop.type'),
      icon: <Repeat size={14} />,
      hint: t(`database.type.${prop.type}`),
      submenu: typeEntries(t, (type: PropertyType) => changePropertyType(resolver, db, prop, type), prop.type),
    })
  }
  if (prop.type === 'formula')
    entries.push({ label: t('database.formula.edit'), icon: <SquareFunction size={14} />, onSelect: () => setFormulaOpen(true), keepOpen: true })
  if (view) {
    entries.push({ kind: 'separator' })
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
        s.updateView(db.id, view.id, { filter: { ...filter, items: [...filter.items, { id: newId(), propertyId: prop.id, operator: op }] } })
      },
    })
    if (!isTitle)
      entries.push({
        label: t('database.prop.hide'),
        icon: <EyeOff size={14} />,
        onSelect: () => s.updateView(db.id, view.id, { visibleProperties: view.visibleProperties.filter((x) => x !== prop.id) }),
      })
    if (tableMode)
      entries.push({
        label: t('database.prop.wrap'),
        icon: <TextWrap size={14} />,
        checked: !!view.wrapCells,
        onSelect: () => s.updateView(db.id, view.id, { wrapCells: !view.wrapCells }),
      })
  }
  if (tableMode && view) {
    entries.push({ kind: 'separator' })
    const ins = (side: 'left' | 'right') => {
      if (isTitle && side === 'left') return
      const id = insertProperty(db, view, { type: 'text', name: t('database.type.text') }, { anchorId: prop.id, side })
      onInserted?.(id)
    }
    if (!isTitle) entries.push({ label: t('database.prop.insertLeft'), icon: <ArrowLeftToLine size={14} />, onSelect: () => ins('left') })
    entries.push({ label: t('database.prop.insertRight'), icon: <ArrowRightToLine size={14} />, onSelect: () => ins('right') })
  }
  if (!isTitle) {
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
        </div>
        <PropertyConfig db={db} prop={prop} onEditFormula={() => setFormulaOpen(true)} />
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

/** Delete a property; the toast offers undo (restores definition, view placement and values). */
export function deletePropertyWithUndo(db: Database, prop: PropertyDef) {
  const st = useWorkspace.getState()
  const fresh = st.databases[db.id]
  if (!fresh) return
  const index = fresh.properties.findIndex((p) => p.id === prop.id)
  const def: PropertyDef = JSON.parse(JSON.stringify(fresh.properties[index] ?? prop))
  const placement = fresh.views.map((v) => ({ id: v.id, at: v.visibleProperties.indexOf(prop.id) }))
  const values = rowsOf(db.id)
    .filter((r) => r.properties[prop.id] !== undefined)
    .map((r) => [r.id, JSON.parse(JSON.stringify(r.properties[prop.id]))] as const)
  st.deleteProperty(db.id, prop.id)
  useUI.getState().toast({
    message: tStatic('database.prop.deleted', { name: prop.name }),
    action: {
      label: tStatic('common.undo'),
      run: () => {
        const w = useWorkspace.getState()
        w.addProperty(db.id, def, index)
        const d = useWorkspace.getState().databases[db.id]
        for (const { id, at } of placement) {
          const v = d?.views.find((x) => x.id === id)
          if (!v) continue
          const list = v.visibleProperties.filter((x) => x !== prop.id)
          if (at >= 0) list.splice(Math.min(at, list.length), 0, prop.id)
          w.updateView(db.id, id, { visibleProperties: list })
        }
        for (const [rowId, v] of values) w.setRowProperty(rowId, prop.id, v)
      },
    },
  })
}

/** Type-specific settings block. */
export function PropertyConfig({ db, prop, onEditFormula }: { db: Database; prop: PropertyDef; onEditFormula: () => void }) {
  const t = useT()
  const s = useWorkspace.getState()
  const databases = useWorkspace((st) => st.databases)
  const pages = useWorkspace((st) => st.pages)
  const live = useWorkspace((st) => st.databases[db.id]?.properties.find((p) => p.id === prop.id)) ?? prop
  const upd = (patch: Partial<PropertyDef>) => s.updateProperty(db.id, prop.id, patch)

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
    const targets = Object.values(databases)
      .map((d) => ({ d, p: pages[d.id] }))
      .filter((x) => x.p && !x.p.trashed)
    const pair = pairedRelation(db.id, live)
    const target = live.relationDatabaseId ? pages[live.relationDatabaseId] : undefined
    return (
      <div className="db-cfg">
        <div className="db-cfg__row">
          <span className="label">{t('database.relation.target')}</span>
          <Select
            value={live.relationDatabaseId ?? null}
            placeholder={t('database.relation.pickTarget')}
            searchable
            items={targets.map((x) => ({ value: x.d.id, label: x.p.title || t('common.untitled'), icon: <PageIcon icon={x.p.icon} kind="database" size={14} /> }))}
            onChange={(v) => upd({ relationDatabaseId: v })}
          />
        </div>
        {target && (
          <label className="db-cfg__row db-cfg__row--switch">
            <span>{t('database.relation.twoWay', { db: target.title || t('common.untitled') })}</span>
            <Switch checked={!!pair} label={t('database.relation.twoWay', { db: target.title })} onChange={(on) => (on ? enableTwoWay(db.id, live) : disableTwoWay(db.id, live))} />
          </label>
        )}
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
          <input
            className="input db-cfg__input"
            defaultValue={live.idPrefix ?? ''}
            placeholder="TASK"
            maxLength={12}
            onBlur={(e) => upd({ idPrefix: e.target.value.trim().toUpperCase() })}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') (e.target as HTMLInputElement).blur()
            }}
          />
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

/**
 * Option picker for select / multi_select / status: search, pick, create (with colour),
 * rename / recolour / regroup / delete options. Keyboard: ↑↓ Enter, Backspace removes last.
 */
import { useMemo, useRef, useState } from 'react'
import { Check, Ellipsis, Plus, Trash } from 'lucide-react'
import type { ColorName, Database, PropertyDef, SelectOption, StatusGroup } from '../../store/types'
import { COLOR_NAMES } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { Popover } from '../../ui/Popover'
import { useT } from '../../i18n'
import { tagStyle } from '../../lib/colors'
import { OptionTag, StatusTag } from './display'
import { newOption, rowsOf } from '../model/actions'

export const STATUS_GROUPS: StatusGroup[] = ['todo', 'in_progress', 'done']

export function OptionPicker({
  db,
  prop,
  value,
  onChange,
  onClose,
}: {
  db: Database
  prop: PropertyDef
  value: string | string[] | null
  onChange: (v: string | string[] | null) => void
  onClose: () => void
}) {
  const t = useT()
  const multi = prop.type === 'multi_select'
  const isStatus = prop.type === 'status'
  const options = prop.options ?? []
  const selected = multi ? ((value as string[] | null) ?? []) : value ? [value as string] : []
  const [query, setQuery] = useState('')
  const [active, setActive] = useState(0)
  const [edit, setEdit] = useState<{ option: SelectOption; el: HTMLElement } | null>(null)
  const listRef = useRef<HTMLDivElement>(null)

  const q = query.trim().toLowerCase()
  const filtered = useMemo(() => options.filter((o) => !q || o.name.toLowerCase().includes(q)), [options, q])
  const exact = options.some((o) => o.name.toLowerCase() === q)
  const canCreate = !!q && !exact
  const ordered = isStatus ? STATUS_GROUPS.flatMap((g) => filtered.filter((o) => (o.group ?? 'todo') === g)) : filtered
  const itemCount = ordered.length + (canCreate ? 1 : 0)

  const pick = (o: SelectOption) => {
    if (multi) {
      onChange(selected.includes(o.id) ? selected.filter((x) => x !== o.id) : [...selected, o.id])
      setQuery('')
    } else {
      onChange(selected[0] === o.id ? null : o.id)
      onClose()
    }
  }

  const create = () => {
    const name = query.trim()
    if (!name) return
    const opt = newOption(name, options, isStatus ? 'todo' : undefined)
    useWorkspace.getState().updateProperty(db.id, prop.id, { options: [...options, opt] })
    if (multi) onChange([...selected, opt.id])
    else {
      onChange(opt.id)
      onClose()
    }
    setQuery('')
  }

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'ArrowDown') {
      e.preventDefault()
      setActive((a) => Math.min(itemCount - 1, a + 1))
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      setActive((a) => Math.max(0, a - 1))
    } else if (e.key === 'Enter') {
      e.preventDefault()
      if (active < ordered.length) pick(ordered[active])
      else if (canCreate) create()
    } else if (e.key === 'Backspace' && !query && selected.length) {
      if (multi) onChange(selected.slice(0, -1))
      else onChange(null)
    } else if (e.key === 'Tab') {
      e.preventDefault()
      onClose()
    }
  }

  const Tag = isStatus ? StatusTag : OptionTag
  let idx = -1
  const renderOption = (o: SelectOption) => {
    idx++
    const i = idx
    return (
      <div
        key={o.id}
        role="option"
        aria-selected={selected.includes(o.id)}
        data-active={i === active}
        className="db-opt"
        onMouseEnter={() => setActive(i)}
        onClick={() => pick(o)}
      >
        <span className="db-opt__tag">
          <Tag option={o} />
        </span>
        {selected.includes(o.id) && <Check size={14} className="db-opt__check" />}
        <button
          type="button"
          className="icon-btn icon-btn--sm db-opt__more"
          aria-label={t('database.option.edit')}
          onClick={(e) => {
            e.stopPropagation()
            setEdit({ option: o, el: e.currentTarget })
          }}
        >
          <Ellipsis size={14} />
        </button>
      </div>
    )
  }

  return (
    <div className="db-picker" onKeyDown={onKeyDown}>
      <div className="db-picker__field">
        {selected.map((id) => {
          const o = options.find((x) => x.id === id)
          if (!o) return null
          return isStatus ? <StatusTag key={id} option={o} /> : <OptionTag key={id} option={o} onRemove={() => onChange(multi ? selected.filter((x) => x !== id) : null)} />
        })}
        <input
          className="db-picker__input"
          data-autofocus=""
          value={query}
          placeholder={selected.length ? '' : t('database.option.searchOrCreate')}
          onChange={(e) => {
            setQuery(e.target.value)
            setActive(0)
          }}
        />
      </div>
      <div className="db-picker__list" ref={listRef} role="listbox" aria-multiselectable={multi}>
        {isStatus ? (
          STATUS_GROUPS.map((g) => {
            const list = filtered.filter((o) => (o.group ?? 'todo') === g)
            if (!list.length) return null
            return (
              <div key={g}>
                <div className="label db-picker__section">{t(`database.status.group.${g}`)}</div>
                {list.map(renderOption)}
              </div>
            )
          })
        ) : (
          <>
            {ordered.length > 0 && <div className="label db-picker__section">{t('database.option.pick')}</div>}
            {ordered.map(renderOption)}
          </>
        )}
        {canCreate && (
          <div className="db-opt" data-active={active === ordered.length} onMouseEnter={() => setActive(ordered.length)} onClick={create}>
            <Plus size={14} className="faint" />
            <span className="db-opt__create">{t('database.option.create')}</span>
            <span className="tag db-tag" style={tagStyle(newOption('', options).color)}>
              {query.trim()}
            </span>
          </div>
        )}
        {!ordered.length && !canCreate && <div className="label db-picker__empty">{t('database.option.none')}</div>}
      </div>
      {edit && <OptionEditMenu db={db} prop={prop} option={edit.option} anchor={edit.el} onClose={() => setEdit(null)} />}
    </div>
  )
}

/** Rename / recolour / regroup / delete an option. */
export function OptionEditMenu({ db, prop, option: initial, anchor, onClose }: { db: Database; prop: PropertyDef; option: SelectOption; anchor: HTMLElement; onClose: () => void }) {
  const t = useT()
  const option = useWorkspace((s) => s.databases[db.id]?.properties.find((p) => p.id === prop.id)?.options?.find((o) => o.id === initial.id)) ?? initial
  const [name, setName] = useState(option.name)
  const update = (patch: Partial<SelectOption>) => {
    const fresh = useWorkspace.getState().databases[db.id]?.properties.find((p) => p.id === prop.id)
    const opts = (fresh?.options ?? []).map((o) => (o.id === option.id ? { ...o, ...patch } : o))
    useWorkspace.getState().updateProperty(db.id, prop.id, { options: opts })
  }
  const remove = () => {
    const s = useWorkspace.getState()
    const fresh = s.databases[db.id]?.properties.find((p) => p.id === prop.id)
    s.updateProperty(db.id, prop.id, { options: (fresh?.options ?? []).filter((o) => o.id !== option.id) })
    for (const row of rowsOf(db.id)) {
      const v = row.properties[prop.id]
      if (v === option.id) s.setRowProperty(row.id, prop.id, null)
      else if (Array.isArray(v) && v.includes(option.id)) s.setRowProperty(row.id, prop.id, v.filter((x) => x !== option.id))
    }
    onClose()
  }
  const commitName = () => {
    const n = name.trim()
    if (n && n !== option.name) update({ name: n })
  }
  return (
    <Popover open anchor={anchor} onClose={() => (commitName(), onClose())} placement="right-start" offset={6} className="db-optedit">
      <div style={{ padding: 4 }}>
        <input
          className="input"
          data-autofocus=""
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commitName()
              onClose()
            }
          }}
        />
      </div>
      <button type="button" className="menu-item menu-item--danger" onClick={remove}>
        <span className="menu-item__icon">
          <Trash size={14} />
        </span>
        <span className="menu-item__label">{t('common.delete')}</span>
      </button>
      {prop.type === 'status' && (
        <>
          <div className="menu-sep" />
          <div className="menu-section label">{t('database.status.groupLabel')}</div>
          {STATUS_GROUPS.map((g) => (
            <button key={g} type="button" className="menu-item" onClick={() => update({ group: g })}>
              <span className="menu-item__icon">
                <span className="db-status__led" data-group={g} />
              </span>
              <span className="menu-item__label">{t(`database.status.group.${g}`)}</span>
              {(option.group ?? 'todo') === g && <Check size={14} />}
            </button>
          ))}
        </>
      )}
      <div className="menu-sep" />
      <div className="menu-section label">{t('common.color')}</div>
      {COLOR_NAMES.map((c: ColorName) => (
        <button key={c} type="button" className="menu-item" onClick={() => update({ color: c })}>
          <span className="menu-item__icon">
            <span className="db-swatch" style={tagStyle(c)} />
          </span>
          <span className="menu-item__label">{t(`color.${c}`)}</span>
          {option.color === c && <Check size={14} />}
        </button>
      ))}
    </Popover>
  )
}

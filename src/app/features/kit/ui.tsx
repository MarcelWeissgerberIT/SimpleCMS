/**
 * Building blocks — small shared pieces of the #/kit editors: the block's head (icon, name, description),
 * colour swatches, a section with its spec label, the save bar of a draft, "Used by" links.
 */
import { useEffect, useRef, useState, type ReactNode } from 'react'
import { ArrowUpRight, ChevronDown, ImagePlus, Trash } from 'lucide-react'
import { COLOR_NAMES, type ColorName, type ID, type PageIcon as PageIconT } from '../../store/types'
import { Popover } from '../../ui/Popover'
import { Menu } from '../../ui/Menu'
import { IconPicker } from '../../ui/IconPicker'
import { PageIcon } from '../../ui/PageIcon'
import { useT } from '../../i18n'
import { tagStyle } from '../../lib/colors'
import { openPage } from '../../lib/router'
import { shortcutLabel } from '../../ui/controls'

export const pad2 = (n: number) => String(n).padStart(2, '0')

/** The block's icon (picker), its name as a display title and a description. */
export function EntryHead({
  code,
  icon,
  name,
  description,
  readOnly,
  placeholder,
  onIcon,
  onName,
  onDescription,
  onDelete,
  extra,
}: {
  code: string
  icon: PageIconT | null | undefined
  name: string
  description: string
  readOnly?: boolean
  placeholder: string
  onIcon: (icon: PageIconT | null) => void
  onName: (name: string) => void
  onDescription: (text: string) => void
  onDelete?: () => void
  extra?: ReactNode
}) {
  const t = useT()
  const [iconAnchor, setIconAnchor] = useState<HTMLElement | null>(null)
  const [draft, setDraft] = useState(name)
  const [desc, setDesc] = useState(description)
  const [confirmDelete, setConfirmDelete] = useState(false)
  useEffect(() => setDraft(name), [name])
  useEffect(() => setDesc(description), [description])
  const commit = () => {
    const n = draft.replace(/\s+/g, ' ').trim()
    if (n && n !== name) onName(n)
    else setDraft(name)
  }
  return (
    <div className="kt-entry">
      <div className="kt-entry__meta label">
        <span className="kt-entry__code">{code}</span>
        {extra}
        <span className="kt-rule" aria-hidden />
        {onDelete && !readOnly && (
          confirmDelete ? (
            <span className="kt-confirm" role="group">
              <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirmDelete(false)}>
                {t('common.cancel')}
              </button>
              <button type="button" className="btn btn--sm btn--danger" data-autofocus="" onClick={onDelete} data-testid="kt-delete-confirm">
                {t('features.kit.delete.confirm')}
              </button>
            </span>
          ) : (
            <button type="button" className="btn btn--sm btn--ghost kt-entry__delete" onClick={() => setConfirmDelete(true)} data-testid="kt-delete">
              <Trash size={13} strokeWidth={1.8} aria-hidden /> {t('features.kit.delete.button')}
            </button>
          )
        )}
      </div>
      <div className="kt-entry__row">
        <button
          type="button"
          className="kt-entry__icon"
          aria-label={t('features.kit.icon')}
          disabled={readOnly}
          onClick={(e) => setIconAnchor(e.currentTarget)}
        >
          {icon ? <PageIcon icon={icon} size={26} /> : <ImagePlus size={20} strokeWidth={1.6} aria-hidden />}
        </button>
        <input
          className="kt-entry__name"
          value={draft}
          placeholder={placeholder}
          readOnly={readOnly}
          aria-label={t('features.kit.name')}
          maxLength={80}
          data-testid="kt-name"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              commit()
              ;(e.target as HTMLInputElement).blur()
            } else if (e.key === 'Escape') setDraft(name)
          }}
        />
      </div>
      <textarea
        className="kt-entry__desc"
        value={desc}
        rows={1}
        readOnly={readOnly}
        placeholder={t('features.kit.descPlaceholder')}
        aria-label={t('features.kit.description')}
        onChange={(e) => setDesc(e.target.value)}
        onBlur={() => desc !== description && onDescription(desc)}
      />
      <Popover open={!!iconAnchor} anchor={iconAnchor} onClose={() => setIconAnchor(null)} placement="bottom-start">
        <IconPicker
          symbols
          onSelect={(i) => {
            onIcon(i)
            setIconAnchor(null)
          }}
          onRemove={
            icon
              ? () => {
                  onIcon(null)
                  setIconAnchor(null)
                }
              : undefined
          }
        />
      </Popover>
    </div>
  )
}

/** A row of colour keys (radio group). */
export function Swatches({ value, onChange, label, disabled, withDefault = true }: { value: ColorName | undefined; onChange: (c: ColorName) => void; label: string; disabled?: boolean; withDefault?: boolean }) {
  const t = useT()
  const colors = withDefault ? COLOR_NAMES : COLOR_NAMES.filter((c) => c !== 'default')
  return (
    <div className="kt-swatches" role="radiogroup" aria-label={label}>
      {colors.map((c) => (
        <button
          key={c}
          type="button"
          role="radio"
          aria-checked={(value ?? 'default') === c}
          aria-label={t(`features.kit.color.${c}`)}
          title={t(`features.kit.color.${c}`)}
          className="kt-swatch"
          style={tagStyle(c)}
          disabled={disabled}
          onClick={() => onChange(c)}
        />
      ))}
    </div>
  )
}

/** One colour key that opens the swatches (an item's colour). */
export function ColorKey({ value, onChange, label, disabled }: { value: ColorName; onChange: (c: ColorName) => void; label: string; disabled?: boolean }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  return (
    <>
      <button type="button" className="kt-colorkey" style={tagStyle(value)} aria-label={label} title={label} disabled={disabled} onClick={(e) => setAnchor(e.currentTarget)} />
      <Popover open={!!anchor} anchor={anchor} onClose={() => setAnchor(null)} placement="bottom-start" className="kt-colorpop">
        <Swatches
          value={value}
          label={label}
          onChange={(c) => {
            onChange(c)
            setAnchor(null)
          }}
        />
      </Popover>
    </>
  )
}

/** A section with its spec label ("§ 02 — ITEMS · 16"). */
export function Section({ num, title, aside, children, id }: { num: string; title: string; aside?: ReactNode; children: ReactNode; id?: string }) {
  return (
    <section className="kt-sec" aria-labelledby={id}>
      <h2 className="kt-sec__head label" id={id}>
        <span className="kt-sec__num">§ {num}</span>
        <span>{title}</span>
        <span className="kt-rule" aria-hidden />
        {aside}
      </h2>
      {children}
    </section>
  )
}

/** The save bar of a draft (sticky at the bottom while there are changes). Mod+S saves. */
export function SaveBar({ dirty, onSave, onRevert, readOnly, note }: { dirty: boolean; onSave: () => void; onRevert: () => void; readOnly?: boolean; note?: ReactNode }) {
  const t = useT()
  const save = useRef(onSave)
  save.current = onSave
  useEffect(() => {
    if (!dirty || readOnly) return
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && !e.altKey && e.key.toLowerCase() === 's') {
        e.preventDefault()
        save.current()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dirty, readOnly])
  if (readOnly) return null
  return (
    <div className="kt-savebar" data-dirty={dirty || undefined} role="region" aria-label={t('features.kit.save.region')}>
      <span className="kt-savebar__state label">
        <span className={dirty ? 'led led--on' : 'led led--ok'} aria-hidden />
        {dirty ? t('features.kit.save.dirty') : t('features.kit.save.clean')}
      </span>
      {note}
      <span className="kt-spacer" />
      <button type="button" className="btn btn--sm btn--ghost" disabled={!dirty} onClick={onRevert}>
        {t('features.kit.save.revert')}
      </button>
      <button type="button" className="btn btn--sm btn--primary" disabled={!dirty} onClick={onSave} data-testid="kt-save">
        {t('features.kit.save.button')} <span className="kbd">{shortcutLabel('Mod+S')}</span>
      </button>
    </div>
  )
}

/** Links to where a block is used (database page › property). */
export function UsedList({ items, empty }: { items: Array<{ key: string; dbId?: ID; href?: string; label: ReactNode; meta?: string }>; empty: string }) {
  if (!items.length) return <p className="kt-empty-line">{empty}</p>
  return (
    <ul className="kt-used">
      {items.map((it) => (
        <li key={it.key}>
          <button
            type="button"
            className="kt-used__link"
            onClick={() => {
              if (it.href) window.location.hash = it.href
              else if (it.dbId) openPage(it.dbId)
            }}
          >
            <span className="kt-used__label">{it.label}</span>
            {it.meta && <span className="kt-used__meta label">{it.meta}</span>}
            <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden />
          </button>
        </li>
      ))}
    </ul>
  )
}

/** A compact dropdown key: the current choice, a searchable menu of the others. */
export function PickButton<V extends string>({
  value,
  items,
  onChange,
  placeholder,
  label,
  disabled,
  testId,
}: {
  value: V | null
  items: Array<{ value: V; label: string; icon?: ReactNode; hint?: string }>
  onChange: (v: V) => void
  placeholder: string
  label: string
  disabled?: boolean
  testId?: string
}) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const cur = items.find((i) => i.value === value)
  return (
    <>
      <button type="button" className="kt-pick" aria-haspopup="menu" aria-label={label} disabled={disabled} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)} data-testid={testId}>
        {cur?.icon && <span className="kt-pick__icon">{cur.icon}</span>}
        <span className={`kt-pick__label${cur ? '' : ' faint'}`}>{cur?.label ?? placeholder}</span>
        <ChevronDown size={12} aria-hidden />
      </button>
      <Menu
        open={!!anchor}
        anchor={anchor}
        onClose={() => setAnchor(null)}
        searchable={items.length > 8}
        searchPlaceholder={t('features.kit.search')}
        emptyLabel={t('features.kit.searchEmpty')}
        entries={items.map((i) => ({ label: i.label, icon: i.icon, hint: i.hint, checked: i.value === value, onSelect: () => onChange(i.value) }))}
      />
    </>
  )
}

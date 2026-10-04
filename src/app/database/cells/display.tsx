/**
 * Read-only renderers for property values (cells, cards, property panel, chips).
 */
import { memo, type MouseEvent, type ReactNode } from 'react'
import { AlertTriangle, ArrowUpRight, Bot, Check, FileText, KeyRound, Mail, Minus, Phone, Star, UserRound, Webhook } from 'lucide-react'
import type { Database, DateValue, ID, Page, Person, PropertyDef, SelectOption } from '../../store/types'
import { tagStyle, colorText } from '../../lib/colors'
import { useFileUrl } from '../../lib/files'
import { PageIcon } from '../../ui/PageIcon'
import { useT } from '../../i18n'
import { FormulaError, isDate, toText, type FValue } from '../formula'
import { formatDateValue, formatNumber, formatTimestamp, isDateValue, numberRatio } from '../model/format'
import { fileLabel, type Resolver, type Resolved } from '../model/resolve'
import { guessIsImage, useFileMeta } from '../model/files'
import { openRow, writeValue } from '../model/actions'
import { actorKind, localPerson, type ActorKind } from '../model/actors'
import { useUI } from '../../store/ui'

/* ---------------- atoms ---------------- */

/** Chip "×". Not a tab stop: pickers keep focus in their search field (Backspace removes the last chip). */
function RemoveX({ onRemove }: { onRemove: () => void }) {
  const t = useT()
  return (
    <button
      type="button"
      className="db-tag__x"
      tabIndex={-1}
      aria-label={t('common.remove')}
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        onRemove()
      }}
    >
      ×
    </button>
  )
}

export function OptionTag({ option, onRemove }: { option: SelectOption; onRemove?: () => void }) {
  return (
    <span className="tag db-tag" style={tagStyle(option.color)}>
      <span className="db-tag__text">{option.name}</span>
      {onRemove && <RemoveX onRemove={onRemove} />}
    </span>
  )
}

/** Status: an LED (state from group) + option name. */
export function StatusTag({ option }: { option: SelectOption }) {
  const g = option.group ?? 'todo'
  return (
    <span className="tag db-tag db-status" data-group={g} style={tagStyle(option.color)}>
      <span className="db-status__led" aria-hidden />
      <span className="db-tag__text">{option.name}</span>
    </span>
  )
}

export function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean)
  if (!parts.length) return '?'
  return (parts[0][0] + (parts.length > 1 ? parts[parts.length - 1][0] : parts[0][1] ?? '')).toUpperCase()
}

export function Avatar({ person, size = 18 }: { person: Person; size?: number }) {
  return (
    <span className="db-avatar" style={{ ...tagStyle(person.color), width: size, height: size, fontSize: Math.round(size * 0.48) }} aria-hidden>
      {initials(person.name)}
    </span>
  )
}

export function PersonChip({ person, onRemove }: { person: Person; onRemove?: () => void }) {
  return (
    <span className="db-person">
      <Avatar person={person} />
      <span className="db-person__name">{person.name}</span>
      {onRemove && <RemoveX onRemove={onRemove} />}
    </span>
  )
}

/** Avatar of a created_by / last_edited_by actor that isn't a workspace person. */
export function ActorAvatar({ kind, name, size = 18 }: { kind: Exclude<ActorKind, 'person'>; name: string; size?: number }) {
  const icon = Math.round(size * 0.62)
  const glyph = kind === 'api' ? <KeyRound size={icon} strokeWidth={2} /> : kind === 'hook' ? <Webhook size={icon} strokeWidth={2} /> : kind === 'agent' ? <Bot size={icon} strokeWidth={2} /> : kind === 'local' && name ? initials(name) : <UserRound size={icon} strokeWidth={2} />
  return (
    <span className="db-avatar db-avatar--actor" data-actor={kind} style={{ width: size, height: size, fontSize: Math.round(size * 0.48) }} aria-hidden>
      {glyph}
    </span>
  )
}

/** Created by / Last edited by: a person chip — or the local user, an API token, a webhook. */
export function ActorChip({ id, r }: { id: string; r: Resolver }) {
  const kind = actorKind(id, r.ctx.people)
  const person = kind === 'person' ? r.ctx.people.find((p) => p.id === id) : kind === 'local' ? localPerson(r.ctx) : undefined
  if (person) return <PersonChip person={person} />
  const name = r.actorName(id)
  return (
    <span className="db-person" data-actor={kind}>
      <ActorAvatar kind={kind as Exclude<ActorKind, 'person'>} name={kind === 'local' ? r.ctx.me.name.trim() : name} />
      <span className="db-person__name">{name}</span>
    </span>
  )
}

/** The "Me" token of person filters (resolved per viewer). */
export function MeAvatar({ size = 16 }: { size?: number }) {
  const t = useT()
  return (
    <span className="db-avatar db-avatar--me" style={{ minWidth: size, height: size, fontSize: Math.round(size * 0.5) }} aria-hidden>
      {t('database.me.short')}
    </span>
  )
}

export function RelationChip({ page, onRemove, linkable = true }: { page: Page; onRemove?: () => void; linkable?: boolean }) {
  const t = useT()
  return (
    <span
      className="db-rel"
      onClick={
        linkable
          ? (e) => {
              e.stopPropagation()
              useUI.getState().openPeek(page.id)
            }
          : undefined
      }
      role={linkable ? 'link' : undefined}
    >
      <PageIcon icon={page.icon} size={14} />
      <span className="db-rel__name">{page.title || t('common.untitled')}</span>
      {onRemove && <RemoveX onRemove={onRemove} />}
    </span>
  )
}

export function FileChip({ src, big }: { src: string; big?: boolean }) {
  const meta = useFileMeta(src)
  const url = useFileUrl(src)
  const isImg = guessIsImage(src, meta)
  const name = meta?.name ?? fileLabel(src)
  return (
    <a
      className={`db-file${big ? ' db-file--big' : ''}`}
      href={url || undefined}
      target="_blank"
      rel="noreferrer"
      title={name}
      onClick={(e) => e.stopPropagation()}
      download={src.startsWith('onefile:') ? name : undefined}
    >
      {isImg && url ? <img src={url} alt="" loading="lazy" draggable={false} /> : <FileText size={big ? 18 : 13} strokeWidth={1.7} />}
      {!big && <span className="db-file__name">{name}</span>}
    </a>
  )
}

export function Checkbox({ checked, onToggle, readOnly, label, indeterminate }: { checked: boolean; onToggle?: (e: MouseEvent) => void; readOnly?: boolean; label?: string; indeterminate?: boolean }) {
  return (
    <button
      type="button"
      role="checkbox"
      aria-checked={indeterminate ? 'mixed' : checked}
      aria-label={label}
      className="db-check"
      tabIndex={-1}
      disabled={readOnly}
      onClick={(e) => {
        e.stopPropagation()
        onToggle?.(e)
      }}
    >
      {indeterminate ? <Minus size={11} strokeWidth={3} /> : checked && <Check size={11} strokeWidth={3} />}
    </button>
  )
}

export function Rating({ value, max = 5, onChange, size = 13 }: { value: number; max?: number; onChange?: (v: number) => void; size?: number }) {
  return (
    <span className="db-rating" role={onChange ? 'radiogroup' : undefined} onClick={(e) => onChange && e.stopPropagation()}>
      {Array.from({ length: max }, (_, i) => (
        <button
          key={i}
          type="button"
          tabIndex={-1}
          className="db-rating__star"
          data-on={i < value}
          disabled={!onChange}
          aria-label={`${i + 1}`}
          onClick={() => onChange?.(value === i + 1 ? 0 : i + 1)}
        >
          <Star size={size} strokeWidth={1.8} />
        </button>
      ))}
    </span>
  )
}

/** Thin gauge bar (instrument style). */
export function NumberBar({ ratio, text }: { ratio: number; text: string }) {
  return (
    <span className="db-gauge">
      <span className="db-gauge__track">
        <span className="db-gauge__fill" style={{ width: `${ratio * 100}%` }} />
      </span>
      <span className="db-gauge__text">{text}</span>
    </span>
  )
}

export function NumberRing({ ratio, text }: { ratio: number; text: string }) {
  const r = 7
  const c = 2 * Math.PI * r
  return (
    <span className="db-ring">
      <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
        <circle cx="9" cy="9" r={r} className="db-ring__track" />
        <circle cx="9" cy="9" r={r} className="db-ring__fill" strokeDasharray={`${ratio * c} ${c}`} transform="rotate(-90 9 9)" />
      </svg>
      <span>{text}</span>
    </span>
  )
}

export function FormulaErrorBadge({ error }: { error: FormulaError }) {
  const t = useT()
  return (
    <span className="db-err" title={t(`database.formula.err.${error.code}`, error.vars)}>
      <AlertTriangle size={12} /> {t('database.formula.errorShort')}
    </span>
  )
}

/* ---------------- full value renderer ---------------- */

export type Variant = 'cell' | 'card' | 'panel'

interface ValueProps {
  db: Database
  prop: PropertyDef
  row: Page
  r: Resolver
  variant?: Variant
  /** Allow direct manipulation (checkbox toggle, rating click). */
  interactive?: boolean
}

function linkHref(prop: PropertyDef, v: string): string {
  if (prop.type === 'email') return `mailto:${v}`
  if (prop.type === 'phone') return `tel:${v.replace(/\s+/g, '')}`
  return /^[a-z]+:/i.test(v) ? v : `https://${v}`
}

function FValueView({ v, lang }: { v: FValue; lang: 'en' | 'de' }) {
  if (typeof v === 'boolean') return <Checkbox checked={v} readOnly />
  if (typeof v === 'number') return <span className="db-num db-num--end">{toText(v, lang)}</span>
  if (isDate(v)) return <span>{toText(v, lang)}</span>
  if (Array.isArray(v))
    return (
      <span className="db-chips">
        {v.map((x, i) => (
          <span key={i} className="db-chip-plain">
            {toText(x, lang)}
          </span>
        ))}
      </span>
    )
  return <span className="db-text">{v ?? ''}</span>
}

function PersonList({ ids, people }: { ids: ID[]; people: Person[] }) {
  return (
    <span className="db-chips">
      {ids.map((id) => {
        const p = people.find((x) => x.id === id)
        return p ? <PersonChip key={id} person={p} /> : null
      })}
    </span>
  )
}

function RelationList({ ids, pages, linkable }: { ids: ID[]; pages: Record<ID, Page>; linkable: boolean }) {
  return (
    <span className="db-chips">
      {ids.map((id) => {
        const p = pages[id]
        return p && !p.trashed ? <RelationChip key={id} page={p} linkable={linkable} /> : null
      })}
    </span>
  )
}

export const PropertyValueView = memo(function PropertyValueView({ db, prop, row, r, variant = 'cell', interactive }: ValueProps) {
  const v = r.value(db, prop, row)
  return <ValueView db={db} prop={prop} row={row} r={r} v={v} variant={variant} interactive={interactive} />
})

export function ValueView({ db, prop, row, r, v, variant = 'cell', interactive }: ValueProps & { v: Resolved }) {
  const { lang, labels } = r.ctx
  if (v instanceof FormulaError) return <FormulaErrorBadge error={v} />
  switch (prop.type) {
    case 'title':
      return <span className="db-text db-text--title">{row.title}</span>
    case 'text':
      return v ? <span className="db-text">{String(v)}</span> : null
    case 'number': {
      if (typeof v !== 'number') return null
      const text = formatNumber(v, prop.numberFormat, lang)
      if (prop.numberDisplay === 'bar') return <NumberBar ratio={numberRatio(v, prop.numberFormat)} text={text} />
      if (prop.numberDisplay === 'ring') return <NumberRing ratio={numberRatio(v, prop.numberFormat)} text={text} />
      return <span className="db-num">{text}</span>
    }
    case 'select': {
      const o = prop.options?.find((x) => x.id === v)
      return o ? <OptionTag option={o} /> : null
    }
    case 'status': {
      const o = prop.options?.find((x) => x.id === v)
      return o ? <StatusTag option={o} /> : null
    }
    case 'multi_select': {
      const ids = (v as string[] | null) ?? []
      if (!ids.length) return null
      return (
        <span className="db-chips">
          {ids.map((id) => {
            const o = prop.options?.find((x) => x.id === id)
            return o ? <OptionTag key={id} option={o} /> : null
          })}
        </span>
      )
    }
    case 'date':
      return isDateValue(v) ? <span className="db-date">{formatDateValue(v as DateValue, lang, labels)}</span> : null
    case 'created_time':
    case 'last_edited_time':
      return isDate(v) ? <span className="db-date db-date--stamp">{formatTimestamp(v.getTime(), lang)}</span> : null
    case 'person': {
      const ids = (v as string[] | null) ?? []
      return ids.length ? <PersonList ids={ids} people={r.ctx.people} /> : null
    }
    case 'created_by':
    case 'last_edited_by':
      return typeof v === 'string' ? <ActorChip id={v} r={r} /> : null
    case 'checkbox':
      return <Checkbox checked={v === true} readOnly={!interactive} onToggle={() => writeValue(db.id, prop, row.id, !(v === true))} label={prop.name} />
    case 'url':
    case 'email':
    case 'phone': {
      if (!v) return null
      const s = String(v)
      const text = prop.type === 'url' ? s.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '') : s
      // editable surfaces: the text is part of the cell (click = edit), a key-cap button follows the link
      if (variant !== 'card') return <LinkValue prop={prop} href={linkHref(prop, s)} text={text} />
      return (
        <a className="db-link" href={linkHref(prop, s)} target={prop.type === 'url' ? '_blank' : undefined} rel="noreferrer" onClick={(e: MouseEvent) => e.stopPropagation()}>
          {text}
        </a>
      )
    }
    case 'files': {
      const list = (v as string[] | null) ?? []
      if (!list.length) return null
      return (
        <span className="db-chips">
          {list.map((src, i) => (
            <FileChip key={src + i} src={src} />
          ))}
        </span>
      )
    }
    case 'relation': {
      const ids = (v as string[] | null) ?? []
      return ids.length ? <RelationList ids={ids} pages={r.ctx.pages} linkable={variant !== 'cell'} /> : null
    }
    case 'rollup':
    case 'formula': {
      if (v === null || v === undefined || v === '') return null
      if (typeof v === 'number' && prop.type === 'rollup') return <span className="db-num db-num--end">{r.textOf(db, prop, v)}</span>
      return <FValueView v={v as FValue} lang={lang} />
    }
    case 'unique_id':
      return typeof v === 'number' ? <span className="db-uid">{prop.idPrefix ? `${prop.idPrefix}-${v}` : v}</span> : null
    case 'rating':
      return (
        <Rating
          value={typeof v === 'number' ? v : 0}
          max={prop.ratingMax ?? 5}
          onChange={interactive ? (n) => writeValue(db.id, prop, row.id, n || null) : undefined}
          size={variant === 'card' ? 12 : 13}
        />
      )
  }
  return null
}

function LinkValue({ prop, href, text }: { prop: PropertyDef; href: string; text: string }) {
  const t = useT()
  const label = t(`database.link.open.${prop.type}`)
  const Icon = prop.type === 'email' ? Mail : prop.type === 'phone' ? Phone : ArrowUpRight
  return (
    <span className="db-linkval">
      <span className="db-linkval__text">{text}</span>
      <a
        className="db-linkval__go"
        href={href}
        target={prop.type === 'url' ? '_blank' : undefined}
        rel="noreferrer"
        aria-label={label}
        title={label}
        tabIndex={-1}
        onClick={(e: MouseEvent) => e.stopPropagation()}
      >
        <Icon size={12} strokeWidth={2} />
      </a>
    </span>
  )
}

/** Title + icon + OPEN affordance used in table cells, list rows and cards. */
export function RowTitle({ row, children }: { row: Page; children?: ReactNode }) {
  const t = useT()
  return (
    <span className="db-rowtitle">
      {row.icon && <PageIcon icon={row.icon} size={16} />}
      <span className={`db-rowtitle__text${row.title ? '' : ' is-empty'}`}>{row.title || t('common.untitled')}</span>
      {children}
    </span>
  )
}

export function OpenButton({ row, view, label }: { row: Page; view: { openIn?: 'peek' | 'center' | 'full' } | null; label: string }) {
  return (
    <button
      type="button"
      className="db-open"
      tabIndex={-1}
      onClick={(e) => {
        e.stopPropagation()
        openRow(row.id, view as never)
      }}
    >
      <ArrowUpRight size={12} strokeWidth={2} />
      <span>{label}</span>
    </button>
  )
}

export { colorText }

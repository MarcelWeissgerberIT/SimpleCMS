/**
 * One question of the fill view and its answer control. Native inputs throughout (radios,
 * checkboxes, <select>), so keyboard, screen readers, autofill and phone keyboards behave.
 * Presentations: select as chips / list / dropdown, multi-select as chips / checkbox list,
 * rating as stars or a numbered scale, number as a field or a 1–5 / 1–10 scale.
 */
import { useRef, useState } from 'react'
import { AlertTriangle, Check, Paperclip, Plus, Star, Upload, X } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { Popover } from '../../ui/Popover'
import { colorText } from '../../lib/colors'
import { Avatar, RelationChip } from '../cells/display'
import { RelationPicker } from '../cells/pickers'
import { formatBytes } from '../model/files'
import { SHARED_FILE_MAX, SHARED_FILES_TOTAL, type Answer, type DateAnswer, type Field, type FieldError } from './fields'

const pad = (n: number) => String(n).padStart(2, '0')
const GROUP_KINDS = new Set(['select', 'multi', 'rating', 'person', 'checkbox', 'files', 'relation'])

/** Answered in a fieldset (several inputs) rather than one labelled field. */
const isGroup = (f: Field) => (f.kind === 'select' && f.display === 'dropdown' ? false : GROUP_KINDS.has(f.kind) || (f.kind === 'number' && f.display === 'scale'))

export interface QuestionProps {
  f: Field
  /** position among the questions shown (1-based) */
  num: number
  idBase: string
  value: Answer | undefined
  error: FieldError | null
  shared?: boolean
  onChange: (v: Answer) => void
  onBlur: () => void
}

export function Question({ f, num, idBase, value, error, shared, onChange, onBlur }: QuestionProps) {
  const t = useT()
  const id = `${idBase}-${f.key}`
  const helpId = f.help.trim() ? `${id}-help` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [helpId, errId].filter(Boolean).join(' ') || undefined
  const head = (
    <>
      <span className="fm-q__num" aria-hidden>
        {pad(num)}
      </span>
      <span className="fm-q__name">{f.name.trim() || t('common.untitled')}</span>
      {f.required && (
        <>
          <span className="fm-req" aria-hidden>
            *
          </span>
          <span className="visually-hidden">({t('database.form.required')})</span>
        </>
      )}
    </>
  )
  const help = helpId && (
    <p className="fm-q__help" id={helpId}>
      {f.help}
    </p>
  )
  const control = <Control f={f} id={id} value={value} invalid={!!error} describedBy={describedBy} shared={shared} onChange={onChange} onBlur={onBlur} />
  return (
    <div className="fm-q" data-q={f.key} data-kind={f.kind} data-display={f.display} data-invalid={!!error || undefined}>
      {isGroup(f) ? (
        <fieldset className="fm-q__set" aria-describedby={describedBy}>
          <legend className="fm-q__label">{head}</legend>
          {help}
          {control}
        </fieldset>
      ) : (
        <>
          <label className="fm-q__label" htmlFor={id}>
            {head}
          </label>
          {help}
          {control}
        </>
      )}
      {error && (
        <p className="fm-q__err" id={errId}>
          <AlertTriangle size={13} aria-hidden /> {t(`database.form.err.${error}`, { max: formatBytes(SHARED_FILE_MAX), total: formatBytes(SHARED_FILES_TOTAL) })}
        </p>
      )}
    </div>
  )
}

interface ControlProps {
  f: Field
  id: string
  value: Answer | undefined
  invalid: boolean
  describedBy?: string
  shared?: boolean
  onChange: (v: Answer) => void
  onBlur: () => void
}

function Control({ f, id, value, invalid, describedBy, shared, onChange, onBlur }: ControlProps) {
  const t = useT()
  const a11y = { 'aria-invalid': invalid || undefined, 'aria-describedby': describedBy, 'aria-required': f.required || undefined }
  const text = typeof value === 'string' ? value : ''
  switch (f.kind) {
    case 'long':
      return (
        <textarea
          id={id}
          className="input fm-input fm-input--long"
          rows={3}
          value={text}
          maxLength={20_000}
          placeholder={f.placeholder}
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            // Ctrl/⌘+Enter sends (or goes on) from a multi-line answer
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
              e.preventDefault()
              e.currentTarget.form?.requestSubmit()
            }
          }}
          {...a11y}
        />
      )
    case 'short':
    case 'url':
    case 'email':
    case 'phone': {
      const type = f.kind === 'url' ? 'url' : f.kind === 'email' ? 'email' : f.kind === 'phone' ? 'tel' : 'text'
      const auto = f.kind === 'email' ? 'email' : f.kind === 'phone' ? 'tel' : f.kind === 'url' ? 'url' : 'off'
      const ph = f.placeholder || (f.kind === 'url' ? 'https://' : f.kind === 'email' ? t('database.form.ph.email') : f.kind === 'phone' ? '+49 …' : '')
      return <input id={id} className="input fm-input" type={type} autoComplete={auto} inputMode={f.kind === 'url' ? 'url' : undefined} placeholder={ph} value={text} maxLength={2000} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} {...a11y} />
    }
    case 'number':
      if (f.display === 'scale') return <ScaleInput f={f} id={id} max={f.scale ?? 5} value={Number(text) || 0} invalid={invalid} onChange={(n) => onChange(n ? String(n) : '')} onBlur={onBlur} />
      return (
        <span className="fm-num">
          <input id={id} className="input fm-input" type="text" inputMode="decimal" autoComplete="off" placeholder={f.placeholder} value={text} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} {...a11y} />
          {f.percent && (
            <span className="fm-num__unit" aria-hidden>
              %
            </span>
          )}
        </span>
      )
    case 'date': {
      const d = (value as DateAnswer | undefined) ?? { date: '', time: '' }
      return (
        <span className="fm-date">
          <input id={id} className="input fm-input fm-input--date" type="date" value={d.date} onChange={(e) => onChange({ ...d, date: e.target.value })} onBlur={onBlur} {...a11y} />
          {f.includeTime && (
            <input className="input fm-input fm-input--time" type="time" aria-label={t('database.form.time')} value={d.time} onChange={(e) => onChange({ ...d, time: e.target.value })} onBlur={onBlur} aria-invalid={invalid || undefined} />
          )}
        </span>
      )
    }
    case 'checkbox':
      return (
        <label className="fm-chip fm-chip--check" data-on={value === true}>
          <input id={id} type="checkbox" className="fm-chip__input" checked={value === true} onChange={(e) => onChange(e.target.checked)} onBlur={onBlur} {...a11y} />
          <span className="fm-chip__mark fm-chip__mark--box" aria-hidden>
            {value === true && <Check size={11} strokeWidth={3} />}
          </span>
          <span className="fm-chip__name">{t('database.yes')}</span>
        </label>
      )
    case 'select':
    case 'multi':
      return <OptionsInput f={f} id={id} value={value} invalid={invalid} a11y={a11y} onChange={onChange} onBlur={onBlur} />
    case 'rating':
      if (f.display === 'scale') return <ScaleInput f={f} id={id} max={f.max ?? 5} value={typeof value === 'number' ? value : 0} invalid={invalid} onChange={onChange} onBlur={onBlur} />
      return <RatingInput f={f} id={id} value={typeof value === 'number' ? value : 0} invalid={invalid} onChange={onChange} onBlur={onBlur} />
    case 'files':
      return <FilesInput id={id} value={(value as File[] | undefined) ?? []} shared={shared} onChange={onChange} />
    case 'person':
      return <PersonInput id={id} value={(value as string[] | undefined) ?? []} invalid={invalid} onChange={onChange} onBlur={onBlur} />
    case 'relation':
      return <RelationInput f={f} value={(value as string[] | undefined) ?? []} onChange={onChange} />
  }
}

function OptionsInput({ f, id, value, invalid, a11y, onChange, onBlur }: { f: Field; id: string; value: Answer | undefined; invalid: boolean; a11y: Record<string, unknown>; onChange: (v: Answer) => void; onBlur: () => void }) {
  const t = useT()
  const multi = f.kind === 'multi'
  const sel = multi ? ((value as string[] | undefined) ?? []) : ((value as string | null | undefined) ?? null)
  const opts = f.options ?? []
  if (!opts.length) return <p className="label fm-q__none">{t('database.form.noOptions')}</p>
  if (!multi && f.display === 'dropdown')
    return (
      <select id={id} className="input fm-input fm-select" value={(sel as string | null) ?? ''} onChange={(e) => onChange(e.target.value || null)} onBlur={onBlur} {...a11y}>
        <option value="">{f.placeholder || t('database.form.choose')}</option>
        {opts.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>
    )
  return (
    <div className={`fm-chips${f.display === 'list' ? ' fm-chips--list' : ''}`}>
      {opts.map((o) => {
        const on = multi ? (sel as string[]).includes(o.id) : sel === o.id
        return (
          <label key={o.id} className="fm-chip" data-on={on}>
            <input
              type={multi ? 'checkbox' : 'radio'}
              name={id}
              id={`${id}-${o.id}`}
              className="fm-chip__input"
              checked={on}
              onChange={() => onChange(multi ? (on ? (sel as string[]).filter((x) => x !== o.id) : [...(sel as string[]), o.id]) : o.id)}
              onBlur={onBlur}
              aria-invalid={invalid || undefined}
            />
            <span className={`fm-chip__mark${multi ? ' fm-chip__mark--box' : ''}`} aria-hidden>
              {multi && on && <Check size={11} strokeWidth={3} />}
            </span>
            <span className="fm-chip__swatch" style={{ background: colorText(o.color === 'default' ? 'gray' : o.color) }} aria-hidden />
            <span className="fm-chip__name">{o.name}</span>
          </label>
        )
      })}
      {!multi && !f.required && sel && (
        <button type="button" className="fm-clear" onClick={() => onChange(null)}>
          <X size={12} /> {t('database.form.clear')}
        </button>
      )}
    </div>
  )
}

/** Numbered keys 1…max (a rating or number question shown as a scale). */
function ScaleInput({ f, id, max, value, invalid, onChange, onBlur }: { f: Field; id: string; max: number; value: number; invalid: boolean; onChange: (n: number) => void; onBlur: () => void }) {
  const t = useT()
  return (
    <div className="fm-scale-wrap">
      <div className="fm-scale" style={{ '--fm-keys': max } as React.CSSProperties}>
        {Array.from({ length: max }, (_, i) => (
          <label key={i} className="fm-key" data-on={value === i + 1} data-lit={value >= i + 1}>
            <input type="radio" name={id} className="fm-chip__input" checked={value === i + 1} onChange={() => onChange(i + 1)} onBlur={onBlur} aria-invalid={invalid || undefined} />
            <span className="fm-key__num">{i + 1}</span>
          </label>
        ))}
      </div>
      <div className="fm-scale__foot">
        <span className="label fm-stars__readout" aria-hidden>
          {value ? `${value}/${max}` : '—'}
        </span>
        {!f.required && value > 0 && (
          <button type="button" className="fm-clear" onClick={() => onChange(0)}>
            <X size={12} /> {t('database.form.clear')}
          </button>
        )}
      </div>
    </div>
  )
}

function RatingInput({ f, id, value, invalid, onChange, onBlur }: { f: Field; id: string; value: number; invalid: boolean; onChange: (v: Answer) => void; onBlur: () => void }) {
  const t = useT()
  const max = f.max ?? 5
  const [hover, setHover] = useState(0)
  const lit = hover || value
  return (
    <div className="fm-stars" onMouseLeave={() => setHover(0)}>
      {Array.from({ length: max }, (_, i) => (
        <label key={i} className="fm-star" data-on={i < lit} onMouseEnter={() => setHover(i + 1)}>
          <input type="radio" name={id} className="fm-chip__input" checked={value === i + 1} onChange={() => onChange(i + 1)} onBlur={onBlur} aria-invalid={invalid || undefined} />
          <Star size={22} strokeWidth={1.6} aria-hidden />
          <span className="visually-hidden">{t('database.form.stars', { n: i + 1, max })}</span>
        </label>
      ))}
      <span className="label fm-stars__readout" aria-hidden>
        {value ? `${value}/${max}` : '—'}
      </span>
      {!f.required && value > 0 && (
        <button type="button" className="fm-clear" onClick={() => onChange(0)}>
          <X size={12} /> {t('database.form.clear')}
        </button>
      )}
    </div>
  )
}

function FilesInput({ id, value, shared, onChange }: { id: string; value: File[]; shared?: boolean; onChange: (v: Answer) => void }) {
  const t = useT()
  const inputRef = useRef<HTMLInputElement>(null)
  const [drag, setDrag] = useState(false)
  const add = (list: FileList | null) => {
    if (!list?.length) return
    onChange([...value, ...Array.from(list)])
  }
  return (
    <div
      className="fm-files"
      data-drag={drag || undefined}
      onDragOver={(e) => {
        e.preventDefault()
        setDrag(true)
      }}
      onDragLeave={() => setDrag(false)}
      onDrop={(e) => {
        e.preventDefault()
        setDrag(false)
        add(e.dataTransfer.files)
      }}
    >
      {value.length > 0 && (
        <ul className="fm-files__list">
          {value.map((file, i) => (
            <li key={`${file.name}-${i}`} className="fm-file" data-big={(shared && file.size > SHARED_FILE_MAX) || undefined}>
              <Paperclip size={13} aria-hidden />
              <span className="fm-file__name">{file.name}</span>
              <span className="label fm-file__size">{formatBytes(file.size)}</span>
              <button type="button" className="icon-btn icon-btn--sm" aria-label={t('database.form.removeFile', { name: file.name })} onClick={() => onChange(value.filter((_, j) => j !== i))}>
                <X size={13} />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="fm-files__row">
        <button type="button" className="btn btn--sm" id={id} onClick={() => inputRef.current?.click()}>
          <Upload size={13} /> {t('database.form.chooseFiles')}
        </button>
        <span className="label fm-files__hint">{shared ? t('database.form.dropShared', { max: formatBytes(SHARED_FILE_MAX) }) : t('database.form.drop')}</span>
      </div>
      <input
        ref={inputRef}
        type="file"
        multiple
        hidden
        tabIndex={-1}
        onChange={(e) => {
          add(e.target.files)
          e.target.value = ''
        }}
      />
    </div>
  )
}

function PersonInput({ id, value, invalid, onChange, onBlur }: { id: string; value: string[]; invalid: boolean; onChange: (v: Answer) => void; onBlur: () => void }) {
  const t = useT()
  const people = useWorkspace((s) => s.people)
  if (!people.length) return <p className="label fm-q__none">{t('database.form.noPeople')}</p>
  return (
    <div className="fm-chips">
      {people.map((p) => {
        const on = value.includes(p.id)
        return (
          <label key={p.id} className="fm-chip" data-on={on}>
            <input type="checkbox" name={id} className="fm-chip__input" checked={on} onChange={() => onChange(on ? value.filter((x) => x !== p.id) : [...value, p.id])} onBlur={onBlur} aria-invalid={invalid || undefined} />
            <span className="fm-chip__mark fm-chip__mark--box" aria-hidden>
              {on && <Check size={11} strokeWidth={3} />}
            </span>
            <Avatar person={p} size={18} />
            <span className="fm-chip__name">{p.name}</span>
          </label>
        )
      })}
    </div>
  )
}

function RelationInput({ f, value, onChange }: { f: Field; value: string[]; onChange: (v: Answer) => void }) {
  const t = useT()
  const pages = useWorkspace((s) => s.pages)
  const target = useWorkspace((s) => (f.prop?.relationDatabaseId ? s.pages[f.prop.relationDatabaseId] : undefined))
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  if (!f.prop) return null
  return (
    <div className="fm-rel">
      {value.length > 0 && (
        <div className="fm-rel__chips">
          {value.map((id) => {
            const p = pages[id]
            return p && !p.trashed ? <RelationChip key={id} page={p} linkable={false} onRemove={() => onChange(value.filter((x) => x !== id))} /> : null
          })}
        </div>
      )}
      <button type="button" className="btn btn--sm" aria-haspopup="listbox" aria-expanded={!!anchor} onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}>
        <Plus size={13} /> {t('database.form.link', { db: target?.title || t('common.untitled') })}
      </button>
      {anchor && (
        <Popover open anchor={anchor} onClose={() => setAnchor(null)} className="db-pop">
          <RelationPicker prop={f.prop} value={value} onChange={(v) => onChange(v)} onClose={() => setAnchor(null)} />
        </Popover>
      )}
    </div>
  )
}

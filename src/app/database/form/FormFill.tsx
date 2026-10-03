/**
 * Fill mode: the real form. Used by the Form view (rows go into the database) and by the
 * public form page (answers go to the owner's webhook). Native inputs throughout, so keyboard,
 * screen readers, autofill and mobile keyboards behave as expected.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Check, Paperclip, Plus, RotateCcw, Star, Upload, X } from 'lucide-react'
import type { ID } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useLang, useT } from '../../i18n'
import { Popover } from '../../ui/Popover'
import { colorText } from '../../lib/colors'
import { Avatar, RelationChip } from '../cells/display'
import { RelationPicker } from '../cells/pickers'
import { formatBytes } from '../model/files'
import { emptyAnswer, emptyAnswers, SHARED_FILE_MAX, validate, validateAll, type Answer, type Answers, type DateAnswer, type Field, type FieldError } from './fields'

export type SubmitOutcome = { ok: true; rowId?: ID } | { ok: false; message: string }

export interface FormFillProps {
  fields: Field[]
  title: string
  description: string
  submitLabel: string
  onSubmit: (answers: Answers) => Promise<SubmitOutcome>
  /** Public form: no workspace pickers, file size limit. */
  shared?: boolean
  /** Unique prefix for element ids. */
  idBase: string
  /** h1 on the public page, h2 inside a database page. */
  headingLevel?: 1 | 2
  /** Mono label above the title. */
  kicker?: string
  /** Small print under the submit button. */
  footnote?: ReactNode
  /** Extra actions in the "response recorded" state. */
  doneActions?: (outcome: SubmitOutcome) => ReactNode
  /** Submitting is impossible (e.g. a shared form without a webhook). */
  blocked?: string
}

const pad = (n: number) => String(n).padStart(2, '0')
const GROUP_KINDS = new Set(['select', 'multi', 'rating', 'person', 'checkbox', 'files', 'relation'])

export function FormFill({ fields, title, description, submitLabel, onSubmit, shared, idBase, headingLevel = 2, kicker, footnote, doneActions, blocked }: FormFillProps) {
  const t = useT()
  const lang = useLang()
  const [answers, setAnswers] = useState<Answers>(() => emptyAnswers(fields))
  const [showAll, setShowAll] = useState(false)
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle')
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null)
  const [doneAt, setDoneAt] = useState<Date | null>(null)
  const rootRef = useRef<HTMLFormElement>(null)
  const doneRef = useRef<HTMLDivElement>(null)

  // questions can change while the form is open (builder edits): keep what was typed
  useEffect(() => {
    setAnswers((cur) => {
      let changed = false
      const next: Answers = {}
      for (const f of fields) {
        if (f.key in cur) next[f.key] = cur[f.key]
        else {
          next[f.key] = emptyAnswer(f)
          changed = true
        }
      }
      return changed || Object.keys(cur).length !== fields.length ? next : cur
    })
  }, [fields])

  const errors = useMemo(() => validateAll(fields, answers, lang, { shared }), [fields, answers, lang, shared])
  const visibleError = (key: string): FieldError | null => {
    const e = errors[key]
    if (!e) return null
    if (showAll) return e
    // before the first submit only format problems of fields the user has left show up
    return touched[key] && e !== 'required' ? e : null
  }
  const errorCount = showAll ? Object.keys(errors).length : 0

  const set = (key: string, v: Answer) => setAnswers((cur) => ({ ...cur, [key]: v }))
  const touch = (key: string) => setTouched((cur) => (cur[key] ? cur : { ...cur, [key]: true }))

  useEffect(() => {
    if (status === 'done') doneRef.current?.focus()
  }, [status])

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (status === 'sending' || blocked) return
    setShowAll(true)
    const first = fields.find((f) => errors[f.key])
    if (first) {
      const el = rootRef.current?.querySelector<HTMLElement>(`[data-q="${CSS.escape(first.key)}"] :is(input:not([type=file]), textarea, button)`)
      el?.focus()
      return
    }
    setStatus('sending')
    let out: SubmitOutcome
    try {
      out = await onSubmit(answers)
    } catch (err) {
      out = { ok: false, message: err instanceof Error ? err.message : String(err) }
    }
    setOutcome(out)
    if (out.ok) {
      setDoneAt(new Date())
      setStatus('done')
    } else setStatus('failed')
  }

  const reset = () => {
    setAnswers(emptyAnswers(fields))
    setShowAll(false)
    setTouched({})
    setOutcome(null)
    setStatus('idle')
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('input:not([type=file]), textarea')?.focus())
  }

  const H = headingLevel === 1 ? 'h1' : 'h2'

  if (status === 'done')
    return (
      <div className="fm fm--done" ref={doneRef} tabIndex={-1} role="status" aria-live="polite">
        <div className="fm-done__mark" aria-hidden>
          <Check size={26} strokeWidth={2.4} />
        </div>
        <div className="label fm-done__stamp">
          {t('database.form.done.stamp')} · {doneAt ? new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(doneAt) : ''}
        </div>
        <H className="fm-done__title">{t('database.form.done.title')}</H>
        <p className="fm-done__sub">{shared ? t('database.form.done.subShared') : t('database.form.done.sub')}</p>
        <div className="fm-done__actions">
          <button type="button" className="btn btn--ink" onClick={reset}>
            <RotateCcw size={14} /> {t('database.form.done.again')}
          </button>
          {outcome && doneActions?.(outcome)}
        </div>
      </div>
    )

  return (
    <form className="fm" ref={rootRef} noValidate onSubmit={(e) => void submit(e)} aria-labelledby={`${idBase}-title`}>
      <header className="fm-head">
        {kicker && <div className="label fm-head__kicker">{kicker}</div>}
        <H className="fm-title" id={`${idBase}-title`}>
          {title.trim() || t('common.untitled')}
        </H>
        {description.trim() && <p className="fm-desc">{description}</p>}
        {fields.some((f) => f.required) && (
          <p className="label fm-legend">
            <span className="fm-req" aria-hidden>
              *
            </span>{' '}
            {t('database.form.requiredLegend')}
          </p>
        )}
      </header>

      {fields.length === 0 ? (
        <p className="fm-empty label">{t('database.form.noQuestions')}</p>
      ) : (
        <ol className="fm-qs">
          {fields.map((f, i) => (
            <li key={f.key} className="fm-qs__item">
              <Question f={f} index={i} idBase={idBase} value={answers[f.key]} error={visibleError(f.key)} shared={shared} onChange={(v) => set(f.key, v)} onBlur={() => touch(f.key)} />
            </li>
          ))}
        </ol>
      )}

      <div className="fm-foot">
        {status === 'failed' && outcome && !outcome.ok && (
          <div className="fm-fail" role="alert">
            <AlertTriangle size={15} aria-hidden />
            <div>
              <strong>{t('database.form.fail.title')}</strong>
              <span>{outcome.message}</span>
            </div>
          </div>
        )}
        {blocked && (
          <div className="fm-fail" role="note">
            <AlertTriangle size={15} aria-hidden />
            <div>
              <span>{blocked}</span>
            </div>
          </div>
        )}
        <div className="fm-foot__row">
          <button type="submit" className="btn btn--primary btn--lg fm-submit" disabled={status === 'sending' || !!blocked || fields.length === 0}>
            {status === 'sending' ? t('database.form.sending') : status === 'failed' ? t('database.form.retry') : submitLabel.trim() || t('database.form.submitDefault')}
          </button>
          <span className="fm-foot__status label" aria-live="polite">
            {errorCount > 0 && (
              <>
                <span className="led led--on" aria-hidden /> {t(errorCount === 1 ? 'database.form.fix.one' : 'database.form.fix.other', { count: errorCount })}
              </>
            )}
          </span>
        </div>
        {footnote && <div className="fm-foot__note">{footnote}</div>}
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* One question                                                        */
/* ------------------------------------------------------------------ */

interface QuestionProps {
  f: Field
  index: number
  idBase: string
  value: Answer | undefined
  error: FieldError | null
  shared?: boolean
  onChange: (v: Answer) => void
  onBlur: () => void
}

function Question({ f, index, idBase, value, error, shared, onChange, onBlur }: QuestionProps) {
  const t = useT()
  const id = `${idBase}-${f.key}`
  const helpId = f.help.trim() ? `${id}-help` : undefined
  const errId = error ? `${id}-err` : undefined
  const describedBy = [helpId, errId].filter(Boolean).join(' ') || undefined
  const group = GROUP_KINDS.has(f.kind)
  const head = (
    <>
      <span className="fm-q__num" aria-hidden>
        {pad(index + 1)}
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
    <div className="fm-q" data-q={f.key} data-kind={f.kind} data-invalid={!!error || undefined}>
      {group ? (
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
          <AlertTriangle size={13} aria-hidden /> {t(`database.form.err.${error}`, { max: formatBytes(SHARED_FILE_MAX) })}
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
          onChange={(e) => onChange(e.target.value)}
          onBlur={onBlur}
          onKeyDown={(e) => {
            // Ctrl/⌘+Enter sends from a multi-line answer
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
      const ph = f.kind === 'url' ? 'https://' : f.kind === 'email' ? t('database.form.ph.email') : f.kind === 'phone' ? '+49 …' : ''
      return <input id={id} className="input fm-input" type={type} autoComplete={auto} inputMode={f.kind === 'url' ? 'url' : undefined} placeholder={ph} value={text} maxLength={2000} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} {...a11y} />
    }
    case 'number':
      return (
        <span className="fm-num">
          <input id={id} className="input fm-input" type="text" inputMode="decimal" autoComplete="off" value={text} onChange={(e) => onChange(e.target.value)} onBlur={onBlur} {...a11y} />
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
    case 'multi': {
      const multi = f.kind === 'multi'
      const sel = multi ? ((value as string[] | undefined) ?? []) : (value as string | null | undefined) ?? null
      const opts = f.options ?? []
      if (!opts.length) return <p className="label fm-q__none">{t('database.form.noOptions')}</p>
      return (
        <div className="fm-chips">
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
    case 'rating':
      return <RatingInput f={f} id={id} value={typeof value === 'number' ? value : 0} invalid={invalid} onChange={onChange} onBlur={onBlur} />
    case 'files':
      return <FilesInput id={id} value={(value as File[] | undefined) ?? []} shared={shared} onChange={onChange} />
    case 'person':
      return <PersonInput id={id} value={(value as string[] | undefined) ?? []} invalid={invalid} onChange={onChange} onBlur={onBlur} />
    case 'relation':
      return <RelationInput f={f} value={(value as string[] | undefined) ?? []} onChange={onChange} />
  }
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

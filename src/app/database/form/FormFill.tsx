/**
 * Fill mode: the real form. Used by the Form view (rows go into the database) and by the
 * public form page (answers go to the owner's webhook).
 *
 * Forms 2.0: questions may show only if earlier answers match (logic.ts) — hidden questions are
 * skipped, never validated and never submitted — and page breaks split the form into pages:
 * one page at a time, Next checks the page, Back keeps every answer, pages whose questions are
 * all hidden are skipped. The closing screen can carry its own heading, message and redirect.
 */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowLeft, ArrowRight, ArrowUpRight, Check, RotateCcw } from 'lucide-react'
import type { ID } from '../../store/types'
import { useLang, useT } from '../../i18n'
import { emptyAnswer, emptyAnswers, validateAll, type Answer, type Answers, type Field, type FieldError } from './fields'
import { pagesOf, visibleKeys } from './logic'
import type { ShareClosing } from './codec'
import { hostOf } from './webhook'
import { Question } from './Question'

/** unconfirmed: sent, but the receiver gives the browser no way to confirm delivery (no-cors) */
export type SubmitOutcome = { ok: true; rowId?: ID; unconfirmed?: boolean } | { ok: false; message: string }

export interface FormFillProps {
  fields: Field[]
  title: string
  description: string
  submitLabel: string
  /** `visible`: keys of the questions the respondent saw (hidden ones must not be submitted). */
  onSubmit: (answers: Answers, visible: Set<string>) => Promise<SubmitOutcome>
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
  /** Closing screen: heading, message, redirect, "submit another response". */
  closing?: ShareClosing
  /** Follow closing.redirectUrl after a response (public page); otherwise it is shown as a link. */
  redirect?: boolean
}

const pad = (n: number) => String(n).padStart(2, '0')
const REDIRECT_MS = 1600

export function FormFill({ fields, title, description, submitLabel, onSubmit, shared, idBase, headingLevel = 2, kicker, footnote, doneActions, blocked, closing, redirect }: FormFillProps) {
  const t = useT()
  const lang = useLang()
  const [answers, setAnswers] = useState<Answers>(() => emptyAnswers(fields))
  /** pages where Next / Submit was tried: every problem shows there */
  const [checked, setChecked] = useState<ReadonlySet<number>>(() => new Set())
  const [touched, setTouched] = useState<Record<string, boolean>>({})
  const [page, setPage] = useState(0)
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'failed'>('idle')
  const [outcome, setOutcome] = useState<SubmitOutcome | null>(null)
  const [doneAt, setDoneAt] = useState<Date | null>(null)
  const rootRef = useRef<HTMLFormElement>(null)
  const doneRef = useRef<HTMLDivElement>(null)
  const pageMoved = useRef(false)
  /** the answer to focus once the page it is on shows (Submit found a problem there) */
  const focusAfter = useRef<string | null>(null)

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

  const visible = useMemo(() => visibleKeys(fields, answers, lang), [fields, answers, lang])
  const pages = useMemo(() => pagesOf(fields), [fields])
  /** pages with at least one question shown (the others are skipped) */
  const live = useMemo(() => pages.map((_, i) => i).filter((i) => pages[i].some((f) => visible.has(f.key))), [pages, visible])
  // the builder may remove the page being looked at: fall back to the nearest one before it
  const cur = live.includes(page) ? page : ([...live].reverse().find((i) => i < page) ?? live[0] ?? 0)
  const pageOf = useMemo(() => new Map(pages.flatMap((p, i) => p.map((f) => [f.key, i] as const))), [pages])
  const shown = useMemo(() => fields.filter((f) => visible.has(f.key)), [fields, visible])
  const numOf = useMemo(() => new Map(shown.map((f, i) => [f.key, i + 1])), [shown])
  const onPage = (pages[cur] ?? []).filter((f) => visible.has(f.key))
  const nextPage = live.find((i) => i > cur)
  const prevPage = [...live].reverse().find((i) => i < cur)
  const isLast = nextPage === undefined
  const multi = live.length > 1

  const errors = useMemo(() => validateAll(shown, answers, lang, { shared }), [shown, answers, lang, shared])
  const visibleError = (key: string): FieldError | null => {
    const e = errors[key]
    if (!e) return null
    if (checked.has(pageOf.get(key) ?? -1)) return e
    // before Next / Submit only format problems of fields the user has left show up
    return touched[key] && e !== 'required' ? e : null
  }
  const errorCount = checked.has(cur) ? onPage.filter((f) => errors[f.key]).length : 0

  const set = (key: string, v: Answer) => setAnswers((c) => ({ ...c, [key]: v }))
  const touch = (key: string) => setTouched((c) => (c[key] ? c : { ...c, [key]: true }))

  useEffect(() => {
    if (status === 'done') doneRef.current?.focus()
  }, [status])

  const focusFirst = (key: string) => {
    const el = rootRef.current?.querySelector<HTMLElement>(`[data-q="${CSS.escape(key)}"] :is(input:not([type=file]), textarea, select, button)`)
    el?.focus()
  }

  // a new page: its first answer (or the one Submit found a problem with) gets focus
  useEffect(() => {
    if (!pageMoved.current) return
    pageMoved.current = false
    const root = rootRef.current
    root?.querySelector('.fm-progress, .fm-head')?.scrollIntoView({ block: 'nearest' })
    const key = focusAfter.current
    focusAfter.current = null
    if (key) return focusFirst(key)
    root?.querySelector<HTMLElement>('.fm-qs :is(input:not([type=file]), textarea, select, button)')?.focus({ preventScroll: true })
  }, [cur])

  const goTo = (i: number) => {
    pageMoved.current = true
    setPage(i)
  }

  const next = () => {
    setChecked((c) => new Set(c).add(cur))
    const first = onPage.find((f) => errors[f.key])
    if (first) return focusFirst(first.key)
    if (nextPage !== undefined) goTo(nextPage)
  }

  const submit = async () => {
    if (status === 'sending' || blocked) return
    setChecked(new Set(live))
    const first = shown.find((f) => errors[f.key])
    if (first) {
      const p = pageOf.get(first.key) ?? cur
      if (p === cur) return focusFirst(first.key)
      focusAfter.current = first.key
      goTo(p)
      return
    }
    setStatus('sending')
    let out: SubmitOutcome
    try {
      out = await onSubmit(answers, visible)
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
    setChecked(new Set())
    setTouched({})
    setOutcome(null)
    setStatus('idle')
    setPage(0)
    requestAnimationFrame(() => rootRef.current?.querySelector<HTMLElement>('input:not([type=file]), textarea, select')?.focus())
  }

  const H = headingLevel === 1 ? 'h1' : 'h2'
  const H2 = headingLevel === 1 ? 'h2' : 'h3'

  if (status === 'done') return <Done H={H} outcome={outcome} doneAt={doneAt} shared={shared} closing={closing} redirect={redirect} onAgain={reset} doneActions={doneActions} doneRef={doneRef} />

  const section = cur > 0 ? pages[cur]?.[0]?.page : undefined
  return (
    <form
      className="fm"
      ref={rootRef}
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        if (isLast) void submit()
        else next()
      }}
      aria-labelledby={`${idBase}-title`}
    >
      <header className="fm-head">
        {kicker && <div className="label fm-head__kicker">{kicker}</div>}
        <H className="fm-title" id={`${idBase}-title`}>
          {title.trim() || t('common.untitled')}
        </H>
        {cur === (live[0] ?? 0) && description.trim() && <p className="fm-desc">{description}</p>}
        {onPage.some((f) => f.required) && (
          <p className="label fm-legend">
            <span className="fm-req" aria-hidden>
              *
            </span>{' '}
            {t('database.form.requiredLegend')}
          </p>
        )}
      </header>

      {multi && <Progress pos={live.indexOf(cur)} total={live.length} />}

      {section && (section.title.trim() || section.description.trim()) && (
        <div className="fm-section" key={`s${cur}`}>
          {section.title.trim() && <H2 className="fm-section__title">{section.title}</H2>}
          {section.description.trim() && <p className="fm-section__desc">{section.description}</p>}
        </div>
      )}

      {fields.length === 0 ? (
        <p className="fm-empty label">{t('database.form.noQuestions')}</p>
      ) : (
        <ol className="fm-qs" key={`p${cur}`} data-page={cur + 1}>
          {onPage.map((f) => (
            <li key={f.key} className="fm-qs__item">
              <Question f={f} num={numOf.get(f.key) ?? 0} idBase={idBase} value={answers[f.key]} error={visibleError(f.key)} shared={shared} onChange={(v) => set(f.key, v)} onBlur={() => touch(f.key)} />
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
          {prevPage !== undefined && (
            <button type="button" className="btn btn--lg fm-back" onClick={() => goTo(prevPage)}>
              <ArrowLeft size={15} /> {t('database.form.back')}
            </button>
          )}
          {isLast ? (
            <button type="submit" className="btn btn--primary btn--lg fm-submit" disabled={status === 'sending' || !!blocked || fields.length === 0}>
              {status === 'sending' ? t('database.form.sending') : status === 'failed' ? t('database.form.retry') : submitLabel.trim() || t('database.form.submitDefault')}
            </button>
          ) : (
            <button type="submit" className="btn btn--ink btn--lg fm-next">
              {t('database.form.next')} <ArrowRight size={15} />
            </button>
          )}
          <span className="fm-foot__status label" aria-live="polite">
            {errorCount > 0 && (
              <>
                <span className="led led--on" aria-hidden /> {t(errorCount === 1 ? 'database.form.fix.one' : 'database.form.fix.other', { count: errorCount })}
              </>
            )}
          </span>
        </div>
        {footnote && isLast && <div className="fm-foot__note">{footnote}</div>}
      </div>
    </form>
  )
}

/** "PAGE 2 / 3" and a segmented hairline gauge. */
function Progress({ pos, total }: { pos: number; total: number }) {
  const t = useT()
  return (
    <div className="fm-progress">
      <span className="label fm-progress__label" aria-live="polite">
        {t('database.form.page', { n: pad(pos + 1), total: pad(total) })}
      </span>
      <span className="fm-progress__gauge" aria-hidden>
        {Array.from({ length: total }, (_, i) => (
          <span key={i} className="fm-progress__seg" data-state={i < pos ? 'done' : i === pos ? 'now' : 'todo'} />
        ))}
      </span>
    </div>
  )
}

function Done({
  H,
  outcome,
  doneAt,
  shared,
  closing,
  redirect,
  onAgain,
  doneActions,
  doneRef,
}: {
  H: 'h1' | 'h2'
  outcome: SubmitOutcome | null
  doneAt: Date | null
  shared?: boolean
  closing?: ShareClosing
  redirect?: boolean
  onAgain: () => void
  doneActions?: (outcome: SubmitOutcome) => ReactNode
  doneRef: React.RefObject<HTMLDivElement | null>
}) {
  const t = useT()
  const lang = useLang()
  const sentOnly = !!outcome?.ok && !!outcome.unconfirmed
  const url = closing?.redirectUrl?.trim() ?? ''
  const go = !!redirect && !!url

  useEffect(() => {
    if (!go) return
    const id = window.setTimeout(() => window.location.assign(url), REDIRECT_MS)
    return () => window.clearTimeout(id)
  }, [go, url])

  const title = closing?.doneTitle?.trim() || (sentOnly ? t('database.form.done.sentTitle') : t('database.form.done.title'))
  const sub = closing?.doneMessage?.trim() || (sentOnly ? t('database.form.done.sentSub') : shared ? t('database.form.done.subShared') : t('database.form.done.sub'))
  return (
    <div className="fm fm--done" ref={doneRef} tabIndex={-1} role="status" aria-live="polite">
      <div className="fm-done__mark" aria-hidden>
        <Check size={26} strokeWidth={2.4} />
      </div>
      <div className="label fm-done__stamp">
        {sentOnly ? t('database.form.done.sentStamp') : t('database.form.done.stamp')} · {doneAt ? new Intl.DateTimeFormat(lang === 'de' ? 'de-DE' : 'en-GB', { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(doneAt) : ''}
      </div>
      <H className="fm-done__title">{title}</H>
      <p className="fm-done__sub">{sub}</p>
      {url && (
        <p className="label fm-done__next">
          <span className="led led--ok" aria-hidden /> {go ? t('database.form.done.redirecting', { host: hostOf(url) }) : t('database.form.done.redirectNote', { host: hostOf(url) })}
        </p>
      )}
      <div className="fm-done__actions">
        {url && (
          <a className={`btn${go ? ' btn--primary' : ''}`} href={url} {...(go ? {} : { target: '_blank', rel: 'noreferrer' })}>
            <ArrowUpRight size={14} /> {t('database.form.done.continue', { host: hostOf(url) })}
          </a>
        )}
        {closing?.allowAnother !== false && (
          <button type="button" className="btn btn--ink" onClick={onAgain}>
            <RotateCcw size={14} /> {t('database.form.done.again')}
          </button>
        )}
        {outcome && doneActions?.(outcome)}
      </div>
    </div>
  )
}

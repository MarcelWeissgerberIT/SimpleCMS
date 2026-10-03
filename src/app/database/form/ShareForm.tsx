/**
 * "Send responses to a webhook" (URL + test) and the Share dialog that turns the form into a link.
 */
import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { Check, Copy, ExternalLink, Send } from 'lucide-react'
import { Modal } from '../../ui/Modal'
import { useUI } from '../../store/ui'
import { useLang, useT } from '../../i18n'
import type { Translate } from '@/shared/i18n'
import type { DbModel } from '../hooks'
import { fieldsOf, formConfig, isValidHttpUrl, isValidWebhookUrl, sampleJson, type Field } from './fields'
import { encodeShareForm, formUrl, type FormLimitIssue } from './codec'
import { formBody, hostOf, postWebhook, type HookResult } from './webhook'
import { patchForm, useDraft } from './config'

/** Human text for a webhook result. */
export function hookMessage(t: Translate, res: HookResult): string {
  if (res.outcome === 'unconfirmed') return t('database.form.hook.opaque')
  if (res.ok) return t('database.form.hook.ok', { status: res.status, ms: res.ms })
  switch (res.error) {
    case 'url':
      return t('database.form.hook.err.url')
    case 'timeout':
      return t('database.form.hook.err.timeout')
    case 'http':
      return t('database.form.hook.err.http', { status: res.status })
    default:
      return t('database.form.hook.err.network')
  }
}

/** Why a form cannot be shared as it is: names the question and the limit. */
export function limitMessage(t: Translate, issue: FormLimitIssue, lang: string): string {
  const n = (v: number) => new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US').format(v)
  const vars = { limit: n(issue.limit), count: n(issue.count), name: issue.question?.trim() || '—' }
  if (issue.kind === 'encoded') return t('database.form.share.limit.encoded', { kb: n(Math.round(issue.limit / 1024)) })
  return t(`database.form.share.limit.${issue.kind}`, vars)
}

export function formTitle(m: DbModel, untitled: string): string {
  return formConfig(m.view).title?.trim() || m.dbPage.title.trim() || untitled
}

export function WebhookField({ m, fields, autoFocus }: { m: DbModel; fields: Field[]; autoFocus?: boolean }) {
  const t = useT()
  const uid = useId().replace(/:/g, '')
  const cfg = formConfig(m.view)
  const draft = useDraft(cfg.webhookUrl ?? '', (v) => patchForm(m.db.id, m.view.id, (c) => ({ ...c, webhookUrl: v.trim() })), 300)
  const [test, setTest] = useState<{ state: 'idle' | 'busy' | 'done'; res?: HookResult }>({ state: 'idle' })
  const url = draft.value.trim()
  const valid = !url || isValidWebhookUrl(url)
  // a plain-http address (not localhost): answers would cross the network unencrypted
  const insecure = !!url && !valid && isValidHttpUrl(url)
  useEffect(() => setTest({ state: 'idle' }), [url])

  const sendTest = async () => {
    draft.flush()
    setTest({ state: 'busy' })
    const res = await postWebhook(url, formBody(formTitle(m, t('common.untitled')), sampleJson(fields), true))
    setTest({ state: 'done', res })
  }

  let led = ''
  let status = url ? t('database.form.hook.ready') : t('database.form.hook.none')
  if (url && !valid) {
    led = 'led--on'
    status = insecure ? t('database.form.hook.err.https') : t('database.form.hook.err.url')
  } else if (test.state === 'busy') status = t('database.form.hook.sending')
  else if (test.state === 'done' && test.res) {
    // unconfirmed (no-cors): sent, but neither success nor failure — the LED stays neutral
    led = test.res.outcome === 'delivered' ? 'led--ok' : test.res.outcome === 'failed' ? 'led--on' : ''
    status = hookMessage(t, test.res)
  } else if (url) led = 'led--ok'

  return (
    <div className="fb-hook">
      <label className="label fb-hook__label" htmlFor={`${uid}-hook`}>
        {t('database.form.hook.label')}
      </label>
      <div className="fb-hook__row">
        <input
          id={`${uid}-hook`}
          className="input mono fb-hook__input"
          type="url"
          inputMode="url"
          autoComplete="off"
          spellCheck={false}
          placeholder="https://n8n.example.com/webhook/…"
          aria-invalid={!valid || undefined}
          aria-describedby={`${uid}-hook-status`}
          autoFocus={autoFocus}
          {...draft.props}
        />
        <button type="button" className="btn fb-hook__test" disabled={!url || !valid || test.state === 'busy'} onClick={() => void sendTest()}>
          <Send size={13} /> {t('database.form.hook.test')}
        </button>
      </div>
      <p className="fb-hook__status label" id={`${uid}-hook-status`} aria-live="polite">
        <span className={`led ${led}`} aria-hidden /> {status}
      </p>
    </div>
  )
}

async function copyText(text: string, fallback?: HTMLInputElement | null): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text)
    return true
  } catch {
    if (!fallback) return false
    fallback.select()
    try {
      return document.execCommand('copy')
    } catch {
      return false
    }
  }
}

export function ShareFormModal({ m, onClose }: { m: DbModel; onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const uid = useId().replace(/:/g, '')
  const cfg = formConfig(m.view)
  const fields = useMemo(() => fieldsOf(m.db, m.view), [m.db, m.view])
  const hook = (cfg.webhookUrl ?? '').trim()
  const hookOk = isValidWebhookUrl(hook)
  const title = formTitle(m, t('common.untitled'))
  // over a link limit: no link at all (the receiving side would cut questions or options)
  const share = useMemo(
    () => (hookOk ? encodeShareForm({ title, description: cfg.description ?? '', submitLabel: cfg.submitLabel ?? '', webhookUrl: hook, fields }) : null),
    [hookOk, title, cfg.description, cfg.submitLabel, hook, fields],
  )
  const issue = share?.issue ?? null
  const ready = hookOk && !issue
  const url = share?.encoded ? formUrl(share.encoded) : ''
  const [copied, setCopied] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  useEffect(() => {
    if (!copied) return
    const id = window.setTimeout(() => setCopied(false), 1800)
    return () => window.clearTimeout(id)
  }, [copied])
  const kb = new Intl.NumberFormat(lang === 'de' ? 'de-DE' : 'en-US', { maximumFractionDigits: 1, minimumFractionDigits: 1 }).format(url.length / 1024)
  const sample = useMemo(() => JSON.stringify(formBody(title, sampleJson(fields)), null, 2), [title, fields])

  const copy = async () => {
    if (!url) return
    if (await copyText(url, inputRef.current)) setCopied(true)
    else useUI.getState().toast({ message: t('database.form.share.copyFailed'), kind: 'error' })
  }

  return (
    <Modal open onClose={onClose} label={`§ ${t('database.form.share.label')}`} title={t('database.form.share.title')} width={620} className="fshare">
      <p className="fshare__claim">{t('database.form.share.claim')}</p>
      <p className="fshare__sub">{t('database.form.share.sub')}</p>

      <section className="fshare__sec" aria-labelledby={`${uid}-a`}>
        <h3 className="label fshare__h" id={`${uid}-a`}>
          01 — {t('database.form.share.where')}
        </h3>
        <WebhookField m={m} fields={fields} autoFocus={!hookOk} />
        {!hookOk && (
          <div className="fshare__need" role="note">
            <span className="led" aria-hidden />
            <p>{t('database.form.share.needHook')}</p>
          </div>
        )}
      </section>

      <section className="fshare__sec" aria-labelledby={`${uid}-b`}>
        <h3 className="label fshare__h" id={`${uid}-b`}>
          02 — {t('database.form.share.link')}
        </h3>
        <div className="fshare__link" data-ready={ready || undefined}>
          <input
            ref={inputRef}
            className="fshare__url mono"
            readOnly
            value={url || (issue ? t('database.form.share.linkTooBig') : t('database.form.share.linkLocked'))}
            aria-label={t('database.form.share.link')}
            onFocus={(e) => e.currentTarget.select()}
            disabled={!ready}
          />
          <button type="button" className="btn btn--primary fshare__copy" disabled={!ready} onClick={() => void copy()}>
            {copied ? <Check size={14} strokeWidth={2.2} /> : <Copy size={14} />}
            {copied ? t('database.form.share.copied') : t('common.copyLink')}
          </button>
        </div>
        {issue && (
          <div className="fshare__need" role="alert" data-form-limit={issue.kind}>
            <span className="led led--on" aria-hidden />
            <p>{limitMessage(t, issue, lang)}</p>
          </div>
        )}
        {ready && (
          <div className="fshare__meta label">
            <span>
              <span className="led led--ok" aria-hidden /> {t('database.form.share.meta', { kb, count: fields.length, host: hostOf(hook) })}
            </span>
            <a className="fshare__open" href={url} target="_blank" rel="noreferrer">
              {t('database.form.share.open')} <ExternalLink size={12} strokeWidth={1.8} />
            </a>
          </div>
        )}
        <p className="fshare__privacy">{t('database.form.share.privacy')}</p>
      </section>

      <details className="fshare__payload">
        <summary className="label">{t('database.form.share.payload')}</summary>
        <pre className="mono">{sample}</pre>
      </details>
    </Modal>
  )
}

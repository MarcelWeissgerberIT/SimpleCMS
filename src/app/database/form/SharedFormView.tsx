/**
 * Public form page (#/f/<payload>). Nothing here touches the visitor's workspace: the answers
 * are POSTed from this browser straight to the form owner's webhook.
 */
import { useEffect, useId, useMemo } from 'react'
import { ArrowRight, ShieldCheck } from 'lucide-react'
import { useLang, useT } from '../../i18n'
import { navigate } from '../../lib/router'
import { logoMarkSvg } from '@/shared/logo'
import { BRAND } from '@/shared/brand'
import { answersToJson, type Answers } from './fields'
import { FormDecodeError, decodeForm, payloadFields, type FormPayload } from './codec'
import { formBody, hostOf, postWebhook } from './webhook'
import { FormFill, type SubmitOutcome } from './FormFill'
import { hookMessage } from './ShareForm'
import './form.css'

export default function SharedFormView({ payload }: { payload: string }) {
  const t = useT()
  const lang = useLang()
  const uid = useId().replace(/:/g, '')
  const decoded = useMemo<{ form: FormPayload } | { error: FormDecodeError['code'] }>(() => {
    try {
      return { form: decodeForm(payload) }
    } catch (e) {
      return { error: e instanceof FormDecodeError ? e.code : 'corrupt' }
    }
  }, [payload])
  const form = 'form' in decoded ? decoded.form : null
  const fields = useMemo(() => (form ? payloadFields(form) : []), [form])
  const title = form?.title.trim() || t('common.untitled')

  useEffect(() => {
    const prev = document.title
    document.title = form ? `${title} — ${BRAND.short}` : `${t('database.form.public.errorTitle')} — ${BRAND.short}`
    return () => {
      document.title = prev
    }
  }, [form, title, t])

  const onSubmit = async (answers: Answers): Promise<SubmitOutcome> => {
    if (!form?.hook) return { ok: false, message: t('database.form.public.noHook') }
    const res = await postWebhook(form.hook, formBody(title, await answersToJson(fields, answers, lang)))
    // no-cors fallback: the answers left the browser, but delivery can't be confirmed — say "Sent", not "recorded"
    return res.ok ? { ok: true, unconfirmed: res.outcome === 'unconfirmed' } : { ok: false, message: hookMessage(t, res) }
  }

  return (
    <div className="pf">
      <header className="pf__bar">
        <a className="pf__brand" href="#/" aria-label={BRAND.name}>
          <span className="pf__mark" dangerouslySetInnerHTML={{ __html: logoMarkSvg(20) }} />
          <span className="label pf__via">{t('database.form.public.via')}</span>
        </a>
        <span className="pf__spacer" />
        {form?.hook && (
          <span className="label pf__dest" title={form.hook}>
            <ShieldCheck size={13} aria-hidden /> <span className="pf__dest-text">{t('database.form.public.dest', { host: hostOf(form.hook) })}</span>
          </span>
        )}
      </header>

      {form ? (
        <main className="pf__main">
          <div className="pf__sheet">
            <FormFill
              fields={fields}
              title={title}
              description={form.desc}
              submitLabel={form.submit}
              onSubmit={onSubmit}
              shared
              idBase={`pf${uid}`}
              headingLevel={1}
              kicker={`§ ${t('database.form.kicker')}`}
              blocked={form.hook ? undefined : t('database.form.public.noHook')}
              footnote={form.hook ? t('database.form.public.note', { host: hostOf(form.hook) }) : undefined}
            />
          </div>
          <footer className="pf__foot">
            <span className="pf__foot-rule" />
            <p>{t('database.form.public.footer')}</p>
            <a className="pf__foot-link" href="#/">
              {t('database.form.public.make', { name: BRAND.name })} <ArrowRight size={13} strokeWidth={1.8} />
            </a>
          </footer>
        </main>
      ) : (
        <main className="pf__error" role="alert">
          <span className="label pf__err-code">ERR · {t(`database.form.public.code.${'error' in decoded ? decoded.error : 'corrupt'}`)}</span>
          <h1 className="pf__err-title">{t('database.form.public.errorTitle')}</h1>
          <p>{t(`database.form.public.error.${'error' in decoded ? decoded.error : 'corrupt'}`)}</p>
          <button type="button" className="btn btn--ink" onClick={() => navigate({ name: 'home' })}>
            {t('database.form.public.toApp')} <ArrowRight size={14} />
          </button>
        </main>
      )}
    </div>
  )
}

import { useEffect, useId, useRef, useState } from 'react'
import { AlertTriangle, ArrowRight, CornerDownLeft, HardDrive } from 'lucide-react'
import { useLang, useT } from '../../i18n'
import { cloudApi } from './api'
import { errorText } from './errors'
import { CloudFrame, SheetHead, type Step } from './Frame'

const COOLDOWN_S = 30
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

export type SignInFlow = ReturnType<typeof useSignInFlow>

/** Email → magic link → "check your inbox", with a resend cooldown. Shared by sign-in and invite screens. */
export function useSignInFlow(invite?: string) {
  const t = useT()
  const lang = useLang()
  const [email, setEmail] = useState('')
  const [phase, setPhase] = useState<'form' | 'sent'>('form')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  const [cooldown, setCooldown] = useState(0)

  useEffect(() => {
    if (cooldown <= 0) return
    const id = window.setTimeout(() => setCooldown((c) => c - 1), 1000)
    return () => window.clearTimeout(id)
  }, [cooldown])

  const send = async (again: boolean) => {
    const address = email.trim()
    if (!EMAIL_RE.test(address)) {
      setError(t('shell.cloud.signin.invalid'))
      return
    }
    setBusy(true)
    setError(null)
    setNotice(null)
    try {
      await cloudApi.requestSignIn(address, { invite, lang })
      setPhase('sent')
      setCooldown(COOLDOWN_S)
      if (again) setNotice(t('shell.cloud.inbox.resent'))
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }

  return {
    email,
    setEmail: (v: string) => {
      setEmail(v)
      if (error) setError(null)
    },
    phase,
    busy,
    error,
    notice,
    cooldown,
    submit: () => void send(false),
    resend: () => void send(true),
    reset: () => {
      setPhase('form')
      setError(null)
      setNotice(null)
    },
  }
}

export function SignInForm({ flow, autoFocus = true }: { flow: SignInFlow; autoFocus?: boolean }) {
  const t = useT()
  const id = useId()
  return (
    <form
      className="cl-form"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        flow.submit()
      }}
    >
      <label className="label cl-form__label" htmlFor={`${id}-email`}>
        {t('shell.cloud.signin.email')}
      </label>
      <div className="cl-form__row">
        <input
          id={`${id}-email`}
          className="input cl-form__input"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="off"
          spellCheck={false}
          autoFocus={autoFocus}
          placeholder={t('shell.cloud.signin.emailPh')}
          value={flow.email}
          onChange={(e) => flow.setEmail(e.target.value)}
          aria-invalid={flow.error ? true : undefined}
          aria-describedby={flow.error ? `${id}-err` : undefined}
          data-autofocus={autoFocus ? '' : undefined}
        />
        <button type="submit" className="btn btn--primary btn--lg cl-form__submit" disabled={flow.busy}>
          {flow.busy ? t('shell.cloud.signin.sending') : t('shell.cloud.signin.send')}
          {!flow.busy && <CornerDownLeft size={14} aria-hidden />}
        </button>
      </div>
      {flow.error && (
        <p className="cl-err" id={`${id}-err`} role="alert">
          <AlertTriangle size={13} aria-hidden />
          {flow.error}
        </p>
      )}
    </form>
  )
}

export function CheckInbox({ flow }: { flow: SignInFlow }) {
  const t = useT()
  const head = useRef<HTMLHeadingElement>(null)
  useEffect(() => head.current?.focus({ preventScroll: true }), [])
  return (
    <div className="cl-inbox">
      <h2 ref={head} tabIndex={-1} className="display cl-title cl-title--sm">
        {t('shell.cloud.inbox.title')}
      </h2>
      <p className="cl-lede">
        {t('shell.cloud.inbox.sentTo')} <strong className="cl-addr">{flow.email.trim()}</strong>. {t('shell.cloud.inbox.body')}
      </p>
      <div className="cl-actions">
        <button type="button" className="btn btn--lg" disabled={flow.busy || flow.cooldown > 0} onClick={flow.resend}>
          {flow.cooldown > 0 ? (
            <span className="cl-count">{t('shell.cloud.inbox.resendIn', { s: String(flow.cooldown).padStart(2, '0') })}</span>
          ) : flow.busy ? (
            t('shell.cloud.signin.sending')
          ) : (
            t('shell.cloud.inbox.resend')
          )}
        </button>
        <button type="button" className="btn btn--ghost btn--lg" onClick={flow.reset}>
          {t('shell.cloud.inbox.other')}
        </button>
      </div>
      {flow.notice && (
        <p className="cl-note" role="status">
          {flow.notice}
        </p>
      )}
      {flow.error && (
        <p className="cl-err" role="alert">
          <AlertTriangle size={13} aria-hidden />
          {flow.error}
        </p>
      )}
      <p className="cl-fine">{t('shell.cloud.inbox.nothing')}</p>
    </div>
  )
}

export function signInSteps(t: (k: string) => string, phase: 'form' | 'sent'): Step[] {
  return [
    { label: t('shell.cloud.step.email'), state: phase === 'form' ? 'now' : 'done' },
    { label: t('shell.cloud.step.link'), state: phase === 'sent' ? 'now' : 'next' },
    { label: t('shell.cloud.step.in'), state: 'next' },
  ]
}

/** Shown when a cloud workspace is selected but this browser has no session. */
export function SignInScreen() {
  const t = useT()
  const flow = useSignInFlow()
  return (
    <CloudFrame
      docTitle={t('shell.cloud.signin.doc')}
      steps={signInSteps(t, flow.phase)}
      status={{ led: flow.phase === 'sent' ? 'on' : 'off', text: flow.phase === 'sent' ? t('shell.cloud.inbox.title') : t('shell.cloud.signedOut') }}
    >
      {flow.phase === 'form' ? (
        <>
          <SheetHead section={t('shell.cloud.signin.section')} code="FORM T-1" />
          <h1 className="display cl-title">{t('shell.cloud.signin.title')}</h1>
          <p className="cl-lede">{t('shell.cloud.signin.lede')}</p>
          <SignInForm flow={flow} />
        </>
      ) : (
        <>
          <SheetHead section={t('shell.cloud.inbox.section')} code="FORM T-2" />
          <CheckInbox flow={flow} />
        </>
      )}
      <LocalEscape />
    </CloudFrame>
  )
}

/** "Use this browser's local workspace instead" — always there, never a dead end. */
export function LocalEscape() {
  const t = useT()
  return (
    <div className="cl-escape">
      <button type="button" className="cl-escape__btn" onClick={() => cloudApi.switchWorkspace({ kind: 'local', id: 'local' })}>
        <HardDrive size={15} aria-hidden />
        <span className="cl-escape__text">
          <span className="cl-escape__label">{t('shell.cloud.signin.local')}</span>
          <span className="cl-escape__hint">{t('shell.cloud.signin.localHint')}</span>
        </span>
        <ArrowRight size={15} aria-hidden className="cl-escape__arrow" />
      </button>
    </div>
  )
}

import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, RotateCw } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { useCloud, type SignupPreview } from '../../cloud'
import { navigate } from '../../lib/router'
import { useLang, useT } from '../../i18n'
import { fmtDay } from '../lib/format'
import { cloudApi } from './api'
import { DEAD_SIGNUP, errorCode, errorText } from './errors'
import { CloudFrame, SheetHead, type Step } from './Frame'
import { CheckInbox, SignInForm, useSignInFlow } from './SignIn'

type Load = { state: 'loading' } | { state: 'ready'; preview: SignupPreview } | { state: 'dead' | 'error' | 'no-server'; message: string }

/**
 * #/signup/<token>: a registration link (docs/CLOUD.md § Invites & registration links). Preview →
 * email → magic link (the token rides along and is checked again when the account is created) → the
 * person's own space. Signed in already: straight to that space.
 */
export function SignupScreen({ token }: { token: string }) {
  const t = useT()
  const lang = useLang()
  const { user, own } = useCloud(useShallow((s) => ({ user: s.user, own: s.workspaces.find((w) => w.personal)?.id ?? null })))
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const flow = useSignInFlow(undefined, token, load.state === 'ready' ? (load.preview.domains ?? undefined) : undefined)

  const fetchPreview = useCallback(() => {
    let live = true
    setLoad({ state: 'loading' })
    cloudApi
      .previewSignupLink(token)
      .then((preview) => live && setLoad({ state: 'ready', preview }))
      .catch((e) => {
        if (!live) return
        const code = errorCode(e)
        setLoad({ state: code === 'unavailable' ? 'no-server' : DEAD_SIGNUP.has(code) ? 'dead' : 'error', message: errorText(e, t) })
      })
    return () => {
      live = false
    }
  }, [token, t])

  // signed in: the account exists — nothing to read from the link
  useEffect(() => (user ? undefined : fetchPreview()), [token, !!user]) // eslint-disable-line react-hooks/exhaustive-deps

  const openSpace = () => {
    // the reload must not land on this link again
    history.replaceState(null, '', '#/')
    if (own) cloudApi.switchWorkspace({ kind: 'cloud', id: own })
    else navigate({ name: 'home' }, { replace: true })
  }
  const leave = () => navigate({ name: 'home' }, { replace: true })

  const server = (load.state === 'ready' && load.preview.server) || window.location.host
  const steps: Step[] = [
    { label: t('shell.cloud.step.email'), state: user || flow.phase === 'sent' ? 'done' : load.state === 'ready' ? 'now' : 'next' },
    { label: t('shell.cloud.step.link'), state: user ? 'done' : flow.phase === 'sent' ? 'now' : 'next' },
    { label: t('shell.cloud.signup.stepSpace'), state: user ? 'now' : 'next' },
  ]
  const status = user
    ? { led: 'ok' as const, text: t('shell.cloud.invite.signedInAs', { email: user.email }) }
    : load.state === 'loading'
      ? { led: 'on' as const, text: t('shell.cloud.signup.loading') }
      : load.state === 'ready'
        ? { led: flow.phase === 'sent' ? ('on' as const) : ('off' as const), text: flow.phase === 'sent' ? t('shell.cloud.status.sent') : t('shell.cloud.status.signedOut') }
        : { led: 'off' as const, text: load.state === 'no-server' ? t('shell.cloud.status.noServer') : load.state === 'dead' ? t('shell.cloud.status.signupDead') : t('shell.cloud.err.network') }

  return (
    <CloudFrame docTitle={t('shell.cloud.signup.doc')} steps={steps} status={status}>
      <SheetHead section={t('shell.cloud.signup.section')} code="FORM R-0" />

      {user ? (
        <div className="cl-join" data-testid="signup-done">
          <h1 className="display cl-title">{t('shell.cloud.signup.inTitle')}</h1>
          <p className="cl-lede">{t('shell.cloud.signup.inLede', { email: user.email })}</p>
          <div className="cl-actions">
            <button type="button" className="btn btn--primary btn--lg" onClick={openSpace} data-autofocus="" autoFocus>
              {t('shell.cloud.signup.open')}
              <ArrowRight size={14} aria-hidden />
            </button>
          </div>
          <button type="button" className="cl-textbtn" onClick={() => void cloudApi.signOut().catch(() => undefined)}>
            {t('shell.cloud.invite.otherAccount')}
          </button>
        </div>
      ) : load.state === 'loading' ? (
        <p className="cl-lede cl-loading" role="status">
          {t('shell.cloud.signup.loading')}
        </p>
      ) : load.state !== 'ready' ? (
        <div className="cl-dead">
          <h1 className="display cl-title cl-title--sm">
            {load.state === 'no-server' ? t('shell.cloud.signup.noServerTitle') : load.state === 'dead' ? t('shell.cloud.signup.deadTitle') : t('shell.cloud.err.network')}
          </h1>
          <p className="cl-err cl-err--block" role="alert">
            <AlertTriangle size={14} aria-hidden />
            {load.message}
          </p>
          {load.state === 'dead' && <p className="cl-fine">{t('shell.cloud.signup.deadHint')}</p>}
          <div className="cl-actions">
            {load.state === 'error' && (
              <button type="button" className="btn btn--ink btn--lg" onClick={fetchPreview}>
                <RotateCw size={14} aria-hidden />
                {t('shell.cloud.team.retry')}
              </button>
            )}
            <button type="button" className={`btn btn--lg ${load.state === 'error' ? 'btn--ghost' : 'btn--ink'}`} onClick={leave}>
              {t('shell.cloud.signup.openApp')}
              <ArrowRight size={14} aria-hidden />
            </button>
          </div>
        </div>
      ) : flow.phase === 'sent' ? (
        <CheckInbox flow={flow} />
      ) : (
        <>
          <h1 className="display cl-title cl-title--sm cl-title--wrap">{t('shell.cloud.signup.title', { server })}</h1>
          <p className="cl-lede">{t('shell.cloud.signup.lede')}</p>
          <dl className="cl-card">
            <div>
              <dt>{t('shell.cloud.signup.server')}</dt>
              <dd className="cl-addr">{server}</dd>
            </div>
            <div>
              <dt>{t('shell.cloud.signup.valid')}</dt>
              <dd>{fmtDay(load.preview.expires_at, lang)}</dd>
            </div>
            {load.preview.domains && load.preview.domains.length > 0 && (
              <div>
                <dt>{t('shell.cloud.invite.onlyFor')}</dt>
                <dd className="cl-addr">{load.preview.domains.map((d) => `@${d}`).join(', ')}</dd>
              </div>
            )}
            {load.preview.places_left !== undefined && (
              <div data-testid="signup-places">
                <dt>{t('shell.cloud.invite.places')}</dt>
                <dd>
                  <span className="cl-places">{t('shell.cloud.invite.placesV', { n: load.preview.places_left, max: load.preview.max_uses ?? load.preview.places_left })}</span>
                  <span className="cl-card__hint">{t('shell.cloud.invite.adminsOnly')}</span>
                </dd>
              </div>
            )}
          </dl>
          <p className="cl-fine cl-join__who">{t('shell.cloud.signup.formHint')}</p>
          <SignInForm flow={flow} />
        </>
      )}
    </CloudFrame>
  )
}

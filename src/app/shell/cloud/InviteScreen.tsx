import { useCallback, useEffect, useState } from 'react'
import { AlertTriangle, ArrowRight, RotateCw } from 'lucide-react'
import { useCloud, type Role } from '../../cloud'
import { navigate } from '../../lib/router'
import { useLang, useT } from '../../i18n'
import { fmtDay } from '../lib/format'
import { cloudApi } from './api'
import { DEAD_INVITE, errorCode, errorText } from './errors'
import { CloudFrame, SheetHead, type Step } from './Frame'
import { CheckInbox, SignInForm, useSignInFlow } from './SignIn'
import { roleLabel } from './state'

interface Preview {
  workspace: string
  role: Role
  inviter: string | null
  email: string | null
  expires: number | null
}

/** The core passes the server's preview through; read it defensively (inviter is a name or { name, email }). */
function readPreview(raw: unknown): Preview {
  const p = (raw ?? {}) as { workspace?: { name?: string }; role?: Role; inviter?: unknown; email?: unknown; expires_at?: unknown }
  let inviter: string | null = null
  if (typeof p.inviter === 'string') inviter = p.inviter.trim() || null
  else if (p.inviter && typeof p.inviter === 'object') {
    const o = p.inviter as { name?: string; email?: string }
    inviter = o.name?.trim() || o.email || null
  }
  const exp = typeof p.expires_at === 'string' || typeof p.expires_at === 'number' ? new Date(p.expires_at).getTime() : NaN
  return {
    workspace: p.workspace?.name?.trim() || '—',
    role: p.role ?? 'member',
    inviter,
    email: typeof p.email === 'string' && p.email ? p.email : null,
    expires: Number.isFinite(exp) ? exp : null,
  }
}

type Load = { state: 'loading' } | { state: 'ready'; preview: Preview } | { state: 'dead' | 'error' | 'no-server'; message: string }

/** #/invite/<token>: preview → sign in if needed → join → open the workspace. */
export function InviteScreen({ token }: { token: string }) {
  const t = useT()
  const lang = useLang()
  const user = useCloud((s) => s.user)
  const [load, setLoad] = useState<Load>({ state: 'loading' })
  const [joining, setJoining] = useState(false)
  const [joinError, setJoinError] = useState<{ code: string; text: string } | null>(null)
  const flow = useSignInFlow(token)

  const fetchPreview = useCallback(() => {
    let live = true
    setLoad({ state: 'loading' })
    cloudApi
      .previewInvite(token)
      .then((raw) => live && setLoad({ state: 'ready', preview: readPreview(raw) }))
      .catch((e) => {
        if (!live) return
        const code = errorCode(e)
        setLoad({ state: code === 'unavailable' ? 'no-server' : DEAD_INVITE.has(code) ? 'dead' : 'error', message: errorText(e, t) })
      })
    return () => {
      live = false
    }
  }, [token, t])

  useEffect(() => fetchPreview(), [token]) // eslint-disable-line react-hooks/exhaustive-deps

  const join = async () => {
    setJoining(true)
    setJoinError(null)
    try {
      const { workspaceId } = await cloudApi.acceptInvite(token)
      // the reload must not land on this invite again
      history.replaceState(null, '', '#/')
      cloudApi.switchWorkspace({ kind: 'cloud', id: workspaceId })
    } catch (e) {
      setJoinError({ code: errorCode(e), text: errorText(e, t) })
      setJoining(false)
    }
  }

  const leave = () => navigate({ name: 'home' }, { replace: true })
  const signedIn = !!user
  const steps: Step[] = [
    { label: t('shell.cloud.step.email'), state: signedIn || flow.phase === 'sent' ? 'done' : load.state === 'ready' ? 'now' : 'next' },
    { label: t('shell.cloud.step.link'), state: signedIn ? 'done' : flow.phase === 'sent' ? 'now' : 'next' },
    { label: t('shell.cloud.step.join'), state: signedIn && load.state === 'ready' ? 'now' : 'next' },
  ]
  const status =
    load.state === 'loading'
      ? { led: 'on' as const, text: t('shell.cloud.invite.loading') }
      : load.state === 'ready'
        ? { led: 'ok' as const, text: signedIn ? t('shell.cloud.invite.signedInAs', { email: user.email }) : t('shell.cloud.signedOut') }
        : { led: 'off' as const, text: load.state === 'no-server' ? t('shell.cloud.invite.noServerTitle') : t('shell.cloud.invite.deadTitle') }

  return (
    <CloudFrame docTitle={t('shell.cloud.invite.doc')} steps={steps} status={status}>
      <SheetHead section={t('shell.cloud.invite.section')} code={load.state === 'ready' && load.preview.expires ? `${t('shell.cloud.invite.expires')} ${fmtDay(load.preview.expires, lang)}` : 'FORM T-0'} />
      {load.state === 'loading' && (
        <p className="cl-lede cl-loading" role="status">
          {t('shell.cloud.invite.loading')}
        </p>
      )}

      {(load.state === 'dead' || load.state === 'no-server' || load.state === 'error') && (
        <div className="cl-dead">
          <h1 className="display cl-title cl-title--sm">{load.state === 'no-server' ? t('shell.cloud.invite.noServerTitle') : load.state === 'dead' ? t('shell.cloud.invite.deadTitle') : t('shell.cloud.err.network')}</h1>
          <p className="cl-err cl-err--block" role="alert">
            <AlertTriangle size={14} aria-hidden />
            {load.message}
          </p>
          {load.state === 'dead' && <p className="cl-fine">{t('shell.cloud.invite.deadHint')}</p>}
          <div className="cl-actions">
            {load.state === 'error' && (
              <button type="button" className="btn btn--ink btn--lg" onClick={fetchPreview}>
                <RotateCw size={14} aria-hidden />
                {t('shell.cloud.team.retry')}
              </button>
            )}
            <button type="button" className={`btn btn--lg ${load.state === 'error' ? 'btn--ghost' : 'btn--ink'}`} onClick={leave}>
              {t('shell.cloud.invite.open')}
              <ArrowRight size={14} aria-hidden />
            </button>
          </div>
        </div>
      )}

      {load.state === 'ready' && (
        <>
          <h1 className="display cl-title">{t('shell.cloud.invite.title')}</h1>
          <p className="cl-lede">
            {load.preview.inviter
              ? t('shell.cloud.invite.lede', { inviter: load.preview.inviter, workspace: load.preview.workspace, role: roleLabel(t, load.preview.role) })
              : t('shell.cloud.invite.ledeAnon', { workspace: load.preview.workspace, role: roleLabel(t, load.preview.role) })}
          </p>
          <dl className="cl-card">
            <div>
              <dt>{t('shell.cloud.invite.workspace')}</dt>
              <dd className="cl-card__ws">{load.preview.workspace}</dd>
            </div>
            <div>
              <dt>{t('shell.cloud.invite.role')}</dt>
              <dd>
                <span className="cl-role" data-role={load.preview.role}>
                  {roleLabel(t, load.preview.role)}
                </span>
                <span className="cl-card__hint">{t(`shell.cloud.roleHint.${load.preview.role}`)}</span>
              </dd>
            </div>
            {load.preview.inviter && (
              <div>
                <dt>{t('shell.cloud.invite.from')}</dt>
                <dd>{load.preview.inviter}</dd>
              </div>
            )}
            {load.preview.email && (
              <div>
                <dt>{t('shell.cloud.invite.forEmail')}</dt>
                <dd className="cl-addr">{load.preview.email}</dd>
              </div>
            )}
          </dl>

          {signedIn ? (
            <div className="cl-join">
              <p className="cl-fine cl-join__who">{t('shell.cloud.invite.signedInAs', { email: user.email })}</p>
              <div className="cl-actions">
                <button type="button" className="btn btn--primary btn--lg" onClick={() => void join()} disabled={joining} data-autofocus="" autoFocus>
                  {joining ? t('shell.cloud.invite.joining') : t('shell.cloud.invite.join', { workspace: load.preview.workspace })}
                  {!joining && <ArrowRight size={14} aria-hidden />}
                </button>
                <button type="button" className="btn btn--ghost btn--lg" onClick={leave}>
                  {t('shell.cloud.invite.notNow')}
                </button>
              </div>
              {joinError && (
                <p className="cl-err" role="alert">
                  <AlertTriangle size={13} aria-hidden />
                  {joinError.text}
                </p>
              )}
              {(joinError?.code === 'invite_email_mismatch' || load.preview.email) && (
                <button type="button" className="cl-textbtn" onClick={() => void cloudApi.signOut().catch(() => undefined)}>
                  {t('shell.cloud.invite.otherAccount')}
                </button>
              )}
            </div>
          ) : flow.phase === 'form' ? (
            <>
              <p className="cl-fine cl-join__who">{t('shell.cloud.invite.signInFirst')}</p>
              <SignInForm flow={flow} />
            </>
          ) : (
            <CheckInbox flow={flow} />
          )}
        </>
      )}
    </CloudFrame>
  )
}

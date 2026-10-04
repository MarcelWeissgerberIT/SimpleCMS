/**
 * Settings → Server (server admins only, ADMIN_EMAILS on the server): who may create an account here,
 * and registration links for invite-only servers — create (shown once), list with uses, revoke.
 * docs/CLOUD.md § Invites & registration links.
 */
import { useCallback, useEffect, useId, useState } from 'react'
import { AlertTriangle, KeyRound, RotateCw } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import { useShallow } from 'zustand/react/shallow'
import { useCloud, type SignupLink } from '../../cloud'
import { useUI } from '../../store/ui'
import { useLang, useT } from '../../i18n'
import { Led } from '../../ui/controls'
import { plural } from '../lib/format'
import { cloudApi } from './api'
import { errorText } from './errors'
import { DAY_CHOICES, Select, USE_CHOICES } from './Invites'
import { LinkPanel, daysLeft, linkSpec, parseDomainInput } from './LinkField'
import './cloud.css'

function Sect({ n, label, count }: { n: string; label: string; count?: number }) {
  return (
    <div className="tm-sect">
      <span className="tm-sect__n">{n}</span>
      <span className="label">{label}</span>
      <span className="tm-sect__rule" aria-hidden />
      {count !== undefined && <span className="tm-sect__n">{String(count).padStart(2, '0')}</span>}
    </div>
  )
}

export function ServerTab() {
  const t = useT()
  const { mode, domains } = useCloud(useShallow((s) => ({ mode: s.signup ?? null, domains: s.signupDomains ?? [] })))
  const host = window.location.host
  return (
    <>
      <h3 className="st-h">{t('shell.cloud.server.title')}</h3>
      <p className="st-p">{t('shell.cloud.server.body', { host })}</p>
      <Sect n="01" label={t('shell.cloud.server.signup')} />
      <div className="sv-mode" data-testid="signup-mode">
        <Led state={mode === 'open' ? 'on' : 'ok'} />
        <span className="label">{t('shell.cloud.server.modeLabel')}</span>
        <strong className="sv-mode__value">{mode ? t(`shell.cloud.server.mode.${mode}`) : '—'}</strong>
        {mode === 'domains' &&
          domains.map((d) => (
            <span key={d} className="tm-domain">
              @{d}
            </span>
          ))}
      </div>
      {mode && <p className="st-p sv-hint">{t(`shell.cloud.server.modeHint.${mode}`, { domains: domains.map((d) => `@${d}`).join(', ') })}</p>}
      {mode === 'open' ? (
        <LinkPanel label={t('shell.cloud.server.signupUrl')} link={`${window.location.origin}/app/`} hint={t('shell.cloud.server.admins')} testId="signup-url" />
      ) : (
        <SignupLinks />
      )}
    </>
  )
}

function SignupLinks() {
  const t = useT()
  const lang = useLang()
  const uid = useId()
  const [links, setLinks] = useState<SignupLink[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [days, setDays] = useState(7)
  const [uses, setUses] = useState(1)
  const [domains, setDomains] = useState('')
  const [label, setLabel] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<SignupLink | null>(null)
  const [confirm, setConfirm] = useState<string | null>(null)
  const locale = lang === 'de' ? de : enUS
  const ago = (ms: number) => formatDistanceToNowStrict(ms, { addSuffix: true, locale })
  const domainList = parseDomainInput(domains)

  const reload = useCallback(async () => {
    setLoadError(null)
    try {
      setLinks(await cloudApi.listSignupLinks())
    } catch (e) {
      setLoadError(errorText(e, t))
    }
  }, [t])
  useEffect(() => {
    void reload()
  }, [reload])

  const create = async () => {
    if (!domainList) return setError(t('shell.cloud.inv.domainsInvalid'))
    setBusy(true)
    setError(null)
    try {
      const link = await cloudApi.createSignupLink({ maxUses: uses, days, domains: domainList, label })
      setCreated(link)
      setLabel('')
      void reload()
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (link: SignupLink) => {
    try {
      await cloudApi.revokeSignupLink(link.id)
      setLinks((list) => (list ?? []).filter((x) => x.id !== link.id))
      if (created?.id === link.id) setCreated(null)
      setConfirm(null)
      useUI.getState().toast({ message: t('shell.cloud.server.revoked') })
    } catch (e) {
      useUI.getState().toast({ message: errorText(e, t), kind: 'error' })
    }
  }

  return (
    <>
      <Sect n="02" label={t('shell.cloud.server.links')} count={links?.length} />
      <form
        className="tm-inviter"
        data-testid="signup-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <div className="tm-fields sv-fields">
          <Select id={`${uid}-days`} label={t('shell.cloud.inv.valid')} value={days} onChange={setDays} options={DAY_CHOICES.map((n) => ({ value: n, label: t(plural('shell.cloud.inv.days', n), { n }) }))} />
          <Select
            id={`${uid}-uses`}
            label={t('shell.cloud.inv.uses')}
            value={uses}
            onChange={setUses}
            options={USE_CHOICES.map((n) => ({ value: n, label: n === 1 ? t('shell.cloud.inv.usesSingle') : t('shell.cloud.inv.usesN', { n }) }))}
          />
          <div className="tm-field">
            <label className="label" htmlFor={`${uid}-domains`}>
              {t('shell.cloud.inv.domains')}
            </label>
            <input
              id={`${uid}-domains`}
              className="input tm-mono"
              value={domains}
              placeholder={t('shell.cloud.inv.domainsPh')}
              autoComplete="off"
              autoCapitalize="off"
              spellCheck={false}
              aria-invalid={domainList ? undefined : true}
              onChange={(e) => setDomains(e.target.value)}
            />
          </div>
          <div className="tm-field">
            <label className="label" htmlFor={`${uid}-label`}>
              {t('shell.cloud.server.label')}
            </label>
            <input id={`${uid}-label`} className="input" value={label} maxLength={80} placeholder={t('shell.cloud.server.labelPh')} autoComplete="off" onChange={(e) => setLabel(e.target.value)} />
          </div>
        </div>
        <div className="tm-inviter__foot">
          <p className="tm-invite__hint">{t('shell.cloud.server.admins')}</p>
          <button type="submit" className="btn btn--ink" disabled={busy}>
            <KeyRound size={14} aria-hidden />
            {busy ? t('shell.cloud.server.creating') : t('shell.cloud.server.create')}
          </button>
        </div>
      </form>
      {error && (
        <p className="cl-err" role="alert">
          <AlertTriangle size={13} aria-hidden />
          {error}
        </p>
      )}
      {created?.link && (
        <LinkPanel
          label={t('shell.cloud.server.link')}
          link={created.link}
          testId="signup-link"
          spec={linkSpec(t, { days: daysLeft(created.expires_at), maxUses: created.max_uses, uses: created.uses, domains: created.domains })}
          hint={t('shell.cloud.server.linkHint')}
        />
      )}
      {loadError ? (
        <div className="tm-status" role="alert">
          <AlertTriangle size={14} className="faint" aria-hidden />
          <span>{loadError}</span>
          <button type="button" className="btn btn--sm" onClick={() => void reload()}>
            <RotateCw size={12} aria-hidden />
            {t('shell.cloud.team.retry')}
          </button>
        </div>
      ) : !links ? (
        <div className="tm-status" role="status">
          <Led state="on" />
          {t('shell.cloud.team.loading')}
        </div>
      ) : links.length === 0 ? (
        <p className="tm-empty">{t('shell.cloud.server.none')}</p>
      ) : (
        <ul className="tm-list sv-list">
          {links.map((l) => {
            const name = l.label || t('shell.cloud.server.unnamed')
            const by = l.created_by ? l.created_by.name.trim() || l.created_by.email : ''
            const meta = [
              by ? t('shell.cloud.team.by', { name: by }) : '',
              t('shell.cloud.team.expiresIn', { when: ago(l.expires_at) }),
              t('shell.cloud.inv.spec.used', { uses: l.uses, max: l.max_uses }),
              l.last_used_at ? t('shell.cloud.server.lastUsed', { when: ago(l.last_used_at) }) : t('shell.cloud.server.neverUsed'),
            ].filter(Boolean)
            return (
              <li key={l.id} className="tm-inv" data-testid="signup-row">
                <span className="sv-glyph" aria-hidden>
                  <KeyRound size={13} />
                </span>
                <span className="tm-inv__who">
                  <span className="tm-inv__line">
                    <span className="tm-inv__name">{name}</span>
                    {l.domains?.map((d) => (
                      <span key={d} className="tm-domain">
                        @{d}
                      </span>
                    ))}
                  </span>
                  <span className="tm-inv__meta">{meta.join(' · ')}</span>
                  <span className="tm-gauge" role="meter" aria-label={t('shell.cloud.inv.spec.used', { uses: l.uses, max: l.max_uses })} aria-valuemin={0} aria-valuemax={l.max_uses} aria-valuenow={l.uses}>
                    <span className="tm-gauge__fill" style={{ width: `${Math.min(100, (l.uses / l.max_uses) * 100)}%` }} />
                  </span>
                </span>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm(l.id)}>
                  {t('shell.cloud.server.revoke')}
                </button>
                {confirm === l.id && (
                  <div className="tm-confirm" role="group">
                    <p className="tm-confirm__q">{t('shell.cloud.server.revokeQ', { name })}</p>
                    <div className="tm-confirm__actions">
                      <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm(null)} autoFocus>
                        {t('shell.cloud.team.cancel')}
                      </button>
                      <button type="button" className="btn btn--sm btn--danger-solid" onClick={() => void revoke(l)}>
                        {t('shell.cloud.server.revoke')}
                      </button>
                    </div>
                  </div>
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

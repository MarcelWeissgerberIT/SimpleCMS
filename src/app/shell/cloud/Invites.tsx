/**
 * Settings → Team → Invite people (admins): a link for one or many people (role, validity, uses, an
 * optional domain restriction) or invitations to several addresses at once, and the open invites with
 * how many places are used. docs/CLOUD.md § Invites & registration links.
 */
import { useEffect, useId, useRef, useState, type KeyboardEvent } from 'react'
import { AlertTriangle, Link2, Mail } from 'lucide-react'
import { formatDistanceToNowStrict } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import type { EmailInviteResult, Invite, Role } from '../../cloud'
import { useUI } from '../../store/ui'
import { useLang, useT } from '../../i18n'
import { Led } from '../../ui/controls'
import { plural } from '../lib/format'
import { cloudApi } from './api'
import { errorText } from './errors'
import { CopyButton, LinkPanel, daysLeft, linkSpec, parseAddressList, parseDomainInput } from './LinkField'
import { roleLabel } from './state'

export const DAY_CHOICES = [1, 7, 30]
export const USE_CHOICES = [1, 5, 10, 25, 100]
const MAX_ADDRESSES = 20
const LINK_ROLES: Role[] = ['member', 'viewer']
const EMAIL_ROLES: Role[] = ['member', 'viewer', 'admin']

type Mode = 'link' | 'email'

/** Link / Email as a segmented radio group (arrow keys move between the two). */
function ModeSwitch({ mode, onChange }: { mode: Mode; onChange: (m: Mode) => void }) {
  const t = useT()
  const modes: Mode[] = ['link', 'email']
  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(e.key)) return
    e.preventDefault()
    const next = mode === 'link' ? 'email' : 'link'
    onChange(next)
    e.currentTarget.parentElement?.querySelector<HTMLElement>(`[data-mode="${next}"]`)?.focus()
  }
  return (
    <div className="seg tm-mode" role="radiogroup" aria-label={t('shell.cloud.inv.mode')}>
      {modes.map((m) => (
        <button key={m} type="button" role="radio" data-mode={m} aria-checked={mode === m} tabIndex={mode === m ? 0 : -1} className="seg__btn" onClick={() => onChange(m)} onKeyDown={onKey}>
          {m === 'link' ? <Link2 size={13} aria-hidden /> : <Mail size={13} aria-hidden />}
          {t(`shell.cloud.inv.mode.${m}`)}
        </button>
      ))}
    </div>
  )
}

export function Select<T extends string | number>({ id, label, value, options, onChange }: { id: string; label: string; value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void }) {
  return (
    <div className="tm-field">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} className="input" value={String(value)} onChange={(e) => onChange(options.find((o) => String(o.value) === e.target.value)!.value)}>
        {options.map((o) => (
          <option key={String(o.value)} value={String(o.value)}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  )
}

export function Invites({ wsId, invites, setInvites, reload, focusForm }: { wsId: string; invites: Invite[]; setInvites: (i: Invite[]) => void; reload: () => Promise<void>; focusForm: boolean }) {
  const t = useT()
  const uid = useId()
  const [mode, setMode] = useState<Mode>('link')
  const [role, setRole] = useState<Role>('member')
  const [days, setDays] = useState(7)
  const [uses, setUses] = useState(1)
  const [domains, setDomains] = useState('')
  const [emails, setEmails] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Invite | null>(null)
  const [results, setResults] = useState<EmailInviteResult[] | null>(null)
  const formRef = useRef<HTMLFormElement>(null)

  // the Share dialog / the workspace menu asked for this form: bring it into view, focus it
  useEffect(() => {
    if (!focusForm) return
    const form = formRef.current
    form?.scrollIntoView({ block: 'center' })
    form?.querySelector<HTMLElement>('[role="radio"][aria-checked="true"]')?.focus({ preventScroll: true })
  }, [focusForm])

  const days$ = DAY_CHOICES.map((n) => ({ value: n, label: t(plural('shell.cloud.inv.days', n), { n }) }))
  const domainList = parseDomainInput(domains)
  const addresses = parseAddressList(emails)

  const switchMode = (m: Mode) => {
    setMode(m)
    setError(null)
    // reusable links never make admins
    if (m === 'link' && role === 'admin') setRole('member')
  }

  const createLink = async () => {
    if (!domainList) return setError(t('shell.cloud.inv.domainsInvalid'))
    setBusy(true)
    setError(null)
    try {
      const custom = uses !== 1 || days !== 7 || domainList.length > 0
      // the plain single-use link keeps its short call (the server's defaults)
      const inv = custom ? await cloudApi.createInvite(wsId, role, undefined, { maxUses: uses, days, domains: domainList }) : await cloudApi.createInvite(wsId, role, undefined)
      setCreated(inv)
      void reload()
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const send = async () => {
    if (!addresses.length) return setError(t('shell.cloud.inv.none'))
    if (addresses.length > MAX_ADDRESSES) return setError(t('shell.cloud.inv.tooMany', { max: MAX_ADDRESSES }))
    setBusy(true)
    setError(null)
    try {
      const r = await cloudApi.sendInvites(wsId, addresses, role, days !== 7 ? { days } : undefined)
      setResults(r)
      // what went out (or exists anyway) leaves the box; invalid addresses stay to be fixed
      setEmails(r.filter((x) => x.status === 'invalid').map((x) => x.email).join(', '))
      void reload()
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const revoke = async (inv: Invite) => {
    try {
      await cloudApi.revokeInvite(wsId, inv.id)
      setInvites(invites.filter((x) => x.id !== inv.id))
      if (created?.id === inv.id) setCreated(null)
      useUI.getState().toast({ message: t('shell.cloud.team.revoked') })
    } catch (e) {
      useUI.getState().toast({ message: errorText(e, t), kind: 'error' })
    }
  }

  const hintId = `${uid}-hint`
  return (
    <>
      <form
        ref={formRef}
        className="tm-inviter"
        data-testid="invite-form"
        noValidate
        onSubmit={(e) => {
          e.preventDefault()
          void (mode === 'link' ? createLink() : send())
        }}
      >
        <ModeSwitch mode={mode} onChange={switchMode} />
        <div className="tm-fields" data-mode={mode}>
          <Select id={`${uid}-role`} label={t('shell.cloud.team.inviteRole')} value={role} onChange={setRole} options={(mode === 'link' ? LINK_ROLES : EMAIL_ROLES).map((r) => ({ value: r, label: roleLabel(t, r) }))} />
          <Select id={`${uid}-days`} label={t('shell.cloud.inv.valid')} value={days} onChange={setDays} options={days$} />
          {mode === 'link' ? (
            <>
              <Select
                id={`${uid}-uses`}
                label={t('shell.cloud.inv.uses')}
                value={uses}
                onChange={setUses}
                options={USE_CHOICES.map((n) => ({ value: n, label: n === 1 ? t('shell.cloud.inv.usesSingle') : t('shell.cloud.inv.usesN', { n }) }))}
              />
              <div className="tm-field tm-field--wide">
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
                  aria-describedby={hintId}
                  onChange={(e) => setDomains(e.target.value)}
                />
              </div>
            </>
          ) : (
            <div className="tm-field tm-field--full">
              <div className="tm-field__head">
                <label className="label" htmlFor={`${uid}-emails`}>
                  {t('shell.cloud.inv.emails')}
                </label>
                <span className="tm-count" id={`${uid}-count`} data-over={addresses.length > MAX_ADDRESSES || undefined}>
                  {t(plural('shell.cloud.inv.count', addresses.length), { n: addresses.length, max: MAX_ADDRESSES })}
                </span>
              </div>
              <textarea
                id={`${uid}-emails`}
                className="input tm-emails"
                rows={3}
                value={emails}
                placeholder={t('shell.cloud.inv.emailsPh')}
                autoComplete="off"
                autoCapitalize="off"
                spellCheck={false}
                aria-describedby={`${uid}-count ${hintId}`}
                onChange={(e) => setEmails(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                    e.preventDefault()
                    void send()
                  }
                }}
              />
            </div>
          )}
        </div>
        <div className="tm-inviter__foot">
          <p className="tm-invite__hint" id={hintId}>
            {mode === 'link' ? t('shell.cloud.inv.linkHint') : `${t(`shell.cloud.roleHint.${role}`).replace(/^./, (c) => c.toUpperCase())}. ${t('shell.cloud.inv.emailHint')}`}
          </p>
          <button type="submit" className="btn btn--ink" disabled={busy}>
            {mode === 'link' ? <Link2 size={14} aria-hidden /> : <Mail size={14} aria-hidden />}
            {busy ? (mode === 'link' ? t('shell.cloud.team.creating') : t('shell.cloud.inv.sending')) : mode === 'link' ? t('shell.cloud.team.createLink') : t('shell.cloud.inv.send')}
          </button>
        </div>
      </form>
      {error && (
        <p className="cl-err" role="alert">
          <AlertTriangle size={13} aria-hidden />
          {error}
        </p>
      )}
      {mode === 'link' && created?.link && (
        <LinkPanel
          label={t('shell.cloud.team.link')}
          link={created.link}
          testId="invite-link"
          spec={linkSpec(t, { days: daysLeft(created.expires_at), maxUses: created.max_uses, uses: created.uses, domains: created.domains })}
          hint={t('shell.cloud.team.linkHint')}
        />
      )}
      {mode === 'email' && results && <Results results={results} />}
      <OpenInvites invites={invites} onRevoke={(i) => void revoke(i)} />
    </>
  )
}

/** Per address: LED, address, status — and the link to pass on by hand when the mail failed. */
function Results({ results }: { results: EmailInviteResult[] }) {
  const t = useT()
  const sent = results.filter((r) => r.status === 'sent').length
  const failed = results.some((r) => r.status === 'failed')
  return (
    <div className="tm-results" data-testid="invite-results" role="status">
      <div className="label tm-results__head">{t('shell.cloud.inv.results', { sent, n: results.length })}</div>
      <ul className="tm-results__list">
        {results.map((r) => (
          <li key={r.email} className="tm-result" data-status={r.status}>
            <Led state={r.status === 'sent' ? 'ok' : r.status === 'already_member' ? 'off' : 'on'} />
            <span className="tm-result__addr">{r.email}</span>
            <span className="tm-result__status">{t(`shell.cloud.inv.status.${r.status}`)}</span>
            {r.status === 'failed' && r.link && <CopyButton text={r.link} label={t('shell.cloud.inv.copyLink')} small />}
          </li>
        ))}
      </ul>
      {failed && <p className="tm-link__hint">{t('shell.cloud.inv.failedHint')}</p>}
    </div>
  )
}

function OpenInvites({ invites, onRevoke }: { invites: Invite[]; onRevoke: (i: Invite) => void }) {
  const t = useT()
  const lang = useLang()
  const locale = lang === 'de' ? de : enUS
  const ago = (ms: number) => formatDistanceToNowStrict(ms, { addSuffix: true, locale })
  return (
    <>
      <div className="label tm-open-head">{t('shell.cloud.team.open')}</div>
      {invites.length === 0 ? (
        <p className="tm-empty">{t('shell.cloud.team.noOpen')}</p>
      ) : (
        <ul className="tm-list">
          {invites.map((inv) => {
            const by = inv.inviter ? inv.inviter.name.trim() || inv.inviter.email : ''
            const max = inv.max_uses ?? 1
            const used = inv.uses ?? 0
            const meta = [
              by ? t('shell.cloud.team.by', { name: by }) : '',
              t('shell.cloud.team.expiresIn', { when: ago(inv.expires_at) }),
              max > 1 ? t('shell.cloud.inv.spec.used', { uses: used, max }) : '',
              max > 1 && inv.last_joined_at ? t('shell.cloud.inv.spec.lastJoined', { when: ago(inv.last_joined_at) }) : '',
            ].filter(Boolean)
            const last = max > 1 && inv.last_joined ? inv.last_joined.name.trim() || inv.last_joined.email : ''
            return (
              <li key={inv.id} className="tm-inv" data-testid="invite">
                <span className="cl-role" data-role={inv.role}>
                  {roleLabel(t, inv.role)}
                </span>
                <span className="tm-inv__who">
                  <span className="tm-inv__line">
                    <span className="tm-inv__name">{inv.email ?? t('shell.cloud.team.anyone')}</span>
                    {inv.domains?.map((d) => (
                      <span key={d} className="tm-domain">
                        @{d}
                      </span>
                    ))}
                  </span>
                  <span className="tm-inv__meta">
                    {meta.join(' · ')}
                    {last && <span className="tm-inv__last"> · {t('shell.cloud.inv.spec.lastBy', { name: last })}</span>}
                  </span>
                  {max > 1 && (
                    <span className="tm-gauge" role="meter" aria-label={t('shell.cloud.inv.spec.used', { uses: used, max })} aria-valuemin={0} aria-valuemax={max} aria-valuenow={used}>
                      <span className="tm-gauge__fill" style={{ width: `${Math.min(100, (used / max) * 100)}%` }} />
                    </span>
                  )}
                </span>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => onRevoke(inv)}>
                  {t('shell.cloud.team.revoke')}
                </button>
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

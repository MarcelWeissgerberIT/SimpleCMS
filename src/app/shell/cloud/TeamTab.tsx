import { useCallback, useEffect, useId, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, Copy, Link2, LogOut, RotateCw, Trash2, UserMinus } from 'lucide-react'
import { format } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import { useShallow } from 'zustand/react/shallow'
import { useCloud, type Invite, type Member, type Role } from '../../cloud'
import { useUI } from '../../store/ui'
import { useLang, useT } from '../../i18n'
import { Led } from '../../ui/controls'
import { fmtRelative } from '../lib/format'
import { cloudApi } from './api'
import { errorText } from './errors'
import { Avatar } from './Avatar'
import { canAdmin, roleLabel, useWorkspaceTitle } from './state'
import './cloud.css'

const RANK: Record<Role, number> = { owner: 0, admin: 1, member: 2, viewer: 3 }
const INVITE_ROLES: Role[] = ['member', 'viewer', 'admin']
const toMs = (v: number | string) => (typeof v === 'number' ? v : new Date(v).getTime())
const nameOf = (m: Member) => m.user.name.trim() || m.user.email.split('@')[0]

function sortMembers(list: Member[]): Member[] {
  return [...list].sort((a, b) => RANK[a.role] - RANK[b.role] || nameOf(a).localeCompare(nameOf(b)))
}

type Pending = { kind: 'remove' | 'transfer' | 'leave'; userId: string } | null

/** Settings → Team (only in a cloud workspace): you, the workspace, members, invites, danger zone. */
export function TeamTab({ onClose }: { onClose: () => void }) {
  const t = useT()
  const { active, role, user } = useCloud(useShallow((s) => ({ active: s.active, role: s.role, user: s.user })))
  const wsId = active.kind === 'cloud' ? active.id : null
  const admin = canAdmin(role)
  const [members, setMembers] = useState<Member[] | null>(null)
  const [invites, setInvites] = useState<Invite[]>([])
  const [loadError, setLoadError] = useState<string | null>(null)

  const reload = useCallback(async () => {
    if (!wsId) return
    setLoadError(null)
    try {
      const [m, i] = await Promise.all([cloudApi.listMembers(wsId), admin ? cloudApi.listInvites(wsId) : Promise.resolve([] as Invite[])])
      setMembers(sortMembers(m))
      setInvites(i)
    } catch (e) {
      setLoadError(errorText(e, t))
    }
  }, [wsId, admin, t])

  useEffect(() => {
    void reload()
  }, [reload])

  if (!wsId) return null
  return (
    <>
      <h3 className="st-h">{t('shell.cloud.team.title')}</h3>
      <p className="st-p">{t('shell.cloud.team.body')}</p>
      <ProfileAndName wsId={wsId} admin={admin} />
      <Sect n="03" label={t('shell.cloud.team.members')} count={members?.length} />
      {loadError ? (
        <div className="tm-status" role="alert">
          <AlertTriangle size={14} className="faint" aria-hidden />
          <span>{loadError}</span>
          <button type="button" className="btn btn--sm" onClick={() => void reload()}>
            <RotateCw size={12} aria-hidden />
            {t('shell.cloud.team.retry')}
          </button>
        </div>
      ) : !members ? (
        <div className="tm-status" role="status">
          <Led state="on" />
          {t('shell.cloud.team.loading')}
        </div>
      ) : (
        <Members wsId={wsId} members={members} myId={user?.id ?? null} myRole={role} setMembers={setMembers} onLeft={onClose} />
      )}
      <Sect n="04" label={t('shell.cloud.team.invites')} count={admin ? invites.length : undefined} />
      {admin ? <Invites wsId={wsId} invites={invites} setInvites={setInvites} reload={reload} /> : <p className="tm-empty">{t('shell.cloud.team.adminOnly')}</p>}
      <Danger wsId={wsId} owner={role === 'owner'} myId={user?.id ?? null} onDone={onClose} />
    </>
  )
}

function Sect({ n, label, count, children }: { n: string; label: string; count?: number; children?: ReactNode }) {
  return (
    <div className="tm-sect">
      <span className="tm-sect__n">{n}</span>
      <span className="label">{label}</span>
      <span className="tm-sect__rule" aria-hidden />
      {children}
      {count !== undefined && <span className="tm-sect__n">{String(count).padStart(2, '0')}</span>}
    </div>
  )
}

/* ------------------------------------------------------------------ you + workspace name */

function SavedField({ label, hint, value, disabled, onSave, maxLength }: { label: string; hint: string; value: string; disabled?: boolean; maxLength: number; onSave: (v: string) => Promise<void> }) {
  const t = useT()
  const id = useId()
  const [v, setV] = useState(value)
  const [state, setState] = useState<'idle' | 'saving' | 'saved'>('idle')
  const [error, setError] = useState<string | null>(null)
  const focused = useRef(false)
  useEffect(() => {
    if (!focused.current) setV(value)
  }, [value])
  const commit = async () => {
    const next = v.trim()
    if (!next || next === value.trim()) {
      setV(value)
      return
    }
    setState('saving')
    setError(null)
    try {
      await onSave(next)
      setState('saved')
      window.setTimeout(() => setState('idle'), 1800)
    } catch (e) {
      setState('idle')
      setError(errorText(e, t))
    }
  }
  return (
    <div className="st-field">
      <div className="st-field__text">
        <label className="st-field__label" htmlFor={id}>
          {label} {state === 'saved' && <span className="tm-saved">· {t('shell.cloud.team.saved')}</span>}
        </label>
        <div className="st-field__hint" id={`${id}-hint`}>
          {hint}
        </div>
        {error && (
          <p className="cl-err" role="alert">
            <AlertTriangle size={13} aria-hidden />
            {error}
          </p>
        )}
      </div>
      <div className="st-field__control">
        <input
          id={id}
          className="input"
          value={v}
          maxLength={maxLength}
          disabled={disabled || state === 'saving'}
          aria-describedby={`${id}-hint`}
          onFocus={() => (focused.current = true)}
          onChange={(e) => setV(e.target.value)}
          onBlur={() => {
            focused.current = false
            void commit()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault()
              void commit()
            }
            if (e.key === 'Escape' && v !== value) {
              e.stopPropagation()
              setV(value)
            }
          }}
        />
      </div>
    </div>
  )
}

function ProfileAndName({ wsId, admin }: { wsId: string; admin: boolean }) {
  const t = useT()
  const user = useCloud((s) => s.user)
  const title = useWorkspaceTitle()
  return (
    <>
      <Sect n="01" label={t('shell.cloud.team.you')}>
        {user && <span className="tm-row__meta">{user.email}</span>}
      </Sect>
      <SavedField label={t('shell.cloud.team.yourName')} hint={t('shell.cloud.team.yourNameHint')} value={user?.name ?? ''} maxLength={60} onSave={(v) => cloudApi.updateProfile(v)} />
      <Sect n="02" label={t('shell.cloud.invite.workspace')} />
      <SavedField
        label={t('shell.cloud.team.wsName')}
        hint={admin ? t('shell.cloud.team.wsNameHint') : t('shell.cloud.team.wsNameRO')}
        value={title}
        disabled={!admin}
        maxLength={100}
        onSave={(v) => cloudApi.renameWorkspace(wsId, v)}
      />
    </>
  )
}

/* ------------------------------------------------------------------ members */

function Members({
  wsId,
  members,
  myId,
  myRole,
  setMembers,
  onLeft,
}: {
  wsId: string
  members: Member[]
  myId: string | null
  myRole: Role | null
  setMembers: (m: Member[]) => void
  onLeft: () => void
}) {
  const t = useT()
  const lang = useLang()
  const [pending, setPending] = useState<Pending>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<{ userId: string; text: string } | null>(null)
  const admin = canAdmin(myRole)
  const toast = useUI.getState().toast
  const wsName = useWorkspaceTitle()

  const run = async (userId: string, job: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await job()
      setPending(null)
    } catch (e) {
      setError({ userId, text: errorText(e, t) })
    } finally {
      setBusy(false)
    }
  }

  const changeRole = (m: Member, role: Role) =>
    run(m.user.id, async () => {
      await cloudApi.setMemberRole(wsId, m.user.id, role)
      if (role === 'owner') {
        // the old owner becomes an admin (docs/CLOUD.md)
        setMembers(sortMembers(members.map((x) => (x.user.id === m.user.id ? { ...x, role } : x.role === 'owner' ? { ...x, role: 'admin' } : x))))
        toast({ message: t('shell.cloud.team.transferred', { name: nameOf(m) }), kind: 'success' })
      } else {
        setMembers(sortMembers(members.map((x) => (x.user.id === m.user.id ? { ...x, role } : x))))
        toast({ message: t('shell.cloud.team.roleChanged', { name: nameOf(m), role: roleLabel(t, role) }), kind: 'success' })
      }
    })

  const remove = (m: Member) =>
    run(m.user.id, async () => {
      await cloudApi.removeMember(wsId, m.user.id)
      setMembers(members.filter((x) => x.user.id !== m.user.id))
      toast({ message: t('shell.cloud.team.removed', { name: nameOf(m) }) })
    })

  const leave = (m: Member) =>
    run(m.user.id, async () => {
      await cloudApi.removeMember(wsId, m.user.id)
      onLeft()
      cloudApi.switchWorkspace({ kind: 'local', id: 'local' })
    })

  return (
    <ul className="tm-list" aria-label={t('shell.cloud.team.members')}>
      {members.map((m) => {
        const me = m.user.id === myId
        const name = nameOf(m)
        const editable = admin && !me && m.role !== 'owner'
        const p = pending?.userId === m.user.id ? pending : null
        return (
          <li key={m.user.id} className="tm-row" data-testid="member">
            <Avatar name={m.user.name} email={m.user.email} id={m.user.id} size={28} />
            <div className="tm-row__who">
              <span className="tm-row__name">
                <span>{name}</span>
                {me && <span className="tm-you">{t('shell.cloud.team.youTag')}</span>}
              </span>
              <span className="tm-row__meta">
                {m.user.email} · {t('shell.cloud.team.since', { date: format(toMs(m.created_at), 'dd MMM yyyy', { locale: lang === 'de' ? de : enUS }).toUpperCase() })}
              </span>
            </div>
            <div className="tm-row__ctl">
              {editable ? (
                <select
                  className="input"
                  value={m.role}
                  aria-label={t('shell.cloud.team.roleOf', { name })}
                  disabled={busy}
                  onChange={(e) => {
                    const role = e.target.value as Role
                    if (role === 'owner') setPending({ kind: 'transfer', userId: m.user.id })
                    else void changeRole(m, role)
                  }}
                >
                  {(['admin', 'member', 'viewer'] as Role[]).map((r) => (
                    <option key={r} value={r}>
                      {roleLabel(t, r)}
                    </option>
                  ))}
                  {myRole === 'owner' && <option value="owner">{t('shell.cloud.team.transfer')}</option>}
                </select>
              ) : (
                <span className="cl-role" data-role={m.role}>
                  {roleLabel(t, m.role)}
                </span>
              )}
              {editable && (
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setPending({ kind: 'remove', userId: m.user.id })} disabled={busy}>
                  <UserMinus size={13} aria-hidden />
                  {t('shell.cloud.team.remove')}
                </button>
              )}
              {me && m.role !== 'owner' && (
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => setPending({ kind: 'leave', userId: m.user.id })} disabled={busy}>
                  <LogOut size={13} aria-hidden />
                  {t('shell.cloud.team.leave')}
                </button>
              )}
            </div>
            {p && (
              <div className="tm-confirm" data-tone={p.kind === 'transfer' ? 'signal' : undefined} role="group">
                <p className="tm-confirm__q">
                  {p.kind === 'transfer' ? t('shell.cloud.team.transferQ', { name }) : p.kind === 'remove' ? t('shell.cloud.team.removeQ', { name }) : t('shell.cloud.team.leaveQ', { workspace: wsName })}
                </p>
                <div className="tm-confirm__actions">
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setPending(null)} autoFocus>
                    {t('shell.cloud.team.cancel')}
                  </button>
                  <button
                    type="button"
                    className={`btn btn--sm ${p.kind === 'transfer' ? 'btn--ink' : 'btn--danger-solid'}`}
                    disabled={busy}
                    onClick={() => void (p.kind === 'transfer' ? changeRole(m, 'owner') : p.kind === 'remove' ? remove(m) : leave(m))}
                  >
                    {p.kind === 'transfer' ? t('shell.cloud.team.transferDo') : p.kind === 'remove' ? t('shell.cloud.team.remove') : t('shell.cloud.team.leave')}
                  </button>
                </div>
              </div>
            )}
            {error?.userId === m.user.id && (
              <p className="cl-err tm-confirm__err" role="alert" style={{ gridColumn: '1 / -1' }}>
                <AlertTriangle size={13} aria-hidden />
                {error.text}
              </p>
            )}
          </li>
        )
      })}
    </ul>
  )
}

/* ------------------------------------------------------------------ invites */

function Invites({ wsId, invites, setInvites, reload }: { wsId: string; invites: Invite[]; setInvites: (i: Invite[]) => void; reload: () => Promise<void> }) {
  const t = useT()
  const lang = useLang()
  const uid = useId()
  const [role, setRole] = useState<Role>('member')
  const [email, setEmail] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<Invite | null>(null)
  const linkRef = useRef<HTMLInputElement>(null)
  const toast = useUI.getState().toast

  const create = async () => {
    setBusy(true)
    setError(null)
    try {
      const inv = await cloudApi.createInvite(wsId, role, email.trim() || undefined)
      setCreated(inv)
      setEmail('')
      void reload()
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const copy = async (link: string) => {
    try {
      await navigator.clipboard.writeText(link)
      toast({ message: t('shell.cloud.team.copied'), kind: 'success' })
    } catch {
      linkRef.current?.select()
    }
  }

  const revoke = async (inv: Invite) => {
    try {
      await cloudApi.revokeInvite(wsId, inv.id)
      setInvites(invites.filter((x) => x.id !== inv.id))
      if (created?.id === inv.id) setCreated(null)
      toast({ message: t('shell.cloud.team.revoked') })
    } catch (e) {
      toast({ message: errorText(e, t), kind: 'error' })
    }
  }

  return (
    <>
      <form
        className="tm-invite"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <div className="tm-invite__field">
          <label className="label" htmlFor={`${uid}-role`}>
            {t('shell.cloud.team.inviteRole')}
          </label>
          <select id={`${uid}-role`} className="input" value={role} onChange={(e) => setRole(e.target.value as Role)}>
            {INVITE_ROLES.map((r) => (
              <option key={r} value={r}>
                {roleLabel(t, r)}
              </option>
            ))}
          </select>
        </div>
        <div className="tm-invite__field">
          <label className="label" htmlFor={`${uid}-email`}>
            {t('shell.cloud.team.inviteEmail')}
          </label>
          <input
            id={`${uid}-email`}
            className="input"
            type="email"
            autoComplete="off"
            placeholder={t('shell.cloud.team.inviteEmailPh')}
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            aria-describedby={`${uid}-hint`}
          />
        </div>
        <button type="submit" className="btn btn--ink" disabled={busy}>
          <Link2 size={14} aria-hidden />
          {busy ? t('shell.cloud.team.creating') : t('shell.cloud.team.createLink')}
        </button>
      </form>
      <p className="tm-invite__hint" id={`${uid}-hint`}>
        {t(`shell.cloud.roleHint.${role}`).replace(/^./, (c) => c.toUpperCase())}. {t('shell.cloud.team.inviteEmailHint')}
      </p>
      {error && (
        <p className="cl-err" role="alert">
          <AlertTriangle size={13} aria-hidden />
          {error}
        </p>
      )}
      {created?.link && (
        <div className="tm-link" data-testid="invite-link">
          <span className="label">{t('shell.cloud.team.link')}</span>
          <div className="tm-link__row">
            <input ref={linkRef} className="input tm-link__url" readOnly value={created.link} onFocus={(e) => e.currentTarget.select()} aria-label={t('shell.cloud.team.link')} />
            <button type="button" className="btn btn--primary" onClick={() => void copy(created.link!)}>
              <Copy size={13} aria-hidden />
              {t('shell.cloud.team.copy')}
            </button>
          </div>
          <p className="tm-link__hint">
            {t('shell.cloud.team.linkHint')} {created.email ? t('shell.cloud.team.mailed', { email: created.email }) : ''}
          </p>
        </div>
      )}
      <div className="label" style={{ margin: '18px 0 6px' }}>
        {t('shell.cloud.team.open')}
      </div>
      {invites.length === 0 ? (
        <p className="tm-empty">{t('shell.cloud.team.noOpen')}</p>
      ) : (
        <ul className="tm-list">
          {invites.map((inv) => {
            const inviter = (inv as { inviter?: { name?: string; email?: string } | null }).inviter
            const by = inviter ? inviter.name?.trim() || inviter.email || '' : ''
            return (
              <li key={inv.id} className="tm-inv" data-testid="invite">
                <span className="cl-role" data-role={inv.role}>
                  {roleLabel(t, inv.role)}
                </span>
                <span className="tm-inv__who">
                  {inv.email ?? t('shell.cloud.team.anyone')}
                  <span className="tm-inv__meta">
                    {by ? `${t('shell.cloud.team.by', { name: by })} · ` : ''}
                    {t('shell.cloud.team.expiresIn', { when: fmtRelative(toMs(inv.expires_at), lang, '') })}
                  </span>
                </span>
                <button type="button" className="btn btn--sm btn--ghost" onClick={() => void revoke(inv)}>
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

/* ------------------------------------------------------------------ danger zone */

function Danger({ wsId, owner, myId, onDone }: { wsId: string; owner: boolean; myId: string | null; onDone: () => void }) {
  const t = useT()
  const uid = useId()
  const name = useWorkspaceTitle()
  const [armed, setArmed] = useState(false)
  const [typed, setTyped] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const toast = useUI.getState().toast

  const go = async () => {
    setBusy(true)
    setError(null)
    try {
      if (owner) {
        await cloudApi.deleteWorkspace(wsId)
        toast({ message: t('shell.cloud.team.deleted', { name }) })
      } else if (myId) await cloudApi.removeMember(wsId, myId)
      onDone()
      cloudApi.switchWorkspace({ kind: 'local', id: 'local' })
    } catch (e) {
      setError(errorText(e, t))
      setBusy(false)
    }
  }

  const match = typed.trim() === name.trim()
  return (
    <div className="tm-danger">
      <div className="danger">
        <div className="danger__stripes" aria-hidden />
        <div className="danger__text">
          <div className="label danger__label">
            <AlertTriangle size={12} /> {t('shell.cloud.team.danger')}
          </div>
          <strong>{owner ? t('shell.cloud.team.delete') : t('shell.cloud.team.leaveTitle')}</strong>
          <p>{owner ? t('shell.cloud.team.deleteBody') : t('shell.cloud.team.leaveBody')}</p>
        </div>
        {!armed && (
          <button type="button" className="btn btn--danger-solid" onClick={() => setArmed(true)}>
            {owner ? <Trash2 size={14} aria-hidden /> : <LogOut size={14} aria-hidden />}
            {owner ? t('shell.cloud.team.delete') : t('shell.cloud.team.leaveTitle')}
          </button>
        )}
      </div>
      {armed && (
        <form
          className="tm-danger-confirm"
          onSubmit={(e) => {
            e.preventDefault()
            if (!owner || match) void go()
          }}
        >
          {owner ? (
            <>
              <label className="label" htmlFor={`${uid}-type`}>
                {t('shell.cloud.team.deleteType', { name })}
              </label>
              <input id={`${uid}-type`} className="input" value={typed} autoFocus autoComplete="off" spellCheck={false} onChange={(e) => setTyped(e.target.value)} placeholder={name} />
            </>
          ) : (
            <p className="tm-confirm__q">{t('shell.cloud.team.leaveQ', { workspace: name })}</p>
          )}
          <div className="tm-confirm__actions">
            <button type="button" className="btn btn--sm btn--ghost" onClick={() => (setArmed(false), setTyped(''))} autoFocus={!owner}>
              {t('shell.cloud.team.cancel')}
            </button>
            <button type="submit" className="btn btn--sm btn--danger-solid" disabled={busy || (owner && !match)}>
              {owner ? t('shell.cloud.team.deleteDo') : t('shell.cloud.team.leave')}
            </button>
          </div>
          {error && (
            <p className="cl-err" role="alert">
              <AlertTriangle size={13} aria-hidden />
              {error}
            </p>
          )}
        </form>
      )}
    </div>
  )
}

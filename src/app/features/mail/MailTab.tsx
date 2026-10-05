/**
 * Settings → Mail: three instrument panels — § A Google access (One's built-in client: one click, the own
 * client under "advanced"; without it: setup steps, client ID, connect), § B Sync (from date, destination,
 * labels, limits, schedule, read-out, run) and § C Organise with Claude (categories, fields, related
 * database, cost) — plus where the mail goes.
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode, type RefObject } from 'react'
import { format } from 'date-fns'
import { Copy, ExternalLink, Mail, Plug, RefreshCw, Send, Tags, Unplug, X, Plus, Square, ArrowUpRight, RotateCcw, KeyRound, Undo2 } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import { useUI } from '../../store/ui'
import { openPage } from '../../lib/router'
import { useCloud } from '../../cloud'
import { Led } from '../../ui/controls'
import { useLang, useT } from '../../i18n'
import { CLIENT_ID_RE, EVERY_MIN, MAX_PER_RUN, PUBLIC_ORIGIN, SECRET_RE, cleanCategory, MAX_CATEGORIES, setMail, setOrganise, useMailSettings } from './settings'
import { preloadGis } from './auth'
import { builtinClientId, effectiveClient, useBuiltinClient } from './builtin'
import { backToOneAccess, cancelRun, connectGmail, disconnectGmail, loadLabels, organiseEarlier, resetMailSync, setOwnClientId, startNewDatabase, syncNow, useMail } from './service'
import { estimateOrganise } from './organise'
import { fmtTime, useMailReadout, type ReadoutState } from './MailStatus'
import { MlField, Panel, SwitchRow } from './parts'
import { PeoplePanel } from './PeopleUI'
import './mail.css'
import { HelpLink } from '../../help'

type T = ReturnType<typeof useT>

const LINKS = {
  project: 'https://console.cloud.google.com/projectcreate',
  api: 'https://console.cloud.google.com/apis/library/gmail.googleapis.com',
  consent: 'https://console.cloud.google.com/auth/audience',
  client: 'https://console.cloud.google.com/auth/clients/create',
}

async function copy(text: string, t: T) {
  try {
    await navigator.clipboard.writeText(text)
    useUI.getState().toast({ message: t('common.copied'), kind: 'success' })
  } catch {
    useUI.getState().toast({ message: t('features.mail.copyFailed'), kind: 'error' })
  }
}

function Ext({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noreferrer noopener" className="st-link">
      {children} <ExternalLink size={11} />
    </a>
  )
}

/* ------------------------------------------------------------------ § A Google access */

function SetupSteps() {
  const t = useT()
  const origins = [...new Set([PUBLIC_ORIGIN, window.location.origin])]
  return (
    <ol className="ml-steps">
      <li>
        <span>{t('features.mail.setup.s1')}</span> <Ext href={LINKS.project}>{t('features.mail.setup.s1Link')}</Ext>
      </li>
      <li>
        <span>{t('features.mail.setup.s2')}</span> <Ext href={LINKS.api}>{t('features.mail.setup.s2Link')}</Ext>
      </li>
      <li>
        <span>{t('features.mail.setup.s3')}</span> <Ext href={LINKS.consent}>{t('features.mail.setup.s3Link')}</Ext>
      </li>
      <li>
        <span>{t('features.mail.setup.s4')}</span> <Ext href={LINKS.client}>{t('features.mail.setup.s4Link')}</Ext>
        <ul className="ml-origins" aria-label={t('features.mail.setup.origins')}>
          {origins.map((o) => (
            <li key={o} className="ml-origin">
              <code className="ml-origin__url">{o}</code>
              {o === window.location.origin && o !== PUBLIC_ORIGIN && <span className="ml-origin__tag label">{t('features.mail.setup.thisOrigin')}</span>}
              <button type="button" className="icon-btn ml-origin__copy" onClick={() => void copy(o, t)} aria-label={t('features.mail.setup.copy', { origin: o })} title={t('features.mail.setup.copy', { origin: o })}>
                <Copy size={13} />
              </button>
            </li>
          ))}
        </ul>
      </li>
      <li>
        <span>{t('features.mail.setup.s5')}</span>
      </li>
    </ol>
  )
}

function Setup({ open }: { open: boolean }) {
  const t = useT()
  return (
    <details className="ml-setup" open={open}>
      <summary className="ml-setup__sum">
        <span className="label">{t('features.mail.setup.title')}</span>
        <span className="ml-setup__time">{t('features.mail.setup.time')}</span>
      </summary>
      <SetupSteps />
    </details>
  )
}

/** An own client ID committed with Enter switches § A to the own layout: the field there takes the focus back. */
let refocusClientId = false

/** `onCleared(byKey)`: the own client ID was removed while One's built-in client is available (back to it). */
function ClientIdField({ onCleared }: { onCleared?: (byKey: boolean) => void }) {
  const t = useT()
  const uid = useId()
  const saved = useMailSettings().clientId
  const [draft, setDraft] = useState(saved)
  const [err, setErr] = useState<string | null>(null)
  const input = useRef<HTMLInputElement>(null)
  useEffect(() => setDraft(saved), [saved])
  useEffect(() => {
    if (!refocusClientId) return
    refocusClientId = false
    input.current?.focus()
  }, [])
  const commit = (raw: string) => {
    const v = raw.trim()
    if (SECRET_RE.test(v)) {
      // a client secret is never needed — and never kept, not even in the field
      setDraft(saved)
      setErr(t('features.mail.clientId.secret'))
      return
    }
    if (v && !CLIENT_ID_RE.test(v)) {
      setErr(t('features.mail.clientId.invalid'))
      return
    }
    setErr(null)
    if (v !== saved) {
      const byKey = document.activeElement === input.current
      const builtin = !!builtinClientId()
      refocusClientId = byKey && builtin && !!v
      setOwnClientId(v)
      if (!v && builtin) onCleared?.(byKey)
    }
  }
  const id = `${uid}-client`
  return (
    <MlField label={t('features.mail.clientId.label')} htmlFor={id} wide hint={err ? undefined : t('features.mail.clientId.hint')}>
      <div className="ml-client">
        <input
          ref={input}
          id={id}
          className="input ml-mono"
          value={draft}
          placeholder="123456789012-abc….apps.googleusercontent.com"
          spellCheck={false}
          autoComplete="off"
          aria-invalid={!!err}
          aria-describedby={err ? `${id}-err` : `${id}-hint`}
          onChange={(e) => {
            setDraft(e.target.value)
            if (SECRET_RE.test(e.target.value.trim())) commit(e.target.value)
            else if (err) setErr(null)
          }}
          onBlur={(e) => commit(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && commit(e.currentTarget.value)}
        />
        {CLIENT_ID_RE.test(saved) && !err && <Led state="ok" title={t('features.mail.clientId.saved')} />}
      </div>
      {err && (
        <p className="ml-msg ml-msg--err" id={`${id}-err`} role="alert">
          {err}
        </p>
      )}
    </MlField>
  )
}

/** One's built-in client is in use: the own client (steps + client ID) waits behind "advanced". */
function OwnClient({ open, onOpen, details }: { open: boolean; onOpen: (open: boolean) => void; details: RefObject<HTMLDetailsElement | null> }) {
  const t = useT()
  return (
    <details ref={details} className="ml-setup ml-own" open={open} onToggle={(e) => onOpen(e.currentTarget.open)} data-testid="mail-own-client">
      <summary className="ml-setup__sum">
        <span className="label">{t('features.mail.builtin.advanced')}</span>
        <span className="ml-setup__time">{t('features.mail.setup.time')}</span>
      </summary>
      <div className="ml-own__body">
        <p className="ml-own__intro">{t('features.mail.builtin.advancedIntro')}</p>
        <SetupSteps />
        <ClientIdField />
      </div>
    </details>
  )
}

function AccessPanel() {
  const t = useT()
  const uid = useId()
  const cfg = useMailSettings()
  const builtin = useBuiltinClient()
  const connected = useMail((s) => s.connected)
  const account = useMail((s) => s.account)
  const phase = useMail((s) => s.phase)
  const error = useMail((s) => (s.errorAt === 'access' ? s.error : null))
  const ownHint = useMail((s) => s.errorAt === 'access' && s.ownHint)
  const reconnect = useMail((s) => s.reconnect)
  const client = effectiveClient(cfg)
  const ready = !!client
  const viaOne = client?.source === 'builtin'
  const [advanced, setAdvanced] = useState(false)
  const details = useRef<HTMLDetailsElement>(null)
  const connectBtn = useRef<HTMLButtonElement>(null)
  const [focusConnect, setFocusConnect] = useState(false)
  useEffect(() => {
    if (!focusConnect) return
    setFocusConnect(false)
    connectBtn.current?.focus()
  }, [focusConnect])
  const state: ReadoutState = phase === 'connecting' ? 'running' : connected ? 'ok' : reconnect ? 'reconnect' : 'off'
  const stateText =
    phase === 'connecting'
      ? t('features.mail.access.connecting')
      : connected
        ? t(viaOne ? 'features.mail.access.connectedBuiltin' : 'features.mail.access.connected')
        : reconnect
          ? t('features.mail.status.reconnect')
          : ready
            ? t(viaOne ? 'features.mail.access.readyBuiltin' : 'features.mail.access.ready')
            : t('features.mail.access.notSet')
  // "Use your own Google client": open the advanced part and bring it into view
  const openOwn = () => {
    setAdvanced(true)
    requestAnimationFrame(() => {
      const d = details.current
      if (!d) return
      d.open = true
      d.scrollIntoView({ block: 'nearest' })
      d.querySelector('summary')?.focus()
    })
  }
  const back = () => {
    backToOneAccess()
    setAdvanced(false)
    setFocusConnect(true)
  }
  const connectRow = (
    <div className="ml-connect">
      {connected ? (
        <>
          <span className="ml-account">
            <Mail size={14} aria-hidden />
            <span className="ml-account__addr" data-testid="mail-account">
              {account}
            </span>
          </span>
          <span className="ml-actions__gap" />
          <button type="button" className="btn btn--ghost" onClick={disconnectGmail}>
            <Unplug size={14} /> {t('features.mail.disconnect')}
          </button>
        </>
      ) : (
        <>
          <button ref={connectBtn} type="button" className="btn btn--primary" disabled={!ready || phase === 'connecting'} onPointerEnter={() => ready && preloadGis()} onFocus={() => ready && preloadGis()} onClick={() => void connectGmail()}>
            <Plug size={14} /> {account || reconnect ? t('features.mail.reconnect') : t('features.mail.connect')}
          </button>
          {account && <span className="ml-field__hint ml-connect__last">{t('features.mail.access.last', { account })}</span>}
        </>
      )}
    </div>
  )
  const errorMsg = error && (
    <div className="ml-err" data-own={(ownHint && viaOne) || undefined}>
      <p className="ml-msg ml-msg--err" role="alert">
        {error}
      </p>
      {ownHint && viaOne && (
        <button type="button" className="btn btn--sm" onClick={openOwn}>
          <KeyRound size={13} /> {t('features.mail.builtin.useOwn')}
        </button>
      )}
    </div>
  )
  return (
    <Panel id={uid} code="§ A" title={t('features.mail.access.title')} state={state} stateText={stateText}>
      {viaOne ? (
        <>
          {!connected && !account && (
            <div className="ml-one" data-testid="mail-one-access">
              <p className="ml-one__lead">{t('features.mail.builtin.lead')}</p>
              <p className="ml-field__hint ml-one__review">{t('features.mail.builtin.review')}</p>
            </div>
          )}
          {connectRow}
          <p className="ml-field__hint ml-scope">{t('features.mail.access.scope')}</p>
          {errorMsg}
          <OwnClient open={advanced} onOpen={setAdvanced} details={details} />
        </>
      ) : (
        <>
          <Setup open={!ready} />
          <ClientIdField onCleared={(byKey) => (setAdvanced(false), byKey && setFocusConnect(true))} />
          {builtin && (
            <div className="ml-back">
              <button type="button" className="btn btn--sm" onClick={back}>
                <Undo2 size={13} /> {t('features.mail.builtin.back')}
              </button>
              <span className="ml-field__hint ml-back__hint">{t('features.mail.builtin.backHint')}</span>
            </div>
          )}
          {connectRow}
          <p className="ml-field__hint ml-scope">{t('features.mail.access.scope')}</p>
          {errorMsg}
        </>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ § B Sync */

function labelText(id: string, name: string | undefined, t: T): string {
  const key = `features.mail.label.${id}`
  const tr = t(key)
  return tr !== key ? tr : (name ?? id)
}

function LabelPicker() {
  const t = useT()
  const cfg = useMailSettings()
  const labels = useMail((s) => s.labels)
  const connected = useMail((s) => s.connected)
  useEffect(() => {
    if (connected && !labels) void loadLabels()
  }, [connected, labels])
  const list = labels ?? cfg.labels.map((id) => ({ id, name: id, type: 'system' as const }))
  const toggle = (id: string) => {
    const has = cfg.labels.includes(id)
    if (has && cfg.labels.length === 1) return
    setMail({ labels: has ? cfg.labels.filter((x) => x !== id) : [...cfg.labels, id] })
  }
  return (
    <MlField label={t('features.mail.sync.labels')} wide hint={labels ? t('features.mail.sync.labelsHint') : t('features.mail.sync.labelsConnect')}>
      <div className="ml-chips" role="group" aria-label={t('features.mail.sync.labels')}>
        {list.map((l) => {
          const on = cfg.labels.includes(l.id)
          return (
            <button key={l.id} type="button" className="ml-chip" aria-pressed={on} onClick={() => toggle(l.id)} disabled={on && cfg.labels.length === 1}>
              <span className="ml-chip__box" aria-hidden />
              {labelText(l.id, l.name, t)}
            </button>
          )
        })}
      </div>
    </MlField>
  )
}

function Destination() {
  const t = useT()
  const uid = useId()
  const cfg = useMailSettings()
  const team = useCloud((c) => c.active.kind === 'cloud')
  const pages = useWorkspace((s) => s.pages)
  const db = cfg.databaseId ? pages[cfg.databaseId] : undefined
  const parents = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => p.kind === 'page' && !p.databaseId && !p.trashed && !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id) && (!team || p.private))
        .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [pages, team],
  )
  if (db && !db.trashed)
    return (
      <MlField label={t('features.mail.sync.into')} hint={team ? t('features.mail.sync.privateHint') : t('features.mail.sync.intoHint')}>
        <button type="button" className="btn ml-dbbtn" onClick={() => openPage(db.id)}>
          <Mail size={14} /> <span className="ml-dbbtn__name">{db.title.trim() || t('common.untitled')}</span> <ArrowUpRight size={13} />
        </button>
      </MlField>
    )
  return (
    <MlField label={t('features.mail.sync.parent')} htmlFor={`${uid}-parent`} hint={team ? t('features.mail.sync.parentTeamHint') : t('features.mail.sync.parentHint')}>
      <select id={`${uid}-parent`} className="input" value={cfg.parentId ?? ''} onChange={(e) => setMail({ parentId: e.target.value || null })}>
        <option value="">{team ? t('features.mail.sync.privateTop') : t('features.mail.sync.top')}</option>
        {parents.map((p) => (
          <option key={p.id} value={p.id}>
            {p.title.trim() || t('common.untitled')}
          </option>
        ))}
      </select>
    </MlField>
  )
}

function Readout({ cells }: { cells: Array<[string, ReactNode]> }) {
  return (
    <dl className="ml-readout">
      {cells.map(([k, v]) => (
        <div key={k} className="ml-readout__cell">
          <dt className="label">{k}</dt>
          <dd className="ml-readout__val">{v}</dd>
        </div>
      ))}
    </dl>
  )
}

function RetryNote() {
  const t = useT()
  const until = useMail((s) => s.retryUntil)
  const [now, setNow] = useState(Date.now())
  useEffect(() => {
    if (!until) return
    const id = window.setInterval(() => setNow(Date.now()), 250)
    return () => window.clearInterval(id)
  }, [until])
  if (!until || until <= now) return null
  return (
    <p className="ml-msg" role="status">
      {t('features.mail.sync.retrying', { s: Math.ceil((until - now) / 1000) })}
    </p>
  )
}

function SyncPanel() {
  const t = useT()
  const lang = useLang()
  const uid = useId()
  const cfg = useMailSettings()
  const m = useMail()
  const { state, text } = useMailReadout()
  useBuiltinClient()
  const ready = !!effectiveClient(cfg)
  const busy = m.phase === 'running' || m.phase === 'linking' || m.phase === 'organising'
  const today = format(new Date(), 'yyyy-MM-dd')
  const num = (n: number) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')
  const pct = m.progress && m.progress.total ? Math.round((m.progress.done / m.progress.total) * 100) : 0
  const askReset = () =>
    useUI.getState().openModal({
      type: 'confirm',
      title: t('features.mail.reset.title'),
      body: t('features.mail.reset.body'),
      confirmLabel: t('features.mail.reset.confirm'),
      onConfirm: () => void resetMailSync(),
    })
  return (
    <Panel id={uid} code="§ B" title={t('features.mail.sync.title')} state={state} stateText={text}>
      <div className="ml-grid">
        <MlField label={t('features.mail.sync.from')} htmlFor={`${uid}-from`} hint={t('features.mail.sync.fromHint')}>
          <input id={`${uid}-from`} type="date" className="input ml-mono" value={cfg.from} max={today} required onChange={(e) => e.target.value && setMail({ from: e.target.value })} />
        </MlField>
        <Destination />
        <LabelPicker />
        <MlField label={t('features.mail.sync.max')} htmlFor={`${uid}-max`} hint={t('features.mail.sync.maxHint')}>
          <select id={`${uid}-max`} className="input" value={cfg.maxPerRun} onChange={(e) => setMail({ maxPerRun: Number(e.target.value) })}>
            {MAX_PER_RUN.map((n) => (
              <option key={n} value={n}>
                {t('features.mail.sync.maxN', { n })}
              </option>
            ))}
          </select>
        </MlField>
        <MlField label={t('features.mail.sync.when')} hint={t(`features.mail.sync.whenHint.${cfg.auto}`)}>
          <div className="ml-when">
            <div className="seg ml-seg" role="radiogroup" aria-label={t('features.mail.sync.when')}>
              {(['open', 'interval', 'manual'] as const).map((a) => (
                <button key={a} type="button" role="radio" aria-checked={cfg.auto === a} className="seg__btn" onClick={() => setMail({ auto: a })}>
                  {t(`features.mail.sync.auto.${a}`)}
                </button>
              ))}
            </div>
            {cfg.auto === 'interval' && (
              <select className="input ml-every" value={cfg.everyMin} aria-label={t('features.mail.sync.interval')} onChange={(e) => setMail({ everyMin: Number(e.target.value) })}>
                {EVERY_MIN.map((n) => (
                  <option key={n} value={n}>
                    {t('features.mail.sync.every', { n })}
                  </option>
                ))}
              </select>
            )}
          </div>
        </MlField>
      </div>
      <div className="ml-grid">
        <MlField label={t('features.mail.att.auto')} hint={t(`features.mail.att.autoHint.${cfg.attachments}`)}>
          <div className="seg ml-seg ml-seg--att" role="radiogroup" aria-label={t('features.mail.att.auto')}>
            {(['off', 'media', 'all'] as const).map((a) => (
              <button key={a} type="button" role="radio" aria-checked={cfg.attachments === a} className="seg__btn" onClick={() => setMail({ attachments: a })}>
                {t(`features.mail.att.auto.${a}`)}
              </button>
            ))}
          </div>
        </MlField>
      </div>
      <SwitchRow label={t('features.mail.sync.skipSpam')} hint={t('features.mail.sync.skipSpamHint')} checked={cfg.excludeSpamTrash} onChange={(v) => setMail({ excludeSpamTrash: v })} />
      <Readout
        cells={[
          [t('features.mail.ro.account'), m.account ?? '—'],
          [t('features.mail.ro.last'), fmtTime(m.lastAt, lang) ?? t('features.mail.never')],
          [t('features.mail.ro.mails'), num(m.total)],
          [t('features.mail.ro.waiting'), num(m.backlog)],
        ]}
      />
      {busy && (
        <div className="ml-progress" role="progressbar" aria-label={text} aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct}>
          <div className="ml-progress__fill" style={{ width: `${Math.max(pct, 2)}%` }} />
        </div>
      )}
      <RetryNote />
      {m.errorAt === 'sync' && m.error && (
        <p className="ml-msg ml-msg--err" role="alert">
          {m.error}
        </p>
      )}
      {m.target && (m.target === 'trashed' || m.target === 'shared') && (
        <div className="ml-actions ml-actions--target">
          <button type="button" className="btn" onClick={() => void startNewDatabase()}>
            <Plus size={14} /> {t(m.target === 'shared' ? 'features.mail.sync.newPrivate' : 'features.mail.sync.newDb')}
          </button>
        </div>
      )}
      <div className="ml-actions">
        {busy ? (
          <button type="button" className="btn" onClick={cancelRun}>
            <Square size={13} /> {t('features.mail.sync.stop')}
          </button>
        ) : (
          <button type="button" className="btn btn--primary" disabled={!ready} onPointerEnter={() => ready && !m.connected && preloadGis()} onClick={() => void syncNow({ connect: true })}>
            <RefreshCw size={14} /> {t('features.mail.sync.now')}
          </button>
        )}
        <span className="ml-actions__gap" />
        {(m.total > 0 || m.lastAt) && (
          <button type="button" className="btn btn--ghost" disabled={busy} onClick={askReset}>
            <RotateCcw size={14} /> {t('features.mail.reset.button')}
          </button>
        )}
      </div>
    </Panel>
  )
}

/* ------------------------------------------------------------------ § C Organise with Claude */

function Categories() {
  const t = useT()
  const uid = useId()
  const o = useMailSettings().organise
  const [draft, setDraft] = useState('')
  const add = () => {
    const c = cleanCategory(draft)
    if (!c) return
    if (!o.categories.some((x) => x.toLowerCase() === c.toLowerCase())) setOrganise({ categories: [...o.categories, c] })
    setDraft('')
  }
  return (
    <MlField label={t('features.mail.claude.categories')} wide htmlFor={`${uid}-cat`} hint={t('features.mail.claude.categoriesHint', { n: MAX_CATEGORIES })}>
      <div className="ml-chips">
        {o.categories.map((c) => (
          <span key={c} className="ml-tag">
            {c}
            <button type="button" className="ml-tag__x" onClick={() => setOrganise({ categories: o.categories.filter((x) => x !== c) })} aria-label={t('features.mail.claude.removeCategory', { name: c })}>
              <X size={11} />
            </button>
          </span>
        ))}
        {o.categories.length < MAX_CATEGORIES && (
          <span className="ml-tagadd">
            <input
              id={`${uid}-cat`}
              className="input ml-tagadd__input"
              value={draft}
              maxLength={32}
              placeholder={t('features.mail.claude.addCategory')}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  add()
                }
              }}
            />
            <button type="button" className="btn btn--sm" onClick={add} disabled={!draft.trim()} aria-label={t('common.add')}>
              <Plus size={13} />
            </button>
          </span>
        )}
      </div>
    </MlField>
  )
}

function OrganisePanel() {
  const t = useT()
  const uid = useId()
  const cfg = useMailSettings()
  const o = cfg.organise
  const hasKey = useWorkspace((s) => !!s.settings.aiApiKey.trim())
  const unorganised = useMail((s) => s.unorganised)
  const phase = useMail((s) => s.phase)
  useWorkspace((s) => s.settings.aiModel)
  const pages = useWorkspace((s) => s.pages)
  const databases = useMemo(
    () =>
      Object.values(pages)
        .filter((p) => p.kind === 'database' && !p.trashed && p.id !== cfg.databaseId && !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id))
        .sort((a, b) => (a.title || '').localeCompare(b.title || '')),
    [pages, cfg.databaseId],
  )
  const on = o.enabled && hasKey
  const est = estimateOrganise(cfg.maxPerRun)
  const usd = est.usd < 0.01 ? '< $0.01' : `≈ $${est.usd.toFixed(2)}`
  return (
    <Panel id={uid} code="§ D" title={t('features.mail.claude.title')} state={on ? 'ok' : 'off'} stateText={on ? t('features.mail.claude.on') : t('features.mail.claude.off')}>
      <SwitchRow
        label={t('features.mail.claude.switch')}
        hint={hasKey ? t('features.mail.claude.switchHint') : t('features.mail.claude.needsKey')}
        checked={on}
        disabled={!hasKey}
        onChange={(v) => setOrganise({ enabled: v })}
      />
      {on && (
        <>
          <div className="ml-warn" role="note">
            <Send size={14} aria-hidden className="ml-warn__icon" />
            <p>{t('features.mail.claude.privacy')}</p>
          </div>
          <Categories />
          <div className="ml-checks">
            <SwitchRow label={t('features.mail.claude.priority')} checked={o.priority} onChange={(v) => setOrganise({ priority: v })} />
            <SwitchRow label={t('features.mail.claude.needsReply')} checked={o.needsReply} onChange={(v) => setOrganise({ needsReply: v })} />
            <SwitchRow label={t('features.mail.claude.summary')} checked={o.summary} onChange={(v) => setOrganise({ summary: v })} />
          </div>
          <div className="ml-grid">
            <MlField label={t('features.mail.claude.relation')} htmlFor={`${uid}-rel`} hint={t('features.mail.claude.relationHint')}>
              <select id={`${uid}-rel`} className="input" value={o.relationDatabaseId ?? ''} onChange={(e) => setOrganise({ relationDatabaseId: e.target.value || null })}>
                <option value="">{t('features.mail.claude.noRelation')}</option>
                {databases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.title.trim() || t('common.untitled')}
                  </option>
                ))}
              </select>
            </MlField>
            <MlField label={t('features.mail.claude.cost')} hint={t('features.mail.claude.costHint')}>
              <div className="ml-cost" data-testid="mail-cost">
                <span className="ml-cost__usd">{usd}</span>
                <span className="label">{t('features.mail.claude.costPer', { n: cfg.maxPerRun, model: est.model })}</span>
              </div>
            </MlField>
          </div>
          {unorganised > 0 && (
            <div className="ml-actions">
              <button type="button" className="btn" disabled={phase !== 'idle'} onClick={() => void organiseEarlier()}>
                <Tags size={14} /> {t(unorganised === 1 ? 'features.mail.claude.earlier.one' : 'features.mail.claude.earlier', { n: Math.min(unorganised, cfg.maxPerRun) })}
              </button>
            </div>
          )}
        </>
      )}
    </Panel>
  )
}

/* ------------------------------------------------------------------ the tab */

export function MailTab() {
  const t = useT()
  const team = useCloud((c) => c.active.kind === 'cloud')
  return (
    <div className="ml">
      <h3 className="st-h">
        {t('features.mail.title')}
        <HelpLink id="gmail-sync" />
      </h3>
      <p className="st-p">{t('features.mail.intro')}</p>
      {team && <p className="ml-msg">{t('features.mail.teamNote')}</p>}
      <AccessPanel />
      <SyncPanel />
      <PeoplePanel />
      <OrganisePanel />
      <div className="st-note">
        <span className="st-note__mark" aria-hidden />
        <div>
          <strong>{t('features.mail.privacy.title')}</strong>
          <ul className="ml-privacy">
            <li>{t('features.mail.privacy.token')}</li>
            <li>{t('features.mail.privacy.local')}</li>
            <li>{t('features.mail.privacy.claude')}</li>
            <li>{t('features.mail.privacy.export')}</li>
            <li>{t('features.mail.privacy.readonly')}</li>
          </ul>
        </div>
      </div>
    </div>
  )
}

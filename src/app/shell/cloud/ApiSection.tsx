/**
 * Workspace settings → Automation → API & webhooks (docs/API.md): API tokens and incoming webhooks of the open team
 * workspace. Owners and admins manage them; everyone else reads why they can't. Secrets (a token,
 * a webhook URL) come from the server once and are shown once, with a curl example.
 */
import { useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { AlertTriangle, ArrowUpRight, Copy, History, KeyRound, RotateCw, Trash2, Undo2, Webhook } from 'lucide-react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import { de, enUS } from 'date-fns/locale'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { useLang, useT } from '../../i18n'
import { Led } from '../../ui/controls'
import { cloudApi, mcpChangedOf, type ApiComments, type ApiScope, type ApiToken, type IncomingHook, type McpCallEntry, type McpChanged, type McpRestore } from './api'
import { errorCode, errorText } from './errors'
import { HelpLink } from '../../help'
import { useCloud } from '../../cloud'
import { MCP_SERVER_SUPPORTS } from '../../../shared/mcp/tables'
import { canFocus, restoreFocus } from '../../ui/focus'
import './api.css'

export const API_DOCS_URL = 'https://github.com/MarcelWeissgerberIT/SimpleCMS/blob/main/docs/API.md'

type Confirm = { kind: 'revoke' | 'regenerate' | 'delete'; id: string } | null

const origin = () => (typeof window === 'undefined' ? '' : window.location.origin)

function useDates() {
  const lang = useLang()
  const locale = lang === 'de' ? de : enUS
  return {
    day: (ms: number) => format(ms, 'dd MMM yyyy', { locale }).toUpperCase(),
    ago: (ms: number) => formatDistanceToNowStrict(ms, { addSuffix: true, locale }),
  }
}

function useCopy() {
  const t = useT()
  return async (text: string, fallback?: HTMLInputElement | null) => {
    try {
      await navigator.clipboard.writeText(text)
      useUI.getState().toast({ message: t('shell.cloud.api.copied'), kind: 'success' })
    } catch {
      fallback?.select()
    }
  }
}

/**
 * Does this team server serve MCP contract 2 (`supports ∋ 'mcp:2'`): MCP writes kept 14 days with Restore, a token's
 * Comments? An older server answers neither (its 404 is no "workspace gone", its token form drops `comments`): the
 * section says in one line that the server needs an update instead.
 */
const useMcpServer = () => useCloud((s) => (s.supports ?? []).includes(MCP_SERVER_SUPPORTS))

/** Section heading in the team tab's style: number, mono label, dotted rule, count. */
function Head({ n, label, count, icon }: { n: string; label: string; count?: number; icon: ReactNode }) {
  return (
    <div className="tm-sect api-sect">
      <span className="tm-sect__n">{n}</span>
      <span className="api-sect__icon" aria-hidden>
        {icon}
      </span>
      <h4 className="label api-sect__label">{label}</h4>
      <span className="tm-sect__rule" aria-hidden />
      {count !== undefined && <span className="tm-sect__n">{String(count).padStart(2, '0')}</span>}
    </div>
  )
}

function DocsLink() {
  const t = useT()
  return (
    <a className="api-docs" href={API_DOCS_URL} target="_blank" rel="noreferrer noopener">
      {t('shell.cloud.api.docs')}
      <ArrowUpRight size={12} aria-hidden />
    </a>
  )
}

/** A secret shown once: the value with a copy button, why it's shown once, and a curl example. */
function Secret({ label, hint, value, example, onDone, testId }: { label: string; hint: string; value: string; example: string; onDone: () => void; testId: string }) {
  const t = useT()
  const copy = useCopy()
  const ref = useRef<HTMLInputElement>(null)
  const exampleId = useId()
  return (
    <div className="api-secret" data-testid={testId} role="group" aria-label={label}>
      <div className="api-secret__head">
        <Led state="on" />
        <span className="label api-secret__label">{label}</span>
      </div>
      <div className="api-secret__row">
        <input ref={ref} className="input api-secret__value" readOnly value={value} onFocus={(e) => e.currentTarget.select()} aria-label={label} spellCheck={false} />
        <button type="button" className="btn btn--primary" onClick={() => void copy(value, ref.current)}>
          <Copy size={13} aria-hidden />
          {t('shell.cloud.api.copy')}
        </button>
      </div>
      <p className="api-secret__hint">{hint}</p>
      <div className="api-example">
        <div className="api-example__bar">
          <span className="label" id={exampleId}>
            {t('shell.cloud.api.example')}
          </span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => void copy(example)}>
            <Copy size={12} aria-hidden />
            {t('shell.cloud.api.copyExample')}
          </button>
        </div>
        <pre className="api-example__code" tabIndex={0} aria-labelledby={exampleId}>
          {example}
        </pre>
      </div>
      <div className="api-secret__foot">
        <button type="button" className="btn btn--sm" onClick={onDone}>
          {t('shell.cloud.api.done')}
        </button>
      </div>
    </div>
  )
}

function ConfirmBar({ question, action, danger, busy, onCancel, onConfirm }: { question: string; action: string; danger?: boolean; busy: boolean; onCancel: () => void; onConfirm: () => void }) {
  const t = useT()
  return (
    <div className="tm-confirm" data-tone={danger ? undefined : 'signal'} role="group">
      <p className="tm-confirm__q">{question}</p>
      <div className="tm-confirm__actions">
        <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel} autoFocus>
          {t('shell.cloud.team.cancel')}
        </button>
        <button type="button" className={`btn btn--sm ${danger ? 'btn--danger-solid' : 'btn--ink'}`} disabled={busy} onClick={onConfirm}>
          {action}
        </button>
      </div>
    </div>
  )
}

function ErrorLine({ text }: { text: string | null }) {
  if (!text) return null
  return (
    <p className="cl-err" role="alert">
      <AlertTriangle size={13} aria-hidden />
      {text}
    </p>
  )
}

/* ------------------------------------------------------------------ section */

/** The whole "API & webhooks" part of the team tab (only rendered in a team workspace). */
export function ApiSection({ wsId, admin }: { wsId: string; admin: boolean }) {
  const t = useT()
  if (!admin) {
    return (
      <section className="api" aria-label={t('shell.cloud.api.section')}>
        <Head n="05" label={t('shell.cloud.api.section')} icon={<KeyRound size={12} />} />
        <p className="tm-empty api-note" data-testid="api-admin-only">
          {t('shell.cloud.api.adminOnly')} <DocsLink />
        </p>
      </section>
    )
  }
  return (
    <section className="api" aria-label={t('shell.cloud.api.section')}>
      <Tokens wsId={wsId} />
      <Hooks wsId={wsId} />
      <McpCalls wsId={wsId} />
    </section>
  )
}

/* ------------------------------------------------------------------ tokens */

function Tokens({ wsId }: { wsId: string }) {
  const t = useT()
  const uid = useId()
  const { day, ago } = useDates()
  const [tokens, setTokens] = useState<ApiToken[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [name, setName] = useState('')
  const [scope, setScope] = useState<ApiScope>('write')
  // comments over MCP: off unless an admin switches them on for this token (a read token never writes them)
  const [comments, setComments] = useState<ApiComments>('off')
  const [creating, setCreating] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [created, setCreated] = useState<ApiToken | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)
  const firstDb = useWorkspace((s) => Object.values(s.pages).find((p) => p.kind === 'database' && !p.trashed)?.id ?? null)
  const mcp2 = useMcpServer()

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setTokens(await cloudApi.listApiTokens(wsId))
    } catch (e) {
      setLoadError(errorText(e, t))
    }
  }, [wsId, t])

  useEffect(() => {
    void load()
  }, [load])

  const create = async () => {
    if (!name.trim()) return
    setCreating(true)
    setError(null)
    try {
      // an older server drops `comments` without a word: it is not offered there (always 'off')
      const tok = await cloudApi.createApiToken(wsId, name.trim(), scope, !mcp2 ? 'off' : scope === 'read' && comments === 'write' ? 'read' : comments)
      setCreated(tok)
      setName('')
      setTokens((list) => [tok, ...(list ?? [])])
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setCreating(false)
    }
  }

  const revoke = async (tok: ApiToken) => {
    setBusy(true)
    try {
      await cloudApi.revokeApiToken(wsId, tok.id)
      setTokens((list) => (list ?? []).filter((x) => x.id !== tok.id))
      if (created?.id === tok.id) setCreated(null)
      setConfirm(null)
      useUI.getState().toast({ message: t('shell.cloud.api.revoked') })
    } catch (e) {
      useUI.getState().toast({ message: errorText(e, t), kind: 'error' })
    } finally {
      setBusy(false)
    }
  }

  const example = (tok: ApiToken) =>
    tok.scope === 'write' && firstDb
      ? `curl -X POST ${origin()}/api/v1/databases/${firstDb}/rows \\\n  -H "Authorization: Bearer ${tok.token}" \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ title: t('shell.cloud.api.sample') })}'`
      : `curl ${origin()}/api/v1/databases \\\n  -H "Authorization: Bearer ${tok.token}"`

  return (
    <>
      <Head n="05" label={t('shell.cloud.api.title')} count={tokens?.length} icon={<KeyRound size={12} />} />
      <p className="api-lede">
        {t('shell.cloud.api.lede')} <DocsLink />
      </p>
      <form
        className="api-form api-form--token"
        onSubmit={(e) => {
          e.preventDefault()
          void create()
        }}
      >
        <div className="api-form__field">
          <label className="label" htmlFor={`${uid}-name`}>
            {t('shell.cloud.api.name')}
          </label>
          <input id={`${uid}-name`} className="input" value={name} maxLength={80} autoComplete="off" placeholder={t('shell.cloud.api.namePh')} onChange={(e) => setName(e.target.value)} />
        </div>
        <div className="api-form__field">
          <label className="label" htmlFor={`${uid}-scope`}>
            {t('shell.cloud.api.scope')}
          </label>
          <select
            id={`${uid}-scope`}
            className="input"
            value={scope}
            onChange={(e) => {
              const next = e.target.value as ApiScope
              setScope(next)
              if (next === 'read' && comments === 'write') setComments('read')
            }}
          >
            <option value="write">{t('shell.cloud.api.scope.write')}</option>
            <option value="read">{t('shell.cloud.api.scope.read')}</option>
          </select>
        </div>
        {mcp2 && (
          <div className="api-form__field">
            <label className="label" htmlFor={`${uid}-comments`}>
              {t('shell.cloud.api.comments')}
            </label>
            <select id={`${uid}-comments`} className="input" value={comments} onChange={(e) => setComments(e.target.value as ApiComments)} aria-describedby={`${uid}-comments-h`} data-testid="api-token-comments">
              <option value="off">{t('shell.cloud.api.comments.off')}</option>
              <option value="read">{t('shell.cloud.api.comments.read')}</option>
              <option value="write" disabled={scope === 'read'}>
                {t('shell.cloud.api.comments.write')}
              </option>
            </select>
          </div>
        )}
        <button type="submit" className="btn btn--ink" disabled={creating || !name.trim()}>
          <KeyRound size={14} aria-hidden />
          {creating ? t('shell.cloud.api.creating') : t('shell.cloud.api.create')}
        </button>
      </form>
      {mcp2 ? (
        <p className="api-hint">
          <span id={`${uid}-comments-h`}>{t('shell.cloud.api.commentsHint')}</span>
          <HelpLink id="public-api" topic={t('shell.cloud.api.comments')} />
        </p>
      ) : null}
      <ErrorLine text={error} />
      {created?.token && <Secret testId="api-token-secret" label={t('shell.cloud.api.secret')} hint={t('shell.cloud.api.secretHint')} value={created.token} example={example(created)} onDone={() => setCreated(null)} />}
      {loadError ? (
        <ErrorLine text={loadError} />
      ) : !tokens ? (
        <div className="tm-status" role="status">
          <Led state="on" />
          {t('shell.cloud.api.loading')}
        </div>
      ) : tokens.length === 0 ? (
        <p className="tm-empty">{t('shell.cloud.api.none')}</p>
      ) : (
        <ul className="tm-list api-list" aria-label={t('shell.cloud.api.title')}>
          {tokens.map((tok) => {
            const by = tok.created_by ? tok.created_by.name?.trim() || tok.created_by.email || '' : ''
            const meta = [by && t('shell.cloud.api.by', { name: by }), t('shell.cloud.api.created', { date: day(tok.created_at) }), tok.last_used_at ? t('shell.cloud.api.used', { when: ago(tok.last_used_at) }) : t('shell.cloud.api.neverUsed')]
            return (
              <li key={tok.id} className="api-row" data-testid="api-token">
                <span className="api-row__glyph" aria-hidden>
                  <KeyRound size={14} />
                </span>
                <div className="api-row__what">
                  <span className="api-row__name">
                    <span title={tok.name}>{tok.name}</span>
                    <span className="api-scope" data-scope={tok.scope}>
                      {t(`shell.cloud.api.tag.${tok.scope}`)}
                    </span>
                    {tok.comments && tok.comments !== 'off' && (
                      <span className="api-scope" data-comments={tok.comments} title={t('shell.cloud.api.comments')}>
                        {t(`shell.cloud.api.tag.comments.${tok.comments}`)}
                      </span>
                    )}
                  </span>
                  <span className="api-row__meta">{meta.filter(Boolean).join(' · ')}</span>
                </div>
                <div className="api-row__ctl">
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm({ kind: 'revoke', id: tok.id })} disabled={busy} aria-label={`${t('shell.cloud.api.revoke')}: ${tok.name}`}>
                    <Trash2 size={13} aria-hidden />
                    {t('shell.cloud.api.revoke')}
                  </button>
                </div>
                {confirm?.kind === 'revoke' && confirm.id === tok.id && (
                  <ConfirmBar question={t('shell.cloud.api.revokeQ', { name: tok.name })} action={t('shell.cloud.api.revoke')} danger busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void revoke(tok)} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ incoming webhooks */

function Hooks({ wsId }: { wsId: string }) {
  const t = useT()
  const uid = useId()
  const { day, ago } = useDates()
  const [hooks, setHooks] = useState<IncomingHook[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [dbId, setDbId] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [shown, setShown] = useState<IncomingHook | null>(null)
  const [confirm, setConfirm] = useState<Confirm>(null)

  // databases of this workspace (not in the trash), by title
  const dbs = useWorkspace(
    useShallow((s) =>
      Object.values(s.pages)
        .filter((p) => p.kind === 'database' && !p.trashed)
        .map((p) => `${p.id}\u0000${p.title}`),
    ),
  )
  const databases = useMemo(
    () =>
      dbs
        .map((x) => {
          const [id, title] = x.split('\u0000')
          return { id: id!, title: title || t('common.untitled') }
        })
        .sort((a, b) => a.title.localeCompare(b.title)),
    [dbs, t],
  )
  const selected = databases.some((d) => d.id === dbId) ? dbId : (databases[0]?.id ?? '')

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setHooks(await cloudApi.listHooks(wsId))
    } catch (e) {
      setLoadError(errorText(e, t))
    }
  }, [wsId, t])

  useEffect(() => {
    void load()
  }, [load])

  const run = async (job: () => Promise<void>) => {
    setBusy(true)
    setError(null)
    try {
      await job()
      setConfirm(null)
    } catch (e) {
      setError(errorText(e, t))
    } finally {
      setBusy(false)
    }
  }

  const create = () =>
    run(async () => {
      const h = await cloudApi.createHook(wsId, selected)
      setShown(h)
      setHooks((list) => [h, ...(list ?? [])])
    })

  const regenerate = (h: IncomingHook) =>
    run(async () => {
      const fresh = await cloudApi.regenerateHook(wsId, h.id)
      setShown(fresh)
      setHooks((list) => (list ?? []).map((x) => (x.id === h.id ? fresh : x)))
    })

  const remove = (h: IncomingHook) =>
    run(async () => {
      await cloudApi.deleteHook(wsId, h.id)
      setHooks((list) => (list ?? []).filter((x) => x.id !== h.id))
      if (shown?.id === h.id) setShown(null)
      useUI.getState().toast({ message: t('shell.cloud.hooks.deleted') })
    })

  const example = (url: string) => `curl -X POST ${url} \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify({ title: t('shell.cloud.hooks.sample') })}'`
  const titleOf = (h: IncomingHook) => h.database.title || (h.database.title === '' ? t('common.untitled') : t('shell.cloud.hooks.gone'))

  return (
    <>
      <Head n="06" label={t('shell.cloud.hooks.title')} count={hooks?.length} icon={<Webhook size={12} />} />
      <p className="api-lede">{t('shell.cloud.hooks.lede')}</p>
      {databases.length === 0 ? (
        <p className="tm-empty">{t('shell.cloud.hooks.noDatabases')}</p>
      ) : (
        <form
          className="api-form api-form--hook"
          onSubmit={(e) => {
            e.preventDefault()
            void create()
          }}
        >
          <div className="api-form__field">
            <label className="label" htmlFor={`${uid}-db`}>
              {t('shell.cloud.hooks.database')}
            </label>
            <select id={`${uid}-db`} className="input" value={selected} onChange={(e) => setDbId(e.target.value)}>
              {databases.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.title}
                </option>
              ))}
            </select>
          </div>
          <button type="submit" className="btn btn--ink" disabled={busy || !selected}>
            <Webhook size={14} aria-hidden />
            {t('shell.cloud.hooks.create')}
          </button>
        </form>
      )}
      <ErrorLine text={error} />
      {shown?.url && <Secret testId="api-hook-url" label={t('shell.cloud.hooks.url')} hint={t('shell.cloud.hooks.urlHint')} value={shown.url} example={example(shown.url)} onDone={() => setShown(null)} />}
      {loadError ? (
        <ErrorLine text={loadError} />
      ) : !hooks ? (
        <div className="tm-status" role="status">
          <Led state="on" />
          {t('shell.cloud.api.loading')}
        </div>
      ) : hooks.length === 0 ? (
        <p className="tm-empty">{t('shell.cloud.hooks.none')}</p>
      ) : (
        <ul className="tm-list api-list" aria-label={t('shell.cloud.hooks.title')}>
          {hooks.map((h) => {
            const name = titleOf(h)
            const meta = [
              t('shell.cloud.api.created', { date: day(h.created_at) }),
              ...(h.deliveries ? [t('shell.cloud.hooks.count', { n: h.deliveries }), ...(h.last_delivery_at ? [t('shell.cloud.hooks.last', { when: ago(h.last_delivery_at) })] : [])] : [t('shell.cloud.hooks.never')]),
            ]
            return (
              <li key={h.id} className="api-row" data-testid="api-hook">
                <span className="api-row__glyph" aria-hidden>
                  <Webhook size={14} />
                </span>
                <div className="api-row__what">
                  <span className="api-row__name" data-gone={h.database.title === null || undefined}>
                    <span>{name}</span>
                  </span>
                  <span className="api-row__meta">{meta.join(' · ')}</span>
                </div>
                <div className="api-row__ctl">
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm({ kind: 'regenerate', id: h.id })} disabled={busy} aria-label={`${t('shell.cloud.hooks.regenerate')}: ${name}`}>
                    <RotateCw size={13} aria-hidden />
                    {t('shell.cloud.hooks.regenerate')}
                  </button>
                  <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm({ kind: 'delete', id: h.id })} disabled={busy} aria-label={`${t('shell.cloud.hooks.delete')}: ${name}`}>
                    <Trash2 size={13} aria-hidden />
                    {t('shell.cloud.hooks.delete')}
                  </button>
                </div>
                {confirm?.id === h.id && confirm.kind === 'regenerate' && (
                  <ConfirmBar question={t('shell.cloud.hooks.regenerateQ', { name })} action={t('shell.cloud.hooks.regenerateDo')} busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void regenerate(h)} />
                )}
                {confirm?.id === h.id && confirm.kind === 'delete' && (
                  <ConfirmBar question={t('shell.cloud.hooks.deleteQ', { name })} action={t('shell.cloud.hooks.delete')} danger busy={busy} onCancel={() => setConfirm(null)} onConfirm={() => void remove(h)} />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </>
  )
}

/* ------------------------------------------------------------------ recent MCP writes (team server pre-images) */

type CallConfirm = { id: string; kind: 'restore' | 'force' } | null

/** Owners / admins: the MCP calls of the last 14 days that wrote something, each with Restore (docs/MCP.md). */
function McpCalls({ wsId }: { wsId: string }) {
  const mcp2 = useMcpServer()
  return mcp2 ? <McpCallList wsId={wsId} /> : <McpOlder />
}

/** § 07 on a team server without contract 2: it keeps no MCP writes — one line that it needs an update, nothing to load. */
function McpOlder() {
  const t = useT()
  return (
    <div className="api-mcp">
      <Head n="07" label={t('shell.cloud.mcp.title')} icon={<History size={12} />} />
      <p className="tm-empty api-note" data-testid="mcp-calls-older">
        {t('shell.cloud.mcp.older')}
      </p>
    </div>
  )
}

function McpCallList({ wsId }: { wsId: string }) {
  const t = useT()
  const { ago } = useDates()
  const [calls, setCalls] = useState<McpCallEntry[] | null>(null)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [confirm, setConfirm] = useState<CallConfirm>(null)
  /** a refused restore per call: what moved since (all or nothing — nothing was put back) */
  const [refused, setRefused] = useState<Record<string, McpChanged>>({})
  /** a forced restore per call: what the call made that stays */
  const [left, setLeft] = useState<Record<string, McpRestore['left']>>({})
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * Focus after a bar or a key goes away (CLAUDE.md: focus never ends on the page body): the call's Restore key, its
   * "Restore anyway" key, the call's row, else the section — the first of `order` that is there once the list rendered.
   */
  const focusCall = useCallback((id: string, order: Array<'restore' | 'force' | 'row'>) => {
    const tryFocus = () => {
      const root = listRef.current
      if (!root) return false
      const row = Array.from(root.querySelectorAll<HTMLElement>('[data-call]')).find((el) => el.dataset.call === id) ?? null
      for (const what of order) {
        const el = what === 'row' ? row : (row?.querySelector<HTMLElement>(`[data-focus="${what}"]`) ?? null)
        if (canFocus(el)) {
          restoreFocus(el)
          return true
        }
      }
      const head = root.querySelector<HTMLElement>('[data-focus="section"]')
      if (canFocus(head)) restoreFocus(head)
      return true
    }
    // after React put the list in its new state (two frames: the bar's unmount, then the reloaded list)
    requestAnimationFrame(() => requestAnimationFrame(() => void tryFocus()))
  }, [])

  /** The confirm bar closes without acting: focus back to the key that opened it. */
  const cancel = (call: McpCallEntry) => {
    const was = confirm
    setConfirm(null)
    focusCall(call.callId, was?.kind === 'force' ? ['force', 'restore', 'row'] : ['restore', 'force', 'row'])
  }

  const load = useCallback(async () => {
    setLoadError(null)
    try {
      setCalls(await cloudApi.listMcpCalls(wsId))
    } catch (e) {
      // the server's generic 404 (an unknown endpoint — a gone workspace says workspace_not_found): a server older than
      // its `supports` said, never "this workspace no longer exists"
      setLoadError(errorCode(e) === 'not_found' ? t('shell.cloud.mcp.older') : errorText(e, t))
    }
  }, [wsId, t])

  useEffect(() => {
    void load()
  }, [load])

  const quote = (names: string[]) => names.map((n) => `“${n || t('common.untitled')}”`).join(', ')
  /** each thing that moved since, with what moved: “Card 3” (Owner), “Glossar” (title, moved) */
  const movedNames = (r: McpChanged) =>
    r.changed
      .map((c) => {
        const what = [...c.fields, ...c.what.filter((w) => !(w === 'values' && c.fields.length)).map((w) => t(`shell.cloud.mcp.what.${w}`))]
        return `“${c.title || t('common.untitled')}”${what.length ? ` (${what.join(', ')})` : ''}`
      })
      .join(', ')

  const restore = async (call: McpCallEntry, force: boolean) => {
    setBusy(call.callId)
    setError(null)
    try {
      const out = await cloudApi.restoreMcpCall(wsId, call.callId, force)
      setConfirm(null)
      setRefused(({ [call.callId]: _, ...rest }) => rest)
      setLeft(({ [call.callId]: _, ...rest }) => (out.left.length ? { ...rest, [call.callId]: out.left } : rest))
      if (!out.left.length) useUI.getState().toast({ message: t('shell.cloud.mcp.done'), kind: 'success' })
      await load()
      // the bar and the row's Restore key are gone: the row
      focusCall(call.callId, ['row'])
    } catch (e) {
      setConfirm(null)
      // something moved since the call: nothing was put back — say what, and offer "Restore anyway" when it can help
      const moved = errorCode(e) === 'changed_since' ? mcpChangedOf(e) : null
      if (moved) {
        setRefused((was) => ({ ...was, [call.callId]: moved }))
        focusCall(call.callId, ['force', 'restore', 'row'])
      } else {
        setError(errorText(e, t))
        focusCall(call.callId, ['restore', 'row'])
      }
    } finally {
      setBusy(null)
    }
  }

  const toolLabel = (tool: string) => {
    const key = `shell.cloud.mcp.tool.${tool}`
    const label = t(key)
    return label === key ? tool : label
  }

  return (
    <div ref={listRef} className="api-mcp">
      <div tabIndex={-1} data-focus="section" className="api-mcp__head">
        <Head n="07" label={t('shell.cloud.mcp.title')} count={calls?.length} icon={<History size={12} />} />
      </div>
      <p className="api-lede">
        {t('shell.cloud.mcp.lede')}
        <HelpLink id="public-api" topic={t('shell.cloud.mcp.title')} />
      </p>
      <ErrorLine text={error} />
      {loadError ? (
        <ErrorLine text={loadError} />
      ) : !calls ? (
        <div className="tm-status" role="status">
          <Led state="on" />
          {t('shell.cloud.api.loading')}
        </div>
      ) : calls.length === 0 ? (
        <p className="tm-empty" data-testid="mcp-calls-none">
          {t('shell.cloud.mcp.none')}
        </p>
      ) : (
        <ul className="tm-list api-list" aria-label={t('shell.cloud.mcp.title')}>
          {calls.map((call) => {
            const more = call.made + call.changed - call.titles.length
            const name = call.titles.length ? `${call.titles.map((x) => x || t('common.untitled')).join(', ')}${more > 0 ? ` +${more}` : ''}` : toolLabel(call.tool)
            const meta = [
              toolLabel(call.tool),
              call.token.name ? t('shell.cloud.mcp.token', { name: call.token.name }) : t('shell.cloud.mcp.tokenGone'),
              ...(call.made ? [t('shell.cloud.mcp.made', { n: call.made })] : []),
              ...(call.changed ? [t('shell.cloud.mcp.changed', { n: call.changed })] : []),
              ago(call.at),
            ]
            const moved = refused[call.callId]
            const stays = left[call.callId]
            return (
              <li key={call.callId} className="api-row" data-testid="mcp-call" data-call={call.callId} tabIndex={-1} aria-label={name} data-restored={call.restoredAt ? '' : undefined}>
                <span className="api-row__glyph" aria-hidden>
                  <History size={14} />
                </span>
                <div className="api-row__what">
                  <span className="api-row__name">
                    <span title={name}>{name}</span>
                    {call.restoredAt && <span className="api-scope">{t('shell.cloud.mcp.restored')}</span>}
                  </span>
                  <span className="api-row__meta">{meta.join(' · ')}</span>
                </div>
                <div className="api-row__ctl">
                  {!call.restoredAt && (
                    <button type="button" className="btn btn--sm btn--ghost" data-focus="restore" onClick={() => setConfirm({ id: call.callId, kind: 'restore' })} disabled={busy !== null} aria-label={`${t('shell.cloud.mcp.restore')}: ${name}`}>
                      <Undo2 size={13} aria-hidden />
                      {t('shell.cloud.mcp.restore')}
                    </button>
                  )}
                </div>
                {moved && !call.restoredAt && confirm?.id !== call.callId && (
                  <div className="api-kept" role="status" data-testid="mcp-call-changed">
                    <p className="api-kept__line">
                      {t('shell.cloud.mcp.changedSince', { names: movedNames(moved) })} {t(moved.canForce ? 'shell.cloud.mcp.forceHint' : 'shell.cloud.mcp.undoInOne')}
                    </p>
                    {moved.canForce && (
                      <button type="button" className="btn btn--sm btn--ghost" data-focus="force" disabled={busy !== null} onClick={() => setConfirm({ id: call.callId, kind: 'force' })}>
                        {t('shell.cloud.mcp.force')}
                      </button>
                    )}
                  </div>
                )}
                {stays && call.restoredAt && (
                  <div className="api-kept" role="status" data-testid="mcp-call-left">
                    <p className="api-kept__line">{t('shell.cloud.mcp.left', { names: quote(stays.map((m) => m.title)) })}</p>
                  </div>
                )}
                {confirm?.id === call.callId && confirm.kind === 'restore' && (
                  <ConfirmBar question={t('shell.cloud.mcp.restoreQ')} action={t('shell.cloud.mcp.restore')} busy={busy !== null} onCancel={() => cancel(call)} onConfirm={() => void restore(call, false)} />
                )}
                {confirm?.id === call.callId && confirm.kind === 'force' && (
                  <ConfirmBar
                    question={t('shell.cloud.mcp.forceQ')}
                    action={t('shell.cloud.mcp.force')}
                    danger
                    busy={busy !== null}
                    onCancel={() => cancel(call)}
                    onConfirm={() => void restore(call, true)}
                  />
                )}
              </li>
            )
          })}
        </ul>
      )}
    </div>
  )
}

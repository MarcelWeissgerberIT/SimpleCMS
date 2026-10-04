/**
 * Settings → Claude AI → "MCP servers": the remote MCP servers One's Claude may use (name, https URL,
 * a sealed token, on/off, a usage prompt Claude can write itself) and the editable MCP instructions
 * template. Everything here is this device's setting; tokens live in the vault (store/secrets.ts).
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { ChevronDown, ChevronRight, Info, Plus, Trash2 } from 'lucide-react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import type { McpServerConfig } from '../../../store/types'
import { newId } from '../../../lib/ids'
import { Switch } from '../../../ui/controls'
import { SecretField } from '../../../ui/SecretField'
import {
  INSTRUCTIONS_MAX,
  MAX_SERVERS,
  NAME_MAX,
  PROMPT_MAX,
  defaultInstructions,
  nameProblem,
  patchServer,
  readServers,
  slugName,
  tokenState,
  urlProblem,
  writeServers,
} from './config'
import { inspectServer } from './generate'
import './mcp-servers.css'

type T = ReturnType<typeof useT>
const tn = (t: T, key: string, count: number) => t(`${key}.${count === 1 ? 'one' : 'other'}`, { count })

/** "https://atlas.example.com/mcp" → "atlas.example.com/mcp" */
const shortUrl = (url: string) => url.replace(/^https:\/\//, '').replace(/\/$/, '')

export function McpServers() {
  const t = useT()
  const raw = useWorkspace((s) => s.settings.mcpServers)
  const servers = useMemo(() => readServers({ mcpServers: raw }), [raw])
  const hasKey = useWorkspace((s) => !!s.settings.aiApiKey.trim())
  /** the expanded card: a server id, or 'new' for the add form */
  const [open, setOpen] = useState<string | null>(null)
  /** a server added in this visit (its card says what to do next) */
  const [added, setAdded] = useState<string | null>(null)
  const headId = useId()
  const names = servers.map((s) => s.name)

  return (
    <section className="mcps" aria-labelledby={headId} data-testid="mcp-servers">
      <header className="mcps__head">
        <div className="mcps__heading">
          <span className="label mcps__code">§ MCP — {t('features.ai.mcp.code')}</span>
          <h4 className="mcps__title" id={headId}>
            {t('features.ai.mcp.title')}
          </h4>
        </div>
        <span className="label mcps__count">{t('features.ai.mcp.count', { count: servers.length, max: MAX_SERVERS })}</span>
        <button type="button" className="btn btn--sm" onClick={() => setOpen('new')} disabled={open === 'new' || servers.length >= MAX_SERVERS}>
          <Plus size={13} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.add')}
        </button>
      </header>
      <p className="mcps__lead">{t('features.ai.mcp.lead')}</p>
      {servers.length > 0 && (
        <ul className="mcps__list">
          {servers.map((s) => (
            <ServerCard
              key={s.id}
              server={s}
              others={names.filter((n) => n !== s.name)}
              open={open === s.id}
              onOpen={(v) => setOpen(v ? s.id : null)}
              hasKey={hasKey}
              fresh={added === s.id}
            />
          ))}
        </ul>
      )}
      {open === 'new' ? (
        <NewServer
          others={names}
          onAdded={(id) => {
            setAdded(id)
            setOpen(id)
          }}
          onCancel={() => setOpen(null)}
        />
      ) : (
        servers.length === 0 && <p className="mcps__empty">{t('features.ai.mcp.empty')}</p>
      )}
      <Instructions />
      <p className="mcps__via">
        <Info size={14} strokeWidth={1.7} aria-hidden />
        <span>{t('features.ai.mcp.via')}</span>
      </p>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Fields                                                              */
/* ------------------------------------------------------------------ */

function Field({ id, label, hint, error, children }: { id: string; label: string; hint: ReactNode; error?: string; children: ReactNode }) {
  return (
    <div className="mcps-field" data-error={error ? '' : undefined}>
      <label className="mcps-field__label" htmlFor={id}>
        {label}
      </label>
      {children}
      <div className="mcps-field__hint" id={`${id}-hint`} role={error ? 'alert' : undefined}>
        {error || hint}
      </div>
    </div>
  )
}

/** Name + URL inputs with their checks (shared by "add" and "edit"). */
function useConnection(initial: { name: string; url: string }, others: string[]) {
  const t = useT()
  const [name, setName] = useState(initial.name)
  const [url, setUrl] = useState(initial.url)
  const [touched, setTouched] = useState({ name: false, url: false, all: false })
  const nameErr = nameProblem(name.replace(/[-_]+$/, ''), others)
  const urlErr = urlProblem(url)
  const show = (k: 'name' | 'url', err: string) => (err && (touched.all || (touched[k] && err !== 'empty')) ? t(`features.ai.mcp.err.${k}.${err}`) : '')
  return {
    name,
    url,
    setName: (v: string) => setName(slugName(v)),
    setUrl,
    reset: (v: { name: string; url: string }) => {
      setName(v.name)
      setUrl(v.url)
      setTouched({ name: false, url: false, all: false })
    },
    blur: (k: 'name' | 'url') => setTouched((x) => ({ ...x, [k]: true })),
    tryAll: () => setTouched((x) => ({ ...x, all: true })),
    valid: !nameErr && !urlErr,
    nameError: show('name', nameErr),
    urlError: show('url', urlErr),
    clean: { name: name.replace(/[-_]+$/, ''), url: url.trim() },
  }
}

function ConnectionFields({ c, ids }: { c: ReturnType<typeof useConnection>; ids: { name: string; url: string } }) {
  const t = useT()
  return (
    <>
      <Field id={ids.name} label={t('features.ai.mcp.name')} hint={t('features.ai.mcp.nameHint')} error={c.nameError}>
        <input
          id={ids.name}
          className="input mcps-input--mono"
          value={c.name}
          maxLength={NAME_MAX}
          placeholder="atlas"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={c.nameError ? true : undefined}
          aria-describedby={`${ids.name}-hint`}
          onChange={(e) => c.setName(e.target.value)}
          onBlur={() => c.blur('name')}
        />
      </Field>
      <Field id={ids.url} label={t('features.ai.mcp.url')} hint={t('features.ai.mcp.urlHint')} error={c.urlError}>
        <input
          id={ids.url}
          className="input mcps-input--mono"
          type="url"
          inputMode="url"
          value={c.url}
          placeholder="https://mcp.example.com/mcp"
          autoComplete="off"
          spellCheck={false}
          aria-invalid={c.urlError ? true : undefined}
          aria-describedby={`${ids.url}-hint`}
          onChange={(e) => c.setUrl(e.target.value)}
          onBlur={() => c.blur('url')}
        />
      </Field>
    </>
  )
}

/* ------------------------------------------------------------------ */
/* Add                                                                 */
/* ------------------------------------------------------------------ */

function NewServer({ others, onAdded, onCancel }: { others: string[]; onAdded: (id: string) => void; onCancel: () => void }) {
  const t = useT()
  const uid = useId()
  const c = useConnection({ name: '', url: '' }, others)
  const [token, setToken] = useState('')
  useEffect(() => {
    document.getElementById(`${uid}-name`)?.focus()
  }, [uid])

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    c.tryAll()
    if (!c.valid) return
    const id = newId()
    // the store seals a plaintext token and keeps its marker (store/secrets.ts)
    writeServers([...readServers(), { id, name: c.clean.name, url: c.clean.url, token: token.trim(), enabled: true, prompt: '' }])
    setToken('')
    onAdded(id)
  }

  return (
    <form
      className="mcps-card mcps-card--new"
      onSubmit={submit}
      noValidate
      aria-label={t('features.ai.mcp.add')}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.preventDefault()
          e.stopPropagation()
          onCancel()
        }
      }}
    >
      <div className="mcps-card__body">
        <div className="mcps-grid">
          <ConnectionFields c={c} ids={{ name: `${uid}-name`, url: `${uid}-url` }} />
          <div className="mcps-grid__wide">
            <Field id={`${uid}-token`} label={`${t('features.ai.mcp.token')} · ${t('features.ai.mcp.tokenOptional')}`} hint={t('features.ai.mcp.tokenHint')}>
            <input
              id={`${uid}-token`}
              className="input"
              type="password"
              value={token}
              autoComplete="off"
              spellCheck={false}
              aria-describedby={`${uid}-token-hint`}
              onChange={(e) => setToken(e.target.value)}
              />
            </Field>
          </div>
        </div>
        <div className="mcps-actions">
          <button type="button" className="btn btn--sm btn--ghost" onClick={onCancel}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--sm btn--primary">
            {t('features.ai.mcp.addSubmit')}
          </button>
        </div>
      </div>
    </form>
  )
}

/* ------------------------------------------------------------------ */
/* A server                                                            */
/* ------------------------------------------------------------------ */

/** Whether this browser can open the server's token ('ok' / 'none' / 'missing'; null while checking). */
function useTokenState(server: McpServerConfig): 'none' | 'ok' | 'missing' | null {
  const [state, setState] = useState<'none' | 'ok' | 'missing' | null>(null)
  useEffect(() => {
    let alive = true
    void tokenState(server).then((s) => alive && setState(s))
    return () => {
      alive = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [server.id, server.token])
  return state
}

function ServerCard({ server, others, open, onOpen, hasKey, fresh }: { server: McpServerConfig; others: string[]; open: boolean; onOpen: (v: boolean) => void; hasKey: boolean; fresh: boolean }) {
  const t = useT()
  const token = useTokenState(server)
  const state = !server.enabled ? 'off' : token === 'missing' ? 'missing' : 'on'
  const bodyId = useId()
  const meta = [
    t(`features.ai.mcp.state.${state}`),
    server.token ? t('features.ai.mcp.meta.token') : t('features.ai.mcp.meta.noToken'),
    server.tools ? tn(t, 'features.ai.mcp.meta.tools', server.tools.length) : t('features.ai.mcp.meta.unchecked'),
  ]
  return (
    <li className="mcps-card" data-state={state} data-open={open || undefined} data-server={server.name}>
      <div className="mcps-card__head">
        <span className={`led${state === 'on' ? ' led--ok' : state === 'missing' ? ' mcps-led--warn' : ''}`} aria-hidden />
        <button type="button" className="mcps-card__toggle" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => onOpen(!open)} aria-label={t('features.ai.mcp.details', { name: server.name })}>
          <span className="mcps-card__name">{server.name.toUpperCase()}</span>
          <span className="mcps-card__url">{shortUrl(server.url)}</span>
          <span className="mcps-card__meta label">{meta.join(' · ')}</span>
          <ChevronDown className="mcps-card__chev" size={15} strokeWidth={1.75} aria-hidden />
        </button>
        <Switch checked={server.enabled} onChange={(v) => patchServer(server.id, { enabled: v })} label={t('features.ai.mcp.enable', { name: server.name })} />
      </div>
      {open && (
        <div className="mcps-card__body" id={bodyId}>
          <Connection server={server} others={others} />
          <Token server={server} state={token} />
          <Prompt server={server} hasKey={hasKey} fresh={fresh} blocked={token === 'missing'} />
          <Remove server={server} />
        </div>
      )}
    </li>
  )
}

function Connection({ server, others }: { server: McpServerConfig; others: string[] }) {
  const t = useT()
  const uid = useId()
  const c = useConnection(server, others)
  const { reset } = c
  // saved elsewhere (another tab): show what is stored
  useEffect(() => reset({ name: server.name, url: server.url }), [server.name, server.url]) // eslint-disable-line react-hooks/exhaustive-deps
  const dirty = c.clean.name !== server.name || c.clean.url !== server.url
  return (
    <form
      className="mcps-grid"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        c.tryAll()
        if (!dirty || !c.valid) return
        patchServer(server.id, { name: c.clean.name, url: c.clean.url })
      }}
    >
      <ConnectionFields c={c} ids={{ name: `${uid}-name`, url: `${uid}-url` }} />
      {dirty && (
        <div className="mcps-actions mcps-grid__wide">
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => reset({ name: server.name, url: server.url })}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--sm btn--primary">
            {t('common.save')}
          </button>
        </div>
      )}
    </form>
  )
}

function Token({ server, state }: { server: McpServerConfig; state: 'none' | 'ok' | 'missing' | null }) {
  const t = useT()
  const id = useId()
  const [draft, setDraft] = useState('')
  return (
    <div className="mcps-field mcps-token">
      <label className="mcps-field__label" htmlFor={id}>
        {t('features.ai.mcp.token')}
      </label>
      {state === 'missing' && (
        <p className="mcps-warn" role="note">
          <span className="led mcps-led--warn" aria-hidden /> {t('features.ai.mcp.tokenMissing')}
        </p>
      )}
      <SecretField
        id={id}
        label={t('features.ai.mcp.token')}
        marker={server.token}
        value={draft}
        onChange={setDraft}
        onSubmit={(v) => {
          // a plaintext token: the store seals it and keeps the marker
          patchServer(server.id, { token: v })
          setDraft('')
        }}
        onRemove={() => patchServer(server.id, { token: '' })}
        placeholder={t('features.ai.mcp.tokenOptional')}
        describedBy={`${id}-hint`}
        showLabel={t('features.ai.mcp.tokenShow')}
        hideLabel={t('features.ai.mcp.tokenHide')}
      />
      <div className="mcps-field__hint" id={`${id}-hint`}>
        {t('features.ai.mcp.tokenHint')}
      </div>
    </div>
  )
}

function Prompt({ server, hasKey, fresh, blocked }: { server: McpServerConfig; hasKey: boolean; fresh: boolean; blocked: boolean }) {
  const t = useT()
  const id = useId()
  const [draft, setDraft] = useState(server.prompt)
  const [busy, setBusy] = useState<null | 'test' | 'guide'>(null)
  const [result, setResult] = useState<{ kind: 'ok' | 'warn' | 'err'; text: string } | null>(null)
  const [confirm, setConfirm] = useState(false)
  const ac = useRef<AbortController | null>(null)
  const latest = useRef({ draft, server })
  latest.current = { draft, server }

  useEffect(() => setDraft(server.prompt), [server.prompt])
  // closing the card (or Settings) keeps what was typed, and stops a running check
  useEffect(
    () => () => {
      ac.current?.abort()
      commit(latest.current.server, latest.current.draft)
    },
    [],
  )

  const src = !server.prompt.trim() ? 'empty' : server.promptSource === 'auto' ? 'auto' : 'edited'

  const run = async (mode: 'test' | 'guide') => {
    if (mode === 'guide' && src === 'edited' && !confirm) {
      setConfirm(true)
      return
    }
    setConfirm(false)
    commit(server, draft)
    ac.current?.abort()
    const ctrl = new AbortController()
    ac.current = ctrl
    setBusy(mode)
    setResult(null)
    try {
      const res = await inspectServer(server, mode, ctrl.signal)
      if (ctrl.signal.aborted) return
      const patch: Partial<McpServerConfig> = { tools: res.tools, checkedAt: Date.now() }
      if (mode === 'guide' && res.guide) Object.assign(patch, { prompt: res.guide.slice(0, PROMPT_MAX), promptSource: 'auto' })
      patchServer(server.id, patch)
      if (!res.tools.length) setResult({ kind: 'warn', text: t('features.ai.mcp.noTools') })
      else setResult({ kind: 'ok', text: mode === 'guide' && res.guide ? `${tn(t, 'features.ai.mcp.ok', res.tools.length)} · ${t('features.ai.mcp.generated')}` : tn(t, 'features.ai.mcp.ok', res.tools.length) })
    } catch (e) {
      if (ctrl.signal.aborted) return
      setResult({ kind: 'err', text: e instanceof Error ? e.message : String(e) })
    } finally {
      if (ac.current === ctrl) {
        ac.current = null
        setBusy(null)
      }
    }
  }

  const disabled = !hasKey || blocked || !!busy
  return (
    <div className="mcps-prompt">
      <div className="mcps-prompt__head">
        <label className="mcps-field__label" htmlFor={id}>
          {t('features.ai.mcp.prompt')}
        </label>
        <span className="mcps-tag" data-kind={src}>
          {t(`features.ai.mcp.src.${src}`)}
        </span>
        <span className="mcps-spacer" />
        <button type="button" className="btn btn--sm" disabled={disabled} onClick={() => void run('test')}>
          {busy === 'test' ? t('features.ai.mcp.testing') : t('features.ai.mcp.test')}
        </button>
        <button type="button" className="btn btn--sm btn--ink" disabled={disabled} onClick={() => void run('guide')}>
          {busy === 'guide' ? t('features.ai.mcp.generating') : server.prompt.trim() ? t('features.ai.mcp.regenerate') : t('features.ai.mcp.generate')}
        </button>
      </div>
      {confirm && (
        <div className="mcps-confirm" role="alert">
          <span>{t('features.ai.mcp.replaceConfirm')}</span>
          <span className="mcps-spacer" />
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm(false)}>
            {t('features.ai.mcp.keep')}
          </button>
          <button type="button" className="btn btn--sm btn--ink" onClick={() => void run('guide')}>
            {t('features.ai.mcp.replace')}
          </button>
        </div>
      )}
      <textarea
        id={id}
        className="input mcps-prompt__text"
        rows={6}
        value={draft}
        maxLength={PROMPT_MAX}
        placeholder={t('features.ai.mcp.promptPh')}
        aria-describedby={`${id}-hint`}
        spellCheck={false}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={() => commit(server, draft)}
      />
      <p className="mcps-hint" id={`${id}-hint`}>
        {fresh && src === 'empty' ? t('features.ai.mcp.added') : !hasKey ? t('features.ai.mcp.needsKey') : src === 'empty' ? t('features.ai.mcp.generateHint') : t('features.ai.mcp.promptHint')}
      </p>
      {busy && (
        <p className="mcps-result" data-kind="run" role="status">
          <span className="led led--on mcps-led--live" aria-hidden /> {busy === 'test' ? t('features.ai.mcp.testing') : t('features.ai.mcp.generating')}
        </p>
      )}
      {result && !busy && (
        <p className="mcps-result" data-kind={result.kind} role={result.kind === 'err' ? 'alert' : 'status'}>
          <span className={`led${result.kind === 'ok' ? ' led--ok' : result.kind === 'err' ? ' mcps-led--warn' : ' led--on'}`} aria-hidden /> {result.text}
        </p>
      )}
      {server.tools && server.tools.length > 0 && (
        <div className="mcps-tools">
          <div className="mcps-tools__head">
            <span className="label">
              {t('features.ai.mcp.seen')} · {server.tools.length}
            </span>
            {server.checkedAt && <span className="label mcps-tools__when">{t('features.ai.mcp.checked', { time: format(server.checkedAt, 'yyyy-MM-dd HH:mm') })}</span>}
          </div>
          <ul className="mcps-tools__list">
            {server.tools.map((name) => (
              <li key={name} className="mcps-tool">
                {name}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

/** Store a typed prompt (only when it changed): it is the user's now. */
function commit(server: McpServerConfig, draft: string) {
  const current = readServers().find((s) => s.id === server.id)
  if (!current || draft === current.prompt) return
  patchServer(server.id, { prompt: draft.slice(0, PROMPT_MAX), promptSource: draft.trim() ? 'edited' : undefined })
}

function Remove({ server }: { server: McpServerConfig }) {
  const t = useT()
  const [arm, setArm] = useState(false)
  return (
    <div className="mcps-remove" data-armed={arm || undefined}>
      {arm ? (
        <>
          <span className="mcps-remove__ask">{t('features.ai.mcp.removeConfirm', { name: server.name })}</span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setArm(false)}>
            {t('common.cancel')}
          </button>
          {/* the store removes the server's token from the vault too */}
          <button type="button" className="btn btn--sm btn--danger" onClick={() => writeServers(readServers().filter((s) => s.id !== server.id))}>
            <Trash2 size={13} strokeWidth={1.75} aria-hidden /> {t('common.remove')}
          </button>
        </>
      ) : (
        <button type="button" className="btn btn--sm btn--ghost mcps-remove__btn" onClick={() => setArm(true)}>
          <Trash2 size={13} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.remove')}
        </button>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* The instructions template                                           */
/* ------------------------------------------------------------------ */

function Instructions() {
  const t = useT()
  const id = useId()
  const own = useWorkspace((s) => s.settings.mcpInstructions ?? '')
  // the default follows the UI language (useT re-renders on a switch)
  const def = defaultInstructions()
  const value = own.trim() ? own : def
  const [draft, setDraft] = useState(value)
  useEffect(() => setDraft(value), [value])
  const edited = !!own.trim()
  const set = useWorkspace.getState().updateSettings

  const save = () => {
    const v = draft.trim()
    const next = !v || v === def.trim() ? '' : draft.slice(0, INSTRUCTIONS_MAX)
    if (next !== own) set({ mcpInstructions: next || undefined })
  }

  return (
    <details className="mcps-tpl">
      <summary className="mcps-tpl__head">
        <ChevronRight className="mcps-tpl__chev" size={14} strokeWidth={1.75} aria-hidden />
        <span className="mcps-tpl__title">{t('features.ai.mcp.tpl.title')}</span>
        <span className="mcps-tag" data-kind={edited ? 'edited' : 'auto'}>
          {edited ? t('features.ai.mcp.tpl.edited') : t('features.ai.mcp.tpl.default')}
        </span>
      </summary>
      <div className="mcps-tpl__body">
        <p className="mcps-hint" id={`${id}-hint`}>
          {t('features.ai.mcp.tpl.hint')}
        </p>
        <textarea
          className="input mcps-tpl__text"
          rows={12}
          value={draft}
          maxLength={INSTRUCTIONS_MAX}
          aria-label={t('features.ai.mcp.tpl.label')}
          aria-describedby={`${id}-hint`}
          spellCheck={false}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={save}
        />
        <div className="mcps-actions">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            disabled={!edited && draft === def}
            onClick={() => {
              setDraft(def)
              set({ mcpInstructions: undefined })
            }}
          >
            {t('features.ai.mcp.tpl.reset')}
          </button>
        </div>
      </div>
    </details>
  )
}

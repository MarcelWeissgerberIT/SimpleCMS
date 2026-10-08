/**
 * Settings → Claude AI → "MCP servers": the remote MCP servers One's Claude may use.
 *
 * Adding one takes two fields — the URL and (optionally) a token. The name is derived from the URL,
 * the server is switched on, and a background check tests the connection and writes the usage
 * prompt (checks.ts); the row's LED shows how that went. Everything else (name, codeword, scope,
 * token, usage prompt, regenerate, remove) sits behind the row's collapsed "Details"; a codeword
 * also shows in the row ("kb:"). Everything here is this device's setting; tokens live in the vault
 * (store/secrets.ts).
 */
import { useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react'
import { format } from 'date-fns'
import { ChevronDown, ChevronRight, Copy, ExternalLink, Info, KeyRound, LogIn, LogOut, Plus, Trash2 } from 'lucide-react'
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
  deriveName,
  nameProblem,
  patchServer,
  readServers,
  slugName,
  tokenState,
  urlProblem,
  writeServers,
} from './config'
import { cancelCheck, checkServer, useMcpChecks, type CheckMode } from './checks'
import { codewordProblem, normalizeCodeword, suggestCodeword } from './codeword'
import { linkBaseOf } from '../../../lib/foreignLinks'
import { cancelSignIn, offersCode, signIn, signInWithCode, signOut, signedIn, useMcpSignIn, type SignInState } from './oauth'
import { HelpLink } from '../../../help'
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
  /** the add form is open */
  const [adding, setAdding] = useState(false)
  /** the server whose details are open */
  const [open, setOpen] = useState<string | null>(null)
  const headId = useId()

  // a key arrived (or Settings opened with one): servers that were never checked get their check now
  useEffect(() => {
    if (!hasKey) return
    for (const s of readServers()) if (s.enabled && !s.checkedAt && !s.checkError && !useMcpChecks.getState().running[s.id]) void checkServer(s.id, s.prompt.trim() ? 'test' : 'guide')
  }, [hasKey])

  return (
    <section className="mcps" aria-labelledby={headId} data-testid="mcp-servers">
      <header className="mcps__head">
        <div className="mcps__heading">
          <span className="label mcps__code">§ MCP — {t('features.ai.mcp.code')}</span>
          <h4 className="mcps__title" id={headId}>
            {t('features.ai.mcp.title')}
            <HelpLink id="mcp-servers" />
          </h4>
        </div>
        <span className="label mcps__count">{t('features.ai.mcp.count', { count: servers.length, max: MAX_SERVERS })}</span>
        <button type="button" className="btn btn--sm" onClick={() => setAdding(true)} disabled={adding || servers.length >= MAX_SERVERS}>
          <Plus size={13} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.add')}
        </button>
      </header>
      <p className="mcps__lead">{t('features.ai.mcp.lead')}</p>
      {servers.length > 0 && (
        <ul className="mcps__list">
          {servers.map((s) => (
            <ServerRow
              key={s.id}
              server={s}
              others={servers.filter((x) => x.id !== s.id).map((x) => x.name)}
              words={servers.flatMap((x) => (x.id !== s.id && x.codeword ? [x.codeword] : []))}
              open={open === s.id}
              onOpen={(v) => setOpen(v ? s.id : null)}
              hasKey={hasKey}
            />
          ))}
        </ul>
      )}
      {adding ? <NewServer onDone={() => setAdding(false)} /> : servers.length === 0 && <p className="mcps__empty">{t('features.ai.mcp.empty')}</p>}
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

function Field({ id, label, hint, error, wide, children }: { id: string; label: string; hint: ReactNode; error?: string; wide?: boolean; children: ReactNode }) {
  return (
    <div className={wide ? 'mcps-field mcps-grid__wide' : 'mcps-field'} data-error={error ? '' : undefined}>
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

function UrlInput({ id, value, error, onChange, onBlur, autoFocus }: { id: string; value: string; error: string; onChange: (v: string) => void; onBlur: () => void; autoFocus?: boolean }) {
  return (
    <input
      id={id}
      className="input mcps-input--mono"
      type="url"
      inputMode="url"
      value={value}
      placeholder="https://mcp.example.com/mcp"
      autoComplete="off"
      spellCheck={false}
      autoFocus={autoFocus}
      aria-invalid={error ? true : undefined}
      aria-describedby={`${id}-hint`}
      onChange={(e) => onChange(e.target.value)}
      onBlur={onBlur}
    />
  )
}

/* ------------------------------------------------------------------ */
/* Add: URL + token, nothing else                                      */
/* ------------------------------------------------------------------ */

function NewServer({ onDone }: { onDone: () => void }) {
  const t = useT()
  const uid = useId()
  const [url, setUrl] = useState('')
  const [token, setToken] = useState('')
  const [touched, setTouched] = useState(false)
  const [tried, setTried] = useState(false)
  const problem = urlProblem(url)
  const error = problem && (tried || (touched && problem !== 'empty')) ? t(`features.ai.mcp.err.url.${problem}`) : ''

  const submit = (e: React.FormEvent) => {
    e.preventDefault()
    setTried(true)
    if (problem) return
    const list = readServers()
    const id = newId()
    const clean = url.trim()
    // the store seals a plaintext token and keeps its marker (store/secrets.ts)
    writeServers([...list, { id, name: deriveName(clean, list.map((s) => s.name)), url: clean, token: token.trim(), enabled: true, prompt: '' }])
    setToken('')
    onDone()
    // test + usage prompt, in the background
    void checkServer(id, 'guide')
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
          onDone()
        }
      }}
    >
      <div className="mcps-card__body">
        <Field id={`${uid}-url`} label={t('features.ai.mcp.url')} hint={t('features.ai.mcp.urlHint')} error={error}>
          <UrlInput id={`${uid}-url`} value={url} error={error} onChange={setUrl} onBlur={() => setTouched(true)} autoFocus />
        </Field>
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
        <div className="mcps-actions">
          <span className="mcps-actions__note">{t('features.ai.mcp.addNote')}</span>
          <button type="button" className="btn btn--sm btn--ghost" onClick={onDone}>
            {t('common.cancel')}
          </button>
          <button type="submit" className="btn btn--sm btn--primary">
            {t('common.save')}
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

type RowState = 'off' | 'missing' | 'checking' | 'error' | 'ok' | 'unchecked'

function ServerRow({ server, others, words, open, onOpen, hasKey }: { server: McpServerConfig; others: string[]; words: string[]; open: boolean; onOpen: (v: boolean) => void; hasKey: boolean }) {
  const t = useT()
  const token = useTokenState(server)
  const running = useMcpChecks((s) => s.running[server.id])
  const bodyId = useId()
  const state: RowState = running ? 'checking' : !server.enabled ? 'off' : token === 'missing' ? 'missing' : server.checkError ? 'error' : server.checkedAt ? 'ok' : 'unchecked'
  const meta = [t(`features.ai.mcp.status.${state}`)]
  if (signedIn(server)) meta.push(t('features.ai.mcp.oauth.signedInShort'))
  if (server.tools && (state === 'ok' || state === 'off')) meta.push(tn(t, 'features.ai.mcp.meta.tools', server.tools.length))
  if (server.scope === 'all') meta.push(t('features.ai.mcp.scope.allShort'))
  const reason =
    state === 'error'
      ? server.checkError
      : state === 'missing'
        ? t('features.ai.mcp.tokenMissingShort')
        : state === 'unchecked' && !hasKey
          ? t('features.ai.mcp.needsKey')
          : state === 'ok' && server.tools?.length === 0
            ? t('features.ai.mcp.noTools')
            : ''
  const led = state === 'ok' ? 'led led--ok' : state === 'checking' ? 'led led--on mcps-led--live' : state === 'error' || state === 'missing' ? 'led mcps-led--warn' : 'led'
  // the server turned the request down (401 / 403): a sign-in instead of a token, right under the address
  const wantsSignIn = server.enabled && !!server.checkAuth && state === 'error'
  return (
    <li className="mcps-card" data-state={state} data-open={open || undefined} data-server={server.name}>
      <div className="mcps-card__head">
        <span className={led} aria-hidden />
        <button type="button" className="mcps-card__toggle" aria-expanded={open} aria-controls={open ? bodyId : undefined} onClick={() => onOpen(!open)}>
          <span className="mcps-card__name">
            {server.name.toUpperCase()}
            {server.codeword && (
              <span className="mcps-card__cw" title={t('features.ai.mcp.cw.cardLabel', { cw: `${server.codeword}:` })} data-testid="mcp-card-codeword">
                {server.codeword}:
              </span>
            )}
          </span>
          <span className="mcps-card__url">{shortUrl(server.url)}</span>
          <span className="mcps-card__meta label" data-testid="mcp-status">
            {meta.join(' · ')}
          </span>
          <span className="mcps-card__more label">
            <span className="mcps-card__more-text">{t('features.ai.mcp.detailsToggle')}</span>
            <ChevronDown className="mcps-card__chev" size={14} strokeWidth={1.75} aria-hidden />
          </span>
        </button>
        <Switch seed={server.id} checked={server.enabled} onChange={(v) => patchServer(server.id, { enabled: v })} label={t('features.ai.mcp.enable', { name: server.name })} />
      </div>
      {reason && (
        <p className="mcps-card__reason" data-kind={state} role={state === 'error' ? 'alert' : undefined}>
          {reason}
        </p>
      )}
      {wantsSignIn && <SignInKey server={server} />}
      {open && (
        <div className="mcps-card__body" id={bodyId}>
          <Connection server={server} others={others} words={words} />
          <Scope server={server} />
          <OAuthSignIn server={server} codeAbove={wantsSignIn} />
          <Token server={server} state={token} />
          <Prompt server={server} hasKey={hasKey} blocked={token === 'missing'} running={running} />
          <Remove server={server} />
        </div>
      )}
    </li>
  )
}

/** Name + URL (a changed URL is tested again) + codeword. `words`: the other servers' codewords. */
function Connection({ server, others, words }: { server: McpServerConfig; others: string[]; words: string[] }) {
  const t = useT()
  const uid = useId()
  const [name, setName] = useState(server.name)
  const [url, setUrl] = useState(server.url)
  const [codeword, setCodeword] = useState(server.codeword ?? '')
  const [linkBase, setLinkBase] = useState(server.linkBase ?? '')
  const [touched, setTouched] = useState(false)
  // saved elsewhere (another tab): show what is stored
  useEffect(() => {
    setName(server.name)
    setUrl(server.url)
    setCodeword(server.codeword ?? '')
    setLinkBase(server.linkBase ?? '')
  }, [server.name, server.url, server.codeword, server.linkBase])
  const cleanName = name.replace(/[-_]+$/, '')
  const nameErr = nameProblem(cleanName, others)
  const urlErr = urlProblem(url)
  const cw = normalizeCodeword(codeword)
  const cwErr = codewordProblem(cw, words)
  const base = linkBase.trim() ? linkBaseOf(linkBase) : ''
  const baseErr = base === null
  const dirty = cleanName !== server.name || url.trim() !== server.url || cw !== (server.codeword ?? '') || (base ?? linkBase.trim()) !== (server.linkBase ?? '')
  const nameError = nameErr && (touched || nameErr !== 'empty') ? t(`features.ai.mcp.err.name.${nameErr}`) : ''
  const urlError = urlErr && (touched || urlErr !== 'empty') ? t(`features.ai.mcp.err.url.${urlErr}`) : ''
  const cwError = cwErr ? t(`features.ai.mcp.cw.err.${cwErr}`) : ''
  return (
    <form
      className="mcps-grid"
      noValidate
      onSubmit={(e) => {
        e.preventDefault()
        setTouched(true)
        if (!dirty || nameErr || urlErr || cwErr || baseErr) return
        const moved = url.trim() !== server.url
        patchServer(server.id, { name: cleanName, url: url.trim(), codeword: cw || undefined, linkBase: base || undefined, ...(moved ? { checkedAt: undefined, checkError: undefined, tools: undefined } : {}) })
        if (moved) void checkServer(server.id, server.prompt.trim() ? 'test' : 'guide')
      }}
    >
      <Field id={`${uid}-name`} label={t('features.ai.mcp.name')} hint={t('features.ai.mcp.nameHint')} error={nameError}>
        <input
          id={`${uid}-name`}
          className="input mcps-input--mono"
          value={name}
          maxLength={NAME_MAX}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={nameError ? true : undefined}
          aria-describedby={`${uid}-name-hint`}
          onChange={(e) => setName(slugName(e.target.value))}
        />
      </Field>
      <Field id={`${uid}-url`} label={t('features.ai.mcp.url')} hint={t('features.ai.mcp.urlHint')} error={urlError}>
        <UrlInput id={`${uid}-url`} value={url} error={urlError} onChange={setUrl} onBlur={() => setTouched(true)} />
      </Field>
      <Codeword server={server} value={codeword} onChange={setCodeword} error={cwError} suggestion={suggestCodeword(nameErr ? server.name : cleanName, words)} />
      <Field id={`${uid}-link`} label={t('features.ai.mcp.linkBase')} hint={t('features.ai.mcp.linkBaseHint')} error={baseErr ? t('features.ai.mcp.err.linkBase') : ''} wide>
        <input
          id={`${uid}-link`}
          className="input mcps-input--mono"
          type="url"
          inputMode="url"
          value={linkBase}
          placeholder={(() => {
            try {
              return new URL(url).origin
            } catch {
              return 'https://'
            }
          })()}
          autoComplete="off"
          spellCheck={false}
          aria-invalid={baseErr ? true : undefined}
          aria-describedby={`${uid}-link-hint`}
          data-testid="mcp-link-base"
          onChange={(e) => setLinkBase(e.target.value)}
        />
      </Field>
      {dirty && (
        <div className="mcps-actions mcps-grid__wide">
          <button
            type="button"
            className="btn btn--sm btn--ghost"
            onClick={() => {
              setName(server.name)
              setUrl(server.url)
              setCodeword(server.codeword ?? '')
              setLinkBase(server.linkBase ?? '')
              setTouched(false)
            }}
          >
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

/**
 * The codeword ("kb" → a request starting with "kb:" goes to this server first). Empty: the server's
 * name is suggested as placeholder — saved only when typed (Save) or taken with "Use kb:".
 */
function Codeword({ server, value, onChange, error, suggestion }: { server: McpServerConfig; value: string; onChange: (v: string) => void; error: string; suggestion: string }) {
  const t = useT()
  const id = `${useId()}-cw`
  const cw = normalizeCodeword(value)
  // the codeword in the hint is set in mono, as it is typed
  const [before, after] = t('features.ai.mcp.cw.hint', { cw: '\u0000' }).split('\u0000')
  const hint =
    cw && !error ? (
      <>
        {before}
        <code className="mcps-cw__code">{cw}:</code>
        {after}
      </>
    ) : (
      t('features.ai.mcp.cw.hintEmpty')
    )
  return (
    <Field id={id} label={t('features.ai.mcp.cw.label')} hint={hint} error={error} wide>
      <div className="mcps-cw">
        <input
          id={id}
          className="input mcps-input--mono mcps-cw__input"
          value={value}
          placeholder={suggestion}
          autoComplete="off"
          autoCapitalize="off"
          spellCheck={false}
          aria-invalid={error ? true : undefined}
          aria-describedby={`${id}-hint`}
          // lower case; the colon is part of the field (typed "kb:" stays "kb")
          onChange={(e) => onChange(e.target.value.toLowerCase().replace(/:+$/, ''))}
        />
        <span className="mcps-cw__colon" aria-hidden>
          :
        </span>
        {!value && suggestion && (
          <button
            type="button"
            className="btn btn--sm btn--ghost mcps-cw__use"
            onClick={() => {
              onChange(suggestion)
              patchServer(server.id, { codeword: suggestion })
            }}
          >
            {t('features.ai.mcp.cw.use', { cw: `${suggestion}:` })}
          </button>
        )}
      </div>
    </Field>
  )
}

/** Which requests use the server. */
function Scope({ server }: { server: McpServerConfig }) {
  const t = useT()
  const id = useId()
  const value = server.scope === 'all' ? 'all' : 'free'
  return (
    <div className="mcps-field">
      <div className="mcps-field__label" id={`${id}-label`}>
        {t('features.ai.mcp.scope.label')}
      </div>
      <div className="mcps-scope" role="radiogroup" aria-labelledby={`${id}-label`} aria-describedby={`${id}-hint`}>
        {(['free', 'all'] as const).map((v) => (
          <button key={v} type="button" role="radio" aria-checked={value === v} className="mcps-scope__opt" onClick={() => patchServer(server.id, { scope: v === 'all' ? 'all' : undefined })}>
            <span className="mcps-scope__dot" aria-hidden />
            <span>{t(`features.ai.mcp.scope.${v}`)}</span>
          </button>
        ))}
      </div>
      <div className="mcps-field__hint" id={`${id}-hint`}>
        {t('features.ai.mcp.scope.hint')}
      </div>
    </div>
  )
}

/** "Sign in" under a server that wants one (it answered 401): starts the sign-in, says how it went. */
function SignInKey({ server }: { server: McpServerConfig }) {
  const t = useT()
  const st = useMcpSignIn((s) => s.byServer[server.id])
  return (
    <div className="mcps-signin" data-testid="mcp-signin-row">
      <span className="mcps-signin__text">{t('features.ai.mcp.oauth.wants')}</span>
      <SignInKeys server={server} st={st} testId="mcp-signin" />
      {st?.phase === 'code' && <DeviceCode server={server} st={st} />}
      {st?.phase === 'error' && st.issue && (
        <p className="mcps-signin__err" role="alert">
          {t(`features.ai.mcp.oauth.err.${st.issue}`, { detail: st.detail ?? '' })}
        </p>
      )}
    </div>
  )
}

/**
 * Sign in · while the window is open: Cancel and "Use a code instead" · once the server's sign-in is known to
 * offer a code: "Sign in with a code" (the device flow, for when the way back to this page can't work).
 */
function SignInKeys({ server, st, testId, describedBy }: { server: McpServerConfig; st: SignInState | undefined; testId: string; describedBy?: string }) {
  const t = useT()
  const phase = st?.phase
  const busy = phase === 'working' || phase === 'waiting' || phase === 'code'
  const code = offersCode(server)
  const label = phase === 'waiting' ? t('features.ai.mcp.oauth.waiting') : phase === 'code' ? t('features.ai.mcp.oauth.code.waiting') : busy ? t('features.ai.mcp.oauth.busy') : signedIn(server) ? t('features.ai.mcp.oauth.again') : t('features.ai.mcp.oauth.signIn')
  return (
    <>
      <button type="button" className="btn btn--sm btn--ink" disabled={busy} onClick={() => void signIn(server.id).catch(() => {})} aria-describedby={describedBy} data-testid={testId}>
        <LogIn size={13} strokeWidth={1.75} aria-hidden /> {label}
      </button>
      {phase === 'waiting' && (
        <>
          {code && (
            <button type="button" className="btn btn--sm" onClick={() => void signInWithCode(server.id).catch(() => {})} data-testid="mcp-use-code">
              <KeyRound size={13} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.oauth.useCode')}
            </button>
          )}
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => cancelSignIn(server.id)}>
            {t('common.cancel')}
          </button>
        </>
      )}
      {code && !busy && (
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => void signInWithCode(server.id).catch(() => {})} data-testid="mcp-signin-code">
          <KeyRound size={13} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.oauth.withCode')}
        </button>
      )}
    </>
  )
}

/** A sign-in with a code (device flow): the code to enter on the server's page while One waits for it. */
function DeviceCode({ server, st }: { server: McpServerConfig; st: SignInState }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(st.userCode ?? '')
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* no clipboard here: the code is on screen */
    }
  }
  return (
    <div className="mcps-code" role="group" aria-label={t('features.ai.mcp.oauth.code.label')} data-testid="mcp-device-code">
      <span className="label mcps-code__label">
        <span className="led led--on" aria-hidden /> {t('features.ai.mcp.oauth.code.label')}
      </span>
      <output className="mcps-code__value" data-testid="mcp-user-code">
        {st.userCode}
      </output>
      <p className="mcps-code__text">{t('features.ai.mcp.oauth.code.text', { host: hostOf(st.verifyUrl ?? '') })}</p>
      <div className="mcps-code__keys">
        <a className="btn btn--sm btn--ink" href={st.verifyComplete ?? st.verifyUrl} target="_blank" rel="noopener noreferrer" data-testid="mcp-code-open">
          <ExternalLink size={13} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.oauth.code.open')}
        </a>
        <button type="button" className="btn btn--sm" onClick={() => void copy()}>
          <Copy size={13} strokeWidth={1.75} aria-hidden /> {copied ? t('features.ai.mcp.oauth.code.copied') : t('features.ai.mcp.oauth.code.copy')}
        </button>
        <button type="button" className="btn btn--sm btn--ghost" onClick={() => cancelSignIn(server.id)} data-testid="mcp-code-cancel">
          {t('common.cancel')}
        </button>
        {st.expiresAt && <span className="label mcps-code__until">{t('features.ai.mcp.oauth.code.until', { time: format(st.expiresAt, 'HH:mm') })}</span>}
      </div>
    </div>
  )
}

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/** Sign in with OAuth (the server's own sign-in page) instead of pasting a token — or the state of a sign-in and Sign out. */
function OAuthSignIn({ server, codeAbove }: { server: McpServerConfig; codeAbove: boolean }) {
  const t = useT()
  const id = useId()
  const st = useMcpSignIn((s) => s.byServer[server.id])
  const on = signedIn(server)
  const o = server.oauth
  return (
    <div className="mcps-field mcps-oauth" role="group" aria-labelledby={`${id}-label`} data-testid="mcp-oauth" data-signed-in={on || undefined}>
      <div className="mcps-field__label" id={`${id}-label`}>
        {t('features.ai.mcp.oauth.label')}
      </div>
      {on && o ? (
        <div className="mcps-oauth__row">
          <span className="led led--ok" aria-hidden />
          <span className="mcps-oauth__state" data-testid="mcp-oauth-state">
            {t('features.ai.mcp.oauth.signedIn', { host: hostOf(o.issuer) })}
          </span>
          {o.expiresAt && <span className="label mcps-oauth__when">{t(o.refresh ? 'features.ai.mcp.oauth.renews' : 'features.ai.mcp.oauth.expires', { time: format(o.expiresAt, 'yyyy-MM-dd HH:mm') })}</span>}
          <span className="mcps-spacer" />
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => signOut(server.id)} data-testid="mcp-signout">
            <LogOut size={13} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.oauth.signOut')}
          </button>
        </div>
      ) : (
        <div className="mcps-oauth__row">
          <SignInKeys server={server} st={st} testId="mcp-oauth-signin" describedBy={`${id}-hint`} />
        </div>
      )}
      {st?.phase === 'code' && !codeAbove && <DeviceCode server={server} st={st} />}
      {st?.phase === 'error' && st.issue && (
        <p className="mcps-warn" role="alert" data-testid="mcp-oauth-error">
          <span className="led mcps-led--warn" aria-hidden /> {t(`features.ai.mcp.oauth.err.${st.issue}`, { detail: st.detail ?? '' })}
        </p>
      )}
      <div className="mcps-field__hint" id={`${id}-hint`}>
        {t('features.ai.mcp.oauth.hint')}
      </div>
    </div>
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
          // a plaintext token: the store seals it and keeps the marker; then it is tested
          patchServer(server.id, { token: v, checkError: undefined })
          setDraft('')
          void checkServer(server.id, server.prompt.trim() ? 'test' : 'guide')
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

function Prompt({ server, hasKey, blocked, running }: { server: McpServerConfig; hasKey: boolean; blocked: boolean; running: CheckMode | undefined }) {
  const t = useT()
  const id = useId()
  const [draft, setDraft] = useState(server.prompt)
  const [confirm, setConfirm] = useState(false)
  const latest = useRef({ draft, server })
  latest.current = { draft, server }

  useEffect(() => setDraft(server.prompt), [server.prompt])
  // closing the details (or Settings) keeps what was typed
  useEffect(() => () => commit(latest.current.server, latest.current.draft), [])

  const src = !server.prompt.trim() ? 'empty' : server.promptSource === 'auto' ? 'auto' : 'edited'
  const run = (mode: CheckMode) => {
    if (mode === 'guide' && src === 'edited' && !confirm) {
      setConfirm(true)
      return
    }
    setConfirm(false)
    commit(server, draft)
    void checkServer(server.id, mode, { replaceEdited: mode === 'guide' })
  }

  const disabled = !hasKey || blocked || !!running
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
        <button type="button" className="btn btn--sm" disabled={disabled} onClick={() => run('test')}>
          {running === 'test' ? t('features.ai.mcp.testing') : t('features.ai.mcp.test')}
        </button>
        <button type="button" className="btn btn--sm btn--ink" disabled={disabled} onClick={() => run('guide')}>
          {running === 'guide' ? t('features.ai.mcp.generating') : server.prompt.trim() ? t('features.ai.mcp.regenerate') : t('features.ai.mcp.generate')}
        </button>
      </div>
      {confirm && (
        <div className="mcps-confirm" role="alert">
          <span>{t('features.ai.mcp.replaceConfirm')}</span>
          <span className="mcps-spacer" />
          <button type="button" className="btn btn--sm btn--ghost" onClick={() => setConfirm(false)}>
            {t('features.ai.mcp.keep')}
          </button>
          <button type="button" className="btn btn--sm btn--ink" onClick={() => run('guide')}>
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
        {!hasKey ? t('features.ai.mcp.needsKey') : t('features.ai.mcp.promptHint')}
      </p>
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
          <button
            type="button"
            className="btn btn--sm btn--danger"
            onClick={() => {
              cancelCheck(server.id)
              // the store removes the server's token from the vault too
              writeServers(readServers().filter((s) => s.id !== server.id))
            }}
          >
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

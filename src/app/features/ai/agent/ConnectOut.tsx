/**
 * AI terminal — what /connect shows: the servers and how they stand (/connect alone), a server being connected (its
 * sign-in live: the window, a code to enter, the connection test), and the "Sign in to <server>" key under a task a
 * server's rejected token stopped or left out. Every key is a real button; the sign-in window opens from its click.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Copy, ExternalLink, KeyRound, LogIn, RotateCw, Settings2 } from 'lucide-react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import { HelpLink } from '../../../help'
import { needsSignIn, readServers, refusedHere } from '../mcp-servers/config'
import { cancelSignIn, offersCode, signInWithCode, signedIn, useMcpSignIn } from '../mcp-servers/oauth'
import { useMcpChecks } from '../mcp-servers/checks'
import { connectCommand, signInFromTerminal } from './connect'
import { currentEpoch, rerunAfterSignIn, rerunnable } from './session'
import { useAgent, type EchoEntry } from './state'
import type { AgentTurn } from './types'

const openSettings = () => useUI.getState().openModal({ type: 'settings', tab: 'ai' })

/** The servers as they are now (the stored list changes identity only when the settings change). */
function useServers() {
  const raw = useWorkspace((s) => s.settings.mcpServers)
  return useMemo(() => readServers({ mcpServers: raw }), [raw])
}

/** issues a new sign-in cannot fix: a token is the way */
const TOKEN_ISSUES = new Set(['none', 'pkce', 'register', 'cors', 'nocode', 'metadata'])

/** One /connect line: the server, then its sign-in or test as it goes. */
export function ConnectLine({ entry }: { entry: EchoEntry }) {
  const t = useT()
  const c = entry.data?.connect
  const live = useMcpSignIn((s) => (c ? s.byServer[c.serverId] : undefined))
  const servers = useServers()
  const server = c ? servers.find((x) => x.id === c.serverId) : undefined
  const pinned = useAgent((s) => s.mcp)
  // re-render when the task list changes (the rerun key belongs to the last task only)
  useAgent((s) => s.turns.length + (s.status === 'running' ? 0.5 : 0))
  if (!c) return null
  const phase = c.phase === 'working' && (live?.phase === 'waiting' || live?.phase === 'code') ? live.phase : c.phase
  const led = phase === 'ok' ? 'led led--ok' : phase === 'failed' ? 'led ai-led--err' : 'led led--on ai-led--live'
  const reason = c.issue === 'check' ? (c.detail ?? '') : c.issue === 'gone' || c.issue === 'noAnswer' ? t(`features.agent.connect.${c.issue}`) : c.issue ? t(`features.ai.mcp.oauth.err.${c.issue}`, { detail: c.detail ?? '' }) : ''
  const tokenWay = !!c.issue && TOKEN_ISSUES.has(c.issue)
  const again = phase === 'failed' && c.issue !== 'gone' && (c.issue === 'check' ? !!c.auth : !tokenWay)
  return (
    <div className="term-connect" data-testid="term-connect" data-phase={phase} data-server={c.name}>
      <p className="term-connect__line">
        <span className={led} aria-hidden />
        <strong className="term-connect__name">{c.name.toUpperCase()}</strong>
        <span className="term-connect__host">· {c.host}</span>
        {c.added && <span className="term-connect__note">{t('features.agent.connect.added', { name: c.name })}</span>}
        {c.switchedOn && <span className="term-connect__note">{t('features.agent.connect.switchedOn')}</span>}
      </p>
      {phase === 'working' && (
        <p className="term-connect__text" role="status">
          {t('features.ai.mcp.oauth.busy')} {c.how === 'signin' && t('features.agent.connect.window')}
        </p>
      )}
      {phase === 'waiting' && (
        <>
          <p className="term-connect__text" role="status">
            {t('features.ai.mcp.oauth.waiting')}
          </p>
          <div className="term-keys">
            {server && offersCode(server) && (
              <button type="button" className="btn btn--sm" onClick={() => void signInWithCode(c.serverId).catch(() => {})} data-testid="term-connect-usecode">
                <KeyRound size={12} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.oauth.useCode')}
              </button>
            )}
            <button type="button" className="btn btn--ghost btn--sm" onClick={() => cancelSignIn(c.serverId)}>
              {t('common.cancel')}
            </button>
          </div>
        </>
      )}
      {phase === 'code' && live && <CodeBox serverId={c.serverId} userCode={live.userCode ?? ''} verifyUrl={live.verifyComplete ?? live.verifyUrl ?? ''} host={hostOf(live.verifyUrl ?? '')} expiresAt={live.expiresAt} />}
      {phase === 'testing' && (
        <p className="term-connect__text" role="status">
          {t('features.agent.connect.testing')}
        </p>
      )}
      {phase === 'ok' && (
        <>
          <p className="term-connect__text term-connect__text--ok" role="status">
            {c.untested ? t('features.agent.connect.untested') : t(`features.agent.connect.ok.${c.tools === 1 ? 'one' : 'other'}`, { count: c.tools ?? 0 })}
          </p>
          {c.open && <p className="term-connect__text">{t('features.agent.connect.open')}</p>}
          {pinned && !pinned.names.includes(c.name) && <p className="term-connect__text">{t('features.agent.connect.newConversation', { name: c.name })}</p>}
          {c.retry && !c.retried && rerunnable(c) && (
            <div className="term-keys">
              <button type="button" className="btn btn--sm term-keys__go" onClick={() => rerunAfterSignIn(entry.id)} data-testid="term-connect-rerun">
                <RotateCw size={12} strokeWidth={1.75} aria-hidden /> {t('features.agent.connect.retry')}
              </button>
              <span className="term-keys__hint">{t('features.agent.connect.retryHint')}</span>
            </div>
          )}
          {c.retried && <p className="term-connect__text">{t('features.agent.connect.retried')}</p>}
        </>
      )}
      {phase === 'failed' && (
        <>
          <p className="term-connect__text term-connect__text--err" role="alert">
            {t('features.agent.connect.failed', { reason })}
          </p>
          <div className="term-keys">
            {again && (
              <button type="button" className="btn btn--sm term-keys__go" onClick={() => signInFromTerminal(c.name, c.retry && !c.retried ? { retry: c.retry } : {})} data-testid="term-connect-again">
                <LogIn size={12} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.oauth.again')}
              </button>
            )}
            <button type="button" className="btn btn--sm" onClick={openSettings} data-testid="term-connect-settings">
              {tokenWay ? <KeyRound size={12} strokeWidth={1.75} aria-hidden /> : <Settings2 size={12} strokeWidth={1.75} aria-hidden />} {tokenWay ? t('features.agent.connect.useToken') : t('features.ai.mcp.openSettings')}
            </button>
            {(c.issue === 'none' || c.issue === 'check') && <HelpLink id="mcp-token-rejected" />}
          </div>
        </>
      )}
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

/** A sign-in with a code (device flow): the code, where to enter it, Copy, Cancel. */
function CodeBox({ serverId, userCode, verifyUrl, host, expiresAt }: { serverId: string; userCode: string; verifyUrl: string; host: string; expiresAt?: number }) {
  const t = useT()
  const [copied, setCopied] = useState(false)
  const timer = useRef(0)
  useEffect(() => () => window.clearTimeout(timer.current), [])
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(userCode)
      setCopied(true)
      window.clearTimeout(timer.current)
      timer.current = window.setTimeout(() => setCopied(false), 1600)
    } catch {
      /* no clipboard: the code is on screen */
    }
  }
  return (
    <div className="term-connect__codebox" role="group" aria-label={t('features.ai.mcp.oauth.code.label')}>
      <output className="term-connect__code" data-testid="term-connect-code">
        {userCode}
      </output>
      <p className="term-connect__text">{t('features.ai.mcp.oauth.code.text', { host })}</p>
      <div className="term-keys">
        <a className="btn btn--sm term-keys__go" href={verifyUrl} target="_blank" rel="noopener noreferrer" data-testid="term-connect-open">
          <ExternalLink size={12} strokeWidth={1.75} aria-hidden /> {t('features.ai.mcp.oauth.code.open')}
        </a>
        <button type="button" className="btn btn--sm" onClick={() => void copy()}>
          <Copy size={12} strokeWidth={1.75} aria-hidden /> {copied ? t('features.ai.mcp.oauth.code.copied') : t('features.ai.mcp.oauth.code.copy')}
        </button>
        <button type="button" className="btn btn--ghost btn--sm" onClick={() => cancelSignIn(serverId)}>
          {t('common.cancel')}
        </button>
        {expiresAt && <span className="term-keys__hint">{t('features.ai.mcp.oauth.code.until', { time: format(expiresAt, 'HH:mm') })}</span>}
      </div>
    </div>
  )
}

/** /connect alone: every server, how it stands, a key to sign in or test it. */
export function ServersOut() {
  const t = useT()
  const servers = useServers()
  const running = useMcpChecks((s) => s.running)
  const signing = useMcpSignIn((s) => s.byServer)
  if (!servers.length) return <p>{t('features.agent.connect.none')}</p>
  return (
    <>
      <ul className="term-servers" data-testid="term-servers">
        {servers.map((s) => {
          const busy = !!running[s.id] || ['working', 'waiting', 'code'].includes(signing[s.id]?.phase ?? '')
          const state = !s.enabled ? 'off' : busy ? 'checking' : needsSignIn(s) ? 'signIn' : s.checkError ? 'error' : signedIn(s) ? 'signedIn' : s.token ? 'token' : 'open'
          const led = state === 'off' ? 'led' : state === 'checking' ? 'led led--on ai-led--live' : state === 'signIn' || state === 'error' || refusedHere(s) ? 'led ai-led--err' : 'led led--ok'
          const signInKey = needsSignIn(s) || !!s.oauth
          return (
            <li key={s.id} className="term-server" data-server={s.name} data-state={state}>
              <span className={led} aria-hidden />
              <span className="term-server__name">
                <strong>{s.name.toUpperCase()}</strong>
                {s.codeword && <span className="term-server__cw">{s.codeword}:</span>}
                <span className="term-server__host">{hostOf(s.url)}</span>
              </span>
              <span className="term-server__state">{t(`features.agent.connect.state.${state}`)}</span>
              <span className="term-server__tools">{s.tools ? t(`features.agent.connect.tools.${s.tools.length === 1 ? 'one' : 'other'}`, { count: s.tools.length }) : ''}</span>
              <button type="button" className="btn btn--sm" disabled={busy} onClick={() => connectCommand(`/connect ${s.name}`, s.name)} aria-label={`${signInKey ? t('features.ai.mcp.oauth.signIn') : t('features.agent.connect.test')} ${s.name}`}>
                {signInKey ? <LogIn size={12} strokeWidth={1.75} aria-hidden /> : <RotateCw size={12} strokeWidth={1.75} aria-hidden />} {signInKey ? t('features.ai.mcp.oauth.signIn') : t('features.agent.connect.test')}
              </button>
            </li>
          )
        })}
      </ul>
      <p className="term-echo__note">{t('features.agent.connect.listHint')}</p>
    </>
  )
}

/** "Sign in to <server>": the key under a task (the window opens from its click); `retry`: the task runs again once connected. */
export function SignInKey({ server, retry }: { server: string; retry?: { epoch: number; n: number } }) {
  const t = useT()
  return (
    <button type="button" className="btn btn--sm term-keys__go" onClick={() => signInFromTerminal(server, retry ? { retry } : {})} data-testid="term-signin">
      <LogIn size={12} strokeWidth={1.75} aria-hidden /> {t('features.agent.signIn.key', { server })}
    </button>
  )
}

/** The retry a "Sign in" key under task `n` carries. */
export const retryOf = (n: number) => ({ epoch: currentEpoch(), n })

/** Under a finished last task that left servers out (they rejected their token here): sign in to them. */
export function SignInOffer({ turn }: { turn: AgentTurn }) {
  const t = useT()
  const known = useServers().map((x) => x.name)
  const names = (turn.signIn ?? []).filter((n) => known.includes(n))
  if (!names.length) return null
  return (
    <div className="term-signin" role="status" data-testid="term-signin-offer">
      {names.map((name) => (
        <div key={name} className="term-keys">
          <span className="term-keys__hint">{t('features.agent.signIn.offer', { server: name })}</span>
          <SignInKey server={name} />
        </div>
      ))}
    </div>
  )
}

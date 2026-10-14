/**
 * The sign-in keys of an MCP server (OAuth, features/ai/mcp-servers/oauth.ts) — Settings › AI › MCP servers and MCP ·
 * Connections (#/mcp) both show them, so a sign-in started on either place shows its device code right there.
 */
import { useEffect, useRef, useState } from 'react'
import { format } from 'date-fns'
import { Copy, ExternalLink, KeyRound, LogIn } from 'lucide-react'
import { useT } from '../../../i18n'
import type { McpServerConfig } from '../../../store/types'
import { cancelSignIn, offersCode, signIn, signInWithCode, signedIn, type SignInState } from './oauth'
import './signin.css'

const hostOf = (url: string) => {
  try {
    return new URL(url).host
  } catch {
    return url
  }
}

/**
 * Sign in · while the window is open: Cancel and "Use a code instead" · once the server's sign-in is known to
 * offer a code: "Sign in with a code" (the device flow, for when the way back to this page can't work). While a
 * sign-in runs the key says so and is aria-disabled, never `disabled` — it keeps the keyboard.
 */
export function SignInKeys({ server, st, testId, describedBy }: { server: McpServerConfig; st: SignInState | undefined; testId: string; describedBy?: string }) {
  const t = useT()
  const phase = st?.phase
  const busy = phase === 'working' || phase === 'waiting' || phase === 'code'
  const code = offersCode(server)
  const label = phase === 'waiting' ? t('features.ai.mcp.oauth.waiting') : phase === 'code' ? t('features.ai.mcp.oauth.code.waiting') : busy ? t('features.ai.mcp.oauth.busy') : signedIn(server) ? t('features.ai.mcp.oauth.again') : t('features.ai.mcp.oauth.signIn')
  return (
    <>
      <button
        type="button"
        className="btn btn--sm btn--ink mcps-signin-key"
        aria-disabled={busy ? 'true' : undefined}
        onClick={() => {
          if (!busy) void signIn(server.id).catch(() => {})
        }}
        aria-describedby={describedBy}
        data-testid={testId}
      >
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
export function DeviceCode({ server, st }: { server: McpServerConfig; st: SignInState }) {
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

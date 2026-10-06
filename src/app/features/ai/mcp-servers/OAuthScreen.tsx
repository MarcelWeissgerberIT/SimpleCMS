/**
 * `#/oauth/mcp` — One's own page an MCP server's sign-in comes back to, when this tab finishes it itself
 * (the browser blocked the sign-in window, so this tab went there; or the tab that opened the window is gone).
 * The code is exchanged here (oauth.ts finishSignIn); then back to Settings → Claude AI.
 */
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import { useUI } from '../../../store/ui'
import { navigate } from '../../../lib/router'
import { finishSignIn, OAuthError, type OAuthIssue } from './oauth'
import './mcp-servers.css'

export interface McpOAuthScreenProps {
  state: string
  code: string
  error: string
  errorDescription: string
}

/** codes finished in this tab (StrictMode runs effects twice; a code is used once) */
const handled = new Map<string, Promise<string>>()

export function McpOAuthScreen({ state, code, error, errorDescription }: McpOAuthScreenProps) {
  const t = useT()
  const [st, setSt] = useState<{ phase: 'working' | 'done' | 'error'; name?: string; issue?: OAuthIssue; detail?: string }>({ phase: 'working' })
  const headRef = useRef<HTMLHeadingElement>(null)
  const inWindow = typeof window !== 'undefined' && !!window.opener

  useEffect(() => {
    let alive = true
    let job = handled.get(state)
    if (!job) {
      job = finishSignIn({ state, code, error, errorDescription }).then((s) => s.name)
      handled.set(state, job)
    }
    job.then(
      (name) => alive && setSt({ phase: 'done', name }),
      (e) => alive && setSt({ phase: 'error', issue: e instanceof OAuthError ? e.issue : 'token', detail: e instanceof OAuthError ? e.detail : String(e) }),
    )
    return () => {
      alive = false
    }
  }, [state, code, error, errorDescription])

  useEffect(() => {
    if (st.phase !== 'working') headRef.current?.focus()
  }, [st.phase])

  const back = () => {
    navigate({ name: 'home' })
    useUI.getState().openModal({ type: 'settings', tab: 'ai' })
  }

  return (
    <main className="mcp-oauth" data-testid="mcp-oauth-screen" data-phase={st.phase}>
      <div className="mcp-oauth__card">
        <span className="label mcp-oauth__code">
          <span className={`led${st.phase === 'done' ? ' led--ok' : st.phase === 'working' ? ' led--on' : ' mcps-led--warn'}`} aria-hidden /> § MCP — {t('features.ai.mcp.oauth.screen.code')}
        </span>
        <h1 className="display mcp-oauth__title" ref={headRef} tabIndex={-1}>
          {st.phase === 'done' ? t('features.ai.mcp.oauth.screen.done', { name: (st.name ?? '').toUpperCase() }) : st.phase === 'error' ? t('features.ai.mcp.oauth.screen.failed') : t('features.ai.mcp.oauth.screen.working')}
        </h1>
        <p className="mcp-oauth__text" role={st.phase === 'error' ? 'alert' : 'status'}>
          {st.phase === 'done'
            ? t('features.ai.mcp.oauth.screen.doneText')
            : st.phase === 'error'
              ? t(`features.ai.mcp.oauth.err.${st.issue ?? 'token'}`, { detail: st.detail ?? '' })
              : t('features.ai.mcp.oauth.screen.workingText')}
        </p>
        {st.phase !== 'working' && (
          <button type="button" className="btn btn--primary" onClick={inWindow ? () => window.close() : back}>
            {inWindow ? t('features.ai.mcp.oauth.screen.close') : t('features.ai.mcp.oauth.screen.back')}
          </button>
        )}
      </div>
    </main>
  )
}

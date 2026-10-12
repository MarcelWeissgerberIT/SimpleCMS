/**
 * `#/oauth/openrouter` — One's own page connecting OpenRouter comes back to when this tab finishes it itself (the browser
 * blocked the window, so this tab went to OpenRouter; or the return was refused here). Minimal in S2 stage A (the setup
 * polishes it): the code is exchanged here (openrouterConnect.ts finishOpenRouter), then "Continue the setup" resumes the
 * assistant at step 02 (sessionStorage `one.aiSetup.resume`). Styled like `#/oauth/mcp`.
 */
import { useEffect, useRef, useState } from 'react'
import { useT } from '../../../i18n'
import { openAISetup } from '../setup/openAISetup'
import { navigate } from '../../../lib/router'
import { oauthReturned } from '../mcp-servers/oauthReturn'
import { finishOpenRouter, type ORConnectState } from './openrouterConnect'
import '../mcp-servers/mcp-servers.css'

/** where the assistant picks up after a return (stage C reads it) */
export const SETUP_RESUME_KEY = 'one.aiSetup.resume'
/** OpenRouter's page of the account's keys (a minted key that One does not keep can be deleted there) */
export const OR_KEYS_PAGE = 'https://openrouter.ai/settings/keys'

export function OpenRouterOAuthScreen() {
  const back = oauthReturned('openrouter')
  const t = useT()
  const [st, setSt] = useState<ORConnectState>({ phase: 'working', at: 0 })
  const headRef = useRef<HTMLHeadingElement>(null)
  const inWindow = typeof window !== 'undefined' && !!window.opener

  useEffect(() => {
    let alive = true
    void finishOpenRouter(back ?? { state: '', code: '', error: '', errorDescription: '' }).then((s) => alive && setSt(s))
    return () => {
      alive = false
    }
  }, [back])

  useEffect(() => {
    if (st.phase !== 'working') headRef.current?.focus()
  }, [st.phase])

  const resume = () => {
    try {
      sessionStorage.setItem(SETUP_RESUME_KEY, JSON.stringify({ step: '02', provider: 'openrouter', at: Date.now() }))
    } catch {
      /* storage refused: the setup starts at its first step */
    }
    navigate({ name: 'home' })
    openAISetup({ reason: 'add', step: 'key', provider: 'openrouter' })
  }

  const ok = st.phase === 'done' && !st.discarded
  const check = st.check
  const text =
    st.phase === 'working'
      ? t('features.ai.or.screen.workingText')
      : st.phase === 'done' && !st.discarded
        ? check && !check.ok
          ? check.code === 'no_credit'
            ? t('features.ai.or.screen.noCredit')
            : t('features.ai.or.screen.unchecked', { code: check.code })
          : t('features.ai.or.screen.doneText')
        : st.discarded
          ? t('features.ai.or.err.invalid_key')
          : t(`features.ai.or.err.${st.issue ?? 'oauth_state'}`, { workspace: st.workspace ?? '' })

  return (
    <main className="mcp-oauth" data-testid="or-oauth-screen" data-phase={st.phase} data-issue={st.issue ?? ''}>
      <div className="mcp-oauth__card">
        <span className="label mcp-oauth__code">
          <span className={`led${ok ? ' led--ok' : st.phase === 'working' ? ' led--on' : ' mcps-led--warn'}`} aria-hidden /> § AI — {t('features.ai.or.screen.code')}
        </span>
        <h1 className="display mcp-oauth__title" ref={headRef} tabIndex={-1}>
          {ok ? t('features.ai.or.screen.done') : st.phase === 'working' ? t('features.ai.or.screen.working') : t('features.ai.or.screen.failed')}
        </h1>
        <p className="mcp-oauth__text" role={st.phase === 'error' || st.discarded ? 'alert' : 'status'}>
          {text}
        </p>
        {st.discarded && (
          <a className="mcp-oauth__text" href={OR_KEYS_PAGE} target="_blank" rel="noreferrer noopener" data-testid="or-delete-key">
            {t('features.ai.or.deleteKey')}
          </a>
        )}
        {st.phase !== 'working' && (
          <button type="button" className="btn btn--primary" onClick={inWindow ? () => window.close() : resume}>
            {inWindow ? t('features.ai.or.screen.close') : t('features.ai.or.screen.continue')}
          </button>
        )}
      </div>
    </main>
  )
}

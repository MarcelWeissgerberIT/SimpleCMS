/**
 * Background checks of MCP servers: right after a server is added (and after its URL or token
 * changes) one request tests the connection and writes the usage prompt. Runs outside the settings
 * UI (closing Settings does not stop it); the outcome lands on the server's settings (tools,
 * checkedAt / checkError, the prompt) and `useMcpChecks` says which checks are running.
 */
import { create } from 'zustand'
import type { McpServerConfig } from '../../../store/types'
import { useWorkspace } from '../../../store/store'
import { useCloud } from '../../../cloud/state'
import { connectionProblem } from '@/shared/ai/connection-problem'
import { t } from '../../../i18n'
import { AIError, isAIConfigured } from '../client'
import { PROMPT_MAX, outToolsFor, patchServer, readServers } from './config'
import { canInspectDirect, inspectServer, sentNothing } from './generate'
import { LISTING_SHOWS_DISABLED, mergeTestedTools } from './lock'

export type CheckMode = 'test' | 'guide'

/** server id → the check running for it */
export const useMcpChecks = create<{ running: Record<string, CheckMode> }>(() => ({ running: {} }))

const controllers = new Map<string, AbortController>()

function setRunning(id: string, mode: CheckMode | null) {
  useMcpChecks.setState((s) => {
    const running = { ...s.running }
    if (mode) running[id] = mode
    else delete running[id]
    return { running }
  })
}

/**
 * Check a server: 'test' lists its tools, 'guide' also writes the usage prompt (an edited prompt is
 * kept unless `replaceEdited`). A direct connection test needs no model; generating a guide does.
 */
export async function checkServer(id: string, mode: CheckMode = 'guide', opts: { replaceEdited?: boolean } = {}): Promise<void> {
  const server = readServers().find((s) => s.id === id)
  if (!server || (!isAIConfigured() && !(mode === 'test' && canInspectDirect(server)))) return
  const epoch = useWorkspace.getState().epoch
  const scoped = !!useWorkspace.getState().ai?.onboarding
  const cloudScope=()=>JSON.stringify([useCloud.getState().active,useCloud.getState().user?.id??null])
  const account=cloudScope()
  // A slow answer belongs to the connection that was checked. A sign-out, changed address or
  // workspace switch must not turn a different connection green (or attach an old failure to it).
  const current = () => {
    if (useWorkspace.getState().epoch !== epoch || !!useWorkspace.getState().ai?.onboarding !== scoped || cloudScope()!==account) return null
    const now = readServers().find(s => s.id === id)
    if (!now || now.url !== server.url || now.enabled !== server.enabled || now.oauth?.at !== server.oauth?.at) return null
    const renewed = !!server.oauth?.at && !!server.oauth?.refresh && !!now.oauth?.refresh && !!now.token && now.oauth?.expiresAt !== server.oauth.expiresAt
    return now.token === server.token || renewed ? now : null
  }
  controllers.get(id)?.abort()
  const ctrl = new AbortController()
  controllers.set(id, ctrl)
  setRunning(id, mode)
  try {
    const res = await inspectServer(server, mode, ctrl.signal)
    if (ctrl.signal.aborted) return
    const now = current()
    if (!now) return
    // the test ran under the OUT lock: the OUT tools the server had stay on its list (a profile matched by tools never flips)
    const tools = mergeTestedTools(now.tools, res.tools, outToolsFor(now), !!res.listed && LISTING_SHOWS_DISABLED)
    const patch: Partial<McpServerConfig> = { tools, checkedAt: Date.now(), checkError: undefined, checkAuth: undefined }
    const keep = now.promptSource === 'edited' && !!now.prompt.trim() && !opts.replaceEdited
    if (mode === 'guide' && res.guide && !keep) Object.assign(patch, { prompt: res.guide.slice(0, PROMPT_MAX), promptSource: 'auto' })
    patchServer(id, patch)
  } catch (e) {
    if (ctrl.signal.aborted || !current()) return
    // a short, friendly reason for the row (client.ts maps the error and keeps tokens out of it)
    const problem = connectionProblem(e instanceof AIError ? e.detail ?? e : e)
    const directDetail = mode === 'test' && problem === 'timeout' ? t('features.ai.mcp.test.timeout') : canInspectDirect(server) && !['tls', 'identity'].includes(problem)
      ? `${t('features.ai.connection.' + problem + '.title')} ${t('features.ai.connection.' + problem + '.next')}`
      : null
    const msg =
      e instanceof AIError && e.code === 'mcp_auth'
        ? t('features.ai.mcp.err.auth')
        : e instanceof AIError && e.code === 'mcp' && e.detail
          ? directDetail ?? t('features.ai.mcp.err.conn', { detail: e.detail })
          : e instanceof Error
            ? e.message
            : String(e)
    // An authentication failure (not a generic 403): Settings offers "Sign in". Only a check that went out may set or
    // clear that mark: one the gate stopped, or one without the token in this browser, never reached the server
    const auth = e instanceof AIError && e.code === 'mcp_auth'
    patchServer(id, { checkError: msg.length > 300 ? `${msg.slice(0, 299)}…` : msg, ...(sentNothing(e) ? {} : { checkAuth: auth || undefined }) })
  } finally {
    if (controllers.get(id) === ctrl) {
      controllers.delete(id)
      setRunning(id, null)
    }
  }
}

/** Resolves once no check runs for the server (at once when none does): true — or false after `timeoutMs`. */
export function whenChecked(id: string, timeoutMs = 60_000): Promise<boolean> {
  if (!useMcpChecks.getState().running[id]) return Promise.resolve(true)
  return new Promise((resolve) => {
    const timer = window.setTimeout(() => {
      unsub()
      resolve(false)
    }, timeoutMs)
    const unsub = useMcpChecks.subscribe((s) => {
      if (s.running[id]) return
      window.clearTimeout(timer)
      unsub()
      resolve(true)
    })
  })
}

/** Stop a running check (the server was removed). */
export function cancelCheck(id: string): void {
  controllers.get(id)?.abort()
  controllers.delete(id)
  setRunning(id, null)
}

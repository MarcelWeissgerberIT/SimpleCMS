/**
 * Background checks of MCP servers: right after a server is added (and after its URL or token
 * changes) one request tests the connection and writes the usage prompt. Runs outside the settings
 * UI (closing Settings does not stop it); the outcome lands on the server's settings (tools,
 * checkedAt / checkError, the prompt) and `useMcpChecks` says which checks are running.
 */
import { create } from 'zustand'
import type { McpServerConfig } from '../../../store/types'
import { t } from '../../../i18n'
import { AIError, isAIConfigured } from '../client'
import { PROMPT_MAX, patchServer, readServers } from './config'
import { inspectServer } from './generate'

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
 * kept unless `replaceEdited`). Without a Claude key nothing is sent.
 */
export async function checkServer(id: string, mode: CheckMode = 'guide', opts: { replaceEdited?: boolean } = {}): Promise<void> {
  const server = readServers().find((s) => s.id === id)
  if (!server || !isAIConfigured()) return
  controllers.get(id)?.abort()
  const ctrl = new AbortController()
  controllers.set(id, ctrl)
  setRunning(id, mode)
  try {
    const res = await inspectServer(server, mode, ctrl.signal)
    if (ctrl.signal.aborted) return
    const now = readServers().find((s) => s.id === id)
    if (!now) return
    const patch: Partial<McpServerConfig> = { tools: res.tools, checkedAt: Date.now(), checkError: undefined }
    const keep = now.promptSource === 'edited' && !!now.prompt.trim() && !opts.replaceEdited
    if (mode === 'guide' && res.guide && !keep) Object.assign(patch, { prompt: res.guide.slice(0, PROMPT_MAX), promptSource: 'auto' })
    patchServer(id, patch)
  } catch (e) {
    if (ctrl.signal.aborted || !readServers().some((s) => s.id === id)) return
    // a short, friendly reason for the row (client.ts maps the error and keeps tokens out of it)
    const msg =
      e instanceof AIError && e.code === 'mcp_auth'
        ? t('features.ai.mcp.err.auth')
        : e instanceof AIError && e.code === 'mcp' && e.detail
          ? t('features.ai.mcp.err.conn', { detail: e.detail })
          : e instanceof Error
            ? e.message
            : String(e)
    patchServer(id, { checkError: msg.length > 300 ? `${msg.slice(0, 299)}…` : msg })
  } finally {
    if (controllers.get(id) === ctrl) {
      controllers.delete(id)
      setRunning(id, null)
    }
  }
}

/** Stop a running check (the server was removed). */
export function cancelCheck(id: string): void {
  controllers.get(id)?.abort()
  controllers.delete(id)
  setRunning(id, null)
}

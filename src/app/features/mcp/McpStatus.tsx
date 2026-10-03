/**
 * Status bar cell "AGENT": shown while an MCP client is connected (or a change waits for
 * approval). The LED blinks while a call runs; opens Settings → Agents · MCP.
 */
import { Led } from '../../ui/controls'
import { useT } from '../../i18n'
import { useUI } from '../../store/ui'
import { clientLabel, useMcp } from './state'
import './mcp.css'

let settingsRequested = false

/** Open Settings on the Agents · MCP tab. */
export function openMcpSettings() {
  settingsRequested = true
  useUI.getState().openModal({ type: 'settings' })
}

/** SettingsModal asks once when it opens: was it opened for Agents · MCP? */
export function consumeMcpSettingsRequest(): boolean {
  const r = settingsRequested
  settingsRequested = false
  return r
}

export function McpStatusCell() {
  const t = useT()
  const enabled = useMcp((s) => s.enabled)
  const connected = useMcp((s) => s.conn === 'connected')
  const busy = useMcp((s) => s.busy > 0)
  const waiting = useMcp((s) => s.approvals.length)
  const client = useMcp((s) => clientLabel(s.client))
  if (!enabled || (!connected && !waiting)) return null
  const text = waiting ? t('features.mcp.status.waiting', { n: waiting }) : t('features.mcp.status.agent')
  const title = client ? t('features.mcp.status.title', { client }) : t('features.mcp.title')
  return (
    <button type="button" className="status__cell mcp-status" data-busy={busy || waiting > 0 || undefined} onClick={openMcpSettings} title={title} aria-label={`${text} — ${title}`}>
      <Led state={busy || waiting ? 'on' : 'ok'} />
      {text}
    </button>
  )
}

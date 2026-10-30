import { useWorkspace } from '../../../store/store'
import { useT } from '../../../i18n'
import { readServers } from './config'
import { trustedProtectedInput } from './protectedInput'
import './protectedInput.css'

/** Only a user click opens this no-opener window. One never fetches or embeds its contents. */
export function ProtectedMcpInput({ call }: { call: { server: string; tool: string; protectedInput?: string } }) {
  const t = useT()
  const raw = useWorkspace((s) => s.settings.mcpServers)
  const server = readServers({ mcpServers: raw }).find((s) => s.enabled && s.name === call.server)
  const url = server ? trustedProtectedInput(call.protectedInput, server.url) : undefined
  if (!url) return null
  return <div className="mcp-protected-input" data-testid="mcp-protected-input">
    <a className="btn btn--sm" href={url} target="_blank" rel="noopener noreferrer">{t('features.ai.mcp.protected.open')}</a>
    <span className="mcp-protected-input__url" title={url}>{new URL(url).origin}</span>
    <small>{t('features.ai.mcp.protected.note')}</small>
  </div>
}

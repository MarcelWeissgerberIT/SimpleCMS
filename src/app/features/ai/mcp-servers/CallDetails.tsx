import { useT } from '../../../i18n'
import { callLabel, type McpCall } from './activity'
import './callDetails.css'

/** Keep the human action visible; transport names and arguments stay available on demand. */
export function McpCallDetails({ call }: { call: Pick<McpCall, 'server' | 'tool' | 'arg'> }) {
  const t = useT()
  const parts = call.tool.split(/[_.:-]+/).filter(Boolean)
  const operation = parts.at(-1)?.toLowerCase() ?? ''
  const key = ({ read: 'read', get: 'read', search: 'search', resolve: 'search', status: 'status', connect: 'connect', list: 'list' } as Record<string, string>)[operation]
  const action = key ? t(`features.ai.mcp.action.${key}`) : parts.join(' ')
  const readable = call.arg && !/^[0-9a-f-]{36}$/i.test(call.arg) ? call.arg : ''
  return <details className="mcp-call-details">
    <summary><span className="mcp-call-details__server">{call.server}</span><span>{action}</span>{readable && <span className="mcp-call-details__subject">{readable}</span>}</summary>
    <div className="mcp-call-details__technical"><code>{callLabel(call)}</code>{call.arg && <pre>{call.arg}</pre>}</div>
  </details>
}

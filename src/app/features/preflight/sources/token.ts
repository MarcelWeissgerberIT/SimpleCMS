/**
 * Lamp "Token refused": per enabled MCP server of this device — red when its token was refused (at the last check or
 * in this tab) or its sign-in ran out without a refresh; amber when the last check failed for another reason. Servers
 * never checked count nothing. Ids: mcp:<serverId>@<last 8 of the token marker>.
 */
import { useWorkspace } from '../../../store/store'
import type { McpServerConfig } from '../../../store/types'
import { useUI } from '../../../store/ui'
import { t } from '../../../i18n'
import { onRefusedChanged, readServers, refusedHere } from '../../ai/mcp-servers/config'
import { useMcpSignIn } from '../../ai/mcp-servers/oauth'
import type { LampReading, LampSourceDef } from '../registry'
import { all, watch } from './util'

function stateOf(s: McpServerConfig, now: number): 'red' | 'amber' | null {
  if (s.checkAuth === true || refusedHere(s)) return 'red'
  if (s.oauth?.expiresAt && s.oauth.expiresAt < now && !s.oauth.refresh) return 'red'
  if (s.checkError) return 'amber'
  return null
}

const enabled = () => readServers(useWorkspace.getState().settings).filter((s) => s.enabled)

export const tokenLamp: LampSourceDef = {
  id: 'token',
  order: 40,
  legend: () => t('features.preflight.lamp.token.legend'),
  short: () => t('features.preflight.lamp.token.short'),
  rule: () => t('features.preflight.lamp.token.rule'),
  thresholds: { amber: null, red: 1 },
  tick: true,
  fitted: () => enabled().length > 0,
  subscribe: (changed) => all(watch(useWorkspace, (s) => [s.settings.mcpServers], changed), onRefusedChanged(changed), watch(useMcpSignIn, (s) => [s.byServer], changed)),
  read({ now }): LampReading {
    const ids: string[] = []
    const names: string[] = []
    let red = false
    for (const s of enabled()) {
      const st = stateOf(s, now)
      if (!st) continue
      if (st === 'red') red = true
      ids.push(`mcp:${s.id}@${(s.token ?? '').slice(-8)}`)
      names.push(s.name)
    }
    const second = names.length === 1 ? t('features.preflight.lamp.token.second', { name: names[0] }) : names.length > 1 ? t('features.preflight.lamp.token.second.many', { n: names.length }) : ''
    return { state: 'ok', count: ids.length, ids, second, ...(ids.length ? { level: red ? ('red' as const) : ('amber' as const) } : {}) }
  },
  open: () => useUI.getState().openModal({ type: 'settings', tab: 'ai' }),
}

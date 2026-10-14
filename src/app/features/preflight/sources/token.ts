/**
 * Lamp "Token refused": per enabled MCP server of this device — red when its token was refused (at the last check or
 * in this tab) or its sign-in ran out without a refresh; amber when the last check failed for another reason. Servers
 * never checked count nothing (the rule: tokenTrouble, ai/mcp-servers/health.ts). Ids: mcp:<serverId>@<last 8 of the token
 * marker>. The lamp opens MCP · Connections (#/mcp); its cards keep their own keys.
 */
import { useWorkspace } from '../../../store/store'
import { openAISettings } from '../../ai/setup/openAISetup'
import { openMcpConnections } from '../../mcp/connections/open'
import { t } from '../../../i18n'
import { onRefusedChanged, readServers, refusedHere } from '../../ai/mcp-servers/config'
import { useMcpSignIn } from '../../ai/mcp-servers/oauth'
import { tokenTrouble } from '../../ai/mcp-servers/health'
import type { CardAction, LampReading, LampSourceDef, QueueItem } from '../registry'
import { checkConnection, signInServer } from '../queue/calls'
import { all, watch } from './util'

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
      const st = tokenTrouble(s, now, refusedHere(s))?.level ?? null
      if (!st) continue
      if (st === 'red') red = true
      ids.push(`mcp:${s.id}@${(s.token ?? '').slice(-8)}`)
      names.push(s.name)
    }
    const second = names.length === 1 ? t('features.preflight.lamp.token.second', { name: names[0] }) : names.length > 1 ? t('features.preflight.lamp.token.second.many', { n: names.length }) : ''
    return { state: 'ok', count: ids.length, ids, second, ...(ids.length ? { level: red ? ('red' as const) : ('amber' as const) } : {}) }
  },
  // MCP · Connections names the server, why, and offers Sign in / Test in its row
  open: () => openMcpConnections(),
  queue: {
    items: ({ now }) => {
      const out: QueueItem[] = []
      for (const s of enabled()) {
        const st = tokenTrouble(s, now, refusedHere(s))?.level ?? null
        if (!st) continue
        out.push({
          id: `mcp:${s.id}@${(s.token ?? '').slice(-8)}`,
          lamp: 'token',
          kind: 'fix',
          tag: 'MCP',
          refs: {},
          at: s.checkedAt ?? 0,
          hand: s.oauth ? ['signIn'] : ['editor'],
          bulk: false,
          resolveBy: 'reading',
          title: s.name,
          detail: t(st === 'red' ? 'features.preflight.fix.token.refused' : 'features.preflight.fix.token.failed'),
        })
      }
      return out
    },
    actions: (item) => {
      const sid = /^mcp:([^@]+)@/.exec(item.id)?.[1]
      const s = enabled().find((x) => x.id === sid)
      const settings: CardAction = { key: s?.oauth ? '2' : 'a', label: t('features.preflight.fix.token.enter'), outcome: 'hand', run: () => (openAISettings({ section: 'mcp' }), { ok: true, stay: true }) }
      if (!s) return [settings]
      const out: CardAction[] = []
      // the sign-in window opens inside the key press (sync)
      if (s.oauth) out.push({ key: 'a', label: t('features.preflight.fix.token.signIn'), outcome: 'hand', hand: ['signIn'], sync: true, run: () => (void signInServer(s.id).catch((e) => console.warn('[one] preflight: sign-in failed', e)), { ok: true, resolve: 'reading' }) })
      out.push(settings)
      out.push({ key: '3', label: t('features.preflight.fix.token.check'), outcome: 'hand', hand: ['tokens'], run: async () => (await checkConnection(s.id), { ok: true, resolve: 'reading' }) })
      return out
    },
  },
}

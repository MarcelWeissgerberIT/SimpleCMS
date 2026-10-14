/** The worker link's state in words (Settings, the 3-step card, #/coding, the status bar, the workspace page). */
import type { useT } from '../../i18n'
import { currentWorkspace } from '../mcp/identity'
import { viaFor } from './service'
import type { CodingState } from './state'
import { inAppWindow } from '../../lib/localNetwork'

type T = ReturnType<typeof useT>

/** Is this tab's link going through the team server (Settings → Coding worker → Cloud)? */
export const isCloudLink = (): boolean => viaFor(currentWorkspace()) === 'cloud'

type StateIn = Pick<CodingState, 'enabled' | 'conn' | 'worker' | 'busy' | 'refused'> & {
  relay?: CodingState['relay']
  pendingHere?: boolean
  cloud?: boolean
  /** Local only: why the browser blocks the link · the browser has still to ask (state.ts) */
  blocked?: CodingState['blocked']
  lna?: CodingState['lna']
}

export function workerStateText(t: T, s: StateIn): string {
  if (!s.enabled) return t('features.coding.conn.off')
  const cloud = s.cloud ?? isCloudLink()
  switch (s.conn) {
    case 'connected': {
      const repos = s.worker?.repos.length ?? 0
      const base = t(repos === 0 ? 'features.coding.conn.connected.none' : repos === 1 ? 'features.coding.conn.connected.one' : 'features.coding.conn.connected.other', { name: s.worker?.name ?? '', n: repos })
      const via = cloud ? `${base} · ${t('features.coding.conn.viaCloud')}` : base
      return s.busy.length ? `${via} · ${t('features.coding.conn.busy', { n: s.busy.length })}` : via
    }
    case 'connecting':
      return t('features.coding.conn.connecting')
    case 'waiting':
      if (!cloud) return t(s.lna === 'prompt' ? 'features.coding.conn.waitingAllow' : 'features.coding.conn.waiting')
      if (s.pendingHere) return t('features.coding.conn.pendingHere')
      return s.relay?.registered === false ? t('features.coding.conn.noCloudWorker') : t('features.coding.conn.waitingCloud')
    case 'replaced':
      return t(cloud ? 'features.coding.conn.replacedCloud' : 'features.coding.conn.replaced')
    case 'refused':
      switch (s.refused) {
        case 'unbound':
          return t('features.coding.conn.unbound')
        case 'pair':
          return t(cloud ? 'features.coding.conn.pairCloud' : 'features.coding.conn.pair')
        case 'viewer':
          return t('features.coding.conn.viewer')
        case 'forbidden':
          return t('features.coding.conn.forbidden')
        case 'removed':
          return t('features.coding.conn.removed')
        case 'relay-off':
          return t('features.coding.conn.relayOff')
        case 'other-device':
          return t('features.coding.conn.otherDevice')
        case 'worker-unknown':
          return t('features.coding.conn.workerUnknown')
        default:
          return t('features.coding.conn.refused')
      }
    case 'blocked':
      if (cloud) return t('features.coding.conn.blocked')
      // an installed app's window has no address bar: its site settings are under ⋮ → App info
      if (s.blocked === 'permission') return t(inAppWindow() ? 'features.coding.conn.blockedPermissionApp' : 'features.coding.conn.blockedPermission')
      return t(s.blocked === 'insecure' ? 'features.coding.conn.blockedInsecure' : 'features.coding.conn.blocked')
    default:
      return t('features.coding.conn.off')
  }
}

/**
 * Why there is no link, for another area (Preflight's worker card): the state text above — for a Local link that waits,
 * what to check instead (is the worker running in a terminal; the browser's question).
 */
export function workerDownText(t: T, s: StateIn): string {
  if (s.enabled && s.conn === 'waiting' && !(s.cloud ?? isCloudLink())) return t(s.lna === 'prompt' ? 'features.coding.conn.noAnswerAllow' : 'features.coding.conn.noAnswer')
  return workerStateText(t, s)
}

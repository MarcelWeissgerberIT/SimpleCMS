/** The worker link's state in words (Settings, the 3-step card, #/coding, the status bar, the workspace page). */
import type { useT } from '../../i18n'
import { currentWorkspace } from '../mcp/identity'
import { viaFor } from './service'
import type { CodingState } from './state'

type T = ReturnType<typeof useT>

/** Is this tab's link going through the team server (Settings → Coding worker → Cloud)? */
export const isCloudLink = (): boolean => viaFor(currentWorkspace()) === 'cloud'

export function workerStateText(t: T, s: Pick<CodingState, 'enabled' | 'conn' | 'worker' | 'busy' | 'refused'> & { relay?: CodingState['relay']; cloud?: boolean }): string {
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
      if (!cloud) return t('features.coding.conn.waiting')
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
      return t('features.coding.conn.blocked')
    default:
      return t('features.coding.conn.off')
  }
}

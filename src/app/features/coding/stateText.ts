/** The worker link's state in words (Settings, the 3-step card, #/coding, the status bar, the workspace page). */
import type { useT } from '../../i18n'
import type { CodingState } from './state'

type T = ReturnType<typeof useT>

export function workerStateText(t: T, s: Pick<CodingState, 'enabled' | 'conn' | 'worker' | 'busy' | 'refused'>): string {
  if (!s.enabled) return t('features.coding.conn.off')
  switch (s.conn) {
    case 'connected': {
      const repos = s.worker?.repos.length ?? 0
      const base = t(repos === 0 ? 'features.coding.conn.connected.none' : repos === 1 ? 'features.coding.conn.connected.one' : 'features.coding.conn.connected.other', { name: s.worker?.name ?? '', n: repos })
      return s.busy.length ? `${base} · ${t('features.coding.conn.busy', { n: s.busy.length })}` : base
    }
    case 'connecting':
      return t('features.coding.conn.connecting')
    case 'waiting':
      return t('features.coding.conn.waiting')
    case 'replaced':
      return t('features.coding.conn.replaced')
    case 'refused':
      return s.refused === 'unbound' ? t('features.coding.conn.unbound') : s.refused === 'pair' ? t('features.coding.conn.pair') : t('features.coding.conn.refused')
    case 'blocked':
      return t('features.coding.conn.blocked')
    default:
      return t('features.coding.conn.off')
  }
}

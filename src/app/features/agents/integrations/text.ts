/** Integration profiles in words (the panel, the editor, the agents' gallery). */
import type { Translate } from '@/shared/i18n'
import type { ProfileStatus } from '../../../store/integrations'

/** Why a profile is (not) active on this device. */
export function statusText(t: Translate, st: ProfileStatus): string {
  if (st.active) return t('features.integrations.status.matches', { server: st.server.toUpperCase() })
  switch (st.reason) {
    case 'noConditions':
      return t('features.integrations.status.noConditions')
    case 'noServers':
      return t('features.integrations.status.noServers')
    case 'disabled':
      return t('features.integrations.status.disabled', { server: st.server.toUpperCase() })
    case 'untested':
      return t('features.integrations.status.untested', { server: st.server.toUpperCase() })
    case 'tools':
      return t(st.missing.length === 1 ? 'features.integrations.status.tool' : 'features.integrations.status.tools', { tool: st.missing[0], n: st.missing.length - 1 })
    case 'name':
      return t('features.integrations.status.name')
    case 'host':
      return t('features.integrations.status.host')
  }
}

/** "Key · Only by hand · Upsert" */
export const featureList = (t: Translate, list: readonly string[]): string => list.map((f) => t(`features.integrations.feature.${f}`)).join(' · ')

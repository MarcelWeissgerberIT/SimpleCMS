/**
 * Lamp "Cloud" (team workspaces, per tab): this tab is older than the server's documents (read-only until reloaded) →
 * red cloud:outdated; files that could not be uploaded → red cloud:uploads:<n>.
 */
import { t } from '../../../i18n'
import { useCloud, useCloudSync } from '../../../cloud'
import type { LampReading, LampSourceDef } from '../registry'
import { all, watch } from './util'
import { fixItems } from './fix'

export const cloudLamp: LampSourceDef = {
  id: 'cloud',
  order: 140,
  legend: () => t('features.preflight.lamp.cloud.legend'),
  short: () => t('features.preflight.lamp.cloud.short'),
  rule: () => t('features.preflight.lamp.cloud.rule'),
  thresholds: { amber: null, red: 1 },
  fitted: () => useCloud.getState().active.kind === 'cloud',
  subscribe: (changed) => all(watch(useCloud, (s) => [s.outdated, s.active], changed), watch(useCloudSync, (s) => [s.failedUploads], changed)),
  read(): LampReading {
    const ids: string[] = []
    let second = ''
    if (useCloud.getState().outdated) {
      ids.push('cloud:outdated')
      second = t('features.preflight.lamp.cloud.second.outdated')
    }
    const n = useCloudSync.getState().failedUploads.length
    if (n) {
      ids.push(`cloud:uploads:${n}`)
      if (!second) second = t('features.preflight.lamp.cloud.second.uploads', { n })
    }
    return { state: 'ok', count: ids.length, ids, second }
  },
  queue: {
    items: (ctx) => {
      const r = cloudLamp.read(ctx) as LampReading
      return fixItems('cloud', r.ids, (id) => ({ tag: t('features.preflight.lamp.cloud.short'), title: t(id === 'cloud:outdated' ? 'features.preflight.fix.cloud.outdated' : 'features.preflight.fix.cloud.uploads', { n: useCloudSync.getState().failedUploads.length }), detail: '', hand: ['noBulk'] }))
    },
    actions: () => [
      // the confirm row names what a reload drops (this tab's terminal and autofill proposals)
      { key: 'a', label: t('features.preflight.fix.cloud.reload'), outcome: 'hand', hand: ['noBulk'], run: () => (window.location.reload(), { ok: true, resolve: 'reading' }) },
    ],
  },
}

/**
 * Lamp "Sync" (fitted where the folder or GitHub sync is set up): an error of either target → red
 * (sync:<target>:error:<hash of the message>); files that went missing from the folder → amber
 * (sync:missing:<n>@<target>); no folder permission in this tab → grey with "Grant access" (the browser asks, so it
 * runs inside the key press).
 */
import { t } from '../../../i18n'
import { openSyncSettings, useSync } from '../../sync'
import { grantFolder } from '../queue/calls'
import { fnv1a, hex8 } from '../lamps'
import { fmtTime } from '../format'
import type { LampReading, LampSourceDef } from '../registry'
import { watch } from './util'

const ERR_WHY = 'features.preflight.lamp.sync.why.noAccess'

function targets(): { folder: boolean; github: boolean } {
  const s = useSync.getState()
  return { folder: s.folder.state !== 'off' && s.folder.state !== 'unsupported', github: s.github.state !== 'off' }
}

/** when the newest error of a target was logged (the second line) */
function errorAt(target: 'folder' | 'github'): number | null {
  const e = useSync.getState().log.find((l) => l.kind === 'error' && l.target === target)
  return e?.at ?? null
}

export const syncLamp: LampSourceDef = {
  id: 'sync',
  order: 120,
  legend: () => {
    const { folder, github } = targets()
    return t(`features.preflight.lamp.sync.legend.${folder && github ? 'both' : github ? 'github' : 'folder'}`)
  },
  short: () => t('features.preflight.lamp.sync.short'),
  rule: () => t('features.preflight.lamp.sync.rule'),
  thresholds: { amber: 1, red: null },
  fitted: () => {
    const { folder, github } = targets()
    return folder || github
  },
  subscribe: (changed) => watch(useSync, (s) => [s.folder, s.github, s.missing, s.log], changed),
  read(): LampReading {
    const s = useSync.getState()
    const ids: string[] = []
    let at: number | null = null
    for (const target of ['folder', 'github'] as const) {
      const st = s[target]
      if (st.state !== 'error') continue
      ids.push(`sync:${target}:error:${hex8(fnv1a(st.error ?? ''))}`)
      const e = errorAt(target)
      if (e && (!at || e > at)) at = e
    }
    if (ids.length) return { state: 'ok', count: ids.length, ids, level: 'red', second: t('features.preflight.lamp.sync.second.error', { time: at ? fmtTime(at) : '—' }) }
    if (s.folder.state === 'permission') return { state: 'off', count: 0, ids: [], why: ERR_WHY, second: t('features.preflight.grey.off') }
    const n = s.missing?.items.length ?? 0
    if (n && s.missing) return { state: 'ok', count: n, ids: [`sync:missing:${n}@${s.missing.target}`], level: 'amber', second: t('features.preflight.lamp.sync.second.missing', { n }) }
    return { state: 'ok', count: 0, ids: [], second: '' }
  },
  open: () => openSyncSettings(),
  fix: { label: () => t('features.preflight.lamp.sync.grant'), run: () => grantFolder() },
}

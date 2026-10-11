/**
 * Lamp "Worker offline" (fitted where coding is switched on): red while the worker link is refused / blocked /
 * replaced / off, or still connecting a minute after it began; amber while the connected worker is older than the
 * download. Ids: worker:<conn> · worker:outdated@<version>.
 */
import { t } from '../../../i18n'
import { openCodingSettings, useCoding } from '../../coding'
import { workerOutdated } from '../../coding/protocol'
import type { LampReading, LampSourceDef } from '../registry'
import { fmtTime } from '../format'
import { watch } from './util'

/** connecting / waiting / off count only after this long */
const GRACE_MS = 60_000
const DEFINITE = new Set(['refused', 'blocked', 'replaced'])

/** since when the link has not been connected (this tab) */
let downSince: number | null = null
let lastConn: string | null = null

function track(now = Date.now()): void {
  const conn = useCoding.getState().conn
  if (conn === lastConn) return
  lastConn = conn
  downSince = conn === 'connected' ? null : (downSince ?? now)
}

export const workerLamp: LampSourceDef = {
  id: 'worker',
  order: 90,
  legend: () => t('features.preflight.lamp.worker.legend'),
  short: () => t('features.preflight.lamp.worker.short'),
  rule: () => t('features.preflight.lamp.worker.rule'),
  thresholds: { amber: 1, red: null },
  tick: true,
  fitted: () => useCoding.getState().enabled,
  subscribe: (changed) => {
    track()
    return watch(useCoding, (s) => [s.conn, s.enabled, s.worker, s.can], () => {
      track()
      changed()
    })
  },
  read({ now }): LampReading {
    track(now)
    const s = useCoding.getState()
    if (s.conn === 'connected') {
      const version = s.worker?.worker ?? ''
      if (workerOutdated(s.can)) return { state: 'ok', count: 1, ids: [`worker:outdated@${version}`], level: 'amber', second: t('features.preflight.lamp.worker.second.outdated') }
      return { state: 'ok', count: 0, ids: [], second: version ? t('features.preflight.lamp.worker.second.ok', { version }) : '' }
    }
    const since = downSince ?? now
    if (!DEFINITE.has(s.conn) && now - since < GRACE_MS) return { state: 'ok', count: 0, ids: [], second: '' }
    return { state: 'ok', count: 1, ids: [`worker:${s.conn}`], level: 'red', second: downSince ? t('features.preflight.lamp.worker.second.since', { time: fmtTime(downSince) }) : t('features.preflight.lamp.worker.second.off') }
  },
  open: () => openCodingSettings(),
}

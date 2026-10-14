/**
 * Lamp "Worker offline" (fitted where coding is switched on): red while the worker link is refused / blocked /
 * replaced / off, or still connecting a minute after it began; amber while the connected worker is older than the
 * download — with the ZIP-import gap (`workerUnsafe`, by the version it names: 1.8.0 names every capability), older
 * than 1.9.0 on this Windows computer (`workerOldHere`: a Local link from a browser on Windows) or without a capability
 * One hands out (`workerOutdated`); in that order, as on the #/coding plate.
 * Ids: worker:<conn> · worker:unsafe@<version> · worker:windows@<version> · worker:outdated@<version>.
 */
import { t } from '../../../i18n'
import { openCodingSettings, useCoding, workerOldHere } from '../../coding'
import { workerOutdated, workerUnsafe } from '../../coding/protocol'
import type { LampReading, LampSourceDef } from '../registry'
import { fmtTime } from '../format'
import { watch } from './util'
import { fixItems, openKey } from './fix'

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
      if (workerUnsafe(version)) return { state: 'ok', count: 1, ids: [`worker:unsafe@${version.trim()}`], level: 'amber', second: t('features.preflight.lamp.worker.second.unsafe') }
      if (workerOldHere(version)) return { state: 'ok', count: 1, ids: [`worker:windows@${version.trim()}`], level: 'amber', second: t('features.preflight.lamp.worker.second.unsafe') }
      if (workerOutdated(s.can)) return { state: 'ok', count: 1, ids: [`worker:outdated@${version}`], level: 'amber', second: t('features.preflight.lamp.worker.second.outdated') }
      return { state: 'ok', count: 0, ids: [], second: version ? t('features.preflight.lamp.worker.second.ok', { version }) : '' }
    }
    const since = downSince ?? now
    if (!DEFINITE.has(s.conn) && now - since < GRACE_MS) return { state: 'ok', count: 0, ids: [], second: '' }
    return { state: 'ok', count: 1, ids: [`worker:${s.conn}`], level: 'red', second: downSince ? t('features.preflight.lamp.worker.second.since', { time: fmtTime(downSince) }) : t('features.preflight.lamp.worker.second.off') }
  },
  open: () => openCodingSettings(),
  queue: {
    items: (ctx) => {
      const r = workerLamp.read(ctx) as LampReading
      return fixItems('worker', r.ids, (id) => ({
        tag: t('features.preflight.lamp.worker.short'),
        title: id.startsWith('worker:unsafe@')
          ? t('features.preflight.fix.worker.unsafe', { version: id.slice('worker:unsafe@'.length) })
          : id.startsWith('worker:windows@')
            ? t('features.preflight.fix.worker.windows', { version: id.slice('worker:windows@'.length) })
            : t(id.startsWith('worker:outdated') ? 'features.preflight.fix.worker.outdated' : 'features.preflight.fix.worker.down'),
        detail: r.second ?? '',
      }))
    },
    actions: () => [openKey(t('features.preflight.fix.worker.open'), () => openCodingSettings())],
  },
}

/**
 * The Patchbay's Preflight lamp "Fuses open" / "Sicherung offen" (plan §1.8) — registered through Preflight's
 * dependency-free registry (the sanctioned import of features/preflight from another area, like the Outbox's lamp).
 *
 *  - read() is O(1): the cached fuse list (counts.ts — the same numbers as the sidebar LED and the readout's FUSE cell,
 *    §6 A16); ids = the open fuses' path keys; amber from 1; never MASTER CAUTION (`master: false` — a standing risk in
 *    the configuration, not something new to look at);
 *  - parts unknown here: the second line "{n} UNKNOWN" — also at count 0 (unknown never reads as safe);
 *  - not fitted for viewers and read-only members (they cannot act on a fuse);
 *  - open() → `#/patchbay?f=<first open fuse>`; no queue cards: allowing a path from Preflight would bypass the plate's
 *    explanation.
 * Nothing here computes: until the background count ran (counts.ts, after the first paint) the lamp reads 0.
 */
import { registerLampSource, type LampReading } from '../preflight/registry'
import { t } from '../../i18n'
import { useCloud } from '../../cloud'
import { onCounts, patchbayCounts } from './counts'
import { openPatchbay } from './open'

const P = 'features.patchbay.preflight'

/** Viewers and read-only members see no lamp (the sidebar shows them a neutral LED). */
const viewer = (): boolean => {
  const c = useCloud.getState()
  return c.readOnly || c.role === 'viewer'
}

let registered = false

/** Register the lamp (startPatchbay; idempotent). */
export function registerFuseLamp(): void {
  if (registered) return
  registered = true
  registerLampSource({
    id: 'fuses',
    order: 92,
    legend: () => t(`${P}.legend`),
    short: () => t(`${P}.short`),
    rule: () => t(`${P}.rule`),
    thresholds: { amber: 1, red: null },
    master: false,
    fitted: () => !viewer(),
    subscribe: (changed) => {
      const a = onCounts(changed)
      const b = useCloud.subscribe((s, p) => {
        if (s.readOnly !== p.readOnly || s.role !== p.role) changed()
      })
      return () => {
        a()
        b()
      }
    },
    read(): LampReading {
      const c = patchbayCounts()
      if (!c.ready) return { state: 'ok', count: 0, ids: [], second: '' }
      const ids = c.keys ?? []
      return { state: 'ok', count: c.open, ids, second: c.unknown > 0 ? t(`${P}.unknown`, { n: c.unknown }) : '' }
    },
    settle: 0,
    open: () => {
      const first = patchbayCounts().first
      openPatchbay(first ? { f: first } : {})
    },
  })
}

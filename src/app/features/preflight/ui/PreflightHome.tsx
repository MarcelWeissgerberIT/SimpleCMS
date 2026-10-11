/**
 * Preflight on Start (first child of Home's column): the full plate with the rule card below it, or the strip — by
 * the plate mode (§5.6). Before this tab has counted, the caps are drawn from the last count (ids and levels only) as
 * "…" — a held morning boot builds the plate, not Home's page walk.
 */
import { lazy, Suspense, useMemo } from 'react'
import { lampSource } from '../registry'
import { usePlateMode } from '../hooks'
import { noteRender } from '../engine'
import { usePreflight } from '../state'
import type { LastCache, LampView } from '../types'
import { Plate } from './Plate'
import { Strip } from './Strip'
import { Aside } from './Aside'

/** the queue: its own chunk, loaded with the full plate (never for the strip or at boot) */
const Queue = lazy(() => import('./Queue'))

/** Placeholder views from the last count: the lamps and their levels, no counts. */
function fromLast(last: LastCache | null): LampView[] {
  const out: LampView[] = []
  for (const [id, level] of last?.lamps ?? []) {
    const src = lampSource(id)
    if (!src) continue
    let legend = id
    try {
      legend = src.legend()
    } catch {
      /* the id then */
    }
    out.push({ id, order: src.order, legend, short: legend, second: '', rule: '', level, count: 0, idsHash: '', isNew: false, newCount: 0, chip: null, flash: false, master: false, hasQueue: false, ms: 0, at: 0, amber: null, red: null, hasOpen: false, hasFix: false })
  }
  return out
}

export function PreflightHome() {
  noteRender('home')
  const mode = usePlateMode(true)
  const ready = usePreflight((s) => s.ready)
  const views = usePreflight((s) => s.views)
  const last = usePreflight((s) => s.last)
  const shown = useMemo(() => (ready ? views : fromLast(last)), [ready, views, last])
  if (mode === 'off') return null
  if (mode === 'strip') return <Strip views={shown} busy={!ready} />
  return (
    <>
      <Plate views={shown} busy={!ready} />
      <div className="pf-below" data-testid="pf-below">
        <div className="pf-below__q">
          {ready && (
            <Suspense fallback={null}>
              <Queue />
            </Suspense>
          )}
        </div>
        <Aside />
      </div>
    </>
  )
}

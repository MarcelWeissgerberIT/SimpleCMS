/**
 * Preflight on Start (first child of Home's column): the full plate with the rule card below it, or the strip — by
 * the plate mode (§5.6). Before this tab has counted, the caps are drawn from the last count (ids and levels only) as
 * "…" — a held morning boot builds the plate, not Home's page walk.
 */
import { lazy, Suspense, useLayoutEffect, useMemo, useRef } from 'react'
import { lampSource } from '../registry'
import { usePlateMode } from '../hooks'
import { noteRender, readings } from '../engine'
import { overlay } from '../lamps'
import { noteFocusGone, useQueue } from '../queue/state'
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
  // the optimistic overlay (C8): a card acted on clicks its lamp down in the same frame, until the reading agrees
  const pending = useQueue((s) => s.pending)
  const undone = useQueue((s) => s.undone)
  const shown = useMemo(() => {
    if (!ready) return fromLast(last)
    if (!pending.length && !undone.length) return views
    const r = readings()
    return overlay(views, pending, undone, (lamp, id) => !!r[lamp]?.ids.includes(id))
  }, [ready, views, last, pending, undone])
  if (mode === 'off') return null
  if (mode === 'strip') return <Strip views={shown} busy={!ready} />
  return <Full shown={shown} ready={ready} />
}

/**
 * The full plate with the queue and the aside. Unmounting with the keyboard inside (the last card went, the plate folds
 * to the strip in the same commit): it says so before its nodes go, and the strip's MASTER CAUTION takes the keyboard in
 * that commit — focus never rests on the body in between (D3, D4).
 */
function Full({ shown, ready }: { shown: LampView[]; ready: boolean }) {
  const below = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const b = below.current
    // the plate's section is drawn right before the queue and the aside
    const p = b?.previousElementSibling ?? null
    return () => {
      const a = document.activeElement
      if (a && a !== document.body && (b?.contains(a) || p?.contains(a))) noteFocusGone()
    }
  }, [])
  return (
    <>
      <Plate views={shown} busy={!ready} />
      <div ref={below} className="pf-below" data-testid="pf-below">
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

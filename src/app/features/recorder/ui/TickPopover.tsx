/**
 * A click on a tick: a Vorgang with one place opens it (a schema or view place opens its database); with more, a
 * popover lists up to 8 of them by their live title ("+ n more"). Titles come from the workspace now — the journal
 * holds none.
 */
import { useEffect, useState } from 'react'
import { Columns3, FileText, Rows3, Table2 } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { openPage } from '../../../lib/router'
import { Popover, pointAnchor } from '../../../ui/Popover'
import { opEvents } from '../journal/query'
import { parsePlace } from '../model/places'
import type { JOp, LaneKey, PlaceKey } from '../model/types'
import { hms, unit } from './format'

export interface TickAt {
  op: JOp
  x: number
  y: number
  lane: LaneKey
}

const MAX = 8

/** The page a place opens (a schema or a view: its database). */
export const pageOfPlace = (p: PlaceKey): string => parsePlace(p).id

export function TickPopover({ at, onClose }: { at: TickAt; onClose: () => void }) {
  const t = useT()
  const lang = useLang()
  const [places, setPlaces] = useState<PlaceKey[] | null>(null)

  useEffect(() => {
    let off = false
    if (at.op.n <= 1) {
      // one place: straight there
      openPage(pageOfPlace(at.op.p1))
      onClose()
      return
    }
    void opEvents(at.op)
      .then((evs) => {
        if (off) return
        const seen = new Set<PlaceKey>()
        for (const e of evs) seen.add(e.p)
        if (!seen.size) seen.add(at.op.p1)
        setPlaces([...seen])
      })
      .catch(() => !off && setPlaces([at.op.p1]))
    return () => {
      off = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [at])

  const pages = useWorkspace((s) => s.pages)
  if (!places) return null
  const shown = places.slice(0, MAX)
  return (
    <Popover open anchor={pointAnchor(at.x, at.y)} onClose={onClose} placement="top-start" className="rec-pop" role="dialog" aria-label={t('features.recorder.tick.title', { ops: unit(t, lang, 'places', places.length), time: hms(at.op.at) })}>
      <div className="rec-pop__h label">{t('features.recorder.tick.title', { ops: unit(t, lang, 'places', places.length), time: hms(at.op.at) })}</div>
      {shown.map((p) => {
        const pl = parsePlace(p)
        const page = pages[pl.id]
        const db = page?.title || '—'
        const title = !page ? t('features.recorder.tick.gone') : pl.kind === 'schema' ? t('features.recorder.tick.schema', { db }) : pl.kind === 'view' ? t('features.recorder.tick.view', { db }) : page.title || '—'
        const Icon = pl.kind === 'schema' ? Table2 : pl.kind === 'view' ? Columns3 : page?.databaseId ? Rows3 : FileText
        return (
          <button
            key={p}
            type="button"
            className="rec-pop__item"
            aria-disabled={!page || undefined}
            title={title}
            onClick={() => {
              if (!page) return
              openPage(pl.id)
              onClose()
            }}
          >
            <Icon aria-hidden />
            <span>{title}</span>
          </button>
        )
      })}
      {places.length > MAX && <div className="rec-pop__more">{t('features.recorder.tick.more', { n: places.length - MAX })}</div>}
    </Popover>
  )
}

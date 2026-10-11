/**
 * The lane filter: a ghost key "7/7" (tracks shown / all) that opens a checklist of every track this workspace's
 * tape knows, with "All". Hidden tracks are a per-device pref; the selected window's track always shows.
 */
import { useState } from 'react'
import { Check, ListFilter } from 'lucide-react'
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { Popover } from '../../../ui/Popover'
import { laneMeta, sortLanes } from './lanes'
import { setFilter, useRecorderUI } from './state'

export function LaneFilter({ all, compact }: { all: string[]; compact?: boolean }) {
  const t = useT()
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const hidden = useRecorderUI((s) => s.filter) ?? []
  const ws = useWorkspace.getState()
  const metas = sortLanes(all.map((l) => laneMeta(l, t, ws)))
  const shown = all.filter((l) => !hidden.includes(l)).length
  const toggle = (lane: string) => setFilter(hidden.includes(lane) ? hidden.filter((l) => l !== lane) : [...hidden, lane])
  return (
    <>
      <button
        type="button"
        className="tkey tkey--ghost"
        aria-label={t('features.recorder.deck.filterAria', { shown, all: all.length })}
        title={t('features.recorder.deck.filterAria', { shown, all: all.length })}
        aria-expanded={!!anchor}
        aria-haspopup="dialog"
        onClick={(e) => setAnchor(anchor ? null : e.currentTarget)}
      >
        <ListFilter aria-hidden />
        {!compact && t('features.recorder.deck.filter', { shown, all: all.length })}
      </button>
      {anchor && (
        <Popover open anchor={anchor} onClose={() => setAnchor(null)} placement="top-end" className="rec-pop" role="dialog" aria-label={t('features.recorder.filter.title')}>
          <div className="rec-pop__h label">{t('features.recorder.filter.title')}</div>
          <button type="button" role="checkbox" className="rec-pop__item" aria-checked={hidden.length === 0} onClick={() => setFilter(hidden.length ? null : all.filter((l) => l !== 'you'))}>
            <span className="rec-pop__check">{hidden.length === 0 && <Check aria-hidden />}</span>
            <span>{t('features.recorder.filter.all')}</span>
          </button>
          <div className="rec-pop__sep" />
          {metas.map((m) => {
            const on = !hidden.includes(m.lane)
            return (
              <button key={m.lane} type="button" role="checkbox" className="rec-pop__item" aria-checked={on} title={m.title} onClick={() => toggle(m.lane)}>
                <span className="rec-pop__check">{on && <Check aria-hidden />}</span>
                <span>{m.title}</span>
              </button>
            )
          })}
        </Popover>
      )}
    </>
  )
}

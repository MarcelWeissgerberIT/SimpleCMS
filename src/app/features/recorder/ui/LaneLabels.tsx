/**
 * The track labels beside the tape: the visible day over the ruler, then per track its icon (members: initials),
 * name and sub ("Agent · Nordlicht-Spiegel"), the phone's short name, and its Vorgänge in the visible span.
 */
import { memo } from 'react'
import { useLang, useT } from '../../../i18n'
import type { LaneMeta } from './lanes'
import { count2, fmtDayShort } from './format'

export const LaneLabels = memo(function LaneLabels({ lanes, counts, day, selected }: { lanes: LaneMeta[]; counts: Record<string, number>; day: number; selected: string | null }) {
  const t = useT()
  const lang = useLang()
  return (
    <div className="trks" aria-hidden="true">
      <div className="trks__ruler">
        <span className="label">{fmtDayShort(t, lang, day)}</span>
      </div>
      {lanes.map((m) => {
        const Icon = m.icon
        return (
          <div key={m.lane} className="trk" data-sel={selected === m.lane ? '' : undefined} title={m.title}>
            {Icon ? <Icon aria-hidden /> : <span className="trk__av">{m.initials}</span>}
            <span className="trk__n">
              <span className="trk__long">
                {m.name}
                {m.sub && <small> · {m.sub}</small>}
              </span>
              <span className="trk__short">{m.short}</span>
            </span>
            <span className="trk__c">{count2(counts[m.lane] ?? 0)}</span>
          </div>
        )
      })}
    </div>
  )
})

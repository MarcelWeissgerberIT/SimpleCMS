/**
 * Per-field trust — one key on the plate: its field and type, the meter with "15/20", the lamp and the row note
 * (§3.4 of the design: the first rule that applies). S1 is read only: no switch yet.
 */
import { useT, useLang } from '../../../../i18n'
import { titleIfClipped } from '../../../../ui/clip'
import type { Lang } from '@/shared/i18n'
import { meterLabel, noteOf } from '../rules'
import { GRANTS, type PlateRow } from '../plate'
import { TrustMeter } from './TrustMeter'
import { TrustLamp } from './TrustLamp'

const pad = (n: number) => String(n).padStart(2, '0')

/** Dates in the notes: "07.10." / "Oct 7"; times: "09:14" today, else "07.10. 09:14" / "Oct 7, 09:14". */
export function noteFmt(lang: Lang, now = Date.now()): { date: (ms: number) => string; time: (ms: number) => string } {
  const en = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric' })
  const date = (ms: number) => {
    const d = new Date(ms)
    return lang === 'de' ? `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.` : en.format(d)
  }
  const clock = (ms: number) => {
    const d = new Date(ms)
    return `${pad(d.getHours())}:${pad(d.getMinutes())}`
  }
  const today = new Date(now).toDateString()
  return { date, time: (ms) => (new Date(ms).toDateString() === today ? clock(ms) : `${date(ms)}${lang === 'de' ? '' : ','} ${clock(ms)}`) }
}

export function TrustRow({ row, lesson, now, noteId }: { row: PlateRow; lesson?: number | null; now: number; noteId: string }) {
  const t = useT()
  const lang = useLang()
  const note = noteOf({ r: row.r, granted: row.granted, effective: row.effective, entries: row.entries, lesson, now, fmt: noteFmt(lang, now) })
  return (
    <li className="agt-row" data-lamp={row.lamp} data-key={row.key} data-testid="agt-row">
      <span className="agt-row__name">
        <b onMouseEnter={titleIfClipped}>{row.label.name}</b>
        {row.label.kind && <span className="label agt-row__kind">{row.label.kind}</span>}
      </span>
      <TrustLamp lamp={GRANTS ? row.lamp : 'review'} />
      <span className="agt-row__meter">
        <TrustMeter segs={row.r.segs} label={meterLabel(row.r, t)} />
        <span className="agt-row__cnt" aria-hidden="true">
          {row.r.green}
          <small>/20</small>
        </span>
      </span>
      <span className="agt-row__note" id={noteId}>
        {t(note.key, note.vars)}
      </span>
    </li>
  )
}

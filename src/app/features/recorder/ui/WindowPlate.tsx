/**
 * The window plate (R1): without a window, how to bracket one; with one, its writer, its range (the end shown
 * inclusive — the window is half-open) and its meters: Vorgänge · Stellen · Wörter, then Zeilen (neu) · Seiten ·
 * Schema (+ views). Counted from the window's events ("…" while they load). R2 adds reading and the report, R3 the
 * eject.
 */
import { useEffect, useState } from 'react'
import { Info, X } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import { scopeNow } from '../journal/scope'
import { eventsOf } from '../journal/query'
import { windowMeters, type Meters } from '../model/counts'
import type { JRun } from '../model/types'
import type { LaneMeta } from './lanes'
import { fmtNum, hms, pl } from './format'
import { setBracket, useRecorderUI, type Bracket } from './state'
import { Kbd } from '../../../ui/controls'

export function WindowPlate({ bracket, meta, run, notes }: { bracket: Bracket | null; meta: LaneMeta | null; run: JRun | undefined; notes: string[] }) {
  const t = useT()
  const lang = useLang()
  const laneOps = useRecorderUI((s) => (bracket ? s.ops.lanes[bracket.lane] : undefined))
  const [m, setM] = useState<{ key: string; meters: Meters } | null>(null)
  const key = bracket ? `${bracket.lane}|${bracket.run ?? ''}|${bracket.a}|${bracket.b}` : ''

  useEffect(() => {
    if (!bracket) return
    let off = false
    const id = setTimeout(() => {
      const who = bracket.run ? { run: bracket.run } : { lane: bracket.lane }
      void eventsOf(scopeNow(), who, bracket.a, bracket.b)
        .then((evs) => !off && setM({ key, meters: windowMeters(evs, who, bracket.a, bracket.b) }))
        .catch(() => undefined)
    }, 120)
    return () => {
      off = true
      clearTimeout(id)
    }
    // the lane's ops changing (a push) re-counts
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, laneOps])

  const Note = () =>
    notes.length ? (
      <>
        {notes.map((n) => (
          <div key={n} className="win__note">
            <Info aria-hidden />
            <span>{n}</span>
          </div>
        ))}
      </>
    ) : null

  if (!bracket || !meta) {
    return (
      <aside className="win" aria-label={t('features.recorder.win.aria')}>
        <div className="win__h">
          <span className="label">{t('features.recorder.win.title')}</span>
        </div>
        <div className="win__note">
          <span>{t('features.recorder.win.none')}</span>
        </div>
        <div className="win__note">
          <span>
            <Kbd>[</Kbd> <Kbd>]</Kbd> {t('features.recorder.win.keys')}
          </span>
        </div>
        <Note />
      </aside>
    )
  }

  const meters = m && m.key === key ? m.meters : null
  const n = (v: number | undefined) => (meters ? fmtNum(v ?? 0, lang) : '…')
  const Icon = meta.icon
  const seq = run?.meta?.seq
  const p = meters?.places
  return (
    <aside className="win" aria-label={t('features.recorder.win.aria')}>
      <div className="win__h">
        <span className="label">{t('features.recorder.win.title')}</span>
        <span className="win__t">{t('features.recorder.win.range', { from: hms(bracket.a), to: hms(bracket.b - 1000) })}</span>
        <button type="button" className="win__x" aria-label={t('features.recorder.win.clear')} title={t('features.recorder.win.clear')} onClick={() => setBracket(null)}>
          <X aria-hidden />
        </button>
      </div>
      <div className="win__who" title={meta.title}>
        {Icon ? <Icon aria-hidden /> : null}
        <span>{meta.title}</span>
        {seq ? <small>{t('features.recorder.win.run', { n: seq })}</small> : null}
      </div>
      <div className="mtrs" aria-live="polite">
        <div className="mtr">
          <b>{n(meters?.ops)}</b>
          <span>{t(pl('features.recorder.win.meter.ops', meters?.ops ?? 0))}</span>
        </div>
        <div className="mtr">
          <b>{n(p?.all)}</b>
          <span>{t(pl('features.recorder.win.meter.places', p?.all ?? 0))}</span>
        </div>
        <div className="mtr">
          <b>{meters ? `+${fmtNum(meters.words[0], lang)} −${fmtNum(meters.words[1], lang)}` : '…'}</b>
          <span>{t('features.recorder.win.meter.words')}</span>
        </div>
        <div className="mtr">
          <b>
            {n(p?.rows)}
            {p && p.newRows > 0 && <em>{t('features.recorder.win.meter.new', { n: fmtNum(p.newRows, lang) })}</em>}
          </b>
          <span>{t(pl('features.recorder.win.meter.rows', p?.rows ?? 0))}</span>
        </div>
        <div className="mtr">
          <b>{n(p?.pages)}</b>
          <span>{t(pl('features.recorder.win.meter.pages', p?.pages ?? 0))}</span>
        </div>
        <div className="mtr">
          <b>
            {n(p?.schema)}
            {p && p.views > 0 && <em>{t(pl('features.recorder.win.meter.views', p.views), { n: fmtNum(p.views, lang) })}</em>}
          </b>
          <span>{t(pl('features.recorder.win.meter.schemas', p?.schema ?? 0))}</span>
        </div>
      </div>
      <Note />
    </aside>
  )
}

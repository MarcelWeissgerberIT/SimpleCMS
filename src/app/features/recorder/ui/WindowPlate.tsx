/**
 * The window plate (R1): without a window, how to bracket one; with one, its writer, its range (the end shown
 * inclusive — the window is half-open) and its meters: Vorgänge · Stellen · Wörter, then Zeilen (neu) · Seiten ·
 * Schema (+ views). Counted from the window's events ("…" while they load). Two keys set the window's start / end
 * at the playhead on the focused track ([ and ] — the way to bracket by touch, where a drag scrolls the tape). R2 adds
 * reading and the report, R3 the eject.
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
import { bracketEdge } from './actions'
import { setBracket, useRecorderUI, type Bracket } from './state'
import { Kbd } from '../../../ui/controls'
import type { ProviderId } from '@/shared/ai/types'
import { isRouteKey } from '@/shared/ai/route'
import { providerLabel } from '@/shared/ai/models'
import { isJevRouter } from '@/shared/ai/jev'
import { servedLabel } from '../../ai/core/registry'

/** The window's start / end at the playhead, on the track the keys act on. */
function EdgeKeys({ lane }: { lane: LaneMeta }) {
  const t = useT()
  return (
    <div className="win__edges">
      <button type="button" className="tkey" title={t('features.recorder.win.startTitle', { lane: lane.title })} onClick={() => bracketEdge('start', lane.lane)}>
        <Kbd>[</Kbd>
        <span>{t('features.recorder.win.start')}</span>
      </button>
      <button type="button" className="tkey" title={t('features.recorder.win.endTitle', { lane: lane.title })} onClick={() => bracketEdge('end', lane.lane)}>
        <Kbd>]</Kbd>
        <span>{t('features.recorder.win.end')}</span>
      </button>
    </div>
  )
}

/** After the window is cleared (its key is gone): the playhead takes focus — the tape's keys go on working. */
function clearWindow(): void {
  setBracket(null)
  requestAnimationFrame(() => document.querySelector<HTMLElement>('section.deck .playhead__h')?.focus({ preventScroll: true }))
}

export function WindowPlate({ bracket, meta, run, notes, touch, edgeLane }: { bracket: Bracket | null; meta: LaneMeta | null; run: JRun | undefined; notes: string[]; touch: boolean; edgeLane: LaneMeta }) {
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
          <span>{t(touch ? 'features.recorder.win.noneTouch' : 'features.recorder.win.none')}</span>
        </div>
        <EdgeKeys lane={edgeLane} />
        <Note />
      </aside>
    )
  }

  const meters = m && m.key === key ? m.meters : null
  const n = (v: number | undefined) => (meters ? fmtNum(v ?? 0, lang) : '…')
  const Icon = meta.icon
  const seq = run?.meta?.seq
  const via = viaLine(t, run?.meta)
  const p = meters?.places
  return (
    <aside className="win" aria-label={t('features.recorder.win.aria')}>
      <div className="win__h">
        <span className="label">{t('features.recorder.win.title')}</span>
        <span className="win__t">{t('features.recorder.win.range', { from: hms(bracket.a), to: hms(bracket.b - 1000) })}</span>
        <button type="button" className="win__x" aria-label={t('features.recorder.win.clear')} title={t('features.recorder.win.clear')} onClick={clearWindow}>
          <X aria-hidden />
        </button>
      </div>
      <div className="win__who" title={meta.title}>
        {Icon ? <Icon aria-hidden /> : null}
        <span>{meta.title}</span>
        {seq ? <small>{t('features.recorder.win.run', { n: seq })}</small> : null}
      </div>
      {via ? (
        <p className="win__via" data-testid="rec-via" title={via}>
          {via}
        </p>
      ) : null}
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
      <EdgeKeys lane={edgeLane} />
      <Note />
    </aside>
  )
}

/**
 * The AI route a run's writes came from (RunMeta.ai — route keys only): "via Claude Sonnet 5.5" (Claude's labels name
 * it), "via OpenRouter · <model>", the Jev Router "via OpenRouter · Jev Router → <the model it chose>".
 */
function viaLine(t: (k: string, v?: Record<string, string | number>) => string, meta: JRun['meta'] | undefined): string | null {
  const key = meta?.ai
  if (!key || !isRouteKey(key)) return null
  const route = keyRoute(key)
  const label = servedLabel(route.p, route.m)
  if (route.p === 'openrouter' && (meta.aiAlso ?? []).some((k) => isRouteKey(k) && isJevRouter(keyRoute(k).m))) return t('features.recorder.viaRouter', { model: label })
  return t('features.recorder.via', { route: route.p === 'anthropic' ? label : `${providerLabel(route.p)} · ${label}` })
}

/** A checked route key → its provider and model (the provider is the part before the first ':'). */
function keyRoute(key: string): { p: ProviderId; m: string } {
  const i = key.indexOf(':')
  return { p: key.slice(0, i) as ProviderId, m: key.slice(i + 1) }
}

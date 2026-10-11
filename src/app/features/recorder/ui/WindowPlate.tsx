/**
 * The window plate: without a window, how to bracket one; with one, its writer, its range (the end shown inclusive —
 * the window is half-open) and its meters: Vorgänge · Stellen · Wörter, then Zeilen (neu) · Seiten · Schema (+ views),
 * counted from the window's events ("…" while they load). R2: the held check (debounced; the rows someone changed
 * since — a note here, diamonds on the tape), notes for a window that is possibly incomplete or cuts a writer's
 * stretch (with the key that extends it), and the keys "Fenster lesen" (↵) and "Bericht". Two keys set the window's
 * start / end at the playhead on the focused track ([ and ] — the way to bracket by touch). The eject comes with R3.
 */
import { useEffect, useRef, useState } from 'react'
import { FileDiff, FileDown, Info, X } from 'lucide-react'
import { useLang, useT } from '../../../i18n'
import type { Translate } from '@/shared/i18n'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../../store/store'
import { scopeNow } from '../journal/scope'
import { eventsOf } from '../journal/query'
import { windowMeters, type Meters } from '../model/counts'
import type { JRun, LaneKey } from '../model/types'
import type { ReadModel } from '../window/read'
import { laneMeta, type LaneMeta } from './lanes'
import { fmtNum, hm, hms, pl, unit } from './format'
import { bracketEdge } from './actions'
import { say } from './live'
import { openRead, setBracket, setHeld, useRecorderUI, type Bracket } from './state'
import { Kbd } from '../../../ui/controls'
import { Bold, BOLD } from './bold'

const HELD_DEBOUNCE_MS = 150

/** The reading (window/read.ts and the report) loads with the first window, never with the deck's first paint. */
const reading = () => import('../window/read')

/** A key of a window (the held check and the read dialog belong to it). */
export const windowKey = (b: Bracket): string => `${b.lane}|${b.run ?? ''}|${b.a}|${b.b}`

/** The read window of the bracket, kept fresh (150 ms after the bracket or the tape changed); held → the store. */
function useReadModel(bracket: Bracket | null): ReadModel | null {
  const t = useT()
  const lang = useLang()
  const rev = useRecorderUI((s) => s.ops.rev)
  const [model, setModel] = useState<{ key: string; m: ReadModel } | null>(null)
  const said = useRef('')
  const key = bracket ? windowKey(bracket) : ''
  useEffect(() => {
    if (!bracket) return
    let off = false
    const id = setTimeout(() => {
      const t0 = performance.now()
      reading()
        .then(async ({ readWindow, heldMarks, heldWho }) => {
          const m = await readWindow({ scope: scopeNow(), lane: bracket.lane, ...(bracket.run ? { run: bracket.run } : {}), a: bracket.a, b: bracket.b }, rev)
          if (off) return
          try {
            performance.measure('rec-read', { start: t0, end: performance.now() })
          } catch {
            /* no marks */
          }
          setModel({ key, m })
          setHeld({ key, marks: heldMarks(m), count: m.held.length, who: heldWho(m) })
          // said once per window and count (pushes of the tape re-read it)
          const n = m.held.length
          if (n && said.current !== `${key}|${n}`) say(t(pl('features.recorder.live.held', n), { n: fmtNum(n, lang) }))
          said.current = `${key}|${n}`
        })
        .catch((e) => console.warn('[recorder] the window could not be read', e))
    }, HELD_DEBOUNCE_MS)
    return () => {
      off = true
      clearTimeout(id)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key, rev])
  return model && model.key === key ? model.m : null
}

/** Who changed something since, in a sentence ("du", "Agent · Nordlicht-Spiegel", "nicht aufgezeichnet"); `cap`: as a name
 * on its own ("Du 07:44"). */
export function whoName(lane: LaneKey | null, t: Translate, ws: Parameters<typeof laneMeta>[2], cap = false): string {
  const up = (s: string) => (cap ? s.charAt(0).toLocaleUpperCase() + s.slice(1) : s)
  if (lane === null) return up(t('features.recorder.who.unrecorded'))
  if (lane === 'you') return up(t('features.recorder.who.you'))
  const m = laneMeta(lane, t, ws)
  return lane.startsWith('member:') ? m.short : m.title
}


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
  const rev = useRecorderUI((s) => s.ops.rev)
  const model = useReadModel(bracket)
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
      <ReadNotes bracket={bracket} model={model} />
      <div className="win__keys">
        <button type="button" className="dbtn dbtn--read" onClick={openRead} title={t('features.recorder.win.read')}>
          <FileDiff aria-hidden />
          <span>{t('features.recorder.win.read')}</span>
          <Kbd>↵</Kbd>
        </button>
        <button type="button" className="dbtn dbtn--report" onClick={() => void report(bracket, rev)} title={t('features.recorder.win.report')}>
          <FileDown aria-hidden />
          <span>{t('features.recorder.win.report')}</span>
        </button>
      </div>
      <EdgeKeys lane={edgeLane} />
      <Note />
    </aside>
  )
}

/** The report of the selected window (the read model is memoised: usually there already). */
async function report(b: Bracket, rev: number): Promise<void> {
  const [{ readWindow }, { downloadReport }] = await Promise.all([reading(), import('./report')])
  const m = await readWindow({ scope: scopeNow(), lane: b.lane, ...(b.run ? { run: b.run } : {}), a: b.a, b: b.b }, rev)
  await downloadReport(m)
}

/** The held note (diamond swatch), "possibly incomplete", "partly" with the key that extends the bracket. */
function ReadNotes({ bracket, model }: { bracket: Bracket; model: ReadModel | null }) {
  const t = useT()
  const lang = useLang()
  const held = useRecorderUI((s) => (s.held && s.held.key === windowKey(bracket) ? s.held : null))
  const ws = useWorkspace(useShallow((s) => ({ agents: s.agents, scripts: s.scripts, databases: s.databases, settings: s.settings })))
  if (!model) return null
  const n = held?.count ?? 0
  const rowsOnly = model.held.every((v) => v.pk === 'row')
  const what = rowsOnly ? unit(t, lang, 'rows', n) : unit(t, lang, 'places', n)
  const who = (held?.who ?? []).map((l) => whoName(l, t, ws)).join(', ')
  const ext = model.extendTo
  return (
    <>
      {n > 0 && (
        <div className="win__note win__note--held">
          <span className="held-sw" aria-hidden="true" />
          <span>
            <Bold text={t(pl('features.recorder.win.held', n), { rows: BOLD, who })} bold={what} />
          </span>
        </div>
      )}
      {model.incomplete && (
        <div className="win__note">
          <Info aria-hidden />
          <span>{t('features.recorder.win.incomplete')}</span>
        </div>
      )}
      {model.tooMany && (
        <div className="win__note">
          <Info aria-hidden />
          <span>{t('features.recorder.win.tooMany', { n: fmtNum(5000, lang), shown: fmtNum(2000, lang) })}</span>
        </div>
      )}
      {model.partial.length > 0 && (
        <div className="win__note">
          <Info aria-hidden />
          <span>{t('features.recorder.win.partial', { places: unit(t, lang, 'places', model.partial.length) })}</span>
        </div>
      )}
      {ext && (
        <button type="button" className="dbtn dbtn--extend" onClick={() => setBracket({ ...bracket, a: ext.a, b: ext.b })}>
          <span>{bracket.run ? t('features.recorder.win.extendRun') : t('features.recorder.win.extend', { time: `${hm(ext.a)}–${hm(ext.b)}` })}</span>
        </button>
      )}
    </>
  )
}

/**
 * The flight recorder's marks in the database views (R3, mock-3), from the eject this deck just made (gone with the
 * deck or the next eject): a row it held — "Gehalten · du 07:44" (and "Status kam von Agent · … — selbst prüfen." when
 * the writer's values stayed) — and an option that came back — its board column "Zurück · 08:05". Keys: `p:<rowId>`,
 * `o:<db>/<prop>/<opt>`. Light: the database views import it through the public API.
 */
import { currentLang, t } from '../../../i18n'
import { useRecorderUI, type LastEject } from './state'
import './marks.css'

export interface RecorderMark {
  held?: { tag: string; note: string | null }
  back?: { tag: string }
}

const two = (n: number) => String(n).padStart(2, '0')
const hm = (at: number) => {
  const d = new Date(at)
  return `${two(d.getHours())}:${two(d.getMinutes())}`
}

const cache = new WeakMap<LastEject, { lang: string; marks: Map<string, RecorderMark> }>()

function marksOf(e: LastEject, lang: string): Map<string, RecorderMark> {
  const hit = cache.get(e)
  if (hit && hit.lang === lang) return hit.marks
  const marks = new Map<string, RecorderMark>()
  for (const h of e.held)
    marks.set(h.p, {
      held: {
        tag: t('features.recorder.board.held', { who: h.whoLabel, time: hm(h.at) }),
        note: h.props.length ? t('features.recorder.board.heldNoteBy', { props: h.props.join(', '), writer: e.writer }) : null,
      },
    })
  for (const o of e.options) marks.set(o, { back: { tag: t('features.recorder.board.back', { time: hm(e.at) }) } })
  cache.set(e, { lang, marks })
  return marks
}

/** The mark of a row (`p:<id>`) or an option (`o:<db>/<prop>/<opt>`) — null: none. */
export function useRecorderMark(key: string): RecorderMark | null {
  return useRecorderUI((s) => (s.lastEject ? (marksOf(s.lastEject, currentLang()).get(key) ?? null) : null))
}

/** The database strip after an eject (Δ24): only the database the last eject wrote into. */
export function useRecorderDbEject(dbId: string): { at: number } | null {
  return useRecorderUI((s) => (s.lastEject && s.lastEject.dbIds.includes(dbId) ? s.lastEject : null))
}

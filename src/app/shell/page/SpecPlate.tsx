import type { ReactNode } from 'react'
import { useWorkspace } from '../../store/store'
import { useLang, useT } from '../../i18n'
import type { Page } from '../../store/types'
import { useRowCount } from '../../store/selectors'
import { fmtNumber, fmtRelative, fmtStamp, plural, readingTime, wordCount } from '../lib/format'
import { useNow } from '../lib/hooks'
import { agentLabel } from '../../features'

/** "ABCD·1234": the short, readable form of a page id. */
const shortId = (id: string) => `${id.slice(0, 4).toUpperCase()}·${id.slice(4, 8).toUpperCase()}`

/** "03 OCT 2026 · 14:05": narrow plates drop the time (CSS), never cut the date. */
function Stamp({ ts }: { ts: number }) {
  const lang = useLang()
  const [day, time] = fmtStamp(ts, lang).split(' · ')
  return (
    <>
      {day}
      {time && <span className="spec__time"> · {time}</span>}
    </>
  )
}

/** Words, reading time and last edit of a page. */
function usePageReadings(page: Page): { words: string; read: string; edited: string } {
  const t = useT()
  const lang = useLang()
  useNow(30_000)
  const words = page.kind === 'database' ? 0 : wordCount(page.plain)
  return {
    words: fmtNumber(words, lang),
    read: words ? t('shell.stats.minutes', { n: readingTime(words) }) : '—',
    edited: fmtRelative(page.updatedAt, lang, t('shell.time.justNow')).toUpperCase(),
  }
}

/**
 * Who changed the page last: a member's name (team), "Agent · <name>", API or webhook — null locally
 * (`page.updatedBy` is absent there) and when the person is unknown.
 */
function useLastEditor(page: Page): string | null {
  const t = useT()
  const id = page.updatedBy
  const person = useWorkspace((s) => (id ? s.people.find((p) => p.id === id)?.name : undefined))
  if (!id) return null
  const agent = agentLabel(id)
  if (agent) return agent
  if (id.startsWith('api:')) return t('shell.spec.byApi')
  if (id.startsWith('hook:')) return t('shell.spec.byWebhook')
  return person?.trim() || null
}

/** The instrument "rating plate" at the end of every page (the margin rail never repeats it). */
export function SpecPlate({ page }: { page: Page }) {
  const t = useT()
  const lang = useLang()
  const readings = usePageReadings(page)
  const by = useLastEditor(page)
  const isDb = page.kind === 'database'
  const db = useWorkspace((s) => (isDb ? s.databases[page.id] : undefined))
  const rows = useRowCount(isDb ? page.id : null)
  const cells: Array<[string, ReactNode]> = [
    [t('shell.spec.created'), <Stamp ts={page.createdAt} />],
    [
      t('shell.spec.edited'),
      <>
        {readings.edited}
        {by && <span className="spec__by">{t('shell.spec.by', { name: by })}</span>}
      </>,
    ],
    ...(isDb
      ? ([
          [t('shell.spec.rows'), fmtNumber(rows, lang)],
          [t('shell.spec.fields'), `${db?.properties.length ?? 0} · ${t(plural('shell.spec.views', db?.views.length ?? 0), { n: db?.views.length ?? 0 })}`],
        ] as Array<[string, ReactNode]>)
      : ([
          [t('shell.spec.words'), readings.words],
          [t('shell.spec.read'), readings.read],
        ] as Array<[string, ReactNode]>)),
  ]
  return (
    <div className="spec" aria-label={t('shell.spec.label')}>
      <span className="spec__screw spec__screw--tl" aria-hidden />
      <span className="spec__screw spec__screw--tr" aria-hidden />
      <span className="spec__screw spec__screw--bl" aria-hidden />
      <span className="spec__screw spec__screw--br" aria-hidden />
      <div className="spec__head">
        <span>{isDb ? t('shell.spec.database') : page.databaseId ? t('shell.spec.entry') : t('shell.spec.page')}</span>
        <span className="spec__id">
          ID {shortId(page.id)}
          {!isDb && <> · REV {String(page.contentRev).padStart(2, '0')}</>}
        </span>
      </div>
      <dl className="spec__grid">
        {cells.map(([k, v]) => (
          <div key={k} className="spec__cell">
            <dt>{k}</dt>
            <dd>{v}</dd>
          </div>
        ))}
      </dl>
    </div>
  )
}

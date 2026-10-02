import { useWorkspace } from '../../store/store'
import { useLang, useT } from '../../i18n'
import type { Page } from '../../store/types'
import { fmtNumber, fmtRelative, fmtStamp, plural, readingMinutes, wordCount } from '../lib/format'
import { useNow } from '../lib/hooks'

/** The instrument "rating plate" at the end of every page. */
export function SpecPlate({ page }: { page: Page }) {
  const t = useT()
  const lang = useLang()
  useNow(30_000)
  const isDb = page.kind === 'database'
  const db = useWorkspace((s) => (isDb ? s.databases[page.id] : undefined))
  const rows = useWorkspace((s) => {
    if (!isDb) return 0
    let n = 0
    for (const p of Object.values(s.pages)) if (p.databaseId === page.id && !p.trashed) n++
    return n
  })
  const words = isDb ? 0 : wordCount(page.plain)
  const cells: Array<[string, string]> = [
    [t('shell.spec.created'), fmtStamp(page.createdAt, lang)],
    [t('shell.spec.edited'), fmtRelative(page.updatedAt, lang, t('shell.time.justNow')).toUpperCase()],
    ...(isDb
      ? ([
          [t('shell.spec.rows'), fmtNumber(rows, lang)],
          [t('shell.spec.fields'), `${db?.properties.length ?? 0} · ${t(plural('shell.spec.views', db?.views.length ?? 0), { n: db?.views.length ?? 0 })}`],
        ] as Array<[string, string]>)
      : ([
          [t('shell.spec.words'), fmtNumber(words, lang)],
          [t('shell.spec.read'), t('shell.stats.minutes', { n: readingMinutes(words) })],
        ] as Array<[string, string]>)),
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
          ID {page.id.slice(0, 4).toUpperCase()}·{page.id.slice(4, 8).toUpperCase()}
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

/**
 * "What's new" in the Help panel (lazy chunk, with the manual): the strip at the top of the panel's home,
 * the list (newest first) and an entry — its picture (click → a larger one), the text, the "Try it" key
 * and the related articles. Opening the list (or an entry) marks everything up to the newest as seen.
 */
import { useEffect, useState, type MouseEvent } from 'react'
import { ArrowLeft, ArrowRight, Maximize2 } from 'lucide-react'
import { useLang, useT } from '../../i18n'
import { resolveAssetUrl } from '../../lib/files'
import { shortcutLabel } from '../../ui/controls'
import { CHANGELOG, LIBRARY } from '../content'
import { Doc } from '../Doc'
import { findArticle, type HelpArticle } from '../library'
import { goHelp } from '../state'
import { changelogPublicUrl } from '../urls'
import { ArticleRow, useDocNav } from '../views'
import { entryDateLabel, entryNeighbours, findEntry, type ChangelogEntry } from './entries'
import { Lightbox } from './Lightbox'
import { isUnseen, markChangelogSeen, readChangelogSeen, useChangelogUnseen } from './seen'
import { runTry, TRY_SHORTCUT } from './try'
import './changelog.css'

/** A plain click opens the entry in the panel; ⌘/Ctrl/middle click keeps the link (the public page). */
const panelClick = (go: () => void) => (e: MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  go()
}

const openEntry = (id: string) => goHelp({ kind: 'change', id })
const openList = () => goHelp({ kind: 'changelog' })

/** "Fig. 07": entries are numbered from the oldest, so a number never changes when new ones arrive. */
const figNum = (index: number, total: number) => String(total - index).padStart(2, '0')

function useEntries(): ChangelogEntry[] {
  const lang = useLang()
  return CHANGELOG[lang]
}

/** Entries newer than the one this device had opened when the view appeared (none on a first visit). */
function useNewSince(entries: ChangelogEntry[]): (e: ChangelogEntry) => boolean {
  const [seen] = useState(readChangelogSeen)
  if (!seen) return () => false
  const at = entries.findIndex((e) => e.id === seen)
  return (e) => (at >= 0 ? entries.indexOf(e) < at : isUnseen(e.id, seen))
}

function Thumb({ entry, className }: { entry: ChangelogEntry; className: string }) {
  return (
    <span className={className} aria-hidden>
      <img src={resolveAssetUrl(entry.image)} alt="" loading="lazy" decoding="async" draggable={false} />
    </span>
  )
}

function NewMark() {
  const t = useT()
  return (
    <span className="cl-new">
      <span className="led led--on" aria-hidden />
      {t('help.news.new')}
    </span>
  )
}

/* ------------------------------------------------------------------ */
/* Home: the strip at the top of the panel                              */
/* ------------------------------------------------------------------ */

export function NewsStrip() {
  const t = useT()
  const lang = useLang()
  const entries = useEntries()
  const unseen = useChangelogUnseen()
  if (!entries.length) return null
  const [first, ...rest] = entries
  return (
    <section className="cl-strip" aria-labelledby="cl-strip-h" data-testid="help-news">
      <h3 className="help-chap__head" id="cl-strip-h">
        <button type="button" className="help-chap__btn" onClick={openList}>
          <span className="help-chap__num">§ 00</span>
          <span className="help-chap__name">{t('help.news.title')}</span>
          {unseen && <NewMark />}
          <span className="help-chap__rule" aria-hidden />
          <span className="label help-chap__count">{String(entries.length).padStart(2, '0')}</span>
        </button>
      </h3>
      <a className="cl-feature" href={changelogPublicUrl(lang, first.id)} data-entry={first.id} onClick={panelClick(() => openEntry(first.id))}>
        <Thumb entry={first} className="cl-feature__img" />
        <span className="cl-feature__main">
          <span className="label cl-date">
            <time dateTime={first.date}>{entryDateLabel(first.date, lang)}</time>
          </span>
          <span className="cl-feature__title">{first.title}</span>
          <span className="cl-feature__summary">{first.summary}</span>
        </span>
      </a>
      <ul className="help-list">
        {rest.slice(0, 2).map((e) => (
          <li key={e.id}>
            <a className="cl-line" href={changelogPublicUrl(lang, e.id)} data-entry={e.id} onClick={panelClick(() => openEntry(e.id))}>
              <time className="label cl-date" dateTime={e.date}>
                {entryDateLabel(e.date, lang)}
              </time>
              <span className="cl-line__title">{e.title}</span>
              <ArrowRight size={13} strokeWidth={1.75} className="help-row__go" aria-hidden />
            </a>
          </li>
        ))}
        <li>
          <a className="cl-line cl-line--all" href={changelogPublicUrl(lang)} onClick={panelClick(openList)}>
            <span className="label">{t('help.news.all')}</span>
            <span className="label cl-line__count">{String(entries.length).padStart(2, '0')}</span>
            <ArrowRight size={13} strokeWidth={1.75} className="help-row__go" aria-hidden />
          </a>
        </li>
      </ul>
    </section>
  )
}

/* ------------------------------------------------------------------ */
/* Breadcrumbs                                                          */
/* ------------------------------------------------------------------ */

function Crumbs({ entry }: { entry?: boolean }) {
  const t = useT()
  return (
    <nav className="help-crumbs label" aria-label={t('help.crumbs')}>
      <button type="button" className="help-crumbs__link" onClick={() => goHelp({ kind: 'home' })}>
        {t('help.home')}
      </button>
      {entry && (
        <>
          <span className="help-crumbs__sep" aria-hidden>
            /
          </span>
          <button type="button" className="help-crumbs__link" onClick={openList}>
            § 00 {t('help.news.title')}
          </button>
        </>
      )}
    </nav>
  )
}

/* ------------------------------------------------------------------ */
/* The list                                                             */
/* ------------------------------------------------------------------ */

export function ChangelogView() {
  const t = useT()
  const lang = useLang()
  const entries = useEntries()
  const isNew = useNewSince(entries)
  useEffect(() => markChangelogSeen(entries[0]?.id), [entries])
  const count = t(entries.length === 1 ? 'help.news.count.one' : 'help.news.count.other', { count: entries.length })
  return (
    <div className="help-art cl" data-testid="help-changelog">
      <Crumbs />
      <p className="label help-art__code">{t('help.news.spec', { count })}</p>
      <h3 className="help-art__title" tabIndex={-1} data-help-heading>
        {t('help.news.title')}
      </h3>
      <p className="help-art__summary">{t('help.news.lede')}</p>
      <ol className="cl-list">
        {entries.map((e, i) => (
          <li key={e.id}>
            <a className="cl-row" href={changelogPublicUrl(lang, e.id)} data-entry={e.id} onClick={panelClick(() => openEntry(e.id))}>
              <Thumb entry={e} className="cl-row__img" />
              <span className="cl-row__main">
                <span className="label cl-date">
                  <time dateTime={e.date}>{entryDateLabel(e.date, lang)}</time>
                  <span className="cl-row__fig" aria-hidden>
                    · {t('help.news.figure', { n: figNum(i, entries.length) })}
                  </span>
                  {isNew(e) && <NewMark />}
                </span>
                <span className="cl-row__title">{e.title}</span>
                <span className="cl-row__summary">{e.summary}</span>
              </span>
            </a>
          </li>
        ))}
      </ol>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* One entry                                                            */
/* ------------------------------------------------------------------ */

export function ChangeView({ id }: { id: string }) {
  const t = useT()
  const lang = useLang()
  const nav = useDocNav()
  const entries = useEntries()
  const [zoom, setZoom] = useState(false)
  const entry = findEntry(CHANGELOG, lang, id)
  useEffect(() => markChangelogSeen(entries[0]?.id), [entries])
  if (!entry)
    return (
      <div className="help-art">
        <Crumbs entry />
        <p className="help-empty">{t('help.news.none', { id })}</p>
      </div>
    )
  const index = entries.findIndex((e) => e.id === entry.id)
  const fig = t('help.news.figure', { n: figNum(Math.max(0, index), entries.length) })
  const related = entry.help.map((h) => findArticle(LIBRARY, lang, h)).filter((a): a is HelpArticle => !!a)
  const { newer, older } = entryNeighbours(CHANGELOG, lang, entry.id)
  const src = resolveAssetUrl(entry.image)
  const shortcut = entry.try ? TRY_SHORTCUT[entry.try] : undefined
  return (
    <article className="help-art cl-entry" data-entry={entry.id} lang={entry.lang}>
      <Crumbs entry />
      <p className="label help-art__code">
        <time dateTime={entry.date}>{entryDateLabel(entry.date, lang)}</time> · {fig}
      </p>
      <h3 className="help-art__title" tabIndex={-1} data-help-heading>
        {entry.title}
      </h3>
      {entry.summary && <p className="help-art__summary">{entry.summary}</p>}
      <figure className="cl-fig">
        <button type="button" className="cl-fig__btn" onClick={() => setZoom(true)} aria-haspopup="dialog" aria-label={`${t('help.news.enlarge')}: ${entry.alt}`}>
          <img className="cl-fig__img" src={src} alt={entry.alt} decoding="async" draggable={false} />
          <span className="cl-fig__zoom" aria-hidden>
            <Maximize2 size={13} strokeWidth={1.75} />
          </span>
        </button>
        <figcaption className="cl-fig__cap">
          <span className="label cl-fig__n">{fig}</span> {entry.alt}
        </figcaption>
      </figure>
      <Doc blocks={entry.blocks} nav={nav} />
      {entry.try && (
        <div className="cl-try" role="group" aria-label={t('help.news.try')}>
          <span className="label cl-try__label" aria-hidden>
            {t('help.news.try')}
          </span>
          <button type="button" className="btn btn--primary cl-try__btn" data-try={entry.try} onClick={() => runTry(entry.try!)}>
            {t(`help.news.try.${entry.try}`)}
            {shortcut && (
              <kbd className="kbd cl-try__kbd" aria-hidden>
                {shortcutLabel(shortcut)}
              </kbd>
            )}
          </button>
        </div>
      )}
      {related.length > 0 && (
        <section className="help-related" aria-labelledby="cl-related-h">
          <h4 className="label help-related__label" id="cl-related-h">
            {t('help.news.related')}
          </h4>
          <ul className="help-list">
            {related.map((r) => (
              <li key={r.id}>
                <ArticleRow a={r} />
              </li>
            ))}
          </ul>
        </section>
      )}
      {(newer || older) && (
        <nav className="help-pager" aria-label={t('help.news.more')}>
          {newer ? (
            <a className="help-pager__link" href={changelogPublicUrl(lang, newer.id)} data-entry={newer.id} onClick={panelClick(() => openEntry(newer.id))}>
              <span className="label">
                <ArrowLeft size={11} strokeWidth={2} aria-hidden /> {t('help.news.newer')} · {entryDateLabel(newer.date, lang)}
              </span>
              <span className="help-pager__title">{newer.title}</span>
            </a>
          ) : (
            <span />
          )}
          {older && (
            <a className="help-pager__link help-pager__link--next" href={changelogPublicUrl(lang, older.id)} data-entry={older.id} onClick={panelClick(() => openEntry(older.id))}>
              <span className="label">
                {t('help.news.older')} · {entryDateLabel(older.date, lang)} <ArrowRight size={11} strokeWidth={2} aria-hidden />
              </span>
              <span className="help-pager__title">{older.title}</span>
            </a>
          )}
        </nav>
      )}
      {zoom && <Lightbox src={src} alt={entry.alt} caption={`${fig} — ${entry.title}`} onClose={() => setZoom(false)} />}
    </article>
  )
}

/** The Manual tab of the Help panel: search field, index of chapters, a chapter, an article, results. */
import { useMemo, type KeyboardEvent, type MouseEvent, type RefObject } from 'react'
import { ArrowLeft, ArrowRight, CornerDownLeft, MessageSquareText, Search, X } from 'lucide-react'
import { useLang, useT } from '../i18n'
import { LIBRARY, searchHelp } from './content'
import { Doc, Marked, type DocNav } from './Doc'
import { findArticle, neighbours, relatedArticles, sectionArticles, type HelpArticle } from './library'
import { HELP_SECTIONS, sectionNum } from './sections'
import { currentLoc, goHelp, openHelp, useHelp } from './state'
import { helpPublicUrl } from './urls'

/** Article links: open in the panel; their address is the public page (new tab, copy link). */
export function useDocNav(): DocNav {
  const lang = useLang()
  return useMemo(() => ({ open: (id: string) => goHelp({ kind: 'article', id }), href: (id: string) => helpPublicUrl(lang, id) }), [lang])
}

/** A plain click opens the article in the panel; ⌘/Ctrl/middle click keeps the link's own behaviour. */
const panelClick = (go: () => void) => (e: MouseEvent) => {
  if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return
  e.preventDefault()
  go()
}

/* ------------------------------------------------------------------ */
/* Search field                                                        */
/* ------------------------------------------------------------------ */

export function SearchField({ inputRef }: { inputRef: RefObject<HTMLInputElement | null> }) {
  const t = useT()
  const lang = useLang()
  const query = useHelp((s) => s.query)

  const change = (v: string) => {
    useHelp.setState({ query: v })
    if (v.trim() && currentLoc(useHelp.getState()).kind !== 'search') goHelp({ kind: 'search' })
  }
  const clear = () => {
    useHelp.setState({ query: '' })
    goHelp({ kind: 'home' })
    inputRef.current?.focus()
  }
  const onKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && query.trim()) {
      e.preventDefault()
      const [first] = searchHelp(LIBRARY, lang, query, 1)
      if (first) goHelp({ kind: 'article', id: first.article.id })
      else openHelp({ tab: 'ask', question: query, run: true })
    }
    if (e.key === 'ArrowDown') {
      const row = document.querySelector<HTMLElement>('.help-scroll .help-row, .help-scroll .help-hit')
      if (row) {
        e.preventDefault()
        row.focus()
      }
    }
  }

  return (
    <div className="help-search" role="search">
      <Search size={14} strokeWidth={1.75} className="help-search__icon" aria-hidden />
      <input
        ref={inputRef}
        className="help-search__input"
        type="search"
        data-help-autofocus=""
        value={query}
        placeholder={t('help.search.placeholder')}
        aria-label={t('help.search.label')}
        autoComplete="off"
        spellCheck={false}
        onChange={(e) => change(e.target.value)}
        onKeyDown={onKeyDown}
      />
      {query ? (
        <button type="button" className="icon-btn icon-btn--sm" onClick={clear} aria-label={t('help.search.clear')} title={t('help.search.clear')}>
          <X size={13} />
        </button>
      ) : (
        <span className="kbd help-search__key" aria-hidden>
          /
        </span>
      )}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Breadcrumbs                                                         */
/* ------------------------------------------------------------------ */

function Crumbs({ section }: { section?: string }) {
  const t = useT()
  return (
    <nav className="help-crumbs label" aria-label={t('help.crumbs')}>
      <button type="button" className="help-crumbs__link" onClick={() => goHelp({ kind: 'home' })}>
        {t('help.home')}
      </button>
      {section && (
        <>
          <span className="help-crumbs__sep" aria-hidden>
            /
          </span>
          <button type="button" className="help-crumbs__link" onClick={() => goHelp({ kind: 'section', id: section })}>
            § {sectionNum(section)} {t(`help.sec.${section}`)}
          </button>
        </>
      )}
    </nav>
  )
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

export function ArticleRow({ a, summary }: { a: HelpArticle; summary?: boolean }) {
  const lang = useLang()
  return (
    <a className="help-row" href={helpPublicUrl(lang, a.id)} data-article={a.id} onClick={panelClick(() => goHelp({ kind: 'article', id: a.id }))}>
      <span className="help-row__num">{a.num}</span>
      <span className="help-row__main">
        <span className="help-row__title">{a.title}</span>
        {summary && a.summary && <span className="help-row__summary">{a.summary}</span>}
      </span>
      <ArrowRight size={13} strokeWidth={1.75} className="help-row__go" aria-hidden />
    </a>
  )
}

/* ------------------------------------------------------------------ */
/* Index                                                               */
/* ------------------------------------------------------------------ */

export function IndexView() {
  const t = useT()
  const lang = useLang()
  const total = LIBRARY[lang].length
  return (
    <div className="help-index">
      <p className="label help-spec">{t('help.spec', { sections: HELP_SECTIONS.length, articles: total })}</p>
      {HELP_SECTIONS.map((s) => {
        const list = sectionArticles(LIBRARY, lang, s.id)
        if (!list.length) return null
        return (
          <section key={s.id} className="help-chap" aria-labelledby={`help-chap-${s.id}`}>
            <h3 className="help-chap__head" id={`help-chap-${s.id}`}>
              <button type="button" className="help-chap__btn" onClick={() => goHelp({ kind: 'section', id: s.id })}>
                <span className="help-chap__num">§ {s.num}</span>
                <span className="help-chap__name">{t(`help.sec.${s.id}`)}</span>
                <span className="help-chap__rule" aria-hidden />
                <span className="label help-chap__count">{String(list.length).padStart(2, '0')}</span>
              </button>
            </h3>
            <ul className="help-list">
              {list.map((a) => (
                <li key={a.id}>
                  <ArticleRow a={a} />
                </li>
              ))}
            </ul>
          </section>
        )
      })}
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Chapter                                                             */
/* ------------------------------------------------------------------ */

export function SectionView({ id }: { id: string }) {
  const t = useT()
  const lang = useLang()
  const list = sectionArticles(LIBRARY, lang, id)
  return (
    <div className="help-art">
      <Crumbs />
      <p className="label help-art__code">
        § {sectionNum(id)} · {t(list.length === 1 ? 'help.articles.one' : 'help.articles.other', { count: list.length })}
      </p>
      <h3 className="help-art__title" tabIndex={-1} data-help-heading>
        {t(`help.sec.${id}`)}
      </h3>
      <ul className="help-list help-list--summary">
        {list.map((a) => (
          <li key={a.id}>
            <ArticleRow a={a} summary />
          </li>
        ))}
      </ul>
    </div>
  )
}

/* ------------------------------------------------------------------ */
/* Article                                                             */
/* ------------------------------------------------------------------ */

export function ArticleView({ id }: { id: string }) {
  const t = useT()
  const lang = useLang()
  const nav = useDocNav()
  const a = findArticle(LIBRARY, lang, id)
  if (!a)
    return (
      <div className="help-art">
        <Crumbs />
        <p className="help-empty">{t('help.search.none', { q: id })}</p>
      </div>
    )
  const related = relatedArticles(LIBRARY, lang, a)
  const { prev, next } = neighbours(LIBRARY, lang, a)
  return (
    <article className="help-art" data-article={a.id} lang={a.lang}>
      <Crumbs section={a.section} />
      <p className="label help-art__code">
        § {a.num} · {t('help.minutes', { n: a.minutes })}
      </p>
      <h3 className="help-art__title" tabIndex={-1} data-help-heading>
        {a.title}
      </h3>
      {a.summary && <p className="help-art__summary">{a.summary}</p>}
      <Doc blocks={a.blocks} nav={nav} />
      {related.length > 0 && (
        <section className="help-related" aria-labelledby="help-related-h">
          <h4 className="label help-related__label" id="help-related-h">
            {t('help.related')}
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
      {(prev || next) && (
        <nav className="help-pager" aria-label={t('help.inSection')}>
          {prev ? (
            <a className="help-pager__link" href={helpPublicUrl(lang, prev.id)} onClick={panelClick(() => goHelp({ kind: 'article', id: prev.id }))}>
              <span className="label">
                <ArrowLeft size={11} strokeWidth={2} aria-hidden /> {t('help.prev')} · {prev.num}
              </span>
              <span className="help-pager__title">{prev.title}</span>
            </a>
          ) : (
            <span />
          )}
          {next && (
            <a className="help-pager__link help-pager__link--next" href={helpPublicUrl(lang, next.id)} onClick={panelClick(() => goHelp({ kind: 'article', id: next.id }))}>
              <span className="label">
                {t('help.next')} · {next.num} <ArrowRight size={11} strokeWidth={2} aria-hidden />
              </span>
              <span className="help-pager__title">{next.title}</span>
            </a>
          )}
        </nav>
      )}
    </article>
  )
}

/* ------------------------------------------------------------------ */
/* Results                                                             */
/* ------------------------------------------------------------------ */

export function ResultsView({ query }: { query: string }) {
  const t = useT()
  const lang = useLang()
  const hits = useMemo(() => searchHelp(LIBRARY, lang, query), [lang, query])
  const q = query.trim()
  return (
    <div className="help-results">
      <p className="label help-spec" aria-live="polite">
        {hits.length ? t(hits.length === 1 ? 'help.search.results.one' : 'help.search.results.other', { count: hits.length }) : t('help.search.none', { q })}
      </p>
      <button type="button" className="help-askrow" onClick={() => openHelp({ tab: 'ask', question: q, run: true })}>
        <MessageSquareText size={15} strokeWidth={1.7} aria-hidden />
        <span className="help-askrow__main">
          <span className="help-askrow__title">{t('help.search.askInstead', { q })}</span>
          <span className="label">{t('help.search.askHint')}</span>
        </span>
        <CornerDownLeft size={13} aria-hidden className="help-askrow__enter" />
      </button>
      <ul className="help-list">
        {hits.map((h) => (
          <li key={h.article.id}>
            <a
              className="help-hit"
              href={helpPublicUrl(lang, h.article.id)}
              data-article={h.article.id}
              onClick={panelClick(() => goHelp({ kind: 'article', id: h.article.id }))}
            >
              <span className="label help-hit__where">
                § {h.article.num} · {t(`help.sec.${h.article.section}`)}
              </span>
              <span className="help-hit__title">
                <Marked text={h.article.title} ranges={h.titleRanges} />
              </span>
              {h.snippet && (
                <span className="help-hit__snippet">
                  <Marked text={h.snippet.text} ranges={h.snippet.ranges} />
                </span>
              )}
            </a>
          </li>
        ))}
      </ul>
    </div>
  )
}

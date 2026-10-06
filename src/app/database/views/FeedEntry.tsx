/**
 * One entry of the feed view: date plate, who wrote it and when, icon + title (opens the page),
 * the chosen properties as mono spec labels, the page content (read-only, clamped to about
 * twelve lines — "Show more" expands it in place) and Open / comment count.
 */
import { useEffect, useMemo, useRef, useState } from 'react'
import { ArrowUpRight, ChevronDown, MessageSquare } from 'lucide-react'
import { format, formatDistanceToNowStrict } from 'date-fns'
import type { ColorRule, Page, PropertyDef } from '../../store/types'
import { plainText } from '../../store/store'
import { ReadOnlyDoc } from '../../editor'
import { PageIcon } from '../../ui/PageIcon'
import { pointAnchor } from '../../ui/Popover'
import { pageHref } from '../../lib/router'
import { useT } from '../../i18n'
import type { DbModel } from '../hooks'
import { useViewActions } from './shared'
import { ActorChip, ValueView } from '../cells/display'
import { isEmptyValue } from '../model/resolve'
import { actorOf } from '../model/actors'
import { ruleStyle } from '../model/colors'
import { dfLocale, formatDay, formatTime, formatTimestamp } from '../model/format'
import { plural } from '../parts'
import { entryDate, feedDoc, openComments } from './feedDoc'
import { rowProps } from '../model/recordTypes'

const CREATED_BY: PropertyDef = { id: '__feed_by', name: '', type: 'created_by' }
const UPDATED_BY: PropertyDef = { id: '__feed_edit', name: '', type: 'last_edited_by' }
/** Edits within this long after creating a page don't count as "edited". */
const EDIT_GRACE = 60_000

export interface FeedEntryProps {
  m: DbModel
  row: Page
  rc: ColorRule | null
  dateProp: PropertyDef
  showContent: boolean
  index: number
  total: number
}

export function FeedEntry({ m, row, rc, dateProp, showContent, index, total }: FeedEntryProps) {
  const t = useT()
  const actions = useViewActions()
  const lang = m.resolver.ctx.lang
  const titleId = `dbf-title-${row.id}`
  const stamp = entryDate(m.resolver, m.db, dateProp, row)
  const comments = openComments(row)
  const open = (e: React.MouseEvent) => {
    // a new tab / window keeps the browser's own link handling
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.altKey || e.button !== 0) return
    e.preventDefault()
    actions.open(row)
  }
  const doc = useMemo(() => (showContent ? feedDoc(row.content) : null), [showContent, row.content])
  const [expanded, setExpanded] = useState(false)
  const [overflow, setOverflow] = useState(false)
  const ref = useRef<HTMLElement>(null)
  const collapse = () => {
    setExpanded(false)
    // the entry shrinks: keep its "Show more" (which has the focus) on screen instead of the entries below
    requestAnimationFrame(() => ref.current?.querySelector('.dbf-act--more')?.scrollIntoView({ block: 'nearest' }))
  }

  return (
    <article
      ref={ref}
      className={`dbf-entry${rc ? ' db-rc' : ''}`}
      data-rc={rc?.target}
      data-rc-color={rc?.color}
      style={rc ? ruleStyle(rc.color) : undefined}
      aria-labelledby={titleId}
      aria-posinset={index + 1}
      aria-setsize={total}
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' && e.target === e.currentTarget) {
          e.preventDefault()
          actions.open(row)
        }
      }}
    >
      <EntryDate stamp={stamp} lang={lang} />
      <div className="dbf-card">
        <header
          className="dbf-card__head"
          onContextMenu={(e) => {
            e.preventDefault()
            actions.contextMenu(row, pointAnchor(e.clientX, e.clientY))
          }}
        >
          <EntryStamp m={m} row={row} stamp={stamp} />
          <h3 className="dbf-title" id={titleId}>
            <a href={pageHref(row.id)} className="dbf-title__link" onClick={open}>
              {row.icon && (
                <span className="dbf-title__icon">
                  <PageIcon icon={row.icon} size={20} />
                </span>
              )}
              <span className={`dbf-title__text${row.title ? '' : ' is-empty'}`}>{row.title || t('common.untitled')}</span>
            </a>
          </h3>
          <EntrySpecs m={m} row={row} />
        </header>
        {doc && <EntryBody m={m} row={row} doc={doc} expanded={expanded} onOverflow={setOverflow} />}
        <footer className="dbf-card__foot">
          {doc && (overflow || expanded) && (
            <button type="button" className="dbf-act dbf-act--more" aria-expanded={expanded} aria-controls={`dbf-body-${row.id}`} onClick={() => (expanded ? collapse() : setExpanded(true))}>
              <ChevronDown size={13} strokeWidth={1.8} aria-hidden />
              {expanded ? t('database.feed.less') : t('database.feed.more')}
            </button>
          )}
          <span className="dbf-card__spacer" />
          {comments > 0 && (
            <button type="button" className="dbf-act dbf-act--comments" aria-label={plural(t, 'database.feed.comments', comments)} title={plural(t, 'database.feed.comments', comments)} onClick={() => actions.open(row)}>
              <MessageSquare size={13} strokeWidth={1.8} aria-hidden />
              {comments}
            </button>
          )}
          <button type="button" className="dbf-act dbf-act--open" onClick={() => actions.open(row)}>
            {t('database.feed.open')}
            <ArrowUpRight size={13} strokeWidth={1.8} aria-hidden />
          </button>
        </footer>
      </div>
    </article>
  )
}

/** The date plate on the rail: day, month + year, time. Hidden in narrow feeds (the stamp says it). */
function EntryDate({ stamp, lang }: { stamp: ReturnType<typeof entryDate>; lang: DbModel['resolver']['ctx']['lang'] }) {
  const t = useT()
  if (!stamp)
    return (
      <div className="dbf-date dbf-date--none">
        <span className="dbf-date__day" aria-hidden>
          —
        </span>
        <span className="label">{t('database.feed.noDate')}</span>
      </div>
    )
  const locale = dfLocale(lang)
  const d = stamp.date
  return (
    <time className="dbf-date" dateTime={d.toISOString()} title={stamp.time ? formatTimestamp(d.getTime(), lang) : undefined}>
      <span className="dbf-date__day">{format(d, 'dd')}</span>
      <span className="dbf-date__month">{format(d, 'MMM yyyy', { locale })}</span>
      {stamp.time && <span className="dbf-date__time">{formatTime(d, lang)}</span>}
    </time>
  )
}

/** Who wrote it and when: author · created (relative) · edited (relative, and by whom in a team). */
function EntryStamp({ m, row, stamp }: { m: DbModel; row: Page; stamp: ReturnType<typeof entryDate> }) {
  const t = useT()
  const { lang, labels, me } = m.resolver.ctx
  const locale = dfLocale(lang)
  const author = actorOf(CREATED_BY, row, me)
  const editor = actorOf(UPDATED_BY, row, me)
  const ago = (ms: number) => formatDistanceToNowStrict(ms, { addSuffix: true, locale })
  const edited = row.updatedAt - row.createdAt > EDIT_GRACE
  return (
    <div className="dbf-stamp">
      {author && <ActorChip id={author} r={m.resolver} />}
      {/* narrow feeds have no date plate: the date moves in here */}
      <time className="dbf-stamp__date" dateTime={stamp?.date.toISOString()}>
        {stamp ? formatDay(stamp.date, lang, labels) : t('database.feed.noDate')}
      </time>
      <time className="dbf-stamp__item" dateTime={new Date(row.createdAt).toISOString()} title={formatTimestamp(row.createdAt, lang)}>
        {ago(row.createdAt)}
      </time>
      {edited && (
        <span className="dbf-stamp__item" title={formatTimestamp(row.updatedAt, lang)}>
          {editor && author && editor !== author ? t('database.feed.editedBy', { time: ago(row.updatedAt), name: m.resolver.actorName(editor) }) : t('database.feed.edited', { time: ago(row.updatedAt) })}
        </span>
      )}
    </div>
  )
}

/** The view's visible properties as spec labels (empty values left out, like on cards). */
function EntrySpecs({ m, row }: { m: DbModel; row: Page }) {
  const values = rowProps(m.visibleProps, row).map((p) => ({ p, v: m.resolver.value(m.db, p, row) })).filter(({ p, v }) => !isEmptyValue(p, v) || p.type === 'checkbox')
  if (!values.length) return null
  return (
    <dl className="dbf-specs">
      {values.map(({ p, v }) => (
        <div key={p.id} className="dbf-spec" data-type={p.type}>
          <dt className="dbf-spec__name">{p.name}</dt>
          <dd className="dbf-spec__value">
            <ValueView db={m.db} prop={p} row={row} r={m.resolver} v={v} variant="card" interactive={!m.readOnly && (p.type === 'checkbox' || p.type === 'rating')} />
          </dd>
        </div>
      ))}
    </dl>
  )
}

/**
 * The page content, clamped while collapsed. The read-only editor mounts once the entry comes near
 * the screen (a long feed would otherwise start an editor per entry at once); until then the
 * plain text stands in.
 */
function EntryBody({ m, row, doc, expanded, onOverflow }: { m: DbModel; row: Page; doc: NonNullable<ReturnType<typeof feedDoc>>; expanded: boolean; onOverflow: (v: boolean) => void }) {
  const box = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const near = useNear(box, m.inline)
  useEffect(() => {
    const b = box.current
    const i = inner.current
    if (!b || !i) return
    const check = () => {
      // expanded: no clamp to measure against — keep what was found
      const clamp = parseFloat(getComputedStyle(b).maxHeight)
      if (Number.isFinite(clamp)) onOverflow(i.offsetHeight > clamp + 1)
    }
    check()
    const ro = new ResizeObserver(check)
    ro.observe(i)
    return () => ro.disconnect()
  }, [expanded, near, onOverflow])
  return (
    <div ref={box} className="dbf-body" id={`dbf-body-${row.id}`} data-expanded={expanded}>
      <div ref={inner} className="dbf-body__inner">
        {near ? <ReadOnlyDoc content={doc} className="dbf-doc" headingOffset={1} /> : <div className="dbf-plain">{(row.plain ?? plainText(row.content, 1500)).slice(0, 1500)}</div>}
      </div>
    </div>
  )
}

/** True once the element came within ~one screen of the visible area (and stays true). */
function useNear(ref: React.RefObject<HTMLElement | null>, inline: boolean): boolean {
  const [near, setNear] = useState(false)
  useEffect(() => {
    const el = ref.current
    if (!el || near) return
    if (typeof IntersectionObserver === 'undefined') return setNear(true)
    // an inline database scrolls inside its own box
    const root = inline ? el.closest('.db-body') : null
    const io = new IntersectionObserver((entries) => entries.some((e) => e.isIntersecting) && setNear(true), { root, rootMargin: '600px 0px' })
    io.observe(el)
    return () => io.disconnect()
  }, [ref, near, inline])
  return near
}

/**
 * Feed view: the rows as a stream of entries with their page content — for announcements,
 * journals, blog-like databases. Newest first by default (created time or a date property of the
 * view's choice, model/feed); the view's own sorts, filters and search apply as everywhere.
 * Keyboard (ARIA feed): Page Down / Page Up move between entries, Enter opens one.
 */
import { useState } from 'react'
import { ArrowDownWideNarrow, ArrowUpNarrowWide, Plus } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { useModel, type DbModel } from '../hooks'
import { useViewActions, EmptyState } from './shared'
import { useRowColor } from './tree'
import { FEED_CREATED, feedDateProp, feedOrders } from '../model/feed'
import { plural } from '../parts'
import { FeedEntry } from './FeedEntry'
import './feed.css'

/** Entries shown at first; "Show more" adds this many again. */
const PAGE = 24

export default function FeedView() {
  const t = useT()
  const m = useModel()
  const actions = useViewActions()
  const [limit, setLimit] = useState(PAGE)
  const colorOf = useRowColor(m)
  const dateProp = feedDateProp(m.db, m.view)
  const showContent = m.view.feed?.content !== false
  const add = m.readOnly ? undefined : () => actions.newRow({ open: true })

  const onKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key !== 'PageDown' && e.key !== 'PageUp') return
    const entries = Array.from(e.currentTarget.querySelectorAll<HTMLElement>(':scope > .dbf-entry'))
    const at = entries.findIndex((el) => el.contains(document.activeElement))
    if (at < 0) return
    e.preventDefault()
    entries[Math.max(0, Math.min(entries.length - 1, at + (e.key === 'PageDown' ? 1 : -1)))]?.focus()
  }

  if (!m.rows.length) return <EmptyState onAdd={add} />
  const shown = m.rows.slice(0, limit)
  return (
    <div className="dbf">
      <FeedHead m={m} onAdd={add} />
      <div className="dbf-list" role="feed" aria-busy={false} aria-label={t('database.feed.label')} onKeyDown={onKeyDown}>
        {shown.map((row, i) => (
          <FeedEntry key={row.id} m={m} row={row} rc={colorOf(row)} dateProp={dateProp} showContent={showContent} index={i} total={m.rows.length} />
        ))}
      </div>
      {m.rows.length > limit && (
        <button type="button" className="dbf-loadmore" onClick={() => setLimit((l) => l + PAGE)}>
          <span className="label">{t('database.board.more', { count: Math.min(PAGE, m.rows.length - limit) })}</span>
        </button>
      )}
    </div>
  )
}

/** Above the entries: the order (newest / oldest first — a switch while the view has no sorts) and "New entry". */
function FeedHead({ m, onAdd }: { m: DbModel; onAdd?: () => void }) {
  const t = useT()
  const own = feedOrders(m.view)
  const newest = m.view.feed?.order !== 'oldest'
  const prop = feedDateProp(m.db, m.view)
  const by = prop === FEED_CREATED ? t('database.type.created_time') : prop.name
  const order = newest ? t('database.feed.newest') : t('database.feed.oldest')
  const flip = () => useWorkspace.getState().updateView(m.db.id, m.view.id, { feed: { ...m.view.feed, order: newest ? 'oldest' : 'newest' } })
  const Icon = newest ? ArrowDownWideNarrow : ArrowUpNarrowWide
  return (
    <div className="dbf-head">
      {own ? (
        m.fixed ? (
          <span className="dbf-order" data-static>
            <Icon size={13} strokeWidth={1.8} aria-hidden />
            {order}
          </span>
        ) : (
          <button type="button" className="dbf-order" aria-label={t('database.feed.reverse', { order })} title={t('database.feed.reverse', { order })} onClick={flip}>
            <Icon size={13} strokeWidth={1.8} aria-hidden />
            {order}
          </button>
        )
      ) : (
        <span className="dbf-order" data-static>
          {t('database.feed.sorted')} · {plural(t, 'database.feed.sortRules', m.view.sorts.length)}
        </span>
      )}
      {own && <span className="dbf-head__by label">{by}</span>}
      <span className="dbf-head__spacer" />
      {onAdd && (
        <button type="button" className="dbf-new" aria-label={t('database.feed.new')} title={t('database.feed.new')} onClick={onAdd}>
          <Plus size={13} strokeWidth={1.8} aria-hidden />
          <span className="dbf-new__text">{t('database.feed.new')}</span>
        </button>
      )}
    </div>
  )
}

/**
 * § 01 FAVORITES — in the sidebar's fixed block (Sidebar.tsx): always there, always numbered 01, never scrolled away.
 *
 * Empty, a slot (two lines, a dashed box) says how a page gets in: drag it here, or its ☆ (on touch: ⋯ › Add to
 * favorites). While a tree row is dragged the same box says what a drop does — nothing appears or grows when a drag
 * starts. A page dropped on the head, the box or the slot becomes a favourite at the end; one dropped on a favourite's row
 * goes before / after it. The page stays where it is in the tree; an entry stays in its database.
 *
 * Rows are the tree's rows (`data-section="fav"`): they expand like the tree. A favourite's own row drags to reorder,
 * Alt + ↑ / ↓ moves it (the key stays on it, a polite live region says its new place) and its menu has Move up / Move
 * down. Past the cap (5 rows from 800 px window height, 4 below, 3 in the phone drawer — sidebar.css) the list scrolls
 * inside, whole rows. Order: this device's (lib/favorites.ts); the fold: localStorage `one.shell.sections` = { fav }.
 */
import type { KeyboardEvent } from 'react'
import { ChevronDown, Star } from 'lucide-react'
import { useT } from '../../i18n'
import { useIsTouch } from '../lib/hooks'
import { setFavFold, useFavFold, useOrderedFavorites } from '../lib/favorites'
import { FAV_KEYS_HINT, FAV_LIVE, PageList, SECTION_DROP, useDragActive, useSectionDrop } from './PageTree'

const pad = (n: number) => String(n).padStart(2, '0')

export function FavoritesSection({ n, onKeyDown }: { n: number; onKeyDown: (e: KeyboardEvent<HTMLElement>) => void }) {
  const t = useT()
  const ids = useOrderedFavorites()
  const touch = useIsTouch()
  const open = useFavFold((s) => s.open)
  // the head and the whole box take a drop (at the end); the favourites' rows take it before / after them
  const zone = useSectionDrop(SECTION_DROP.fav, true)
  const slot = useSectionDrop(SECTION_DROP.favEnd, true)
  const dragging = useDragActive()
  // a tree row on its way here (a favourite being reordered drops on the rows)
  const incoming = !!dragging && !dragging.startsWith('fav:')
  const name = t('shell.sidebar.favorites')
  return (
    <section
      ref={zone.ref}
      className="sb-section sb-favs"
      aria-label={name}
      data-empty={ids.length ? undefined : ''}
      data-drop={zone.over || undefined}
      data-incoming={incoming || undefined}
      onKeyDown={onKeyDown}
    >
      <div className="sb-sect">
        <span className="sb-sect__n">{pad(n)}</span>
        <span className="sb-sect__label">{name}</span>
        <span className="sb-sect__leader" aria-hidden />
        <span className="sb-sect__count">{pad(ids.length)}</span>
        <button
          type="button"
          className="sb-sect__add sb-sect__fold"
          aria-expanded={open}
          aria-controls={open ? 'sb-favs-list' : undefined}
          aria-label={t(open ? 'shell.fav.fold' : 'shell.fav.unfold')}
          onClick={() => setFavFold(!open)}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      {open &&
        (ids.length > 0 ? (
          <div id="sb-favs-list" className="sb-favs__list" role="tree" aria-label={name}>
            <PageList ids={ids} section="fav" draggable />
          </div>
        ) : (
          // both texts share one cell: the box keeps its size whether it teaches or takes a drop
          <div id="sb-favs-list" ref={slot.ref} className="sb-favs__slot" data-drop={slot.over || zone.over || undefined}>
            <span className="sb-favs__teach" aria-hidden={incoming || undefined}>
              <span className="sb-favs__what">
                <Star size={13} strokeWidth={1.75} aria-hidden />
                {t('shell.fav.empty')}
              </span>
              <span className="sb-favs__how">{t(touch ? 'shell.fav.emptyHintTouch' : 'shell.fav.emptyHint')}</span>
            </span>
            <span className="sb-favs__drop" aria-hidden={!incoming || undefined}>
              {t('shell.fav.drop')}
            </span>
          </div>
        ))}
      <span id={FAV_KEYS_HINT} className="visually-hidden">
        {t('shell.fav.keysHint')}
      </span>
      <span id={FAV_LIVE} className="visually-hidden" aria-live="polite" />
    </section>
  )
}

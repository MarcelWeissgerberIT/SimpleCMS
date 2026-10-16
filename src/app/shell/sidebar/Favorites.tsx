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
 * inside, whole rows; what it hides is marked at its edges: a hairline under the head while rows lie above, and a line
 * under the list with a mono key ("+2 ▾" — rows below; "+2 ▴" — only above) that scrolls the list by a page. The
 * keyboard needs no key there (↑ / ↓ walk every row and the list follows). Order: this device's (lib/favorites.ts); the
 * fold: localStorage `one.shell.sections` = { fav }.
 */
import { useLayoutEffect, useRef, useState, type KeyboardEvent, type RefObject } from 'react'
import { ChevronDown, ChevronUp, Star } from 'lucide-react'
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
  const list = useRef<HTMLDivElement>(null)
  const edge = useHidden(list, open && ids.length > 0)
  return (
    <section
      ref={zone.ref}
      className="sb-section sb-favs"
      aria-label={name}
      data-empty={ids.length ? undefined : ''}
      data-drop={zone.over || undefined}
      data-incoming={incoming || undefined}
      data-above={edge.above ? '' : undefined}
      data-edge={edge.over ? '' : undefined}
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
          <>
            <div id="sb-favs-list" ref={list} className="sb-favs__list" role="tree" aria-label={name}>
              <PageList ids={ids} section="fav" draggable />
            </div>
            {edge.over && <EdgeKey list={list} above={edge.above} below={edge.below} />}
          </>
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

interface Hidden {
  /** the list holds more than it shows (past the cap) */
  over: boolean
  /** rows (a favourite's subtree rows too) wholly or partly above / below what shows */
  above: number
  below: number
}
const NONE: Hidden = { over: false, above: 0, below: 0 }

/** What the list hides past the cap: measured on its scroll, its size and its rows coming and going. */
function useHidden(ref: RefObject<HTMLDivElement | null>, shown: boolean): Hidden {
  const [h, setH] = useState<Hidden>(NONE)
  useLayoutEffect(() => {
    const el = ref.current
    if (!shown || !el) {
      setH(NONE)
      return
    }
    let frame = 0
    const measure = () => {
      const l = el.getBoundingClientRect()
      let above = 0
      let below = 0
      for (const row of el.querySelectorAll<HTMLElement>('.sb-row')) {
        const r = row.getBoundingClientRect()
        if (r.top < l.top - 0.5) above++
        else if (r.bottom > l.bottom + 0.5) below++
      }
      const over = el.scrollHeight > el.clientHeight + 1
      setH((p) => (p.over === over && p.above === above && p.below === below ? p : { over, above, below }))
    }
    const later = () => {
      cancelAnimationFrame(frame)
      frame = requestAnimationFrame(measure)
    }
    measure()
    el.addEventListener('scroll', later, { passive: true })
    const ro = new ResizeObserver(later)
    ro.observe(el)
    const mo = new MutationObserver(later)
    mo.observe(el, { childList: true, subtree: true })
    return () => {
      cancelAnimationFrame(frame)
      el.removeEventListener('scroll', later)
      ro.disconnect()
      mo.disconnect()
    }
  }, [ref, shown])
  return h
}

/**
 * "+2 ▾" — rows below what shows (a page down); "+2 ▴" — rows only above (a page up). A pointer's key: no Tab stop and
 * the focus stays where it is (the keyboard walks the rows with ↑ / ↓, the list follows); its name says what it does.
 */
function EdgeKey({ list, above, below }: { list: RefObject<HTMLDivElement | null>; above: number; below: number }) {
  const t = useT()
  const down = below > 0
  const n = down ? below : above
  if (!n) return <div className="sb-favs__edge" aria-hidden />
  const name = t(down ? (n === 1 ? 'shell.fav.below.one' : 'shell.fav.below') : n === 1 ? 'shell.fav.above.one' : 'shell.fav.above', { n })
  return (
    <div className="sb-favs__edge" data-below={down || undefined}>
      <button
        type="button"
        className="sb-favs__edgekey"
        tabIndex={-1}
        aria-label={name}
        title={name}
        data-testid="fav-edge"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => {
          const el = list.current
          if (!el) return
          const still = window.matchMedia('(prefers-reduced-motion: reduce)').matches
          el.scrollBy({ top: (down ? 1 : -1) * Math.max(el.clientHeight - 1, 1), behavior: still ? 'auto' : 'smooth' })
        }}
      >
        <span>+{n}</span>
        {down ? <ChevronDown size={12} strokeWidth={2} aria-hidden /> : <ChevronUp size={12} strokeWidth={2} aria-hidden />}
      </button>
    </div>
  )
}

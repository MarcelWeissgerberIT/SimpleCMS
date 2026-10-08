import { useRef, type KeyboardEvent } from 'react'
import { ChevronDown, Eraser, MoreHorizontal } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { ID } from '../../store/types'
import { useRoute } from '../../lib/router'
import { Menu, useMenu, type MenuEntry } from '../../ui/Menu'
import { useT } from '../../i18n'
import { toggleMenu } from '../lib/menu'
import { useIsMobile, useLocalPref } from '../lib/hooks'
import { clearVisits, useFrequentIds, useRecentIds } from '../lib/visits'
import { PageList } from './PageTree'

/** Rows per list. */
export const VISITED_ROWS = 5

type Tab = 'recent' | 'frequent'
interface Pref {
  tab: Tab
  open: boolean
}

/** Where you were (RECENT, the open page left out) and what this device opens most (FREQUENT). */
export function useVisited(): { recent: ID[]; frequent: ID[]; shown: boolean } {
  const route = useRoute()
  const recent = useRecentIds(VISITED_ROWS, route.name === 'page' ? route.id : null)
  const frequent = useFrequentIds(VISITED_ROWS)
  return { recent, frequent, shown: recent.length > 0 || frequent.length > 0 }
}

/** The tab and fold of the section (per device, `one.shell.visited`): anything odd reads as the default. */
function readPref(v: unknown, mobile: boolean): Pref {
  const p = (v && typeof v === 'object' ? v : {}) as Partial<Record<keyof Pref, unknown>>
  return { tab: p.tab === 'frequent' ? 'frequent' : 'recent', open: typeof p.open === 'boolean' ? p.open : !mobile }
}

/**
 * RECENT | FREQUENT — one compact section above the page tree with a two-position switch. Both lists
 * are this device's own (never synced); the head's ⋯ key (or a right-click) clears them.
 */
export function VisitedSection({ n, recent, frequent }: { n: number; recent: ID[]; frequent: ID[] }) {
  const t = useT()
  const mobile = useIsMobile()
  // phones start folded: the drawer is short
  const [raw, setRaw] = useLocalPref<unknown>('one.shell.visited', { tab: 'recent', open: !mobile })
  const pref = readPref(raw, mobile)
  const set = (patch: Partial<Pref>) => setRaw({ ...pref, ...patch })
  const menu = useMenu()
  const tabs = useRef<Record<Tab, HTMLButtonElement | null>>({ recent: null, frequent: null })
  const ids = pref.tab === 'recent' ? recent : frequent

  const cleared = () => useUI.getState().toast({ message: t('shell.sidebar.visitedCleared'), kind: 'success' })
  const clearThis = () => {
    if (pref.tab === 'recent') useWorkspace.getState().clearRecent()
    else clearVisits()
    cleared()
  }
  const entries: MenuEntry[] = [
    { label: t('shell.sidebar.visitedClear'), icon: <Eraser size={15} />, hint: t('shell.sidebar.visitedDevice').toUpperCase(), onSelect: clearThis },
    {
      label: t('shell.sidebar.visitedClearAll'),
      onSelect: () => {
        useWorkspace.getState().clearRecent()
        clearVisits()
        cleared()
      },
    },
  ]

  const pick = (tab: Tab, focus = false) => {
    set({ tab, open: true })
    if (focus) requestAnimationFrame(() => tabs.current[tab]?.focus())
  }
  const onTabKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const order: Tab[] = ['recent', 'frequent']
    const i = order.indexOf(pref.tab)
    let next: Tab | null = null
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') next = order[(i + 1) % 2]
    else if (e.key === 'Home') next = 'recent'
    else if (e.key === 'End') next = 'frequent'
    if (!next) return
    e.preventDefault()
    e.stopPropagation()
    pick(next, true)
  }

  const tabId = (tab: Tab) => `sb-visited-tab-${tab}`
  return (
    <section className="sb-section sb-visited" aria-label={t('shell.sidebar.visited')} data-testid="visited-section" data-tab={pref.tab}>
      <div
        className="sb-sect sb-visited__head"
        onContextMenu={(e) => {
          e.preventDefault()
          menu.openAt(e.currentTarget)
        }}
      >
        <span className="sb-sect__n">{String(n).padStart(2, '0')}</span>
        <div className="sb-switch" role="tablist" aria-label={t('shell.sidebar.visited')}>
          {(['recent', 'frequent'] as Tab[]).map((tab) => (
            <button
              key={tab}
              ref={(el) => {
                tabs.current[tab] = el
              }}
              type="button"
              role="tab"
              id={tabId(tab)}
              className="sb-switch__tab"
              aria-selected={pref.tab === tab}
              aria-controls={pref.open ? 'sb-visited-panel' : undefined}
              tabIndex={pref.tab === tab ? 0 : -1}
              onClick={() => pick(tab)}
              onKeyDown={onTabKey}
            >
              {t(tab === 'recent' ? 'shell.sidebar.recent' : 'shell.sidebar.frequent')}
            </button>
          ))}
        </div>
        <span className="sb-sect__leader" aria-hidden />
        <span className="sb-sect__count">{String(ids.length).padStart(2, '0')}</span>
        <button type="button" className="sb-sect__add sb-visited__more" aria-label={t('shell.sidebar.visitedMenu')} aria-haspopup="menu" aria-expanded={menu.open} onClick={toggleMenu(menu)}>
          <MoreHorizontal size={14} />
        </button>
        <button
          type="button"
          className="sb-sect__add sb-sect__fold"
          aria-expanded={pref.open}
          aria-label={t(pref.open ? 'shell.sidebar.visitedFold' : 'shell.sidebar.visitedUnfold')}
          onClick={() => set({ open: !pref.open })}
        >
          <ChevronDown size={14} />
        </button>
      </div>
      <Menu {...menu.props} entries={entries} width={240} />
      {pref.open && (
        <div role="tabpanel" id="sb-visited-panel" aria-labelledby={tabId(pref.tab)}>
          {ids.length ? (
            <div role="tree">
              <PageList ids={ids} section={pref.tab} />
            </div>
          ) : (
            <p className="sb-hint">{t(pref.tab === 'recent' ? 'shell.sidebar.recentEmpty' : 'shell.sidebar.frequentEmpty')}</p>
          )}
        </div>
      )}
    </section>
  )
}

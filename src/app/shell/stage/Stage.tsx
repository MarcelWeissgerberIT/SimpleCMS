import { Fragment, useEffect, useLayoutEffect, useRef, useState, type ReactNode, type SyntheticEvent } from 'react'
import { Maximize2, X } from 'lucide-react'
import { useUI } from '../../store/ui'
import { usePage } from '../../store/selectors'
import type { Route } from '../../lib/router'
import { PageIcon } from '../../ui/PageIcon'
import { Tooltip } from '../../ui/Tooltip'
import { useT } from '../../i18n'
import type { ID } from '../../store/types'
import { PageView } from '../page/PageView'
import { goToPage } from '../lib/actions'
import { useColumnScroll, useIsMobile } from '../lib/hooks'
import { useStageView } from '../lib/stage'
import './stage.css'

/**
 * The working surface: the main page plus up to three stacked panes to its right
 * (Andy Matuschak style). When space runs out, panes fold into narrow "spines".
 */
export function Stage({ route, main, mainTitle }: { route: Route; main: ReactNode; mainTitle: ReactNode }) {
  const panes = useUI((s) => s.panes)
  const focusMode = useUI((s) => s.focusMode)
  const mobile = useIsMobile()
  const ref = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(1200)
  // `focus` decides which columns get the room; `active` is the column being worked in (the
  // topbar, status bar and palette act on its page). Clicking into a column that is already
  // shown in full only moves `active`, so the layout never shifts under the pointer.
  const [focus, setFocus] = useState(panes.length)
  const [active, setActive] = useState(panes.length)
  const show = (i: number) => {
    setFocus(i)
    setActive(i)
  }
  const prevLen = useRef(panes.length)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setWidth(el.clientWidth)
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    // a newly opened pane takes focus; closing keeps focus in range
    if (panes.length >= prevLen.current) show(panes.length)
    else {
      setFocus((f) => Math.min(f, panes.length))
      setActive((a) => Math.min(a, panes.length))
    }
    prevLen.current = panes.length
  }, [panes])

  const routeKey = route.name === 'page' ? `p:${route.id}` : route.name
  // navigating the main column brings it back into view
  const lastRoute = useRef(routeKey)
  useEffect(() => {
    if (lastRoute.current !== routeKey) show(0)
    lastRoute.current = routeKey
  }, [routeKey])
  // the main page was picked again (sidebar, crumbs, "← 01") → unfold it
  const revealTick = useStageView((s) => s.revealTick)
  const lastReveal = useRef(revealTick)
  useEffect(() => {
    if (revealTick !== lastReveal.current) show(0)
    lastReveal.current = revealTick
  }, [revealTick])

  const visiblePanes = focusMode ? [] : panes
  const count = 1 + visiblePanes.length
  const SPINE = mobile ? 34 : 42
  const MIN = mobile ? 280 : 440
  let k = count
  while (k > 1 && k * MIN + (count - k) * SPINE > width) k--
  const f = Math.min(focus, count - 1)
  const start = Math.min(f, count - k)
  const isFull = (i: number) => i >= start && i < start + k
  const mainFolded = !isFull(0)
  // the active column, as long as it is in full view (else the focused one, which always is)
  const a = Math.min(active, count - 1)
  const act = isFull(a) ? a : f

  const activePaneId = act > 0 ? (visiblePanes[act - 1] ?? null) : null
  useEffect(() => {
    useStageView.getState().publish({ mainFolded, columns: count, activePaneId, activePaneIndex: activePaneId ? act - 1 : -1 })
  }, [mainFolded, count, activePaneId, act])
  useEffect(() => () => useStageView.getState().publish({ mainFolded: false, columns: 1, activePaneId: null, activePaneIndex: -1 }), [])

  // pointer or keyboard focus entering a column makes it the active one
  const onEnter = (e: SyntheticEvent) => {
    const col = (e.target as HTMLElement).closest?.('[data-col]') as HTMLElement | null
    if (!col || !ref.current?.contains(col)) return // portalled menus keep the column they came from
    const i = Number(col.dataset.col)
    if (Number.isInteger(i) && i !== act) setActive(i)
  }

  // stable keys: closing a pane must not remount (and reset) the panes to its right
  const seen = new Map<ID, number>()
  const paneKeys = visiblePanes.map((id) => {
    const n = seen.get(id) ?? 0
    seen.set(id, n + 1)
    return `${id}:${n}`
  })

  // Folded columns stay mounted (hidden next to their spine): unfolding keeps the reading
  // position, the selection and the editor's undo history.
  return (
    <div ref={ref} className="stage" data-panes={visiblePanes.length || undefined} onPointerDownCapture={onEnter} onFocusCapture={onEnter}>
      {mainFolded && <Spine key="spine:main" n={1} title={mainTitle} onClick={() => show(0)} />}
      <MainColumn key={routeKey} route={route} folded={mainFolded} active={count > 1 && act === 0}>
        {main}
      </MainColumn>
      {visiblePanes.map((id, i) => {
        const folded = !isFull(i + 1)
        return (
          <Fragment key={paneKeys[i]}>
            {folded && <PaneSpine id={id} index={i} onClick={() => show(i + 1)} />}
            <Pane id={id} index={i} folded={folded} active={act === i + 1} />
          </Fragment>
        )
      })}
    </div>
  )
}

function MainColumn({ route, folded, active, children }: { route: Route; folded: boolean; active: boolean; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const block = route.name === 'page' ? route.block : undefined
  // a deep link to a block scrolls on purpose; everything else opens at the top
  useColumnScroll(ref, { folded, hold: !block })
  useEffect(() => {
    if (!block) return
    let tries = 0
    const timer = window.setInterval(() => {
      const root = ref.current
      const el = root?.querySelector<HTMLElement>(`[data-id="${CSS.escape(block)}"], [data-block-id="${CSS.escape(block)}"], [id="${CSS.escape(block)}"]`)
      if (el) {
        window.clearInterval(timer)
        el.scrollIntoView({ block: 'center' })
        el.classList.add('is-target')
        window.setTimeout(() => el.classList.remove('is-target'), 2200)
      } else if (++tries > 20) window.clearInterval(timer)
    }, 80)
    return () => window.clearInterval(timer)
  }, [block])
  // reading gauge: a 2px signal line along the top edge that fills as you scroll
  const gauge = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    let raf = 0
    const update = () => {
      raf = 0
      const max = el.scrollHeight - el.clientHeight
      const p = max > 24 ? Math.min(1, el.scrollTop / max) : 0
      if (gauge.current) {
        gauge.current.style.transform = `scaleX(${p})`
        gauge.current.dataset.on = p > 0.002 ? '1' : ''
      }
    }
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update)
    }
    el.addEventListener('scroll', onScroll, { passive: true })
    const ro = new ResizeObserver(onScroll)
    ro.observe(el)
    return () => {
      el.removeEventListener('scroll', onScroll)
      ro.disconnect()
      cancelAnimationFrame(raf)
    }
  }, [])
  return (
    <main ref={ref} className="stage-col stage-col--main" id="main" tabIndex={-1} data-col={0} data-folded={folded || undefined} data-active={active || undefined}>
      <div className="gauge-line" aria-hidden>
        <div ref={gauge} className="gauge-line__fill" />
      </div>
      {children}
    </main>
  )
}

function Pane({ id, index, folded, active }: { id: ID; index: number; folded: boolean; active: boolean }) {
  const t = useT()
  const page = usePage(id)
  const close = () => useUI.getState().closePane(index)
  const scroller = useRef<HTMLDivElement>(null)
  useColumnScroll(scroller, { folded })
  return (
    <section
      className="stage-col pane"
      data-pane-index={index}
      data-col={index + 1}
      data-folded={folded || undefined}
      data-active={active || undefined}
      tabIndex={-1}
      aria-label={page?.title || t('common.untitled')}
    >
      <div className="pane__head">
        <span className="pane__n">{String(index + 2).padStart(2, '0')}</span>
        {page && <PageIcon icon={page.icon} kind={page.kind} size={15} />}
        <span className="pane__title">{page?.title.trim() || t('common.untitled')}</span>
        <Tooltip label={t('shell.pane.openFull')}>
          <button
            type="button"
            className="icon-btn icon-btn--sm"
            onClick={() => {
              close()
              goToPage(id)
            }}
          >
            <Maximize2 size={13} />
          </button>
        </Tooltip>
        <Tooltip label={t('shell.pane.close')}>
          <button type="button" className="icon-btn icon-btn--sm" onClick={close}>
            <X size={14} />
          </button>
        </Tooltip>
      </div>
      <div ref={scroller} className="pane__scroll">
        <PageView pageId={id} variant="pane" />
      </div>
    </section>
  )
}

function PaneSpine({ id, index, onClick }: { id: ID; index: number; onClick: () => void }) {
  const t = useT()
  const page = usePage(id)
  return (
    <Spine
      n={index + 2}
      title={
        <>
          {page && <PageIcon icon={page.icon} kind={page.kind} size={14} />}
          <span>{page?.title.trim() || t('common.untitled')}</span>
        </>
      }
      onClick={onClick}
      onClose={() => useUI.getState().closePane(index)}
    />
  )
}

function Spine({ n, title, onClick, onClose }: { n: number; title: ReactNode; onClick: () => void; onClose?: () => void }) {
  const t = useT()
  return (
    <div className="spine">
      {/* named by its number and title; "show this pane" is the hint */}
      <button type="button" className="spine__btn" onClick={onClick} title={t('shell.pane.expand')}>
        <span className="spine__n">{String(n).padStart(2, '0')}</span>
        <span className="spine__title">{title}</span>
      </button>
      {onClose && (
        <button type="button" className="icon-btn icon-btn--sm spine__close" onClick={onClose} aria-label={t('shell.pane.close')}>
          <X size={13} />
        </button>
      )}
    </div>
  )
}

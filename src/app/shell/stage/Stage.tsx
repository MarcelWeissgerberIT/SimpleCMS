import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
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
import { useIsMobile } from '../lib/hooks'
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
  const [focus, setFocus] = useState(panes.length)
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
    if (panes.length >= prevLen.current) setFocus(panes.length)
    else setFocus((f) => Math.min(f, panes.length))
    prevLen.current = panes.length
  }, [panes])

  const visiblePanes = focusMode ? [] : panes
  const count = 1 + visiblePanes.length
  const SPINE = mobile ? 34 : 42
  const MIN = mobile ? 280 : 440
  let k = count
  while (k > 1 && k * MIN + (count - k) * SPINE > width) k--
  const f = Math.min(focus, count - 1)
  const start = Math.min(f, count - k)
  const isFull = (i: number) => i >= start && i < start + k

  const routeKey = route.name === 'page' ? `p:${route.id}` : route.name

  return (
    <div ref={ref} className="stage" data-panes={visiblePanes.length || undefined}>
      {isFull(0) ? (
        <MainColumn key={routeKey} route={route}>
          {main}
        </MainColumn>
      ) : (
        <Spine n={1} title={mainTitle} onClick={() => setFocus(0)} />
      )}
      {visiblePanes.map((id, i) =>
        isFull(i + 1) ? (
          <Pane key={`${i}:${id}`} id={id} index={i} />
        ) : (
          <PaneSpine key={`${i}:${id}`} id={id} index={i} onClick={() => setFocus(i + 1)} />
        ),
      )}
    </div>
  )
}

function MainColumn({ route, children }: { route: Route; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null)
  const block = route.name === 'page' ? route.block : undefined
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
  return (
    <main ref={ref} className="stage-col stage-col--main" id="main" tabIndex={-1}>
      {children}
    </main>
  )
}

function Pane({ id, index }: { id: ID; index: number }) {
  const t = useT()
  const page = usePage(id)
  const close = () => useUI.getState().closePane(index)
  return (
    <section className="stage-col pane" data-pane-index={index} aria-label={page?.title || t('common.untitled')}>
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
      <div className="pane__scroll">
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
      <button type="button" className="spine__btn" onClick={onClick} aria-label={t('shell.pane.expand')}>
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

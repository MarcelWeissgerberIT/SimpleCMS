import { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ChevronsRight, Maximize2, PanelRight, SquareSplitHorizontal } from 'lucide-react'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import { Tooltip } from '../../ui/Tooltip'
import { useT } from '../../i18n'
import { PageView } from '../page/PageView'
import { goToPage } from '../lib/actions'
import { useIsMobile, useLocalPref } from '../lib/hooks'
import { useBreadcrumbs } from '../../store/selectors'
import { PageIcon } from '../../ui/PageIcon'

let lastClosedAt = 0

/** Side peek (≈48 %, resizable) or centred peek for any page — used for database rows. */
export function Peek() {
  const id = useUI((s) => s.peekPageId)
  return id ? <PeekPanel id={id} /> : null
}

function PeekPanel({ id }: { id: string }) {
  const t = useT()
  const mode = useUI((s) => s.peekMode)
  const mobile = useIsMobile()
  const [frac, setFrac] = useLocalPref('one.shell.peekWidth', 0.48)
  const [dragFrac, setDragFrac] = useState<number | null>(null)
  const ref = useRef<HTMLDivElement>(null)
  const [instant] = useState(() => Date.now() - lastClosedAt < 350)

  // links followed inside the peek navigate it in place; keep a trail for "back"
  const [trail, setTrail] = useState<string[]>([])
  const shown = useRef(id)
  const goingBack = useRef(false)
  useEffect(() => {
    if (shown.current === id) return
    const prev = shown.current
    shown.current = id
    if (goingBack.current) goingBack.current = false
    else setTrail((tr) => [...tr, prev].slice(-20))
    ref.current?.querySelector('.peek__scroll')?.scrollTo({ top: 0 })
  }, [id])
  const back = () => {
    const pages = useWorkspace.getState().pages
    const rest = trail.filter((p) => !!pages[p])
    const prev = rest.pop()
    setTrail(rest)
    if (!prev) return
    goingBack.current = true
    useUI.getState().openPeek(prev, mode)
  }

  const close = () => {
    lastClosedAt = Date.now()
    useUI.getState().closePeek()
  }

  // side mode: a pointer-down anywhere outside closes the peek
  useEffect(() => {
    if (mode !== 'side') return
    const onDown = (e: PointerEvent) => {
      const target = e.target as Element | null
      if (!target?.closest || ref.current?.contains(target)) return
      if (target.closest('[data-popover], .modal-scrim, .pal-scrim, .toasts, [data-peek-keep], .sb-resize')) return
      close()
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [id, mode])

  const center = mode === 'center' || mobile
  const width = Math.min(0.9, Math.max(0.3, dragFrac ?? frac))

  const panel = (
    <div
      ref={ref}
      className="peek"
      data-mode={center ? 'center' : 'side'}
      data-instant={instant || undefined}
      role="dialog"
      aria-label={t('shell.peek.label')}
      style={center ? undefined : { width: `${width * 100}%` }}
    >
      {!center && (
        <div
          className="peek__resize"
          role="separator"
          aria-orientation="vertical"
          onPointerDown={(e) => {
            e.preventDefault()
            const vw = window.innerWidth
            let cur = width
            document.body.dataset.resizing = 'col'
            const move = (ev: PointerEvent) => {
              cur = Math.min(0.9, Math.max(0.3, (vw - ev.clientX) / vw))
              setDragFrac(cur)
            }
            const up = () => {
              window.removeEventListener('pointermove', move)
              window.removeEventListener('pointerup', up)
              delete document.body.dataset.resizing
              setDragFrac(null)
              setFrac(cur)
            }
            window.addEventListener('pointermove', move)
            window.addEventListener('pointerup', up)
          }}
        />
      )}
      <div className="peek__head">
        <Tooltip label={t('common.close')} shortcut="Esc">
          <button type="button" className="icon-btn" onClick={close}>
            <ChevronsRight size={16} />
          </button>
        </Tooltip>
        {trail.length > 0 && (
          <Tooltip label={t('shell.peek.back')}>
            <button type="button" className="icon-btn" onClick={back}>
              <ArrowLeft size={15} />
            </button>
          </Tooltip>
        )}
        <Tooltip label={t('shell.peek.openFull')}>
          <button
            type="button"
            className="icon-btn"
            onClick={() => {
              close()
              goToPage(id)
            }}
          >
            <Maximize2 size={14} />
          </button>
        </Tooltip>
        {!mobile && (
          <Tooltip label={center ? t('shell.peek.side') : t('shell.peek.center')}>
            <button type="button" className="icon-btn" onClick={() => useUI.getState().openPeek(id, center ? 'side' : 'center')}>
              {center ? <PanelRight size={15} /> : <SquareSplitHorizontal size={15} />}
            </button>
          </Tooltip>
        )}
        <PeekPath id={id} />
        <span className="peek__label label">{t('shell.peek.label')}</span>
      </div>
      <div className="peek__scroll">
        <PageView pageId={id} variant="peek" />
      </div>
    </div>
  )

  if (center)
    return (
      <div className="peek-scrim" data-instant={instant || undefined} onMouseDown={(e) => e.target === e.currentTarget && close()}>
        {panel}
      </div>
    )
  return panel
}

/** Parent chain of the peeked page (e.g. the database a row belongs to). */
function PeekPath({ id }: { id: string }) {
  const t = useT()
  const chain = useBreadcrumbs(id).slice(0, -1).slice(-2)
  if (!chain.length) return null
  return (
    <span className="peek__path">
      {chain.map((p, i) => (
        <span key={p.id} className="peek__crumb">
          {i > 0 && <span className="tb-sep">/</span>}
          <button type="button" className="tb-crumb" onClick={() => goToPage(p.id)}>
            <PageIcon icon={p.icon} kind={p.kind} size={14} />
            <span className="tb-crumb__title">{p.title.trim() || t('common.untitled')}</span>
          </button>
        </span>
      ))}
    </span>
  )
}

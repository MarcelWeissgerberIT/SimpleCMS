/**
 * The diagram viewer modal (lazy chunk of ui/viewer). The diagram is the source's SVG in the DOM, laid out
 * (width / height) at the zoom it rests at, so it is re-drawn as vector at every zoom; a CSS scale only
 * bridges a running gesture or step. The camera is pure (./view.ts); this component turns pointer, wheel
 * and keys into views and paints them.
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react'
import { Download, Map as MapIcon, Minus, Plus, Scan, X } from 'lucide-react'
import { Modal } from '../Modal'
import { Tooltip } from '../Tooltip'
import { MOD } from '../controls'
import { useT } from '../../i18n'
import { toast } from '../../store/ui'
import type { ViewerSource } from '.'
import { actualSize, centreOn, clampView, fitView, fitsInStage, panBy, visibleRect, wheelFactor, zoomAt, ZOOM_MAX, ZOOM_MIN, type Size, type View } from './view'
import './viewer.css'

/** + / − walk these (wheel and pinch zoom freely in between). */
const PRESETS = [0.1, 0.15, 0.25, 0.33, 0.5, 0.67, 0.8, 1, 1.25, 1.5, 2, 3, 4, 6, 8]
const PAN_STEP = 48
const PAN_STEP_BIG = 240
/** The minimap's largest box (px), desktop / phone. */
const MINI = { w: 200, h: 140 }
const MINI_NARROW = { w: 132, h: 92 }
const MINI_PAD = 6

/** Minimap on / off — remembered while the tab lives. */
let minimapPref = true

const reducedMotion = () => !!window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

function useThemeKey(): string {
  const [theme, setTheme] = useState(() => document.documentElement.dataset.theme ?? 'light')
  useEffect(() => {
    const obs = new MutationObserver(() => setTheme(document.documentElement.dataset.theme ?? 'light'))
    obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] })
    return () => obs.disconnect()
  }, [])
  return theme
}

function useNarrow(): boolean {
  const query = '(max-width: 640px)'
  const [narrow, setNarrow] = useState(() => !!window.matchMedia?.(query).matches)
  useEffect(() => {
    const mq = window.matchMedia?.(query)
    if (!mq) return
    const on = () => setNarrow(mq.matches)
    mq.addEventListener('change', on)
    return () => mq.removeEventListener('change', on)
  }, [])
  return narrow
}

/** The SVG's own size: its viewBox, else width / height. */
function naturalSize(svg: SVGSVGElement): Size | null {
  const vb = svg.viewBox?.baseVal
  if (vb && vb.width > 0 && vb.height > 0) return { w: vb.width, h: vb.height }
  const w = parseFloat(svg.getAttribute('width') ?? '')
  const h = parseFloat(svg.getAttribute('height') ?? '')
  return w > 0 && h > 0 ? { w, h } : null
}

/** Put markup into a host; the SVG is sized by attributes from now on (no max-width from its source). */
function place(host: HTMLElement, markup: string): SVGSVGElement | null {
  host.innerHTML = markup
  const svg = host.querySelector<SVGSVGElement>(':scope > svg')
  if (!svg) return null
  svg.style.maxWidth = 'none'
  svg.style.display = 'block'
  return svg
}

/** The minimap's copy: ids renamed (Mermaid scopes its CSS and arrow markers by the SVG's id). */
function miniMarkup(markup: string): string {
  const id = /^\s*<svg\b[^>]*?\sid="([^"]+)"/.exec(markup)?.[1]
  return id ? markup.split(id).join(`${id}-mini`) : markup
}

/** The shown SVG as a file of its own: its own size, the surface colour behind it, label metrics kept. */
function standaloneSvg(svg: SVGSVGElement, size: Size): string {
  const copy = svg.cloneNode(true) as SVGSVGElement
  copy.setAttribute('width', String(Math.ceil(size.w)))
  copy.setAttribute('height', String(Math.ceil(size.h)))
  copy.removeAttribute('style')
  const bg = getComputedStyle(document.documentElement).getPropertyValue('--surface').trim()
  if (bg) copy.style.backgroundColor = bg
  const style = document.createElementNS('http://www.w3.org/2000/svg', 'style')
  style.textContent = 'foreignObject p,foreignObject div,foreignObject span{margin:0;padding:0}foreignObject p,foreignObject span{line-height:1.125}'
  copy.insertBefore(style, copy.firstChild)
  return `<?xml version="1.0" encoding="UTF-8"?>\n${new XMLSerializer().serializeToString(copy)}`
}

function saveFile(text: string, name: string) {
  const url = URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' }))
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.rel = 'noopener'
  document.body.appendChild(a)
  a.click()
  a.remove()
  window.setTimeout(() => URL.revokeObjectURL(url), 4000)
}

type Gesture = { kind: 'pan'; x0: number; y0: number; v0: View; moved: boolean } | { kind: 'pinch'; d0: number; mx: number; my: number; v0: View }

export default function DiagramViewer({ source, onClose }: { source: ViewerSource; onClose: () => void }) {
  const t = useT()
  const theme = useThemeKey()
  const narrow = useNarrow()
  const rootRef = useRef<HTMLDivElement>(null)
  const stageRef = useRef<HTMLDivElement>(null)
  const hostRef = useRef<HTMLDivElement>(null)
  const miniRef = useRef<HTMLDivElement>(null)
  const mapRef = useRef<HTMLDivElement>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const miniSvgRef = useRef<SVGSVGElement | null>(null)
  const [stage, setStage] = useState<Size | null>(null)
  const [markup, setMarkup] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [content, setContent] = useState<Size | null>(null)
  const [view, setViewState] = useState<View | null>(null)
  const [miniOn, setMiniOn] = useState(minimapPref)
  const [dragging, setDragging] = useState(false)
  const [space, setSpace] = useState(false)
  const viewRef = useRef<View | null>(null)
  const sizes = useRef<{ content: Size | null; stage: Size | null }>({ content: null, stage: null })
  sizes.current = { content, stage }
  /** untouched since the last fit: a resize fits again */
  const fitted = useRef(true)
  const anim = useRef(0)
  /** where a running step ends: the next key press goes on from there */
  const goal = useRef<View | null>(null)
  const onCloseRef = useRef(onClose)
  onCloseRef.current = onClose

  const setView = useCallback((v: View) => {
    viewRef.current = v
    setViewState(v)
  }, [])

  /** A direct manipulation (drag, wheel, pinch): applied at once. */
  const commit = useCallback(
    (v: View) => {
      cancelAnimationFrame(anim.current)
      goal.current = null
      fitted.current = false
      setView(v)
    },
    [setView],
  )

  /** Keys and buttons: a short mechanical move (none with reduced motion). */
  const animate = useCallback(
    (target: View, fit = false) => {
      cancelAnimationFrame(anim.current)
      fitted.current = fit
      const from = viewRef.current
      if (!from || reducedMotion()) {
        goal.current = null
        setView(target)
        return
      }
      goal.current = target
      const t0 = performance.now()
      const step = () => {
        const k = Math.min(1, Math.max(0, (performance.now() - t0) / 140))
        const e = 1 - (1 - k) ** 3
        setView(k >= 1 ? target : { s: from.s * (target.s / from.s) ** e, x: from.x + (target.x - from.x) * e, y: from.y + (target.y - from.y) * e })
        if (k < 1) anim.current = requestAnimationFrame(step)
        else goal.current = null
      }
      anim.current = requestAnimationFrame(step)
    },
    [setView],
  )
  useEffect(() => () => cancelAnimationFrame(anim.current), [])

  /* ---------- size of the canvas ---------- */
  useLayoutEffect(() => {
    const el = stageRef.current
    if (!el) return
    const measure = () => setStage((prev) => (prev && prev.w === el.clientWidth && prev.h === el.clientHeight ? prev : { w: el.clientWidth, h: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  /* ---------- the drawing (again on a theme switch when its colours are written in) ---------- */
  const ready = !!stage && stage.w > 0
  const themeKey = source.themed ? theme : ''
  useEffect(() => {
    if (!ready) return
    const el = stageRef.current
    let alive = true
    Promise.resolve()
      .then(() => source.render({ w: el?.clientWidth ?? 800, h: el?.clientHeight ?? 600 }))
      .then(
        (svg) => {
          if (!alive) return
          setMarkup(svg)
          setError(null)
        },
        (err) => {
          if (!alive) return
          setError(String((err as Error)?.message ?? err).split('\n').slice(0, 3).join('\n'))
        },
      )
    return () => {
      alive = false
    }
  }, [ready, themeKey, source])

  useLayoutEffect(() => {
    const host = hostRef.current
    if (!host || markup === null) return
    const svg = place(host, markup)
    svgRef.current = svg
    miniSvgRef.current = miniRef.current ? place(miniRef.current, miniMarkup(markup)) : null
    const size = svg ? naturalSize(svg) : null
    if (!size) {
      setError(t('ui.viewer.failed'))
      return
    }
    setContent((prev) => (prev && Math.abs(prev.w - size.w) < 0.5 && Math.abs(prev.h - size.h) < 0.5 ? prev : size))
  }, [markup]) // eslint-disable-line react-hooks/exhaustive-deps

  /* ---------- first view: fit; resizes keep the view inside (or fit again while untouched) ---------- */
  useLayoutEffect(() => {
    if (!content || !stage) return
    const v = viewRef.current
    setView(!v || fitted.current ? fitView(content, stage) : clampView(v, content, stage))
  }, [content, stage, setView])

  /* ---------- paint: the host's translation is the pan; the zoom is the SVG's own size once it rests
     (laid out again as vector), a transform on top while a gesture or a step is still moving ---------- */
  const [laidOut, setLaidOut] = useState<number | null>(null)
  const scale = view?.s ?? null
  useEffect(() => {
    if (scale === null) return
    const id = window.setTimeout(() => setLaidOut(scale), 120)
    return () => window.clearTimeout(id)
  }, [scale])
  useLayoutEffect(() => {
    const svg = svgRef.current
    const host = hostRef.current
    if (!svg || !host || !view || !content) return
    const base = laidOut ?? view.s
    svg.setAttribute('width', String(content.w * base))
    svg.setAttribute('height', String(content.h * base))
    const k = view.s / base
    host.style.transform = `translate(${Math.round(view.x)}px, ${Math.round(view.y)}px)${Math.abs(k - 1) > 1e-4 ? ` scale(${k})` : ''}`
  }, [view, content, markup, laidOut])

  const box = narrow ? MINI_NARROW : MINI
  const mini = content ? Math.min((box.w - 2 * MINI_PAD) / content.w, (box.h - 2 * MINI_PAD) / content.h) : 0
  useLayoutEffect(() => {
    const svg = miniSvgRef.current
    if (!svg || !content) return
    svg.setAttribute('width', String(content.w * mini))
    svg.setAttribute('height', String(content.h * mini))
  }, [mini, content, markup])

  /* ---------- actions ---------- */
  const zoomStep = useCallback(
    (dir: 1 | -1, px?: number, py?: number) => {
      const v = goal.current ?? viewRef.current
      const { content: c, stage: s } = sizes.current
      if (!v || !c || !s) return
      const next = dir > 0 ? (PRESETS.find((p) => p > v.s * 1.02) ?? ZOOM_MAX) : ([...PRESETS].reverse().find((p) => p < v.s / 1.02) ?? ZOOM_MIN)
      animate(zoomAt(v, next, px ?? s.w / 2, py ?? s.h / 2, c, s))
    },
    [animate],
  )
  const zoomBy = useCallback(
    (factor: number, px: number, py: number) => {
      const v = goal.current ?? viewRef.current
      const { content: c, stage: s } = sizes.current
      if (v && c && s) animate(zoomAt(v, v.s * factor, px, py, c, s))
    },
    [animate],
  )
  const fit = useCallback(() => {
    const { content: c, stage: s } = sizes.current
    if (c && s) animate(fitView(c, s), true)
  }, [animate])
  const actual = useCallback(() => {
    const v = goal.current ?? viewRef.current
    const { content: c, stage: s } = sizes.current
    if (v && c && s) animate(actualSize(v, c, s))
  }, [animate])
  const pan = useCallback(
    (dx: number, dy: number) => {
      const v = goal.current ?? viewRef.current
      const { content: c, stage: s } = sizes.current
      if (v && c && s) animate(panBy(v, dx, dy, c, s))
    },
    [animate],
  )
  const toggleMini = useCallback(() => {
    setMiniOn((on) => {
      minimapPref = !on
      return !on
    })
  }, [])

  const download = async () => {
    const svg = svgRef.current
    if (!svg || !content || markup === null) return
    try {
      saveFile(source.file ? await source.file(markup) : standaloneSvg(svg, content), source.fileName)
    } catch (err) {
      console.warn('[viewer] download failed', err)
      toast({ message: t('ui.viewer.downloadFailed'), kind: 'error' })
    }
  }

  /* ---------- keys (the dialog's own, also while a button has focus) ---------- */
  useEffect(() => {
    const inside = () => {
      const dialog = rootRef.current?.closest('[role="dialog"]')
      const active = document.activeElement
      return !!dialog && !!active && (dialog === active || dialog.contains(active))
    }
    const onKey = (e: KeyboardEvent) => {
      if (!inside()) return
      if (e.key === 'Escape') {
        // before a tooltip's own Escape: one press closes the viewer
        e.preventDefault()
        e.stopImmediatePropagation()
        onCloseRef.current()
        return
      }
      if (e.altKey) return
      const mod = e.ctrlKey || e.metaKey
      const onButton = !!(e.target as Element | null)?.closest?.('button')
      const big = e.shiftKey ? PAN_STEP_BIG : PAN_STEP
      switch (e.key) {
        case '+':
        case '=':
          zoomStep(1)
          break
        case '-':
        case '_':
          zoomStep(-1)
          break
        case '0':
          fit()
          break
        case '1':
          if (mod) return
          actual()
          break
        case 'm':
        case 'M':
          if (mod) return
          toggleMini()
          break
        case 'ArrowLeft':
          if (mod) return
          pan(big, 0)
          break
        case 'ArrowRight':
          if (mod) return
          pan(-big, 0)
          break
        case 'ArrowUp':
          if (mod) return
          pan(0, big)
          break
        case 'ArrowDown':
          if (mod) return
          pan(0, -big)
          break
        case ' ':
          if (onButton || mod) return
          setSpace(true)
          break
        default:
          return
      }
      e.preventDefault()
    }
    const onKeyUp = (e: KeyboardEvent) => e.key === ' ' && setSpace(false)
    const onBlur = () => setSpace(false)
    document.addEventListener('keydown', onKey, true)
    document.addEventListener('keyup', onKeyUp, true)
    window.addEventListener('blur', onBlur)
    return () => {
      document.removeEventListener('keydown', onKey, true)
      document.removeEventListener('keyup', onKeyUp, true)
      window.removeEventListener('blur', onBlur)
    }
  }, [zoomStep, fit, actual, pan, toggleMini])

  /* ---------- wheel: Ctrl / ⌘ + wheel and trackpad pinch zoom at the pointer, the plain wheel pans ---------- */
  useEffect(() => {
    const el = stageRef.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      e.preventDefault()
      const v = viewRef.current
      const { content: c, stage: s } = sizes.current
      if (!v || !c || !s) return
      const r = el.getBoundingClientRect()
      if (e.ctrlKey || e.metaKey) {
        commit(zoomAt(v, v.s * wheelFactor(e.deltaY, e.deltaMode), e.clientX - r.left, e.clientY - r.top, c, s))
        return
      }
      const k = e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? s.h : 1
      let dx = e.deltaX * k
      let dy = e.deltaY * k
      if (e.shiftKey && !dx) [dx, dy] = [dy, 0]
      commit(panBy(v, -dx, -dy, c, s))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [commit])

  /* ---------- pointer: drag pans, two fingers pinch, a double tap zooms in ---------- */
  const pointers = useRef(new Map<number, { x: number; y: number }>())
  const gesture = useRef<Gesture | null>(null)
  const lastTap = useRef<{ x: number; y: number; t: number } | null>(null)
  const local = (e: { clientX: number; clientY: number }) => {
    const r = stageRef.current!.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  const startGesture = () => {
    const pts = [...pointers.current.values()]
    const v = viewRef.current
    if (!v || !pts.length) gesture.current = null
    else if (pts.length >= 2) {
      const [a, b] = pts
      gesture.current = { kind: 'pinch', d0: Math.max(1, Math.hypot(a.x - b.x, a.y - b.y)), mx: (a.x + b.x) / 2, my: (a.y + b.y) / 2, v0: v }
    } else gesture.current = { kind: 'pan', x0: pts[0].x, y0: pts[0].y, v0: v, moved: false }
    setDragging(pts.length > 0)
  }
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    if ((e.target as Element).closest('.dv-mini')) return
    e.currentTarget.setPointerCapture?.(e.pointerId)
    pointers.current.set(e.pointerId, local(e))
    startGesture()
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    const p = local(e)
    pointers.current.set(e.pointerId, p)
    const g = gesture.current
    const { content: c, stage: s } = sizes.current
    if (!g || !c || !s) return
    if (g.kind === 'pinch') {
      const [a, b] = [...pointers.current.values()]
      if (!b) return
      const z = zoomAt(g.v0, (g.v0.s * Math.hypot(a.x - b.x, a.y - b.y)) / g.d0, g.mx, g.my, c, s)
      commit(panBy(z, (a.x + b.x) / 2 - g.mx, (a.y + b.y) / 2 - g.my, c, s))
      return
    }
    const dx = p.x - g.x0
    const dy = p.y - g.y0
    if (!g.moved && Math.hypot(dx, dy) < 3) return
    g.moved = true
    commit(panBy(g.v0, dx, dy, c, s))
  }
  const onPointerUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!pointers.current.has(e.pointerId)) return
    const g = gesture.current
    pointers.current.delete(e.pointerId)
    // touch: a double tap zooms in around it (mice get dblclick)
    if (e.pointerType !== 'mouse' && e.type === 'pointerup' && g?.kind === 'pan' && !g.moved && !pointers.current.size) {
      const p = local(e)
      const now = performance.now()
      const last = lastTap.current
      if (last && now - last.t < 320 && Math.hypot(p.x - last.x, p.y - last.y) < 30) {
        lastTap.current = null
        zoomBy(2, p.x, p.y)
      } else lastTap.current = { ...p, t: now }
    }
    startGesture()
  }

  /* ---------- minimap: click centres there, dragging the rectangle pans ---------- */
  const miniDrag = useRef<{ dx: number; dy: number } | null>(null)
  const miniPoint = (e: { clientX: number; clientY: number }) => {
    const r = mapRef.current!.getBoundingClientRect()
    return { x: (e.clientX - r.left) / mini, y: (e.clientY - r.top) / mini }
  }
  const onMiniDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return
    const v = viewRef.current
    const { content: c, stage: s } = sizes.current
    if (!v || !c || !s || !mini) return
    e.preventDefault()
    e.stopPropagation()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    const p = miniPoint(e)
    const r = visibleRect(v, c, s)
    const onRect = p.x >= r.x && p.x <= r.x + r.w && p.y >= r.y && p.y <= r.y + r.h
    // grabbed the rectangle: it keeps its hold; elsewhere: the view centres on the point
    miniDrag.current = onRect ? { dx: p.x - (r.x + r.w / 2), dy: p.y - (r.y + r.h / 2) } : { dx: 0, dy: 0 }
    if (!onRect) commit(centreOn(v, p.x, p.y, c, s))
  }
  const onMiniMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = miniDrag.current
    const v = viewRef.current
    const { content: c, stage: s } = sizes.current
    if (!d || !v || !c || !s) return
    const p = miniPoint(e)
    commit(centreOn(v, p.x - d.dx, p.y - d.dy, c, s))
  }
  const onMiniUp = () => {
    miniDrag.current = null
  }

  /* ---------- render ---------- */
  const pct = view ? Math.round(view.s * 100) : 100
  const kindLabel = t(source.kind === 'chart' ? 'ui.viewer.chart' : 'ui.viewer.diagram')
  const plate = source.type ? `${kindLabel} · ${source.type}` : kindLabel
  const overflow = !!view && !!content && !!stage && !fitsInStage(view, content, stage)
  const showMini = miniOn && overflow && !!markup
  const rect = view && content && stage ? visibleRect(view, content, stage) : null
  const loading = markup === null && !error

  return (
    <Modal open onClose={onClose} bare className="dv-modal" ariaLabel={source.title ? `${plate} — ${source.title}` : plate}>
      <div className="dv" ref={rootRef} data-testid="diagram-viewer">
        <header className="dv__head">
          <div className="dv__id">
            <span className="label dv__plate" data-testid="viewer-plate">
              § {plate}
            </span>
            {source.title && <span className="dv__title">{source.title}</span>}
          </div>
          <div className="dv__tools" role="toolbar" aria-label={t('ui.viewer.tools')}>
            <span className="dv__zoom">
              <Tooltip label={t('ui.viewer.zoomOut')} shortcut="−">
                <button type="button" className="dv__key" onClick={() => zoomStep(-1)} disabled={!view || view.s <= ZOOM_MIN + 1e-6}>
                  <Minus size={15} strokeWidth={1.75} aria-hidden />
                </button>
              </Tooltip>
              <output className="label dv__readout" data-testid="viewer-zoom">
                {narrow ? `${pct} %` : t('ui.viewer.zoom', { pct })}
              </output>
              <Tooltip label={t('ui.viewer.zoomIn')} shortcut="+">
                <button type="button" className="dv__key" onClick={() => zoomStep(1)} disabled={!view || view.s >= ZOOM_MAX - 1e-6}>
                  <Plus size={15} strokeWidth={1.75} aria-hidden />
                </button>
              </Tooltip>
            </span>
            <Tooltip label={t('ui.viewer.fitLong')} shortcut="0">
              <button type="button" className="dv__key dv__key--text" onClick={fit} disabled={!view}>
                <Scan size={14} strokeWidth={1.75} aria-hidden />
                <span className="dv__key-word">{t('ui.viewer.fit')}</span>
              </button>
            </Tooltip>
            <Tooltip label={t('ui.viewer.actualLong')} shortcut="1">
              <button type="button" className="dv__key dv__key--text" onClick={actual} disabled={!view}>
                100 %
              </button>
            </Tooltip>
            <Tooltip label={t('ui.viewer.minimap')} shortcut="M">
              <button type="button" className="dv__key" aria-pressed={miniOn} onClick={toggleMini} data-testid="viewer-minimap-toggle">
                <MapIcon size={15} strokeWidth={1.75} aria-hidden />
              </button>
            </Tooltip>
            <Tooltip label={t('ui.viewer.download')}>
              <button type="button" className="dv__key dv__key--text" onClick={() => void download()} disabled={markup === null}>
                <Download size={14} strokeWidth={1.75} aria-hidden />
                <span className="dv__key-word">SVG</span>
              </button>
            </Tooltip>
          </div>
          <button type="button" className="dv__key dv__close" onClick={onClose} aria-label={t('common.close')}>
            <X size={16} strokeWidth={1.75} aria-hidden />
          </button>
        </header>
        <div
          ref={stageRef}
          className={`dv__stage${dragging ? ' is-dragging' : ''}${space ? ' is-space' : ''}`}
          role="application"
          aria-label={t('ui.viewer.canvas')}
          aria-roledescription={t('ui.viewer.canvasRole')}
          tabIndex={0}
          data-autofocus
          data-testid="viewer-stage"
          onPointerDown={onPointerDown}
          onPointerMove={onPointerMove}
          onPointerUp={onPointerUp}
          onPointerCancel={onPointerUp}
          onDoubleClick={(e) => {
            if ((e.target as Element).closest('.dv-mini')) return
            const p = local(e)
            zoomBy(e.shiftKey ? 0.5 : 2, p.x, p.y)
          }}
          style={view ? { backgroundPosition: `${Math.round(view.x)}px ${Math.round(view.y)}px` } : undefined}
        >
          <div ref={hostRef} className={`dv__content dv-svg ${source.className ?? ''}`} hidden={!!error} />
          {loading && <span className="label dv__state">{t('common.loading')}</span>}
          {error && (
            <div className="dv__state dv__error" role="alert">
              <span className="label">{t('ui.viewer.failed')}</span>
              <pre>{error}</pre>
            </div>
          )}
          <div
            className="dv-mini"
            hidden={!showMini}
            aria-label={t('ui.viewer.minimapLabel')}
            data-testid="viewer-minimap"
            onPointerDown={onMiniDown}
            onPointerMove={onMiniMove}
            onPointerUp={onMiniUp}
            onPointerCancel={onMiniUp}
          >
            <div ref={mapRef} className="dv-mini__map" style={content ? { width: content.w * mini, height: content.h * mini } : undefined}>
              <div ref={miniRef} className={`dv-mini__svg dv-svg ${source.className ?? ''}`} aria-hidden />
              {rect && (
                <div
                  className="dv-mini__view"
                  data-testid="viewer-minimap-view"
                  style={{ left: rect.x * mini, top: rect.y * mini, width: Math.max(4, rect.w * mini), height: Math.max(4, rect.h * mini) }}
                />
              )}
            </div>
          </div>
        </div>
        <footer className="dv__foot" aria-hidden>
          <span>
            <kbd className="kbd">+</kbd>
            <kbd className="kbd">−</kbd> {t('ui.viewer.keys.zoom')}
          </span>
          <span>
            <kbd className="kbd">{MOD}</kbd> + {t('ui.viewer.keys.wheel')}
          </span>
          <span>
            <kbd className="kbd">0</kbd> {t('ui.viewer.fit')}
          </span>
          <span>
            <kbd className="kbd">1</kbd> 100 %
          </span>
          <span>
            <kbd className="kbd">M</kbd> {t('ui.viewer.minimap')}
          </span>
          <span>
            <kbd className="kbd">←</kbd>
            <kbd className="kbd">↑</kbd>
            <kbd className="kbd">→</kbd>
            <kbd className="kbd">↓</kbd> {t('ui.viewer.keys.move')}
          </span>
          <span>
            <kbd className="kbd">Esc</kbd> {t('common.close')}
          </span>
          <span className="dv__hint">{t('ui.viewer.keys.mouse')}</span>
        </footer>
      </div>
    </Modal>
  )
}

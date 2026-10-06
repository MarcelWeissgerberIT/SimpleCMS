/**
 * Diagram viewer — a near-full-screen modal that shows one diagram as vector SVG: zoom (Ctrl / ⌘ + wheel,
 * pinch, + / −, double-click), pan (drag, wheel, arrows, Space + drag), Fit / 100 %, a minimap and
 * Download SVG. Any area opens it with a ViewerSource; the viewer knows nothing about Mermaid or charts.
 * Like the chart builder it lives in its own small React root, the UI itself is a lazy chunk.
 *
 *   openDiagramViewer(source, { from? })   one at a time (a second call replaces the first)
 *   closeDiagramViewer() · isDiagramViewerOpen()
 *   viewerAllowed(el) · useViewerAllowed(() => el): not from a presentation or a popover (VIEWER_OFF)
 */
import { Component, lazy, Suspense, useEffect, useState, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { create } from 'zustand'

export interface ViewerSource {
  /** first word of the spec plate: 'diagram' (Mermaid) | 'chart' */
  kind: 'diagram' | 'chart'
  /** second word: the diagram's type, already translated ("Flowchart", "Bar") */
  type?: string
  /** the diagram's own title (chart title, Mermaid front-matter title) */
  title?: string
  /**
   * The SVG markup to show. `stage`: the canvas size in px (a chart draws itself for it). Called again on a
   * theme switch when `themed` (colours written into the markup, like Mermaid's).
   */
  render: (stage: { w: number; h: number }) => Promise<string> | string
  themed?: boolean
  /** extra class on the SVG's host (diagram-specific CSS) */
  className?: string
  /** Download SVG */
  fileName: string
  /** the file's markup (default: what the viewer shows, at its own size, on the surface colour) */
  file?: (shown: string) => Promise<string> | string
}

export interface ViewerOptions {
  /** where focus goes back to on close (default: what has focus now) */
  from?: HTMLElement | null
}

interface Request {
  source: ViewerSource
  key: number
}

const useViewer = create<{ req: Request | null }>(() => ({ req: null }))
const LazyViewer = lazy(() => import('./DiagramViewer'))

class Guard extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[viewer] failed', err)
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function Host() {
  const req = useViewer((s) => s.req)
  if (!req) return null
  const close = () => {
    if (useViewer.getState().req?.key === req.key) useViewer.setState({ req: null })
  }
  return (
    <Guard key={req.key} onFail={close}>
      <Suspense fallback={null}>
        <LazyViewer source={req.source} onClose={close} />
      </Suspense>
    </Guard>
  )
}

let root: Root | null = null
let seq = 0

function ensureHost() {
  if (root || typeof document === 'undefined') return
  const el = document.createElement('div')
  el.setAttribute('data-diagram-viewer', '')
  document.body.appendChild(el)
  root = createRoot(el)
  root.render(<Host />)
}

/**
 * Where no viewer opens from (its keys and double-click stay off there): a presentation owns every key, and a
 * popover (the AI panel's previews) closes on the first press outside it. CSS hides the keys with the same list.
 */
export const VIEWER_OFF = '.pres, [data-popover]'

export function viewerAllowed(el: Element | null | undefined): boolean {
  return !el?.closest(VIEWER_OFF)
}

/** viewerAllowed() for a block's keys, checked once it sits in the page (until then the CSS hides them). */
export function useViewerAllowed(el: () => Element | null | undefined): boolean {
  const [ok, setOk] = useState(true)
  useEffect(() => setOk(viewerAllowed(el())), []) // eslint-disable-line react-hooks/exhaustive-deps
  return ok
}

export function openDiagramViewer(source: ViewerSource, opts: ViewerOptions = {}): void {
  ensureHost()
  // the modal hands focus back to what had it when it opened
  if (opts.from?.isConnected) opts.from.focus({ preventScroll: true })
  useViewer.setState({ req: { source, key: ++seq } })
}

export function closeDiagramViewer(): void {
  useViewer.setState({ req: null })
}

export function isDiagramViewerOpen(): boolean {
  return !!useViewer.getState().req
}

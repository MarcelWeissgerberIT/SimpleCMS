/**
 * openChartBuilder(): the builder is a modal in its own small React root (any area can open it
 * — the chart block, a spreadsheet's toolbar — without a modal type in the shell). The builder
 * UI itself is a lazy chunk.
 */
import { Component, lazy, Suspense, type ReactNode } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { create } from 'zustand'
import type { CellValue, ChartSource, ChartSourceKind, ChartSpec } from '../types'

export type BuilderStep = 'source' | 'type' | 'options'

export interface ChartBuilderOptions {
  /** edit this spec (absent: a new chart) */
  initial?: ChartSpec | null
  /** start from this source (e.g. a spreadsheet's selection: { kind: 'inline', ref }) */
  source?: ChartSource
  /** sources to offer (default: sheet, database, system, manual) */
  allowedSources?: ChartSourceKind[]
  onSave: (spec: ChartSpec) => void
  onCancel?: () => void
  /** step to open on (default: data for new charts, type when `source` is given) */
  step?: BuilderStep
  /** the page the chart sits on: its spreadsheets and databases come first */
  pageId?: string | null
  /** inline sources: computed cells of a ref (the spreadsheet passes its own reader) */
  inline?: (ref: string) => { values: CellValue[][]; error?: string }
}

interface Request extends ChartBuilderOptions {
  key: number
}

const useBuilder = create<{ req: Request | null }>(() => ({ req: null }))
const LazyBuilder = lazy(() => import('./ChartBuilder'))

class Guard extends Component<{ children: ReactNode; onFail: () => void }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[charts] builder failed', err)
    this.props.onFail()
  }
  render() {
    return this.state.failed ? null : this.props.children
  }
}

function Host() {
  const req = useBuilder((s) => s.req)
  if (!req) return null
  const close = () => {
    if (useBuilder.getState().req?.key === req.key) useBuilder.setState({ req: null })
  }
  return (
    <Guard key={req.key} onFail={close}>
      <Suspense fallback={null}>
        <LazyBuilder {...req} onClose={close} />
      </Suspense>
    </Guard>
  )
}

let root: Root | null = null
let seq = 0

function ensureHost() {
  if (root || typeof document === 'undefined') return
  const el = document.createElement('div')
  el.setAttribute('data-chart-builder', '')
  document.body.appendChild(el)
  root = createRoot(el)
  root.render(<Host />)
}

/** Open the chart builder (one at a time; a second call replaces the first, which counts as cancelled). */
export function openChartBuilder(opts: ChartBuilderOptions): void {
  ensureHost()
  const prev = useBuilder.getState().req
  if (prev) prev.onCancel?.()
  useBuilder.setState({ req: { ...opts, key: ++seq } })
}

export function closeChartBuilder(): void {
  const prev = useBuilder.getState().req
  if (!prev) return
  useBuilder.setState({ req: null })
  prev.onCancel?.()
}

export function isChartBuilderOpen(): boolean {
  return !!useBuilder.getState().req
}

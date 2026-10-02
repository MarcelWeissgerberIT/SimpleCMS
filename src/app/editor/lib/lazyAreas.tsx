/**
 * Cross-area components loaded lazily: keeps the editor chunk small and isolates
 * failures (a broken database/AI module never takes the editor down).
 */
import { Component, lazy, Suspense, type ReactNode } from 'react'
import type { DatabaseViewProps } from '../../database'
import type { AIMenuProps } from '../../features'

const LazyDatabaseView = lazy(() => import('../../database').then((m) => ({ default: m.DatabaseView })))
const LazyAIMenu = lazy(() => import('../../features').then((m) => ({ default: m.AIMenu })))

class Boundary extends Component<{ fallback: ReactNode; children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() {
    return { failed: true }
  }
  componentDidCatch(err: unknown) {
    console.warn('[editor] embedded component failed', err)
  }
  render() {
    return this.state.failed ? this.props.fallback : this.props.children
  }
}

export function InlineDatabase(props: DatabaseViewProps & { fallback: ReactNode; loading: ReactNode }) {
  const { fallback, loading, ...rest } = props
  return (
    <Boundary fallback={fallback}>
      <Suspense fallback={loading}>
        <LazyDatabaseView {...rest} />
      </Suspense>
    </Boundary>
  )
}

export function AIMenuSlot(props: AIMenuProps) {
  return (
    <Boundary fallback={null}>
      <Suspense fallback={null}>
        <LazyAIMenu {...props} />
      </Suspense>
    </Boundary>
  )
}

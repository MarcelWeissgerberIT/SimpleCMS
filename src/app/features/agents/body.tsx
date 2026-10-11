/**
 * AgentChangeBody for other areas (agents/index.ts): the run history's own per-proposal body, loaded with the agents
 * page's code on first use (it never joins the boot bundle). Renders nothing until that code is there.
 */
import { lazy, Suspense } from 'react'
import type { StagedChange } from '../ai/agent/types'
import type { AgentRun } from './types'

const Body = lazy(() => import('./RunHistory').then((m) => ({ default: m.AgentChangeBody })))

export function AgentChangeBody(props: { run: AgentRun; change: StagedChange }) {
  return (
    <Suspense fallback={null}>
      <Body {...props} />
    </Suspense>
  )
}

/** The kinds a custom agent stages that AgentChangeBody shows in full (any other kind: open it on the agents page). */
export const AGENT_BODY_KINDS: ReadonlyArray<StagedChange['kind']> = ['create_page', 'create_row', 'append', 'edit', 'update_row', 'rename', 'send']

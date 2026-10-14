/**
 * MCP · Connections — what the page reads, kept current: this device's servers (settings.mcpServers, sanitized by
 * readServers), the refusals noted in this tab (memory only — onRefusedChanged), the minute (a sign-in runs out), the
 * worker link's level by the Worker lamp's rule and clock, and the browser agents that run here.
 */
import { useEffect, useMemo, useState } from 'react'
import { useWorkspace } from '../../../store/store'
import { useCloud } from '../../../cloud'
import { useCoding } from '../../coding'
import { onRefusedChanged, readServers } from '../../ai/mcp-servers/config'
import { workerDownSince } from '../../preflight/sources/worker'
import { WORKER_GRACE_MS, workerLinkDown } from '../../preflight/sources/workerRule'
import { agentsOfThisBrowser, workerLed, type Level } from './model'

/** One's Claude's servers on this device, in Settings order. */
export function useServers() {
  const raw = useWorkspace((s) => s.settings.mcpServers)
  return useMemo(() => readServers({ mcpServers: raw }), [raw])
}

/** Re-renders when a server is refused (or cleared) in this tab — refusedHere() reads the note itself. */
export function useRefusedRev(): number {
  const [rev, setRev] = useState(0)
  useEffect(() => onRefusedChanged(() => setRev((n) => n + 1)), [])
  return rev
}

/** Now, to the half minute (a sign-in that runs out turns its row red without a reload). */
export function useNow(): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000)
    return () => window.clearInterval(id)
  }, [])
  return now
}

/**
 * The worker link's level (model.ts workerLed) on the Worker lamp's own clock (workerDownSince): a link down for the
 * lamp's grace turns red when the grace ends — a timer, not the next half-minute tick. `since`: down since (null: up).
 */
export function useWorkerLevel(): { level: Level; since: number | null } {
  const enabled = useCoding((s) => s.enabled)
  const conn = useCoding((s) => s.conn)
  const worker = useCoding((s) => s.worker)
  const can = useCoding((s) => s.can)
  const [, setTick] = useState(0)
  // read on every render: the lamp's clock notes a change of `conn` (useCoding re-renders on one)
  const now = Date.now()
  const since = workerDownSince(now)
  const down = enabled && conn !== 'connected' && workerLinkDown(conn, since, now)
  useEffect(() => {
    if (!enabled || conn === 'connected' || down || since === null) return
    const id = window.setTimeout(() => setTick((n) => n + 1), Math.max(0, since + WORKER_GRACE_MS - Date.now()) + 50)
    return () => window.clearTimeout(id)
  }, [enabled, conn, down, since])
  return { level: workerLed({ enabled, conn, worker, can }, since, now), since: conn === 'connected' ? null : since }
}

/** The browser agents whose runs happen in this browser (model.ts agentsOfThisBrowser: in a team, the member's own). */
export function useAgentsHere() {
  const agents = useWorkspace((s) => s.agents)
  const team = useCloud((s) => s.active.kind === 'cloud')
  const me = useCloud((s) => s.user?.id ?? null)
  const readOnly = useCloud((s) => s.readOnly)
  return useMemo(() => agentsOfThisBrowser(Object.values(agents ?? {}), team ? { me, readOnly } : null), [agents, team, me, readOnly])
}

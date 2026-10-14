/**
 * The Worker lamp's rule for a link that is not connected (pure — the lamp and MCP · Connections both read it, so the
 * page's row is red exactly when the lamp is): refused / blocked / replaced count at once; connecting / waiting / off
 * only once the link has been down for the grace (a reconnect a moment long is no trouble).
 */
export const WORKER_GRACE_MS = 60_000

const DEFINITE = new Set(['refused', 'blocked', 'replaced'])

/** The link counts as down (the lamp's red). `since`: when this tab saw it go down (null: not known — from now). */
export function workerLinkDown(conn: string, since: number | null, now: number): boolean {
  if (conn === 'connected') return false
  return DEFINITE.has(conn) || now - (since ?? now) >= WORKER_GRACE_MS
}

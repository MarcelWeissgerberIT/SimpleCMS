/**
 * The fuse count in the background (plan §1.2, §1.8, §6 A16) — its own chunk, loaded by counts.ts `startCounts` after
 * the first paint, in idle; never at boot and never a ledger read. The sidebar LED, the Preflight lamp and the status
 * cell know the open fuses before the Patchbay was ever opened in this tab:
 *
 *  1. the lazy cache (IndexedDB `one-patchbay` `<scope>|lazy` — script scans, the runtime's servers, team hooks and
 *     tokens, the capture Inbox; ids and hosts only) is read FIRST, so the first count already holds what an earlier
 *     visit read (a reading the cache lacks is an unknown part, never a clean "none");
 *  2. the model is built from the eager inputs plus that cache (state.ts refreshModel — the page's own model: the
 *     counts and the hints are published there);
 *  3. it is read again in idle whenever the wiring may have moved: a workspace field the wiring signature reads (never
 *     `pages` alone — typing rebuilds nothing; the referenced pages come through the row index, inputs.ts
 *     onPagesMoved), this device's facts (the cloud role and account, the bridge, the coding worker, the sync, MCP
 *     tests, kit trust) and a lazy reading arriving. The input memo answers with the same input when nothing it reads
 *     changed — then nothing is built.
 * Another member scope (a team account becoming known, another workspace): the lazy cache is read again.
 */
import { useWorkspace } from '../../store/store'
import { useCloud } from '../../cloud'
import { useCoding } from '../coding'
import { useMcp } from '../mcp'
import { onSyncState } from '../sync'
import { useMcpChecks } from '../ai/mcp-servers'
import { useKitTrust } from '../kit'
import { loadLazyCache, onInputs, onPagesMoved } from './inputs'
import { refreshModel } from './state'
import { patchbayScope } from './scope'

/** The workspace fields the wiring signature reads (source.ts) — `pages` only through the row index. */
const WIRING = ['databases', 'agents', 'scripts', 'integrations', 'kit', 'ai', 'governor', 'fuseSignoffs', 'settings'] as const

const idle = (fn: () => void): void => {
  const ric = (globalThis as { requestIdleCallback?: (cb: () => void, o?: { timeout: number }) => number }).requestIdleCallback
  if (ric) ric(fn, { timeout: 1000 })
  else setTimeout(fn, 50)
}

let running: (() => void) | null = null

/** Start the background count (once); returns the stop. */
export function startCompute(): () => void {
  if (running) return running
  let alive = true
  let ready = false
  let pending = false
  const soon = () => {
    if (!ready || pending) return
    pending = true
    idle(() => {
      pending = false
      if (alive) refreshModel()
    })
  }

  // the scope the lazy cache was read for: another one (a team account known now, another workspace) reads it again
  let scope = patchbayScope()
  const readCache = () => {
    void loadLazyCache()
      .catch(() => null)
      .finally(() => {
        if (!alive) return
        ready = true
        soon()
      })
  }
  readCache()

  const subs: Array<() => void> = [
    useWorkspace.subscribe((s, p) => {
      if (WIRING.some((k) => s[k] !== p[k])) soon()
    }),
    useCloud.subscribe((s, p) => {
      const next = patchbayScope()
      if (next !== scope) {
        scope = next
        readCache()
        return
      }
      if (s.role !== p.role || s.readOnly !== p.readOnly || s.supports !== p.supports || s.user?.id !== p.user?.id || s.active !== p.active) soon()
    }),
    useCoding.subscribe((s, p) => {
      if (s.enabled !== p.enabled || s.conn !== p.conn || s.can !== p.can || s.worker !== p.worker) soon()
    }),
    useMcp.subscribe((s, p) => {
      if (s.enabled !== p.enabled || s.mode !== p.mode) soon()
    }),
    useMcpChecks.subscribe((s, p) => {
      if (s.running !== p.running) soon()
    }),
    useKitTrust.subscribe((s, p) => {
      if (s.ok !== p.ok) soon()
    }),
    onSyncState(() => soon()),
    onPagesMoved(soon),
    onInputs(soon),
  ]

  running = () => {
    alive = false
    for (const off of subs.splice(0)) off()
    running = null
  }
  return running
}

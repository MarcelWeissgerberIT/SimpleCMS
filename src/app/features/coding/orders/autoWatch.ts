/**
 * Work orders — the lapse of "Ohne Bestätigung starten" (Orders B11, spec §3.5 / §4 "a config change lapses an
 * allowance, and with it the consent"): this device's consent covers the settings it was given for (autoSig.ts). Once the
 * workspace is loaded, every change that can move them — the work-orders config, a pipeline, a project picked on
 * #/coding, this device's Approvals, an MCP server or integration profile — is followed (debounced) by the sig again; a
 * consent whose sig no longer matches LAPSES (auto.ts lapseOrderAuto: `{ lapsed }` in its place — the Patchbay draws
 * the planner by hand again, the settings say "Einstellungen geändert seit dem Einschalten — erneut einschalten").
 * The same check runs again at every auto create (autoStart.ts). Local workspaces only (a team holds no consent).
 * Started by trigger.ts startOrders (eager — it only reads the store and hashes).
 */
import { useWorkspace } from '../../../store/store'
import { activeWorkspace } from '../../../cloud'
import { useCoding } from '../state'
import { lapseOrderAuto, onOrderAuto, readOrderAuto } from './auto'
import { autoSigNow } from './autoSig'
import { orderDbIds } from './db'

const DEBOUNCE_MS = 300
let started = false
let timer: ReturnType<typeof setTimeout> | null = null
let running = false
let again = false

/** One pass: every consent of this device for the workspace now, its sig against the settings. */
export async function checkAutoLapses(): Promise<string[]> {
  if (activeWorkspace().kind === 'cloud' || !useWorkspace.getState().ready) return []
  const lapsed: string[] = []
  for (const db of orderDbIds()) {
    const consent = readOrderAuto(db)
    if (!consent) continue
    const sig = await autoSigNow(db)
    // the workspace changed under the pass (another one opened): nothing is judged on a half view
    if (!useWorkspace.getState().ready) return lapsed
    if (sig !== consent.sig && lapseOrderAuto(db, consent.sig)) lapsed.push(db)
  }
  return lapsed
}

function schedule(): void {
  if (timer) clearTimeout(timer)
  timer = setTimeout(() => {
    timer = null
    void pass()
  }, DEBOUNCE_MS)
}

async function pass(): Promise<void> {
  if (running) {
    again = true
    return
  }
  running = true
  try {
    await checkAutoLapses()
  } catch {
    /* a pass that failed judges nothing */
  } finally {
    running = false
    if (again) {
      again = false
      schedule()
    }
  }
}

/** Follow the settings the consents cover (once per tab). */
export function startAutoWatch(): void {
  if (started || typeof window === 'undefined') return
  started = true
  useWorkspace.subscribe((s, p) => {
    if (!s.ready) return
    if (s.ready !== p.ready || s.epoch !== p.epoch || s.databases !== p.databases || s.settings.mcpServers !== p.settings.mcpServers || s.integrations !== p.integrations) schedule()
  })
  useCoding.subscribe((s, p) => {
    if (s.approvalsDefault !== p.approvalsDefault || s.projectRev !== p.projectRev) schedule()
  })
  onOrderAuto(schedule)
  schedule()
}

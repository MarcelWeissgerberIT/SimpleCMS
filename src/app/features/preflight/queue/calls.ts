/**
 * EVERY call from Preflight into another area's action (§14 of the design) lives here and nowhere else — one file for
 * the Flight Recorder's writer arguments once it is merged, one file the static guard checks (preflight-engine.spec,
 * T-P1-6). P1 needs only the grey Sync lamp's way back; the queue's keys (P2) join here.
 */
import { resumeFolder } from '../../sync'

/** Ask the browser again for the sync folder's permission — call inside the key press (the browser asks). */
export function grantFolder(): Promise<void> {
  return Promise.resolve(resumeFolder()).then(() => undefined)
}

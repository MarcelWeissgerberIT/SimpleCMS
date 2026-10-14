/**
 * startPatchbay() — the Patchbay's background service (main.tsx after startRecorder, B8): the fuse computation after
 * first paint (counts.ts, B8) and the run tally (live/bus.ts, B13). Each part fills its own file; this one only starts
 * them, once. Nothing here reads the page map, the ledger or IndexedDB at boot.
 */
import { startCounts } from './counts'
import { startRunBus } from './live/bus'

let stop: (() => void) | null = null

export function startPatchbay(): () => void {
  if (stop) return stop
  const parts = [startCounts(), startRunBus()]
  stop = () => {
    for (const p of parts) p()
    stop = null
  }
  return stop
}

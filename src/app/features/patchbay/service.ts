/**
 * startPatchbay() — the Patchbay's background service (main.tsx, right after startRecorder): the Preflight lamp
 * "Fuses open" (lamp.ts, registered at once — it only reads the cached counts), the fuse count after the first paint
 * (counts.ts → compute.ts, its own chunk, in idle) and the run tally (live/bus.ts, B13). Each part fills its own file;
 * this one only starts them, once. Nothing here reads the page map, the ledger or IndexedDB at boot.
 */
import { startCounts } from './counts'
import { registerFuseLamp } from './lamp'
import { startRunBus } from './live/bus'

let stop: (() => void) | null = null

export function startPatchbay(): () => void {
  if (stop) return stop
  registerFuseLamp()
  const parts = [startCounts(), startRunBus()]
  stop = () => {
    for (const p of parts) p()
    stop = null
  }
  return stop
}

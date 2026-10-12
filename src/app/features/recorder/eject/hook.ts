/**
 * The eject's test hook (DEV / `?e2e`, set through `__oneRecorder.ejectHook`): 'afterWrite' — the commit stops after
 * its store update (the record stays 'committing', as if the tab died there; a boot finishes it); 'beforeSettle' — it
 * waits there until `release()` (a second tab boots meanwhile); 'beforeCheck' — it waits after the write-ahead, before
 * its synchronous re-check (something lands between the plan and the write). Dependency-free: the seam sets it without
 * loading the eject's chunk.
 */
export type EjectHookAt = 'afterWrite' | 'beforeSettle' | 'beforeCheck'
export const ejectHook: { at: EjectHookAt | null; release: (() => void) | null; waiting: boolean } = { at: null, release: null, waiting: false }

/** Wait at a hook point until the test releases it. */
export async function holdAt(): Promise<void> {
  ejectHook.waiting = true
  await new Promise<void>((resolve) => (ejectHook.release = resolve))
  ejectHook.waiting = false
  ejectHook.release = null
}

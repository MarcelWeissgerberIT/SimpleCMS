/**
 * The eject's test hook (DEV / `?e2e`, set through `__oneRecorder.ejectHook`): 'afterWrite' — the commit stops after
 * its store update (the record stays 'committing', as if the tab died there; a boot finishes it); 'beforeSettle' — it
 * waits there until `release()` (a second tab boots meanwhile). Dependency-free: the seam sets it without loading the
 * eject's chunk.
 */
export const ejectHook: { at: 'afterWrite' | 'beforeSettle' | null; release: (() => void) | null; waiting: boolean } = { at: null, release: null, waiting: false }

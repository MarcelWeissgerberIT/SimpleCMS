/**
 * Custom agents — what holds an agent's toast back. Preflight sets `setProposalsShown(fn)`: while its proposals queue is
 * on screen, an agent's "has N proposals" toast stays away (the queue shows them already).
 */
let shown: (() => boolean) | null = null

export function setProposalsShown(fn: (() => boolean) | null): void {
  shown = fn
}

/** Is a list of every proposal on screen right now (Preflight's queue)? */
export function proposalsShown(): boolean {
  try {
    return !!shown?.()
  } catch {
    return false
  }
}

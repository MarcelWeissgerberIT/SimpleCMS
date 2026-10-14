/**
 * The Patchbay's allowed paths (Workspace.fuseSignoffs, plan §2.8) — the reader every caller goes through.
 *
 * B1 (Patchbay seams): the field and this reader exist so the model's inputs (features/patchbay inputs.ts, B2) read
 * `sanitizeFuseSignoffs(ws.fuseSignoffs)` from the start. Until B9 fills the body it reads NOTHING as allowed — every
 * fuse stays open, the fail-safe side. B9: the sanitizer (keys / sig 64 hex, parts ≤ 24 → 16 hex, `at` finite,
 * `updatedBy` ≤ 200 or null, ≤ 500 entries newest kept, unknown entry fields ≤ 1 KB kept, the same input keeps its
 * reference — sameSignoffs), signOffFuse / withdrawSignoff, persistence, the team binding, backups. Pure: Node specs
 * import this file directly.
 */
import type { FuseSignoff } from './types'

const NONE: Record<string, FuseSignoff> = Object.freeze({}) as Record<string, FuseSignoff>

/** The allowed paths as this build reads them (B1: none — B9 reads them). */
export function sanitizeFuseSignoffs(raw: unknown): Record<string, FuseSignoff> {
  return NONE
}

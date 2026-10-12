/** Small builders for the `sources` every AI request names (core/sources.ts classifies them). */
import type { SourceRef } from '@/shared/ai/types'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'

/** The page a request's text comes from (none: nothing). */
export const pageRef = (id: ID | null | undefined): SourceRef[] => (id ? [{ page: id }] : [])

/** The memory database(s) of this workspace — as a source when a memory block goes along with a request. */
export function memoryRef(block: string | null | undefined): SourceRef[] {
  if (!block?.trim()) return []
  const { pages, databases } = useWorkspace.getState()
  return Object.values(databases)
    .filter((db) => db.system === 'memory' && pages[db.id] && !pages[db.id].trashed)
    .map((db) => ({ db: db.id }))
}

/** Rows of a batch (autofill, mail). */
export const rowRefs = (ids: Iterable<ID>): SourceRef[] => [...new Set(ids)].map((row) => ({ row }))

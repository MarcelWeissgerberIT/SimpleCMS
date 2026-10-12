/** Small builders for the `sources` every AI request names (core/sources.ts classifies them). */
import type { SourceRef } from '@/shared/ai/types'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'

/** The page a request's text comes from (none: nothing). */
export const pageRef = (id: ID | null | undefined): SourceRef[] => (id ? [{ page: id }] : [])

/**
 * A selection of a page (D-S2-27): only the selected text goes along — the page's member classes count (a selection in
 * a private page or a Mails row is private / mail data), never `page` / `rows` unless page text goes along too.
 */
export const selectionRef = (id: ID | null | undefined): SourceRef[] => (id ? [{ page: id, as: 'selection' }] : [])

/**
 * The memory database(s) of this workspace — as a source when a memory block goes along with a request: entries chosen
 * from it, so it counts like a selection of it (its member class `memory`, never its rows as such).
 */
export function memoryRef(block: string | null | undefined): SourceRef[] {
  if (!block?.trim()) return []
  return memoryDbs().map((id) => ({ page: id, as: 'selection' as const }))
}

/** The live memory databases of this workspace (ids). */
export function memoryDbs(): ID[] {
  const { pages, databases } = useWorkspace.getState()
  return Object.values(databases)
    .filter((db) => db.system === 'memory' && pages[db.id] && !pages[db.id].trashed)
    .map((db) => db.id)
}

/** Rows of a batch (autofill, mail). */
export const rowRefs = (ids: Iterable<ID>): SourceRef[] => [...new Set(ids)].map((row) => ({ row }))

/**
 * What one page change means for the row index (store/rowIndex.ts) — pure, no store import, so Node specs can test it.
 *
 *  - 'membership': the page appeared or went, or its `databaseId` / `trashed` / `parentId` changed (a row moves between
 *    databases, is trashed or restored; any page's place in the tree changed);
 *  - 'values': the title or the property values changed (a row's cells);
 *  - 'content': another object but none of the above (content, `contentRev`, comments, icon …);
 *  - null: the same object (or no page on either side).
 *
 * Every field is compared by reference: the store freezes pages and replaces only what a write touched.
 */
import type { Page } from './types'

export type RowChangeKind = 'membership' | 'values' | 'content'

export function classifyChange(next?: Page, prev?: Page): RowChangeKind | null {
  if (next === prev) return null
  if (!next || !prev) return 'membership'
  if ((next.databaseId ?? null) !== (prev.databaseId ?? null) || !!next.trashed !== !!prev.trashed || (next.parentId ?? null) !== (prev.parentId ?? null)) return 'membership'
  if (next.title !== prev.title || next.properties !== prev.properties) return 'values'
  return 'content'
}

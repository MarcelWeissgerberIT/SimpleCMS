/** Opening #/kit from elsewhere (⌘K, the sidebar, a database's type picker). */
import { navigate } from '../../lib/router'
import type { ID } from '../../store/types'

export type KitTab = 'lists' | 'types' | 'records'

let createType = false

/** Open Building blocks: a tab, one block of it, or (types) the base menu for a new own type. */
export function openKit(tab: KitTab = 'lists', id?: ID | null, o: { create?: boolean } = {}): void {
  if (o.create && tab === 'types') createType = true
  navigate(id ? `#/kit/${tab}/${id}` : `#/kit/${tab}`)
}

/** The page takes a pending "New own type…" request (true once). */
export function consumeCreateRequest(): boolean {
  const v = createType
  createType = false
  return v
}

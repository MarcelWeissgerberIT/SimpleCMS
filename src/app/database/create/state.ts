/**
 * The one "create property" dialog of the database area, opened from anywhere inside it
 * (pickers in popovers that close meanwhile, the relation offer). Rendered by the first mounted
 * <CreatePropertyHost/> — database views and row pages mount one.
 */
import { useEffect, useId } from 'react'
import { create } from 'zustand'
import type { ID, PropertyDef, PropertyType } from '../../store/types'
import { canCreateProperties } from './quick'

export interface CreateRequest {
  dbId: ID
  /** Prefilled name. */
  name?: string
  /** Preselected type. */
  type?: PropertyType
  /** Types the dialog offers (one = fixed). */
  types?: PropertyType[]
  /** relation: preselected target database; lockTarget keeps it fixed. */
  relationDatabaseId?: ID
  lockTarget?: boolean
  onCreated?: (prop: PropertyDef) => void
}

interface State {
  req: (CreateRequest & { key: number }) | null
  hosts: string[]
}

export const useCreateDialog = create<State>(() => ({ req: null, hosts: [] }))

let seq = 0

export function openCreateProperty(req: CreateRequest): void {
  if (!canCreateProperties(req.dbId)) return
  useCreateDialog.setState({ req: { ...req, key: ++seq } })
}

export function closeCreateProperty(): void {
  useCreateDialog.setState({ req: null })
}

/** Register a dialog host; true for the one that renders (the first mounted). */
export function useCreateHost(): boolean {
  const id = useId()
  useEffect(() => {
    useCreateDialog.setState((s) => ({ hosts: [...s.hosts, id] }))
    return () => useCreateDialog.setState((s) => ({ hosts: s.hosts.filter((h) => h !== id) }))
  }, [id])
  return useCreateDialog((s) => s.hosts[0] === id)
}

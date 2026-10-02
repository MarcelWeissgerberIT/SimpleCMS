/**
 * Sidebar tree helpers: a memoised parent → children index over the page map
 * (rebuilt once per store change, O(1) per node) and the per-viewer expanded state.
 */
import { create } from 'zustand'
import { useShallow } from 'zustand/react/shallow'
import { useWorkspace } from '../../store/store'
import type { ID, Page } from '../../store/types'
import { safeLocalGet, safeLocalSet } from '@/shared/brand'

const ROOT = '__root__'
const EMPTY: ID[] = []

let lastPages: Record<ID, Page> | null = null
let lastMap = new Map<string, ID[]>()

/** Visible tree children (not trashed, not database rows, not hidden), sorted. */
export function childMap(pages: Record<ID, Page>): Map<string, ID[]> {
  if (pages === lastPages) return lastMap
  const groups = new Map<string, Page[]>()
  for (const p of Object.values(pages)) {
    if (p.trashed || p.databaseId || p.hidden) continue
    const key = p.parentId ?? ROOT
    const arr = groups.get(key)
    if (arr) arr.push(p)
    else groups.set(key, [p])
  }
  const map = new Map<string, ID[]>()
  for (const [k, arr] of groups) map.set(k, arr.sort((a, b) => a.order - b.order || a.createdAt - b.createdAt).map((p) => p.id))
  lastPages = pages
  lastMap = map
  return map
}

export function childIds(pages: Record<ID, Page>, parentId: ID | null): ID[] {
  return childMap(pages).get(parentId ?? ROOT) ?? EMPTY
}

export function useChildIds(parentId: ID | null): ID[] {
  return useWorkspace(useShallow((s) => childIds(s.pages, parentId)))
}

/* ---------------- expanded state (localStorage, per viewer) ---------------- */

const KEY = 'one.shell.expanded'

function loadExpanded(): Record<string, true> {
  try {
    const raw = safeLocalGet(KEY)
    return raw ? (JSON.parse(raw) as Record<string, true>) : {}
  } catch {
    return {}
  }
}

interface TreeState {
  expanded: Record<string, true>
  toggle: (key: string) => void
  expand: (keys: string[]) => void
  collapse: (key: string) => void
}

export const useTreeState = create<TreeState>()((set, get) => {
  const persist = () => safeLocalSet(KEY, JSON.stringify(get().expanded))
  return {
    expanded: loadExpanded(),
    toggle: (key) => {
      set((s) => {
        const next = { ...s.expanded }
        if (next[key]) delete next[key]
        else next[key] = true
        return { expanded: next }
      })
      persist()
    },
    expand: (keys) => {
      if (keys.every((k) => get().expanded[k])) return
      set((s) => {
        const next = { ...s.expanded }
        for (const k of keys) next[k] = true
        return { expanded: next }
      })
      persist()
    },
    collapse: (key) => {
      if (!get().expanded[key]) return
      set((s) => {
        const next = { ...s.expanded }
        delete next[key]
        return { expanded: next }
      })
      persist()
    },
  }
})

export const treeKey = (section: string, id: ID) => `${section}:${id}`

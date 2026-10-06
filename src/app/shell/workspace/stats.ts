/**
 * The workspace page's numbers: pages, databases, entries, words, when it began; how much automation and how
 * many building blocks it holds. Live pages only — the trash and templates are counted on their own.
 */
import { useMemo } from 'react'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed, useTrash } from '../../store/selectors'
import { sanitizeKit } from '../../store/kit'
import type { ID, Page } from '../../store/types'
import { wordCount } from '../lib/format'
import { inventoryCount, useAutomationInventory } from './automation'

export interface WorkspaceStats {
  /** pages that are not database entries (databases excluded) */
  pages: number
  databases: number
  /** database rows */
  entries: number
  words: number
  /** own templates (Page.template roots) */
  templates: number
  /** the oldest page: when the workspace began (null: empty) */
  created: number | null
  /** the latest change of any page */
  edited: number | null
}

export function workspaceStats(pages: Record<ID, Page>): WorkspaceStats {
  const out: WorkspaceStats = { pages: 0, databases: 0, entries: 0, words: 0, templates: 0, created: null, edited: null }
  for (const id of Object.keys(pages)) {
    const p = pages[id]
    if (p.template && !p.trashed) out.templates++
    if (p.trashed || p.hidden || isEffectivelyTrashed(pages, id) || inTemplate(pages, id)) continue
    if (p.databaseId) out.entries++
    else if (p.kind === 'database') out.databases++
    else out.pages++
    out.words += wordCount(p.plain)
    if (p.createdAt && (out.created === null || p.createdAt < out.created)) out.created = p.createdAt
    if (p.updatedAt && (out.edited === null || p.updatedAt > out.edited)) out.edited = p.updatedAt
  }
  return out
}

export function useWorkspaceStats(): WorkspaceStats {
  const pages = useWorkspace((s) => s.pages)
  return useMemo(() => workspaceStats(pages), [pages])
}

/** Top-level items in the trash (what the sidebar's trash lists). */
export function useTrashCount(): number {
  const trash = useTrash()
  const pages = useWorkspace((s) => s.pages)
  return useMemo(() => trash.filter((p) => !(p.parentId && pages[p.parentId]?.trashed)).length, [trash, pages])
}

/** Lists, property types and record types (Workspace.kit, sanitized). */
export function useKit() {
  const raw = useWorkspace((s) => s.kit)
  return useMemo(() => sanitizeKit(raw).kit, [raw])
}

export function useKitCount(): number {
  const kit = useKit()
  return Object.keys(kit.lists).length + Object.keys(kit.propTypes).length + Object.keys(kit.recordTypes).length
}

/** Agents, scripts, functions, automations, own database commands, repeating entries and own templates. */
export function useAutomationCount(): number {
  return inventoryCount(useAutomationInventory())
}

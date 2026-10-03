/** Menu entries of a synced block — shared by its own frame menu and the block (⋮⋮) menu. */
import type { Editor } from '@tiptap/core'
import { ArrowUpRight, Copy, RefreshCw, Unlink } from 'lucide-react'
import type { MenuEntry } from '../../ui/Menu'
import { PageIcon } from '../../ui/PageIcon'
import { useWorkspace } from '../../store/store'
import { pageTitle } from '../../store/selectors'
import { openPage } from '../../lib/router'
import type { Translate } from '@/shared/i18n'
import { SYNCED, syncedAround } from '../schema/synced'
import { copyAndSync, editorPageId, goToOriginal, unsyncAll, unsyncAt } from './actions'
import { liveSourceOf, syncedEntry, syncedRunning } from './state'

export type SyncedRole = 'original' | 'reference' | 'orphan'

export function syncedRole(syncId: string | null, sourcePageId: string | null): SyncedRole {
  if (!sourcePageId) return 'original'
  return syncId && syncedRunning() && !liveSourceOf(syncId) ? 'orphan' : 'reference'
}

/** The mono label of a synced block ("SYNCED · 3 PAGES", "SYNCED FROM Roadmap", …). */
export function syncedLabel(t: Translate, role: SyncedRole, count: number, sourceTitle: string): string {
  if (role === 'orphan') return t('editor.synced.orphan')
  if (role === 'reference') return t('editor.synced.from', { title: sourceTitle })
  return count === 1 ? t('editor.synced.onePage') : t('editor.synced.pages', { count })
}

/** Entries for the synced block at `pos` (empty when there is none). */
export function syncedMenuEntries(editor: Editor, pos: number, t: Translate, opts: { copy?: boolean } = {}): MenuEntry[] {
  const node = editor.state.doc.nodeAt(pos)
  if (!node || node.type.name !== SYNCED) return []
  const syncId = (node.attrs.syncId as string | null) ?? null
  const role = syncedRole(syncId, node.attrs.sourcePageId as string | null)
  const entry = syncedEntry(syncId)
  const here = editorPageId(editor)
  const pages = useWorkspace.getState().pages
  const untitled = t('common.untitled')
  const editable = editor.isEditable
  const uses = entry?.uses ?? []
  const items: MenuEntry[] = [{ kind: 'section', label: syncedLabel(t, role, Math.max(1, uses.length), pageTitle(pages[entry?.source ?? String(node.attrs.sourcePageId ?? '')], untitled)) }]
  if (role !== 'orphan' && opts.copy !== false) items.push({ label: t('editor.synced.copyAndSync'), icon: <Copy size={15} />, onSelect: () => copyAndSync(editor, pos) })
  if (role === 'reference' && syncId) items.push({ label: t('editor.synced.goToOriginal'), icon: <ArrowUpRight size={15} />, onSelect: () => goToOriginal(syncId) })
  if (uses.length && role !== 'orphan') {
    items.push({ kind: 'separator' }, { kind: 'section', label: uses.length === 1 ? t('editor.synced.usedOnOne') : t('editor.synced.usedOn', { count: uses.length }) })
    for (const u of uses) {
      const p = pages[u.pageId]
      items.push({
        id: `synced-use-${u.pageId}`,
        label: pageTitle(p, untitled),
        icon: <PageIcon icon={p?.icon ?? null} size={16} />,
        hint: u.pageId === here ? t('editor.synced.thisPage') : u.original ? t('editor.synced.original') : undefined,
        disabled: u.pageId === here,
        onSelect: () => openPage(u.pageId, u.blockId ?? undefined),
      })
    }
  }
  if (editable) {
    items.push(
      { kind: 'separator' },
      role === 'original'
        ? { label: t('editor.synced.unsyncAll'), icon: <Unlink size={15} />, danger: uses.length > 1, onSelect: () => unsyncAll(editor, pos) }
        : { label: t('editor.synced.unsync'), icon: <Unlink size={15} />, onSelect: () => unsyncAt(editor, pos) },
    )
  }
  return items
}

/**
 * Block (⋮⋮) menu: "Copy and sync" for any block — plus, when the block is or sits in a synced
 * block, that block's own menu as a submenu (the keyboard path to it).
 */
export function blockMenuSyncedEntries(editor: Editor, pos: number, t: Translate): MenuEntry[] {
  const node = editor.state.doc.nodeAt(pos)
  if (!node || !editorPageId(editor)) return []
  const around = node.type.name === SYNCED ? { pos, node } : syncedAround(editor.state.doc.resolve(pos))
  const role = around ? syncedRole((around.node.attrs.syncId as string | null) ?? null, around.node.attrs.sourcePageId as string | null) : null
  const out: MenuEntry[] = []
  if (around ? role !== 'orphan' : editor.isEditable)
    out.push({ label: t('editor.synced.copyAndSync'), icon: <RefreshCw size={15} />, keywords: 'synced sync synchron', onSelect: () => copyAndSync(editor, pos) })
  if (around) out.push({ label: t('editor.synced.label'), icon: <RefreshCw size={15} />, keywords: 'synced sync synchron unsync', submenu: syncedMenuEntries(editor, around.pos, t, { copy: false }) })
  return out
}

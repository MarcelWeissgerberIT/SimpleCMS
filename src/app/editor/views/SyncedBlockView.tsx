/**
 * Synced block — its content is ProseMirror's; around it a hairline signal frame (hover / focus)
 * with a placard tag: "SYNCED · 3 PAGES" on the original, "SYNCED FROM <page>" on a reference.
 * The tag opens the menu (Copy and sync, Go to original, pages using it, Unsync).
 * A reference whose original is gone shows "ORIGINAL DELETED — CONTENT KEPT", its content
 * read-only, and an Unsync key. Read-only renders use the plain schema HTML (no chrome).
 */
import { useState } from 'react'
import { NodeViewContent, NodeViewWrapper, useEditorState, type ReactNodeViewProps } from '@tiptap/react'
import { ChevronDown } from 'lucide-react'
import { Menu } from '../../ui/Menu'
import { useWorkspace } from '../../store/store'
import { pageTitle } from '../../store/selectors'
import { useT } from '../../i18n'
import { useSyncedEntry } from '../synced/state'
import { syncedLabel, syncedMenuEntries, syncedRole } from '../synced/menu'
import { unsyncAt } from '../synced/actions'
import './synced.css'

export function SyncedBlockView({ node, editor, getPos }: ReactNodeViewProps) {
  const t = useT()
  const syncId = (node.attrs.syncId as string | null) ?? null
  const ref = (node.attrs.sourcePageId as string | null) ?? null
  const entry = useSyncedEntry(syncId)
  const role = syncedRole(syncId, ref)
  const sourceId = entry?.source ?? ref ?? ''
  const sourceTitle = useWorkspace((s) => pageTitle(s.pages[sourceId], t('common.untitled')))
  const editable = useEditorState({ editor, selector: ({ editor: e }) => !!e?.isEditable && !e.isDestroyed })
  const [menu, setMenu] = useState<HTMLElement | null>(null)
  const label = syncedLabel(t, role, Math.max(1, entry?.uses.length ?? 1), sourceTitle)
  const pos = () => {
    const p = getPos()
    return typeof p === 'number' ? p : null
  }
  const entries = menu && pos() !== null ? syncedMenuEntries(editor, pos()!, t) : []

  return (
    <NodeViewWrapper className={`synced is-${role}${menu ? ' is-open' : ''}`} data-type="synced-block" data-role={role} aria-label={t('editor.synced.label')} role="group">
      <div className="synced__bar" contentEditable={false} suppressContentEditableWarning>
        <button
          type="button"
          className="synced__tag"
          aria-haspopup="menu"
          aria-expanded={!!menu}
          title={t('editor.synced.menu')}
          onMouseDown={(e) => e.preventDefault()}
          onClick={(e) => setMenu(menu ? null : e.currentTarget)}
        >
          <span className="synced__mark" aria-hidden />
          <span className="synced__label">{label}</span>
          <ChevronDown size={12} strokeWidth={2} aria-hidden />
        </button>
        {role === 'orphan' && editable && (
          <button
            type="button"
            className="synced__key"
            title={t('editor.synced.readOnly')}
            onMouseDown={(e) => e.preventDefault()}
            onClick={() => {
              const p = pos()
              if (p !== null) unsyncAt(editor, p)
            }}
          >
            {t('editor.synced.unsync')}
          </button>
        )}
      </div>
      <NodeViewContent className="synced__body" contentEditable={role === 'orphan' ? false : undefined} />
      <Menu
        open={!!menu}
        anchor={menu}
        onClose={() => {
          setMenu(null)
          if (!editor.isDestroyed && editor.isEditable) editor.view.focus()
        }}
        entries={entries}
        placement="bottom-start"
        width={260}
      />
    </NodeViewWrapper>
  )
}

/** Node view options: the frame's controls belong to React, not ProseMirror. */
export const syncedViewOptions = {
  stopEvent: ({ event }: { event: Event }) => !event.type.startsWith('drag') && event.type !== 'drop' && !!(event.target as Element | null)?.closest?.('.synced__bar'),
}

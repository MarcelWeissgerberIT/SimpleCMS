import { useMemo } from 'react'
import type { Editor } from '@tiptap/core'
import { Popover } from '../../ui/Popover'
import { MenuList, type MenuEntry } from '../../ui/Menu'
import { PageIcon } from '../../ui/PageIcon'
import { useWorkspace } from '../../store/store'
import { pageTitle, sortPages } from '../../store/selectors'
import type { ID } from '../../store/types'
import { useT } from '../../i18n'
import { insertBlock } from '../lib/blocks'
import { livePages } from '../lib/livePages'
import { posAnchor } from './common'

/** Pick an existing database for a "linked database" block. */
export function DatabasePicker({ editor, pos, onClose }: { editor: Editor; pos: number; onClose: () => void }) {
  const t = useT()
  const anchor = useMemo(() => posAnchor(editor, pos), [editor, pos])
  const entries = useMemo<MenuEntry[]>(() => {
    const { pages, databases } = useWorkspace.getState()
    const dbs = sortPages(livePages(pages, editor.view.dom.getAttribute('data-page-id')).filter((p) => p.kind === 'database' && databases[p.id]))
    if (!dbs.length) return [{ label: t('editor.linked.none'), disabled: true }]
    return [
      { kind: 'section', label: t('editor.linked.title') },
      ...dbs.map((p) => ({
        id: p.id,
        label: pageTitle(p, t('common.untitled')),
        icon: <PageIcon icon={p.icon} kind="database" size={16} />,
        onSelect: () => insertBlock(editor, { type: 'databaseBlock', attrs: { databaseId: p.id as ID, viewId: null } }),
      })),
    ]
  }, [editor, t])
  return (
    <Popover open anchor={anchor} onClose={onClose} placement="bottom-start" offset={6} style={{ width: 300 }}>
      <MenuList entries={entries} onClose={onClose} searchable searchPlaceholder={t('editor.linked.search')} emptyLabel={t('editor.slash.empty')} />
    </Popover>
  )
}

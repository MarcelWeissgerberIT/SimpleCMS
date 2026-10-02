/** Floating controls while the caret is inside a table: add/remove rows & columns, header row, delete. */
import { useMemo } from 'react'
import type { Editor } from '@tiptap/core'
import { findParentNode } from '@tiptap/core'
import { useEditorState } from '@tiptap/react'
import { BetweenHorizontalEnd, BetweenHorizontalStart, BetweenVerticalEnd, BetweenVerticalStart, PanelTop, Rows2, Columns2, Trash2 } from 'lucide-react'
import type { VirtualElement } from '@floating-ui/react'
import { Popover } from '../../ui/Popover'
import { useT } from '../../i18n'

export function TableToolbar({ editor }: { editor: Editor }) {
  const t = useT()
  const st = useEditorState({
    editor,
    selector: ({ editor: e }) => {
      if (!e || !e.isEditable || !e.isFocused) return null
      const found = findParentNode((n) => n.type.name === 'table')(e.state.selection)
      return found ? { pos: found.pos, header: found.node.firstChild?.firstChild?.type.name === 'tableHeader' } : null
    },
  })
  const anchor = useMemo<VirtualElement | null>(() => {
    if (!st) return null
    return {
      contextElement: editor.view.dom,
      getBoundingClientRect: () => {
        const dom = editor.view.nodeDOM(st.pos) as HTMLElement | null
        return dom?.getBoundingClientRect?.() ?? new DOMRect()
      },
    }
  }, [st?.pos, editor]) // eslint-disable-line react-hooks/exhaustive-deps

  const B = ({ label, onClick, children, danger }: { label: string; onClick: () => void; children: React.ReactNode; danger?: boolean }) => (
    <button type="button" className={`table-tools__btn${danger ? ' is-danger' : ''}`} title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={onClick}>
      {children}
    </button>
  )
  const c = () => editor.chain().focus()
  return (
    <Popover open={!!st && !!anchor} anchor={anchor} onClose={() => {}} placement="top-end" offset={6} bare autoFocus={false} closeOnOutside={false} className="table-tools" role="toolbar" aria-label={t('editor.table.tools')}>
      <span className="label table-tools__label">{t('editor.table.label')}</span>
      <B label={t('editor.table.rowAbove')} onClick={() => c().addRowBefore().run()}>
        <BetweenHorizontalStart size={14} />
      </B>
      <B label={t('editor.table.rowBelow')} onClick={() => c().addRowAfter().run()}>
        <BetweenHorizontalEnd size={14} />
      </B>
      <B label={t('editor.table.colLeft')} onClick={() => c().addColumnBefore().run()}>
        <BetweenVerticalStart size={14} />
      </B>
      <B label={t('editor.table.colRight')} onClick={() => c().addColumnAfter().run()}>
        <BetweenVerticalEnd size={14} />
      </B>
      <span className="table-tools__sep" />
      <B label={t('editor.table.deleteRow')} onClick={() => c().deleteRow().run()}>
        <Rows2 size={14} />
      </B>
      <B label={t('editor.table.deleteCol')} onClick={() => c().deleteColumn().run()}>
        <Columns2 size={14} />
      </B>
      <span className="table-tools__sep" />
      <B label={t('editor.table.header')} onClick={() => c().toggleHeaderRow().run()}>
        <PanelTop size={14} style={{ color: st?.header ? 'var(--signal-ink)' : undefined }} />
      </B>
      <B label={t('editor.table.delete')} onClick={() => c().deleteTable().run()} danger>
        <Trash2 size={14} />
      </B>
    </Popover>
  )
}

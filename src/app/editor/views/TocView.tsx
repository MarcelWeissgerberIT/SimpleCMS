import { NodeViewWrapper, useEditorState, type ReactNodeViewProps } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import { InlineDatabase } from '../lib/lazyAreas'
import { findBlockById, flashBlock } from '../extensions/behaviors'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'

interface Heading {
  level: number
  text: string
  pos: number
  id: string | null
}

function collectHeadings(editor: Editor): Heading[] {
  const out: Heading[] = []
  editor.state.doc.descendants((node, pos) => {
    if (node.type.name === 'heading') {
      out.push({ level: node.attrs.level as number, text: node.textContent, pos, id: (node.attrs.id as string | null) ?? null })
      return false
    }
    return node.isBlock && !node.isAtom && !node.isTextblock
  })
  return out
}

/** Hierarchical section numbers: 1, 1.1, 1.2, 2 … (relative to the smallest level used). */
function numbering(items: Heading[]): string[] {
  const min = Math.min(...items.map((h) => h.level))
  const counters = [0, 0, 0]
  return items.map((h) => {
    const depth = h.level - min
    counters[depth] += 1
    for (let i = depth + 1; i < counters.length; i++) counters[i] = 0
    return counters
      .slice(0, depth + 1)
      .map((c) => (c === 0 ? 1 : c))
      .join('.')
  })
}

export function TocView({ editor, selected }: ReactNodeViewProps) {
  const t = useT()
  const headings = useEditorState({ editor, selector: ({ editor: e }) => (e ? collectHeadings(e) : []) }) ?? []
  const nums = numbering(headings)
  const min = headings.length ? Math.min(...headings.map((h) => h.level)) : 1

  const jump = (h: Heading) => {
    const pos = h.id ? findBlockById(editor, h.id) : h.pos
    if (pos !== null) flashBlock(editor, pos)
  }

  return (
    <NodeViewWrapper as="nav" className={`toc-view${selected ? ' is-selected' : ''}`} data-type="toc" contentEditable={false} aria-label={t('editor.block.toc')}>
      <div className="toc-view__head">
        <span className="label">{t('editor.toc.label')}</span>
        <span className="label faint">{t('editor.toc.count', { count: headings.length })}</span>
      </div>
      {headings.length === 0 ? (
        <div className="toc-view__empty">{t('editor.toc.empty')}</div>
      ) : (
        <ol className="toc-view__list">
          {headings.map((h, i) => (
            <li key={`${h.pos}-${i}`} style={{ paddingLeft: `${(h.level - min) * 18}px` }} data-level={h.level - min}>
              <button type="button" onClick={() => jump(h)}>
                <span className="toc-view__num">{nums[i]}</span>
                <span className="toc-view__text">{h.text.trim() || t('common.untitled')}</span>
              </button>
            </li>
          ))}
        </ol>
      )}
    </NodeViewWrapper>
  )
}

export function DatabaseBlockView({ node, selected }: ReactNodeViewProps) {
  const t = useT()
  const id = node.attrs.databaseId as string | null
  const viewId = (node.attrs.viewId as string | null) ?? undefined
  const exists = useWorkspace((s) => !!(id && s.databases[id] && s.pages[id] && !s.pages[id].trashed))
  return (
    <NodeViewWrapper className={`database-block${selected ? ' is-selected' : ''}`} data-type="database" contentEditable={false}>
      {id && exists ? (
        <InlineDatabase
          databaseId={id}
          inline
          viewId={viewId}
          loading={<div className="database-block__loading label">{t('common.loading')}</div>}
          fallback={<div className="database-block__missing label">{t('editor.database.failed')}</div>}
        />
      ) : (
        <div className="database-block__missing label">{t('editor.database.missing')}</div>
      )}
    </NodeViewWrapper>
  )
}

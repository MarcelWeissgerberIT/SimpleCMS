import { NodeViewWrapper, useEditorState, type ReactNodeViewProps } from '@tiptap/react'
import type { Editor } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { InlineDatabase } from '../lib/lazyAreas'
import { findBlockById, flashBlock } from '../extensions/behaviors'
import { useWorkspace } from '../../store/store'
import { useT } from '../../i18n'
import { toggleHeadingLevel } from '../schema/toggle'

interface Heading {
  level: number
  text: string
  id: string | null
}

/** Heading level of an outline entry: headings and toggle headings (0 = not in the outline). */
function outlineLevel(node: PMNode): number {
  if (node.type.name === 'heading') return node.attrs.level as number
  return node.type.name === 'details' ? toggleHeadingLevel(node) : 0
}

/** Top-level-ish walk (no descent into textblocks or atoms); cached per doc instance. */
const cache = new WeakMap<object, Heading[]>()
function collectHeadings(editor: Editor): Heading[] {
  const doc = editor.state.doc
  const hit = cache.get(doc)
  if (hit) return hit
  const out: Heading[] = []
  doc.descendants((node) => {
    const level = outlineLevel(node)
    // a toggle heading's title is its text; headings inside its (folded) body follow it
    if (level) out.push({ level, text: node.type.name === 'details' ? (node.firstChild?.textContent ?? '') : node.textContent, id: (node.attrs.id as string | null) ?? null })
    if (node.type.name === 'heading') return false
    return node.isBlock && !node.isAtom && !node.isTextblock
  })
  cache.set(doc, out)
  return out
}

/** Re-render only when the outline itself changed — not on every keystroke elsewhere. */
function sameOutline(a: Heading[] | null, b: Heading[] | null): boolean {
  if (a === b) return true
  if (!a || !b || a.length !== b.length) return false
  for (let i = 0; i < a.length; i++) if (a[i].level !== b[i].level || a[i].text !== b[i].text || a[i].id !== b[i].id) return false
  return true
}

/** n-th heading in document order (fallback when a heading has no id yet). */
function nthHeadingPos(editor: Editor, n: number): number | null {
  let i = 0
  let found: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (outlineLevel(node) && i++ === n) found = pos
    if (node.type.name === 'heading') return false
    return node.isBlock && !node.isAtom && !node.isTextblock
  })
  return found
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
  const headings = useEditorState({ editor, selector: ({ editor: e }) => (e ? collectHeadings(e) : []), equalityFn: sameOutline }) ?? []
  const nums = numbering(headings)
  const min = headings.length ? Math.min(...headings.map((h) => h.level)) : 1

  const jump = (h: Heading, i: number) => {
    const pos = (h.id ? findBlockById(editor, h.id) : null) ?? nthHeadingPos(editor, i)
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
            <li key={`${h.id ?? 'h'}-${i}`} style={{ paddingLeft: `${(h.level - min) * 18}px` }} data-level={h.level - min}>
              <button type="button" onClick={() => jump(h, i)}>
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

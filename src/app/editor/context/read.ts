/**
 * What Claude may read of a page — computed from the live editor's doc (when the page is open) or
 * from the stored content, with the page's context marks (store.ts).
 */
import type { Editor, JSONContent } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { useMemo, useSyncExternalStore } from 'react'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import { docSchema, docToMarkdown } from '../convert'
import { contextStore, liveEditorOf, pageContext, type ContextMode, type PageContext } from './store'

export interface ContextMarks {
  mode: ContextMode
  /** top-level blocks Claude reads: all of them ('page'), the marked ones ('marked'), 0 ('none') */
  blocks: number
  /** words Claude reads */
  words: number
  /** marked blocks that exist (kept while the mode is 'page' too) */
  marked: number
  /** top-level blocks of the page */
  total: number
}

export interface ReadableContent extends ContextMarks {
  /** Markdown of what Claude may read ('' for 'none'); for 'page' the whole page */
  markdown: string
  /** plain text of the same ("\n" between blocks) */
  plain: string
}

/** The key a top-level block is marked by: its block id (the index for the rare block without one). */
export const blockKey = (node: PMNode, index: number): string => (typeof node.attrs.id === 'string' && node.attrs.id ? node.attrs.id : `#${index}`)

export const countWords = (text: string): number => {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)
  return m ? m.length : 0
}

const blockText = (node: PMNode) => node.textBetween(0, node.content.size, '\n', ' ')

/** The marked top-level blocks of a doc, in document order. */
export function markedBlocks(doc: PMNode, ctx: PageContext): PMNode[] {
  const ids = new Set(ctx.ids)
  const out: PMNode[] = []
  doc.forEach((node, _offset, i) => {
    if (ids.has(blockKey(node, i))) out.push(node)
  })
  return out
}

function measure(doc: PMNode, ctx: PageContext): ContextMarks {
  const marked = markedBlocks(doc, ctx)
  const total = doc.childCount
  const wordsOf = (nodes: PMNode[]) => nodes.reduce((n, b) => n + countWords(blockText(b)), 0)
  if (ctx.mode === 'none') return { mode: 'none', blocks: 0, words: 0, marked: marked.length, total }
  if (ctx.mode === 'marked') return { mode: 'marked', blocks: marked.length, words: wordsOf(marked), marked: marked.length, total }
  const all: PMNode[] = []
  doc.forEach((b) => {
    all.push(b)
  })
  return { mode: 'page', blocks: total, words: wordsOf(all), marked: marked.length, total }
}

/** The page's doc: the live editor's when the page is open, else the stored content. */
function docOf(pageId: ID): PMNode | null {
  const editor = liveEditorOf(pageId)
  if (editor) return editor.state.doc
  const json = useWorkspace.getState().pages[pageId]?.content
  if (!json) return null
  try {
    return docSchema().nodeFromJSON(json)
  } catch {
    return null
  }
}

/** Marks of the page an editor shows. */
export function contextMarksOf(editor: Editor): ContextMarks {
  const pageId = editor.isDestroyed ? null : editor.view.dom.getAttribute('data-page-id')
  const ctx = pageId ? pageContext(pageId) : { mode: 'page' as const, ids: [] }
  return measure(editor.state.doc, ctx)
}

/** Marks of a page (open or not). */
export function pageContextMarks(pageId: ID): ContextMarks {
  const doc = docOf(pageId)
  const ctx = pageContext(pageId)
  if (!doc) return { mode: ctx.mode, blocks: 0, words: 0, marked: 0, total: 0 }
  return measure(doc, ctx)
}

/**
 * What Claude may read of a page: the whole page ('page'), only the marked blocks as Markdown —
 * links and mentions stay readable — ('marked'), or nothing ('none').
 */
export function readableContent(pageId: ID): ReadableContent {
  const doc = docOf(pageId)
  const ctx = pageContext(pageId)
  if (!doc) return { mode: ctx.mode, blocks: 0, words: 0, marked: 0, total: 0, markdown: '', plain: '' }
  const marks = measure(doc, ctx)
  if (ctx.mode === 'none') return { ...marks, markdown: '', plain: '' }
  const nodes: PMNode[] = []
  if (ctx.mode === 'marked') nodes.push(...markedBlocks(doc, ctx))
  else doc.forEach((b) => nodes.push(b))
  const json: JSONContent = { type: 'doc', content: nodes.map((n) => n.toJSON() as JSONContent) }
  const markdown = nodes.length ? docToMarkdown(json).trim() : ''
  return { ...marks, markdown, plain: nodes.map(blockText).join('\n') }
}

/** Is reading this page limited (marked blocks only, or nothing)? */
export function isContextLimited(pageId: ID): boolean {
  return pageContext(pageId).mode !== 'page'
}

/* ------------------------------------------------------------------ */
/* React                                                               */
/* ------------------------------------------------------------------ */

const subscribe = (fn: () => void) => contextStore.subscribe(fn)

/** A page's marks, following mode changes, picking and typing (null: no page). */
export function useContextMarks(pageId: ID | null): ContextMarks | null {
  // the store's state object changes with every mark, mode, picker and doc change
  const state = useSyncExternalStore(subscribe, () => contextStore.getState())
  const content = useWorkspace((s) => (pageId ? s.pages[pageId]?.content : undefined))
  // eslint-disable-next-line react-hooks/exhaustive-deps
  return useMemo(() => (pageId ? pageContextMarks(pageId) : null), [pageId, state, content])
}

/** The page whose picker is open in this tab (null: none). */
export function useContextPicking(): ID | null {
  return useSyncExternalStore(subscribe, () => contextStore.getState().picker?.pageId ?? null)
}

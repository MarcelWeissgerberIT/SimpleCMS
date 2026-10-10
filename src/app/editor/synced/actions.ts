/**
 * Synced-block actions for the editor UI (node view menu, block menu, slash menu):
 * Copy and sync, Unsync, Unsync all, Go to original, insert a new original.
 */
import { generateHTML, type Editor, type JSONContent, type Range } from '@tiptap/core'
import type { Node as PMNode } from '@tiptap/pm/model'
import { NodeSelection, TextSelection } from '@tiptap/pm/state'
import { newId } from '../../lib/ids'
import { openPage } from '../../lib/router'
import { toast, useUI } from '../../store/ui'
import { t } from '../../i18n'
import { docToMarkdown, getExtensions } from '../convert'
import { stripButtonActions } from '../schema/button'
import { stripComments } from '../schema/comment'
import { SYNCED, SYNCED_META, newSyncedJson, syncedAround } from '../schema/synced'
import { insertBlock } from '../lib/blocks'
import { expectOriginal, syncedEntry } from './state'
import { unsyncEverywhere } from './service'
import { CLIP_ATTR, clipKey } from '../workitem/clip'

const LIST_ITEMS = new Set(['listItem', 'taskItem'])

/** The page an editor shows (its content element carries data-page-id). */
export function editorPageId(editor: Editor): string | null {
  return editor.isDestroyed ? null : editor.view.dom.getAttribute('data-page-id')
}

/* ------------------------------------------------------------------ clipboard */

/**
 * A reference on the clipboard. Pasted in One it becomes a synced copy (the HTML carries the
 * node, as a closed slice so the block stays a block); anywhere else it is plain content.
 * Webhook URLs and comment anchors never go along.
 */
function payload(syncId: string, sourcePageId: string, content: JSONContent[]): { html: string; text: string } {
  const ref: JSONContent = { type: 'doc', content: [{ type: SYNCED, attrs: { syncId, sourcePageId }, content }] }
  const html = generateHTML(stripComments(stripButtonActions(ref)), getExtensions({ readOnly: true }))
    .replace(/^<div /, '<div data-pm-slice="0 0 []" ')
    // task blocks in it come back as tasks only with this device's clip key (workitem/clip.ts)
    .replace(/data-type="work-item"/g, `data-type="work-item" ${CLIP_ATTR}="${clipKey()}"`)
  return { html, text: docToMarkdown({ type: 'doc', content }).trim() }
}

function copyWithEvent(html: string, text: string): boolean {
  let done = false
  const onCopy = (e: ClipboardEvent) => {
    if (!e.clipboardData) return
    e.clipboardData.setData('text/html', html)
    e.clipboardData.setData('text/plain', text)
    e.preventDefault()
    // the editor's own copy handler must not replace it
    e.stopPropagation()
    done = true
  }
  document.addEventListener('copy', onCopy, true)
  try {
    document.execCommand('copy')
  } catch {
    /* not supported */
  } finally {
    document.removeEventListener('copy', onCopy, true)
  }
  return done
}

async function writeClipboard(html: string, text: string): Promise<boolean> {
  if (copyWithEvent(html, text)) return true
  try {
    await navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([html], { type: 'text/html' }), 'text/plain': new Blob([text], { type: 'text/plain' }) })])
    return true
  } catch {
    return false
  }
}

async function copyReference(syncId: string, sourcePageId: string, content: JSONContent[]): Promise<void> {
  const { html, text } = payload(syncId, sourcePageId, content)
  const ok = await writeClipboard(html, text)
  toast(ok ? { message: t('editor.synced.copied'), kind: 'success' } : { message: t('editor.synced.copyFailed'), kind: 'error' })
}

/* ------------------------------------------------------------------ actions */

const syncedAt = (editor: Editor, pos: number): PMNode | null => {
  const node = editor.state.doc.nodeAt(pos)
  return node && node.type.name === SYNCED ? node : null
}

/**
 * "Copy and sync" on a block: a synced block (or a block inside one) puts a reference to it on
 * the clipboard; any other block is first wrapped into a new original (a list item takes its
 * whole list along).
 */
export function copyAndSync(editor: Editor, pos: number): boolean {
  const { state } = editor
  const node = state.doc.nodeAt(pos)
  const pageId = editorPageId(editor)
  if (!node || !pageId) return false
  let target = node.type.name === SYNCED ? { pos, node } : syncedAround(state.doc.resolve(pos))
  if (!target) {
    if (!editor.isEditable) return false
    const $p = state.doc.resolve(pos)
    const inList = LIST_ITEMS.has(node.type.name) && $p.depth > 0
    const wrapPos = inList ? $p.before() : pos
    const wrapNode = inList ? $p.parent : node
    const $w = state.doc.resolve(wrapPos)
    const type = state.schema.nodes[SYNCED]
    if (!$w.parent.canReplaceWith($w.index(), $w.index() + 1, type)) return false
    const syncId = newId()
    let synced: PMNode
    try {
      synced = type.createChecked({ syncId, sourcePageId: null }, wrapNode)
    } catch {
      return false
    }
    const tr = state.tr.replaceWith(wrapPos, wrapPos + wrapNode.nodeSize, synced)
    tr.setSelection(NodeSelection.create(tr.doc, wrapPos))
    editor.view.dispatch(tr.setMeta(SYNCED_META, true))
    expectOriginal(syncId, pageId)
    target = { pos: wrapPos, node: synced }
  }
  const syncId = String(target.node.attrs.syncId ?? '')
  if (!syncId) return false
  const source = (target.node.attrs.sourcePageId as string | null) || pageId
  void copyReference(syncId, source, target.node.content.toJSON() as JSONContent[])
  return true
}

/** Slash menu "Synced block": a new, empty original (below the synced block the caret is in, if any). */
export function insertSynced(editor: Editor, range?: Range | null): void {
  const json = newSyncedJson(newId())
  const outer = syncedAround(editor.state.selection.$from)
  if (!outer) return void insertBlock(editor, json, range)
  // no synced block inside a synced block: the new one goes right below
  const tr = editor.state.tr
  if (range) tr.delete(range.from, range.to)
  const at = tr.mapping.map(outer.pos + outer.node.nodeSize)
  tr.insert(at, editor.schema.nodeFromJSON(json))
  tr.setSelection(TextSelection.create(tr.doc, at + 2))
  editor.view.dispatch(tr.scrollIntoView())
  editor.view.focus()
  toast({ message: t('editor.synced.noNesting'), kind: 'info' })
}

/** This synced block becomes normal blocks (its content stays in place). */
export function unsyncAt(editor: Editor, pos: number): boolean {
  const node = syncedAt(editor, pos)
  if (!node) return false
  const tr = editor.state.tr.replaceWith(pos, pos + node.nodeSize, node.content)
  tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(pos + 1, tr.doc.content.size))))
  editor.view.dispatch(tr.setMeta(SYNCED_META, true).scrollIntoView())
  editor.view.focus()
  toast({ message: t('editor.synced.unsynced'), kind: 'success' })
  return true
}

/** "Unsync all" on the original: every copy — on this page and all others — becomes normal blocks. */
export function unsyncAll(editor: Editor, pos: number): void {
  const node = syncedAt(editor, pos)
  const pageId = editorPageId(editor)
  const syncId = node ? String(node.attrs.syncId ?? '') : ''
  if (!node || !syncId) return
  const others = (syncedEntry(syncId)?.uses ?? []).filter((u) => u.pageId !== pageId).length
  const run = () => {
    if (editor.isDestroyed) return
    const spots: Array<{ pos: number; node: PMNode }> = []
    editor.state.doc.descendants((n, p) => {
      if (n.type.name === SYNCED) {
        if (n.attrs.syncId === syncId) spots.push({ pos: p, node: n })
        return false
      }
      return !n.isTextblock
    })
    const tr = editor.state.tr
    for (const s of spots.reverse()) tr.replaceWith(s.pos, s.pos + s.node.nodeSize, s.node.content)
    if (tr.docChanged) editor.view.dispatch(tr.setMeta(SYNCED_META, true))
    const n = unsyncEverywhere(syncId, pageId)
    toast({ message: n ? t('editor.synced.unsyncedAll', { count: n + 1 }) : t('editor.synced.unsynced'), kind: 'success' })
  }
  if (!others) return run()
  useUI.getState().openModal({
    type: 'confirm',
    title: t('editor.synced.unsyncAllTitle'),
    body: t('editor.synced.unsyncAllBody', { count: others }),
    confirmLabel: t('editor.synced.unsyncAll'),
    onConfirm: run,
  })
}

/** Open the page of the original and flash the block. */
export function goToOriginal(syncId: string): boolean {
  const e = syncedEntry(syncId)
  if (!e?.source) return false
  openPage(e.source, e.sourceBlockId ?? undefined)
  return true
}

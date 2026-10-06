/**
 * Claude for files in the AI terminal: ⌘⇧J on a selected file block adds a file reference chip
 * ("▤ Acme mail · PDF 1.2 MB"); the next task sends the file as a `document` block in its user message — a PDF
 * as base64 (the API's limits checked first), any other file One can read as its text (Word / HTML as
 * Markdown, tables as CSV). A file that cannot be read is left out with a note — the task still runs.
 */
import type { Editor } from '@tiptap/core'
import type { BetaContentBlockParam, BetaMessageParam } from '@anthropic-ai/sdk/resources/beta/messages/messages'
import { newId } from '../../../lib/ids'
import type { ID } from '../../../store/types'
import type { TermRef } from '../agent/types'
import { AIError } from '../client'
import { clipText, fileData, FILE_READ_MAX, loadPdfForClaude } from './load'
import { fileText } from './convert'
import { PPTX_MAX_BYTES } from '../../io/import/pptx'
import { fileKind } from './kinds'
import { maxPdfPages } from './run'

/** The file block a range holds when it holds nothing else (a node-selected file block), else null. */
export function fileOnlyIn(editor: Editor, from: number, to: number): { src: string; name: string } | null {
  const { doc } = editor.state
  let hit: { src: string; name: string } | null = null
  let count = 0
  let other = false
  doc.nodesBetween(from, to, (node) => {
    if (node.type.name === 'fileBlock') {
      count++
      const src = typeof node.attrs.src === 'string' ? node.attrs.src.trim() : ''
      const name = String(node.attrs.name ?? '')
      if (src && fileKind(name)) hit = { src, name }
      return false
    }
    if (node.isTextblock && node.textContent.trim()) other = true
    return !node.isTextblock
  })
  return count === 1 && !other ? hit : null
}

/** The reference of a file (its size is filled in once known: TermRef.file.bytes). */
export function fileRef(file: { src: string; name: string }, pageId: ID, title: string): TermRef {
  return {
    id: newId(),
    pageId,
    title,
    // what Claude reads in the <reference>; the file itself goes along as a document block
    markdown: `[File block: ${file.name}] (the file is attached to this task as a document · source ${file.src.slice(0, 160)})`,
    lines: 1,
    file: { src: file.src, name: file.name, bytes: null },
  }
}

/** The document block of a referenced file. Throws FileLoadError / AIError('aborted'). */
async function documentOf(ref: NonNullable<TermRef['file']>, signal: AbortSignal): Promise<BetaContentBlockParam> {
  const kind = fileKind(ref.name)
  if (kind === 'pdf') {
    const pdf = await loadPdfForClaude(ref.src, maxPdfPages(), signal)
    return { type: 'document', title: ref.name, source: { type: 'base64', media_type: 'application/pdf', data: pdf.data } }
  }
  if (!kind) throw new AIError('bad_request', 'unknown file type')
  const { bytes } = await fileData(ref.src, kind === 'pptx' ? PPTX_MAX_BYTES : FILE_READ_MAX, signal)
  const { text } = clipText((await fileText(kind, bytes, ref.name)).text)
  return { type: 'document', title: ref.name, source: { type: 'text', media_type: 'text/plain', data: text } }
}

/**
 * The task's user message with the referenced files in front of its text (after open tool results).
 * `failed(title)` hears about every file that could not be read.
 */
export async function withRefFiles(user: BetaMessageParam, refs: TermRef[], signal: AbortSignal, failed: (title: string) => void): Promise<BetaMessageParam> {
  const files = refs.filter((r) => r.file)
  if (!files.length) return user
  const blocks: BetaContentBlockParam[] = []
  let n = 0
  for (const r of files) {
    try {
      const block = await documentOf(r.file!, signal)
      n++
      blocks.push({ type: 'text', text: `File ${n} — the file block "${r.file!.name}" referenced from the page "${r.title}" (page_id ${r.pageId}):` })
      blocks.push(block)
    } catch {
      if (signal.aborted) throw new AIError('aborted')
      failed(r.title)
      blocks.push({ type: 'text', text: `[The file "${r.file!.name}" referenced from the page "${r.title}" could not be read and is missing here.]` })
    }
  }
  const content: BetaContentBlockParam[] = typeof user.content === 'string' ? [{ type: 'text', text: user.content }] : [...user.content]
  // tool results must stay first in a user turn
  const firstOther = content.findIndex((b) => b.type !== 'tool_result')
  const at = firstOther < 0 ? content.length : firstOther
  content.splice(at, 0, ...blocks)
  return { ...user, content }
}

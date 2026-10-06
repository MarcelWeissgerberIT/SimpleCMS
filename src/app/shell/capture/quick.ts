/**
 * Quick capture — what "Save" writes (the sheet is QuickCapture.tsx). Everything is local first: the
 * text and the files land in this workspace right away, online or not.
 *
 *  - Clippings (default): a page in the Inbox — the first line is its title, the rest its body (Markdown).
 *  - A database: a row — title from the first line, the rest + the files as its body.
 *  - Any other page: the text (Markdown) and the files are added at its end.
 * Files (photos, attachments) are stored with saveFile() and become image / fileBlock / audio / video
 * blocks. Writes use origin 'clip'.
 */
import type { JSONContent } from '@tiptap/core'
import { format } from 'date-fns'
import { de as deLocale, enUS } from 'date-fns/locale'
import { markdownToDoc } from '../../editor'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import type { ID, Page } from '../../store/types'
import { t } from '../../i18n'
import type { FileBlockKind } from '../../features'
import { CLIP_ORIGIN, INBOX_ID_PREFIX, ensureInbox, fileInInbox } from './inbox'
import { storeFiles } from './share'

export type CaptureTarget = { kind: 'inbox' } | { kind: 'page'; id: ID } | { kind: 'database'; id: ID }

export interface CaptureFile {
  name: string
  type: string
  blob: Blob
}

export interface CaptureResult {
  /** the page written: the new Clippings page, the new row, or the page the capture was added to */
  id: ID
  target: CaptureTarget
  kinds: Set<FileBlockKind>
  failed: number
}

const TITLE_MAX = 120
const ws = () => useWorkspace.getState()

/** "# Title", "- item", "> quote", "1. step", "[ ] task" → the words of the line. */
const bare = (line: string) =>
  line
    .replace(/^\s*(#{1,6}\s+|[-*+]\s+(\[[ xX]\]\s+)?|>\s*|\d+[.)]\s+|\[[ xX]\]\s+)/, '')
    .replace(/\s+/g, ' ')
    .trim()

/**
 * The first line → the title, the rest → the body. A first line too long for a title is shortened at a
 * word ("…") and the whole text stays in the body.
 */
export function splitCapture(text: string): { title: string; body: string } {
  const src = text.replace(/\r\n?/g, '\n').replace(/^\s*\n/, '')
  const nl = src.indexOf('\n')
  const first = bare(nl >= 0 ? src.slice(0, nl) : src)
  const rest = nl >= 0 ? src.slice(nl + 1) : ''
  const chars = Array.from(first)
  if (chars.length <= TITLE_MAX) return { title: first, body: rest.trim() ? rest : '' }
  const cut = chars.slice(0, 80).join('').replace(/\s+\S*$/, '')
  return { title: `${cut}…`, body: src }
}

/** "Note · Oct 6, 2026, 14:05" — the title of a capture without text (a photo, a file). */
function stampTitle(): string {
  const de = ws().settings.language === 'de'
  return t('shell.capture.noteTitle', { time: format(new Date(), de ? 'd. MMM yyyy, HH:mm' : 'MMM d, yyyy, HH:mm', { locale: de ? deLocale : enUS }) })
}

const mdBlocks = (md: string): JSONContent[] => (md.trim() ? (markdownToDoc(md).content ?? []).filter(Boolean) : [])

/** Blocks ending on an editable line (an atom last would leave no place for the caret). */
function withTail(blocks: JSONContent[]): JSONContent[] {
  const last = blocks[blocks.length - 1]
  const textLast = last && ['paragraph', 'heading', 'bulletList', 'orderedList', 'taskList', 'blockquote'].includes(last.type ?? '')
  return textLast ? blocks : [...blocks, { type: 'paragraph' }]
}

/** Can quick capture write to this page / database right now? */
export function writable(p: Page | undefined): boolean {
  const pages = ws().pages
  return !!p && !p.trashed && !p.databaseId && !isEffectivelyTrashed(pages, p.id) && !inTemplate(pages, p.id) && (p.kind === 'database' || !p.settings.locked)
}

/** Where a capture can go besides Clippings: databases first, then pages — most recently edited first. */
export function captureTargets(): Array<{ id: ID; kind: 'page' | 'database'; page: Page }> {
  const pages = ws().pages
  const dbs = ws().databases
  return Object.values(pages)
    .filter((p) => writable(p) && !p.id.startsWith(INBOX_ID_PREFIX) && (p.kind === 'page' || !!dbs[p.id]))
    .sort((a, b) => (a.kind === b.kind ? b.updatedAt - a.updatedAt : a.kind === 'database' ? -1 : 1))
    .slice(0, 400)
    .map((p) => ({ id: p.id, kind: p.kind, page: p }))
}

/** Save a capture. Throws when the target cannot take it any more (gone, locked). */
export async function saveCapture(input: { text: string; files: CaptureFile[]; target: CaptureTarget }): Promise<CaptureResult> {
  const { text, target } = input
  if (target.kind !== 'inbox' && !writable(ws().pages[target.id])) throw new Error('target not writable')
  const { blocks: fileBlocks, kinds, failed } = await storeFiles(input.files)
  const { title, body } = splitCapture(text)

  if (target.kind === 'page') {
    const page = ws().pages[target.id]
    if (!writable(page)) throw new Error('target not writable')
    const before = [...(page.content?.content ?? [])]
    // a trailing empty line is where the next words go: the capture takes its place
    while (before.length && before[before.length - 1].type === 'paragraph' && !before[before.length - 1].content?.length) before.pop()
    const added = [...mdBlocks(text), ...fileBlocks]
    ws().setContent(page.id, { ...(page.content ?? {}), type: 'doc', content: withTail([...before, ...added]) }, CLIP_ORIGIN)
    return { id: page.id, target, kinds, failed }
  }

  const content = withTail([...mdBlocks(body), ...fileBlocks])
  if (target.kind === 'database') {
    const id = ws().createRow(target.id, { title: title || stampTitle() })
    ws().setContent(id, { type: 'doc', content }, CLIP_ORIGIN)
    return { id, target, kinds, failed }
  }

  const inbox = ensureInbox()
  const id = ws().createPage({ parentId: inbox, title: title || stampTitle() })
  ws().setContent(id, { type: 'doc', content }, CLIP_ORIGIN)
  fileInInbox(inbox, id)
  return { id, target: { kind: 'inbox' }, kinds, failed }
}

/**
 * Files shared into the installed app (Android, desktop Chrome: manifest share_target, POST multipart).
 *
 *  - The service worker (public/sw.js) keeps what arrived — files (≤ 25 MB each, ≤ 50 MB together) plus
 *    title / text / url — in IndexedDB `one-share` (never the workspace) and opens #/clip?share=<id>.
 *  - Here: read it and show it first (ClipConfirm — any app, and any web page posting a form to the share
 *    action, can share into One, so it never saves on its own). "Save to Clippings" stores the files with
 *    saveFile() and writes a Clippings page: dateline, bookmark, quote, then image / fileBlock / audio /
 *    video blocks. Saved or discarded, the entry is deleted; entries older than a day go at the next share.
 *  - Then the next step in a toast: images → Describe / Read out text, PDFs → Summarise / Extract tables
 *    (Claude for images / files). Offline, the toast says the AI steps wait — they are offered again online.
 *    Audio is kept as it is: meeting notes transcribe live speech only, not a recording.
 */
import type { Editor, JSONContent } from '@tiptap/core'
import { createStore, del, entries, get, type UseStore } from 'idb-keyval'
import { saveFile } from '../../lib/files'
import { navigate, parseHash } from '../../lib/router'
import { flushSave } from '../../store/persistence'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import { t } from '../../i18n'
import { liveEditorOf } from '../../editor'
import { classifyFile, startFileAction, startImageAction, type FileBlockKind } from '../../features'
import type { ID } from '../../store/types'
import { goToPage } from '../lib/actions'
import { clipToInbox, findInbox, normalizeClip } from './inbox'

export const SHARE_FILE_MAX = 25 * 1024 * 1024
export const SHARE_TOTAL_MAX = 50 * 1024 * 1024
const KEEP_MS = 24 * 3600_000
/** at most this many blocks get an AI run from one toast key */
const RUNS_MAX = 4

export interface SharedFile {
  name: string
  type: string
  size: number
  blob: Blob
}

export interface SkippedFile {
  name: string
  size: number
  /** 'size': over 25 MB · 'total': over 50 MB together (or too many files) */
  reason: 'size' | 'total'
}

export interface ShareEntry {
  id: string
  at: number
  title: string
  text: string
  url: string
  files: SharedFile[]
  skipped: SkippedFile[]
}

/** What the confirmation lists of a file. */
export interface ShareFileInfo {
  name: string
  size: number
  kind: FileBlockKind
}

let store: UseStore | null = null
/** The service worker's store (opened on first use: createStore opens the database right away). */
const shares = () => (store ??= createStore('one-share', 'shares'))

const str = (v: unknown, max: number) => (typeof v === 'string' ? v.slice(0, max) : '')

/** An entry as stored by the service worker, checked field by field (anything odd is dropped). */
function readEntry(raw: unknown, id: string): ShareEntry | null {
  if (!raw || typeof raw !== 'object') return null
  const r = raw as Record<string, unknown>
  const files: SharedFile[] = []
  let total = 0
  for (const f of Array.isArray(r.files) ? r.files : []) {
    const x = f as Record<string, unknown>
    if (!(x?.blob instanceof Blob)) continue
    const size = x.blob.size
    if (size > SHARE_FILE_MAX || total + size > SHARE_TOTAL_MAX) continue
    total += size
    files.push({ name: str(x.name, 200) || 'file', type: str(x.type, 120), size, blob: x.blob })
  }
  const skipped: SkippedFile[] = (Array.isArray(r.skipped) ? r.skipped : [])
    .map((s) => s as Record<string, unknown>)
    .filter((s) => s && typeof s.name === 'string')
    .map((s) => ({ name: str(s.name, 200), size: typeof s.size === 'number' ? s.size : 0, reason: s.reason === 'size' ? 'size' : 'total' }))
  return { id, at: typeof r.at === 'number' ? r.at : Date.now(), title: str(r.title, 400), text: str(r.text, 20_000), url: str(r.url, 4_000), files, skipped }
}

/** Drop a share (saved or discarded) and every one older than a day. */
async function dropShare(id: string): Promise<void> {
  try {
    await del(id, shares())
    for (const [key, value] of await entries(shares())) {
      const at = (value as { at?: unknown } | undefined)?.at
      if (typeof at !== 'number' || at < Date.now() - KEEP_MS) await del(key, shares())
    }
  } catch (e) {
    console.warn('[one] could not clear a shared item', e)
  }
}

/** File name without its extension ("IMG_2041.jpg" → "IMG_2041"). */
const stem = (name: string) => name.replace(/\.[a-z0-9]{1,8}$/i, '').trim() || name

/** The page title of a share: its own title / link / text first, else the file name (or "3 shared files"). */
function shareTitle(e: ShareEntry): string | undefined {
  const c = normalizeClip({ url: e.url, title: e.title, text: e.text })
  if (c.rawTitle || c.url || c.text || !e.files.length) return undefined
  return e.files.length === 1 ? stem(e.files[0].name).slice(0, 200) : t('shell.capture.share.filesTitle', { n: e.files.length })
}

/**
 * #/clip?share=<id> (the route is already replaced): show what arrived, save it on "Save to Clippings".
 * 'failed' = the service worker could not keep the share (storage full …).
 */
export async function receiveShare(id: string): Promise<void> {
  const ui = useUI.getState()
  if (id === 'failed') {
    ui.toast({ message: t('shell.capture.share.failed'), kind: 'error' })
    return
  }
  const entry = readEntry(await get(id, shares()), id)
  if (!entry) {
    ui.toast({ message: t('shell.capture.share.gone'), kind: 'error' })
    return
  }
  const clip = normalizeClip({ url: entry.url, title: entry.title, text: entry.text })
  if (!clip.url && !clip.rawTitle && !clip.text && !entry.files.length) {
    await dropShare(id)
    ui.toast({ message: entry.skipped.length ? t('shell.capture.share.allSkipped') : t('shell.capture.nothing'), kind: 'error' })
    return
  }
  const title = shareTitle(entry)
  const files: ShareFileInfo[] = entry.files.map((f) => ({ name: f.name, size: f.size, kind: classifyFile(f.name, f.type).kind }))
  const { openClipConfirm } = await import('./ClipConfirm')
  openClipConfirm(title ? { ...clip, title } : clip, () => void saveShare(entry, title), {
    share: { files, skipped: entry.skipped },
    onDiscard: () => void dropShare(id),
  })
}

/** The block a shared file becomes. */
export function fileBlockFor(kind: FileBlockKind, src: string, f: { name: string; size: number }): JSONContent {
  switch (kind) {
    case 'image':
      return { type: 'image', attrs: { src, alt: stem(f.name) } }
    case 'pdf':
      return { type: 'fileBlock', attrs: { src, name: f.name, size: f.size, display: 'viewer' } }
    case 'audio':
      return { type: 'audio', attrs: { src, name: f.name, caption: '' } }
    case 'video':
      return { type: 'video', attrs: { src, name: f.name, caption: '' } }
    default:
      return { type: 'fileBlock', attrs: { src, name: f.name, size: f.size, display: 'file' } }
  }
}

/**
 * Store files on this device (saveFile; HTML / SVG / XML typed as a plain download) and return their blocks
 * plus the kinds that came in. A file that cannot be stored is left out (counted in `failed`).
 */
export async function storeFiles(files: Array<{ name: string; type: string; blob: Blob }>): Promise<{ blocks: JSONContent[]; kinds: Set<FileBlockKind>; failed: number }> {
  const blocks: JSONContent[] = []
  const kinds = new Set<FileBlockKind>()
  let failed = 0
  for (const f of files) {
    try {
      const { kind, type } = classifyFile(f.name, f.type || f.blob.type)
      const blob = f.blob.type === type ? f.blob : new Blob([f.blob], { type })
      const src = await saveFile(blob, f.name)
      blocks.push(fileBlockFor(kind, src, { name: f.name, size: blob.size }))
      kinds.add(kind)
    } catch (e) {
      console.warn('[one] a shared file could not be stored', e)
      failed++
    }
  }
  return { blocks, kinds, failed }
}

async function saveShare(entry: ShareEntry, title: string | undefined): Promise<void> {
  const ui = useUI.getState()
  try {
    const { blocks, kinds, failed } = await storeFiles(entry.files)
    const id = clipToInbox({ url: entry.url, title: entry.title, text: entry.text }, { blocks, shared: true, title })
    await dropShare(entry.id)
    navigate({ name: 'page', id }, { replace: true })
    const inbox = findInbox()
    ui.toast({
      message: failed ? t('shell.capture.share.someFailed', { n: failed }) : t('shell.capture.clippedToast'),
      kind: failed ? 'error' : 'success',
      action: inbox ? { label: t('shell.capture.openInbox'), run: () => goToPage(inbox) } : undefined,
    })
    offerNextSteps(id, kinds)
    void flushSave().catch(() => {})
  } catch (e) {
    console.error('[one] share failed', e)
    ui.toast({ message: t('shell.capture.clipFailed'), kind: 'error' })
  }
}

/* ------------------------------------------------------------------ */
/* Next steps: Claude for the images and PDFs that came in             */
/* ------------------------------------------------------------------ */

type Step = { kind: 'image'; action: 'describe' | 'read' } | { kind: 'pdf'; action: 'summarize' | 'tables' }

const STEP_LABEL: Record<Step['action'], string> = {
  describe: 'shell.capture.next.describe',
  read: 'shell.capture.next.read',
  summarize: 'shell.capture.next.summarize',
  tables: 'shell.capture.next.tables',
}

/** The live editor of a page, once it is mounted (gives up after ~3 s). */
function editorWhenReady(pageId: ID, tries = 60): Promise<Editor | null> {
  return new Promise((resolve) => {
    const look = (left: number) => {
      const ed = liveEditorOf(pageId)
      if (ed && !ed.isDestroyed && ed.isEditable) return resolve(ed)
      if (left <= 0) return resolve(null)
      window.setTimeout(() => look(left - 1), 50)
    }
    look(tries)
  })
}

/** Positions of the page's images / PDF file blocks (document order). */
function blocksOf(editor: Editor, kind: Step['kind']): number[] {
  const out: number[] = []
  editor.state.doc.descendants((node, pos) => {
    if (out.length >= RUNS_MAX) return false
    if (kind === 'image' && node.type.name === 'image') out.push(pos)
    if (kind === 'pdf' && node.type.name === 'fileBlock' && /\.pdf$/i.test(String(node.attrs.name ?? ''))) out.push(pos)
    return !node.isAtom
  })
  return out
}

/** Run one next step on the page's images / PDFs (the page is opened first if it is not shown). */
async function runStep(pageId: ID, step: Step): Promise<void> {
  const p = useWorkspace.getState().pages[pageId]
  if (!p || p.trashed) return
  const route = parseHash(window.location.hash)
  if (route.name !== 'page' || route.id !== pageId) goToPage(pageId)
  const editor = await editorWhenReady(pageId)
  if (!editor) return
  // positions shift as runs write nothing yet: collect them first, start each run on its own block
  for (const pos of blocksOf(editor, step.kind)) {
    if (step.kind === 'image') startImageAction(editor, pos, step.action)
    else startFileAction(editor, pos, step.action)
  }
}

/**
 * The next step for what came in, as toasts: images → Describe / Read out text, PDFs → Summarise /
 * Extract tables. Offline: one note that these wait, offered again once the connection is back.
 */
export function offerNextSteps(pageId: ID, kinds: Set<FileBlockKind>): void {
  const groups: Array<{ message: string; steps: Step[] }> = []
  if (kinds.has('image'))
    groups.push({ message: t('shell.capture.next.images'), steps: [{ kind: 'image', action: 'describe' }, { kind: 'image', action: 'read' }] })
  if (kinds.has('pdf'))
    groups.push({ message: t('shell.capture.next.pdfs'), steps: [{ kind: 'pdf', action: 'summarize' }, { kind: 'pdf', action: 'tables' }] })
  if (!groups.length) return
  const ui = useUI.getState()
  if (!navigator.onLine) {
    ui.toast({ message: t('shell.capture.next.offline'), timeout: 8000 })
    window.addEventListener('online', () => offerNextSteps(pageId, kinds), { once: true })
    return
  }
  for (const g of groups) {
    const [first, ...rest] = g.steps
    ui.toast({
      message: g.message,
      timeout: 12_000,
      action: { label: t(STEP_LABEL[first.action]), run: () => void runStep(pageId, first) },
      more: rest.map((s) => ({ label: t(STEP_LABEL[s.action]), run: () => void runStep(pageId, s) })),
    })
  }
}

/**
 * Saving dropped / pasted / uploaded video + audio files. A big file takes a moment to land in
 * IndexedDB: its block is inserted right away (src: null) and shows a "saving" plate until the
 * file is stored, then gets its "onefile:" ref. The pending state is view state (a module map
 * keyed by block id) — nothing of it is ever written into the document.
 */
import { useSyncExternalStore } from 'react'
import type { Editor, JSONContent } from '@tiptap/core'
import { saveFile } from '../../lib/files'
import { toast } from '../../store/ui'
import { t } from '../../i18n'
import { MEDIA_MAX_BYTES, mediaKindOf, type MediaKind } from '../schema/media'

export interface PendingSave {
  name: string
  size: number
}

const pending = new Map<string, PendingSave>()
const listeners = new Set<() => void>()
const emit = () => listeners.forEach((l) => l())

function subscribe(l: () => void) {
  listeners.add(l)
  return () => {
    listeners.delete(l)
  }
}

/** The save in flight for a block (by id), or null. */
export function usePendingSave(id: string | null | undefined): PendingSave | null {
  return useSyncExternalStore(subscribe, () => (id ? (pending.get(id) ?? null) : null))
}

function newBlockId(): string {
  return typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`
}

/** False (with a toast) when a media file is too large to keep on this device. */
export function mediaFits(file: File): boolean {
  if (file.size <= MEDIA_MAX_BYTES) return true
  toast({ message: t('editor.media.tooLarge', { name: file.name, max: Math.round(MEDIA_MAX_BYTES / 1024 / 1024) }), kind: 'error' })
  return false
}

/** Ids of all blocks of one type. */
function idsOf(editor: Editor, type: string): Set<string> {
  const out = new Set<string>()
  editor.state.doc.descendants((node) => {
    if (node.type.name === type && typeof node.attrs.id === 'string') out.add(node.attrs.id)
    return !node.isTextblock && !node.isAtom
  })
  return out
}

/** Position of the block with this id and type, or null (deleted meanwhile). */
function findBlock(editor: Editor, id: string, type: string): number | null {
  let found: number | null = null
  editor.state.doc.descendants((node, pos) => {
    if (found !== null) return false
    if (node.type.name === type && node.attrs.id === id) {
      found = pos
      return false
    }
    return !node.isTextblock && !node.isAtom
  })
  return found
}

/**
 * Insert a video / audio block for `file` (via `insert`, which receives the block JSON) and
 * store the file. Returns false when the file isn't media; true once it was handled (also
 * when it was refused or failed — a toast told the user).
 */
export async function insertMediaFile(editor: Editor, file: File, insert: (node: JSONContent) => void): Promise<boolean> {
  const kind: MediaKind | null = mediaKindOf(file)
  if (!kind) return false
  if (!mediaFits(file)) return true
  const save = { name: file.name, size: file.size }
  let id = newBlockId()
  pending.set(id, save)
  emit()
  try {
    const before = idsOf(editor, kind)
    insert({ type: kind, attrs: { id, src: null, name: file.name } })
    // UniqueID may hand the new block another id (an atom inserted before a fresh line passes its
    // id on to that line): follow the block, not the id we asked for
    const actual = [...idsOf(editor, kind)].find((x) => !before.has(x))
    if (actual && actual !== id) {
      pending.delete(id)
      id = actual
      pending.set(id, save)
      emit()
    }
    const ref = await saveFile(file, file.name)
    if (editor.isDestroyed) return true
    const pos = findBlock(editor, id, kind)
    const node = pos === null ? null : editor.state.doc.nodeAt(pos)
    // a block deleted (or undone) while saving simply stays gone
    if (pos !== null && node) editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...node.attrs, src: ref }).setMeta('addToHistory', false))
  } catch (err) {
    console.warn('[editor] media save failed', err)
    toast({ message: t('editor.upload.failed'), kind: 'error' })
  } finally {
    pending.delete(id)
    emit()
  }
  return true
}

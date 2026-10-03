import type { Editor, JSONContent } from '@tiptap/core'
import { Fragment, Slice } from '@tiptap/pm/model'
import { dropPoint } from '@tiptap/pm/transform'
import { saveFile } from '../../lib/files'
import { toast } from '../../store/ui'
import { t } from '../../i18n'
import { insertBlock } from './blocks'
import { insertMediaFile } from './mediaSave'

const MAX_BYTES = 25 * 1024 * 1024

/** A dropped block lands between blocks (never splitting the paragraph under the pointer). */
function blockDropPos(editor: Editor, pos: number, json: JSONContent): number {
  try {
    const slice = new Slice(Fragment.from(editor.schema.nodeFromJSON(json)), 0, 0)
    return dropPoint(editor.state.doc, pos, slice) ?? pos
  } catch {
    return pos
  }
}

/** Store files locally (IndexedDB) and insert image / video / audio / file blocks. */
export async function uploadFiles(editor: Editor, files: File[], pos?: number | null): Promise<void> {
  for (const file of files) {
    // video + audio: own size limit, the block shows up right away while the file is stored
    const media = await insertMediaFile(editor, file, (node) => {
      if (pos !== undefined && pos !== null) {
        editor.chain().focus().insertContentAt(blockDropPos(editor, pos, node), node).run()
        pos = undefined
      } else insertBlock(editor, node)
    })
    if (editor.isDestroyed) return
    if (media) continue
    if (file.size > MAX_BYTES) {
      toast({ message: t('editor.upload.tooLarge', { name: file.name }), kind: 'error' })
      continue
    }
    try {
      const ref = await saveFile(file, file.name)
      if (editor.isDestroyed) return
      const node = file.type.startsWith('image/')
        ? { type: 'image', attrs: { src: ref, alt: file.name.replace(/\.[a-z0-9]+$/i, '') } }
        : { type: 'fileBlock', attrs: { src: ref, name: file.name, size: file.size } }
      if (pos !== undefined && pos !== null) {
        editor.chain().focus().insertContentAt(pos, node).run()
        pos = undefined
      } else insertBlock(editor, node)
    } catch (err) {
      console.warn('[editor] upload failed', err)
      toast({ message: t('editor.upload.failed'), kind: 'error' })
    }
  }
}

/** Open the native file picker. Resolves with [] when the dialog is cancelled. */
export function pickFiles(accept: string, multiple = false): Promise<File[]> {
  return new Promise((resolve) => {
    const input = document.createElement('input')
    input.type = 'file'
    input.accept = accept
    input.multiple = multiple
    input.style.display = 'none'
    let done = false
    const finish = (files: File[]) => {
      if (done) return
      done = true
      window.removeEventListener('focus', onFocus)
      input.remove()
      resolve(files)
    }
    // 'cancel' fires in current browsers; window focus is the fallback for older ones
    const onFocus = () => window.setTimeout(() => !input.files?.length && finish([]), 400)
    input.onchange = () => finish(Array.from(input.files ?? []))
    input.addEventListener('cancel', () => finish([]))
    document.body.appendChild(input)
    window.addEventListener('focus', onFocus)
    input.click()
  })
}

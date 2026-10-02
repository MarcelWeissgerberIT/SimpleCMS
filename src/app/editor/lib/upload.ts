import type { Editor } from '@tiptap/core'
import { saveFile } from '../../lib/files'
import { toast } from '../../store/ui'
import { t } from '../../i18n'
import { insertBlock } from './blocks'

const MAX_BYTES = 25 * 1024 * 1024

/** Store files locally (IndexedDB) and insert image / file blocks. */
export async function uploadFiles(editor: Editor, files: File[], pos?: number | null): Promise<void> {
  for (const file of files) {
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

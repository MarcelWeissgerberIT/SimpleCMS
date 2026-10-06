/**
 * A PowerPoint deck opened as a page in the file panel ("Open as page", nothing sent) keeps its pictures as
 * paths inside the file while it is a preview (the run's result stays small). When it goes into the page,
 * the pictures are read from the file again and stored on this device; one that cannot be read is left out.
 */
import type { JSONContent } from '@tiptap/core'
import { saveFile } from '../../../lib/files'
import { PPTX_MAX_BYTES, readPptxMedia } from '../../io/import/pptx'
import { basename, extname } from '../../io/import/plan'
import { fileData } from './load'

const MIME: Record<string, string> = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', svg: 'image/svg+xml', bmp: 'image/bmp', avif: 'image/avif' }

/** A picture still pointing into the file (not stored yet). */
const inFile = (src: unknown): src is string => typeof src === 'string' && !!src && !/^([a-z][a-z0-9+.-]*:|\/\/)/i.test(src)

/** The deck's pictures stored; the doc with their `onefile:` sources. */
export async function withDeckMedia(doc: JSONContent, src: string): Promise<JSONContent> {
  const paths = new Set<string>()
  const walk = (n: JSONContent) => {
    if (n.type === 'image' && inFile(n.attrs?.src)) paths.add(n.attrs.src)
    n.content?.forEach(walk)
  }
  walk(doc)
  if (!paths.size) return doc
  const refs = new Map<string, string>()
  try {
    const { bytes } = await fileData(src, PPTX_MAX_BYTES)
    for (const [p, data] of readPptxMedia(bytes, paths)) refs.set(p, await saveFile(new Blob([data as BlobPart], { type: MIME[extname(p)] ?? 'application/octet-stream' }), basename(p)))
  } catch (e) {
    console.warn('[file] deck pictures not stored', e)
  }
  const map = (nodes: JSONContent[]): JSONContent[] =>
    nodes.flatMap((n) => {
      if (n.type === 'image' && inFile(n.attrs?.src)) {
        const ref = refs.get(n.attrs.src)
        return ref ? [{ ...n, attrs: { ...n.attrs, src: ref } }] : []
      }
      return [n.content ? { ...n, content: map(n.content) } : n]
    })
  return { ...doc, content: map(doc.content ?? []) }
}

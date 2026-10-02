/**
 * Files-property helpers: upload, metadata cache (name / mime) for "onefile:" refs.
 */
import { useEffect, useState } from 'react'
import { FILE_PREFIX, getFile, saveFile } from '../../lib/files'

export interface FileMeta {
  name: string
  type: string
  size: number
}

const metaCache = new Map<string, FileMeta>()

const IMG_EXT = /\.(png|jpe?g|gif|webp|avif|svg|bmp)(\?|#|$)/i

export function guessIsImage(src: string, meta?: FileMeta | null): boolean {
  if (meta) return meta.type.startsWith('image/')
  if (src.startsWith('data:image/')) return true
  return IMG_EXT.test(src)
}

export function cachedFileName(src: string): string | null {
  return metaCache.get(src)?.name ?? null
}

export async function uploadFiles(files: FileList | File[]): Promise<string[]> {
  const out: string[] = []
  for (const f of Array.from(files)) {
    const ref = await saveFile(f, f.name)
    metaCache.set(ref, { name: f.name, type: f.type, size: f.size })
    out.push(ref)
  }
  return out
}

export function useFileMeta(src: string): FileMeta | null {
  const [meta, setMeta] = useState<FileMeta | null>(() => metaCache.get(src) ?? null)
  useEffect(() => {
    let alive = true
    if (!src.startsWith(FILE_PREFIX)) {
      setMeta(null)
      return
    }
    const hit = metaCache.get(src)
    if (hit) {
      setMeta(hit)
      return
    }
    getFile(src).then((f) => {
      if (!f || !alive) return
      const m = { name: f.name, type: f.type, size: f.size }
      metaCache.set(src, m)
      setMeta(m)
    })
    return () => {
      alive = false
    }
  }, [src])
  return meta
}

export function formatBytes(n: number): string {
  if (n < 1024) return `${n} B`
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(0)} KB`
  return `${(n / 1024 / 1024).toFixed(1)} MB`
}

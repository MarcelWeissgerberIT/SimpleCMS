/**
 * The drop zone (plan §1.12, §6 U25): while a file hovers the page, the bench shows a dashed zone — "Release to check
 * the profile" for a JSON file (or one whose type the browser does not tell yet), "Only .integration.json" for any other
 * type. The drop itself goes to the page's drop flow (DropFlow.tsx), which reads the name and the text.
 */
import { useEffect, useRef, useState, type RefObject } from 'react'
import { FileJson } from 'lucide-react'
import type { Translate } from '@/shared/i18n'

const P = 'features.patchbay'

export type ZoneKind = 'json' | 'other'

/** While a file hovers the page: which kind (a JSON file or not) — the zone over the bench shows it. */
export function useDragZone(page: RefObject<HTMLElement | null>, onFiles: (files: FileList | null) => void, enabled: boolean): ZoneKind | null {
  const [zone, setZone] = useState<ZoneKind | null>(null)
  const depth = useRef(0)
  useEffect(() => {
    const el = page.current
    if (!el || !enabled) return
    const files = (e: DragEvent) => !!e.dataTransfer && Array.from(e.dataTransfer.types ?? []).includes('Files')
    const kindOf = (e: DragEvent): ZoneKind => {
      const items = Array.from(e.dataTransfer?.items ?? []).filter((i) => i.kind === 'file')
      // a JSON file (or one whose type the browser does not tell yet: the drop checks its name)
      return items.length === 0 || items.some((i) => i.type === 'application/json' || i.type === '') ? 'json' : 'other'
    }
    const enter = (e: DragEvent) => {
      if (!files(e)) return
      e.preventDefault()
      depth.current++
      setZone(kindOf(e))
    }
    const over = (e: DragEvent) => {
      if (!files(e)) return
      e.preventDefault()
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy'
    }
    const leave = (e: DragEvent) => {
      if (!files(e)) return
      depth.current = Math.max(0, depth.current - 1)
      if (depth.current === 0) setZone(null)
    }
    const drop = (e: DragEvent) => {
      if (!files(e)) return
      e.preventDefault()
      depth.current = 0
      setZone(null)
      onFiles(e.dataTransfer?.files ?? null)
    }
    // a drag that ends anywhere else (dropped outside the page, Esc) leaves no zone behind
    const end = () => {
      depth.current = 0
      setZone(null)
    }
    el.addEventListener('dragenter', enter)
    el.addEventListener('dragover', over)
    el.addEventListener('dragleave', leave)
    el.addEventListener('drop', drop)
    window.addEventListener('dragend', end)
    window.addEventListener('drop', end)
    return () => {
      el.removeEventListener('dragenter', enter)
      el.removeEventListener('dragover', over)
      el.removeEventListener('dragleave', leave)
      el.removeEventListener('drop', drop)
      window.removeEventListener('dragend', end)
      window.removeEventListener('drop', end)
    }
  }, [page, onFiles, enabled])
  return zone
}

/** The dashed zone over the bench while a file hovers. */
export function DropZone({ t, kind }: { t: Translate; kind: ZoneKind | null }) {
  if (!kind) return null
  return (
    <div className="pb-dropzone" data-kind={kind} role="status" aria-label={t(`${P}.drop.zoneAria`)} data-testid="pb-dropzone">
      <span className="pb-dropzone__say">
        <FileJson size={18} strokeWidth={1.6} aria-hidden="true" />
        {t(kind === 'json' ? `${P}.drop.release` : `${P}.drop.onlyJson`)}
      </span>
    </div>
  )
}

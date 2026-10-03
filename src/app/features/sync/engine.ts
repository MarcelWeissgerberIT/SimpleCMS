/**
 * The diff between the workspace and a target (folder / GitHub repository): which files to write,
 * which to remove. Only files whose rendering changed since the last write are written; a page
 * that was renamed or moved is written at its new path and removed from the old one.
 */
import { useWorkspace } from '../../store/store'
import { t } from '../../i18n'
import { computeLayout, type Layout } from './layout'
import { layoutSig, renderFile, type RenderCtx, type Rendered } from './render'
import type { Desired, Manifest } from './types'

export interface PlannedWrite {
  desired: Desired
  /** text files; attachments are read when written */
  rendered?: Rendered
}

export interface SyncPlan {
  ctx: RenderCtx
  layout: Layout
  writes: PlannedWrite[]
  /** paths written before that are no longer part of the layout */
  deletes: string[]
  /** One's current rendering per text path (for pick-up checks) */
  renders: Map<string, Rendered>
  total: number
}

export async function buildCtx(manifest: Manifest): Promise<RenderCtx> {
  const [editor, database] = await Promise.all([import('../../editor'), import('../../database')])
  const s = useWorkspace.getState()
  const untitled = t('common.untitled')
  const layout = await computeLayout(s.pages, s.databases, manifest, untitled)
  return { pages: s.pages, databases: s.databases, people: s.people, layout, untitled, sig: layoutSig(s.pages, layout), editor, database }
}

/** Yield to the browser every ~12 ms of work. */
function budget(ms = 12) {
  let last = performance.now()
  return async () => {
    if (performance.now() - last < ms) return
    await new Promise((r) => setTimeout(r, 0))
    last = performance.now()
  }
}

export async function planSync(manifest: Manifest): Promise<SyncPlan> {
  const ctx = await buildCtx(manifest)
  const { layout } = ctx
  const writes: PlannedWrite[] = []
  const renders = new Map<string, Rendered>()
  const pause = budget()
  for (const f of layout.files) {
    const prev = manifest.entries[f.path]
    if (f.kind === 'file') {
      if (!prev || prev.ref !== f.ref || prev.kind !== 'file') writes.push({ desired: f })
      continue
    }
    const r = await renderFile(ctx, f)
    if (!r) continue
    renders.set(f.path, r)
    if (!prev || prev.out !== r.sha || prev.id !== f.id || prev.kind !== f.kind) writes.push({ desired: f, rendered: r })
    await pause()
  }
  const deletes = Object.keys(manifest.entries).filter((p) => !layout.byPath.has(p))
  return { ctx, layout, writes, deletes, renders, total: layout.files.length }
}

/** "Write spec.md" → "Write spec (conflict 2026-10-03 14-05).md" */
export function conflictPath(path: string, at = Date.now()): string {
  const d = new Date(at)
  const pad = (n: number) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ${pad(d.getHours())}-${pad(d.getMinutes())}`
  const i = path.lastIndexOf('.')
  const slash = path.lastIndexOf('/')
  return i > slash ? `${path.slice(0, i)} (conflict ${stamp})${path.slice(i)}` : `${path} (conflict ${stamp})`
}

export const isConflictCopy = (path: string) => /\(conflict \d{4}-\d{2}-\d{2}[^)]*\)(\.\w+)?$/.test(path)

/** Number of page / row files among the writes (the commit message counts these). */
export const pageCount = (writes: PlannedWrite[]) => writes.filter((w) => w.desired.kind === 'page' || w.desired.kind === 'row').length

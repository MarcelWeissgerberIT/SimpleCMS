/**
 * Database commands in ⌘K: every live database's visible commands as "<database>: <command>" (a
 * submenu's items one by one: "Projects: Open view · Board"). Found by typing — the palette keeps them
 * out of its empty "run" list.
 */
import { Zap, type LucideIcon } from 'lucide-react'
import { useWorkspace } from '../../store/store'
import { inTemplate, isEffectivelyTrashed } from '../../store/selectors'
import type { ID } from '../../store/types'
import { useCloud } from '../../cloud'
import { t } from '../../i18n'
import { visibleEntries } from './menu'
import { runEntry } from './run'

export interface PaletteCommand {
  /** "<databaseId>:<commandId>[/<item>]" */
  id: string
  label: string
  keywords: string
  icon: LucideIcon
  run: () => void
}

/** Commands of every live database for ⌘K (viewers: only those that don't write). */
export function paletteDbCommands(): PaletteCommand[] {
  const s = useWorkspace.getState()
  const readOnly = useCloud.getState().readOnly
  const out: PaletteCommand[] = []
  const keywords = t('features.cmd.key')
  for (const dbId of Object.keys(s.databases) as ID[]) {
    const page = s.pages[dbId]
    if (!page || page.trashed || isEffectivelyTrashed(s.pages, dbId) || inTemplate(s.pages, dbId)) continue
    const db = page.title.trim() || t('common.untitled')
    for (const e of visibleEntries(dbId, readOnly)) {
      const opts = { surface: 'palette' as const }
      if (e.source === 'default') {
        if (e.spec.disabled) continue
        if (e.spec.items) {
          for (const item of e.spec.items)
            out.push({ id: `${dbId}:${e.id}/${item.id}`, label: t('features.cmd.palette', { db, command: `${e.spec.label} · ${item.label}` }), keywords: `${keywords} ${e.id}`, icon: e.spec.icon, run: () => void runEntry(dbId, e, opts, item) })
          continue
        }
        out.push({ id: `${dbId}:${e.id}`, label: t('features.cmd.palette', { db, command: e.spec.label }), keywords: `${keywords} ${e.id}`, icon: e.spec.icon, run: () => void runEntry(dbId, e, opts) })
        continue
      }
      if (e.def?.unavailable?.({ databaseId: dbId, config: e.command.config ?? {}, rowIds: [], surface: 'palette' })) continue
      out.push({ id: `${dbId}:${e.id}`, label: t('features.cmd.palette', { db, command: e.label }), keywords: `${keywords} ${e.command.kind}`, icon: e.def?.icon ?? Zap, run: () => void runEntry(dbId, e, opts) })
    }
  }
  return out
}

/**
 * ⌘K "Run script: <name>" — every saved script (kind 'script'), found by typing. It runs for the page
 * that is open (page.current), with the app's dialogs and a toast with Undo. Viewers don't get them.
 */
import { SquareCode, type LucideIcon } from 'lucide-react'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { useCloud } from '../../../cloud'
import { toast } from '../../../store/ui'
import { t } from '../../../i18n'
import { runScriptById } from '../runtime/active'

export interface PaletteScript {
  /** "script:<id>" */
  id: string
  label: string
  keywords: string
  icon: LucideIcon
  run: () => void
}

/** The ⌘K entries; `pageId`: the page open now (page.current). */
export function paletteScripts(pageId: ID | null): PaletteScript[] {
  if (useCloud.getState().readOnly) return []
  const scripts = Object.values(useWorkspace.getState().scripts ?? {}).filter((s) => s.kind === 'script')
  return scripts
    .sort((a, b) => a.name.localeCompare(b.name))
    .map((s) => ({
      id: `script:${s.id}`,
      label: t('features.script.int.palette', { name: s.name }),
      keywords: 'run script skript ausführen one script',
      icon: SquareCode,
      run: () => {
        void runScriptById(s.id, { contextPageId: pageId }).then((r) => {
          if (!r && useWorkspace.getState().scripts?.[s.id]) toast({ kind: 'info', message: t('features.script.int.busy', { name: s.name }) })
        })
      },
    }))
}

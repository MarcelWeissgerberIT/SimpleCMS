/**
 * The "Try it" key of a changelog entry — and of the cards of "What can One do?": a fixed allow-list of
 * in-app actions (entries.ts CHANGELOG_TRIES). The Markdown only names one — what it does lives here, or, for
 * places another area owns (the guided tour and its practice page, a database, its commands …), in the action
 * that area registers at boot (`registerTry`). The help sheet steps aside first (except for "Ask the help",
 * which is part of it), so the thing it opens is not covered.
 */
import { openAgent, openMailSettings, openMcpSettings, openScripts, openSyncSettings } from '../../features'
import { navigate, parseHash } from '../../lib/router'
import { useUI } from '../../store/ui'
import { useWorkspace } from '../../store/store'
import { isEffectivelyTrashed } from '../../store/selectors'
import type { ID } from '../../store/types'
import { closeHelp, openHelp } from '../state'
import type { ChangelogTry } from './entries'

/** The key's caption (`help.news.try.<id>`) and, where there is one, its shortcut. */
export const TRY_SHORTCUT: Partial<Record<ChangelogTry, string>> = { terminal: 'Mod+J', palette: 'Mod+K' }

/** Actions other areas provide (the shell: the tour, its practice page, a database …). */
const provided = new Map<ChangelogTry, () => void>()

/** Register what a "Try it" key does for an action of the allow-list the help cannot do itself. */
export function registerTry(action: ChangelogTry, run: () => void): void {
  provided.set(action, run)
}

/** The page "history" / "share" act on: the open one, else the start page. */
function pageInView(): ID | null {
  const { pages, settings } = useWorkspace.getState()
  const ok = (id: ID | null | undefined): id is ID => !!id && !!pages[id] && !isEffectivelyTrashed(pages, id)
  const r = parseHash(window.location.hash)
  if (r.name === 'page' && ok(r.id)) return r.id
  return ok(settings.startPageId) ? settings.startPageId : null
}

export function runTry(action: ChangelogTry): void {
  if (action === 'ask') return openHelp({ tab: 'ask' })
  closeHelp()
  const ui = useUI.getState()
  // on a phone the sidebar drawer may be open over the page
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  const own = provided.get(action)
  if (own) return own()
  switch (action) {
    case 'terminal':
      return openAgent()
    case 'settings-ai':
      return ui.openModal({ type: 'settings', tab: 'ai' })
    case 'settings-mcp':
      return openMcpSettings()
    case 'settings-mail':
      return openMailSettings()
    case 'settings-sync':
      return openSyncSettings()
    case 'agents':
      return navigate({ name: 'agents' })
    case 'palette':
      return ui.openPalette()
    case 'scripts':
      return openScripts()
    case 'import':
      return ui.openModal({ type: 'import' })
    case 'inbox':
      return navigate({ name: 'inbox' })
    case 'discover':
      return navigate('#/discover')
    case 'coding':
      return navigate({ name: 'coding' })
    case 'kit':
      return navigate({ name: 'kit' })
    case 'history':
    case 'share': {
      const id = pageInView()
      if (id) ui.openModal({ type: action, pageId: id })
      return
    }
  }
}

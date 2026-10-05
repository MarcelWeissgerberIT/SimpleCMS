/**
 * The "Try it" key of a changelog entry: a fixed allow-list of in-app actions (entries.ts CHANGELOG_TRIES).
 * The Markdown only names one — what it does lives here. The help sheet steps aside first (except for
 * "Ask the help", which is part of it), so the thing it opens is not covered.
 */
import { openAgent, openMailSettings, openMcpSettings } from '../../features'
import { navigate } from '../../lib/router'
import { useUI } from '../../store/ui'
import { closeHelp, openHelp } from '../state'
import type { ChangelogTry } from './entries'

/** The key's caption (`help.news.try.<id>`) and, where there is one, its shortcut. */
export const TRY_SHORTCUT: Partial<Record<ChangelogTry, string>> = { terminal: 'Mod+J' }

export function runTry(action: ChangelogTry): void {
  if (action === 'ask') return openHelp({ tab: 'ask' })
  closeHelp()
  const ui = useUI.getState()
  // on a phone the sidebar drawer may be open over the page
  if (ui.mobileSidebarOpen) ui.setMobileSidebar(false)
  switch (action) {
    case 'terminal':
      return openAgent()
    case 'settings-ai':
      return ui.openModal({ type: 'settings', tab: 'ai' })
    case 'settings-mcp':
      return openMcpSettings()
    case 'settings-mail':
      return openMailSettings()
    case 'agents':
      return navigate({ name: 'agents' })
  }
}

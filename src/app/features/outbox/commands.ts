/**
 * Send routes as database commands (features/commands/defaults.ts group 'outbox', key `send:<profileId>/<routeId>`):
 * on the toolbar they act on the selected rows (none: "Pick a row"), elsewhere on the row open in the page / peek —
 * or the popover asks for one. They open the draft popover; nothing is sent from a command.
 */
import { parseHash } from '../../lib/router'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import type { ID } from '../../store/types'
import { routesFor } from './routes'
import { openDraft } from './ui/draftState'

export interface OutboxCommand {
  key: string
  label: string
  run: (ctx: { rowIds: ID[]; surface: 'sidebar' | 'toolbar' | 'palette' }) => void
}

/** The row on screen that belongs to the database (the peek first, then the page). */
function rowOnScreen(dbId: ID): ID | null {
  const s = useWorkspace.getState()
  const peek = useUI.getState().peekPageId
  if (peek && s.pages[peek]?.databaseId === dbId) return peek
  const r = parseHash(window.location.hash)
  return r.name === 'page' && s.pages[r.id]?.databaseId === dbId ? r.id : null
}

/** The open command key (its menu is open while an item runs): the popover opens at it. */
const openKey = (): Element | null => document.querySelector('[data-testid="db-commands"][aria-expanded="true"], [data-testid="tree-commands"][aria-expanded="true"]')

export function outboxCommands(dbId: ID): OutboxCommand[] {
  return routesFor(dbId).map((r) => ({
    key: `send:${r.ref.profileId}/${r.ref.routeId}`,
    label: r.label,
    run: ({ rowIds, surface }) => {
      const rows = rowIds.length ? rowIds : surface === 'toolbar' ? [] : [rowOnScreen(dbId)].filter((x): x is ID => !!x)
      openDraft({ dbId, route: r.ref, rowIds: rows, anchor: openKey() })
    },
  }))
}

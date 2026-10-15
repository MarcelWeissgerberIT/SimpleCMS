/**
 * ↵ / "Open ↵" / a double-click on a module (plan §3.9): the module's editor through each area's own opener — the model
 * names the target (Module.open, ids only), this file runs it. A dialog opened from here gives the keyboard back to the
 * module (handFocusOver: the modal takes it as its opener).
 */
import { navigate } from '../../../lib/router'
import { useUI } from '../../../store/ui'
import { handFocusOver } from '../../../ui/focus'
import { openAutofill } from '../../../database'
import { openMcpConnections, openMcpSettings } from '../../mcp'
import { openSyncSettings } from '../../sync'
import { openMailSettings } from '../../mail'
import { openCodingSettings } from '../../coding'
import type { Module, OpenTarget } from '../types'

/** Whether ↵ opens something for this module ("Whole workspace" and runtime-only servers have no editor here). */
export const canOpen = (m: Module): boolean => m.open.to !== 'none'

/** Open a module's editor; `from` = the element the keyboard goes back to when a dialog closes. */
export function openModule(m: Module, from?: HTMLElement | null): void {
  openTarget(m.open, from)
}

/** Open where a setting is changed (a module's editor, a refused key's "Open the editor"). */
export function openTarget(o: OpenTarget, from?: HTMLElement | null): void {
  if (from) handFocusOver(from)
  switch (o.to) {
    case 'route':
      navigate(o.route)
      return
    case 'modal':
      useUI.getState().openModal({ type: o.modal, databaseId: o.databaseId })
      return
    case 'mcp':
      openMcpConnections(o.server ? { server: o.server } : {})
      return
    case 'autofill':
      openAutofill(o.db, o.prop)
      return
    case 'templates':
      navigate({ name: 'page', id: o.db })
      return
    case 'settings':
      if (o.tab === 'mcp') openMcpSettings()
      else if (o.tab === 'sync') openSyncSettings()
      else if (o.tab === 'mail') openMailSettings()
      else openCodingSettings()
      return
    case 'none':
      return
  }
}

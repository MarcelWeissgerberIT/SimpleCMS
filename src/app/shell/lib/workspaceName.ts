/**
 * The workspace name — one name, shown everywhere (sidebar, switcher, document title, MCP, export
 * defaults) and renamed from the sidebar header or Settings. Local workspace: `settings.workspaceName`
 * (this browser). Team workspace: the server's name (admins rename it; it reaches every member live).
 * Rules: 1–60 characters, trimmed, inner whitespace collapsed, no control characters.
 */
import { useCloud } from '../../cloud'
import { useWorkspace } from '../../store/store'
import { cloudApi } from '../cloud/api'
import { canAdmin } from '../cloud/state'

export const WORKSPACE_NAME_MAX = 60

/** C0 / DEL / C1 control characters (line breaks, tabs, escapes) never belong in a name. */
const CONTROL = /[\u0000-\u001f\u007f-\u009f]/g

/** What the person typed, as a name: control characters out, whitespace trimmed and collapsed. */
export function cleanWorkspaceName(raw: string): string {
  return raw.replace(CONTROL, ' ').replace(/\s+/g, ' ').trim()
}

export type NameProblem = 'empty' | 'long'

export function workspaceNameProblem(name: string): NameProblem | null {
  if (!name) return 'empty'
  if ([...name].length > WORKSPACE_NAME_MAX) return 'long'
  return null
}

/**
 * Who may rename the open workspace here: 'local' (this browser's workspace), 'team' (an admin of the
 * open team workspace, connected) — or null: read-only (members, viewers, signed out, removed).
 */
export function useRenameMode(): 'local' | 'team' | null {
  return useCloud((c) => {
    if (c.active.kind === 'local') return 'local'
    if (c.readOnly || !canAdmin(c.role) || c.status === 'signed-out' || c.status === 'error' || c.status === 'checking') return null
    return 'team'
  })
}

/** Rename the open workspace (the name must be clean and valid). Team: PATCH on the server, live to everyone. */
export async function renameOpenWorkspace(name: string): Promise<void> {
  const c = useCloud.getState()
  if (c.active.kind === 'cloud') return cloudApi.renameWorkspace(c.active.id, name)
  useWorkspace.getState().updateSettings({ workspaceName: name })
}

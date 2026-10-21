/** Shareable workspace content, deliberately separate from a personal full backup. */
import { buildBackup, parseBackup, applyBackup, withoutWebhookSecrets, type Backup } from './backup'
import { withoutCommandSecrets } from '../commands'
import { emptyWorkspace, defaultSettings, useWorkspace } from '../../store/store'
import { migrate } from '../../store/persistence'
import { createLocalWorkspace, pendingWorkspace, finishWorkspaceImport } from '../../store/localWorkspaces'
import type { Workspace } from '../../store/types'
import { isReadableGovernor } from '@/shared/ai/governor'
import { flushSave, getSaveStatus } from '../../store/persistence'
import { newId } from '../../lib/ids'

export const WORKSPACE_PACKAGE = 'simplecms-one-workspace'
export interface WorkspacePackage { format: typeof WORKSPACE_PACKAGE; version: 1; backup: Backup }

/** Allowlist portable state. Device settings, connection configuration, approvals and authorizations never travel. */
export function portableWorkspace(input: Workspace, name: string): Workspace {
  const source = migrate(JSON.parse(JSON.stringify(input)))
  const hidden = new Set(Object.values(source.pages).filter(p => p.private).map(p => p.id))
  let changed = true
  while (changed) {
    changed = false
    for (const p of Object.values(source.pages)) if (p.parentId && hidden.has(p.parentId) && !hidden.has(p.id)) { hidden.add(p.id); changed = true }
  }
  const pages = Object.fromEntries(Object.entries(source.pages).filter(([id]) => !hidden.has(id)))
  for (const p of Object.values(pages)) { p.favorite = false; delete p.private }
  const databases = Object.fromEntries(Object.entries(source.databases).filter(([id]) => !hidden.has(id)).map(([id, db]) => {
    const safe = withoutCommandSecrets(withoutWebhookSecrets(db))
    return [id, { ...safe, automations: safe.automations?.map(a => ({ ...a, enabled: false })), templates: safe.templates?.map(t => ({ ...t, repeat: null })) }]
  }))
  return {
    ...emptyWorkspace(), pages, databases, people: source.people,
    settings: { ...defaultSettings(), workspaceName: name, startPageId: source.settings.startPageId && pages[source.settings.startPageId] ? source.settings.startPageId : null },
    functions: source.functions, scripts: source.scripts, kit: source.kit, look: source.look,
    agents: Object.fromEntries(Object.entries(source.agents ?? {}).map(([id, a]) => [id, { ...a, enabled: false }])),
    integrations: source.integrations, ai: source.ai, governor: isReadableGovernor(source.governor) ? source.governor : undefined,
  }
}
export async function buildWorkspacePackage(name: string): Promise<WorkspacePackage> {
  const backup = await buildBackup(null)
  backup.workspace = portableWorkspace(backup.workspace, name)
  // A team member's Private pages and unreferenced files never enter the shared package.
  const refs = JSON.stringify({ pages: backup.workspace.pages, databases: backup.workspace.databases })
  backup.files = backup.files.filter(f => refs.includes(JSON.stringify(f.ref)))
  return { format: WORKSPACE_PACKAGE, version: 1, backup }
}
export function parseWorkspacePackage(text: string): WorkspacePackage | null {
  try {
    const raw = JSON.parse(text) as WorkspacePackage
    if (raw?.format !== WORKSPACE_PACKAGE || raw.version !== 1) return null
    const backup = parseBackup(JSON.stringify(raw.backup))
    if (!backup || backup.scope !== 'workspace') return null
    return { format: WORKSPACE_PACKAGE, version: 1, backup }
  } catch { return null }
}
export async function makeLocalWorkspace(name: string, packet?: WorkspacePackage): Promise<string> {
  const workspace = emptyWorkspace()
  workspace.settings.workspaceName = name
  // Content is restored after the new scope is open, so attachments receive that scope's stamp.
  return createLocalWorkspace(name, workspace, packet ? { ...packet, backup: { ...packet.backup, workspace: portableWorkspace(packet.backup.workspace, name) } } : undefined)
}
export async function importPendingWorkspace(): Promise<void> {
  const pending = await pendingWorkspace()
  if (!pending) return
  const packet = parseWorkspacePackage(JSON.stringify(pending))
  if (!packet) throw new Error('Invalid workspace package')
  const snap = useWorkspace.getState()
  const safe = portableWorkspace(packet.backup.workspace, snap.settings.workspaceName)
  safe.epoch = snap.epoch ?? newId()
  const backup = { ...packet.backup, workspace: safe }
  await applyBackup(backup, 'replace', undefined, { workspaceOnly: true, freshFiles: true, ai: 'theirs' })
  await flushSave()
  if (getSaveStatus() === 'error') throw new Error('Workspace import could not be saved')
  await finishWorkspaceImport()
}

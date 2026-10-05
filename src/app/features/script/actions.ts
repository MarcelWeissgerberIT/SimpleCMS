/**
 * One Script — small actions other areas call (⌘K "New script", the list): create, duplicate, delete.
 * Light on purpose: no editor, no interpreter.
 */
import { useWorkspace } from '../../store/store'
import type { ID, OneScript } from '../../store/types'
import { newId } from '../../lib/ids'
import { navigate } from '../../lib/router'
import { t } from '../../i18n'
import { toast } from '../../store/ui'

/** A new script (or query) with a starter, opened in the editor. Returns its id (null: view only). */
export function createScript(kind: 'script' | 'query' = 'script', input: { name?: string; code?: string; open?: boolean } = {}): ID | null {
  const s = useWorkspace.getState()
  const now = Date.now()
  const id = newId()
  const script: OneScript = {
    id,
    name: input.name?.trim() || t(kind === 'query' ? 'features.script.newQueryName' : 'features.script.newScriptName'),
    code: input.code ?? t(kind === 'query' ? 'features.script.starter.query' : 'features.script.starter.script'),
    kind,
    createdAt: now,
    updatedAt: now,
  }
  s.upsertScript(script)
  if (!useWorkspace.getState().scripts?.[id]) return null
  if (input.open !== false) navigate(`#/scripts/${id}`)
  return id
}

export function duplicateScript(id: ID): ID | null {
  const src = useWorkspace.getState().scripts?.[id]
  if (!src) return null
  return createScript(src.kind, { name: `${src.name} ${t('features.script.copySuffix')}`, code: src.code })
}

/** Delete with an Undo toast. */
export function deleteScript(id: ID): void {
  const s = useWorkspace.getState()
  const src = s.scripts?.[id]
  if (!src) return
  s.deleteScript(id)
  toast({
    message: t('features.script.deleted', { name: src.name }),
    action: { label: t('common.undo'), run: () => useWorkspace.getState().upsertScript(src) },
  })
}

/** #/scripts (or one script). */
export function openScripts(id?: ID): void {
  navigate(id ? `#/scripts/${id}` : '#/scripts')
}

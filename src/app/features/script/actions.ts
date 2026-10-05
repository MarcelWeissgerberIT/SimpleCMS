/**
 * One Script — small actions other areas call (⌘K "New script", the list, the editor): create, save,
 * duplicate, delete. Light on purpose: no editor, no interpreter. A save in a team workspace also
 * marks that exact code as this device's own (runtime/trust.ts: it runs here without asking).
 */
import { useWorkspace } from '../../store/store'
import type { ID, OneScript } from '../../store/types'
import { newId } from '../../lib/ids'
import { navigate } from '../../lib/router'
import { useCloud } from '../../cloud'
import { t } from '../../i18n'
import { toast } from '../../store/ui'
import { trustCode } from './runtime/trust'
import { dropScriptRuns } from './runtime/runs'

/** Insert or replace a script (the store sanitizes and stamps it). False: view only / not valid. */
export function saveScript(script: OneScript): boolean {
  if (useCloud.getState().readOnly) return false
  const s = useWorkspace.getState()
  s.upsertScript(script)
  const saved = useWorkspace.getState().scripts?.[script.id]
  if (!saved) return false
  void trustCode(saved.code)
  return true
}

/** A new script (or query) with a starter, opened in the editor. Returns its id (null: view only). */
export function createScript(kind: 'script' | 'query' = 'script', input: { name?: string; code?: string; open?: boolean } = {}): ID | null {
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
  if (!saveScript(script)) return null
  if (input.open !== false) navigate(`#/scripts/${id}`)
  return id
}

export function duplicateScript(id: ID): ID | null {
  const src = useWorkspace.getState().scripts?.[id]
  if (!src) return null
  return createScript(src.kind, { name: `${src.name} ${t('features.script.copySuffix')}`, code: src.code })
}

/** Delete with an Undo toast (the run log of this device goes once the toast is gone). */
export function deleteScript(id: ID): void {
  const s = useWorkspace.getState()
  const src = s.scripts?.[id]
  if (!src || useCloud.getState().readOnly) return
  s.deleteScript(id)
  let undone = false
  toast({
    message: t('features.script.deleted', { name: src.name }),
    action: {
      label: t('common.undo'),
      run: () => {
        undone = true
        useWorkspace.getState().upsertScript(src)
      },
    },
  })
  window.setTimeout(() => {
    if (!undone && !useWorkspace.getState().scripts?.[id]) void dropScriptRuns(id)
  }, 12_000)
}

/** #/scripts (or one script). */
export function openScripts(id?: ID): void {
  navigate(id ? `#/scripts/${id}` : '#/scripts')
}

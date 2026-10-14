/**
 * Custom agents — the host of the agents' dialogs over any route (dialogs.ts: openMirrorSetup / openAgentEditor),
 * mounted once in ModalHost (B11). A lazy wrapper, and it must stay one: features/index.ts re-exports it, so whatever
 * this file imports statically is boot code. The dialogs (MirrorSetup, AgentEditor) live in AgentDialogs.tsx, a chunk
 * fetched only while a request is open — never import them here.
 */
import { lazy, Suspense } from 'react'
import { useAgentDialog } from './dialogs'

const Dialogs = lazy(() => import('./AgentDialogs'))

export function AgentDialogsHost() {
  const open = useAgentDialog()
  if (!open) return null
  return (
    <Suspense fallback={null}>
      <Dialogs request={open} />
    </Suspense>
  )
}

/**
 * Custom agents — the dialogs AgentDialogsHost renders over any route (a lazy chunk: MirrorSetup and the AgentEditor
 * load with it, never at boot). B1 (Patchbay seams): nothing to show yet — a request closes at once; B11 renders
 * MirrorSetup / AgentEditor as dialogs here and gives focus back to `request.req.from` when one closes.
 */
import { useEffect } from 'react'
import { closeAgentDialog, type AgentDialogRequest } from './dialogs'

export default function AgentDialogs({ request }: { request: AgentDialogRequest }): null {
  useEffect(() => closeAgentDialog(request.seq), [request.seq])
  return null
}

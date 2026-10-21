/** Explicit device-local enrollment. Workspace exports and the team server never receive these keys. */
import { currentWorkspace } from '../mcp/identity'
import { useCoding } from './state'
import { pairDownloaded, reconnect, viaFor } from './service'
import { PAIR_SECRET, WORKER_SUBPROTOCOL, type TabMessage, type WorkerMessage } from './protocol'

export async function authorizeWorkerWorkspace(retryStaleChallenge = true): Promise<void> {
  const workspace = currentWorkspace()
  const settings = useCoding.getState()
  if (!workspace || workspace.readOnly || viaFor(workspace) !== 'local') throw new Error('Workspace enrollment is unavailable.')
  const owner = settings.refusedWorkspaceOwner ? settings.pairs[settings.refusedWorkspaceOwner]?.secret : null
  const nonce = settings.refusedWorkspaceNonce
  if (!owner || !nonce || !PAIR_SECRET.test(nonce)) throw new Error('Download and start a paired device worker first.')
  const bytes = crypto.getRandomValues(new Uint8Array(32))
  const pair = btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  const encoder = new TextEncoder()
  const key = await crypto.subtle.importKey('raw', encoder.encode(owner), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign'])
  const signed = new Uint8Array(await crypto.subtle.sign('HMAC', key, encoder.encode(JSON.stringify([nonce, workspace.id, pair]))))
  const signature = btoa(String.fromCharCode(...signed)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  // Write ahead: closing/reloading this tab after the host saves the grant must not lose its key.
  pairDownloaded(workspace.id, pair, false)
  let freshChallenge = false
  try { await new Promise<void>((resolve, reject) => {
    const socket = new WebSocket(`ws://127.0.0.1:${settings.port}`, WORKER_SUBPROTOCOL)
    let done = false
    const finish = (ok: boolean) => {
      if (done) return
      done = true; clearTimeout(timer); socket.close()
      if (ok) resolve(); else reject(new Error('Workspace enrollment failed. Update the worker and retry with its original browser profile.'))
    }
    const timer = window.setTimeout(() => finish(false), 30000)
    socket.onopen = () => socket.send(JSON.stringify({ type: 'hello', app: 'one', version: 'workspace-enrollment', workspace, pair, authorizeWorkspace: { nonce, signature } } satisfies TabMessage))
    socket.onmessage = event => {
      let message: WorkerMessage
      try { message = JSON.parse(String(event.data)) } catch { return finish(false) }
      if (message.type === 'welcome') finish(true)
      else if (message.type === 'refused') {
        if (currentWorkspace()?.id === workspace.id && message.reason === 'workspace' && message.workspaceNonce && PAIR_SECRET.test(message.workspaceNonce)) {
          useCoding.setState({ refusedWorkspaceNonce: message.workspaceNonce })
          freshChallenge = message.workspaceNonce !== nonce
        }
        finish(false)
      }
    }
    socket.onerror = () => finish(false)
    socket.onclose = () => finish(false)
  }) } catch (error) {
    if (retryStaleChallenge && freshChallenge && currentWorkspace()?.id === workspace.id) return authorizeWorkerWorkspace(false)
    throw error
  }
  pairDownloaded(workspace.id, pair)
  // pairDownloaded reconnects only if this very workspace is still open.
  if (currentWorkspace()?.id === workspace.id) reconnect()
}

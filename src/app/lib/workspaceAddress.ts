import { activeWorkspace } from '../cloud'

/** Public workspace selector only; no account, device preference or connection credential in a link. */
export function workspaceChoice(): string {
  const ref = activeWorkspace()
  return ref.kind === 'local' ? (ref.id === 'local' ? 'local' : `local:${ref.id}`) : ref.id
}
export function linkInCurrentWorkspace(url: URL): boolean {
  const choice = url.searchParams.get('w')
  // Legacy unqualified links keep their previous meaning: a page of the workspace on screen.
  return !choice || choice === workspaceChoice()
}

/**
 * Schema gate, client side (docs/CLOUD.md § Schema gate). Every collab connection carries this build's
 * document schema generation (socket.ts `?schema=`). When the server needs a newer one it keeps the
 * connection read-only and says so with a stateless message on each document: this tab then stays read-only
 * (`outdated`) and asks the person to reload ("Reload to keep editing") — never sooner, never undone here.
 */
import type { HocuspocusProvider } from '@hocuspocus/provider'
import { t } from '../i18n'
import { useUI } from '../store/ui'
import { useCloud } from './state'

/** The server's notice (server/src/collab/schema-gate.ts `outdatedNotice`). */
const NOTICE = 'one.schema'

export function isOutdatedNotice(payload: unknown): boolean {
  if (typeof payload !== 'string' || payload.length > 200) return false
  try {
    const msg = JSON.parse(payload) as { type?: unknown; status?: unknown }
    return !!msg && msg.type === NOTICE && msg.status === 'outdated'
  } catch {
    return false
  }
}

/** This tab is behind the server's document schema: read-only from now on, told once. */
export function markOutdated(): void {
  const c = useCloud.getState()
  if (c.outdated) return
  useCloud.setState({ outdated: true, readOnly: true })
  useUI.getState().toast({
    message: t('shell.cloud.outdatedToast'),
    kind: 'error',
    action: { label: t('shell.cloud.banner.reload'), run: () => window.location.reload() },
    timeout: 30_000,
  })
}

/** Listen for the server's notice on a document provider (before it attaches: the notice comes with the first sync). */
export function watchSchema(provider: HocuspocusProvider): void {
  provider.on('stateless', ({ payload }: { payload: string }) => {
    if (isOutdatedNotice(payload)) markOutdated()
  })
}

/** Read-only for a role — and always once this tab is outdated. */
export const readOnlyFor = (role: string | null | undefined): boolean => role === 'viewer' || !!useCloud.getState().outdated

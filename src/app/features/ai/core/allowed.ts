/**
 * Data rules for a route, pure (next to routeFor — the gate applies the same rule at send time, gate.ts): may a request
 * on `route` carry data class `cls`? `ws` = the workspace's rules (`Workspace.ai`), `device` = this device's
 * (`settings.ai`) — pass `device: null` for work that does not run on this device (another member's browser agent, a
 * server agent): only the workspace's rules decide for it (the Patchbay, §1.3 #2 / §6 A17). Imports only the shared
 * contracts (Node specs read it directly).
 */
import { allowedFor } from '@/shared/ai/policy'
import type { DataClass, DeviceAI, Route, WorkspaceAI } from '@/shared/ai/types'

export function classAllowedOn(route: Pick<Route, 'p'>, cls: DataClass, o: { ws: WorkspaceAI | null | undefined; device: DeviceAI | null | undefined }): boolean {
  return allowedFor(route.p, cls, o.ws ?? null, o.device ?? null)
}

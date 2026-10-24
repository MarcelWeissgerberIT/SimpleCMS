import type { ProviderId, SourceRef } from '@/shared/ai/types'
import { modelDestinationAllowed, mcpDestinationAllowed, sourceDestinationsAllowed, pageDestinationAllowed } from '@/shared/ai/dataFlow'
import { useWorkspace } from '../../../store/store'
import { AIError } from './errors'

export function flowRestrictions() {
  const s = useWorkspace.getState()
  return [...(s.ai?.policy?.restricted ?? []), ...(s.settings.ai?.restricted ?? [])]
}
export function flowAllows(p: ProviderId, sources: readonly SourceRef[] = []): boolean {
  const s = useWorkspace.getState()
  return modelDestinationAllowed(p, s.ai?.dataFlow) && sourceDestinationsAllowed(p, sources, s, flowRestrictions())
}
export function flowPageVisible(p: ProviderId, id: string): boolean {
  return flowAllows(p) && pageDestinationAllowed(p, id, useWorkspace.getState(), flowRestrictions())
}
export function assertModelFlow(p: ProviderId, sources: readonly SourceRef[] = []): void {
  if (!flowAllows(p, sources)) throw new AIError('policy', 'destination')
}
export function assertMcpFlow(urls: readonly string[]): void {
  if (urls.some(url => !mcpDestinationAllowed(url, useWorkspace.getState().ai?.dataFlow))) throw new AIError('policy', 'mcp-destination')
}

export function flowSignature(): string {
  const s = useWorkspace.getState()
  return JSON.stringify([s.epoch, s.ai?.dataFlow?.providers, s.ai?.dataFlow?.mcpOrigins, s.ai?.policy?.restricted, s.settings.ai?.restricted])
}

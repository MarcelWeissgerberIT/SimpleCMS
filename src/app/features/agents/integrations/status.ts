/**
 * Integration profiles on this device: which ones are active (one of this device's ENABLED MCP servers — settings
 * .mcpServers with the tool list of its last connection test — satisfies every condition of the profile's match),
 * which server matched, and what they unlock. The pure rules are store/integrations.ts; this is the store glue:
 *  - unlocked(feature) / useUnlocked(feature): a feature is unlocked when an active profile names it
 *  - integrationStatuses() / useIntegrationStatuses(): every profile with its status
 *  - serverUnlocked(feature): the team server's view (its runtime's MCP servers, by name / host)
 * Nothing here is ever needed to ENFORCE something: flags on properties and allow-lists on agents work without it.
 */
import { useMemo } from 'react'
import { useWorkspace } from '../../../store/store'
import type { IntegrationFeature, IntegrationProfile, Settings } from '../../../store/types'
import { matchingServers, profileStatus, serverUnlockedBy, unlockedBy, type MatchServer, type ProfileStatus } from '../../../store/integrations'
import { readServers } from '../../ai/mcp-servers/config'
import { useServerAgents } from '../server'

export interface IntegrationState {
  profile: IntegrationProfile
  status: ProfileStatus
  /** every enabled server that satisfies the profile (the first one is `status.server`) */
  servers: string[]
}

/** This device's MCP servers as matching sees them. */
export function deviceServers(settings: Pick<Settings, 'mcpServers'> = useWorkspace.getState().settings): MatchServer[] {
  return readServers(settings).map((s) => ({ name: s.name, url: s.url, enabled: s.enabled, tools: s.tools }))
}

/** Every profile of the workspace with its status on this device (by name). */
export function integrationStatuses(profiles = useWorkspace.getState().integrations, settings: Pick<Settings, 'mcpServers'> = useWorkspace.getState().settings): IntegrationState[] {
  const servers = deviceServers(settings)
  return [...(profiles ?? [])]
    .sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id))
    .map((profile) => ({ profile, status: profileStatus(profile, servers), servers: matchingServers(profile, servers) }))
}

export function useIntegrationStatuses(): IntegrationState[] {
  const profiles = useWorkspace((s) => s.integrations)
  const servers = useWorkspace((s) => s.settings.mcpServers)
  return useMemo(() => integrationStatuses(profiles, { mcpServers: servers }), [profiles, servers])
}

/** The features unlocked on this device right now. */
export function unlockedFeatures(): Set<IntegrationFeature> {
  const s = useWorkspace.getState()
  return unlockedBy(s.integrations, deviceServers(s.settings))
}

/** Is `feature` unlocked on this device right now (an active profile names it)? */
export const unlocked = (feature: IntegrationFeature): boolean => unlockedFeatures().has(feature)

/** The same as a hook (re-renders when the profiles or this device's MCP servers change). */
export function useUnlocked(feature: IntegrationFeature): boolean {
  const profiles = useWorkspace((s) => s.integrations)
  const servers = useWorkspace((s) => s.settings.mcpServers)
  return useMemo(() => unlockedBy(profiles, deviceServers({ mcpServers: servers })).has(feature), [profiles, servers, feature])
}

/** For the team server's agents: unlocked by a profile that matches one of the runtime's MCP servers (name / host). */
export function useServerUnlocked(feature: IntegrationFeature): boolean {
  const profiles = useWorkspace((s) => s.integrations)
  const runtime = useServerAgents((s) => s.runtime)
  return useMemo(() => serverUnlockedBy(profiles, runtime?.mcpServers ?? []).has(feature), [profiles, runtime, feature])
}

/** The active profiles that bring recipes, with the server each matched. */
export function useRecipeSources(): Array<{ profile: IntegrationProfile; server: string; servers: string[] }> {
  const states = useIntegrationStatuses()
  return useMemo(() => states.filter((s) => s.status.active && s.profile.recipes?.length).map((s) => ({ profile: s.profile, server: s.servers[0], servers: s.servers })), [states])
}

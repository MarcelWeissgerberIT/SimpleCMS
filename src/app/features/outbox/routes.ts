/**
 * Send routes as the Outbox offers them: an ACTIVE integration profile (one of this device's enabled MCP servers
 * matches it) that unlocks `sends`, on a database its mirror agent fills from that server (mirrorSourceOf), with a key
 * property. A route of an inactive profile is not offered — its tool stays locked all the same (outToolsOf).
 */
import { useMemo } from 'react'
import { useWorkspace } from '../../store/store'
import type { Database, ID, IntegrationProfile, McpServerConfig, PropertyDef, SendRoute } from '../../store/types'
import { DEFAULT_VIA, hostOf, localized, matchingServers, profileStatus, serverMatch, type MatchServer } from '../../store/integrations'
import { readServers } from '../ai/mcp-servers/config'
import { mirrorSourceOf, recipeRoleNames } from '../agents'
import { useLang, currentLang } from '../../i18n'
import { textParam } from './template'
import type { ResolvedRoute, RouteRef, SendPath, StageRefusal } from './types'

const ws = () => useWorkspace.getState()

const matchView = (list: McpServerConfig[]): MatchServer[] => list.map((s) => ({ name: s.name, url: s.url, enabled: s.enabled, tools: s.tools }))

/** Profiles with routes that are active here and unlock `sends`. */
function sendProfiles(servers: McpServerConfig[]): IntegrationProfile[] {
  const view = matchView(servers)
  return (ws().integrations ?? []).filter((p) => p.sends?.length && p.unlocks.includes('sends') && profileStatus(p, view).active)
}

/** The key property of a database (its "Key" switch). */
export const keyPropOf = (db: Database | undefined): PropertyDef | null => db?.properties.find((p) => p.key) ?? null

/** Slice 1 sends by hand only: the worker, tab and connector paths are not built yet. */
export function usableOf(via: SendPath[]): { path: SendPath | null; reasons: string[] } {
  const reasons = via.filter((v) => v !== 'hand').map((v) => `${v}:none`)
  return { path: via.includes('hand') ? 'hand' : null, reasons }
}

function resolved(p: IntegrationProfile, r: SendRoute, server: McpServerConfig, lang = currentLang()): ResolvedRoute {
  const via = (r.via ?? DEFAULT_VIA) as SendPath[]
  return {
    ref: { profileId: p.id, routeId: r.id },
    ...(r.role ? { role: r.role } : {}),
    label: localized(r.label, lang) || r.id,
    tool: r.tool,
    server: { id: server.id, name: server.name, host: hostOf(server.url) },
    params: r.params ?? [],
    hasCheck: !!r.check,
    hasConfirm: !!r.confirm,
    via,
    usable: usableOf(via),
    probe: 'n/a',
    profileName: p.name,
    draftParam: textParam(r),
  }
}

/** The servers a database's mirror reads, as this device knows them (by name). */
function sourceServers(dbId: ID, servers: McpServerConfig[]): McpServerConfig[] {
  const src = mirrorSourceOf(dbId)
  if (!src) return []
  return src.servers.map((n) => servers.find((s) => s.name === n)).filter((s): s is McpServerConfig => !!s)
}

/** Every route offered on the rows of a database (none without a key property or a mirror). */
export function routesFor(dbId: ID, lang = currentLang()): ResolvedRoute[] {
  const s = ws()
  if (!keyPropOf(s.databases[dbId])) return []
  const servers = readServers(s.settings)
  const sources = sourceServers(dbId, servers)
  if (!sources.length) return []
  const out: ResolvedRoute[] = []
  for (const p of sendProfiles(servers)) {
    const server = sources.find((x) => x.enabled && serverMatch(p, [x]))
    if (!server) continue
    for (const r of p.sends ?? []) out.push(resolved(p, r, server, lang))
  }
  return out
}

export const routeByRole = (dbId: ID, role: string): ResolvedRoute | null => routesFor(dbId).find((r) => r.role === role) ?? null
export const routeById = (dbId: ID, routeId: string): ResolvedRoute | null => routesFor(dbId).find((r) => r.ref.routeId === routeId) ?? null

/** Every active route (#/outbox's routes panel): profile × the first server that matches it here. */
export function listRoutes(lang = currentLang()): ResolvedRoute[] {
  const servers = readServers(ws().settings)
  const out: ResolvedRoute[] = []
  for (const p of sendProfiles(servers)) {
    const name = matchingServers(p, matchView(servers)).find((n) => serverMatch(p, servers.filter((s) => s.name === n)))
    const server = servers.find((s) => s.name === name)
    if (!server) continue
    for (const r of p.sends ?? []) out.push(resolved(p, r, server, lang))
  }
  return out
}

/** A route for staging on a row of `dbId`: the profile, the route, the server — or why not. */
export function resolveRoute(ref: RouteRef, dbId: ID): { profile: IntegrationProfile; route: SendRoute; server: McpServerConfig } | { refused: StageRefusal } {
  const s = ws()
  const profile = (s.integrations ?? []).find((p) => p.id === ref.profileId)
  const route = profile?.sends?.find((r) => r.id === ref.routeId)
  if (!profile || !route) return { refused: 'noRoute' }
  const servers = readServers(s.settings)
  const server = sourceServers(dbId, servers).find((x) => serverMatch(profile, [x]))
  if (!server) return { refused: 'noRoute' }
  if (!server.enabled || !profile.unlocks.includes('sends') || !profileStatus(profile, matchView(servers)).active) return { refused: 'inactive' }
  if (!keyPropOf(s.databases[dbId])) return { refused: 'noKey' }
  return { profile, route, server }
}

/** The profile's role → property names (both languages). */
export function roleNamesFor(profileId: string): Record<string, string[]> {
  const p = (ws().integrations ?? []).find((x) => x.id === profileId)
  return p ? recipeRoleNames(p) : {}
}

/** A database property named by a route (`after[].property`, a role): its exact name, a role's name, then any case. */
export function propByRef(db: Database | undefined, ref: string, roles: Record<string, string[]>): PropertyDef | null {
  if (!db) return null
  const exact = db.properties.find((p) => p.name === ref)
  if (exact) return exact
  const names = roles[ref] ?? []
  const byRole = db.properties.find((p) => names.some((n) => n.toLowerCase() === p.name.toLowerCase()))
  if (byRole) return byRole
  const lower = ref.toLowerCase()
  return db.properties.find((p) => p.name.toLowerCase() === lower) ?? null
}

/** Routes of a database, live (profiles, servers, the mirror agent, the language). */
export function useRoutesFor(dbId: ID | null | undefined): ResolvedRoute[] {
  const lang = useLang()
  const profiles = useWorkspace((s) => s.integrations)
  const servers = useWorkspace((s) => s.settings.mcpServers)
  const agents = useWorkspace((s) => s.agents)
  const db = useWorkspace((s) => (dbId ? s.databases[dbId] : undefined))
  return useMemo(() => (dbId ? routesFor(dbId, lang) : []), [dbId, lang, profiles, servers, agents, db]) // eslint-disable-line react-hooks/exhaustive-deps
}

/** Every active route, live. */
export function useListRoutes(): ResolvedRoute[] {
  const lang = useLang()
  const profiles = useWorkspace((s) => s.integrations)
  const servers = useWorkspace((s) => s.settings.mcpServers)
  return useMemo(() => listRoutes(lang), [lang, profiles, servers]) // eslint-disable-line react-hooks/exhaustive-deps
}

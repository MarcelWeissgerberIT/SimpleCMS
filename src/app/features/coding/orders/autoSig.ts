/**
 * Work orders — the sig of "Ohne Bestätigung starten" (Orders B11, spec §3.5): SHA-256 over the settings the person
 * switched it on for, read on this device now (autoCore.ts AutoSigParts):
 *  - the work-orders database, its kinds, the pinned projects, "Nach der Analyse anhalten", the Budget je Kette;
 *  - the picked server: its name, address, the tools its connection test listed, the integration profiles matching it;
 *  - per kind (all three — a request's own Pipelines field may ask for any) the project it resolves to (pinned, else the
 *    one #/coding shows here, else none yet: the kind's template) and that pipeline's stages;
 *  - this device's Approvals.
 * Any change of these makes another sig: the consent lapses (autoWatch.ts) and a plan falls back to "Kette bereit".
 * Null: no consent can be given here (a team workspace, no readable config).
 */
import { useWorkspace } from '../../../store/store'
import { matchMiss } from '../../../store/integrations'
import type { ID } from '../../../store/types'
import { activeWorkspace } from '../../../cloud'
import { readServers } from '../../ai/mcp-servers/config'
import { canonicalJson } from '../protocol'
import { defaultApprovals } from '../state'
import { ORDER_KINDS, orderConfigUsable, readOrderConfig } from './config'
import { kindProjectsOf } from './facts'
import { stagesPart, type AutoSigParts } from './autoCore'

/** The parts of the sig as this device reads them now (null: no consent can be given for this database here). */
export function autoSigParts(db: ID): AutoSigParts | null {
  if (activeWorkspace().kind === 'cloud') return null
  const s = useWorkspace.getState()
  const read = readOrderConfig(s.databases[db])
  if (!orderConfigUsable(read)) return null
  const c = read.config
  const name = c.server?.name ?? null
  const srv = name ? readServers().find((x) => x.name === name) : undefined
  const profiles = srv
    ? (s.integrations ?? [])
        .filter((p) => p.match && (p.match.name || p.match.host || p.match.tools?.length) && !matchMiss(p.match, { name: srv.name, url: srv.url, enabled: true, tools: srv.tools }))
        .map((p) => p.id)
        .sort()
    : []
  return {
    v: 1,
    db,
    kinds: [...c.kinds],
    pinned: { ...(c.projects ?? {}) },
    checkpoint: c.checkpoint,
    budget: c.budgetUsd ?? null,
    server: name ? { name, url: srv?.url ?? null, tools: srv?.tools?.length ? [...srv.tools].sort() : null, profiles } : null,
    projects: kindProjectsOf(db, ORDER_KINDS).map((k) => ({ kind: k.kind, project: k.project, stages: stagesPart(k.pipeline) })),
    approvals: defaultApprovals(),
  }
}

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** The sig of the settings now (null: no consent can be given here). */
export async function autoSigNow(db: ID): Promise<string | null> {
  const parts = autoSigParts(db)
  return parts ? sha256Hex(canonicalJson(['one.orders.auto', parts])) : null
}

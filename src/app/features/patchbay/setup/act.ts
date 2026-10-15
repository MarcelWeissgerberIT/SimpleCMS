/**
 * ↵ on a lamp (plan §1.11): each lamp opens exactly its step of the setup that exists — never one of its own:
 *   00 key        openAISetup({ reason: 'patchbay', step: 'key', provider: 'anthropic' }) — the assistant (a dialog)
 *   01 server     openAISettings({ section: 'mcp', server }) or { add: true } — Settings › AI (a dialog)
 *   02 test       openMcpConnections({ server, focus: 'test' }) — the page's Test key focused; the lamp never runs a
 *                 test itself (a test is a Claude request: the gate and the Regler decide, on the person's press)
 *   03 profile    openIntegrations(profile) — Workspace › Integrations, that profile focused
 *   04 database   openMirrorSetup({ profileId, recipeId }) — MirrorSetup as a dialog over the patchbay
 *   05 agent      openAgentEditor(agent or kept draft) — the editor as a dialog; a lost draft: MirrorSetup again
 *   06 first run  runAgentNow(agent) (it asks for placeholders first; a toast) · the run's review on #/agents/<id>
 * The steps that leave the route (02, 03, 06's review) set the way back (return.ts) first: the topbar's chip leads back.
 * The dialogs give focus back to the lamp's key (`from`); after a create or a save it moves on to the next lamp's key.
 */
import { navigate } from '../../../lib/router'
import { openAISettings, openAISetup } from '../../ai/setup/openAISetup'
import { openMcpConnections } from '../../mcp'
import { openAgentEditor, openIntegrations, openMirrorSetup, runAgentNow } from '../../agents'
import type { AgentDialogOutcome } from '../../agents/dialogs'
import { useWorkspace } from '../../../store/store'
import type { LampId, SetupLamp } from '../types'
import { setReturn } from './return'
import { focusLampKey } from './focus'
import { lampsNow } from './facts'
import { setOf } from './lamps'

export interface LampContext {
  profileId: string
  /** the recipe of the set the lamp belongs to (04–06; the recipe tab shown) */
  recipeId?: string | null
  /** the lamp's key (focus goes back there when a dialog closes) */
  from?: HTMLElement | null
}

/** After a dialog made something: focus the lamp that is next now (the band re-renders with the store write). */
function moveOn(ctx: LampContext) {
  return (o: AgentDialogOutcome) => {
    if (o.kind === 'closed') return
    const now = lampsNow(ctx.profileId)
    const next = now ? setOf(now.sets, ctx.recipeId)?.next : null
    if (next) void focusLampKey(next, { from: ctx.from })
  }
}

/**
 * The way back for a step that leaves the patchbay — `next`: the lamp the setup works on now (the arrival says
 * "02 done" only when THAT one went green; a green lamp opened as a quiet link leaves the next lamp as it is).
 */
function leave(ctx: LampContext, lamp: SetupLamp): void {
  const now = lampsNow(ctx.profileId)
  const next: LampId = (now && setOf(now.sets, ctx.recipeId)?.next?.id) || lamp.id
  setReturn({ profileId: ctx.profileId, ...(ctx.recipeId ? { recipeId: ctx.recipeId } : {}), next })
}

/** Run a lamp's action (its key's press). False when the lamp has none (a dark lamp waits). */
export function runLamp(lamp: SetupLamp, ctx: LampContext): boolean {
  const a = lamp.action
  if (!a || lamp.state === 'dark') return false
  switch (a.kind) {
    case 'aiSetup':
      openAISetup({ reason: 'patchbay', step: 'key', provider: a.provider, feature: 'agents' })
      return true
    case 'mcpSettings':
      openAISettings({ section: 'mcp', ...(a.server ? { server: a.server } : {}), ...(a.add ? { add: true } : {}) })
      return true
    case 'mcpTest':
      leave(ctx, lamp)
      openMcpConnections({ server: a.server, focus: 'test' })
      return true
    case 'integrations':
      leave(ctx, lamp)
      openIntegrations(a.profile)
      return true
    case 'mirrorSetup':
      openMirrorSetup({ profileId: a.profile, ...(a.recipe ? { recipeId: a.recipe } : {}), from: ctx.from ?? null, after: moveOn(ctx) })
      return true
    case 'agentEditor':
      openAgentEditor(a.agent, { from: ctx.from ?? null, after: moveOn(ctx) })
      return true
    case 'runAgent': {
      const agent = useWorkspace.getState().agents?.[a.agent]
      if (!agent) return false
      void runAgentNow(agent)
      return true
    }
    case 'review':
      leave(ctx, lamp)
      navigate({ name: 'agents', id: a.agent })
      return true
  }
}

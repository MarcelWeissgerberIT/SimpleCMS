/**
 * ↵ on a lamp (plan §1.11): each lamp opens exactly its step of the setup that exists — never one of its own:
 *   00 key        openAISetup({ reason: 'patchbay', step: 'key', provider: 'anthropic' }) — the assistant (a dialog)
 *   01 server     openAISettings({ section: 'mcp', server, quiet: true }) or { add: true } — Settings › AI (a dialog;
 *                 quiet: no server is checked on its own — a check is a Claude request, only the person's press runs it)
 *   02 test       openMcpConnections({ server, focus: 'test' }) — the page's Test key focused; the lamp never runs a
 *                 test itself (a test is a Claude request: the gate and the Regler decide, on the person's press)
 *   03 profile    openIntegrations(profile) — Workspace › Integrations, that profile focused
 *   04 database   openMirrorSetup({ profileId, recipeId }) — MirrorSetup as a dialog over the patchbay
 *   05 agent      openAgentEditor(agent or kept draft) — the editor as a dialog; a lost draft: MirrorSetup again
 *   06 first run  runAgentNow(agent) (it asks for placeholders first; a toast) · the run's review on #/agents/<id>
 * The steps that leave the route (02, 03, 06's review) set the way back (return.ts) first: the topbar's chip leads back.
 * Orders B10 — the work orders' band (setup/orders.ts): 01 / 02 openCodingSettings() (Settings › Coding worker) · 03
 * #/coding · 04 ensureOrderDb() as the person in the Patchbay (then its page) · 05 the server's test or Settings ·
 * 06 the work orders' page (a chain starts by hand there — ↵ on its plate, never from here).
 * The dialogs give focus back to the lamp's key (`from`); after a create or a save it moves on to the next lamp's key —
 * for 00 / 01 once the dialog closed with its lamp green (moveOnAfterModal).
 */
import { navigate } from '../../../lib/router'
import { ensureOrderDb, openCodingSettings } from '../../coding'
import { useUI } from '../../../store/ui'
import { openAISettings, openAISetup } from '../../ai/setup/openAISetup'
import { openMcpConnections } from '../../mcp'
import { openAgentEditor, openIntegrations, openMirrorSetup, runAgentNow, type AgentDialogOutcome } from '../../agents'
import { useWorkspace } from '../../../store/store'
import type { LampId, SetupLamp } from '../types'
import { setReturn } from './return'
import { focusLampKey, lampKey } from './focus'
import { lampsNow } from './facts'
import { setOf } from './lamps'
import { ORDERS_BAND } from './orders'

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
    if (next) void focusLampKey(next, { from: ctx.from, profile: ctx.profileId })
  }
}

/**
 * Lamps 00 / 01 open a dialog with no "after" of its own (the assistant, Settings): once it closes — the dialog gave the
 * keyboard back to the lamp's key — a lamp the dialog turned green moves it on to the next lamp's key (fix mid), as the
 * agent dialogs do (moveOn). A lamp that was green already (its quiet "Open") keeps it.
 */
function moveOnAfterModal(lamp: SetupLamp, ctx: LampContext): void {
  if (lamp.state === 'ok' || !useUI.getState().modal) return
  const from = ctx.from ?? lampKey(lamp.n, lamp.recipe, ctx.profileId)
  const stop = useUI.subscribe((s) => {
    if (s.modal) return
    stop()
    // two frames: the dialog's own clean-up gives focus back first
    requestAnimationFrame(() =>
      requestAnimationFrame(() => {
        const now = lampsNow(ctx.profileId)
        const set = now ? setOf(now.sets, ctx.recipeId) : null
        if (set?.lamps.find((l) => l.n === lamp.n)?.state !== 'ok' || !set.next) return
        void focusLampKey(set.next, { from, profile: ctx.profileId })
      }),
    )
  })
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
      moveOnAfterModal(lamp, ctx)
      return true
    case 'mcpSettings':
      // quiet: Settings opened from a lamp never checks the never-checked servers on its own (a check is a Claude
      // request — only the person's press runs one, §1.11)
      openAISettings({ section: 'mcp', ...(a.server ? { server: a.server } : {}), ...(a.add ? { add: true } : {}), quiet: true })
      if (ctx.profileId !== ORDERS_BAND) moveOnAfterModal(lamp, ctx)
      return true
    case 'mcpTest':
      // the work orders' band has no profile to come back to (the way back is the Patchbay itself)
      if (ctx.profileId !== ORDERS_BAND) leave(ctx, lamp)
      openMcpConnections({ server: a.server, focus: 'test' })
      return true
    case 'integrations':
      leave(ctx, lamp)
      openIntegrations(a.profile)
      return true
    case 'mirrorSetup':
      openMirrorSetup({ profileId: a.profile, ...(a.recipe ? { recipeId: a.recipe } : {}), ...(a.name ? { name: a.name } : {}), from: ctx.from ?? null, after: moveOn(ctx) })
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
    case 'codingSettings':
      openCodingSettings()
      return true
    case 'coding':
      navigate({ name: 'coding' })
      return true
    case 'ordersDb': {
      const made = ensureOrderDb({ kind: 'you', via: 'patchbay' })
      navigate({ name: 'page', id: made.id })
      return true
    }
    case 'page':
      navigate({ name: 'page', id: a.id })
      return true
  }
}

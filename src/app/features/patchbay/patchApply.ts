/**
 * Patching in the app (B15): patch.ts plans on the workspace as it is now and commits through the four writers —
 * `upsertAgent` and `upsertIntegration` (the store), `saveAutomations` (features/automations) and `saveDbCommands`
 * (features/commands) — under the person's writer frame (§2.9): a patch as `you~patchbay`, its Undo as `you~undo`.
 * Browser only (the store and the areas' index files); the page's patching UI (B16) calls these three:
 *  - planPatch(patch, { input?, model? }) → PatchPlan (the input / model the page holds save a rebuild)
 *  - commitPatch(plan) → { ok } | { ok: false, refused } — the targets read again first (one changed since the plan —
 *    an edit while its asks were open — refuses "changed since": plan again); every boolean a writer returns is read
 *  - undoPatch(plan) → the same: the targets read again first ("changed since — open the editor", a locked database)
 */
import { useWorkspace } from '../../store/store'
import { signoffAdmins } from '../../store/fuseSignoffs'
import { newId } from '../../lib/ids'
import { saveAutomations } from '../automations'
import { hasDefaultCommand, saveDbCommands } from '../commands'
import { APP_READERS, readSource } from './inputs'
import { commitPlan, commitWrites, plan, undoPlan, type PatchSink } from './patch'
import type { Model, ModelInput, MsgRef, Patch, PatchPlan, PatchWrite } from './types'

const sink: PatchSink = {
  upsertAgent: (agent) => useWorkspace.getState().upsertAgent(agent),
  agent: (id) => useWorkspace.getState().agents?.[id],
  saveAutomations,
  saveDbCommands,
  upsertIntegration: (profile, replaces) => useWorkspace.getState().upsertIntegration(profile, replaces),
}

/** Plan a patch on the workspace as it is now. */
export function planPatch(patch: Patch, held: { input?: ModelInput; model?: Model } = {}): PatchPlan {
  return plan(patch, { src: readSource(), read: APP_READERS, ...held, newId, hasDefaultCommand, admins: signoffAdmins() })
}

type Committed = { writes: PatchWrite[]; inverse: PatchWrite[] }

/** Write a plan as the person in the Patchbay (`you~patchbay`) — refused when a target changed since the plan. */
export function commitPatch(p: Committed): { ok: true } | { ok: false; refused: MsgRef } {
  return commitPlan(p, { src: readSource(), read: APP_READERS }, { kind: 'you', via: 'patchbay' }, sink)
}

/** Undo a committed plan (`you~undo`) — refused when a target changed since (config fields) or the lock forbids it. */
export function undoPatch(p: Committed): { ok: true } | { ok: false; refused: MsgRef } {
  const u = undoPlan(p, { src: readSource(), read: APP_READERS })
  if ('refused' in u) return { ok: false, refused: u.refused }
  return commitWrites(u.writes, { kind: 'you', via: 'undo' }, sink, p.writes)
}

/**
 * The profile drop (plan §1.12, §6 U3 / U4 / U25) — browser only (the store, the agents area's validator).
 *
 * Ways in: a `.integration.json` dropped on the rack, the head's chip (a file, or Paste — a CodeArea dialog), and
 * "Set up in the Patchbay" for a profile that is there already (openPatchbay({ setup, band: true }) — it only reads).
 *
 *  - read: a `.json` file (any other type: "Only .integration.json"), ≤ DROP_MAX_BYTES before it is read at all;
 *  - check: `validateProfileText` (its own size limit, its line / column per problem) — the first problems go to the
 *    error plate under the head; a profile with an id that is there already asks first ("Replaces “Tracker”");
 *  - save: `upsertIntegration` as the person in the Patchbay (`you~patchbay`) — its boolean is read: a team member who
 *    is no owner / admin (the owners and admins named) and the 51st profile are refused with their reason;
 *  - the band (record.ts): the visit shows the profile's band in full, the record names it (`<scope>|setup`);
 *  - Undo (Mod+Z on the route, the band's key, the toast) — only until the first lamp write (§6 U4): until a lamp that
 *    was not green right after the drop turns green (a step of the setup made something). Then the band's key reads
 *    "Close setup": the profile is removed only in Workspace › Integrations. Undo puts the replaced profile back, or
 *    removes the new one (`you~undo`) — refused when the profile changed since (someone edited it). In a team the
 *    toast says it removes the profile for all members.
 */
import { create } from 'zustand'
import { t, currentLang } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { withWriter, type Writer } from '../../../store/writer'
import { INTEGRATION_LIMITS, integrationsAllowed, sameIntegration } from '../../../store/integrations'
import { signoffAdmins } from '../../../store/fuseSignoffs'
import type { IntegrationProfile } from '../../../store/types'
import { useCloud } from '../../../cloud'
import { validateProfileText } from '../../agents'
import type { LampSet } from './lamps'
import { lampsNow } from './facts'
import { endSetupVisit, markSetupVisit, patchSetupRecord, setupRecord, writeSetupRecord } from './record'

const AS_DROP: Writer = { kind: 'you', via: 'patchbay' }
const AS_UNDO: Writer = { kind: 'you', via: 'undo' }

/** A profile file is read only below this size (the validator's own limit is in characters; 4 bytes each at most). */
export const DROP_MAX_BYTES = 800_000
/** Problems the error plate lists (the rest: "+n more"). */
export const DROP_PROBLEMS = 5

export type DropWhy = 'type' | 'size' | 'read' | 'invalid' | 'rights' | 'limit' | 'readOnly' | 'failed'

export interface DropProblem {
  line: number
  col: number
  message: string
}

/** Why a drop was refused — the plate's words come from `why` (+ the problems of an invalid profile). */
export interface DropRefusal {
  ok: false
  why: DropWhy
  file?: string
  problems: DropProblem[]
  /** problems past DROP_PROBLEMS */
  more: number
  /** the owners and admins ('rights') */
  names?: string[]
}

/** A profile that passed the checks, not saved yet. */
export interface DropReady {
  ok: true
  profile: IntegrationProfile
  file?: string
  /** the profile of the same id that is there (the confirm row: "Replaces “Tracker”") */
  replaces: { id: string; name: string } | null
}

export type DropCheck = DropReady | DropRefusal

const refuse = (why: DropWhy, extra: Partial<DropRefusal> = {}): DropRefusal => ({ ok: false, why, problems: [], more: 0, ...extra })

const ws = () => useWorkspace.getState()
const readOnly = () => useCloud.getState().readOnly
const team = () => useCloud.getState().active.kind === 'cloud'

/** May this member drop a profile here (null: yes) — read before a file is even opened. */
export function dropRefusal(): DropRefusal | null {
  if (readOnly()) return refuse('readOnly')
  if (!integrationsAllowed()) return refuse('rights', { names: signoffAdmins().filter(Boolean) })
  return null
}

/** Is this a file name a profile may have (`.json`; the `.integration.json` its export gives)? */
export const isProfileName = (name: string): boolean => /\.json$/i.test(name.trim())

/** Read a dropped / picked file: its type and size first, then its text. */
export async function readDropFile(file: File): Promise<{ ok: true; text: string; file: string } | DropRefusal> {
  const name = file.name || ''
  if (!isProfileName(name)) return refuse('type', { file: name })
  if (file.size > DROP_MAX_BYTES) return refuse('size', { file: name })
  try {
    return { ok: true, text: await file.text(), file: name }
  } catch {
    return refuse('read', { file: name })
  }
}

/** Check a profile's text (a file's or a pasted one): valid → ready (and whether it replaces one); else its problems. */
export function checkDropText(text: string, file?: string): DropCheck {
  const lang = currentLang() as 'en' | 'de'
  const v = validateProfileText(text, t, lang)
  if (!v.profile || v.errors > 0) {
    const errors = v.problems.filter((p) => p.severity === 'error')
    const list = (errors.length ? errors : v.problems).map((p) => ({ line: p.line, col: p.col, message: p.message }))
    return refuse(text.length > 200_000 ? 'size' : 'invalid', { ...(file ? { file } : {}), problems: list.slice(0, DROP_PROBLEMS), more: Math.max(0, list.length - DROP_PROBLEMS) })
  }
  const there = (ws().integrations ?? []).find((p) => p.id === v.profile!.id)
  return { ok: true, profile: v.profile, ...(file ? { file } : {}), replaces: there ? { id: there.id, name: there.name } : null }
}

/* ------------------------------------------------------------------ the drop's Undo */

export interface DropDone {
  profileId: string
  /** the profile the drop replaced (null: it was new) — Undo puts it back */
  before: IntegrationProfile | null
  /** the profile as the store kept it right after the drop ("changed since" compares with it) */
  wrote: IntegrationProfile
  at: number
  file?: string
  /** lamps green (or busy) right after the drop: `<recipe>|<n>` — a lamp not in here turning green ends the Undo */
  baseline: string[]
  /** the Undo is still offered (no lamp step made anything yet) */
  open: boolean
  /** a team workspace: Undo removes the profile for all members */
  team: boolean
}

export const useDrop = create<{ done: DropDone | null }>(() => ({ done: null }))

const lampIds = (sets: readonly LampSet[], states: readonly string[]): string[] => sets.flatMap((s) => s.lamps.filter((l) => states.includes(l.state)).map((l) => `${s.recipe ?? '-'}|${l.n}`))

/**
 * Save a checked profile (the person confirmed a replace): the store's answer is read. Then the band shows it in full
 * (this visit), and the drop's Undo is armed until the first lamp write.
 */
export function commitDrop(ready: DropReady): { ok: true; done: DropDone } | DropRefusal {
  const pre = dropRefusal()
  if (pre) return { ...pre, ...(ready.file ? { file: ready.file } : {}) }
  const cur = ws().integrations ?? []
  const before = cur.find((p) => p.id === ready.profile.id) ?? null
  if (!before && cur.length >= INTEGRATION_LIMITS.profiles) return refuse('limit', { ...(ready.file ? { file: ready.file } : {}) })
  const ok = withWriter(AS_DROP, () => ws().upsertIntegration(ready.profile))
  const wrote = (ws().integrations ?? []).find((p) => p.id === ready.profile.id)
  if (!ok || !wrote) return refuse(integrationsAllowed() ? 'failed' : 'rights', { ...(ready.file ? { file: ready.file } : {}), names: signoffAdmins().filter(Boolean) })
  const recipeId = wrote.recipes?.[0]?.id
  markSetupVisit(wrote.id, { fresh: true, ...(recipeId ? { recipeId } : {}), ...(ready.file ? { file: ready.file } : {}) })
  const sets = lampsNow(wrote.id)?.sets ?? []
  const done: DropDone = {
    profileId: wrote.id,
    before: before ? (JSON.parse(JSON.stringify(before)) as IntegrationProfile) : null,
    wrote,
    at: Date.now(),
    ...(ready.file ? { file: ready.file } : {}),
    baseline: lampIds(sets, ['ok', 'busy']),
    open: true,
    team: team(),
  }
  useDrop.setState({ done })
  return { ok: true, done }
}

/**
 * The band read its lamps again: a lamp that was not green right after the drop is green now — the setup made
 * something, the drop's Undo is over (the band's key reads "Close setup"; the record keeps when).
 */
export function noteLamps(profileId: string, sets: readonly LampSet[]): void {
  // a setup opened by "Set up in the Patchbay" has no drop to take back: nothing to note
  const d = useDrop.getState().done
  if (!d || d.profileId !== profileId || !d.open) return
  const green = lampIds(sets, ['ok'])
  if (green.some((k) => !d.baseline.includes(k))) {
    useDrop.setState({ done: { ...d, open: false } })
    patchSetupRecord(profileId, { firstWriteAt: Date.now() })
  }
}

/** When the drop's Undo is still offered (null: not — no drop, a lamp step made something, the profile is gone). */
export function dropUndoAt(): number | null {
  const d = useDrop.getState().done
  if (!d || !d.open) return null
  if (!(ws().integrations ?? []).some((p) => p.id === d.profileId)) return null
  return d.at
}

export type DropUndo = { ok: true; profileId: string; restored: boolean } | { ok: false; why: 'nothing' | 'started' | 'changed' | 'rights' | 'readOnly' | 'failed'; names?: string[] }

/** Take the drop back (`you~undo`): the replaced profile back, or the new one removed — the band and its record go. */
export function undoDrop(): DropUndo {
  const d = useDrop.getState().done
  if (!d) return { ok: false, why: 'nothing' }
  if (!d.open) return { ok: false, why: 'started' }
  if (readOnly()) return { ok: false, why: 'readOnly' }
  if (!integrationsAllowed()) return { ok: false, why: 'rights', names: signoffAdmins().filter(Boolean) }
  const now = (ws().integrations ?? []).find((p) => p.id === d.profileId)
  if (!now) {
    useDrop.setState({ done: null })
    return { ok: false, why: 'nothing' }
  }
  if (!sameIntegration(now, d.wrote)) return { ok: false, why: 'changed' }
  const ok = withWriter(AS_UNDO, () => (d.before ? ws().upsertIntegration(d.before) : ws().deleteIntegration(d.profileId)))
  if (!ok) return { ok: false, why: integrationsAllowed() ? 'failed' : 'rights' }
  useDrop.setState({ done: null })
  const rec = setupRecord()
  if (rec?.profileId === d.profileId) writeSetupRecord(null)
  endSetupVisit()
  return { ok: true, profileId: d.profileId, restored: !!d.before }
}

/**
 * "Close setup" (the band, after the first lamp write) and × on the strip: the setup is closed on this device — the
 * profile stays (it is removed only in Integrations); "Set up in the Patchbay" opens it again.
 */
export function closeSetup(profileId: string): void {
  patchSetupRecord(profileId, { closed: true })
  const d = useDrop.getState().done
  if (d?.profileId === profileId) useDrop.setState({ done: null })
  endSetupVisit()
}

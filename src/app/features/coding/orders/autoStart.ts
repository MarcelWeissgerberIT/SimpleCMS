/**
 * Work orders — "Ohne Bestätigung starten" / "Start without confirming" (Orders B11, spec §3.5), the app part. Lazy
 * (the settings switch, the press's end and the seam load it).
 *
 * Switching it on (`switchAutoOn(db)`, the work orders' settings — the person's act on this device):
 *  - local workspaces only (a team never offers it; auto.ts reads none there), a readable config;
 *  - a "Budget je Kette" is required ("Erst ein Budget je Kette setzen");
 *  - the sig over the settings now (autoSig.ts);
 *  - the Patchbay is asked for the planner's paths WITH that consent (patchbay plannerFuses): an open fuse refuses the
 *    switch with the path's sentence and two keys — "Im Schaltplan zeigen" (the planner on the rack) and "Weg zulassen"
 *    (`allowAndSwitchOn`: the Patchbay's key 3 on that path, then switched on if nothing else trips);
 *  - the consent is this device's (localStorage, auto.ts giveOrderAuto) — never in `Database.orders`, never synced,
 *    exported or backed up.
 *
 * After a press (`autoAfterPlan(row, run)` — press.ts callPlanner and the answers to the planner's questions, both
 * only for a plan whose draft is the one this run wrote): with the consent on this device, a finished plan is created at
 * once — still `startChain` (the same phases, the same writer `order:<row>:<run>#c<n>`, the same 10 s count before step
 * 01, Z within it) — only when nothing in autoCore.ts `autoFallbacks` holds, the sig still matches the settings (else the
 * consent LAPSES: "Einstellungen geändert seit dem Einschalten — erneut einschalten") and the Patchbay, asked again
 * (the cached compute), names no open fuse on the planner's path. Any of these leaves the plan at "Kette bereit" with
 * its reasons on the draft (`draft.auto`, the plate's "Nicht automatisch gestartet: …"). A refusal of startChain itself
 * is named the same way. Planning still starts only from the person's act (the allow-list); Jev is not asked (v1).
 * A plan made again on the plate (R / O) or from a done step ("Ab hier neu planen") is never started this way: the
 * person is at the plate, and ↵ is theirs.
 */
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { activeWorkspace } from '../../../cloud'
import { t } from '../../../i18n'
import { useUI } from '../../../store/ui'
import { classOfPage } from '../../ai/core'
import { useCoding } from '../state'
import { codingReadOnly } from '../schema'
import { pipelineNeedsRepo } from '../stages'
import { clearOrderLapse, dropOrderAuto, giveOrderAuto, lapseOrderAuto, readOrderAuto, type OrderAuto } from './auto'
import { autoSigNow } from './autoSig'
import { autoFallbacks, provOutside, type AutoInput } from './autoCore'
import { autoFallbackText } from './autoWords'
import { orderConfigUsable, readOrderConfig } from './config'
import { orderCode, orderFields } from './db'
import { kindProjects } from './facts'
import { quoteTitleOf } from './fingerprint'
import { loadOrderRecord, patchOrderRecord } from './records'
import { planHashNow, startChain, undoChain } from './confirm'
import { refusalText } from './text'
import { ORDER_LIMITS, type OrderAutoWhy, type OrderProv } from './types'
import type { PlannerFuse } from '../../patchbay'

const ws = () => useWorkspace.getState()
const local = () => activeWorkspace().kind !== 'cloud'

/* ------------------------------------------------------------------ switching it on and off */

export type SwitchOutcome =
  | { ok: true; consent: OrderAuto }
  | { ok: false; why: 'team' | 'readOnly' | 'config' | 'budget' | 'failed' }
  /** the Patchbay says a path of the planner would trip a fuse with this consent (`consent`: the one asked about) */
  | { ok: false; why: 'fuse'; fuses: PlannerFuse[]; consent: OrderAuto }

/** Switch "Ohne Bestätigung starten" on for a work-orders database on this device (see the head of this file). */
export async function switchAutoOn(db: ID): Promise<SwitchOutcome> {
  if (!local()) return { ok: false, why: 'team' }
  if (codingReadOnly()) return { ok: false, why: 'readOnly' }
  const read = readOrderConfig(ws().databases[db])
  if (!orderConfigUsable(read)) return { ok: false, why: 'config' }
  if (read.config.budgetUsd === undefined) return { ok: false, why: 'budget' }
  const sig = await autoSigNow(db)
  if (!sig) return { ok: false, why: 'config' }
  const consent: OrderAuto = { sig, at: Date.now() }
  const pb = await import('../../patchbay')
  const fuses = await pb.plannerFuses(db, consent)
  if (fuses.length) return { ok: false, why: 'fuse', fuses, consent }
  // the settings may have moved while the Patchbay was asked: the sig once more
  if ((await autoSigNow(db)) !== sig) return { ok: false, why: 'failed' }
  const given = giveOrderAuto(db, sig)
  return given ? { ok: true, consent: given } : { ok: false, why: 'failed' }
}

/**
 * "Weg zulassen" on the fuse the switch named (key 3 of the Patchbay on that path, with the consent asked about), then
 * switched on — when no other fuse trips (else the next one is named).
 */
export async function allowAndSwitchOn(db: ID, consent: OrderAuto, fuseKey: string): Promise<SwitchOutcome | { ok: false; why: 'allow'; refused: string }> {
  if (!local()) return { ok: false, why: 'team' }
  const pb = await import('../../patchbay')
  const r = await pb.allowPlannerFuse(db, consent, fuseKey)
  if (!r.ok) return { ok: false, why: 'allow', refused: r.refused }
  return switchAutoOn(db)
}

/** Switch it off (the person's act in the settings): every chain of that database is confirmed by hand again. */
export function switchAutoOff(db: ID): void {
  if (!dropOrderAuto(db)) clearOrderLapse(db)
}

/* ------------------------------------------------------------------ after a press */

export type AutoOutcome =
  /** no consent here (confirm mode), or not this run's plan any more */
  | { kind: 'none' }
  | { kind: 'fallback'; reasons: OrderAutoWhy[] }
  | { kind: 'started'; steps: ID[]; startAt: number }

const provNow = (id: ID): Pick<OrderProv, 'updatedBy' | 'contentOrigin'> | null => {
  const p = ws().pages[id]
  return p ? { updatedBy: p.updatedBy ?? null, contentOrigin: p.contentOrigin ?? null } : null
}

/** The work order's id as people read it ("PA-12"), else its title. */
const codeOf = (rowId: ID): string => orderCode(rowId) ?? (ws().pages[rowId]?.title.trim() || t('common.untitled'))

/**
 * A finished plan of this device's press: created at once when this device holds the consent and nothing is unclear —
 * else left at "Kette bereit" with its reasons (see the head of this file). Never throws.
 */
export async function autoAfterPlan(rowId: ID, run: string): Promise<AutoOutcome> {
  try {
    return await afterPlan(rowId, run)
  } catch {
    return { kind: 'none' }
  }
}

async function afterPlan(rowId: ID, run: string): Promise<AutoOutcome> {
  if (!local()) return { kind: 'none' }
  const row = ws().pages[rowId]
  const db = row?.databaseId ?? null
  if (!row || !db) return { kind: 'none' }
  const consent = readOrderAuto(db)
  if (!consent) return { kind: 'none' }
  const rec = await loadOrderRecord(rowId, { fresh: true })
  const draft = rec && rec !== 'unreadable' && rec.state === 'draft' ? rec.draft : undefined
  // only the plan this run wrote, made from a press (never one edited, nor one planned again from a done step)
  if (!draft || draft.run !== run || !draft.plan.steps.length || draft.from || draft.edited) return { kind: 'none' }
  const read = readOrderConfig(ws().databases[db])
  if (!orderConfigUsable(read)) return { kind: 'none' }
  const config = read.config

  const reasons: OrderAutoWhy[] = []
  // the consent covers the settings as they were when it was given: another sig now — it lapses
  const sig = await autoSigNow(db)
  if (sig !== consent.sig) {
    lapseOrderAuto(db, consent.sig)
    reasons.push({ why: 'lapsed' })
  }
  const s = ws()
  const projects = kindProjects(rowId)
  const ids = [...new Set([rowId, ...Object.keys(draft.source.prov), ...Object.keys(draft.source.fps ?? {}), ...draft.plan.steps.flatMap((st) => st.refs)])]
  const world = { pages: s.pages, databases: s.databases, mailDb: s.settings.mail?.databaseId ?? null }
  const inputs: AutoInput[] = ids.filter((id) => !!s.pages[id]).map((id) => ({ id, mail: classOfPage(id, world).has('mail'), outside: provOutside(draft.source.prov[id] ?? provNow(id)) }))
  reasons.push(
    ...autoFallbacks({
      plan: draft.plan,
      notes: draft.notes ?? [],
      kinds: config.kinds,
      rowRepo: orderFields(rowId).repo,
      repos: (useCoding.getState().worker?.repos ?? []).map((r) => r.name),
      needsRepo: draft.plan.steps.map((st) => {
        const p = projects.find((k) => k.kind === st.kind)
        return !p || pipelineNeedsRepo(p.pipeline)
      }),
      inputs,
      pressFps: draft.pressFps ?? null,
      readFps: draft.source.fps ?? {},
      budget: draft.budget === null ? null : (draft.budget ?? config.budgetUsd ?? null),
    }),
  )
  // the Patchbay, asked again with the consent as it is stored (nothing else unclear: its say decides)
  if (!reasons.length) {
    const pb = await import('../../patchbay')
    for (const f of await pb.plannerFuses(db, 'stored')) reasons.push({ why: 'fuse', label: f.label, path: f.say.slice(0, 600) })
  }
  // switched off (or lapsed) meanwhile: by hand as always — said only when something else held it back too
  if (!reasons.length && readOrderAuto(db)?.sig !== consent.sig) return { kind: 'none' }
  if (reasons.length) return fallBack(rowId, run, reasons)

  const hash = await planHashNow(rowId, draft)
  if (!hash) return fallBack(rowId, run, [{ why: 'start', text: refusalText({ why: 'changed' }) }])
  const out = await startChain(rowId, hash)
  if (!out.ok) return fallBack(rowId, run, [{ why: 'start', text: refusalText(out).slice(0, 300) }])
  const ui = useUI.getState()
  ui.toast({
    message: t('features.coding.order.auto.toast.started', { id: codeOf(rowId), s: Math.round(ORDER_LIMITS.startDelayMs / 1000) }),
    kind: 'success',
    background: true,
    timeout: ORDER_LIMITS.startDelayMs,
    action: { label: t('common.undo'), undo: true, run: () => void undoChain(rowId) },
  })
  return { kind: 'started', steps: out.steps, startAt: out.startAt }
}

/** The plan stays at "Kette bereit" — its draft names why (only the draft this run wrote). */
async function fallBack(rowId: ID, run: string, reasons: OrderAutoWhy[]): Promise<AutoOutcome> {
  await patchOrderRecord(rowId, (r) => (r && r.state === 'draft' && r.draft?.run === run ? { ...r, draft: { ...r.draft, auto: { at: Date.now(), reasons } } } : r))
  const text = autoFallbackText(reasons, t, { row: rowId, titleOf: quoteTitleOf })
  useUI.getState().toast({ message: t('features.coding.order.auto.toast.fallback', { id: codeOf(rowId) }), ...(text ? { detail: text } : {}), kind: 'info', background: true })
  return { kind: 'fallback', reasons }
}

/**
 * Orders B11 — the Patchbay asked for the planner's paths (spec §3.5 / §4): "Ohne Bestätigung starten" on a work-orders
 * database is a consent of THIS device; with it the planner's writes into the pipelines carry no gate ('byHand' goes)
 * and a path from outside content to a way out may open a fuse. The work orders ask here
 *  - at switch-on, with the consent they would give (`plannerFuses(db, { sig, at })`): the model built as if it were
 *    stored — every open fuse it adds over the rack now refuses the switch (its sentence, "Im Schaltplan zeigen", "Weg
 *    zulassen");
 *  - at every auto create, with the consent stored (`plannerFuses(db, 'stored')`): the rack as it is (the cached
 *    compute, state.ts refreshModel) against the rack without the consent — an open fuse the consent adds (one never
 *    allowed, or an allowance that lapsed) leaves the plan at "Kette bereit".
 * `allowPlannerFuse(db, consent, key)` = key 3 "Weg zulassen" on such a fuse — the Patchbay's own key (keys.ts pressKey,
 * `you~patchbay`, its Undo stack), on the path as it is with that consent: once the consent is stored with the same
 * sig, the path reads allowed. Nothing else is written here; never a team (no consent exists there).
 */
import type { ID } from '../../store/types'
import { activeWorkspace } from '../../cloud'
import { currentLang, t } from '../../i18n'
import { buildModel } from './model'
import { APP_READERS, readSource } from './inputs'
import { toModelInput, type InputSource } from './source'
import { refreshModel, usePatchbay } from './state'
import { pathModules, type FusedModel } from './fuses'
import { fuseSay, text, type PlainCtx } from './plain'
import { moduleKey } from './ref'
import { pressKey } from './keys'
import type { FuseState, Model, ModelInput } from './types'

/** One fuse the consent would open (or opens): its label and its sentence, in the UI's language. */
export interface PlannerFuse {
  key: string
  label: string
  say: string
  /** key 3 "Weg zulassen" is offered here (else: why not, in words) */
  allow: true | string
}

type Consent = { sig: string; at: number }

/** The source with this device's consent for `db` replaced (null: none). */
function withConsent(src: InputSource, db: ID, consent: Consent | null): InputSource {
  const orders = src.device.orders
  const auto = { ...(orders?.auto ?? {}) }
  if (consent) auto[db] = { sig: consent.sig, at: consent.at }
  else delete auto[db]
  return { ...src, device: { ...src.device, orders: { codingOn: orders?.codingOn ?? true, projects: orders?.projects ?? {}, auto } } }
}

const openOf = (m: Model): FuseState[] => (m as unknown as FusedModel).fuses.filter((f) => f.allowed?.state !== 'allowed')

/** The two models: with the consent (the one asked about) and without it. */
function pair(db: ID, consent: Consent | 'stored'): { withIt: { model: Model; input: ModelInput }; without: Model } {
  const src = readSource()
  if (consent === 'stored') {
    const model = refreshModel()
    const input = usePatchbay.getState().input!
    return { withIt: { model, input }, without: buildModel(toModelInput(withConsent(src, db, null), APP_READERS).input) }
  }
  const input = toModelInput(withConsent(src, db, consent), APP_READERS).input
  const now = usePatchbay.getState().model ?? refreshModel()
  return { withIt: { model: buildModel(input), input }, without: now }
}

/** The open fuses the consent adds for this database's planner (see the head of this file). Never in a team: none. */
export function plannerFuses(db: ID, consent: Consent | 'stored'): PlannerFuse[] {
  if (activeWorkspace().kind === 'cloud') return []
  const { withIt, without } = pair(db, consent)
  const before = new Set(openOf(without).map((f) => f.key))
  const planner = moduleKey({ kind: 'planner', db })
  const ctx: PlainCtx = { lang: currentLang(), t }
  return openOf(withIt.model)
    // what the consent opens (a fuse only the consent makes, or one on the planner's own path)
    .filter((f) => !before.has(f.key) || pathModules(f.chain).includes(planner) || f.chain.source === planner)
    .map((f) => {
      const k3 = f.keys.find((k) => k.kind === 'allow')
      const allow: true | string = k3?.offered ? true : k3?.refusal ? t(k3.refusal.key, k3.refusal.vars as Record<string, string | number> | undefined) : t('features.patchbay.key.readOnly')
      return { key: f.key, label: f.label, say: text(fuseSay(f, withIt.model, withIt.input, ctx)), allow }
    })
}

/**
 * Key 3 "Weg zulassen" on a fuse the consent would open (`key` = its path key): the Patchbay's own key on that path as it
 * is with the consent — refused when the path is not one of them, or the key is not offered (rights, a later build).
 */
export function allowPlannerFuse(db: ID, consent: Consent | 'stored', key: string): { ok: true } | { ok: false; refused: string } {
  if (activeWorkspace().kind === 'cloud') return { ok: false, refused: t('features.patchbay.key.readOnly') }
  const { withIt } = pair(db, consent)
  const f = openOf(withIt.model).find((x) => x.key === key)
  const k3 = f?.keys.find((k) => k.kind === 'allow')
  if (!f || !k3) return { ok: false, refused: t('features.patchbay.key.changedSince') }
  const r = pressKey(f, k3)
  return r.ok ? { ok: true } : { ok: false, refused: t(r.refused.key, r.refused.vars as Record<string, string | number> | undefined) }
}

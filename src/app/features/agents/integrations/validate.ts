/**
 * Live validation of a profile's JSON text (the Integrations editor, import): a parse error with its line and column,
 * schema problems with their JSON path and line (store/integrations.ts checkIntegration), and each recipe built as it
 * would be (recipe.ts buildMirror: property / option references, operators, values). Messages in the UI language.
 */
import type { Translate } from '@/shared/i18n'
import { INTEGRATION_LIMITS, checkIntegration, checkRecipeConfig, show, variants, type IntegrationIssue } from '../../../store/integrations'
import type { IntegrationFeature, IntegrationProfile } from '../../../store/types'
import { parseJson, pathText, spanAt, type JsonPath } from './json'
import { MIRROR_NEEDS, NEAR_HINTS, buildMirror, resolveRecipe } from './recipe'

/** Characters a profile may have. */
export const MAX_PROFILE_CHARS = 200_000

export interface Problem {
  severity: 'error' | 'warning'
  message: string
  /** '$.recipes[0].database' ('' for a parse error) */
  path: string
  line: number
  col: number
  /** the end of the marked range on that line (exclusive column), when known */
  endCol?: number
}

export interface Validation {
  profile: IntegrationProfile | null
  problems: Problem[]
  errors: number
  warnings: number
  /** where the profile's "id" value is (the editor's own problems about the id point there) */
  idAt?: { line: number; col: number; endCol?: number }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** The message of an issue (`features.integrations.err.<code>`; a `why` is its own text, `features.integrations.why.<why>`). */
function messageOf(t: Translate, issue: IntegrationIssue): string {
  const vars = { ...(issue.vars ?? {}) }
  if ((issue.code === 'needs' || issue.code === 'sendsNeeds') && typeof vars.features === 'string') vars.features = vars.features.split(',').map((f) => t(`features.integrations.feature.${f}`)).join(', ')
  if (typeof vars.why === 'string') vars.why = t(`features.integrations.why.${vars.why}`)
  return t(`features.integrations.err.${issue.code}`, vars)
}

const fold = (s: string) => s.trim().toLowerCase()

/**
 * A send route's row patch names properties by role or name: one no recipe of the profile has is said (a warning — the
 * Outbox checks it again against the database it writes).
 */
function checkAfterRefs(profile: IntegrationProfile, add: (issue: IntegrationIssue) => void, lang: 'en' | 'de'): void {
  if (!profile.recipes?.length || !profile.sends?.length) return
  const known = new Set<string>()
  for (const r of profile.recipes) {
    for (const p of resolveRecipe(profile, r, lang).properties) {
      if (p.role) known.add(fold(p.role))
      for (const n of p.names) known.add(fold(n))
    }
  }
  profile.sends.forEach((route, i) =>
    route.after?.forEach((a, j) => {
      if (!known.has(fold(a.property))) add({ path: ['sends', i, 'after', j, 'property'], code: 'afterUnknown', vars: { value: a.property }, severity: 'warning' })
    }),
  )
}

/**
 * A profile's Preflight lamps against the recipe as it will be built (either language): the view they count must be
 * one of its views, every role one of its properties' roles (a checkbox role takes true / false, a select / status one an
 * option name — one of its declared options when it declares any), and "read" a role the recipe has (myStatus: one of
 * its options). Errors: such a lamp could never be counted.
 */
function checkLampRefs(profile: IntegrationProfile, add: (issue: IntegrationIssue) => void): void {
  profile.lamps?.forEach((lamp, i) => {
    const recipe = profile.recipes?.find((r) => r.id === (lamp.recipe ?? profile.recipes?.[0]?.id)) ?? { kind: 'mirror' as const }
    const both = (['en', 'de'] as const).map((l) => resolveRecipe(profile, recipe, l))
    const props = both.flatMap((r) => r.properties)
    const byRole = (role: string) => props.filter((p) => p.role === role)
    const optionNames = (role: string) => byRole(role).flatMap((p) => (p.options ?? []).flatMap((o) => (o.names.length ? o.names : [o.name]))).map(fold)
    if (lamp.view) {
      const views = new Set(both.flatMap((r) => r.views.flatMap((v) => variants(v.name))).map(fold))
      if (!variants(lamp.view).some((n) => views.has(fold(n)))) add({ path: ['lamps', i, 'view'], code: 'lampView', vars: { value: variants(lamp.view)[0] ?? '' } })
    }
    lamp.where?.forEach((w, j) => {
      const found = byRole(w.role)
      if (!found.length) return add({ path: ['lamps', i, 'where', j, 'role'], code: 'lampRole', vars: { value: w.role } })
      const type = found[0]!.type
      if (type === 'checkbox' ? typeof w.equals !== 'boolean' : type !== 'select' && type !== 'status' ? true : typeof w.equals !== 'string') {
        return add({ path: ['lamps', i, 'where', j, 'equals'], code: 'lampRoleType', vars: { value: w.role, type } })
      }
      const opts = optionNames(w.role)
      if (typeof w.equals === 'string' && opts.length && !opts.includes(fold(w.equals))) add({ path: ['lamps', i, 'where', j, 'equals'], code: 'lampOption', vars: { value: w.equals, property: w.role } })
    })
    if (lamp.read) {
      if (!byRole(lamp.read.role).length) add({ path: ['lamps', i, 'read', 'role'], code: 'lampRole', vars: { value: lamp.read.role } })
      else if (lamp.read.role === 'myStatus' && !optionNames('myStatus').includes(fold(lamp.read.value))) add({ path: ['lamps', i, 'read', 'value'], code: 'lampOption', vars: { value: lamp.read.value, property: 'myStatus' } })
    }
  })
}

export function validateProfileText(text: string, t: Translate, lang: 'en' | 'de'): Validation {
  const problems: Problem[] = []
  let idAt: Validation['idAt']
  const done = (profile: IntegrationProfile | null): Validation => {
    problems.sort((a, b) => a.line - b.line || a.col - b.col || (a.severity === b.severity ? 0 : a.severity === 'error' ? -1 : 1))
    const errors = problems.filter((p) => p.severity === 'error').length
    return { profile: errors ? null : profile, problems, errors, warnings: problems.length - errors, ...(idAt ? { idAt } : {}) }
  }
  if (text.length > MAX_PROFILE_CHARS) {
    problems.push({ severity: 'error', message: t('features.integrations.err.tooBig', { max: MAX_PROFILE_CHARS.toLocaleString(lang) }), path: '', line: 1, col: 1 })
    return done(null)
  }
  const parsed = parseJson(text)
  if (parsed.error) {
    const e = parsed.error
    // shown as typed; only control characters are written as escapes
    const near = [...(e.near ?? '')].map((c) => (c < ' ' ? JSON.stringify(c).slice(1, -1) : c)).join('')
    problems.push({ severity: 'error', message: t(`features.integrations.json.${e.code}`, { near }), path: '', line: e.pos.line, col: e.pos.col, endCol: e.pos.col + Math.max(1, (e.near ?? '').length) })
    return done(null)
  }
  const id = spanAt(parsed.spans, ['id'])
  if (id?.exact) idAt = { line: id.span.start.line, col: id.span.start.col, ...(id.span.end.line === id.span.start.line ? { endCol: id.span.end.col } : {}) }
  const add = (issue: IntegrationIssue) => {
    const path = issue.path as JsonPath
    const found = spanAt(parsed.spans, path)
    const pos = found ? (issue.at === 'key' && found.exact && found.span.key ? found.span.key : found.exact ? found.span.start : (found.span.key ?? found.span.start)) : { line: 1, col: 1, offset: 0 }
    const end = found && found.exact && found.span.end.line === pos.line ? found.span.end.col : undefined
    problems.push({ severity: issue.severity ?? 'error', message: messageOf(t, issue), path: pathText(path), line: pos.line, col: pos.col, ...(end && end > pos.col ? { endCol: end } : {}) })
  }
  // the checks never throw on purpose — should one still do (a value of a kind nobody expected), the editor shows
  // a problem instead of falling over: the text is the person's, the panel must stay usable
  const guarded = <T>(path: JsonPath, fn: () => T): T | null => {
    try {
      return fn()
    } catch (e) {
      add({ path, code: 'internal', vars: { msg: show(e instanceof Error ? e.message : e) } })
      return null
    }
  }
  const profile = guarded([], () => checkIntegration(parsed.value, add))
  // every recipe as it would be built (by its index in the text); "did you mean" hints share one budget
  const raw = isObj(parsed.value) ? parsed.value.recipes : undefined
  if (Array.isArray(raw)) {
    const hints = { left: NEAR_HINTS }
    raw.slice(0, INTEGRATION_LIMITS.recipes).forEach((r, i) => {
      guarded(['recipes', i], () => {
        const cfg = checkRecipeConfig(r)
        if (!cfg) return
        const resolved = resolveRecipe({ id: profile?.id ?? 'x', name: profile?.name ?? '' }, cfg, lang)
        buildMirror(resolved, add, ['recipes', i], hints)
      })
    })
    // a mirror needs keys, upsert, the state and notes: a profile that offers one should unlock them
    if (profile && raw.length) {
      const missing = MIRROR_NEEDS.filter((f: IntegrationFeature) => !profile.unlocks.includes(f))
      if (missing.length) add({ path: ['unlocks'], code: 'needs', vars: { features: missing.join(',') }, severity: 'warning' })
    }
  }
  if (profile) {
    const p = profile
    guarded(['sends'], () => checkAfterRefs(p, add, lang))
    guarded(['lamps'], () => checkLampRefs(p, add))
  }
  return done(profile)
}

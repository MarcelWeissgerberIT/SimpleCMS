/**
 * Staging a slip — never sending one. The target and the arguments are set by code: `{key}` from the row's key
 * property NOW, the tool / server / other arguments from the profile; only the route's text param takes a draft
 * (as one whole string value). Sources are judged here (provenance.ts), the seal computed (seal.ts), the row's
 * source fields kept as the baseline for CHANGED, the answered inbox notes (default: the row's notes from its mirror
 * agent) remembered for the send. Refusals: noRoute · inactive · noKey · badKey · rowGone · param · tooLong · limit ·
 * storage.
 */
import { customAlphabet } from 'nanoid'
import { useWorkspace } from '../../store/store'
import type { ID, RouteParam, SendRoute } from '../../store/types'
import { ROUTE_KEY } from '../../store/integrations'
import { useCloud } from '../../cloud'
import { useInbox } from '../inbox/state'
import { mirrorSourceOf, recipeOptionNames, recipeRoleNames } from '../agents'
import { t, currentLang } from '../../i18n'
import { localized } from '../../store/integrations'
import { resolveAfter } from './after'
import { argsBytes, argsHashOf, routeSigOf } from './hash'
import { judgeSource, ownOrigin, readRow, type RowRead } from './provenance'
import { resolveRoute } from './routes'
import { sealOf } from './seal'
import { OUTBOX_LIMITS, getSlips, insertSlip, scopeNow, storageOk, withLog } from './store'
import { cleanParams, fillArgs, textParam } from './template'
import { OPEN_STATES, type Slip, type SlipId, type SourceRef, type StageInput, type StageRefusal } from './types'
import { withdrawSlip } from './actions'
import { checkRows } from './watch'

const base62 = customAlphabet('0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz', 10)
export const newSlipId = (): SlipId => `out_${base62()}`


export type StageResult = { slip: Slip } | { refused: StageRefusal; detail?: string }

export interface StageOptions {
  /** sources judged by the Outbox itself (the draft path, the popover's typed values); else the caller's are judged */
  judged?: SourceRef[]
  /** the person's own words (the instruction) — trusted */
  ownText?: string
  /** Claude wrote the draft */
  claude?: { text: string; usd: number }
  /** the row as the draft read it (draft.ts: taken when the request was built) — CHANGED compares against this */
  baseline?: Slip['baseline']
}

/**
 * What the person picked or typed in the draft popover (an option, minutes …) as the slip's sources: typed values,
 * judged here — so a typed-only slip, or a text the person writes themselves, has complete provenance (clean when
 * nothing else marks it). Never for a caller: stageSlip judges the caller's own sources.
 */
export function typedParamSources(params: readonly RouteParam[], values: Record<string, string | number>): SourceRef[] {
  const lang = currentLang()
  return params
    .filter((p) => p.type !== 'text' && values[p.name] !== undefined && values[p.name] !== '')
    .map((p) => ({ kind: 'text' as const, ref: `param:${p.name}`, label: (localized(p.label, lang) || p.name).slice(0, 120), trusted: false, typed: true, addresses: [] }))
}

/** A row's reading as a slip's baseline (CHANGED compares later readings with it). */
export const baselineOf = (read: RowRead, at = Date.now()): NonNullable<Slip['baseline']> => ({ at, from: 'row', fields: read.fields, labels: read.labels, ...(read.latest ? { latest: read.latest.slice(0, 600) } : {}) })

/** The row's notes from its mirror agent that the send answers (archived after it). */
function mirrorNotes(dbId: ID, rowId: ID): string[] {
  const src = mirrorSourceOf(dbId)
  if (!src) return []
  return useInbox
    .getState()
    .data.items.filter((i) => i.kind === 'agent' && i.agentId === src.agentId && i.pageId === rowId && !i.archived)
    .map((i) => i.id)
}

/** "1 h 30 min" / "45 min". */
export const fmtMinutes = (n: number) => (n >= 60 ? `${Math.floor(n / 60)} h${n % 60 ? ` ${n % 60} min` : ''}` : `${n} min`)

/** "Reply to J. Weber" for a reply with an owner; a typed route: its label and the values ("Log work · 1 h 30 min"). */
function titleFor(route: SendRoute, owner: string, params: Record<string, string | number>): string {
  const label = localized(route.label, currentLang()) || route.id
  if (route.role === 'reply' && owner) return t('features.outbox.title.reply', { who: owner }).slice(0, 80)
  const values = (route.params ?? [])
    .filter((p) => p.type !== 'text' && params[p.name] !== undefined)
    .map((p) => (p.type === 'minutes' ? fmtMinutes(Number(params[p.name])) : String(params[p.name])))
  return (values.length ? `${label} · ${values.join(' · ')}` : label).slice(0, 80)
}

export async function stage(input: StageInput, opts: StageOptions = {}): Promise<StageResult> {
  if (!storageOk()) return { refused: 'storage' }
  const s = useWorkspace.getState()
  const row = s.pages[input.rowId]
  if (!row || row.trashed || !row.databaseId) return { refused: 'rowGone' }
  const dbId = row.databaseId
  const db = s.databases[dbId]
  const r = resolveRoute(input.route, dbId)
  if ('refused' in r) return { refused: r.refused }
  const { profile, route, server } = r
  const roles = recipeRoleNames(profile)
  const read = readRow(row.id, roles)
  if (!read?.key) return { refused: 'noKey' }
  if (!ROUTE_KEY.test(read.key)) return { refused: 'badKey', detail: read.key }

  const tp = textParam(route)
  const draft = tp ? input.draft : undefined
  if (tp && draft === undefined && typeof input.params?.[tp.name] !== 'string') return { refused: 'param', detail: tp.name }
  const clean = cleanParams(route, input.params ?? {}, draft)
  if (!clean.ok) return { refused: clean.problem.why, detail: clean.problem.name }
  if (getSlips().filter((x) => OPEN_STATES.includes(x.state)).length >= OUTBOX_LIMITS.open) return { refused: 'limit' }
  const filled = fillArgs(route, { key: read.key, params: clean.params })
  if (!filled.ok) return { refused: 'param', detail: `${filled.why} ${filled.token}`.trim() }
  if (argsBytes(filled.value) > OUTBOX_LIMITS.argsBytes) return { refused: 'tooLong', detail: 'args' }

  const text = tp ? String(clean.params[tp.name] ?? '') : null
  const declared = recipeOptionNames(profile)
  const sources = opts.judged ?? input.sources.map((x) => judgeSource(x, declared))
  const complete = opts.judged ? true : input.sources.length > 0
  const now = Date.now()
  const missing = !!tp && draft === null
  const by = opts.claude ? 'claude' : input.origin.kind === 'manual' ? 'person' : input.origin.kind === 'command' ? 'person' : 'caller'
  const slip: Slip = {
    v: 1,
    id: newSlipId(),
    scope: scopeNow(),
    state: missing ? 'missing' : 'ready',
    createdAt: now,
    updatedAt: now,
    origin: { ...input.origin, ...(input.origin.label ? { label: String(input.origin.label).slice(0, 80) } : {}) },
    createdBy: useCloud.getState().active.kind === 'cloud' ? (useCloud.getState().user?.id ?? null) : null,
    target: { dbId, rowId: row.id, key: read.key, rowTitle: row.title.slice(0, 200), serverId: server.id, serverName: server.name, serverUrl: server.url },
    route: { profileId: profile.id, routeId: route.id, ...(route.role ? { role: route.role } : {}), sig: await routeSigOf(profile.id, route, server), tool: route.tool, label: route.label, snapshot: route },
    params: clean.params,
    args: filled.value,
    argsHash: await argsHashOf(filled.value),
    draft: tp
      ? {
          rev: 1,
          by,
          ...(opts.claude ? { claudeText: opts.claude.text } : {}),
          // seen once shown in full (Payload), never before anything is on screen
          seenRev: null,
        }
      : null,
    title: (input.title ?? titleFor(route, read.owner, clean.params)).slice(0, 80),
    ...(opts.ownText ? { instruction: opts.ownText.slice(0, 2000) } : {}),
    after: resolveAfter(route.after, db, row.id, roles),
    answers: input.answers ?? mirrorNotes(dbId, row.id),
    ...(input.quote ? { quote: { text: String(input.quote.text).slice(0, 600), ...(input.quote.at ? { at: input.quote.at } : {}), ...(input.quote.label ? { label: input.quote.label } : {}) } } : {}),
    baseline: opts.baseline ?? baselineOf(read, now),
    sources,
    seal: sealOf({ text, sources, complete, ownText: opts.ownText, origin: ownOrigin() }),
    ...(input.group ? { group: { id: input.group.id, label: input.group.label, order: input.group.order, include: input.group.include !== false } } : {}),
    log: [],
    usd: opts.claude?.usd ?? 0,
  }
  const logged = withLog(slip, missing ? 'staged.missing' : 'staged', { origin: input.origin.kind })
  const stored = await insertSlip(logged).catch(() => null)
  if (!stored) return { refused: 'storage' }
  if (input.replaces) await withdrawSlip(input.replaces, 'origin')
  // the row may have moved on while Claude drafted: CHANGED against the reading the draft was built from
  if (opts.baseline) await checkRows([row.id]).catch(() => undefined)
  return { slip: getSlips().find((x) => x.id === stored.id) ?? stored }
}

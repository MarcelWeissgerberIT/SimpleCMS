/**
 * Workspace agent — task blocks (features/workitems). The terminal, custom agents and the MCP bridge (on its per-call
 * stage) share these:
 *
 *  - ItemSession (`stage.items`): the handles (`{#copy}`) and the new tasks staged in this conversation / agent run /
 *    MCP call — so a later write can link them, and a link to a task another pending change makes is that change's
 *    need (StagedChange.needs). The terminal's is reset by /new.
 *  - stageItems(markdown, stage, target, prev?) + commitItems(stage, change, staging): every staging tool that takes
 *    Markdown runs the settle gate in strict mode (a SettleRefusal → ToolInputError, nothing staged), stores what it
 *    made (StagedChange.items: ids minted HERE and reused 1:1 at apply, handles, facts, warnings, holds), and tells
 *    Claude the ids. The session learns the ids only after the change is staged; `Blocks:` onto existing tasks becomes
 *    its own 'workItem' change that depends on the text change.
 *  - list_work_items (read) and update_work_item (staged, kind 'workItem': the fields of existing tasks — text never
 *    changes them). Scope: the agent's, the terminal's read limits, never a shared task onto a private one; tasks out
 *    of scope are named by id only.
 *  - applyItemChanges(pageId, changes, …): a page's 'workItem' changes in ONE writeItems (origin 'ai') after a version
 *    was kept — a task whose touched fields changed since staging is skipped. apply.ts runs it under guardTask + onTask.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import { isEffectivelyTrashed } from '../../../store/selectors'
import type { ID, Page } from '../../../store/types'
import { useCloud } from '../../../cloud'
import { t } from '../../../i18n'
import { findItemPos, itemAttrs, itemsOfContent, liveEditorOf, patchItemAttrs, readDue, readReminder, type ItemPatch, type WorkItemAttrs } from '../../../editor'
import { WORK_ITEM_STATUSES, type WorkItemStatus } from '../../../editor/workitem/attrs'
import { claudeSettled } from '../claudeDoc'
import { webImagesOf } from '../../agents/images'
import { snapshotNow } from '../../history/snapshots'
import { MAX_ITEM_UPDATES, SettleRefusal, foldTitle, peopleResolver, personDraftOf, warningText, type SettleContext, type SettleReport, type SettleSource, type SettleWorld, type StagedRef } from '../../workitems/settle'
import { ITEM_ID } from '../../../lib/itemIds'
import { settleWorld } from '../../workitems/world'
import { factLineEn, type FactWorld, type ItemFact, type ItemRefFact } from '../../workitems/facts'
import { holdsOfEdit, holdsOfReport } from '../../workitems/holds'
import { isBlocked, isOverdue, queryItems, type ItemStatusFilter } from '../../workitems/query'
import { getItemIndex } from '../../workitems/live'
import { wouldLoop } from '../../workitems/graph'
import { writeItems, type ItemEdit } from '../../workitems/write'
import type { ItemEntry } from '../../workitems/itemIndex'
import { writerOfChanges, type Writer } from '../../../store/writer'
import { redactPersonValue } from '@/shared/ai/redact'
import { currentShape } from '../core/shape'
import { currentReadLimit, currentToolScope, ToolInputError } from './toolScope'
import { depsOf, type StagedChange, type StagedItemEdit, type StagedItems } from './types'
import type { AgentTool, StageApi } from './tools'

/* ------------------------------------------------------------------ */
/* Session                                                             */
/* ------------------------------------------------------------------ */

/** What one conversation / run / call knows of the tasks it staged: handles, and new ids → their change. */
export interface ItemSession {
  source: SettleSource
  handles: Map<string, string>
  staged: Map<string, StagedRef & { pageId: ID | null }>
}

export const newItemSession = (source: SettleSource): ItemSession => ({ source, handles: new Map(), staged: new Map() })

/** A session to try several writes of one call on (page 3 may use page 1's handle): nothing is kept until registerItems. */
export const scratchSession = (s: ItemSession): ItemSession => ({ source: s.source, handles: new Map(s.handles), staged: new Map(s.staged) })

/* ------------------------------------------------------------------ */
/* Helpers                                                             */
/* ------------------------------------------------------------------ */

const ws = () => useWorkspace.getState()
const q = (s: string) => JSON.stringify(s)
const team = () => useCloud.getState().active.kind === 'cloud'

/** Is a page private (team: the member's own)? Locally never. */
export function pagePrivate(id: ID | null | undefined): boolean {
  if (!id || !team()) return false
  return !!ws().pages[id]?.private
}

const isOpen = (c: StagedChange) => c.status === 'pending' || c.status === 'failed' || c.status === 'applying'

/**
 * The redactor of a tool call for a route that may not receive people's names (core/shape.ts; null: names go as they
 * are). Owners then read "@Person n" — the same numbering as the call's page text — and refusals list no names.
 */
function namesRedactor() {
  const shape = currentShape()
  return shape?.o.people ? shape.r : null
}

/** A task fact as a route without people's names reads it (owners "@Person n"; the fact itself without a redactor). */
function factForRoute(fact: ItemFact, r: ReturnType<typeof namesRedactor>): ItemFact {
  if (!r) return fact
  const anon = (people: ItemFact['people']) => people.map((p) => ({ id: p.id, name: redactPersonValue(p.id, r) }))
  return { ...fact, people: anon(fact.people), ...(fact.before ? { before: { ...fact.before, people: anon(fact.before.people) } } : {}) }
}

/** A pending change that creates the task `itemId` (this conversation / run / call). */
function creatorOf(stage: StageApi, itemId: string): StagedChange | null {
  const ref = stage.items.staged.get(itemId)
  if (!ref?.change) return null
  const c = stage.list().find((x) => x.id === ref.change)
  return c && isOpen(c) ? c : null
}

/**
 * The session's staged tasks whose change is still open — this call's own (an MCP replace: no change; a scratch write:
 * its provisional `__` id) or a pending / failed one. A discarded change's tasks will never exist: never linked.
 */
function openStaged(stage: StageApi): Map<string, StagedRef & { pageId: ID | null }> {
  const byId = new Map(stage.list().map((c) => [c.id, c]))
  const out = new Map<string, StagedRef & { pageId: ID | null }>()
  for (const [id, ref] of stage.items.staged) {
    const c = ref.change ? byId.get(ref.change) : undefined
    if (!ref.change || (c ? isOpen(c) : ref.change.startsWith('__'))) out.set(id, ref)
  }
  return out
}

/**
 * blockedBy edges the open changes add, by task: staged link changes ('workItem' adds) and the links of tasks other
 * changes stage (their facts) — `except`: the change being written again (its text's links are this write's own).
 */
export function pendingEdges(stage: StageApi, except?: string | null): Map<string, string[]> {
  const out = new Map<string, string[]>()
  const add = (from: string, to: readonly string[]) => {
    if (to.length) out.set(from, [...(out.get(from) ?? []), ...to])
  }
  for (const c of stage.list()) {
    if (!isOpen(c) || c.id === except) continue
    if (c.kind === 'workItem' && c.workItem) add(c.workItem.itemId, c.workItem.patch.blockedBy?.add ?? [])
    for (const f of c.items?.facts ?? []) if (f.tag === 'new') add(f.itemId, f.blockedBy.map((r) => r.itemId))
  }
  return out
}

/** The task graph as the open changes would leave it: live (or staged) links − staged removals + staged additions. */
function stagedGraph(stage: StageApi, world: SettleWorld): Parameters<typeof wouldLoop>[0] {
  const adds = pendingEdges(stage)
  const removes = new Map<string, Set<string>>()
  for (const c of stage.list()) {
    if (c.kind !== 'workItem' || !isOpen(c) || !c.workItem?.patch.blockedBy?.remove?.length) continue
    const set = removes.get(c.workItem.itemId) ?? new Set<string>()
    for (const x of c.workItem.patch.blockedBy.remove) set.add(x)
    removes.set(c.workItem.itemId, set)
  }
  return {
    byId: {
      get: (id: string) => {
        const gone = removes.get(id)
        const base = (world.entry(id)?.blockedBy ?? []).filter((x) => !gone?.has(x))
        const more = adds.get(id) ?? []
        return base.length || more.length ? { attrs: { blockedBy: [...base, ...more] } } : undefined
      },
    },
  } as unknown as Parameters<typeof wouldLoop>[0]
}

/** The facts a pending change holds for one of its new tasks. */
const stagedFact = (c: StagedChange | null, itemId: string): ItemFact | undefined => c?.items?.facts.find((f) => f.itemId === itemId && f.tag === 'new')

const attrsOfFact = (f: ItemFact): WorkItemAttrs =>
  itemAttrs({ itemId: f.itemId, status: f.status, due: f.due, reminder: f.reminder, people: f.people.map((p) => p.id), blockedBy: f.blockedBy.map((r) => r.itemId), related: f.related.map((r) => r.itemId), doneAt: f.status === 'done' ? Date.now() : null })

/** What the tool call running now may see of tasks: the agent's scope and the terminal's read limits (one walk per page). */
export function itemScope(world: SettleWorld): (e: { itemId: string; pageId: ID }) => boolean {
  const visible = currentToolScope()
  const limit = currentReadLimit()
  return (e) => {
    if (visible && !visible(e.pageId)) return false
    const lim = limit?.(e.pageId) ?? null
    if (!lim) return true
    if (lim.mode === 'none') return false
    return world.readableItems(e.pageId, lim).has(e.itemId)
  }
}

/** A linked task as Claude may see it (the title only while it is in scope; a staged one is new). */
function refFactOf(stage: StageApi, world: SettleWorld, inScope: (e: { itemId: string; pageId: ID }) => boolean): (itemId: string) => ItemRefFact {
  const handleOf = new Map<string, string>()
  for (const [h, id] of stage.items.handles) if (!handleOf.has(id)) handleOf.set(id, h)
  return (itemId) => {
    const handle = handleOf.get(itemId)
    const c = creatorOf(stage, itemId)
    // made by a pending change — or by this call's own write (an MCP replace: no change of its own)
    if (c || stage.items.staged.get(itemId)?.change === null) return { itemId, title: stagedFact(c, itemId)?.title ?? null, isNew: true, inScope: true, ...(handle ? { handle } : {}) }
    const e = world.entry(itemId)
    return { itemId, title: e?.title ?? null, isNew: false, inScope: !!e && inScope(e) }
  }
}

/* ------------------------------------------------------------------ */
/* Staging text that may hold tasks                                    */
/* ------------------------------------------------------------------ */

export interface ItemTarget {
  /** the page the text lands on: an existing page / row, or the id a staged page / row gets */
  pageId: ID | null
  private: boolean
  /** what the text replaces (edit_page: its blocks, replace_all: the page) */
  known?: JSONContent | null
  /** edit_page of exactly one task: a single quote without an id is that task */
  keepSingle?: boolean
  /** the pending change this text extends or revises (its own new tasks are no cross-change need) */
  change?: string | null
}

/**
 * The earlier text of the change being staged again: `extends` — the new text is the old one with more after it (an
 * append joined onto a pending one, insert_after the same block again): its new tasks keep their ids by position;
 * otherwise the text was REPLACED: a task keeps an earlier id only by its handle or its title (settle `reuse`).
 */
export interface ItemPrev {
  items: StagedItems | undefined
  extends: boolean
}

export interface ItemStaging {
  items: StagedItems | undefined
  /** lines for the tool result (model-facing English) */
  lines: string[]
  /** `Blocks:` onto existing tasks: commitItems stages them */
  blocks: SettleReport['blocks']
  /** other pending changes whose new tasks this text links */
  needs: string[]
  report: SettleReport
  target: ItemTarget
}

/** The privacy a new page / row gets: its parent's (a staged parent: that one's parent's …). */
export function stagedPrivacy(stage: StageApi, parentId: ID | null | undefined): boolean {
  const seen = new Set<string>()
  let id = parentId ?? null
  while (id && !seen.has(id)) {
    seen.add(id)
    const live = ws().pages[stage.resolve(id)]
    if (live) return pagePrivate(live.id)
    const staged = stage.list().find((c) => (c.kind === 'create_page' || c.kind === 'create_row' || c.kind === 'create_database') && c.pageId === id)
    id = staged ? (staged.parentId ?? staged.databaseId ?? null) : null
  }
  return false
}

/** The lines a tool result carries about the tasks a text made, kept, removed — and what was left out. */
function resultLines(report: SettleReport): string[] {
  const out: string[] = []
  if (report.created.length) out.push(`New tasks: ${report.created.map((f) => `${q(f.title)} → ${f.itemId}${f.handle ? ` (#${f.handle})` : ''}`).join('; ')}.`)
  const changed = new Set(report.keptChanged)
  if (report.kept.length) out.push(`Kept tasks: ${report.kept.map((f) => `${q(f.title)} (${f.itemId})${changed.has(f.itemId) ? ' — title or notes changed' : ''}`).join('; ')}.`)
  const removed = report.removed
  if (removed.length === 1) out.push(`This removes 1 task: ${q(removed[0].title)} — keep its quote with {#${removed[0].itemId}} to keep it.`)
  else if (removed.length) out.push(`This removes ${removed.length} tasks: ${removed.map((f) => `${q(f.title)} ({#${f.itemId}})`).join(', ')} — keep their quotes with their ids to keep them.`)
  for (const title of report.fieldsIgnored) out.push(`Fields of ${q(title)} did not change: use update_work_item.`)
  const left = report.warnings.filter((w) => w.code !== 'fields')
  if (left.length) out.push(`Left out: ${left.map(warningText).join(' ')}`)
  return out
}

/**
 * Settle a staging tool's Markdown (strict): what it makes of tasks, the ids it mints (an extended change keeps the
 * ids its earlier text got, by position — `prev`). Throws ToolInputError on a refusal (nothing staged, the session
 * untouched). Nothing is registered in the session here: commitItems does that once the change is staged.
 */
export function stageItems(markdown: string, stage: StageApi, target: ItemTarget, prevText?: ItemPrev): ItemStaging {
  const session = stage.items
  const page = target.pageId ? ws().pages[target.pageId] : undefined
  const prev = prevText?.items
  const reuse = prev && !prevText.extends ? prev.facts.filter((f) => f.tag === 'new').map((f) => ({ itemId: f.itemId, handle: f.handle, title: f.title })) : []
  const edges = pendingEdges(stage, target.change ?? null)
  const ctx: SettleContext = {
    source: session.source,
    creates: true,
    strict: true,
    pageId: target.pageId,
    private: target.private,
    visible: currentToolScope(),
    readLimit: currentReadLimit(),
    known: target.known ?? null,
    keepSingle: !!target.keepSingle,
    handles: prev ? new Map([...session.handles, ...Object.entries(prev.handles)]) : session.handles,
    staged: openStaged(stage),
    change: target.change ?? null,
    ...(prevText?.extends && prev?.ids.length ? { firstIds: prev.ids } : {}),
    ...(reuse.length ? { reuse } : {}),
    ...(edges.size ? { pendingEdges: edges } : {}),
    existing: 'copy',
    me: session.source !== 'agent',
    // a route without people's names: refusals never list them
    ...(namesRedactor() ? { names: false } : {}),
  }
  let report: SettleReport
  try {
    report = claudeSettled(markdown, page ? webImagesOf(page.content) : undefined, ctx).report
  } catch (e) {
    if (e instanceof SettleRefusal) throw new ToolInputError(`${e.message} Nothing was staged.`)
    throw e
  }
  const facts = [...report.created, ...report.kept, ...report.removed]
  const holds = holdsOfReport(report)
  const items: StagedItems | undefined =
    report.ids.length || facts.length || report.warnings.length || holds.length
      ? { ids: report.ids, handles: report.handles, facts, warnings: report.warnings, holds, pins: report.pins, ...(report.needs.length ? { needs: report.needs } : {}) }
      : undefined
  return { items, lines: resultLines(report), blocks: report.blocks, needs: report.needs, report, target }
}

/**
 * needs of a change whose text was settled (again): its own minus what its earlier text needed (`c.items.needs` — the
 * new text's needs replace them), plus the new text's — never itself or what it depends on. `c`: the change as it was
 * BEFORE this write (its earlier items).
 */
export const withNeeds = (c: Pick<StagedChange, 'id' | 'dependsOn' | 'needs' | 'items'> | null, add: readonly string[]): string[] => {
  const earlier = new Set(c?.items?.needs ?? [])
  const out = new Set((c?.needs ?? []).filter((n) => !earlier.has(n)))
  for (const n of add) if (n !== c?.id && n !== c?.dependsOn) out.add(n)
  return [...out]
}

/** A staging's items with its needs as the real change ids (a scratch write's provisional ids mapped). */
export const itemsWithNeeds = (items: StagedItems | undefined, needs: readonly string[]): StagedItems | undefined => (items ? { ...items, ...(needs.length ? { needs: [...needs] } : { needs: undefined }) } : items)

/** A session learns a staged change's new task ids and the handles it declared (`change`: its id, or a provisional one). */
export function registerItems(session: ItemSession, change: string, staging: ItemStaging): void {
  const ids = new Set(staging.report.ids)
  const before = new Set([...session.staged].filter(([, ref]) => ref.change === change).map(([id]) => id))
  for (const id of before) if (!ids.has(id)) session.staged.delete(id)
  for (const id of ids) session.staged.set(id, { change, private: staging.target.private, pageId: staging.target.pageId })
  // a handle of this change's tasks that the new text no longer declares (for that task) is gone
  const declared = staging.report.handles
  for (const [h, id] of [...session.handles]) if ((before.has(id) || ids.has(id)) && declared[h] !== id) session.handles.delete(h)
  for (const [h, id] of Object.entries(declared)) if (ids.has(id)) session.handles.set(h, id)
}

/**
 * registerItems for a change staged (again) — and the lines that tell Claude which OTHER open changes point at a task
 * this text no longer makes (written again without it): their link is left out at apply unless they are staged again.
 */
export function registerChange(stage: StageApi, change: string, staging: ItemStaging): string[] {
  const before = [...stage.items.staged].filter(([, ref]) => ref.change === change).map(([id]) => id)
  registerItems(stage.items, change, staging)
  const kept = new Set(staging.report.ids)
  const gone = new Set(before.filter((id) => !kept.has(id)))
  if (!gone.size) return []
  const lines: string[] = []
  for (const x of stage.list()) {
    if (x.id === change || !isOpen(x)) continue
    const linked = [
      ...(x.items?.pins ?? []).flatMap((p) => [...p.blockedBy, ...p.related].map((r) => r.id)),
      ...(x.workItem ? [x.workItem.itemId, ...(x.workItem.patch.blockedBy?.add ?? []), ...(x.workItem.patch.related?.add ?? [])] : []),
    ].filter((id) => gone.has(id))
    for (const id of new Set(linked)) lines.push(`Change #${x.n} points at ${id}, a task this text no longer makes: stage #${x.n} again (as it is, that link is left out — a task change fails).`)
  }
  return lines
}

/**
 * The change is staged: the session learns its new ids and declared handles; `Blocks:` onto existing tasks become
 * 'workItem' changes that depend on it. Returns the lines that say so.
 */
export function commitItems(stage: StageApi, change: StagedChange, staging: ItemStaging): string[] {
  const orphans = registerChange(stage, change.id, staging)
  return [...orphans, ...stageBlocks(stage, change, staging)]
}

/** `Blocks:` of a staged text change onto existing tasks: one 'workItem' change per task, depending on it. */
export function stageBlocks(stage: StageApi, change: StagedChange, staging: ItemStaging): string[] {
  const lines: string[] = []
  for (const b of staging.blocks) {
    const out = stageItemEdit(stage, b.itemId, { blockedBy: { add: b.add } }, { from: change.id })
    if ('error' in out) {
      lines.push(`Left out: "Blocks" onto ${b.itemId} — ${out.error}`)
      continue
    }
    if (out.noop) continue
    const c = out.change
    const names = b.add.map((id) => stagedFact(change, id)?.title ?? id)
    lines.push(`Also staged #${c.n}: ${q(c.title ?? c.workItem!.itemId)} now waits for ${names.map(q).join(', ')} (Blocks:).`)
  }
  return lines
}

/* ------------------------------------------------------------------ */
/* A task's fields (update_work_item, Blocks:)                         */
/* ------------------------------------------------------------------ */

/** A task a field change may target: live in scope, or staged by a pending change of this conversation. */
interface TaskTarget {
  itemId: string
  title: string
  attrs: WorkItemAttrs
  /** the page now (a staged task: the page its change writes) */
  pageId: ID
  private: boolean
  /** live: in the workspace · else the pending change that creates it */
  creator: StagedChange | null
}

function taskTarget(stage: StageApi, world: SettleWorld, inScope: (e: { itemId: string; pageId: ID }) => boolean, itemId: string): TaskTarget | null {
  const c = creatorOf(stage, itemId)
  if (c) {
    const f = stagedFact(c, itemId)
    if (!f) return null
    return { itemId, title: f.title, attrs: attrsOfFact(f), pageId: c.pageId, private: !!stage.items.staged.get(itemId)?.private, creator: c }
  }
  const e = getItemIndex().byId.get(itemId)
  if (!e || !inScope(e)) return null
  return { itemId, title: e.title, attrs: e.attrs, pageId: e.pageId, private: e.private, creator: null }
}

/** Why a task's page refuses a write now (model-facing), or null. */
function pageGate(pageId: ID): string | null {
  const { pages } = ws()
  const page = pages[pageId]
  if (!page || isEffectivelyTrashed(pages, pageId)) return 'its page is gone or in the trash'
  if (page.settings?.locked) return 'its page is locked in One'
  const cloud = useCloud.getState()
  if (team() && cloud.outdated) return 'this tab is outdated (the person has to reload One)'
  if (team() && cloud.readOnly) return 'the person may only read this workspace'
  return null
}

const TOUCH = { status: ['status'], due: ['due', 'reminder'], reminder: ['due', 'reminder'], people: ['people'], blockedBy: ['blockedBy'], related: ['related'] } as const

/** The attrs keys a patch touches. */
function touched(patch: ItemPatch): Array<keyof WorkItemAttrs> {
  const out = new Set<keyof WorkItemAttrs>()
  for (const k of Object.keys(TOUCH) as Array<keyof typeof TOUCH>) if (patch[k] !== undefined) for (const key of TOUCH[k]) out.add(key)
  return [...out]
}

/** JSON of the touched fields (the fingerprint apply compares). */
const fieldsJson = (a: WorkItemAttrs, keys: readonly (keyof WorkItemAttrs)[]): string => JSON.stringify(Object.fromEntries([...keys].sort().map((k) => [k, a[k] ?? null])))

const mergeList = (a?: { add?: string[]; remove?: string[] }, b?: { add?: string[]; remove?: string[] }) => {
  if (!a) return b
  if (!b) return a
  const add = [...(a.add ?? []).filter((x) => !(b.remove ?? []).includes(x)), ...(b.add ?? [])]
  const remove = [...(a.remove ?? []).filter((x) => !(b.add ?? []).includes(x)), ...(b.remove ?? [])]
  return { ...(add.length ? { add: [...new Set(add)] } : {}), ...(remove.length ? { remove: [...new Set(remove)] } : {}) }
}

/** Two patches of the same task: later values win, list edits merge. */
export function mergePatch(a: ItemPatch, b: ItemPatch): ItemPatch {
  const out: ItemPatch = { ...a, ...b }
  for (const k of ['people', 'blockedBy', 'related'] as const) {
    const m = mergeList(a[k], b[k])
    if (m) out[k] = m
    else delete out[k]
  }
  if (b.due !== undefined && b.reminder === undefined && a.reminder !== undefined && b.due !== null) out.reminder = a.reminder
  return out
}

/** A fact of a task's fields (tag 'changed'). */
function factOf(itemId: string, title: string, a: WorkItemAttrs, fw: FactWorld, before?: WorkItemAttrs): ItemFact {
  const fields = (x: WorkItemAttrs) => ({
    status: x.status,
    due: x.due,
    reminder: x.reminder,
    people: x.people.map((id) => ({ id, name: fw.person(id) ?? id })),
    blockedBy: x.blockedBy.map((id) => fw.ref(id)),
    related: x.related.map((id) => fw.ref(id)),
  })
  return { itemId, handle: null, tag: 'changed', title, ...fields(a), ...(before ? { before: fields(before) } : {}) }
}

type EditOut = { change: StagedChange; noop?: false; created: boolean } | { noop: true; target: TaskTarget } | { error: string }

/**
 * Stage a field change of one task (or fold it into the pending 'workItem' change of the same task). The patch holds
 * resolved ids. `from`: the text change whose `Blocks:` made it (it depends on it); `needs`: other changes whose new
 * tasks the patch links.
 */
export function stageItemEdit(stage: StageApi, itemId: string, patch: ItemPatch, opts: { from?: string; needs?: readonly string[]; world?: SettleWorld } = {}): EditOut {
  const world = opts.world ?? settleWorld()
  const inScope = itemScope(world)
  const target = taskTarget(stage, world, inScope, itemId)
  if (!target) return { error: `no task ${itemId} here` }
  if (!target.creator) {
    const gate = pageGate(target.pageId)
    if (gate) return { error: gate }
  }
  // a new blocker that closes a loop through live links and every open change's (staged tasks, staged link changes)
  const graph = stagedGraph(stage, world)
  const loop = (patch.blockedBy?.add ?? []).find((to) => wouldLoop(graph, itemId, to))
  if (loop) return { error: `waiting for ${loop} would close a loop (${loop} already waits for it, also through staged changes)` }
  const pending = stage.list().find((c) => c.kind === 'workItem' && c.status === 'pending' && c.workItem?.itemId === itemId)
  const merged = pending?.workItem ? mergePatch(pending.workItem.patch, patch) : patch
  const delta = patchItemAttrs(target.attrs as unknown as Record<string, unknown>, merged, Date.now())
  const after = itemAttrs({ ...target.attrs, ...(delta ?? {}) })
  const keys = touched(merged)
  const fw: FactWorld = { person: peopleResolver(world, true).name, ref: refFactOf(stage, world, inScope) }
  if (!delta || keys.every((k) => JSON.stringify(after[k]) === JSON.stringify(target.attrs[k]))) {
    if (!pending) return { noop: true, target }
  }
  // the fingerprint: the touched fields as they were when first staged (a field added later: as it is now)
  let before: string | null = null
  if (!target.creator) {
    const prev = pending?.workItem?.before ? (JSON.parse(pending.workItem.before) as Record<string, unknown>) : {}
    const now = JSON.parse(fieldsJson(target.attrs, keys)) as Record<string, unknown>
    before = JSON.stringify(Object.fromEntries(keys.slice().sort().map((k) => [k, k in prev ? prev[k] : now[k]])))
  }
  const holds = holdsOfEdit(merged, target.creator ? null : target.attrs)
  const edit: StagedItemEdit = { itemId, patch: merged, before, facts: factOf(itemId, target.title, after, fw, target.attrs), holds, ...(opts.from ?? pending?.workItem?.from ? { from: opts.from ?? pending!.workItem!.from } : {}) }
  const dependsOn = pending?.dependsOn ?? opts.from ?? target.creator?.id
  const needs = withNeeds({ id: pending?.id ?? '', dependsOn, needs: pending?.needs }, [...(opts.needs ?? []), ...(target.creator && target.creator.id !== dependsOn ? [target.creator.id] : []), ...(opts.from && opts.from !== dependsOn ? [opts.from] : [])])
  const fields = { workItem: edit, title: target.title, ...(dependsOn ? { dependsOn } : {}), ...(needs.length ? { needs } : {}) }
  if (pending) return { change: stage.update(pending.id, fields), created: false }
  return { change: stage.add({ kind: 'workItem', pageId: target.pageId, ...fields }), created: true }
}

/* ------------------------------------------------------------------ */
/* Input helpers                                                       */
/* ------------------------------------------------------------------ */

const STATUS_WORDS: Record<string, WorkItemStatus> = { todo: 'todo', open: 'todo', 'to do': 'todo', 'in progress': 'in_progress', in_progress: 'in_progress', doing: 'in_progress', done: 'done', closed: 'done' }
const HANDLE = /^#?([A-Za-z][A-Za-z0-9_-]{0,23})$/

function strIn(o: Record<string, unknown>, key: string, where: string, max = 300): string | undefined {
  const v = o[key]
  if (v === undefined) return undefined
  if (typeof v !== 'string') throw new ToolInputError(`${where}: "${key}" must be a string.`)
  if (v.length > max) throw new ToolInputError(`${where}: "${key}" is too long (at most ${max} characters).`)
  return v.trim()
}

function listIn(o: Record<string, unknown>, key: string, where: string): { add: string[]; remove: string[] } | undefined {
  const v = o[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'object' || Array.isArray(v)) throw new ToolInputError(`${where}: "${key}" must be an object {"add": [...], "remove": [...]}.`)
  const r = v as Record<string, unknown>
  const arr = (k: string) => {
    const x = r[k]
    if (x === undefined || x === null) return []
    if (!Array.isArray(x) || x.some((s) => typeof s !== 'string' || !s.trim() || s.length > 300)) throw new ToolInputError(`${where}: "${key}.${k}" must be a list of strings.`)
    return (x as string[]).map((s) => s.trim())
  }
  return { add: arr('add'), remove: arr('remove') }
}

/** A task Claude names (id, #handle, exact title) → its id; a refusal message. `self`: the task being changed. */
function resolveTaskRef(stage: StageApi, world: SettleWorld, inScope: (e: { itemId: string; pageId: ID }) => boolean, raw: string): { id: string } | { error: string } {
  const s = raw.trim()
  const h = HANDLE.exec(s)
  if (h && (s.startsWith('#') || stage.items.handles.has(h[1].toLowerCase()))) {
    const id = stage.items.handles.get(h[1].toLowerCase())
    return id ? { id } : { error: `No task with the handle #${h[1].toLowerCase()} in this conversation. Use a task id (wi_…) from list_work_items or a tool result.` }
  }
  if (ITEM_ID.test(s)) {
    if (creatorOf(stage, s)) return { id: s }
    const e = world.entry(s)
    return e && inScope(e) ? { id: s } : { error: `No task ${s} here. Use list_work_items to find task ids.` }
  }
  const key = foldTitle(s)
  const hits: string[] = []
  for (const [id] of stage.items.staged) {
    const c = creatorOf(stage, id)
    const f = stagedFact(c, id)
    if (f && foldTitle(f.title) === key) hits.push(id)
  }
  for (const id of world.titles().get(key) ?? []) {
    const e = world.entry(id)
    if (e && inScope(e) && !hits.includes(id)) hits.push(id)
  }
  if (hits.length === 1) return { id: hits[0] }
  if (hits.length > 1)
    return {
      error: `${q(s)} fits more than one task: ${hits
        .slice(0, 8)
        .map((id) => {
          const e = world.entry(id)
          return e ? `${id} ${q(e.title)} on ${q(world.pageTitle(e.pageId))}` : `${id} (staged)`
        })
        .join(', ')}. Use the task id (wi_…).`,
    }
  return { error: `No task ${q(s)} here. Use list_work_items to find task ids, or a #handle from this conversation.` }
}

/* ------------------------------------------------------------------ */
/* list_work_items                                                     */
/* ------------------------------------------------------------------ */

const STATUS_FILTERS: ItemStatusFilter[] = ['open', 'todo', 'in_progress', 'done', 'any']
const STATUS_EN: Record<WorkItemStatus, string> = { todo: 'todo', in_progress: 'in progress', done: 'done' }

/** "on that page and below": does `pageId` sit at or under `root`? Memoised per call. */
function underPage(root: ID): (pageId: ID) => boolean {
  const memo = new Map<ID, boolean>()
  return (pageId) => {
    const hit = memo.get(pageId)
    if (hit !== undefined) return hit
    const { pages } = ws()
    const seen = new Set<ID>()
    let cur: Page | undefined = pages[pageId]
    let ok = false
    while (cur && !seen.has(cur.id)) {
      if (cur.id === root) {
        ok = true
        break
      }
      seen.add(cur.id)
      const up: ID | null = cur.parentId ?? cur.databaseId ?? null
      cur = up ? pages[up] : undefined
    }
    memo.set(pageId, ok)
    return ok
  }
}

/** One line of the list (model-facing): linked tasks outside the caller's scope by id only; `owner` names a person. */
function listLine(e: ItemEntry, world: SettleWorld, inScope: (e: { itemId: string; pageId: ID }) => boolean, owner: (id: string) => string, now: number): string {
  const a = e.attrs
  const index = getItemIndex()
  const parts = [`- ${e.itemId}`, q(e.title), STATUS_EN[a.status]]
  if (a.due) parts.push(`${isOverdue(e, now) ? 'OVERDUE, ' : ''}due ${a.due}${a.reminder ? ` (reminder ${a.reminder})` : ''}`)
  if (a.people.length) parts.push(`owner: ${a.people.map(owner).join(', ')}`)
  if (a.blockedBy.length) {
    const refs = a.blockedBy.map((id) => {
      const b = world.entry(id)
      if (!b || !inScope(b)) return `${id} (outside your scope)`
      return `${id} ${q(b.title)} (${index.byId.get(id)?.attrs.status === 'done' ? 'done' : 'open'})`
    })
    parts.push(`${isBlocked(index, e) ? 'BLOCKED by' : 'blocked by'} ${refs.join(', ')}`)
  }
  if (a.related.length) parts.push(`related ${a.related.length}`)
  const page = ws().pages[e.pageId]
  parts.push(`on ${q(page?.title.trim() || 'Untitled')} (id: ${e.pageId}) #/p/${e.pageId}${e.blockId ? `?b=${e.blockId}` : ''}`)
  return parts.join(' · ')
}

export const listWorkItems: AgentTool = {
  name: 'list_work_items',
  write: false,
  description:
    'Find task blocks across the workspace — the "> [!TODO]" quotes with a status, owners, a due date and what they wait for (not the coding pipeline\'s tasks: those are list_tasks). Filters, all optional: status (open = todo + in progress, the default; todo, in_progress, done, any), person (a name, "me" or "none"), page_id (that page and the pages below it), blocked (waiting for an open task), overdue, due_before ("YYYY-MM-DD"), query (part of the title). Sorted overdue first, then by due date. Returns per task: its id (wi_…), title, status, due date and reminder, owners, what blocks it, its page and a link. Use the ids with update_work_item or in Blocked by / Related lines.',
  input_schema: {
    type: 'object',
    properties: {
      status: { type: 'string', enum: STATUS_FILTERS, description: 'Default "open" (todo and in progress).' },
      person: { type: 'string', description: 'A person\'s name, "me" (the person you work for) or "none" (tasks without an owner).' },
      page_id: { type: 'string', description: 'Only tasks on this page and the pages below it.' },
      blocked: { type: 'boolean', description: 'true: only tasks waiting for an open task · false: only tasks that are not.' },
      overdue: { type: 'boolean', description: 'true: only tasks past their due date.' },
      due_before: { type: 'string', description: 'Only tasks due before this day ("YYYY-MM-DD").' },
      query: { type: 'string', description: 'Part of the task title.' },
      limit: { type: 'integer', description: 'Tasks to return (1–100, default 50).' },
    },
    additionalProperties: false,
  },
  run(input, stage) {
    const world = settleWorld()
    const inScope = itemScope(world)
    const people = peopleResolver(world, stage.items.source !== 'agent')
    // a route without people's names reads owners "@Person n" (the numbering of the call's page text)
    const r = namesRedactor()
    const owner = (id: string) => (r ? redactPersonValue(id, r) : (people.name(id) ?? id))
    const res = listItems(input, stage, world, inScope)
    const lines = res.items.map((e) => listLine(e, world, inScope, owner, res.now))
    return {
      content: `${res.head}${res.loadingNote}${lines.length ? `\n${lines.join('\n')}` : ''}`,
      summary: t(res.total === 1 ? 'features.agent.res.itemsOne' : 'features.agent.res.items', { count: res.total }),
      state: 'ok',
    }
  },
}

/**
 * list_work_items' filters read and run (one_list_work_items too): the matching tasks in the caller's scope, how many
 * matched, the header line. Throws ToolInputError for a filter Claude has to fix.
 */
export function listItems(input: Record<string, unknown>, stage: StageApi, world: SettleWorld, inScope: (e: { itemId: string; pageId: ID }) => boolean) {
  const statusRaw = typeof input.status === 'string' ? input.status.trim().toLowerCase().replace(/\s+/g, '_') : 'open'
  const status = (STATUS_FILTERS as string[]).includes(statusRaw) ? (statusRaw as ItemStatusFilter) : null
  if (!status) throw new ToolInputError(`Unknown status ${q(String(input.status))}. Use one of: ${STATUS_FILTERS.join(', ')}.`)
  const r = namesRedactor()
  const people = peopleResolver(world, stage.items.source !== 'agent', !r)
  let person: { id: string } | 'none' | null = null
  let personLabel = ''
  if (typeof input.person === 'string' && input.person.trim()) {
    const raw = input.person.trim()
    if (/^(none|nobody|niemand)$/i.test(raw)) {
      person = 'none'
      personLabel = 'none'
    } else {
      const hit = people.resolve(personDraftOf(raw, world), '')
      if (!('id' in hit)) throw new ToolInputError(hit.code === 'meAgent' ? '"me" means nobody for an agent — name the person.' : hit.message)
      person = { id: hit.id }
      personLabel = r ? redactPersonValue(hit.id, r) : (people.name(hit.id) ?? hit.id)
    }
  }
  let pages: ReadonlySet<ID> | null = null
  let pageNote = ''
  const pageRaw = typeof input.page_id === 'string' ? input.page_id.trim() : typeof input.pageId === 'string' ? input.pageId.trim() : ''
  if (pageRaw) {
    const id = stage.resolve(pageRaw)
    const p = ws().pages[id]
    const visible = currentToolScope()
    if (!p || p.trashed || isEffectivelyTrashed(ws().pages, id) || (visible && !visible(id))) throw new ToolInputError(`No page with id ${q(pageRaw)}. Use search_pages to find page ids.`)
    const under = underPage(id)
    const set = new Set<ID>()
    for (const e of getItemIndex().byId.values()) if (under(e.pageId)) set.add(e.pageId)
    pages = set
    pageNote = `page: ${q(p.title.trim() || 'Untitled')} and below`
  }
  const bool = (k: string) => (input[k] === true || input[k] === 'true' ? true : input[k] === false || input[k] === 'false' ? false : null)
  let dueBefore: string | null = null
  const dueRaw = typeof input.due_before === 'string' ? input.due_before.trim() : typeof input.dueBefore === 'string' ? input.dueBefore.trim() : ''
  if (dueRaw) {
    dueBefore = readDue(dueRaw)?.slice(0, 10) ?? null
    if (!dueBefore) throw new ToolInputError(`"due_before" must be a date "YYYY-MM-DD" (got ${q(dueRaw)}).`)
  }
  const query = typeof input.query === 'string' ? input.query.slice(0, 200) : ''
  const limitRaw = typeof input.limit === 'number' ? input.limit : typeof input.limit === 'string' ? Number(input.limit) : 50
  const limit = Number.isFinite(limitRaw) ? Math.max(1, Math.min(100, Math.floor(limitRaw))) : 50
  const now = Date.now()
  const index = getItemIndex()
  const res = queryItems(index, { status, person, pages, blocked: bool('blocked'), overdue: bool('overdue'), dueBefore, query, limit, now }, inScope)
  const filters = [personLabel ? `person: ${personLabel}` : '', pageNote, bool('blocked') !== null ? `blocked: ${bool('blocked')}` : '', bool('overdue') !== null ? `overdue: ${bool('overdue')}` : '', dueBefore ? `due before ${dueBefore}` : '', query ? `title contains ${q(query)}` : ''].filter(Boolean)
  const word = status === 'any' ? (res.total === 1 ? 'task' : 'tasks') : `${status === 'in_progress' ? 'in progress' : status} task${res.total === 1 ? '' : 's'}`
  const head = `${res.total} ${word}${filters.length ? ` (${filters.join(', ')})` : ''} — showing ${res.items.length}.`
  const loadingNote = res.loading ? `\n${index.unloaded} page${index.unloaded === 1 ? ' is' : 's are'} still loading — the list may be incomplete.` : ''
  return { ...res, head, loadingNote, now, index }
}

/* ------------------------------------------------------------------ */
/* update_work_item                                                    */
/* ------------------------------------------------------------------ */

/** Updates one update_work_item call may stage (settle.ts: also a write's `Blocks:` targets). */
export { MAX_ITEM_UPDATES }

interface PlannedEdit {
  itemId: string
  patch: ItemPatch
  needs: string[]
}

export const updateWorkItem: AgentTool = {
  name: 'update_work_item',
  write: true,
  description: `Stage changes to the fields of existing task blocks (and of tasks you staged in this conversation): status, due date, reminder, owners, Blocked by and Related links — up to ${MAX_ITEM_UPDATES} tasks in one call. This is the ONLY way to change a task's fields: editing its field line in text changes nothing. "item" is the task's id (wi_…, from list_work_items, read_page or a tool result) or the #handle of a task you staged. Owners are people of this workspace by name ("me" = the person); links are task ids, #handles or exact titles. Every task is checked before anything is staged: one bad entry stages none. Each task becomes one proposed change the person reviews.`,
  input_schema: {
    type: 'object',
    properties: {
      updates: {
        type: 'array',
        description: `The tasks to change (1–${MAX_ITEM_UPDATES}).`,
        items: {
          type: 'object',
          properties: {
            item: { type: 'string', description: 'Task id (wi_…) or #handle.' },
            status: { type: 'string', enum: ['todo', 'in progress', 'done'] },
            due: { type: ['string', 'null'], description: '"YYYY-MM-DD" or "YYYY-MM-DDTHH:mm"; null clears the due date and its reminder.' },
            reminder: { type: ['string', 'null'], description: '"at", "-15m", "-1h", "-1d", "-1w" (needs a due date) — only when the person asks for one; null removes it.' },
            people: { type: 'object', description: 'Owners: {"add": [names], "remove": [names]}.', properties: { add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
            blocked_by: { type: 'object', description: 'Tasks this one waits for: {"add": [...], "remove": [...]}.', properties: { add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
            related: { type: 'object', description: 'Related tasks: {"add": [...], "remove": [...]}.', properties: { add: { type: 'array', items: { type: 'string' } }, remove: { type: 'array', items: { type: 'string' } } }, additionalProperties: false },
          },
          required: ['item'],
          additionalProperties: false,
        },
      },
    },
    required: ['updates'],
    additionalProperties: false,
  },
  run(input, stage) {
    const raw = input.updates
    if (!Array.isArray(raw) || !raw.length) throw new ToolInputError('"updates" must list at least one task ({"item", …}).')
    if (raw.length > MAX_ITEM_UPDATES) throw new ToolInputError(`Too many updates (${raw.length}, at most ${MAX_ITEM_UPDATES} per call). Send the rest with a second call.`)
    const world = settleWorld()
    const inScope = itemScope(world)
    // a route without people's names: refusals list none, the staged lines name owners "@Person n"
    const r = namesRedactor()
    const people = peopleResolver(world, stage.items.source !== 'agent', !r)
    // the graph as it would be: live links, staged tasks' links, pending and planned link changes
    const planned = new Map<string, { add: Set<string>; remove: Set<string> }>()
    const plannedOf = (id: string) => planned.get(id) ?? planned.set(id, { add: new Set(), remove: new Set() }).get(id)!
    for (const c of stage.list()) {
      if (c.kind !== 'workItem' || c.status !== 'pending' || !c.workItem) continue
      const p = plannedOf(c.workItem.itemId)
      for (const x of c.workItem.patch.blockedBy?.add ?? []) p.add.add(x)
      for (const x of c.workItem.patch.blockedBy?.remove ?? []) p.remove.add(x)
    }
    const edgesOf = (id: string): string[] => {
      const c = creatorOf(stage, id)
      const base = c ? (stagedFact(c, id)?.blockedBy.map((r) => r.itemId) ?? []) : (world.entry(id)?.blockedBy ?? [])
      const p = planned.get(id)
      return p ? [...base.filter((x) => !p.remove.has(x)), ...p.add] : [...base]
    }
    const overlay = { byId: { get: (id: string) => ({ attrs: { blockedBy: edgesOf(id) } }) } } as unknown as Parameters<typeof wouldLoop>[0]
    const seen = new Set<string>()
    const plans: PlannedEdit[] = raw.map((item, i): PlannedEdit => {
      const where = `updates[${i}]`
      if (!item || typeof item !== 'object' || Array.isArray(item)) throw new ToolInputError(`${where} must be an object with "item".`)
      const o = item as Record<string, unknown>
      const ref = strIn(o, 'item', where, 80)
      if (!ref) throw new ToolInputError(`${where}: "item" is required (a task id wi_… or a #handle).`)
      const hit = resolveTaskRef(stage, world, inScope, ref)
      if ('error' in hit) throw new ToolInputError(`${where}: ${hit.error}`)
      const itemId = hit.id
      if (seen.has(itemId)) throw new ToolInputError(`${where}: ${itemId} is in this call twice. Put every change of one task into one entry.`)
      seen.add(itemId)
      const target = taskTarget(stage, world, inScope, itemId)
      if (!target) throw new ToolInputError(`${where}: No task ${itemId} here. Use list_work_items to find task ids.`)
      if (!target.creator) {
        const gate = pageGate(target.pageId)
        if (gate) throw new ToolInputError(`${where}: ${q(target.title)} can't be changed now: ${gate}.`)
      }
      const label = q(target.title)
      const patch: ItemPatch = {}
      const needs: string[] = []
      const status = strIn(o, 'status', where, 40)
      if (status !== undefined) {
        const s = STATUS_WORDS[status.toLowerCase().replace(/[\s_]+/g, ' ').replace('in_progress', 'in progress')] ?? (WORK_ITEM_STATUSES as readonly string[]).find((x) => x === status) ?? null
        if (!s) throw new ToolInputError(`${where}: ${q(status)} is no status. Use todo, in progress or done.`)
        patch.status = s as WorkItemStatus
      }
      if (o.due !== undefined) {
        if (o.due === null || o.due === '') patch.due = null
        else {
          const d = typeof o.due === 'string' ? readDue(o.due.trim().replace(' ', 'T')) : null
          if (!d) throw new ToolInputError(`${where}: ${q(String(o.due))} is no date. Write "YYYY-MM-DD" or "YYYY-MM-DDTHH:mm".`)
          patch.due = d
        }
      }
      if (o.reminder !== undefined) {
        if (o.reminder === null || o.reminder === '') patch.reminder = null
        else {
          const r = typeof o.reminder === 'string' ? readReminder(o.reminder.trim()) : null
          if (!r) throw new ToolInputError(`${where}: ${q(String(o.reminder))} is no reminder. Use at, -15m, -1h, -1d or -1w.`)
          const due = patch.due === undefined ? target.attrs.due : patch.due
          if (!due) throw new ToolInputError(`${where}: ${label} has no due date — a reminder needs one ("due").`)
          patch.reminder = r
        }
      }
      const ppl = listIn(o, 'people', where)
      if (ppl) {
        const ids = (names: string[]) =>
          names.map((n) => {
            const r = people.resolve(personDraftOf(n, world), target.title)
            if ('id' in r) return r.id
            throw new ToolInputError(`${where}: ${r.message}`)
          })
        const add = ids(ppl.add)
        const remove = ids(ppl.remove)
        if (add.length + target.attrs.people.filter((x) => !remove.includes(x) && !add.includes(x)).length > 12) throw new ToolInputError(`${where}: a task has at most 12 owners.`)
        patch.people = { ...(add.length ? { add } : {}), ...(remove.length ? { remove } : {}) }
      }
      for (const [key, field] of [['blocked_by', 'blockedBy'], ['related', 'related']] as const) {
        const list = listIn(o, key, where)
        if (!list) continue
        const resolve = (names: string[]) =>
          names.map((n) => {
            const r = resolveTaskRef(stage, world, inScope, n)
            if ('error' in r) throw new ToolInputError(`${where}: ${r.error}`)
            return r.id
          })
        const add = resolve(list.add)
        const remove = resolve(list.remove)
        for (const to of add) {
          if (to === itemId) throw new ToolInputError(`${where}: a task can't wait for or link itself.`)
          const linked = taskTarget(stage, world, inScope, to)
          if (!linked) throw new ToolInputError(`${where}: No task ${to} here. Use list_work_items to find task ids.`)
          if (!target.private && linked.private) throw new ToolInputError(`${where}: ${label} is shared and ${to} is private — a shared task can't link a private one.`)
          if (linked.creator && linked.creator.id !== target.creator?.id) needs.push(linked.creator.id)
          if (field === 'blockedBy') {
            if (wouldLoop(overlay, itemId, to)) throw new ToolInputError(`${where}: ${label} waiting for ${to} would close a loop (${to} already waits for it).`)
            plannedOf(itemId).add.add(to)
          }
        }
        if (add.length + target.attrs[field].filter((x) => !remove.includes(x) && !add.includes(x)).length > 20) throw new ToolInputError(`${where}: a task links at most 20 tasks per kind.`)
        patch[field] = { ...(add.length ? { add } : {}), ...(remove.length ? { remove } : {}) }
      }
      if (!Object.keys(patch).length) throw new ToolInputError(`${where}: nothing to change — pass status, due, reminder, people, blocked_by or related.`)
      return { itemId, patch, needs }
    })
    // every entry checked: stage them
    const lines: string[] = []
    const ns: number[] = []
    let first: StagedChange | null = null
    for (const p of plans) {
      const out = stageItemEdit(stage, p.itemId, p.patch, { needs: p.needs, world })
      if ('error' in out) throw new ToolInputError(`${p.itemId}: ${out.error}. Nothing more was staged.`)
      if (out.noop) {
        lines.push(`No change: ${p.itemId} ${q(out.target.title)} already has these values.`)
        continue
      }
      const c = out.change
      first ??= c
      ns.push(c.n)
      const fact = c.workItem!.facts
      lines.push(`${out.created ? 'Staged as change' : 'Updated staged change'} #${c.n}: ${factLineEn(factForRoute(fact, r))}.`)
    }
    if (!first) return { content: lines.join('\n'), summary: t('features.agent.res.same'), state: 'ok' }
    return {
      content: `${lines.join('\n')}\nNothing is written until the user applies it.`,
      summary: t('features.agent.res.staged', { n: ns.join(' #') }),
      state: 'staged',
      changeId: (first as StagedChange).id,
    }
  },
}

/* ------------------------------------------------------------------ */
/* Apply                                                               */
/* ------------------------------------------------------------------ */

/** How a batch's text changes settle at apply (and in their review): who writes, what it may see, may it create tasks. */
export interface ItemApplyOpts {
  source: SettleSource
  /** the custom agent's scope (null: everything) */
  visible?: ((id: ID) => boolean) | null
  /** false: no change of this batch creates a task (a server run's proposals) */
  creates?: boolean
  /** new tasks of the batch's changes not applied yet → their change */
  staged?: ReadonlyMap<string, StagedRef>
}

/** The writer kinds that stage changes → the settle source. */
export const sourceOfWriter = (w: Writer): SettleSource => (w.kind === 'agent' ? 'agent' : w.kind === 'mcp' ? 'mcp' : 'terminal')

/** The privacy of the page a change writes (a new page / row: its parent's / database's). */
export function changePrivate(c: StagedChange, resolveRow: (id: ID) => ID = (id) => id): boolean {
  const own = ws().pages[resolveRow(c.pageId)]
  if (own) return pagePrivate(own.id)
  return pagePrivate(c.parentId ?? c.databaseId ?? null)
}

/** The new tasks of the changes that are not applied yet (pending, failed, applying) → their change. */
export function stagedTasksOf(all: readonly StagedChange[], resolveRow?: (id: ID) => ID): Map<string, StagedRef> {
  const out = new Map<string, StagedRef>()
  for (const c of all) {
    if (!isOpen(c) || !c.items?.ids.length) continue
    const priv = changePrivate(c, resolveRow)
    for (const id of c.items.ids) out.set(id, { change: c.id, private: priv })
  }
  return out
}

/**
 * The settle context of a staged text change at apply (or in its review, `preview`): it creates exactly the tasks its
 * staging minted (`c.items.ids`, by position — never a new id; a change without them creates none), never refuses
 * (what it drops becomes a note).
 */
export function itemCtx(c: StagedChange, at: { pageId: ID | null; private: boolean; known?: JSONContent | null; keepSingle?: boolean }, opts: ItemApplyOpts, preview = false): SettleContext {
  return {
    source: opts.source,
    creates: !!c.items?.ids.length && opts.creates !== false,
    strict: false,
    pageId: at.pageId,
    private: at.private,
    visible: opts.visible ?? null,
    known: at.known ?? null,
    keepSingle: !!at.keepSingle,
    ids: c.items?.ids ?? [],
    // what staging resolved per new task (people, links) — written as it was reviewed, never resolved again
    ...(c.items?.pins ? { pins: c.items.pins } : {}),
    handles: new Map(Object.entries(c.items?.handles ?? {})),
    staged: opts.staged,
    change: c.id,
    existing: 'copy',
    me: opts.source !== 'agent',
    ...(preview ? { preview: true } : {}),
  }
}

/** Apply-time warnings the staging did not show (in the UI's language) — the notes under an applied change. */
export function applyNotes(c: StagedChange, report: SettleReport): string[] {
  const before = c.items?.warnings ?? []
  return report.warnings
    .filter((w) => !before.some((b) => b.code === w.code && b.task === w.task && b.value === w.value))
    .map((w) => t(`features.workItems.settle.${w.code}`, { value: w.value ?? '', task: w.task }))
}

/** The task's attrs on a page now: its live editor first (the store lags behind it), else the stored content. */
function attrsNow(pageId: ID, itemId: string): WorkItemAttrs | null {
  const editor = liveEditorOf(pageId)
  if (editor && !editor.isDestroyed) {
    const pos = findItemPos(editor.state.doc, itemId)
    return pos === null ? null : itemAttrs(editor.state.doc.nodeAt(pos))
  }
  const hit = itemsOfContent(ws().pages[pageId]?.content).find((i) => i.synced !== 'copy' && i.attrs.itemId === itemId)
  return hit ? hit.attrs : null
}

/** The page a 'workItem' change writes now: the task's page in the index (it may have moved), else where it was staged. */
export function itemPageOf(c: StagedChange, resolveRow: (id: ID) => ID): ID {
  const id = c.workItem?.itemId
  return (id && getItemIndex().byId.get(id)?.pageId) || resolveRow(c.pageId)
}

export interface ItemApply {
  applied: string[]
  failed: Array<{ id: string; error: string }>
  /** back as they were — the change ids left (partly) alone because a field changed since */
  undo: () => string[]
}

/**
 * Apply a page's 'workItem' changes: a version first, then ONE writeItems (origin 'ai') — a change whose task's touched
 * fields differ from what the review showed is skipped (`features.agent.item.changed`), never written over.
 * `done`: the changes applied before (a missing dependency fails the change).
 */
export async function applyItemChanges(pageId: ID, changes: StagedChange[], ctx: { writer: Writer; all: StagedChange[]; done: ReadonlySet<string> }): Promise<ItemApply> {
  const failed: ItemApply['failed'] = []
  await snapshotNow(pageId, 'ai')
  const edits: Array<{ c: StagedChange; edit: ItemEdit }> = []
  for (const c of changes) {
    const w = c.workItem
    if (!w) {
      failed.push({ id: c.id, error: 'nothing to do' })
      continue
    }
    const missing = depsOf(c).find((id) => !ctx.done.has(id))
    if (missing) {
      failed.push({ id: c.id, error: `needs change #${ctx.all.find((x) => x.id === missing)?.n ?? '?'} first` })
      continue
    }
    // a task it links must exist now (one a revised text no longer makes never did): never a dangling link
    const links = [...(w.patch.blockedBy?.add ?? []), ...(w.patch.related?.add ?? [])]
    if (links.some((id) => !getItemIndex().byId.has(id))) {
      failed.push({ id: c.id, error: t('features.agent.item.linkGone') })
      continue
    }
    const now = attrsNow(pageId, w.itemId)
    if (!now) {
      failed.push({ id: c.id, error: t('features.workItems.refused.gone', { page: ws().pages[pageId]?.title || t('common.untitled') }) })
      continue
    }
    if (w.before !== null) {
      const keys = Object.keys(JSON.parse(w.before) as Record<string, unknown>) as Array<keyof WorkItemAttrs>
      if (fieldsJson(now, keys) !== w.before) {
        failed.push({ id: c.id, error: t('features.agent.item.changed') })
        continue
      }
    }
    edits.push({ c, edit: { itemId: w.itemId, patch: w.patch, pageId } })
  }
  if (!edits.length) return { applied: [], failed, undo: () => [] }
  const res = writeItems(
    edits.map((x) => x.edit),
    // the page's write names the changes it carries (each a unit an eject settles — together, as they were written)
    { origin: 'ai', by: 'system', toasts: false, writer: ctx.writer, writerOf: (idxs) => writerOfChanges(ctx.writer, idxs.map((i) => edits[i].c.id)) },
  )
  const applied: string[] = []
  const byItem = new Map<string, string>()
  res.results.forEach((r, i) => {
    const c = edits[i].c
    if (r.ok) {
      applied.push(c.id)
      byItem.set(r.itemId, c.id)
    } else failed.push({ id: c.id, error: t(`features.workItems.refused.${r.refused ?? 'gone'}`, { page: ws().pages[pageId]?.title || t('common.untitled') }) })
  })
  return {
    applied,
    failed,
    undo: () => res.undo().kept.flatMap((itemId) => (byItem.has(itemId) ? [byItem.get(itemId)!] : [])),
  }
}

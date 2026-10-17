/**
 * Workspace agent — apply staged changes through the store (content origin 'ai') and undo a
 * whole batch. Undo is careful: content the user edited after applying is left alone.
 * Edits of existing content (kind 'edit', edit.ts) are applied per page, all of a batch in one
 * transaction after a version is kept. Property writes run inside aiWrite (features/history): the
 * row's state right before them is kept as an "AI" version.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import { isEffectivelyTrashed } from '../../../store/selectors'
import { COLOR_NAMES, type DateValue, type ID, type PropertyDef, type PropertyValue, type SelectOption, type View } from '../../../store/types'
import { defaultView } from '../../../store/store'
import { claudeSettled } from '../claudeDoc'
import { webImagesOf } from '../../agents/images'
import { newId } from '../../../lib/ids'
import { aiWrite, contentKey, snapshotNow } from '../../history/snapshots'
import { t } from '../../../i18n'
import { depsOf, type ColumnSpec, type PropChange, type StagedChange } from './types'
import { saveMemory, updateMemory } from '../memory/save'
import { applyPageEdits } from './edit'
import { applyItemChanges, applyNotes, itemCtx, itemPageOf, pagePrivate, sourceOfWriter, stagedTasksOf, type ItemApply, type ItemApplyOpts } from './workItems'
import { livePage, withPageNodes, type LinkTarget } from './links'
import { mediaNode } from '../media/blocks'
import { applyNewTask, applyTaskAction, isPipelineTask, taskNeedsConfirm, taskSig, taskWriteEndsConfirm, textRefsGained } from '../../coding'
import { isHandOnly, keyOwner, keyPropOf, keyText } from '../../../store/keys'
import { formatWriterKey, withWriter, type Writer } from '../../../store/writer'
import { createPrivatePage } from '../../../cloud'
import { isSettled } from '../../recorder/settled'
import { runKeyOf } from '../../recorder/model/writerKeys'

const ws = () => useWorkspace.getState()
const ORIGIN = 'ai'

function alive(id: ID | null | undefined): boolean {
  if (!id) return false
  const { pages } = ws()
  return !!pages[id] && !pages[id].trashed && !isEffectivelyTrashed(pages, id)
}

function isEmptyDoc(doc: JSONContent | null | undefined): boolean {
  const blocks = doc?.content ?? []
  return blocks.every((b) => b.type === 'paragraph' && !(b.content ?? []).length)
}

/**
 * Markdown Claude wrote (the change `c`'s) → a doc: nothing in it loads by itself (claudeDoc; addresses in `keep` stay),
 * its tasks exactly the ones staging minted (the settle gate, workItems.ts itemCtx — an id taken by now fails the change),
 * its `[Title](#/p/<id>)` links as page mentions / page link blocks (links.ts).
 */
type ToDoc = (markdown: string, c: StagedChange, at: { pageId: ID; private: boolean }, keep?: ReadonlySet<string>) => JSONContent

/** Claude's Markdown as blocks; `page`'s own images may stay. */
function blocksOf(markdown: string, toDoc: ToDoc, c: StagedChange, at: { pageId: ID; private: boolean }, page?: JSONContent | null): JSONContent[] {
  return (toDoc(markdown, c, at, page ? webImagesOf(page) : undefined).content ?? []).filter(Boolean)
}

/** The pages links may point at while a batch is applied: live pages, pages and databases staged in it, rows created from staged rows. */
function linkTargets(all: StagedChange[], resolveRow: (id: ID) => ID, rowIds: Record<string, ID>): (id: ID) => LinkTarget | null {
  // pages and databases keep their staged id; rows get theirs on apply (rowIds)
  const staged = new Map(all.filter((c) => (c.kind === 'create_page' || c.kind === 'create_database') && c.status !== 'discarded').map((c) => [c.pageId, c.title ?? '']))
  return (id) => {
    const real = rowIds[id] ?? resolveRow(id)
    return livePage(real) ?? (real === id && staged.has(id) ? { id, title: staged.get(id)! } : null)
  }
}

/** Option names → ids; missing names become new options (select / multi_select). */
function resolveOptions(dbId: ID, prop: PropertyDef, names: string[], created: Map<ID, ID[]>): string[] {
  const live = ws().databases[dbId]?.properties.find((p) => p.id === prop.id) ?? prop
  const opts: SelectOption[] = [...(live.options ?? [])]
  const ids: string[] = []
  const fresh: SelectOption[] = []
  const palette = COLOR_NAMES.filter((c) => c !== 'default')
  for (const name of names) {
    const hit = opts.find((o) => o.name.toLowerCase() === name.toLowerCase())
    if (hit) {
      ids.push(hit.id)
      continue
    }
    if (live.type === 'status') throw new Error(`unknown status "${name}"`)
    // locked since it was staged: the options stay as they are
    if (ws().databases[dbId]?.locked) throw new Error(`the database is locked — no new option "${name}"`)
    const opt: SelectOption = { id: newId(), name, color: palette[(opts.length + fresh.length) % palette.length] }
    opts.push(opt)
    fresh.push(opt)
    ids.push(opt.id)
  }
  if (fresh.length) {
    ws().updateProperty(dbId, prop.id, { options: opts })
    created.set(prop.id, [...(created.get(prop.id) ?? []), ...fresh.map((o) => o.id)])
  }
  return ids
}

const isDate = (v: unknown): v is DateValue => !!v && typeof v === 'object' && !Array.isArray(v) && typeof (v as DateValue).start === 'string'

/** A moved date keeps the reminder set on it (like the date editor: it rides along date changes). */
function keepReminder(prev: PropertyValue | undefined, next: PropertyValue): PropertyValue {
  return isDate(prev) && prev.reminder && isDate(next) && !next.reminder ? { ...next, reminder: prev.reminder } : next
}

function resolveValue(dbId: ID, pc: PropChange, created: Map<ID, ID[]>): PropertyValue {
  const prop = ws().databases[dbId]?.properties.find((p) => p.id === pc.propId)
  if (!prop) throw new Error(`property "${pc.name}" no longer exists`)
  // "Only by hand" since it was staged: agents never write it (store/keys.ts)
  if (isHandOnly(prop)) throw new Error(t('features.agent.err.handOnly', { name: prop.name }))
  if (pc.intent.kind === 'value') return pc.intent.value
  const ids = resolveOptions(dbId, prop, pc.intent.names, created)
  return prop.type === 'multi_select' ? ids : (ids[0] ?? null)
}

/**
 * The database's key stays unique (store/keys.ts): a value another row holds by now (a person or another run wrote
 * it since the change was staged) refuses the write. `self`: the row written (null: a new row).
 */
function checkKey(dbId: ID, values: Record<ID, PropertyValue>, self: ID | null): void {
  const key = keyPropOf(ws().databases[dbId])
  if (!key || !(key.id in values)) return
  const pages = ws().pages
  if (self && keyText(key.type, pages[self]?.properties[key.id]) === keyText(key.type, values[key.id])) return
  const owner = keyOwner(pages, dbId, key, values[key.id], self)
  if (owner) throw new Error(t('features.agent.err.keyTaken', { name: key.name, value: keyText(key.type, values[key.id]), row: owner.title.trim() || t('common.untitled') }))
}

/** Remove options this batch created if no row uses them any more. */
function dropUnusedOptions(dbId: ID, created: Map<ID, ID[]>) {
  for (const [propId, optIds] of created) {
    const db = ws().databases[dbId]
    const prop = db?.properties.find((p) => p.id === propId)
    if (!prop?.options) continue
    const used = new Set<string>()
    for (const r of Object.values(ws().pages)) {
      if (r.databaseId !== dbId) continue
      const v = r.properties[propId]
      if (typeof v === 'string') used.add(v)
      else if (Array.isArray(v)) v.forEach((x) => used.add(x))
    }
    const drop = optIds.filter((id) => !used.has(id))
    if (drop.length) ws().updateProperty(dbId, propId, { options: prop.options.filter((o) => !drop.includes(o.id)) })
  }
}

export interface ApplyResult {
  /** changes written (ids) */
  applied: string[]
  failed: Array<{ id: string; error: string }>
  /** staged row id → real row id, for rows created in this batch */
  rowIds: Record<string, ID>
  /** changes that cannot be undone (a task action that may have started the worker): Undo leaves them applied */
  final: string[]
  /**
   * revert the batch; `kept`: the changes left as they are because they were edited (or taken by the worker) meanwhile;
   * `reverted`: of a kept update_row, the properties that did go back (nobody had changed them)
   */
  undo: () => { kept: string[]; reverted: Record<string, ID[]> }
  /**
   * the caller's own rollback when the batch as a whole fails (MCP: "Nothing was changed"): as `undo`, but what this
   * batch created is deleted for good while untouched — never left in the trash, whatever `undoCreated` says (nobody
   * could have worked with it yet)
   */
  rollback: () => { kept: string[]; reverted: Record<string, ID[]> }
  /** what applying left out of a change (the settle gate's apply-time warnings, UI language), by change id */
  notes?: Record<string, string[]>
  /** the page a change really wrote, by change id ('workItem': the task's page now — attribution stamps it) */
  pages?: Record<string, ID>
}

/** The properties a row update's undo put back while it kept the rest (read after it ran; applyChanges' `reverted`). */
const revertedBy = new WeakMap<() => boolean | string[], () => ID[]>()

/**
 * Apply order: pages → databases → properties → rows and the rest → task fields ('workItem': after every content write
 * — a task a text change of the batch makes exists by then) → pipeline tasks (their pages may link the others).
 */
const RANK: Partial<Record<StagedChange['kind'], number>> = { create_page: 0, create_database: 1, add_property: 2, workItem: 3.5, coding: 4 }
const rank = (c: StagedChange) => RANK[c.kind] ?? 3

/**
 * The batch in apply order: by RANK, then review order — but never before a change of the batch it needs (depsOf: a new
 * page may link a task an append makes, a later rank). A loop (nothing stages one) keeps rank order; its changes fail.
 */
function applyOrder(changes: StagedChange[]): StagedChange[] {
  let left = [...changes].sort((a, b) => rank(a) - rank(b) || a.n - b.n)
  const inBatch = new Set(left.map((c) => c.id))
  const placed = new Set<string>()
  const out: StagedChange[] = []
  while (left.length) {
    const next = left.find((c) => depsOf(c).every((d) => !inBatch.has(d) || placed.has(d)))
    if (!next) {
      out.push(...left)
      break
    }
    out.push(next)
    placed.add(next.id)
    left = left.filter((c) => c !== next)
  }
  return out
}

/** The undo of a change that cannot be undone (applyChanges lists it in `final`). */
const FINAL = () => true

export interface ApplyOpts {
  /**
   * Who applies (store/writer.ts): the terminal's batch, an agent's run, an MCP call. Every synchronous burst of a
   * change runs under it (terminal / agent: with the change's id). The Undo's caller opens its own frame (you~undo).
   */
  writer: Writer
  /**
   * The AI terminal (session.ts) — the only caller that may apply pipeline tasks ('coding'); its row, page and title
   * changes of a pipeline task are refused while the task waits for "Confirm on this device", and their Undo leaves a
   * task alone that an agent changed since (local: the write would end its wait). Custom agents never.
   */
  terminal?: boolean
  /**
   * The terminal's own writes of pipeline tasks, recorded here (task id → fingerprint before → after, in order): a task
   * action staged before them still applies (coding/terminal.ts SigSteps) — an edit made elsewhere breaks the chain.
   */
  sigSteps?: Map<ID, Array<[string, string]>>
  /**
   * Task blocks: `visible` — the custom agent's scope (links resolve only inside it); `creates: false` — no change of
   * this batch creates a task and no 'workItem' change is applied (a server run's proposals: nobody saw them staged here).
   */
  items?: { visible?: ((id: ID) => boolean) | null; creates?: boolean }
  /**
   * How the Undo takes back a page / row this batch created: 'delete' (default) — for good while untouched, to the
   * trash once someone edited it; 'trash' (MCP, spec § 3.2) — to the trash while untouched, left alone ("kept") once
   * someone changed it since.
   */
  undoCreated?: 'delete' | 'trash'
}

/** The terminal's writes on a pipeline task wait for the person's Confirm on its page (a version this device trusts). */
async function guardTask(id: ID, opts: ApplyOpts): Promise<void> {
  if (opts.terminal && (await taskNeedsConfirm(id))) throw new Error(t('features.coding.term.err.confirm'))
}

/**
 * Text the terminal writes into a pipeline task's page sends the pages it links along to the worker: none its review
 * did not list (StagedChange.refs — a page that appeared since, or a page that became a task since).
 */
const refsGained = (id: ID, c: StagedChange, opts: ApplyOpts): boolean => !!opts.terminal && textRefsGained(id, c.markdown ?? '', c.refs)

/** The kinds that write an existing page or row (their target: the task a fingerprint step / an Undo guard is about). */
const WRITES_PAGE = new Set<StagedChange['kind']>(['update_row', 'append', 'rename', 'media'])

/**
 * Run a terminal write of a page; when it is a pipeline task, record how its fingerprint moved (opts.sigSteps), and
 * guard its Undo: a task an agent changed since is left as it is (the Undo's write would end its wait for Confirm).
 */
async function onTask<T extends () => boolean | string[]>(id: ID, opts: ApplyOpts, write: () => Promise<T>): Promise<T> {
  const task = opts.terminal && isPipelineTask(id)
  const before = task ? taskSig(id) : null
  const undo = await write()
  if (!task) return undo
  const after = taskSig(id)
  if (opts.sigSteps && before && after && before !== after) opts.sigSteps.set(id, [...(opts.sigSteps.get(id) ?? []), [before, after]])
  const guarded = (() => (taskWriteEndsConfirm(id) ? false : undo())) as T
  // a row update's undo keeps telling which properties it put back (applyChanges' `reverted`)
  const back = revertedBy.get(undo)
  if (back) revertedBy.set(guarded, back)
  return guarded
}

/**
 * Apply pending changes: pages, then databases, then properties, then rows and the rest, each in review order — and a
 * change after every change of the batch it needs (applyOrder). A change whose staged parent (or database, or
 * property, or a change whose new task it links) is not applied — in this batch or before — fails instead of landing
 * somewhere unexpected.
 */
export async function applyChanges(changes: StagedChange[], all: StagedChange[], resolveRow: (id: ID) => ID, opts: ApplyOpts): Promise<ApplyResult> {
  const applied: string[] = []
  const failed: ApplyResult['failed'] = []
  const rowIds: Record<string, ID> = {}
  const final: string[] = []
  const notes: Record<string, string[]> = {}
  const pages: Record<string, ID> = {}
  /** a batch part's undo: true = undone, false = every change of it kept, a list = the changes kept */
  const undos: Array<{ ids: string[]; fn: () => boolean | string[] }> = []
  const done = new Set(all.filter((c) => c.status === 'applied').map((c) => c.id))
  // a send is never applied here (the Outbox sends it, after a person's press): it stays as it is
  const ordered = applyOrder(changes.filter((c) => (c.status === 'pending' || c.status === 'failed') && c.kind !== 'send'))
  const inBatch = new Set(ordered.map((c) => c.id))
  /** the batch's changes already written or failed */
  const handled = new Set<string>()
  const failedNow = new Set<string>()
  const fail = (id: string, error: string) => {
    failed.push({ id, error })
    failedNow.add(id)
    handled.add(id)
  }
  /** why a change can't be applied: a change it needs is not applied — before or in this batch (null: none) */
  const missingNeed = (c: StagedChange): string | null => {
    const missing = depsOf(c).find((id) => !done.has(id))
    return missing ? `needs change #${all.find((x) => x.id === missing)?.n ?? '?'} first` : null
  }
  /** a change it needs comes later in this batch: it waits for its own turn (never in the group of an earlier one) */
  const waits = (c: StagedChange) => depsOf(c).some((id) => inBatch.has(id) && !handled.has(id))
  const targets = linkTargets(all, resolveRow, rowIds)
  // the settle gate at apply: the batch's tasks not applied yet — never those of a change that failed here (a link to
  // one is kept), who writes, the scope
  const itemOpts = (): ItemApplyOpts => ({ source: sourceOfWriter(opts.writer), visible: opts.items?.visible ?? null, creates: opts.items?.creates !== false, staged: stagedTasksOf(all.filter((x) => !done.has(x.id) && !failedNow.has(x.id)), resolveRow) })
  const toDoc: ToDoc = (markdown, c, at, keep) => {
    const { doc, report } = claudeSettled(markdown, keep, itemCtx(c, at, itemOpts()))
    // a task id this change staged is in use by now: the change fails (never a new id — other changes point at it)
    if (report.idTaken.length) throw new Error(t('features.agent.item.idTaken'))
    const left = applyNotes(c, report)
    if (left.length) notes[c.id] = left
    return withPageNodes(doc, targets)
  }
  /**
   * The changes of one page written together ('edit', 'workItem'): `c` and the batch's other changes of that kind and
   * page that are ready — one that needs a change still to come waits for its own turn; one whose need is not applied
   * fails ("needs change #n first") before anything else is looked at.
   */
  const groupOf = (c: StagedChange, pageOf: (x: StagedChange) => ID, pageId: ID): StagedChange[] => {
    const group: StagedChange[] = []
    for (const x of ordered) {
      if (handled.has(x.id) || x.kind !== c.kind || pageOf(x) !== pageId || (x !== c && waits(x))) continue
      const why = missingNeed(x)
      if (why) fail(x.id, why)
      else group.push(x)
    }
    for (const x of group) handled.add(x.id)
    return group
  }

  for (const c of ordered) {
    if (handled.has(c.id)) continue
    // task fields: every 'workItem' change of the task's page in the batch, in ONE write (after a version was kept)
    if (c.kind === 'workItem') {
      if (opts.items?.creates === false) {
        fail(c.id, t('features.agent.item.server'))
        continue
      }
      const pageOf = (x: StagedChange) => itemPageOf(x, resolveRow)
      const pageId = pageOf(c)
      const group = groupOf(c, pageOf, pageId)
      if (!group.length) continue
      // a task on a page in the trash (or gone) is not changed
      if (!alive(pageId)) {
        for (const x of group) fail(x.id, t('features.workItems.refused.gone'))
        continue
      }
      try {
        await guardTask(pageId, opts)
      } catch (e) {
        for (const x of group) fail(x.id, e instanceof Error ? e.message : String(e))
        continue
      }
      let res!: ItemApply
      const undoItems = await onTask(pageId, opts, async () => {
        res = await applyItemChanges(pageId, group, { writer: opts.writer, all, done })
        return res.undo
      })
      if (res.applied.length) undos.push({ ids: res.applied, fn: undoItems })
      applied.push(...res.applied)
      for (const id of res.applied) {
        done.add(id)
        pages[id] = pageId
      }
      for (const f of res.failed) fail(f.id, f.error)
      continue
    }
    // edits of existing content: every edit of this page in the batch, in one transaction
    if (c.kind === 'edit') {
      const pageOf = (x: StagedChange) => resolveRow(x.pageId)
      const pageId = pageOf(c)
      const group = groupOf(c, pageOf, pageId)
      if (!group.length) continue
      try {
        await guardTask(pageId, opts)
      } catch (e) {
        for (const x of group) fail(x.id, e instanceof Error ? e.message : String(e))
        continue
      }
      const gained = group.filter((x) => refsGained(pageId, x, opts))
      for (const x of gained) fail(x.id, t('features.coding.term.err.refs'))
      const edits = group.filter((x) => !gained.includes(x))
      if (!edits.length) continue
      let res!: Awaited<ReturnType<typeof applyPageEdits>>
      const undoEdits = await onTask(pageId, opts, async () => {
        res = await applyPageEdits(pageId, edits, opts.writer, itemOpts())
        return res.undo
      })
      if (res.applied.length) undos.push({ ids: res.applied, fn: undoEdits })
      applied.push(...res.applied)
      res.applied.forEach((id) => {
        done.add(id)
        pages[id] = pageId
      })
      for (const f of res.failed) fail(f.id, f.error)
      Object.assign(notes, res.notes ?? {})
      continue
    }
    handled.add(c.id)
    try {
      const why = missingNeed(c)
      if (why) throw new Error(why)
      const undo = WRITES_PAGE.has(c.kind) ? await onTask(resolveRow(c.pageId), opts, () => applyOne(c, resolveRow, rowIds, toDoc, opts)) : await applyOne(c, resolveRow, rowIds, toDoc, opts)
      if (undo === FINAL) final.push(c.id)
      else undos.push({ ids: [c.id], fn: undo })
      applied.push(c.id)
      done.add(c.id)
      pages[c.id] = rowIds[c.pageId] ?? resolveRow(c.pageId)
    } catch (e) {
      delete notes[c.id]
      fail(c.id, e instanceof Error ? e.message : String(e))
    }
  }

  // a change an eject settled (features/recorder/settled.ts) is not the batch's to revert any more: its closure is kept
  // — an edit group / a page's task changes whole when any of them is settled (their write names them all: they are
  // settled together) — and reported kept (another tab's eject too: the mark comes over)
  // (no writer: a caller that applies nothing of a run — its Undo keeps nothing for an eject)
  const runKey = opts.writer ? runKeyOf(formatWriterKey(opts.writer)) : null
  const undo = () => {
    const kept: string[] = []
    const reverted: Record<string, ID[]> = {}
    for (let i = undos.length - 1; i >= 0; i--) {
      const u = undos[i]!
      // a part holding a settled change is not run at all: every change of it kept, nothing of it reverted
      if (runKey && u.ids.some((id) => isSettled(runKey, id))) {
        kept.push(...u.ids)
        continue
      }
      // true = undone; false = every change of this part kept; a list = the changes of a page group kept
      const r = u.fn()
      if (r === true) continue
      kept.push(...(r === false ? u.ids : r))
      // a kept update_row: the properties its undo did put back (their verdicts go)
      const back = r === false ? revertedBy.get(u.fn)?.() ?? [] : []
      if (back.length && u.ids.length === 1) reverted[u.ids[0]!] = back
    }
    return { kept, reverted }
  }
  const rollback = () => {
    const prev = rollingBack
    rollingBack = true
    try {
      return undo()
    } finally {
      rollingBack = prev
    }
  }
  return { applied, failed, rowIds, final, undo, rollback, ...(Object.keys(notes).length ? { notes } : {}), pages }
}

/** Set while a batch's own rollback runs (ApplyResult.rollback): what it created goes for good, never to the trash. */
let rollingBack = false

/** A row's values as a key: the order of keys and an emptied value (null, '', []) do not count as a change. */
function valuesKey(props: Record<string, unknown> | undefined): string {
  const keys = Object.keys(props ?? {}).sort()
  const out: Array<[string, unknown]> = []
  for (const k of keys) {
    const v = props![k]
    if (v === undefined || v === null || v === '' || (Array.isArray(v) && !v.length)) continue
    out.push([k, v])
  }
  return JSON.stringify(out)
}

/**
 * Undo of a created page / row: deleted for good while untouched; once someone edited it, put pages under it or put it
 * (or a page above it) in the trash, it goes to the trash instead (recoverable) — one in the trash stays as it is.
 * `mode` 'trash' (MCP): untouched → the trash, touched (text, title, icon, a value, its place, a page under it) → left
 * as it is (kept: false). The batch's own rollback (ApplyResult.rollback) always takes the 'delete' way.
 */
function removeCreated(id: ID, mode: ApplyOpts['undoCreated'] = 'delete'): () => boolean {
  const made = ws().pages[id]
  const rev = made?.contentRev
  const key = contentKey(made?.content)
  const title = made?.title
  const icon = JSON.stringify(made?.icon ?? null)
  // a row: its values and its place as written (the person may fill a field or move it since)
  const values = valuesKey(made?.properties)
  const place = `${made?.parentId ?? null}|${made?.databaseId ?? null}`
  return () => {
    const { pages } = ws()
    const now = pages[id]
    if (!now || now.trashed) return true
    // content as written (a later change of the same batch undone first writes it back: the same content counts)
    const edited = (now.contentRev !== rev && contentKey(now.content) !== key) || now.title !== title
    if (mode === 'trash' && !rollingBack) {
      // a page above it in the trash already takes it along
      if (isEffectivelyTrashed(pages, id)) return true
      // changed since (text, title, icon, a value, its place, a live page put under it): left as it is
      if (
        edited ||
        JSON.stringify(now.icon ?? null) !== icon ||
        valuesKey(now.properties) !== values ||
        `${now.parentId ?? null}|${now.databaseId ?? null}` !== place ||
        Object.values(pages).some((p) => p.parentId === id && !p.trashed)
      )
        return false
      ws().trashPage(id)
      return true
    }
    const touched = edited || isEffectivelyTrashed(pages, id) || Object.values(pages).some((p) => p.parentId === id)
    if (touched) ws().trashPage(id)
    else ws().deletePagePermanently(id)
    return true
  }
}

const PALETTE = COLOR_NAMES.filter((c) => c !== 'default')

/** A staged column as a property definition (options get ids and colours). */
function columnDef(col: ColumnSpec): PropertyDef {
  const def: PropertyDef = { id: col.id, name: col.name, type: col.type }
  if (col.type === 'select' || col.type === 'multi_select') def.options = (col.options ?? []).map((name, i): SelectOption => ({ id: newId(), name, color: PALETTE[i % PALETTE.length] }))
  return def
}

/** The views of a staged database: a table (grouped when asked), a board first when it is the view. */
function viewsOf(c: StagedChange, properties: PropertyDef[]): View[] {
  const table = defaultView('table', { properties }, t('features.agent.view.table'))
  const group = c.groupBy && properties.some((p) => p.id === c.groupBy) ? c.groupBy : null
  if (c.view !== 'board' || !group) {
    if (group) table.groupBy = group
    return [table]
  }
  const board = defaultView('board', { properties }, t('features.agent.view.board'))
  board.groupBy = group
  return [board, table]
}

/** The writer of one staged change: the terminal's / an agent's with the change's id (an MCP call is one change). */
export function changeWriter(w: Writer, change: string): Writer {
  return w.kind === 'terminal' || w.kind === 'agent' ? { ...w, change } : w
}

/** Write one change. Returns its undo (false = left alone because it was edited since; FINAL = cannot be undone). */
async function applyOne(c: StagedChange, resolveRow: (id: ID) => ID, rowIds: Record<string, ID>, toDoc: ToDoc, opts: ApplyOpts): Promise<() => boolean> {
  const s = ws()
  // every synchronous burst of this change under its writer (after each await a new frame)
  const w = changeWriter(opts.writer, c.id)
  const as = <T>(fn: () => T): T => withWriter(w, fn)
  switch (c.kind) {
    case 'send':
      throw new Error('sends go through the Outbox')
    case 'coding': {
      // a pipeline task: only the AI terminal's review applies these (coding/terminal.ts checks it all again)
      const cd = c.coding
      if (!opts.terminal) throw new Error('not allowed here')
      if (!cd) throw new Error('nothing to do')
      if (cd.op === 'create') {
        if (!cd.task) throw new Error('nothing to do')
        const made = await applyNewTask(cd.task, w)
        rowIds[c.pageId] = made.id
        return made.undo
      }
      if (!cd.action) throw new Error('nothing to do')
      const taskId = resolveRow(cd.action.taskId)
      const res = await applyTaskAction({ ...cd.action, taskId }, { steps: opts.sigSteps?.get(taskId), writer: w })
      return res.undo ?? FINAL
    }
    case 'create_page': {
      if (c.parentId && !alive(c.parentId)) throw new Error('the parent page is gone')
      if (s.pages[c.pageId]) throw new Error('already exists')
      // its tasks are settled before anything is written (an id taken by now fails the change, nothing created)
      const doc = c.markdown?.trim() ? toDoc(c.markdown, c, { pageId: c.pageId, private: pagePrivate(c.parentId) }) : null
      const id = as(() => {
        // the top of the member's Private section (team, MCP `private`): its own meta document
        const made = c.privateRoot && !c.parentId ? createPrivatePage({ id: c.pageId, title: c.title ?? '' }) : s.createPage({ id: c.pageId, parentId: c.parentId ?? null, title: c.title ?? '' })
        if (doc) ws().setContent(made, doc, ORIGIN)
        return made
      })
      return removeCreated(id, opts.undoCreated)
    }
    case 'create_row': {
      const dbId = c.databaseId!
      if (!alive(dbId) || !s.databases[dbId]) throw new Error('the database is gone')
      const created = new Map<ID, ID[]>()
      const doc = c.markdown?.trim() ? toDoc(c.markdown, c, { pageId: c.pageId, private: pagePrivate(dbId) }) : null
      const id = as(() => {
        const properties: Record<ID, PropertyValue> = {}
        for (const pc of c.props ?? []) properties[pc.propId] = resolveValue(dbId, pc, created)
        try {
          checkKey(dbId, properties, null)
        } catch (e) {
          dropUnusedOptions(dbId, created)
          throw e
        }
        const row = ws().createRow(dbId, { title: c.title ?? '', properties })
        if (doc) ws().setContent(row, doc, ORIGIN)
        return row
      })
      rowIds[c.pageId] = id
      const remove = removeCreated(id, opts.undoCreated)
      return () => {
        const ok = remove()
        dropUnusedOptions(dbId, created)
        return ok
      }
    }
    case 'update_row': {
      const id = resolveRow(c.pageId)
      if (!alive(id) || !s.pages[id]?.databaseId) throw new Error('the row is gone')
      await guardTask(id, opts)
      const row = ws().pages[id]
      if (!alive(id) || !row?.databaseId) throw new Error('the row is gone')
      const dbId = row.databaseId
      const created = new Map<ID, ID[]>()
      const prev: Record<ID, PropertyValue | undefined> = {}
      const next: Record<ID, PropertyValue> = {}
      as(() => {
        for (const pc of c.props ?? []) {
          prev[pc.propId] = row.properties[pc.propId]
          next[pc.propId] = keepReminder(prev[pc.propId], resolveValue(dbId, pc, created))
        }
        try {
          checkKey(dbId, next, id)
        } catch (e) {
          dropUnusedOptions(dbId, created)
          throw e
        }
        // the row as it was is kept as an "AI" version first (features/history)
        aiWrite(() => {
          for (const [propId, v] of Object.entries(next)) ws().setRowProperty(id, propId, v)
        })
      })
      let back: ID[] = []
      const undo = () => {
        const now = ws().pages[id]
        if (!now) return false
        let kept = false
        back = []
        for (const [propId, v] of Object.entries(next)) {
          // only revert values nobody changed after the apply
          if (JSON.stringify(now.properties[propId] ?? null) !== JSON.stringify(v)) {
            kept = true
            continue
          }
          ws().setRowProperty(id, propId, (prev[propId] ?? null) as PropertyValue)
          back.push(propId)
        }
        dropUnusedOptions(dbId, created)
        return !kept
      }
      revertedBy.set(undo, () => back)
      return undo
    }
    case 'edit':
      // applied per page, together (applyPageEdits in applyChanges)
      throw new Error('an edit is applied with its page')
    case 'workItem':
      // applied per page, together (applyItemChanges in applyChanges)
      throw new Error('a task change is applied with its page')
    case 'append': {
      const id = resolveRow(c.pageId)
      if (!alive(id)) throw new Error('the page is gone')
      await guardTask(id, opts)
      if (refsGained(id, c, opts)) throw new Error(t('features.coding.term.err.refs'))
      await snapshotNow(id, 'ai')
      const page = ws().pages[id]
      if (!page) throw new Error('the page is gone')
      const prev = page.content
      const add = blocksOf(c.markdown ?? '', toDoc, c, { pageId: id, private: pagePrivate(id) }, prev)
      const next: JSONContent = { type: 'doc', content: isEmptyDoc(prev) ? add : [...(prev?.content ?? []), ...add] }
      as(() => ws().setContent(id, next, ORIGIN))
      const rev = ws().pages[id]?.contentRev
      const key = contentKey(ws().pages[id]?.content)
      return () => {
        const now = ws().pages[id]
        // edited since — unless a later change of the batch (a task's fields) was undone first and wrote it back
        if (!now || (now.contentRev !== rev && contentKey(now.content) !== key)) return false
        ws().setContent(id, prev, ORIGIN)
        return true
      }
    }
    case 'media': {
      // media saved from an MCP result (the files are in One already): their blocks at the end of the page
      const id = resolveRow(c.pageId)
      if (!alive(id)) throw new Error('the page is gone')
      const add = (c.media ?? []).map(mediaNode)
      if (!add.length) throw new Error('nothing to insert')
      await guardTask(id, opts)
      await snapshotNow(id, 'ai')
      const page = ws().pages[id]
      if (!page) throw new Error('the page is gone')
      const prev = page.content
      as(() => ws().setContent(id, { type: 'doc', content: isEmptyDoc(prev) ? add : [...(prev?.content ?? []), ...add] }, ORIGIN))
      const rev = ws().pages[id]?.contentRev
      return () => {
        const now = ws().pages[id]
        if (!now || now.contentRev !== rev) return false
        ws().setContent(id, prev, ORIGIN)
        return true
      }
    }
    case 'create_database': {
      if (c.parentId && !alive(c.parentId)) throw new Error('the parent page is gone')
      if (s.pages[c.pageId]) throw new Error('already exists')
      const properties: PropertyDef[] = [{ id: c.titlePropId ?? newId(), name: 'Name', type: 'title' }, ...(c.columns ?? []).map(columnDef)]
      const id = as(() => s.createDatabase({ id: c.pageId, parentId: c.parentId ?? null, title: c.title ?? '', properties, views: viewsOf(c, properties) }))
      return removeCreated(id)
    }
    case 'add_property': {
      const dbId = c.databaseId!
      const db = s.databases[dbId]
      const prop = c.prop!
      if (!alive(dbId) || !db) throw new Error('the database is gone')
      // locked since it was staged: the schema stays as it is (database/model/lock.ts)
      if (db.locked) throw new Error('the database is locked')
      if (db.properties.some((p) => p.id === prop.id)) throw new Error('already exists')
      if (db.properties.some((p) => p.name.trim().toLowerCase() === prop.name.toLowerCase())) throw new Error(`there is already a property "${prop.name}"`)
      as(() => s.addProperty(dbId, columnDef(prop)))
      return () => {
        const now = ws().databases[dbId]
        if (!now?.properties.some((p) => p.id === prop.id)) return true
        // values set since (by hand) keep the property
        const used = Object.values(ws().pages).some((r) => {
          if (r.databaseId !== dbId) return false
          const v = r.properties[prop.id]
          return v !== undefined && v !== null && v !== '' && v !== false && !(Array.isArray(v) && !v.length)
        })
        if (used) return false
        ws().deleteProperty(dbId, prop.id)
        return true
      }
    }
    case 'memory': {
      // the One memory (features/ai/memory): a new row, or the near-identical memory it updates
      const m = c.memory
      if (!m) throw new Error('nothing to remember')
      if (m.updates && alive(m.updates)) {
        const undo = as(() => aiWrite(() => updateMemory(m.updates!, m)))
        return () => {
          undo()
          return true
        }
      }
      let saved: ReturnType<typeof saveMemory>
      try {
        saved = as(() => saveMemory(m))
      } catch {
        throw new Error('the memory cannot be written here')
      }
      rowIds[c.pageId] = saved.id
      return () => {
        saved.undo()
        return true
      }
    }
    case 'script': {
      // One Script (write_script): saved — never run by applying; Undo puts the old version back (or removes a new one)
      const sc = c.script
      if (!sc) throw new Error('no script')
      const { saveScript } = await import('../../script')
      const prev = ws().scripts?.[sc.id] ?? null
      if (sc.before && !prev) throw new Error('the script was deleted')
      const now = Date.now()
      const next = { ...(prev ?? {}), id: sc.id, name: sc.name, kind: sc.kind, code: sc.code, ...(sc.description ? { description: sc.description } : {}), createdAt: prev?.createdAt ?? now, updatedAt: now }
      if (!as(() => saveScript(next))) throw new Error('scripts cannot be changed here')
      return () => {
        const cur = ws().scripts?.[sc.id]
        // changed by hand since: kept
        if (!cur || cur.code !== sc.code || cur.name !== sc.name) return false
        if (prev) saveScript(prev)
        else ws().deleteScript(sc.id)
        return true
      }
    }
    case 'rename': {
      const id = resolveRow(c.pageId)
      if (!alive(id)) throw new Error('the page is gone')
      await guardTask(id, opts)
      const prev = ws().pages[id]!.title
      const title = c.title ?? prev
      as(() => aiWrite(() => ws().updatePage(id, { title })))
      return () => {
        const now = ws().pages[id]
        if (!now || now.title !== title) return false
        ws().updatePage(id, { title: prev })
        return true
      }
    }
  }
}

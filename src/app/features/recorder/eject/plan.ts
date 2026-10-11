/**
 * Planning an eject (design §6.2, the async half): may this scope eject at all (the local workspace only, R3), the
 * open editors' typing into the store, the writer's open segments closed (with what its writes caused), the window
 * loaded, the pins it reads (metas; bodies and block lists of pages whose content it touched, of rows whose text it
 * touched), the places as they are now, what the databases and the sources say — then the pure core decides
 * (model/plan.ts). Writes nothing but what the editors' flush and the journal's settle write.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import { rewindAllowed } from '../../../store/rewind'
import type { Database, ID } from '../../../store/types'
import { flushOpenEditors, itemsOfContent, liftMisplacedItems } from '../../../editor'
import { optionRefs, propertyRefs, relationRestoreOk, withoutProperty } from '../../../database'
import { planRestoreProps } from '../../history/props'
import { kindOfDb, codingRoleOf } from '../../coding'
import { isKitComputed } from '../../kit'
import { blockList } from '../model/canon'
import { core, type BlockList, type CoreInput, type ItemLookup, type Plan, type PlanFns, type SourceFacts } from '../model/plan'
import { propKeysAt } from '../model/rowkeys'
import { F, type PinMeta, type PlaceKey, type PlaceWindow, type Scope, type WindowSel } from '../model/types'
import { deps } from '../journal/deps'
import { openJournal } from '../journal/db'
import { digestBlock } from '../journal/key'
import { readPinBodies, readPinMetas } from '../journal/pins'
import { emptyLookup, nowDigests } from '../window/digest'
import { LIST_PLACES, loadWindow, type WindowData } from '../window/load'
import { agentRunsOf, busyRefusal } from './guards'

/** Why an eject cannot be planned (eject.<key>). */
export type EjectRefusal =
  | { key: 'teamLater' }
  | { key: 'ejectRun' }
  | { key: 'tooMany'; n: number }
  | { key: 'empty' }
  | { key: 'agentBusy' }
  | { key: 'terminalBusy' }
  | { key: 'scriptBusy' }
  | { key: 'mcpBusy' }

/** R3 ejects in the local workspace only (team ejects come later; the store's guard says the same). */
export const canEject = (scope: Scope): boolean => scope === 'local:local' && rewindAllowed()

/** Above this many places an eject is refused (the reading lists the first 2,000 — design C27). */
export const EJECT_MAX = LIST_PLACES

/** The pure helpers of other areas the core is handed. */
export const PLAN_FNS: PlanFns = {
  planRestoreProps,
  relationRestoreOk,
  withoutProperty,
  propertyRefs,
  optionRefs,
  itemsOf: (content) =>
    itemsOfContent(content)
      .filter((it) => it.synced !== 'copy' && !!it.attrs.itemId)
      .map((it) => ({ itemId: it.attrs.itemId as string, blockedBy: it.attrs.blockedBy ?? [] })),
  liftMisplacedItems,
}

/**
 * What the sources know about the window's change ids: review statuses (agent runs, this tab's terminal batches — a
 * change id in two runs: applied wins, fewer skipped places, never more) and the changes that cannot be undone (a
 * terminal task action that may have started the worker: its places are held).
 */
async function sourceFacts(data: WindowData): Promise<SourceFacts> {
  const status = new Map<string, string>()
  const final = new Set<string>()
  const note = (id: string, st: string) => {
    if (status.get(id) !== 'applied') status.set(id, st)
  }
  const byAgent = agentRunsOf(data)
  if (byAgent.size) {
    const { loadAgentRuns } = await import('../../agents')
    for (const [agentId, refs] of byAgent) {
      for (const run of await loadAgentRuns(agentId)) {
        if (!refs.has(run.id)) continue
        for (const c of run.staged ?? []) note(c.id, c.status)
      }
    }
  }
  const terminal = Object.values(data.runs).filter((r) => r.kind === 'terminal')
  if (terminal.length) {
    const { batchFacts } = await import('../../ai/agent/session')
    for (const r of terminal) {
      const f = batchFacts(r.ref)
      if (!f) continue
      for (const [id, st] of Object.entries(f.status)) note(id, st)
      for (const id of f.final) final.add(id)
    }
  }
  return { ...(status.size ? { changeStatus: (id: string) => status.get(id) } : {}), ...(final.size ? { final } : {}) }
}

const isEmptyPara = (b: JSONContent) => b.type === 'paragraph' && !b.content?.length

/**
 * A content's top-level blocks as the journal signs them, with the stored JSON blocks they stand for — null when the
 * two do not line up (the schema reads a different number of blocks): such content is never planned block by block.
 */
export async function blockListOf(scope: Scope, content: JSONContent | null | undefined): Promise<BlockList | null> {
  const canons = blockList(content ?? null, deps)
  const strings = await Promise.all(canons.map(async (b) => `${b.id ?? '#'}=${await digestBlock(scope, b.canon)}`))
  const raw = [...(content?.content ?? [])]
  while (raw.length > canons.length && raw.length > 1 && isEmptyPara(raw[raw.length - 1])) raw.pop()
  if (raw.length !== canons.length) return canons.length === 0 && raw.length === 0 ? { strings, json: [] } : null
  return { strings, json: raw }
}

/** Does W touch a page's blocks (or, for a row, its text)? */
const touchesContent = (w: PlaceWindow) => w.own.some((g) => g.touched === '*' || g.touched.some((k) => (w.pk === 'row' ? k === 'c' : k.startsWith('b:') || k === 'b#' || k === 'bo')))

/**
 * Plan an eject of a window. `undoOf`: the after-reload Undo of an eject (E16) — the only way to plan an `eject:` run
 * or the undo lane.
 */
export async function planEject(sel: WindowSel, opts?: { undoOf?: string }): Promise<{ plan: Plan; input: CoreInput } | { refused: EjectRefusal }> {
  if (!canEject(sel.scope)) return { refused: { key: 'teamLater' } }
  if (!opts?.undoOf && (sel.run?.startsWith('eject:') || sel.lane === 'undo')) return { refused: { key: 'ejectRun' } }
  // the person's unsaved typing reaches the store first (it is theirs, and the plan must see it)
  flushOpenEditors()
  const data = await loadWindow(sel, { settle: true })
  if (data.tooMany || data.places.size > EJECT_MAX) return { refused: { key: 'tooMany', n: data.tooMany ?? data.places.size } }
  if (!data.places.size) return { refused: { key: 'empty' } }
  const busy = await busyRefusal(data)
  if (busy) return { refused: busy }
  const t0 = performance.now()
  const input = await inputOf(data)
  const plan = core(input)
  try {
    performance.measure('rec-plan', { start: t0, end: performance.now() })
  } catch {
    /* no marks */
  }
  return { plan, input }
}

/** Everything the core reads, for a loaded window (the commit's sync re-check runs the core on it again). */
export async function inputOf(data: WindowData): Promise<CoreInput> {
  const scope = data.sel.scope
  const memory = (await openJournal()).mode === 'memory'
  // pins: every own segment's meta; bodies where the content matters
  const pinIds = new Set<string>()
  const contentPins: Array<{ pin: string; pk: PlaceWindow['pk'] }> = []
  const contentPlaces: PlaceKey[] = []
  for (const w of data.places.values()) {
    for (const g of w.own) if (g.before) pinIds.add(g.before)
    if (w.unavailable || !touchesContent(w)) continue
    if (w.pk === 'page' || w.pk === 'db') {
      contentPlaces.push(w.p)
      for (const g of w.own) if (g.before) contentPins.push({ pin: g.before, pk: w.pk })
    } else if (w.pk === 'row' && w.own[0].before) contentPins.push({ pin: w.own[0].before, pk: 'row' })
  }
  const metas = await readPinMetas(scope, [...pinIds], memory)
  // a row's pin always carries its content when its text matters; a row whose values only changed needs no body
  const bodyRefs: Array<[ID, string]> = []
  for (const { pin } of contentPins) {
    const m = metas.get(pin)
    if (m?.kind === 'page' && m.body) bodyRefs.push([m.page.id, m.body])
  }
  // the body of every page pin too: the pin reads as a page only with its body (a row whose values changed, a page
  // W only trashed or moved — pinPage refuses a pin whose body is missing)
  for (const [, m] of metas) if (m.kind === 'page' && m.body) bodyRefs.push([m.page.id, m.body])
  const bodies = await readPinBodies(scope, dedupe(bodyRefs), memory)
  const blocks = new Map<string, BlockList>()
  await Promise.all(
    contentPins
      .filter((c) => c.pk !== 'row')
      .map(async ({ pin }) => {
        const m = metas.get(pin) as (PinMeta & { kind: 'page' }) | undefined
        if (!m) return
        const content = m.body ? bodies.get(`${m.page.id}|${m.body}`) : null
        if (m.body && content === undefined) return
        const list = await blockListOf(scope, content ?? null)
        if (list) blocks.set(pin, list)
      }),
  )
  const s = useWorkspace.getState()
  const state = { pages: s.pages, databases: s.databases }
  const nowBlocks = new Map<PlaceKey, BlockList>()
  await Promise.all(
    contentPlaces.map(async (p) => {
      const list = await blockListOf(scope, state.pages[p.slice(2)]?.content ?? null)
      if (list) nowBlocks.set(p, list)
    }),
  )
  const now = await nowDigests(scope, data.places.keys(), { keys: oldNewKeys(data, state.databases) })
  const keys = new Set<string>()
  for (const w of data.places.values()) for (const g of w.own) for (const k of Object.keys(g.left?.parts ?? {})) keys.add(k)
  for (const n of now.values()) for (const k of Object.keys(n.parts)) keys.add(k)
  const empty = await emptyLookup(scope, keys)
  const propOf = (db: ID, prop: ID) => state.databases[db]?.properties.find((p) => p.id === prop)
  return {
    data,
    now,
    pins: { metas, bodies, blocks },
    nowBlocks,
    state,
    empty,
    kitComputed: (db, prop) => {
      const def = propOf(db, prop)
      return !!def && isKitComputed(def)
    },
    readOnly: { pageLocked: (id) => !!state.pages[id]?.settings?.locked, dbLocked: (id) => !!state.databases[id]?.locked },
    db: {
      system: (db) => state.databases[db]?.system,
      pipelineRole: (db, prop) => (kindOfDb(db) ? codingRoleOf(db, prop) : undefined),
      props: (db) => state.databases[db]?.properties ?? [],
    },
    items: await itemLookup([...bodies.values()]),
    sources: await sourceFacts(data),
    fns: PLAN_FNS,
  }
}

const dedupe = (refs: Array<[ID, string]>): Array<[ID, string]> => [...new Map(refs.map((r) => [`${r[0]}|${r[1]}`, r])).values()]

/** Old NEW records (before parts were kept) compare their whole digest over the keys the database had then. */
function oldNewKeys(d: WindowData, databases: Record<ID, Database>): Map<PlaceKey, Set<string>> {
  const out = new Map<PlaceKey, Set<string>>()
  for (const [p, w] of d.places) {
    const last = w.own[w.own.length - 1]
    if (w.pk !== 'row' || !(w.own[0].f & F.NEW) || !last.left || Object.keys(last.left.parts).length) continue
    const keys = propKeysAt(databases[w.db ?? '']?.properties ?? [], d.schemaEvents.get(w.db ?? '') ?? [], last.to)
    if (keys) out.set(p, keys)
  }
  return out
}

/** The workspace's tasks — only built when a content that may come back holds one (the index scans every page once). */
async function itemLookup(contents: Array<JSONContent | null>): Promise<ItemLookup> {
  if (!contents.some((c) => !!c && JSON.stringify(c).includes('"workItem"'))) return { livePagesOf: () => [], wouldLoop: () => false }
  const { getItemIndex, wouldLoop } = await import('../../workitems')
  const index = getItemIndex()
  return {
    livePagesOf: (id) => {
      const dups = index.dups.get(id)
      if (dups?.length) return dups.map((e) => e.pageId)
      const one = index.byId.get(id)
      return one ? [one.pageId] : []
    },
    wouldLoop: (from, to) => wouldLoop(index, from, to),
  }
}

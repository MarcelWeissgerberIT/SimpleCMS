/**
 * AI autofill — runtime (in memory, this tab): runs, per-cell state, the open panel, and writing
 * results. Runs fill rows with a small concurrency through the features area's Claude client
 * (loaded lazily, like the editor does), which retries 429/5xx with backoff. Results either land in
 * a review (default) or are written directly ("apply without review", single cells, auto updates).
 *
 * Every accepted value goes through the store (writeValue → setRowProperty) and is remembered in
 * PropertyDef.autofill.fills[rowId] = { at, hash }. That map lives on the property on purpose: it
 * is tiny, persists and syncs with the workspace, travels with backups and disappears with the
 * property — no second storage layer that could drift out of step.
 */
import { useEffect, useId, useState } from 'react'
import { create } from 'zustand'
import type { AutofillConfig, Database, ID, Page, PropertyDef, PropertyValue } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { useUI } from '../../store/ui'
import { t } from '../../i18n'
import { newOption, rowsOf, writeValue } from '../model/actions'
import { autofillOf } from './config'
import { buildRequest } from './context'
import { coerceAnswer, sameValue } from './coerce'

type FeaturesApi = typeof import('../../features')
let featuresApi: FeaturesApi | null = null
let featuresLoading: Promise<FeaturesApi> | null = null

/** The features area (Claude client), loaded on first use. */
export function loadFeatures(): Promise<FeaturesApi> {
  return (featuresLoading ??= import('../../features').then(
    (m) => (featuresApi = m),
    (e) => {
      featuresLoading = null
      throw e
    },
  ))
}

/** The features API once loaded (null for a moment on first use). */
export function useFeatures(): FeaturesApi | null {
  const [api, setApi] = useState<FeaturesApi | null>(featuresApi)
  useEffect(() => {
    if (!api) loadFeatures().then(setApi, () => {})
  }, [api])
  return api
}

/* ------------------------------------------------------------------ */
/* State                                                               */
/* ------------------------------------------------------------------ */

export type RunMode = 'all' | 'empty' | 'cell'
export type ProposalStatus = 'pending' | 'same' | 'applied' | 'rejected' | 'error'

export interface Proposal {
  rowId: ID
  title: string
  status: ProposalStatus
  /** stored value when the answer arrived */
  current: PropertyValue
  /** coerced value (select / multi_select: ids of existing options — see names) */
  value?: PropertyValue
  /** select / multi_select: chosen option names (resolved to ids when applied) */
  names?: string[]
  /** names among `names` that are not options yet */
  newNames?: string[]
  error?: string
  /** fingerprint of the context that was sent */
  hash: string
  /** applied: the value it replaced (for undo) */
  prev?: PropertyValue
}

export interface Job {
  key: string
  dbId: ID
  propId: ID
  mode: RunMode
  review: boolean
  phase: 'running' | 'review' | 'finished'
  cancelled: boolean
  /** rows of this run, in table order */
  rows: ID[]
  done: number
  results: Record<ID, Proposal>
  /** last finished rows, newest first */
  recent: ID[]
  /** a failure that stopped the whole run (no / invalid key …) */
  fatal?: string
  /** the written values were rolled back */
  undone?: boolean
}

export type CellState = { state: 'queued' | 'running' } | { state: 'error'; message: string }

interface AutofillState {
  jobs: Record<string, Job>
  /** keyed by cellKey(propId, rowId) */
  cells: Record<string, CellState>
  panel: { dbId: ID; propId: ID } | null
  /** mounted panel hosts; the first one renders the panel */
  hosts: string[]
}

export const useAutofill = create<AutofillState>()(() => ({ jobs: {}, cells: {}, panel: null, hosts: [] }))
const st = () => useAutofill.getState()
const set = useAutofill.setState

export const jobKey = (dbId: ID, propId: ID) => `${dbId}:${propId}`
export const cellKey = (propId: ID, rowId: ID) => `${propId}:${rowId}`

const CONCURRENCY = 3
const FATAL = new Set(['no_key', 'invalid_key', 'permission'])
const controllers = new Map<string, AbortController>()

function patchJob(key: string, fn: (j: Job) => Partial<Job>) {
  set((s) => {
    const j = s.jobs[key]
    return j ? { jobs: { ...s.jobs, [key]: { ...j, ...fn(j) } } } : s
  })
}

function patchResult(key: string, rowId: ID, patch: Partial<Proposal>) {
  patchJob(key, (j) => (j.results[rowId] ? { results: { ...j.results, [rowId]: { ...j.results[rowId], ...patch } } } : {}))
}

export function setCells(entries: Record<string, CellState | null>) {
  set((s) => {
    const cells = { ...s.cells }
    for (const [k, v] of Object.entries(entries)) {
      if (v) cells[k] = v
      else delete cells[k]
    }
    return { cells }
  })
}

function lookup(dbId: ID, propId: ID): { db: Database; prop: PropertyDef; cfg: AutofillConfig } | null {
  const db = useWorkspace.getState().databases[dbId]
  const prop = db?.properties.find((p) => p.id === propId)
  const cfg = prop ? autofillOf(prop) : null
  return db && prop && cfg ? { db, prop, cfg } : null
}

export const hasKey = () => !!useWorkspace.getState().settings.aiApiKey.trim()

export function openAISettings() {
  closeAutofillPanel()
  useUI.getState().openModal({ type: 'settings', tab: 'ai' })
}

/* ------------------------------------------------------------------ */
/* Rows                                                                */
/* ------------------------------------------------------------------ */

/** Nothing stored yet (checkbox: unchecked and never filled). */
export function isEmptyCell(prop: PropertyDef, row: Page, cfg: AutofillConfig | null): boolean {
  const v = row.properties[prop.id]
  if (prop.type === 'checkbox') return v !== true && !cfg?.fills?.[row.id]
  if (v === null || v === undefined || v === '') return true
  if (Array.isArray(v)) return v.length === 0
  if (prop.type === 'select') return !prop.options?.some((o) => o.id === v)
  return false
}

export function candidateRows(dbId: ID, prop: PropertyDef, cfg: AutofillConfig | null, mode: 'all' | 'empty'): Page[] {
  const rows = rowsOf(dbId)
  return mode === 'all' ? rows : rows.filter((r) => isEmptyCell(prop, r, cfg))
}

/* ------------------------------------------------------------------ */
/* One row                                                             */
/* ------------------------------------------------------------------ */

const errCode = (e: unknown): string | undefined => (e && typeof e === 'object' && 'code' in e ? String((e as { code: unknown }).code) : undefined)

/**
 * Ask Claude for one cell and validate the answer. Never writes. Throws only when aborted;
 * every other failure becomes a proposal with status 'error' (`fatal` when the run should stop).
 */
export async function fillRow(dbId: ID, propId: ID, rowId: ID, signal: AbortSignal): Promise<(Proposal & { fatal?: boolean }) | null> {
  const found = lookup(dbId, propId)
  const row = useWorkspace.getState().pages[rowId]
  if (!found || !row || row.trashed || row.databaseId !== dbId) return null
  const { db, prop, cfg } = found
  const { request, hash } = buildRequest(db, prop, row, cfg)
  const base = { rowId, title: row.title, current: row.properties[prop.id] ?? null, hash }
  try {
    const api = await loadFeatures()
    const answer = await api.requestAutofill(request, signal)
    if (!answer.ok) return { ...base, status: 'error', error: t('database.autofill.err.json') }
    const c = coerceAnswer(prop, cfg, answer.value)
    if (!c.ok) return { ...base, status: 'error', error: c.error }
    return { ...base, status: sameValue(prop, base.current, c) ? 'same' : 'pending', value: c.value, names: c.names, newNames: c.newNames }
  } catch (e) {
    const code = errCode(e)
    if (signal.aborted || code === 'aborted') throw e
    const message = e instanceof Error ? e.message : String(e)
    return { ...base, status: 'error', error: message, fatal: !!code && FATAL.has(code) }
  }
}

/**
 * Write a proposal into its row (creating new options first). Returns the value it replaced, or
 * undefined when nothing was written (row or property gone).
 */
export function writeProposal(dbId: ID, propId: ID, p: Proposal): PropertyValue | undefined {
  const s = useWorkspace.getState()
  const db = s.databases[dbId]
  const prop = db?.properties.find((x) => x.id === propId)
  const row = s.pages[p.rowId]
  if (!db || !prop || !row || row.trashed) return undefined
  const prev: PropertyValue = row.properties[propId] ?? null
  let value: PropertyValue = p.value ?? null
  if (prop.type === 'select' || prop.type === 'multi_select') {
    let opts = [...(prop.options ?? [])]
    let created = false
    const ids = (p.names ?? []).map((n) => {
      let o = opts.find((x) => x.name.toLowerCase() === n.toLowerCase())
      if (!o) {
        o = newOption(n, opts)
        opts = [...opts, o]
        created = true
      }
      return o.id
    })
    if (created) s.updateProperty(dbId, propId, { options: opts })
    value = prop.type === 'select' ? (ids[0] ?? null) : ids
  }
  writeValue(dbId, prop, p.rowId, value)
  return prev
}

/** Remember when rows were filled and from what (pruned to rows that still exist). */
export function recordFills(dbId: ID, propId: ID, entries: Record<ID, { at: number; hash: string }>) {
  if (!Object.keys(entries).length) return
  const s = useWorkspace.getState()
  const prop = s.databases[dbId]?.properties.find((p) => p.id === propId)
  const cfg = prop?.autofill
  if (!cfg) return
  const live = new Set(rowsOf(dbId).map((r) => r.id))
  const fills: Record<ID, { at: number; hash: string }> = {}
  for (const [id, f] of Object.entries(cfg.fills ?? {})) if (live.has(id)) fills[id] = f
  Object.assign(fills, entries)
  s.updateProperty(dbId, propId, { autofill: { ...cfg, fills } })
}

/* ------------------------------------------------------------------ */
/* Runs                                                                */
/* ------------------------------------------------------------------ */

const propName = (dbId: ID, propId: ID) => useWorkspace.getState().databases[dbId]?.properties.find((p) => p.id === propId)?.name ?? ''

function toastNoKey() {
  useUI.getState().toast({ message: t('database.autofill.toast.noKey'), kind: 'info', action: { label: t('database.autofill.toast.settings'), run: openAISettings } })
}

/** Fill a property for all rows, the empty ones, or the given rows. */
export async function startFill(dbId: ID, propId: ID, mode: RunMode, only?: ID[]): Promise<void> {
  const key = jobKey(dbId, propId)
  const existing = st().jobs[key]
  if (existing?.phase === 'running') {
    useUI.getState().toast(t('database.autofill.toast.busy', { name: propName(dbId, propId) }))
    return
  }
  // results still waiting for review are never thrown away by a new run: show them first
  if (existing?.phase === 'review') return openAutofillPanel(dbId, propId)
  const found = lookup(dbId, propId)
  if (!found) return
  if (!hasKey()) return toastNoKey()
  const { prop, cfg } = found
  const pages = useWorkspace.getState().pages
  const rows = only
    ? only.map((id) => pages[id]).filter((r): r is Page => !!r && !r.trashed && r.databaseId === dbId)
    : candidateRows(dbId, prop, cfg, mode === 'cell' ? 'all' : mode)
  if (!rows.length) {
    useUI.getState().toast(t('database.autofill.toast.nothing'))
    return
  }
  const review = !cfg.skipReview
  const ac = new AbortController()
  controllers.set(key, ac)
  set((s) => ({ jobs: { ...s.jobs, [key]: { key, dbId, propId, mode, review, phase: 'running', cancelled: false, rows: rows.map((r) => r.id), done: 0, results: {}, recent: [] } } }))
  setCells(Object.fromEntries(rows.map((r) => [cellKey(propId, r.id), { state: 'queued' as const }])))

  const fills: Record<ID, { at: number; hash: string }> = {}
  let next = 0
  const worker = async () => {
    while (!ac.signal.aborted && next < rows.length) {
      const row = rows[next++]
      const ck = cellKey(propId, row.id)
      setCells({ [ck]: { state: 'running' } })
      let p: (Proposal & { fatal?: boolean }) | null
      try {
        p = await fillRow(dbId, propId, row.id, ac.signal)
      } catch {
        setCells({ [ck]: null })
        continue
      }
      if (!p) {
        setCells({ [ck]: null })
        patchJob(key, (j) => ({ done: j.done + 1 }))
        continue
      }
      const { fatal, ...proposal } = p
      if (fatal) {
        ac.abort()
        patchJob(key, () => ({ fatal: proposal.error }))
      }
      if (!review && proposal.status === 'pending') {
        const prev = writeProposal(dbId, propId, proposal)
        if (prev !== undefined) Object.assign(proposal, { status: 'applied', prev })
      }
      if (!review && (proposal.status === 'applied' || proposal.status === 'same')) fills[proposal.rowId] = { at: Date.now(), hash: proposal.hash }
      setCells({ [ck]: proposal.status === 'error' && !fatal ? { state: 'error', message: proposal.error ?? '' } : null })
      patchJob(key, (j) => ({ done: j.done + 1, results: { ...j.results, [proposal.rowId]: proposal }, recent: [proposal.rowId, ...j.recent].slice(0, 6) }))
    }
  }
  await Promise.all(Array.from({ length: Math.min(CONCURRENCY, rows.length) }, worker))
  controllers.delete(key)
  // rows that never ran (cancelled / stopped)
  const cells = st().cells
  setCells(Object.fromEntries(rows.map((r) => cellKey(propId, r.id)).filter((k) => cells[k] && cells[k].state !== 'error').map((k) => [k, null])))
  recordFills(dbId, propId, fills)
  finishRun(key)
}

function finishRun(key: string) {
  const j = st().jobs[key]
  if (!j) return
  const results = Object.values(j.results)
  const pending = results.filter((p) => p.status === 'pending').length
  const failed = results.filter((p) => p.status === 'error').length
  const applied = results.filter((p) => p.status === 'applied').length
  const panel = st().panel
  const panelOpen = panel?.dbId === j.dbId && panel.propId === j.propId
  const name = propName(j.dbId, j.propId)
  const toast = useUI.getState().toast
  if (j.fatal && !panelOpen) toast({ message: j.fatal, kind: 'error', action: { label: t('database.autofill.toast.settings'), run: openAISettings } })
  if (j.review && pending) {
    patchJob(key, () => ({ phase: 'review' }))
    if (panelOpen) return
    if (j.mode === 'cell') openAutofillPanel(j.dbId, j.propId)
    else toast({ message: t('database.autofill.toast.review', { name, count: pending }), action: { label: t('database.autofill.toast.reviewAction'), run: () => openAutofillPanel(j.dbId, j.propId) }, timeout: 12000 })
    return
  }
  patchJob(key, () => ({ phase: 'finished' }))
  if (panelOpen) return
  if (!j.fatal) {
    const single = j.mode === 'cell' && results.length === 1 ? results[0] : null
    if (single?.status === 'error') toast({ message: t('database.autofill.cell.error', { msg: single.error ?? '' }), kind: 'error' })
    else if (single?.status === 'same') toast(t('database.autofill.toast.filledOne', { name, row: single.title || t('common.untitled') }))
    else if (single?.status === 'applied') {
      const p = single
      const before = p.prev ?? p.current
      toast({
        message: t('database.autofill.toast.filledOne', { name, row: p.title || t('common.untitled') }),
        kind: 'success',
        action: {
          label: t('common.undo'),
          run: () => {
            const prop = useWorkspace.getState().databases[j.dbId]?.properties.find((x) => x.id === j.propId)
            if (prop && useWorkspace.getState().pages[p.rowId]) writeValue(j.dbId, prop, p.rowId, before)
          },
        },
      })
    } else if (failed) toast({ message: t('database.autofill.toast.filledFailed', { name, count: applied, failed }), kind: 'error' })
    else toast({ message: t('database.autofill.toast.filled', { name, count: applied }), kind: 'success' })
  }
  clearJob(key)
}

export function cancelFill(key: string) {
  const ac = controllers.get(key)
  if (!ac) return
  patchJob(key, () => ({ cancelled: true }))
  ac.abort()
}

export function clearJob(key: string) {
  set((s) => {
    if (!s.jobs[key]) return s
    const jobs = { ...s.jobs }
    delete jobs[key]
    return { jobs }
  })
}

/* ------------------------------------------------------------------ */
/* Review                                                              */
/* ------------------------------------------------------------------ */

function settleIfDone(key: string) {
  const j = st().jobs[key]
  if (j && j.phase === 'review' && !Object.values(j.results).some((p) => p.status === 'pending')) patchJob(key, () => ({ phase: 'finished' }))
}

export function acceptProposal(key: string, rowId: ID) {
  const j = st().jobs[key]
  const p = j?.results[rowId]
  if (!j || !p || p.status !== 'pending') return
  const prev = writeProposal(j.dbId, j.propId, p)
  if (prev !== undefined) recordFills(j.dbId, j.propId, { [rowId]: { at: Date.now(), hash: p.hash } })
  patchResult(key, rowId, prev !== undefined ? { status: 'applied', prev } : { status: 'rejected' })
  settleIfDone(key)
}

export function rejectProposal(key: string, rowId: ID) {
  const p = st().jobs[key]?.results[rowId]
  if (!p || p.status !== 'pending') return
  patchResult(key, rowId, { status: 'rejected' })
  settleIfDone(key)
}

export function acceptAll(key: string) {
  const j = st().jobs[key]
  if (!j) return
  const fills: Record<ID, { at: number; hash: string }> = {}
  const results = { ...j.results }
  for (const p of Object.values(j.results)) {
    if (p.status === 'pending') {
      const prev = writeProposal(j.dbId, j.propId, p)
      results[p.rowId] = prev !== undefined ? { ...p, status: 'applied', prev } : { ...p, status: 'rejected' }
      if (prev !== undefined) fills[p.rowId] = { at: Date.now(), hash: p.hash }
    } else if (p.status === 'same') fills[p.rowId] = { at: Date.now(), hash: p.hash }
  }
  recordFills(j.dbId, j.propId, fills)
  patchJob(key, () => ({ results, phase: 'finished' }))
}

export function discardAll(key: string) {
  const j = st().jobs[key]
  if (!j) return
  const results = Object.fromEntries(Object.entries(j.results).map(([id, p]) => [id, p.status === 'pending' ? { ...p, status: 'rejected' as const } : p]))
  patchJob(key, () => ({ results, phase: 'finished' }))
}

/** Put back the values a run wrote (and forget those fills, so auto update may run again). */
export function undoApplied(key: string) {
  const j = st().jobs[key]
  if (!j) return
  const s = useWorkspace.getState()
  const prop = s.databases[j.dbId]?.properties.find((p) => p.id === j.propId)
  if (!prop) return
  const results = { ...j.results }
  const undone = new Set<ID>()
  for (const p of Object.values(j.results)) {
    if (p.status !== 'applied' || p.prev === undefined || !useWorkspace.getState().pages[p.rowId]) continue
    writeValue(j.dbId, prop, p.rowId, p.prev)
    results[p.rowId] = { ...p, status: 'rejected' }
    undone.add(p.rowId)
  }
  const cfg = useWorkspace.getState().databases[j.dbId]?.properties.find((p) => p.id === j.propId)?.autofill
  if (cfg?.fills && undone.size) {
    const fills = Object.fromEntries(Object.entries(cfg.fills).filter(([id]) => !undone.has(id)))
    s.updateProperty(j.dbId, j.propId, { autofill: { ...cfg, fills } })
  }
  patchJob(key, () => ({ results, undone: true }))
}

export function retryFailed(key: string) {
  const j = st().jobs[key]
  if (!j) return
  const ids = j.rows.filter((id) => j.results[id]?.status === 'error')
  clearJob(key)
  if (ids.length) void startFill(j.dbId, j.propId, j.mode, ids)
}

/* ------------------------------------------------------------------ */
/* Config                                                              */
/* ------------------------------------------------------------------ */

/** Save a config (keeps the fill records), or turn autofill off (null). */
export function saveAutofillConfig(dbId: ID, propId: ID, cfg: AutofillConfig | null) {
  const s = useWorkspace.getState()
  const prop = s.databases[dbId]?.properties.find((p) => p.id === propId)
  if (!prop) return
  if (!cfg) {
    cancelFill(jobKey(dbId, propId))
    const prefix = `${propId}:`
    setCells(Object.fromEntries(Object.keys(st().cells).filter((k) => k.startsWith(prefix)).map((k) => [k, null])))
    s.updateProperty(dbId, propId, { autofill: undefined })
    return
  }
  const { fills: _ignored, ...rest } = cfg
  void _ignored
  const next: AutofillConfig = { ...rest, ...(prop.autofill?.fills ? { fills: prop.autofill.fills } : {}) }
  if (JSON.stringify(next) !== JSON.stringify(prop.autofill ?? null)) s.updateProperty(dbId, propId, { autofill: next })
}

/* ------------------------------------------------------------------ */
/* Panel                                                               */
/* ------------------------------------------------------------------ */

export function openAutofillPanel(dbId: ID, propId: ID) {
  set({ panel: { dbId, propId } })
}

export function closeAutofillPanel() {
  const p = st().panel
  set({ panel: null })
  if (!p) return
  const j = st().jobs[jobKey(p.dbId, p.propId)]
  if (j?.phase === 'finished') clearJob(j.key)
}

/** Register a panel host; true for the one that renders (the first mounted). */
export function useAutofillHost(): boolean {
  const id = useId()
  useEffect(() => {
    set((s) => ({ hosts: [...s.hosts, id] }))
    return () => set((s) => ({ hosts: s.hosts.filter((h) => h !== id) }))
  }, [id])
  return useAutofill((s) => s.hosts[0] === id)
}

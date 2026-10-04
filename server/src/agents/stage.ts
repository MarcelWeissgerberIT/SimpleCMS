/**
 * Staged changes of server agents (write mode "stage") in the app's StagedChange shape
 * (src/app/features/ai/agent/types.ts): property values Claude sends by name are checked at once (a
 * value that does not fit is an error Claude can fix), kept as display text plus an intent (option
 * NAMES for select / status / multi-select, stored values for the rest), and written only when someone
 * applies them — in the app (apply.ts) or here (`POST …/agent-runs/:runId/apply`).
 */
import type { PageInfo, PropertyDef, Roots } from '../api/meta.ts'
import { findProperty, type WorkspaceModel } from '../api/model.ts'
import { READ_ONLY_TYPES, ValueError, coerce, type ValueContext } from '../api/values.ts'
import { ApiError } from '../errors.ts'
import { type McpWrites, friendlyIn, optionNames } from '../mcp/writes.ts'
import { valueText } from './scope.ts'
import type { PropChange, StagedChange } from './types.ts'

/** A call Claude has to fix: the message goes back to Claude as an error result. */
export class ToolInputError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ToolInputError'
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)
const q = (s: string) => JSON.stringify(s)

/** Properties Claude cannot set (computed, or files — the app's agent leaves them alone too). */
export const settable = (p: PropertyDef) => p.type !== 'title' && p.type !== 'files' && !READ_ONLY_TYPES.has(p.type)

/** An ApiError (422 with the allowed values …) as a message Claude can act on. */
export function explain(err: ApiError): string {
  if (err.code === 'parent_is_database') return 'The parent is a database: add a row with create_row instead.'
  const details = err.details as { errors?: Array<{ allowed?: string[]; property?: string }> } | undefined
  const allowed = (details?.errors ?? []).filter((e) => e.allowed?.length).map((e) => `${e.property}: ${e.allowed!.join(', ')}`)
  return `${err.message}${allowed.length ? ` (allowed — ${allowed.join(' · ')})` : ''}`
}

/**
 * Claude's property values (by name) → staged property changes, validated against the schema the
 * way the app's agent does (props.ts). `row` is null for a new row.
 */
export function stageProps(r: Roots, db: { properties: PropertyDef[]; locked: boolean }, row: PageInfo | null, input: unknown, ctx: ValueContext): PropChange[] {
  if (input === undefined || input === null) return []
  if (!isObj(input)) throw new ToolInputError('"properties" must be an object: property name → value.')
  const out: PropChange[] = []
  const names = db.properties.filter(settable).map((p) => q(p.name)).join(', ')
  for (const [key, raw] of Object.entries(input)) {
    const prop = findProperty(db.properties, key)
    if (!prop) throw new ToolInputError(`Unknown property ${q(key)}. Settable properties: ${names || '(none)'}.`)
    if (prop.type === 'title') throw new ToolInputError(`${q(prop.name)} is the title: use the title parameter (or set_page_title).`)
    if (!settable(prop)) throw new ToolInputError(`${q(prop.name)} (${prop.type}) is computed and cannot be set.`)
    const before = row ? valueText(prop, row, ctx) : ''
    const base = { propId: prop.id, name: prop.name, type: prop.type, before }
    if (prop.type === 'select' || prop.type === 'status' || prop.type === 'multi_select') {
      const wanted = optionNames(prop, raw)
      const opts = prop.options ?? []
      const all = opts.map((o) => q(o.name)).join(', ')
      if (prop.type !== 'multi_select' && wanted.length > 1) throw new ToolInputError(`${q(prop.name)} (${prop.type}): only one option allowed, got ${wanted.length}. Options: ${all}.`)
      const final: string[] = []
      const fresh: string[] = []
      for (const name of wanted) {
        const hit = opts.find((o) => o.id === name || o.name.trim().toLowerCase() === name.toLowerCase())
        if (!hit && prop.type === 'status') throw new ToolInputError(`${q(prop.name)} (status): unknown status ${q(name)}. Use one of: ${all}.`)
        if (!hit && db.locked) throw new ToolInputError(`${q(prop.name)}: unknown option ${q(name)} — the database is locked, so no new options can be created. Use one of: ${all}.`)
        const n = hit?.name ?? name.slice(0, 60)
        if (final.some((x) => x.toLowerCase() === n.toLowerCase())) continue
        if (!hit) fresh.push(n)
        final.push(n)
      }
      out.push({ ...base, after: final.join(', '), intent: { kind: 'options', names: final }, ...(fresh.length ? { newOptions: fresh } : {}) })
      continue
    }
    let value: unknown
    try {
      value = coerce(prop, friendlyIn(r, prop, raw, ctx), ctx)
    } catch (e) {
      if (!(e instanceof ValueError)) throw e
      throw new ToolInputError(`${e.message}${e.allowed?.length ? ` (allowed: ${e.allowed.slice(0, 50).join(', ')})` : ''}`)
    }
    if (prop.type === 'date' && isObj(value) && value.end === null) {
      const { end: _end, ...rest } = value
      value = rest
    }
    const after = valueText(prop, { id: row?.id ?? '', createdAt: 0, updatedAt: 0, createdBy: null, updatedBy: null, properties: { [prop.id]: value } }, ctx)
    out.push({ ...base, after, intent: { kind: 'value', value } })
  }
  return out
}

/** Later values for the same property replace earlier ones (a staged row updated again). */
export function mergeProps(prev: PropChange[] | undefined, next: PropChange[]): PropChange[] {
  const out = [...(prev ?? [])]
  for (const c of next) {
    const i = out.findIndex((x) => x.propId === c.propId)
    if (i >= 0) out[i] = { ...c, before: out[i]!.before }
    else out.push(c)
  }
  return out
}

/** Staged property changes → the row input the write path takes (option names, stored values by id). */
export function propsInput(props: PropChange[] | undefined): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const c of props ?? []) {
    if (c.intent.kind === 'options') out[c.propId] = c.type === 'multi_select' ? c.intent.names : (c.intent.names[0] ?? null)
    else out[c.propId] = c.intent.value
  }
  return out
}

/** Write one staged change (attributed to the agent). Throws ApiError / Error with a readable message. */
export async function applyChange(model: WorkspaceModel, writes: McpWrites, wsId: string, change: StagedChange, actor: string): Promise<void> {
  switch (change.kind) {
    case 'create_page':
      await model.createPage(wsId, { id: change.pageId, parentId: change.parentId ?? null, title: change.title ?? '', content: change.markdown }, actor)
      return
    case 'append':
      await writes.updatePage(wsId, { id: change.pageId, markdown: change.markdown ?? '', mode: 'append' }, actor)
      return
    case 'rename':
      await writes.updatePage(wsId, { id: change.pageId, title: change.title ?? '', mode: 'append' }, actor)
      return
    case 'create_row': {
      if (!change.databaseId) throw new Error('the staged row names no database')
      const row = await writes.prepareRow(wsId, { databaseId: change.databaseId }, { title: change.title, properties: propsInput(change.props) }, actor)
      await model.createRow(wsId, change.databaseId, { title: row.title ?? change.title ?? '', properties: row.properties, content: change.markdown }, actor, { id: change.pageId })
      return
    }
    case 'update_row': {
      const row = await writes.prepareRow(wsId, { rowId: change.pageId }, { properties: propsInput(change.props) }, actor)
      await model.updateRow(wsId, change.pageId, { title: row.title, properties: row.properties }, actor)
      return
    }
  }
}

/**
 * Apply a run's pending changes (all, or those named), in review order. A change whose parent page is
 * staged too waits for it: when the parent is not applied (failed, discarded, not chosen), it fails.
 * Returns how many were written.
 */
export async function applyStaged(model: WorkspaceModel, writes: McpWrites, wsId: string, staged: StagedChange[], actor: string, only: Set<string> | null): Promise<number> {
  let applied = 0
  const byId = new Map(staged.map((c) => [c.id, c]))
  for (const change of [...staged].sort((a, b) => a.n - b.n)) {
    if (change.status !== 'pending' || (only && !only.has(change.id))) continue
    const parent = change.dependsOn ? byId.get(change.dependsOn) : undefined
    if (parent && parent.status !== 'applied') {
      change.status = 'failed'
      change.error = `Its parent page (#${parent.n}) was not applied.`
      continue
    }
    try {
      await applyChange(model, writes, wsId, change, actor)
      change.status = 'applied'
      delete change.error
      applied++
    } catch (err) {
      change.status = 'failed'
      change.error = (err instanceof ApiError ? explain(err) : 'The change could not be written.').slice(0, 500)
    }
  }
  return applied
}

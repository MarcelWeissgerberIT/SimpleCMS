/**
 * AI autofill — what Claude gets for one row, and a fingerprint of it.
 *
 * Context: title, the other properties as display text, the page content (as Markdown, cut to
 * ~8k characters by the features area). Translate only sends its source.
 * Fingerprint: the inputs a fill depends on — title, content and the *stored* values of the other
 * properties, minus computed ones (formulas can read now()) and minus every autofilled property, so
 * two autofilled properties that read each other can never trigger each other in a loop.
 */
import type { AutofillConfig, Database, Page, PropertyDef } from '../../store/types'
import type { AutofillField, AutofillRequest, AutofillTask } from '../../features'
import { plainText } from '../../store/store'
import { propertyValueToText } from '../values'
import { isComputed } from '../model/schema'
import { autofillOf, translateTarget } from './config'

/** Same as features' AUTOFILL_CONTENT_MAX (kept here so the estimate needs no import). */
export const CONTENT_MAX = 8000

/** cyrb53: small, fast, good-enough string hash (53 bits) → base36. */
export function hashString(str: string, seed = 0): string {
  let h1 = 0xdeadbeef ^ seed
  let h2 = 0x41c6ce57 ^ seed
  for (let i = 0; i < str.length; i++) {
    const ch = str.charCodeAt(i)
    h1 = Math.imul(h1 ^ ch, 2654435761)
    h2 = Math.imul(h2 ^ ch, 1597334677)
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909)
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909)
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36)
}

/** Translate source: a property (title included) or the page content. */
function sourceOf(db: Database, prop: PropertyDef, cfg: AutofillConfig): PropertyDef | 'content' {
  if (cfg.source === 'content') return 'content'
  const p = db.properties.find((x) => x.id === cfg.source && x.id !== prop.id)
  return p ?? db.properties.find((x) => x.type === 'title') ?? 'content'
}

/** Fingerprint of everything a fill of `prop` on `row` depends on. */
export function rowHash(db: Database, prop: PropertyDef, row: Page, cfg: AutofillConfig | null = autofillOf(prop)): string {
  if (cfg?.preset === 'translate') {
    const src = sourceOf(db, prop, cfg)
    if (src === 'content') return hashString(JSON.stringify(row.content ?? null))
    return hashString(src.type === 'title' ? row.title : JSON.stringify(row.properties[src.id] ?? null))
  }
  const parts: unknown[] = [row.title, row.content ?? null]
  for (const p of db.properties) {
    if (p.id === prop.id || p.type === 'title' || isComputed(p) || autofillOf(p)) continue
    parts.push(p.id, row.properties[p.id] ?? null)
  }
  return hashString(JSON.stringify(parts))
}

/** Approximate size of the context in characters (for the cost estimate). */
export function contextChars(db: Database, prop: PropertyDef, row: Page, cfg: AutofillConfig): number {
  const contentChars = (r: Page) => Math.min(CONTENT_MAX, Math.round((r.plain ?? plainText(r.content)).length * 1.15))
  if (cfg.preset === 'translate') {
    const src = sourceOf(db, prop, cfg)
    if (src === 'content') return contentChars(row)
    return (src.type === 'title' ? row.title : propertyValueToText(db, src, row)).length + 20
  }
  let n = row.title.length + 40
  for (const p of db.properties) {
    if (p.id === prop.id || p.type === 'title') continue
    n += p.name.length + propertyValueToText(db, p, row).length + 4
  }
  return n + contentChars(row)
}

function fieldOf(prop: PropertyDef, cfg: AutofillConfig): AutofillField {
  return {
    name: prop.name,
    type: prop.type as AutofillField['type'],
    options: prop.type === 'select' || prop.type === 'multi_select' ? (prop.options ?? []).map((o) => o.name) : undefined,
    allowNew: (prop.type === 'select' || prop.type === 'multi_select') && !!cfg.allowNewOptions,
    numberFormat: prop.numberFormat,
    description: prop.description,
  }
}

/** The request for one row plus the fingerprint of what it was built from. */
export function buildRequest(db: Database, prop: PropertyDef, row: Page, cfg: AutofillConfig): { request: AutofillRequest; hash: string } {
  const task: AutofillTask = { preset: cfg.preset, instruction: cfg.prompt, language: cfg.preset === 'translate' ? translateTarget(cfg) : undefined }
  if (cfg.preset === 'translate') {
    const src = sourceOf(db, prop, cfg)
    task.source =
      src === 'content'
        ? { name: 'Content', content: row.content ?? null }
        : { name: src.name, text: src.type === 'title' ? row.title : propertyValueToText(db, src, row) }
  }
  const properties: Array<{ name: string; value: string }> = []
  for (const p of db.properties) {
    if (p.id === prop.id || p.type === 'title' || p.type === 'files') continue
    const value = propertyValueToText(db, p, row)
    if (value.trim()) properties.push({ name: p.name, value })
  }
  return {
    request: { field: fieldOf(prop, cfg), task, row: { title: row.title, properties, content: row.content ?? null } },
    hash: rowHash(db, prop, row, cfg),
  }
}

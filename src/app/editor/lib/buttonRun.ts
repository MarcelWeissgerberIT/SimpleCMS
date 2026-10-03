/**
 * Button runtime: runs a button's actions in order and reports what happened in one toast.
 *   insert_blocks · add_page · edit_properties · webhook · open · message
 * Webhooks go through lib/webhook.ts like the database automations (JSON + CORS first; on a
 * network/CORS failure one no-cors text/plain retry, reported as "unconfirmed", never as success).
 * Every body carries a `deliveryId`, the same in both attempts.
 */
import type { Editor, JSONContent } from '@tiptap/core'
import { Fragment, type Node as PMNode } from '@tiptap/pm/model'
import { useWorkspace } from '../../store/store'
import { toast, useUI } from '../../store/ui'
import { isEffectivelyTrashed } from '../../store/selectors'
import type { Database, DateValue, ID, Page, PropertyDef, PropertyValue } from '../../store/types'
import { navigate, openPage } from '../../lib/router'
import { t } from '../../i18n'
import { docToMarkdown, sanitize } from '../convert'
import { flashKey } from '../extensions/behaviors'
import { BLOCK_ID_TYPES } from '../schema/base'
import type { ButtonAction, PropertyPreset } from '../schema/button'
import { isWebhookUrl, postWebhook } from '../../lib/webhook'
import { safeHref } from './embeds'

/* ------------------------------------------------------------------ */
/* Fresh buttons (inserted from the slash menu → open their settings) */
/* ------------------------------------------------------------------ */

/*
 * Keyed by editor + a short time window, not by block id: UniqueID hands the id of an empty node
 * to the line created after it, so the inserted button ends up with a fresh id.
 */
let fresh: { editor: Editor; until: number } | null = null
export const markFreshButton = (editor: Editor) => void (fresh = { editor, until: Date.now() + 1500 })
/** True once, for the first unconfigured button mounted in that editor right after the insert. */
export function consumeFreshButton(editor: Editor, configured: boolean): boolean {
  if (!fresh || fresh.editor !== editor || configured || Date.now() > fresh.until) return false
  fresh = null
  return true
}

/* ------------------------------------------------------------------ */
/* Variables: {{date}} {{time}} {{user}}                               */
/* ------------------------------------------------------------------ */

export const VARIABLES = ['{{date}}', '{{time}}', '{{user}}'] as const

export function fillVars(text: string, now = new Date()): string {
  if (!text.includes('{{')) return text
  const { settings } = useWorkspace.getState()
  const locale = settings.language === 'de' ? 'de-DE' : 'en-US'
  return text.replace(/\{\{\s*(date|time|user)\s*\}\}/gi, (_m, key: string) => {
    const k = key.toLowerCase()
    if (k === 'date') return new Intl.DateTimeFormat(locale, { year: 'numeric', month: 'short', day: 'numeric' }).format(now)
    if (k === 'time') return new Intl.DateTimeFormat(locale, { hour: '2-digit', minute: '2-digit' }).format(now)
    return settings.userName.trim() || t('editor.button.var.me')
  })
}

const isEmptyPara = (n: JSONContent) => n.type === 'paragraph' && !(n.content ?? []).length

/** Template blocks as stored: no nested buttons, no trailing empty lines. */
export function cleanTemplate(content: JSONContent[]): JSONContent[] {
  const strip = (list: JSONContent[]): JSONContent[] => list.filter((n) => n.type !== 'button').map((n) => (n.content ? { ...n, content: strip(n.content) } : n))
  const out = strip(content)
  while (out.length && isEmptyPara(out[out.length - 1])) out.pop()
  return out
}

/** Nodes whose `id` attribute is a block id (UniqueID) — mentions keep theirs: it is their target. */
const BLOCK_IDS = new Set<string>(BLOCK_ID_TYPES)

/** Template → blocks to insert: variables filled, block ids dropped (fresh ones are assigned). */
function instantiate(content: JSONContent[], now: Date): JSONContent[] {
  const walk = (n: JSONContent): JSONContent | null => {
    if (n.type === 'button') return null
    const out: JSONContent = { ...n }
    if (n.type && BLOCK_IDS.has(n.type) && out.attrs && 'id' in out.attrs) out.attrs = { ...out.attrs, id: null }
    if (typeof out.text === 'string') {
      out.text = fillVars(out.text, now)
      if (!out.text) return null
    }
    if (out.content) out.content = out.content.map(walk).filter((c): c is JSONContent => !!c)
    return out
  }
  return cleanTemplate(content)
    .map(walk)
    .filter((c): c is JSONContent => !!c)
}

/* ------------------------------------------------------------------ */
/* Property presets                                                    */
/* ------------------------------------------------------------------ */

/** Property types a button can preset / edit. */
export const SETTABLE_TYPES = new Set<PropertyDef['type']>(['select', 'status', 'checkbox', 'date', 'text', 'number', 'url', 'email', 'phone'])
const TEXTUAL = new Set<PropertyDef['type']>(['text', 'url', 'email', 'phone'])

const pad = (n: number) => String(n).padStart(2, '0')

export function resolvePreset(prop: PropertyDef, value: PropertyValue, current: PropertyValue | undefined, now: Date): PropertyValue {
  const day = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
  if (value === '@today') return { start: day }
  if (value === '@now') return { start: `${day}T${pad(now.getHours())}:${pad(now.getMinutes())}`, includeTime: true }
  if (value === '@toggle') return !current
  if (typeof value === 'string' && TEXTUAL.has(prop.type)) return fillVars(value, now)
  return value
}

/** Apply presets of a database: returns the property values, or the reason they can't be applied. */
function presetValues(db: Database, presets: PropertyPreset[], row: Page | null, now: Date): { values: Record<ID, PropertyValue> } | { error: string } {
  const values: Record<ID, PropertyValue> = {}
  for (const p of presets) {
    const prop = db.properties.find((d) => d.id === p.propertyId)
    if (!prop || !SETTABLE_TYPES.has(prop.type)) return { error: t('editor.button.err.prop') }
    if ((prop.type === 'select' || prop.type === 'status') && p.value && !prop.options?.some((o) => o.id === p.value)) return { error: t('editor.button.err.option', { name: prop.name }) }
    values[prop.id] = resolvePreset(prop, p.value, row?.properties[prop.id], now)
  }
  return { values }
}

/* ------------------------------------------------------------------ */
/* Webhook                                                             */
/* ------------------------------------------------------------------ */

export interface ButtonWebhookPayload {
  event: 'button_clicked'
  button: { label: string }
  page: { id: ID; title: string; url: string; properties: Record<string, string>; markdown: string }
  timestamp: string
  source: 'simplecms-one'
  /** added when sent (lib/webhook.ts): the same for a request and its no-cors retry */
  deliveryId?: string
}

function rawText(value: PropertyValue | undefined): string {
  if (value == null) return ''
  if (Array.isArray(value)) return value.join(', ')
  if (typeof value === 'object') return (value as DateValue).end ? `${(value as DateValue).start} → ${(value as DateValue).end}` : (value as DateValue).start
  return String(value)
}

async function buildPayload(ctx: RunContext): Promise<ButtonWebhookPayload> {
  const s = useWorkspace.getState()
  const page = ctx.pageId ? s.pages[ctx.pageId] : undefined
  const properties: Record<string, string> = {}
  const db = page?.databaseId ? s.databases[page.databaseId] : undefined
  if (page && db) {
    const api = await import('../../database').catch(() => null)
    for (const p of db.properties) {
      if (p.type === 'title') {
        properties[p.name] = page.title
        continue
      }
      try {
        properties[p.name] = api ? api.propertyValueToText(db, p, page) : rawText(page.properties[p.id])
      } catch {
        properties[p.name] = rawText(page.properties[p.id])
      }
    }
  }
  let content: JSONContent | null = page?.content ?? null
  try {
    if (!ctx.editor.isDestroyed) content = ctx.editor.getJSON()
  } catch {
    /* keep the stored content */
  }
  const id = page?.id ?? ctx.pageId ?? ''
  return {
    event: 'button_clicked',
    button: { label: ctx.label },
    page: { id, title: page?.title ?? '', url: `${window.location.origin}${window.location.pathname}#/p/${id}`, properties, markdown: docToMarkdown(content) },
    timestamp: new Date().toISOString(),
    source: 'simplecms-one',
  }
}

/**
 * Through the shared helper (lib/webhook.ts; the payload gets a `deliveryId`). A no-cors send is
 * "unconfirmed": not an error, but never reported as a success either.
 */
async function sendWebhook(url: string, method: 'POST' | 'PUT', payload: object): Promise<{ ok: boolean; unconfirmed?: boolean; message: string }> {
  if (!isWebhookUrl(url)) return { ok: false, message: t('editor.button.err.url') }
  const res = await postWebhook(url, method, payload, { timeoutMs: 10_000 })
  switch (res.outcome) {
    case 'unconfirmed':
      return { ok: true, unconfirmed: true, message: t('editor.button.res.opaque') }
    case 'delivered':
      return { ok: true, message: `${res.status} ${res.statusText || 'OK'}`.trim() }
    default:
      if (res.error === 'timeout') return { ok: false, message: t('editor.button.err.timeout') }
      if (res.error === 'url') return { ok: false, message: t('editor.button.err.url') }
      if (res.error === 'network') return { ok: false, message: t('editor.button.err.network', { msg: res.detail ?? '' }) }
      return { ok: false, message: `${res.status} ${res.statusText}`.trim() }
  }
}

/* ------------------------------------------------------------------ */
/* Running                                                             */
/* ------------------------------------------------------------------ */

export interface RunContext {
  editor: Editor
  /** Position of the button node (node view getPos). */
  getPos: () => number | undefined
  label: string
  actions: ButtonAction[]
  /** The page the button lives on. */
  pageId: string | null
}

interface Step {
  ok: boolean
  /** sent, but delivery can't be confirmed (webhook without CORS) — no success toast */
  unconfirmed?: boolean
  text: string
  /** said elsewhere already (the message toast itself) */
  quiet?: boolean
  rowId?: ID
}

const fail = (text: string): Step => ({ ok: false, text })
const plural = (key: string, count: number, vars: Record<string, string | number> = {}) => t(count === 1 ? `${key}.one` : key, { count, ...vars })

function insertBlocks(ctx: RunContext, content: JSONContent[], now: Date): Step {
  const { editor } = ctx
  if (editor.isDestroyed) return fail(t('editor.button.err.gone'))
  if (!editor.isEditable) return fail(t('editor.button.err.locked'))
  const blocks = instantiate(content, now)
  if (!blocks.length) return fail(t('editor.button.err.empty'))
  const pos = ctx.getPos()
  const self = typeof pos === 'number' ? editor.state.doc.nodeAt(pos) : null
  if (typeof pos !== 'number' || !self || self.type.name !== 'button') return fail(t('editor.button.err.gone'))
  let nodes: PMNode[]
  try {
    const valid = sanitize({ type: 'doc', content: blocks })
    nodes = (valid.content ?? []).map((c) => editor.schema.nodeFromJSON(c))
  } catch {
    return fail(t('editor.button.err.invalid'))
  }
  const at = pos + self.nodeSize
  const tr = editor.state.tr.insert(at, Fragment.from(nodes))
  // a short flash on the first new block shows where it went (no scrolling: it is right below)
  tr.setMeta(flashKey, { pos: at })
  editor.view.dispatch(tr)
  window.setTimeout(() => {
    if (!editor.isDestroyed) editor.view.dispatch(editor.state.tr.setMeta(flashKey, null).setMeta('addToHistory', false))
  }, 1600)
  return { ok: true, text: plural('editor.button.res.inserted', nodes.length) }
}

function addPage(a: Extract<ButtonAction, { type: 'add_page' }>, now: Date): Step {
  if (!a.databaseId) return fail(t('editor.button.err.noDb'))
  const s = useWorkspace.getState()
  const db = s.databases[a.databaseId]
  const dbPage = s.pages[a.databaseId]
  if (!db || !dbPage || isEffectivelyTrashed(s.pages, a.databaseId)) return fail(t('editor.button.err.dbMissing'))
  const preset = presetValues(db, a.values, null, now)
  if ('error' in preset) return fail(preset.error)
  const title = fillVars(a.title, now).trim()
  const id = s.createRow(db.id, { title, properties: preset.values })
  if (a.open) useUI.getState().openPeek(id)
  return { ok: true, text: t('editor.button.res.added', { title: title || t('common.untitled'), db: dbPage.title.trim() || t('common.untitled') }), rowId: a.open ? undefined : id }
}

function editProperties(ctx: RunContext, a: Extract<ButtonAction, { type: 'edit_properties' }>, now: Date): Step {
  const s = useWorkspace.getState()
  const page = ctx.pageId ? s.pages[ctx.pageId] : undefined
  const db = page?.databaseId ? s.databases[page.databaseId] : undefined
  if (!page || !db) return fail(t('editor.button.err.notRow'))
  if (!a.values.length) return fail(t('editor.button.err.noValues'))
  const preset = presetValues(db, a.values, page, now)
  if ('error' in preset) return fail(preset.error)
  for (const [propId, value] of Object.entries(preset.values)) useWorkspace.getState().setRowProperty(page.id, propId, value)
  return { ok: true, text: plural('editor.button.res.edited', Object.keys(preset.values).length) }
}

function openTarget(a: Extract<ButtonAction, { type: 'open' }>): Step {
  if (a.pageId) {
    const s = useWorkspace.getState()
    const p = s.pages[a.pageId]
    if (!p || isEffectivelyTrashed(s.pages, a.pageId)) return fail(t('editor.button.err.pageMissing'))
    openPage(a.pageId)
    return { ok: true, text: t('editor.button.res.opened', { target: p.title.trim() || t('common.untitled') }) }
  }
  const href = safeHref(a.url)
  if (!href) return fail(t('editor.button.err.target'))
  if (href.startsWith('#')) navigate(href)
  else window.open(href, '_blank', 'noopener,noreferrer')
  return { ok: true, text: t('editor.button.res.opened', { target: href.replace(/^https?:\/\//, '').replace(/\/$/, '') }) }
}

async function runAction(ctx: RunContext, a: ButtonAction, now: Date): Promise<Step> {
  switch (a.type) {
    case 'insert_blocks':
      return insertBlocks(ctx, a.content, now)
    case 'add_page':
      return addPage(a, now)
    case 'edit_properties':
      return editProperties(ctx, a, now)
    case 'webhook': {
      const res = await sendWebhook(a.url, a.method, await buildPayload(ctx))
      return { ok: res.ok, unconfirmed: res.unconfirmed, text: t('editor.button.res.webhook', { method: a.method, status: res.message }) }
    }
    case 'open':
      return openTarget(a)
    case 'message':
      toast({ message: fillVars(a.text, now).trim() || ctx.label, kind: 'info' })
      return { ok: true, text: '', quiet: true }
  }
}

/** Run every action in order (a failing action doesn't stop the next ones). Returns true when all succeeded. */
export async function runButton(ctx: RunContext): Promise<boolean> {
  const now = new Date()
  const steps: Step[] = []
  for (const a of ctx.actions) {
    try {
      steps.push(await runAction(ctx, a, now))
    } catch (err) {
      steps.push(fail((err as Error)?.message || String(err)))
    }
  }
  const ok = steps.every((s) => s.ok)
  const said = steps.filter((s) => !s.quiet && s.text)
  if (!said.length && ok) return ok
  const rowId = steps.find((s) => s.rowId)?.rowId
  toast({
    message: `${ctx.label} · ${said.map((s) => (s.ok ? s.text : `✕ ${s.text}`)).join(' · ')}`,
    kind: !ok ? 'error' : steps.some((s) => s.unconfirmed) ? 'info' : 'success',
    action: rowId ? { label: t('common.open'), run: () => useUI.getState().openPeek(rowId) } : undefined,
    timeout: ok ? undefined : 7000,
  })
  return ok
}

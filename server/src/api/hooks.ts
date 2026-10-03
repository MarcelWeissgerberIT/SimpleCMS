/**
 * Incoming webhooks (docs/API.md § Incoming webhooks): POST /api/v1/hooks/<secret> creates a row in
 * the hook's database. Made for Zapier / Make / n8n / forms: no headers needed (the secret is the
 * path), JSON, form-encoded or plain text, lenient mapping — nothing in the payload is lost.
 */
import { type Context, Hono } from 'hono'
import type { AppEnv, Services } from '../context.ts'
import { badRequest, notFound, rateLimited } from '../errors.ts'
import { isTokenShape, MINUTE } from '../tokens.ts'
import type { WebhookRow } from '../repo.ts'
import { failedAttempt, idempotent } from './auth.ts'
import { keyValueList, markdownToNodes, type Node } from './content.ts'
import { liveDatabase, type PropertyDef } from './meta.ts'
import { findProperty, type ResolvedRow, type WorkspaceModel } from './model.ts'
import { READ_ONLY_TYPES, ValueError, coerce, schemaOut, type ValueContext } from './values.ts'

type Payload = Record<string, unknown>

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

/** Keys never treated as data. */
const META_KEYS = new Set(['deliveryid'])

export function hookRoutes(s: Services, model: WorkspaceModel) {
  const app = new Hono<AppEnv>()

  const load = (c: Context<AppEnv>): WebhookRow => {
    const secret = c.req.param('secret')
    const hook = isTokenShape(secret) ? s.repo.webhookBySecret(secret) : undefined
    if (!hook) throw failedAttempt(s, c, notFound('hook_not_found', 'This webhook URL does not exist (deleted or regenerated)'))
    const wait = s.limiter.hit(`api:hook:${hook.id}`, s.config.apiRateLimit, MINUTE)
    if (wait) throw rateLimited(wait)
    return hook
  }

  /** What the URL writes into — handy to check a URL, and for tools that map fields. */
  app.get('/:secret', async (c) => {
    const hook = load(c)
    return c.json(
      await model.read(hook.workspace_id, (r) => {
        const db = liveDatabase(r, hook.database_id)
        if (!db) throw notFound('database_not_found', 'The database of this webhook no longer exists')
        return { database: { id: db.page.id, title: db.page.title }, properties: db.properties.map(schemaOut) }
      }),
    )
  })

  app.post('/:secret', async (c) => {
    const hook = load(c)
    const payload = await readPayload(c)
    const delivery = typeof payload.deliveryId === 'string' ? payload.deliveryId : null
    const key = c.req.header('idempotency-key') ?? delivery
    const res = await idempotent(s, c, `hook:${hook.id}`, key, hook.workspace_id, async () => {
      const row = await model.read(hook.workspace_id, (r) => {
        const db = liveDatabase(r, hook.database_id)
        if (!db) throw notFound('database_not_found', 'The database of this webhook no longer exists')
        return mapPayload(db.properties, payload, model.context(hook.workspace_id, r))
      })
      const created = await model.insertRow(hook.workspace_id, hook.database_id, row, `hook:${hook.id}`)
      return { status: 201 as const, body: created }
    })
    if (res.status === 201) s.repo.recordDelivery(hook.id)
    return res
  })

  return app
}

/* ------------------------------------------------------------------ payload */

async function readPayload(c: Context<AppEnv>): Promise<Payload> {
  const type = (c.req.header('content-type') ?? '').split(';')[0]?.trim().toLowerCase() ?? ''
  if (type === 'application/x-www-form-urlencoded' || type === 'multipart/form-data') {
    let form: Record<string, unknown>
    try {
      form = await c.req.parseBody({ all: true })
    } catch {
      throw badRequest('invalid_payload', 'The form data could not be read')
    }
    const out: Payload = {}
    for (const [k, v] of Object.entries(form)) out[k] = Array.isArray(v) ? v.map(formValue) : formValue(v)
    return out
  }
  const text = await c.req.text()
  if (!text.trim()) return {}
  let value: unknown
  try {
    value = JSON.parse(text)
  } catch {
    if (type.includes('json')) throw badRequest('invalid_json', 'Request body is not valid JSON')
    // plain text: the first line is the title, all of it the content
    const first = text.trim().split('\n')[0]?.trim().slice(0, 200) ?? ''
    return { title: first, content: text }
  }
  if (!isObj(value)) throw badRequest('invalid_payload', 'Send a JSON object (or form fields)')
  return value
}

const formValue = (v: unknown): unknown => (typeof v === 'string' ? v : v instanceof File ? `${v.name} (file not stored)` : String(v))

/**
 * One's own outgoing webhooks (database automations, buttons) send an envelope with `row` / `page`:
 * map their title, properties and markdown, and leave the envelope out.
 */
function unwrapOne(p: Payload): Payload {
  if (p.source !== 'simplecms-one') return p
  const inner = isObj(p.row) ? p.row : isObj(p.page) ? p.page : null
  if (!inner) return p
  return {
    ...(typeof inner.title === 'string' ? { title: inner.title } : {}),
    ...(isObj(inner.properties) ? inner.properties : {}),
    ...(typeof inner.markdown === 'string' && inner.markdown.trim() ? { content: inner.markdown } : {}),
    ...(typeof p.deliveryId === 'string' ? { deliveryId: p.deliveryId } : {}),
  }
}

const asText = (v: unknown): string => {
  if (v === null || v === undefined) return ''
  if (typeof v === 'string') return v
  if (typeof v === 'number' || typeof v === 'boolean') return String(v)
  const json = JSON.stringify(v)
  return json.length > 2000 ? `${json.slice(0, 2000)}…` : json
}

/**
 * Lenient mapping: keys match property names (or ids) case-insensitively; `title` / `name` give the
 * title (else the first string value, else "Webhook <date>"); `content` is markdown content. Keys
 * without a property and values that don't fit are appended to the content as "key: value".
 */
export function mapPayload(props: PropertyDef[], raw: Payload, ctx: ValueContext): ResolvedRow {
  const payload = unwrapOne(raw)
  const values: Record<string, unknown> = {}
  const extras: Array<[string, string]> = []
  let title: string | undefined
  let content: string | undefined
  let firstString: string | undefined
  for (const [key, value] of Object.entries(payload)) {
    const k = key.trim().toLowerCase()
    if (META_KEYS.has(k)) continue
    if (firstString === undefined && typeof value === 'string' && value.trim()) firstString = value.trim()
    const prop = findProperty(props, key)
    if (prop?.type === 'title' || (!prop && (k === 'title' || k === 'name'))) {
      if (title === undefined && value !== null && value !== undefined) title = asText(value).trim()
      else extras.push([key, asText(value)])
      continue
    }
    if (!prop) {
      if (k === 'content' && typeof value === 'string') content = value
      else extras.push([key, asText(value)])
      continue
    }
    if (READ_ONLY_TYPES.has(prop.type)) {
      extras.push([key, asText(value)])
      continue
    }
    try {
      values[prop.id] = coerce(prop, value, ctx)
    } catch (e) {
      if (!(e instanceof ValueError)) throw e
      extras.push([key, asText(value)])
    }
  }
  const nodes: Node[] = [...(content?.trim() ? markdownToNodes(content) : []), ...keyValueList(extras)]
  return {
    title: (title || firstString || `Webhook ${new Date().toISOString().slice(0, 16).replace('T', ' ')}`).slice(0, 2000),
    values,
    nodes: nodes.length ? nodes : null,
  }
}

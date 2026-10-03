/**
 * "Copy as n8n workflow": a two-node workflow that pastes straight onto an n8n canvas —
 * a Webhook trigger that accepts this database's payload (CORS open, so the browser can POST
 * JSON directly) and a Set node that unpacks the row into named fields.
 */
import type { ID } from '../../store/types'
import { useWorkspace } from '../../store/store'
import { slugify } from '../io/export/collect'

const WEBHOOK = 'SimpleCMS One'
const FIELDS = 'Row fields'

const uuid = () =>
  typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
        const r = (Math.random() * 16) | 0
        return (c === 'x' ? r : (r & 0x3) | 0x8).toString(16)
      })

/** A property name as a single-quoted JS string inside an n8n expression. */
const quoted = (name: string) => `'${name.replace(/\\/g, '\\\\').replace(/'/g, "\\'")}'`

export interface N8nWorkflow {
  name: string
  nodes: Array<Record<string, unknown>>
  connections: Record<string, { main: Array<Array<{ node: string; type: 'main'; index: number }>> }>
  settings: Record<string, unknown>
}

export function n8nWorkflow(databaseId: ID): N8nWorkflow {
  const { pages, databases } = useWorkspace.getState()
  const db = databases[databaseId]
  const title = pages[databaseId]?.title.trim() || 'Database'
  // slugify() falls back to "one" for titles without latin letters
  const slug = slugify(title)
  const path = `simplecms-${slug === 'one' && !/one/i.test(title) ? 'database' : slug}`

  const assign = (name: string, expr: string) => ({ id: uuid(), name, value: `={{ ${expr} }}`, type: 'string' })
  const assignments = [assign('title', '$json.body.row.title')]
  const taken = new Set(['title', 'event', 'url'])
  for (const p of db?.properties ?? []) {
    if (p.type === 'title' || taken.has(p.name.toLowerCase())) continue
    taken.add(p.name.toLowerCase())
    assignments.push(assign(p.name, `$json.body.row.properties[${quoted(p.name)}]`))
  }
  assignments.push(assign('event', '$json.body.event'), assign('url', '$json.body.row.url'))

  return {
    name: `SimpleCMS One · ${title}`,
    nodes: [
      {
        parameters: {
          httpMethod: 'POST',
          path,
          // "Allowed Origins (CORS)": the app POSTs JSON straight from the browser
          options: { allowedOrigins: '*' },
        },
        type: 'n8n-nodes-base.webhook',
        typeVersion: 2,
        position: [0, 0],
        id: uuid(),
        name: WEBHOOK,
        webhookId: uuid(),
      },
      {
        parameters: { assignments: { assignments }, options: {} },
        type: 'n8n-nodes-base.set',
        typeVersion: 3.4,
        position: [260, 0],
        id: uuid(),
        name: FIELDS,
      },
    ],
    connections: { [WEBHOOK]: { main: [[{ node: FIELDS, type: 'main', index: 0 }]] } },
    settings: { executionOrder: 'v1' },
  }
}

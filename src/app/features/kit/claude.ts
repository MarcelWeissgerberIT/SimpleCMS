/**
 * "Fill with Claude" for a shared list: one structured request with the person's prompt — and, only when
 * they picked one, what Claude may read of a page (readableContent: its context marks apply). Nothing
 * else of the workspace goes out (no memory, MCP servers only those set to "All AI calls"). Claude
 * proposes items; the person ticks which ones are added.
 */
import { readableContent } from '../../editor'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'
import { completeStructured } from '../ai/client'

const SYSTEM = `You fill a shared option list in One, a notes and database app. Lists hold the choices of select properties: short names, one per item (e.g. "Bavaria", "EUR", "4711 Marketing").
Rules:
- Answer with the items the person asks for, in a sensible order (the usual order of the domain, else alphabetical).
- Each name is short (1–6 words), without numbering, bullets or explanations. No duplicates.
- Use the language of the request unless names are codes or proper names.
- When a page text is given, take the items from it — never invent items that are not there.
- At most 300 items. Colours: one of default, gray, brown, orange, yellow, green, blue, purple, pink, red — only when they help (e.g. traffic lights); otherwise "default".`

const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['items'],
  properties: {
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name', 'color'],
        properties: {
          name: { type: 'string' },
          color: { type: 'string', enum: ['default', 'gray', 'brown', 'orange', 'yellow', 'green', 'blue', 'purple', 'pink', 'red'] },
        },
      },
    },
  },
}

export interface Proposal {
  name: string
  color: string
}

const MAX_PAGE = 40_000

/** The page text Claude may read for a list (context marks apply): '' when nothing. */
export function pageTextFor(pageId: ID | null): string {
  if (!pageId) return ''
  return readableContent(pageId).markdown.slice(0, MAX_PAGE)
}

/** Ask Claude for items. `existing`: names already in the list (left out of the answer). */
export async function proposeItems(o: { prompt: string; listName: string; existing: string[]; pageId?: ID | null; signal?: AbortSignal }): Promise<Proposal[]> {
  const page = pageTextFor(o.pageId ?? null)
  const title = o.pageId ? useWorkspace.getState().pages[o.pageId]?.title.trim() || 'Untitled' : ''
  const parts = [`List: ${o.listName || 'Untitled list'}`, `Request: ${o.prompt.trim()}`]
  if (o.existing.length) parts.push(`Already in the list (do not repeat): ${o.existing.slice(0, 200).join(' · ')}`)
  if (page) parts.push(`Page "${title}":\n<page>\n${page}\n</page>`)
  const raw = await completeStructured({ system: SYSTEM, prompt: parts.join('\n\n'), schema: SCHEMA, maxTokens: 6000, signal: o.signal })
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return []
  }
  const items = (parsed as { items?: unknown })?.items
  if (!Array.isArray(items)) return []
  const seen = new Set(o.existing.map((n) => n.trim().toLowerCase()))
  const out: Proposal[] = []
  for (const it of items.slice(0, 300)) {
    const name = typeof it?.name === 'string' ? it.name.replace(/\s+/g, ' ').trim().slice(0, 200) : ''
    if (!name || seen.has(name.toLowerCase())) continue
    seen.add(name.toLowerCase())
    out.push({ name, color: typeof it?.color === 'string' ? it.color : 'default' })
  }
  return out
}

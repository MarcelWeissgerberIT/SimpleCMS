/**
 * Private pages (docs/CLOUD.md § Private pages) — helpers that keep what only one member can see out
 * of the workspace's shared documents:
 *  - page mentions carry a `label` (the title when it was mentioned) and `plain` (the search excerpt
 *    every member gets) spells mentions out as `@label`: a mention of a page another member can't
 *    see must not carry its title into a shared page;
 *  - file references (`onefile:<id>`) of moved / shared pages, for publishing private uploads.
 */
import type { JSONContent } from '@tiptap/core'
import { plainText } from '../store/store'
import type { ID, Page } from '../store/types'

const FILE_RE = /onefile:([A-Za-z0-9_-]{1,64})/g

/**
 * `json` without the labels of page mentions whose page is `hidden` (private here, or missing — then
 * it is someone else's private page, or deleted). Null when there is nothing to remove.
 */
export function stripHiddenMentions(json: JSONContent | null | undefined, hidden: (id: ID) => boolean): JSONContent | null {
  if (!json) return null
  let changed = false
  const walk = (n: JSONContent): JSONContent => {
    let out = n
    const a = n.attrs
    if (n.type === 'mention' && a?.kind === 'page' && a.label && typeof a.id === 'string' && hidden(a.id)) {
      out = { ...n, attrs: { ...a, label: '' } }
      changed = true
    }
    if (n.content) {
      const kids = n.content.map(walk)
      if (kids.some((k, i) => k !== n.content![i])) out = { ...out, content: kids }
    }
    return out
  }
  const next = walk(json)
  return changed ? next : null
}

/** The search excerpt a shared page may carry: without the titles of pages others can't see. */
export function sharedPlain(page: Page, hidden: (id: ID) => boolean): string | undefined {
  if (!page.plain || !page.plain.includes('@')) return page.plain
  const stripped = stripHiddenMentions(page.content, hidden)
  return stripped ? plainText(stripped) : page.plain
}

/** Every `onefile:<id>` a value mentions (content, cover, file properties …). */
export function fileRefs(value: unknown, into = new Set<string>()): Set<string> {
  let json = ''
  try {
    json = typeof value === 'string' ? value : (JSON.stringify(value) ?? '')
  } catch {
    return into
  }
  if (!json.includes('onefile:')) return into
  for (const m of json.matchAll(FILE_RE)) into.add(m[1])
  return into
}

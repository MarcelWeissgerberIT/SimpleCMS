/**
 * window.__oneSettle — the e2e seam of Claude's writing path (DEV, or ?e2e like the app's own __one): the `one:` link
 * reader, the file form and claudeDoc over the live workspace, for workitem-p2-settle.spec's in-page cases. Pure
 * functions and reads only — nothing here writes.
 */
import type { JSONContent } from '@tiptap/core'
import { docToFileMarkdown, readableContent } from '../../editor'
import type { ID } from '../../store/types'
import { mentionFromLink, mentionsFromLinks } from '../io/import/mentions'
import { claudeSettled } from '../ai/claudeDoc'
import { toAIMarkdown } from '../share/markdown'

/** Rules as data (a spec can't pass functions): names by person id, known `<iso>|<code>` date reminders, known people. */
interface RulesData {
  people?: Record<string, string>
  dates?: string[]
  known?: string[]
}

if (typeof window !== 'undefined' && (import.meta.env.DEV || new URLSearchParams(window.location.search).has('e2e'))) {
  ;(window as unknown as { __oneSettle?: unknown }).__oneSettle = {
    mentionsFromLinks: (doc: JSONContent, rules: RulesData | null) =>
      mentionsFromLinks(
        doc,
        rules
          ? {
              person: (id) => rules.people?.[id] ?? null,
              knownDate: (iso, code) => !!rules.dates?.includes(`${iso}|${code}`),
              knownPerson: (id) => !!rules.known?.includes(id),
            }
          : null,
      ),
    mentionFromLink,
    docToFileMarkdown,
    toAIMarkdown,
    readable: (pageId: ID, form?: 'markdown' | 'file') => readableContent(pageId, form ? { form } : undefined).markdown,
    claudeDoc: (markdown: string, keep?: string[]) => claudeSettled(markdown, keep ? new Set(keep) : undefined).doc,
  }
}

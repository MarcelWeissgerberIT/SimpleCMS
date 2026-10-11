/**
 * window.__oneSettle — the e2e seam of Claude's writing path (DEV, or ?e2e like the app's own __one): the `one:` link
 * reader, the file form and claudeDoc over the live workspace, for workitem-p2-settle.spec's in-page cases, and
 * `perf` — the P2 paths timed for perf-budget.spec. Pure functions and reads only — nothing here writes (a staged
 * append goes to a throw-away stage of its own).
 */
import type { JSONContent } from '@tiptap/core'
import { docSchema, docToFileMarkdown, itemSafePoint, markdownToDoc, readClaudeQuote, readableContent } from '../../editor'
import type { ID } from '../../store/types'
import { mentionFromLink, mentionsFromLinks } from '../io/import/mentions'
import { claudeSettled } from '../ai/claudeDoc'
import { toAIMarkdown } from '../share/markdown'
import { SettleRefusal, type SettleContext } from './settle'
import { getItemIndex } from './live'
import { queryItems } from './query'

/** A settle context as data: the scope as page lists, the maps as records. */
type ContextData = Omit<SettleContext, 'visible' | 'readLimit' | 'handles' | 'staged'> & {
  visiblePages?: ID[] | null
  readLimits?: Record<ID, { mode: 'marked' | 'none'; ids?: string[] }>
  handles?: Record<string, string>
  staged?: Record<string, { change: string | null; private: boolean }>
}

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
    /** claudeSettled with a context (as data) over the live world: { doc, report } or { refused } */
    settled: (markdown: string, data: ContextData, keep?: string[]) => {
      const { visiblePages, readLimits, handles, staged, ...rest } = data
      const ctx: SettleContext = {
        ...rest,
        visible: visiblePages ? (id) => visiblePages.includes(id) : null,
        readLimit: readLimits ? (id) => readLimits[id] ?? null : null,
        handles: handles ? new Map(Object.entries(handles)) : undefined,
        staged: staged ? new Map(Object.entries(staged)) : undefined,
      }
      try {
        return claudeSettled(markdown, keep ? new Set(keep) : undefined, ctx)
      } catch (err) {
        if (err instanceof SettleRefusal) return { refused: err.message }
        throw err
      }
    },
    /**
     * perf-budget: ms per run (`runs` each, after one untimed run) of queryItems over every task, claudeSettled of
     * `markdown` (a staging context), staging it as an append (the agent tool on a throw-away stage) and
     * list_work_items with a 'marked' read limit on `limitPages` — nothing is written.
     */
    perf: async (o: { pageId: ID; markdown: string; limitPages: ID[]; runs: number }) => {
      const [{ callStage, stageWith }, { withReadLimit }] = await Promise.all([import('../mcp/stage'), import('../ai/agent/toolScope')])
      const time = (fn: () => unknown) => {
        const out: number[] = []
        // one untimed run first: the steady cost per call, not the first call's lazy parser / schema set-up
        fn()
        for (let i = 0; i < o.runs; i++) {
          const t0 = performance.now()
          fn()
          out.push(performance.now() - t0)
        }
        return out
      }
      let count = 0
      const query = time(() => {
        count = queryItems(getItemIndex(), { status: 'any', limit: 100, now: Date.now() }, () => true).total
      })
      let created = 0
      const settle = time(() => {
        created = claudeSettled(o.markdown, undefined, { source: 'terminal', creates: true, strict: false, pageId: o.pageId, private: false, existing: 'copy', me: true }).report.created.length
      })
      let staged = ''
      const stage = time(() => {
        staged = stageWith(callStage(), 'append_to_page', { id: o.pageId, markdown: o.markdown }).content
      })
      const marked = new Set(o.limitPages)
      const limit = (id: ID) => (marked.has(id) ? { mode: 'marked' as const, markdown: '', plain: '', blocks: 0, ids: [] } : null)
      let listed = ''
      const list = time(() => {
        listed = withReadLimit(limit, () => stageWith(callStage(), 'list_work_items', { status: 'any', limit: 100 }).content)
      })
      return { query, settle, stage, list, count, created, staged: staged.slice(0, 200), listed: listed.split('\n')[0] }
    },
    /** Claude's form of the first quote of a Markdown text (the real parse: link marks, soft breaks) */
    readQuoteMd: (markdown: string) => {
      const quote = (markdownToDoc(markdown).content ?? []).find((n) => n.type === 'blockquote')
      return quote ? readClaudeQuote(quote) : null
    },
    /**
     * itemSafePoint for the position right before the first occurrence of `text` in `json`: the position, the safe
     * point, and what stands right before the safe point (a top-level block's type and text when it moved)
     */
    safePointAt: (json: JSONContent, text: string) => {
      const doc = docSchema().nodeFromJSON(json)
      let pos = -1
      doc.descendants((n, at) => {
        if (pos >= 0) return false
        const i = n.isText ? (n.text ?? '').indexOf(text) : -1
        if (i >= 0) pos = at + i
        return pos < 0
      })
      const safe = itemSafePoint(doc, pos)
      const $safe = doc.resolve(safe)
      const before = $safe.nodeBefore
      return { pos, safe, depth: $safe.depth, before: before ? { type: before.type.name, text: before.textContent } : null }
    },
  }
}

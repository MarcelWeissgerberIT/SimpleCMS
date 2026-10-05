/**
 * "What Claude reads" of the page a request comes from — the page's context marks (editor area:
 * whole page / only the marked blocks / nothing) plus a selection when the request acts on one.
 *  - readsOf(…): the record a run keeps (and shows in its spec line)
 *  - readsText(t, lang, …): "whole page · 1,204 words" — the AI menu's reads line, the run's spec
 *  - pageRequest(…): the page context + input a request sends, by the page's mode (never unmarked text)
 */
import type { Translate } from '@/shared/i18n'
import { readableContent, type ContextMarks, type ContextMode } from '../../editor'
import { useWorkspace } from '../../store/store'
import type { ID } from '../../store/types'

export interface RunReads {
  /** the page's context mode when the request went out ('marked' with no block left counts as 'none') */
  mode: ContextMode
  /** a selection went along (it is always read) */
  selection: boolean
  /** marked blocks read (mode 'marked') */
  blocks: number
  /** words read from this page, the selection included */
  words: number
  /** "Ask your workspace": excerpts of the most relevant pages (this page as its mode allows) */
  workspace?: boolean
}

export const countWords = (text: string): number => {
  const m = text.match(/[\p{L}\p{N}][\p{L}\p{N}'’_-]*/gu)
  return m ? m.length : 0
}

/** The mode that counts: marked blocks that are all gone read nothing. */
export const effectiveMode = (m: Pick<ContextMarks, 'mode' | 'blocks'>): ContextMode => (m.mode === 'marked' && !m.blocks ? 'none' : m.mode)

const num = (n: number, lang: string) => n.toLocaleString(lang === 'de' ? 'de-DE' : 'en-US')
const plural = (n: number) => (n === 1 ? 'one' : 'other')

/** "whole page · 1,204 words" / "3 marked blocks · 412 words" / "selection + whole page · …" / "nothing from this page". */
export function readsText(t: Translate, lang: string, r: RunReads, wsMarks?: Pick<ContextMarks, 'mode' | 'blocks'>): string {
  const words = t(`features.ai.reads.words.${plural(r.words)}`, { count: num(r.words, lang) })
  if (r.workspace) {
    const m = wsMarks ? effectiveMode(wsMarks) : r.mode
    const page = m === 'page' ? t('features.ai.reads.wsPage') : m === 'none' ? t('features.ai.reads.wsNone') : t(`features.ai.reads.wsMarked.${plural(wsMarks?.blocks ?? r.blocks)}`, { count: num(wsMarks?.blocks ?? r.blocks, lang) })
    return t('features.ai.reads.workspace', { page })
  }
  if (r.selection) {
    if (r.mode === 'page') return t('features.ai.reads.selectionPage', { words })
    if (r.mode === 'marked') return t(`features.ai.reads.selectionMarked.${plural(r.blocks)}`, { count: num(r.blocks, lang), words })
    return t('features.ai.reads.selection', { words })
  }
  if (r.mode === 'page') return t('features.ai.reads.page', { words })
  if (r.mode === 'marked') return t(`features.ai.reads.marked.${plural(r.blocks)}`, { count: num(r.blocks, lang), words })
  return t('features.ai.reads.none')
}

/** Short form for a run's spec line: "PAGE" / "3 BLOCKS" / "NO PAGE" / "SELECTION" / "WORKSPACE". */
export function readsShort(t: Translate, lang: string, r: RunReads): string {
  if (r.workspace) return t('features.ai.reads.short.workspace')
  const page = r.mode === 'page' ? t('features.ai.reads.short.page') : r.mode === 'marked' ? t(`features.ai.reads.short.marked.${plural(r.blocks)}`, { count: num(r.blocks, lang) }) : ''
  if (r.selection) return page ? `${t('features.ai.reads.short.selection')} + ${page}` : t('features.ai.reads.short.selection')
  return page || t('features.ai.reads.short.none')
}

/** What the next request reads: the page's marks (+ the selection's words). */
export function readsFor(marks: ContextMarks | null, selection: string | null): RunReads {
  const mode = marks ? effectiveMode(marks) : 'page'
  const sel = selection ? countWords(selection) : 0
  const page = mode === 'none' ? 0 : (marks?.words ?? 0)
  return { mode, selection: !!selection, blocks: mode === 'marked' ? (marks?.blocks ?? 0) : 0, words: sel + page }
}

/* ------------------------------------------------------------------ */
/* What a page-level request sends                                     */
/* ------------------------------------------------------------------ */

export interface PageRead {
  /** the <page> context ('' = none) */
  context: string
  /** what the request reads, for the run's record */
  reads: RunReads
  /** Markdown of the marked blocks (mode 'marked'), '' otherwise */
  marked: string
}

/**
 * The page context of a request by the page's mode: the whole page (title + text, as before), the
 * title + the marked blocks as Markdown, or nothing at all.
 */
export function pageRead(pageId: ID, selection: string | null): PageRead {
  const p = useWorkspace.getState().pages[pageId]
  const title = p?.title.trim() ? `# ${p.title.trim()}\n\n` : ''
  const r = readableContent(pageId)
  const mode = effectiveMode(r)
  const sel = selection ? countWords(selection) : 0
  if (mode === 'none') return { context: '', marked: '', reads: { mode, selection: !!selection, blocks: 0, words: sel } }
  if (mode === 'marked') return { context: `${title}${r.markdown}`, marked: r.markdown, reads: { mode, selection: !!selection, blocks: r.blocks, words: sel + r.words } }
  return { context: p ? `${title}${p.plain ?? ''}` : '', marked: '', reads: { mode, selection: !!selection, blocks: 0, words: sel + r.words } }
}

/**
 * Work orders — fingerprints of what goes along to Claude Code (review fix: never a tab-local `contentRev`, which every
 * tab counts on its own and a reload resets). SHA-256 over canonical JSON:
 *  - a page a step takes along (`pageFp`): its title and its text as Markdown — the planner's read is pinned with the
 *    draft (`OrderDraft.source.fps`), ↵ Kette starten refuses when one moved since, the chain step keeps it, and a ref
 *    card pins exactly what it rendered;
 *  - the request (`requestFp`): its text as the step quote holds it (stepPage.ts requestText — the context marks of this
 *    tab respected, as readableBlocks reads it);
 *  - a Grundlage (`textFp(basisText(block))`): what a card showed before ↵ Weiter.
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import type { ID, Page } from '../../../store/types'
import { docToMarkdown, readableBlocks } from '../../../editor'
import { t } from '../../../i18n'
import { canonicalJson } from '../protocol'
import { requestText } from './stepPage'

async function sha256Hex(text: string): Promise<string> {
  const digest = await globalThis.crypto.subtle.digest('SHA-256', new TextEncoder().encode(text))
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('')
}

/** A text's fingerprint. */
export const textFp = (text: string): Promise<string> => sha256Hex(canonicalJson(['text', text]))

/** What a card shows of a page — and what its fingerprint covers: the title and the text as Markdown. */
export function pageShown(page: Pick<Page, 'title' | 'content'> | undefined): { title: string; text: string } {
  return { title: page?.title.trim() ?? '', text: page ? docToMarkdown(page.content ?? { type: 'doc', content: [] }).trim() : '' }
}

/** A page's fingerprint from what is shown of it ('' : no such page). */
export const shownFp = (shown: { title: string; text: string } | null): Promise<string> => (shown ? sha256Hex(canonicalJson(['page', shown.title, shown.text])) : Promise.resolve(''))

/** Fingerprints per page object (a store page is never changed in place: a write makes a new object). */
const byPage = new WeakMap<object, Promise<string>>()

/** A page's fingerprint now ('' : no such page here). */
export function pageFp(page: Pick<Page, 'title' | 'content'> | undefined): Promise<string> {
  if (!page) return Promise.resolve('')
  let fp = byPage.get(page)
  if (!fp) {
    fp = shownFp(pageShown(page))
    byPage.set(page, fp)
  }
  return fp
}

/** A page's title for a reference the request quote turns into text (confirm.ts quotes with the same). */
export const quoteTitleOf = (id: ID): string => useWorkspace.getState().pages[id]?.title.trim() || t('common.untitled')

/** The request's text as every step quotes it, read now (the context marks of this tab respected). */
export function requestNow(rowId: ID): { blocks: JSONContent[]; text: string } {
  const blocks = readableBlocks(rowId)
  return { blocks, text: requestText(blocks, quoteTitleOf) }
}

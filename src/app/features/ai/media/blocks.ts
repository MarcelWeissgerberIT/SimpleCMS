/**
 * Saved media as blocks, and putting them into a page from outside an editor (⌘K "?", agent run results):
 * one version first, then one content write with origin 'ai'. The AI menu and the generate panel insert
 * through their editor instead (one undo step there); the AI terminal stages them (kind 'media').
 */
import type { JSONContent } from '@tiptap/core'
import { useWorkspace } from '../../../store/store'
import type { ID } from '../../../store/types'
import { isEffectivelyTrashed } from '../../../store/selectors'
import { createPrivatePage, isPrivatePage } from '../../../cloud'
import { t } from '../../../i18n'
import { snapshotNow } from '../../history/snapshots'
import type { SavedMedia } from './types'

/** The block for a saved file: image / video / audio — an SVG (stored for download) as a file block. */
export function mediaNode(m: Pick<SavedMedia, 'src' | 'kind' | 'name' | 'size' | 'caption' | 'alt'>): JSONContent {
  switch (m.kind) {
    case 'image':
      return { type: 'image', attrs: { src: m.src, alt: m.alt || null, caption: m.caption } }
    case 'video':
      return { type: 'video', attrs: { src: m.src, name: m.name, caption: m.caption } }
    case 'audio':
      return { type: 'audio', attrs: { src: m.src, name: m.name, caption: m.caption } }
    default:
      return { type: 'fileBlock', attrs: { src: m.src, name: m.name, size: m.size, display: 'file' } }
  }
}

const alive = (id: ID | null | undefined): id is ID => {
  const pages = useWorkspace.getState().pages
  return !!id && !!pages[id] && !pages[id].trashed && !isEffectivelyTrashed(pages, id)
}

const isEmptyDoc = (doc: JSONContent | null | undefined) => (doc?.content ?? []).every((b) => b.type === 'paragraph' && !(b.content ?? []).length)

/**
 * Append the media to a page (a version first; origin 'ai'). Without a page (or a page that is gone): a new
 * page "Generated media" — private in a team workspace when `privateNew`. Returns the page id.
 */
export async function appendMedia(pageId: ID | null, saved: SavedMedia[], opts: { privateNew?: boolean } = {}): Promise<ID> {
  const nodes = saved.map(mediaNode)
  if (alive(pageId)) {
    await snapshotNow(pageId, 'ai')
    const page = useWorkspace.getState().pages[pageId]
    const prev = page?.content
    const content: JSONContent = { type: 'doc', content: isEmptyDoc(prev) ? nodes : [...(prev?.content ?? []), ...nodes] }
    useWorkspace.getState().setContent(pageId, content, 'ai')
    return pageId
  }
  const input = { title: t('features.ai.media.newPage'), content: { type: 'doc', content: nodes } as JSONContent }
  return opts.privateNew ? createPrivatePage(input) : useWorkspace.getState().createPage(input)
}

/** A page is private (team: its files are uploaded as private too). */
export const pagePrivate = (pageId: ID | null | undefined) => !!pageId && isPrivatePage(pageId)

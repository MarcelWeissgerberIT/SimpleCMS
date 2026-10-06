/**
 * Media cards whose saved files go into a page directly (⌘K "?" answers: the current page · custom agents'
 * run results: the agent's report page) — a version first, origin 'ai'; no page: a new page "Generated media".
 * A toast says where they went, with Open.
 */
import { useT } from '../../../i18n'
import { useWorkspace } from '../../../store/store'
import { useUI } from '../../../store/ui'
import type { ID } from '../../../store/types'
import { openPage } from '../../../lib/router'
import { MediaCards } from './MediaCards'
import { appendMedia, pagePrivate } from './blocks'
import type { MediaItem, SavedMedia } from './types'

export interface MediaToPageProps {
  items: MediaItem[]
  /** where saved media go (null: a new page "Generated media") */
  pageId: ID | null
  disabled?: boolean
  /** a new page is private (team: the request came from a private page) */
  privateNew?: boolean
}

export function MediaToPage({ items, pageId, disabled, privateNew }: MediaToPageProps) {
  const t = useT()
  const title = useWorkspace((s) => (pageId && s.pages[pageId] && !s.pages[pageId].trashed ? s.pages[pageId].title.trim() || t('common.untitled') : ''))
  const target = title ? pageId : null

  const place = async (saved: SavedMedia[]) => {
    const id = await appendMedia(target, saved, { privateNew })
    const name = useWorkspace.getState().pages[id]?.title.trim() || t('common.untitled')
    useUI.getState().toast({
      message: t(`features.ai.media.added.${saved.length === 1 ? 'one' : 'other'}`, { count: saved.length, title: name }),
      kind: 'success',
      timeout: 8000,
      action: { label: t('features.ai.media.openPage'), run: () => openPage(id) },
    })
  }

  return (
    <MediaCards
      items={items}
      onSaved={place}
      disabled={disabled}
      privateTarget={target ? pagePrivate(target) : !!privateNew}
      where={title ? t('features.ai.media.wherePage', { title }) : t('features.ai.media.whereNew')}
    />
  )
}

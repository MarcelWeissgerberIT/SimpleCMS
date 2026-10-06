/**
 * Saving a card, whichever way: this browser fetches it, a copy the person picks, or the team server
 * fetches it. The card's state follows (state.ts); a failure is shown on the card, never thrown.
 */
import { MediaSaveError, fetchThroughTeam, pickMediaFile, previewMediaItem, saveMediaItem, saveUploadedCopy } from './save'
import { cardOf, setCard, setPreview, useMediaCards } from './state'
import type { MediaItem, SavedMedia } from './types'

export type SaveWay = 'browser' | 'upload' | 'team'

/** Save one card (null: it failed — the card says why — or the person cancelled the file picker). */
export async function saveCard(item: MediaItem, way: SaveWay = 'browser', opts: { privateTarget?: boolean; n?: number } = {}): Promise<SavedMedia | null> {
  const before = cardOf(item.id)
  if (before.state === 'saving') return null
  let file: File | null = null
  if (way === 'upload') {
    file = await pickMediaFile(item.kind)
    if (!file) return null
  }
  setCard(item.id, { state: 'saving', via: way })
  try {
    const saved = way === 'upload' && file ? await saveUploadedCopy(item, file) : way === 'team' ? await fetchThroughTeam(item, { private: opts.privateTarget }) : await saveMediaItem(item, { n: opts.n })
    setCard(item.id, { state: 'saved', src: saved.src, via: way })
    return saved
  } catch (e) {
    const issue = e instanceof MediaSaveError ? e.issue : 'server'
    // a failed upload of a copy keeps what the browser's own attempt said (Open / Fetch through … stay offered)
    setCard(item.id, { state: 'failed', issue: way === 'upload' && before.issue && issue !== 'type' && issue !== 'mismatch' && issue !== 'too_large' ? before.issue : issue, via: way })
    return null
  }
}

/** Save several cards one after the other (this browser fetches each); the ones that worked, in order. */
export async function saveCards(items: MediaItem[], opts: { privateTarget?: boolean; all?: MediaItem[] } = {}): Promise<SavedMedia[]> {
  const out: SavedMedia[] = []
  for (const item of items) {
    if (cardOf(item.id).state === 'saved') continue
    const saved = await saveCard(item, 'browser', { privateTarget: opts.privateTarget, n: (opts.all ?? items).indexOf(item) + 1 })
    if (saved) out.push(saved)
  }
  return out
}

/** "Preview" a generated picture (a click): fetched and checked now, shown from memory; a refusal shows on the card like a failed save. */
export async function previewCard(item: MediaItem): Promise<void> {
  const now = useMediaCards.getState().previews[item.id]
  if (now || cardOf(item.id).state === 'saved') return
  setPreview(item.id, { state: 'loading' })
  try {
    const url = await previewMediaItem(item)
    setPreview(item.id, { state: 'ready', url })
  } catch (e) {
    setPreview(item.id, null)
    setCard(item.id, { state: 'failed', issue: e instanceof MediaSaveError ? e.issue : 'server', via: 'browser' })
  }
}

/** Preview every picture of a list that has none yet, one after the other. */
export async function previewCards(items: MediaItem[]): Promise<void> {
  for (const item of items) if (item.kind === 'image') await previewCard(item)
}

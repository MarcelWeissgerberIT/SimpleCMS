/**
 * STATUS lamps' cards (§6.5): one card per id of the reading, kind 'fix' — what is wrong and the key that fixes it (the
 * source's own screen or action). The card ends when its id leaves the reading (`resolveBy: 'reading'`).
 */
import type { CardAction, LampId, QueueItem } from '../registry'

export function fixItems(lamp: LampId, ids: readonly string[], card: (id: string) => Pick<QueueItem, 'title' | 'detail' | 'tag'> & { hand?: QueueItem['hand']; at?: number; refs?: QueueItem['refs'] }): QueueItem[] {
  return ids.map((id) => {
    const c = card(id)
    return { id, lamp, kind: 'fix', tag: c.tag, refs: c.refs ?? {}, at: c.at ?? 0, hand: c.hand ?? [], bulk: false, resolveBy: 'reading', title: c.title, detail: c.detail }
  })
}

/** A key that opens a screen (the card stays). */
export const openKey = (label: string, go: () => void, key: CardAction['key'] = 'o'): CardAction => ({ key, label, outcome: 'hand', run: () => (go(), { ok: true, stay: true }) })

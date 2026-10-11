/**
 * Task block P1 — ItemIds: a copy gets a new itemId, a move keeps it. Paste / drop (the `workItemIds` plugin),
 * duplicate (Mod+D, grip, multi-select), page duplicate, templates (own, recurring, row / record type),
 * synced unsync, button templates, relink after a cut whose source store copy was stale, duplicates shown
 * (DUPLICATE · NEW ID) and never auto-fixed. Tasks are injected through the store (fictional data).
 */
import { test, expect } from './fixtures'
import { ITEM_ALPHABET, ITEM_ID, newItemId } from '../../src/app/lib/itemIds'

test.describe('newItemId (pure)', () => {
  test('100,000 ids: all distinct, all valid, the alphabet spelled out (≥ 60 distinct characters)', () => {
    expect(ITEM_ALPHABET).toHaveLength(64)
    expect(new Set(ITEM_ALPHABET).size).toBe(64)
    const ids = new Set<string>()
    const chars = new Set<string>()
    for (let i = 0; i < 100_000; i++) {
      const id = newItemId()
      ids.add(id)
      for (const ch of id.slice(3)) chars.add(ch)
    }
    expect(ids.size).toBe(100_000)
    expect(chars.size).toBeGreaterThanOrEqual(60)
    for (const id of ids) if (!ITEM_ID.test(id)) throw new Error(`invalid id ${id}`)
  })
})

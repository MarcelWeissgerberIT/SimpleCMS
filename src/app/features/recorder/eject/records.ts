/**
 * Eject records (store `ejects`, design §6.8): written ahead as 'committing' before the store update, then 'done' (or
 * 'aborted'); an Undo stamps `undone`. Ids, outcomes, part digests, counts and times — never text. Every write tells
 * the deck (bus kind 'eject') so the plate and the tape follow in every tab.
 */
import type { EjectRecord, Scope } from '../model/types'
import { openJournal } from '../journal/db'
import { emitEject } from '../journal/bus'

const MONTH = 30 * 24 * 3600_000

/** Write a record (committed at once: the write-ahead must be on its way before the store update). */
export async function putEject(r: EjectRecord): Promise<void> {
  const j = await openJournal()
  await j.write({ put: { ejects: [r as unknown as Record<string, unknown>] } }, { commit: true })
  emitEject(r.s)
}

export async function getEject(id: string): Promise<EjectRecord | null> {
  const j = await openJournal()
  return (await j.get<EjectRecord>('ejects', id)) ?? null
}

/** A scope's records of the last 30 days (every state), oldest first. */
export async function ejectsOf(scope: Scope, now = Date.now()): Promise<EjectRecord[]> {
  const j = await openJournal()
  return j.range<EjectRecord>({ store: 'ejects', index: 'at', lo: [scope, now - MONTH], hi: [scope, now + 60_000] })
}

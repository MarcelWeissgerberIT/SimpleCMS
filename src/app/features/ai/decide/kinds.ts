/**
 * Which staged changes Jev pre-checks (an allow-list, slice SJ): changes to pages and rows. Never a send (the Outbox's —
 * slips never go to an AI), a memory, a coding task, a script, saved media or a database / property an agent proposes.
 */
import type { ChangeKind } from '../agent/types'

export const CHECKED_KINDS: readonly ChangeKind[] = ['create_page', 'append', 'edit', 'create_row', 'update_row', 'rename', 'workItem']

export const isCheckedKind = (k: ChangeKind | string): boolean => (CHECKED_KINDS as readonly string[]).includes(k)
